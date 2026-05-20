// Open 4 separate Alice tabs, in each send a different bap-fence test prompt,
// wait for Alice response, click the action button to trigger generation,
// then leave each tab open for the user to inspect visually.

import fs from 'node:fs';
import path from 'node:path';

const DOWNLOADS = "C:\\Users\\LL5AI\\Downloads";

const TESTS = [
  {
    id: "pptx",
    title: "PowerPoint",
    prompt: "Сделай PowerPoint про погоду — 3 слайда: титульный, типы погоды буллетами, итоги. Используй формат bap-pptx с JSON как указано в инструкциях системы.",
    expectedLang: "bap-pptx",
    btnFilter: /pptx|Скачать .pptx/i,
    fileExt: /\.pptx$/i,
  },
  {
    id: "excel",
    title: "Excel",
    prompt: "Сделай Excel таблицу 'бюджет на месяц' с 5 категориями: еда, транспорт, развлечения, аренда, прочее. Используй формат bap-excel с JSON как указано в инструкциях системы.",
    expectedLang: "bap-excel",
    btnFilter: /xlsx|Скачать .xlsx/i,
    fileExt: /\.xlsx$/i,
  },
  {
    id: "docx",
    title: "Word",
    prompt: "Сделай Word документ — резюме программиста: заголовок 'Резюме', блок с именем Алексей Иванов, скиллы списком (Python, JavaScript, Docker), и абзац с опытом работы. Используй формат bap-docx с JSON как указано в инструкциях системы.",
    expectedLang: "bap-docx",
    btnFilter: /docx|Скачать .docx/i,
    fileExt: /\.docx$/i,
  },
  {
    id: "visualizer",
    title: "Visualizer (SVG)",
    prompt: "Нарисуй интерактивную схему молекулы воды H2O: один атом кислорода (красный круг) в центре, два атома водорода (белые круги) по бокам, и связи между ними. Используй формат bap-visualizer.",
    expectedLang: "bap-visualizer",
    btnFilter: null, // no download — iframe preview
    fileExt: null,
  },
];

async function attachToBrowserWS() {
  const v = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nid = 1;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, call };
}

async function attachToTarget(targetId) {
  // Find the tab by target id and get its debugger URL
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.id === targetId);
  if (!t) throw new Error("no target " + targetId);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nid = 1;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable");
  await call("Page.enable");
  return { ws, call };
}

