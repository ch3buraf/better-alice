// Test all 5 tool-tag fences end-to-end on alicepro.yandex.ru
// Alice Pro DOM is different from Alice:
//   - chat input: textarea#message-textarea inside form#message-form
//   - submit: form#message-form button.submit (or just Enter, since it's a form)
//   - new chat: requires navigating in sidebar or starting fresh from /expert
//   - message bubble: ".message:not(.user)" or ".alice-message-content"

import fs from 'node:fs';
const DOWNLOADS = "C:\\Users\\LL5AI\\Downloads";

const TESTS = [
  {
    id: "pptx",
    title: "PowerPoint",
    prompt: "Сделай PowerPoint про космос — 3 слайда: титульный, планеты буллетами, итоги. Используй формат bap-pptx с JSON.",
    expectedLang: "bap-pptx",
    btnFilter: /pptx|Скачать .pptx/i,
    fileExt: /\.pptx$/i,
  },
  {
    id: "excel",
    title: "Excel",
    prompt: "Сделай Excel таблицу 'список покупок' с 4 категориями: овощи, фрукты, мясо, молочные. Колонки: товар, цена. Используй формат bap-excel с JSON.",
    expectedLang: "bap-excel",
    btnFilter: /xlsx|Скачать .xlsx/i,
    fileExt: /\.xlsx$/i,
  },
  {
    id: "docx",
    title: "Word",
    prompt: "Сделай Word документ — план тренировки на неделю: понедельник-воскресенье, для каждого дня абзац с упражнениями. Используй формат bap-docx с JSON.",
    expectedLang: "bap-docx",
    btnFilter: /docx|Скачать .docx/i,
    fileExt: /\.docx$/i,
  },
  {
    id: "visualizer",
    title: "Visualizer (SVG)",
    prompt: "Нарисуй интерактивную схему: круг с радиусом 80, цвет синий, рядом текст 'Привет Алиса Про'. Используй формат bap-visualizer.",
    expectedLang: "bap-visualizer",
    btnFilter: null,
    fileExt: null,
  },
  {
    id: "filename",
    title: "filename= download",
    prompt: "Напиши на JavaScript функцию для сортировки массива пузырьком. Оформи в формате filename=bubble-sort.js чтобы скачать одной кнопкой.",
    expectedLang: "filename=",
    btnFilter: /bubble|\.js|⬇/i,
    fileExt: /bubble.*\.js$|sort.*\.js$/i,
  },
];

async function attachBrowser() {
  const v = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); } });
  return { ws, call: (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); }) };
}

async function attachTab(targetId) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.id === targetId);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); } });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable");
  await call("Page.enable");
  return { ws, call };
}

