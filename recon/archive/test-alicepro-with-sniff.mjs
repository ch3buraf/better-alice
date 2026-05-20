// Test Alice Pro with smart sniff — accept ```json blocks too.

import fs from 'node:fs';
const DOWNLOADS = "C:\\Users\\LL5AI\\Downloads";
const SCREENSHOTS = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots";
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const TESTS = [
  { id: "pptx",  prompt: "Сделай PowerPoint про космос — 3 слайда: титульный, планеты буллетами, итоги. Используй формат bap-pptx с JSON.", btnFilter: /pptx|Скачать .pptx/i, fileExt: /\.pptx$/i },
  { id: "excel", prompt: "Сделай Excel таблицу 'список покупок' с 4 товарами и колонками: товар, цена. Используй формат bap-excel с JSON.", btnFilter: /xlsx|Скачать .xlsx/i, fileExt: /\.xlsx$/i },
  { id: "docx",  prompt: "Сделай Word документ — план тренировки на неделю. Для каждого дня недели абзац с упражнениями. Используй формат bap-docx с JSON.", btnFilter: /docx|Скачать .docx/i, fileExt: /\.docx$/i },
  { id: "viz",   prompt: "Нарисуй интерактивную SVG-схему: жёлтое солнце посередине и зелёное дерево слева. Используй формат bap-visualizer.", btnFilter: null, fileExt: null },
  { id: "file",  prompt: "Напиши на JS функцию sortBubble — оформи как ```filename=bubble-sort.js. Никаких data: URL, только в код-блоке.", btnFilter: /bubble|⬇|filename/i, fileExt: /bubble.*\.js$/i },
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
  await call("Runtime.enable"); await call("Page.enable");
  return { ws, call };
}

async function runOne(test, bc) {
  console.log(`\n=== [${test.id}] on Alice Pro ===`);
  // Open Alice Pro and wait long enough for SPA + sidebar + project selection
  const newTab = await bc("Target.createTarget", { url: "https://alicepro.yandex.ru/expert", background: false });
  await new Promise(r => setTimeout(r, 12000));
  const { ws: tw, call: tc } = await attachTab(newTab.targetId);

  console.log("  type + submit-click (Alice Pro form submit)...");
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea') || document.querySelector('textarea');
      if (!t) return 'no textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus(); setter.call(t, ${JSON.stringify(test.prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 800));
  // Alice Pro: try form.requestSubmit() first (calls SvelteKit's enhance hook),
  // then fall back to clicking the submit button or pressing Enter.
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const form = document.querySelector('#message-form');
      if (form && typeof form.requestSubmit === 'function') {
        const btn = form.querySelector('button.submit') || form.querySelector('button[type="submit"]');
        if (btn) { form.requestSubmit(btn); return 'requestSubmit'; }
        form.requestSubmit(); return 'requestSubmit-noBtn';
      }
      const btn = document.querySelector('#message-form button.submit, #message-form button[type="submit"]');
      if (btn) { btn.click(); return 'btnClick'; }
      return 'no submit path';
    })()`, returnByValue: true,
  });

  // Poll for ANY code block whose action button matches our expected filter,
  // OR a visualizer wrapper for viz test
  let detected = null, lastLen = 0, stable = 0;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{
        if ('${test.id}' === 'viz') {
          const wrappers = [...document.querySelectorAll('.bap-visualizer-wrapper iframe')];
          if (wrappers[0]) return {kind: 'viz', srcdocLen: wrappers[0].getAttribute('srcdoc')?.length || 0};
          return null;
        }
        const btns = [...document.querySelectorAll('.bap-code-download')];
        const targetBtn = btns.find(b => ${test.btnFilter}.test(b.textContent || ''));
        const allCodeBlocks = [...document.querySelectorAll('pre code')].map(c => ({lang: String(c.className).match(/language-([^\\s]+)/)?.[1], len: (c.textContent||'').length}));
        return targetBtn ? {kind: 'btn', btnText: targetBtn.textContent, blocks: allCodeBlocks} : null;
      })()`, returnByValue: true,
    });
    const v = r.result?.value;
    if (v) {
      const currentLen = v.srcdocLen || (v.blocks && v.blocks[v.blocks.length-1]?.len) || 0;
      if (currentLen === lastLen && currentLen > 50) {
        stable++;
        if (stable >= 3) { detected = v; break; }
      } else {
        lastLen = currentLen;
        stable = 0;
      }
    }
  }

  if (!detected) {
    console.log("  ✗ no expected button/iframe in 90s");
    // dump what we got
    const dump = await tc("Runtime.evaluate", {
      expression: `(()=>{const codes=[...document.querySelectorAll('pre code')];return codes.slice(0,3).map(c=>({lang:String(c.className).match(/language-([^\\s]+)/)?.[1],content:c.textContent.slice(0,200)}));})()`,
      returnByValue: true,
    });
    console.log("  found blocks:", JSON.stringify(dump.result?.value));
    tw.close();
    return { ...test, ok: false, targetId: newTab.targetId };
  }
  console.log(`  ✓ ${detected.kind} detected:`, detected.btnText || `srcdoc=${detected.srcdocLen}`);

  // Screenshot the bubble
  const ss = await tc("Page.captureScreenshot", { format: "png" });
  const ssPath = `${SCREENSHOTS}\\alicepro-${test.id}.png`;
  fs.writeFileSync(ssPath, Buffer.from(ss.data, "base64"));
  console.log("  screenshot:", ssPath);

  // For viz — done. For others — click & verify file
  let downloadOk = null;
  if (test.id !== "viz" && test.btnFilter && test.fileExt) {
    const before = new Set(fs.readdirSync(DOWNLOADS));
    await tc("Runtime.evaluate", {
      expression: `(()=>{const b=[...document.querySelectorAll('.bap-code-download')].find(x=>${test.btnFilter}.test(x.textContent||''));if(b){b.click();return 'clicked';}return 'no btn';})()`,
      returnByValue: true,
    });
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const files = fs.readdirSync(DOWNLOADS);
      const newFile = files.find(f => !before.has(f) && test.fileExt.test(f));
      if (newFile) {
        const stat = fs.statSync(DOWNLOADS + "\\" + newFile);
        downloadOk = { name: newFile, size: stat.size };
        console.log(`  ✓ DOWNLOADED: ${newFile} (${stat.size}b)`);
        break;
      }
    }
    if (!downloadOk) console.log("  ✗ no file");
  } else if (test.id === "viz") {
    downloadOk = { iframe: true, srcdocLen: detected.srcdocLen };
  }

  tw.close();
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const finalTab = tabs.find(x => x.id === newTab.targetId);
  return { ...test, ok: !!downloadOk, downloadOk, screenshot: ssPath, url: finalTab?.url };
}

const { ws: bw, call: bc } = await attachBrowser();
const results = [];
for (const t of TESTS) {
  results.push(await runOne(t, bc));
}
bw.close();

console.log("\n\n==================== ALICE PRO SUMMARY ====================");
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.id}`);
  if (r.downloadOk?.name) console.log(`    file: ${r.downloadOk.name} (${r.downloadOk.size}b)`);
  if (r.downloadOk?.iframe) console.log(`    iframe srcdoc ${r.downloadOk.srcdocLen}b`);
  if (r.url) console.log(`    tab: ${r.url}`);
  if (r.screenshot) console.log(`    screenshot: ${r.screenshot}`);
}