async function runOneTest(test, browserCall) {
  console.log(`\n=== [${test.id}] ${test.title} ===`);

  // 1. Open new tab
  const newTab = await browserCall("Target.createTarget", { url: "https://alice.yandex.ru/", background: false });
  const targetId = newTab.targetId;
  console.log("  opened tab targetId=" + targetId);

  // Wait for SPA to load
  await new Promise(r => setTimeout(r, 8000));

  const { ws: tabWs, call: tabCall } = await attachToTarget(targetId);

  // 2. Click new chat
  await tabCall("Runtime.evaluate", {
    expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]'); if(b){b.click();return 'ok';} return 'no btn';})()`,
    returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 2500));

  // 3. Set prompt + press Enter
  console.log("  sending prompt...");
  await tabCall("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea.AliceInput-Textarea') || document.querySelector('textarea');
      if (!t) return 'no textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus();
      setter.call(t, ${JSON.stringify(test.prompt)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 700));
  await tabCall("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await tabCall("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

  // 4. Wait for fence block to appear AND streaming to complete (content length stable for 3 polls)
  let lastLen = 0;
  let stableTicks = 0;
  let response = null;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tabCall("Runtime.evaluate", {
      expression: `(()=>{
        const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
        const last = bubbles[bubbles.length - 1];
        if (!last) return null;
        const code = last.querySelector('pre code[class*="language-${test.expectedLang}"]');
        if (!code) {
          // Maybe still streaming text — return null to keep waiting
          return null;
        }
        return {content: code.textContent || '', len: (code.textContent||'').length};
      })()`,
      returnByValue: true,
    });
    const v = r.result?.value;
    if (v) {
      if (v.len === lastLen) {
        stableTicks++;
        if (stableTicks >= 3) { response = v; break; }
      } else {
        lastLen = v.len;
        stableTicks = 0;
      }
    }
  }

  if (!response) {
    console.log("  ✗ no response in 90s");
    tabWs.close();
    return { ...test, targetId, ok: false, reason: "no_response" };
  }
  console.log(`  ✓ Alice returned ${test.expectedLang} block (${response.len} bytes)`);

  // Verify JSON parses for office formats
  if (test.expectedLang !== "bap-visualizer" && !test.expectedLang.startsWith("filename=")) {
    try {
      JSON.parse(response.content);
      console.log("  ✓ JSON valid");
    } catch (e) {
      console.log("  ✗ JSON malformed:", e.message);
    }
  }

  // 5. Click action button (download or iframe trigger)
  let downloadOk = null;
  if (test.btnFilter && test.fileExt) {
    // Pre-check Downloads dir state
    const beforeFiles = new Set(fs.readdirSync(DOWNLOADS));
    const startedAt = new Date();

    console.log("  clicking action button...");
    const clickRes = await tabCall("Runtime.evaluate", {
      expression: `(()=>{
        const btns = [...document.querySelectorAll('.bap-code-download')];
        const btn = btns.find(b => ${test.btnFilter}.test(b.textContent || ''));
        if (!btn) return 'no btn';
        btn.click();
        return 'clicked: ' + btn.textContent;
      })()`, returnByValue: true,
    });
    console.log(" ", clickRes.result?.value);

    // Wait + check
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const files = fs.readdirSync(DOWNLOADS);
      const newFile = files.find(f => !beforeFiles.has(f) && test.fileExt.test(f));
      if (newFile) {
        const stat = fs.statSync(path.join(DOWNLOADS, newFile));
        downloadOk = { name: newFile, size: stat.size };
        console.log(`  ✓ DOWNLOADED: ${newFile} (${stat.size} bytes)`);
        break;
      }
    }
    if (!downloadOk) console.log("  ✗ no new file in Downloads");
  } else if (test.id === "visualizer") {
    // Visualizer: wait for iframe to render
    await new Promise(r => setTimeout(r, 3000));
    const iframeRes = await tabCall("Runtime.evaluate", {
      expression: `(()=>{
        const iframes = [...document.querySelectorAll('.bal-visualizer-wrapper iframe')];
        if (!iframes.length) return null;
        const inner = iframes[0];
        // check the iframe srcdoc was set (we can't inspect inner without same-origin)
        return {srcdocLen: (inner.getAttribute('srcdoc') || '').length, hasIframe: true};
      })()`,
      returnByValue: true,
    });
    if (iframeRes.result?.value?.hasIframe) {
      console.log(`  ✓ iframe mounted, srcdoc=${iframeRes.result.value.srcdocLen} bytes`);
      downloadOk = { iframe: true, srcdocLen: iframeRes.result.value.srcdocLen };
    } else {
      console.log("  ✗ no iframe");
    }
  }

  tabWs.close();
  return {
    ...test,
    targetId,
    ok: !!downloadOk,
    response: { len: response.len, head: response.content.slice(0, 200) },
    downloadOk,
  };
}

const { ws: bWs, call: bCall } = await attachToBrowserWS();

const results = [];
for (const test of TESTS) {
  const r = await runOneTest(test, bCall);
  results.push(r);
}

bWs.close();

console.log("\n\n========================================");
console.log("=== FINAL SUMMARY ===");
console.log("========================================");
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} [${r.id}] ${r.title}`);
  if (r.downloadOk?.name) console.log(`    → file: ${r.downloadOk.name} (${r.downloadOk.size} bytes)`);
  if (r.downloadOk?.iframe) console.log(`    → iframe rendered with srcdoc ${r.downloadOk.srcdocLen} bytes`);
  if (!r.ok) console.log(`    → ${r.reason || "see log above"}`);
}

console.log("\n=== TABS LEFT OPEN FOR VISUAL INSPECTION ===");
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
for (const r of results) {
  const t = tabs.find(x => x.id === r.targetId);
  if (t) console.log(`  [${r.id}] ${t.url}`);
}