async function runOneTest(test, bc) {
  console.log(`\n=== [${test.id}] ${test.title} on Alice Pro ===`);

  // Open Alice Pro freshly. We go to /expert which is the root.
  const newTab = await bc("Target.createTarget", { url: "https://alicepro.yandex.ru/expert", background: false });
  console.log("  opened tab", newTab.targetId);
  await new Promise(r => setTimeout(r, 9000));
  const { ws: tabWs, call: tc } = await attachTab(newTab.targetId);

  // Alice Pro: send via textarea + Enter (form#message-form auto-submits)
  console.log("  setting prompt + Enter...");
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea') || document.querySelector('textarea');
      if (!t) return 'no textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus();
      setter.call(t, ${JSON.stringify(test.prompt)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`,
    returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 700));
  await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

  // Poll for code block in last assistant message (Alice Pro DOM is different)
  let resp = null;
  let lastLen = 0, stable = 0;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{
        // Alice Pro: assistant message is in .alice-message-content (or any element NOT wrapped in .message.user)
        const codeBlocks = [...document.querySelectorAll('pre code[class*="language-${test.expectedLang}"]')];
        const last = codeBlocks[codeBlocks.length - 1];
        if (!last) return null;
        const content = last.textContent || '';
        if (content.length < 30) return null;
        return {lang: String(last.className).match(/language-([^\\s]+)/)?.[1] || '', content: content.slice(0, 2500), len: content.length};
      })()`, returnByValue: true,
    });
    const v = r.result?.value;
    if (v) {
      if (v.len === lastLen) { stable++; if (stable >= 3) { resp = v; break; } }
      else { lastLen = v.len; stable = 0; }
    }
  }

  if (!resp) {
    console.log("  ✗ no fence response in 90s");
    tabWs.close();
    const tabsState = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
    const finalTab = tabsState.find(x => x.id === newTab.targetId);
    return { ...test, targetId: newTab.targetId, ok: false, url: finalTab?.url };
  }
  console.log(`  ✓ Alice Pro returned ${test.expectedLang} block (${resp.len} bytes)`);

  // JSON valid check
  if (test.expectedLang !== "bap-visualizer" && !test.expectedLang.startsWith("filename=")) {
    try { JSON.parse(resp.content); console.log("  ✓ JSON valid"); }
    catch (e) { console.log("  ✗ JSON malformed:", e.message); }
  }

  // Test download/iframe
  let downloadOk = null;
  if (test.btnFilter && test.fileExt) {
    const beforeFiles = new Set(fs.readdirSync(DOWNLOADS));
    console.log("  clicking action button...");
    await tc("Runtime.evaluate", {
      expression: `(()=>{
        const btns = [...document.querySelectorAll('.bap-code-download')];
        const btn = btns.find(b => ${test.btnFilter}.test(b.textContent || ''));
        if (!btn) return 'no btn';
        btn.click();
        return 'clicked: ' + btn.textContent;
      })()`, returnByValue: true,
    });
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const files = fs.readdirSync(DOWNLOADS);
      const newFile = files.find(f => !beforeFiles.has(f) && test.fileExt.test(f));
      if (newFile) {
        const stat = fs.statSync(DOWNLOADS + "\\" + newFile);
        downloadOk = { name: newFile, size: stat.size };
        console.log(`  ✓ DOWNLOADED: ${newFile} (${stat.size} bytes)`);
        break;
      }
    }
    if (!downloadOk) console.log("  ✗ no new file in Downloads");
  } else if (test.id === "visualizer") {
    await new Promise(r => setTimeout(r, 3000));
    const iframeRes = await tc("Runtime.evaluate", {
      expression: `(()=>{
        const wrappers = [...document.querySelectorAll('.bap-visualizer-wrapper')];
        const iframes = [...document.querySelectorAll('.bap-visualizer-wrapper iframe')];
        return {wrapperCount: wrappers.length, iframeCount: iframes.length, srcdocLen: iframes[0]?.getAttribute('srcdoc')?.length || 0};
      })()`, returnByValue: true,
    });
    const v = iframeRes.result?.value;
    if (v?.iframeCount > 0) {
      console.log(`  ✓ visualizer iframe mounted, srcdoc=${v.srcdocLen} bytes`);
      downloadOk = { iframe: true, srcdocLen: v.srcdocLen };
    } else {
      console.log("  ✗ no iframe");
    }
  }

  tabWs.close();
  const tabsState = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const finalTab = tabsState.find(x => x.id === newTab.targetId);
  return { ...test, targetId: newTab.targetId, ok: !!downloadOk, downloadOk, url: finalTab?.url };
}

const { ws: bw, call: bc } = await attachBrowser();

const results = [];
for (const test of TESTS) {
  const r = await runOneTest(test, bc);
  results.push(r);
}
bw.close();

console.log("\n\n==================================================");
console.log("=== ALICE PRO FINAL SUMMARY ===");
console.log("==================================================");
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} [${r.id}] ${r.title}`);
  if (r.downloadOk?.name) console.log(`    → file: ${r.downloadOk.name} (${r.downloadOk.size} bytes)`);
  if (r.downloadOk?.iframe) console.log(`    → iframe rendered, srcdoc ${r.downloadOk.srcdocLen} bytes`);
  if (r.url) console.log(`    → tab: ${r.url}`);
}
