// Test each tool-tag fence end-to-end: send prompt → check Alice obeys → check button works.

import fs from 'node:fs';

async function attach() {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const tab = tabs.find((x) => x.type === "page" && x.url.includes("alice.yandex.ru"));
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nid = 1;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Page.bringToFront");
  return { ws, call };
}

async function sendAndWait(call, prompt, expectedLang, maxWaitSec = 90) {
  // Clear + click new chat
  await call("Runtime.evaluate", {
    expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]'); if(b){b.click();return 'ok';} return 'no btn';})()`,
    returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 2500));

  // Set value + send via Enter
  await call("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea.AliceInput-Textarea') || document.querySelector('textarea');
      if (!t) return 'no textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus();
      setter.call(t, ${JSON.stringify(prompt)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 500));
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

  // Poll
  for (let i = 0; i < maxWaitSec; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await call("Runtime.evaluate", {
      expression: `(()=>{
        const b = [...document.querySelectorAll('[data-testid="message-bubble-container"]')].pop();
        if (!b) return null;
        const code = b.querySelector('pre code[class*="language-${expectedLang}"]') || b.querySelector('pre code[class*="language-"]');
        if (!code) return null;
        const content = code.textContent || '';
        if (content.length < 30) return null; // wait for streaming to complete
        return {lang: String(code.className).match(/language-([^\\s]+)/)?.[1] || '', content: content.slice(0, 2500)};
      })()`, returnByValue: true,
    });
    if (r.result?.value) return r.result.value;
  }
  return null;
}

async function clickDownloadAndVerify(call, btnFilter, fileNamePattern, mtimeAfter) {
  await call("Runtime.evaluate", {
    expression: `(()=>{
      const btns = [...document.querySelectorAll('.bap-code-download')];
      const btn = btns.find(b => ${btnFilter}.test(b.textContent || ''));
      if (!btn) return 'no btn';
      btn.click();
      return 'clicked: ' + btn.textContent;
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 8000));

  // Check Downloads
  const files = fs.readdirSync("/c/Users/LL5AI/Downloads".replace(/\//g, '\\\\')).filter(f => fileNamePattern.test(f));
  for (const f of files) {
    try {
      const stat = fs.statSync("/c/Users/LL5AI/Downloads".replace(/\//g, '\\\\') + "\\" + f);
      if (stat.mtime > mtimeAfter) return {name: f, size: stat.size};
    } catch {}
  }
  return null;
}

const { ws, call } = await attach();

// ── pptx ─────────────────────────────────────────────────────────
const TEST_START = new Date(Date.now() - 5000);
const results = [];

console.log("\n=== TEST 1: bap-pptx ===");
const pptxResp = await sendAndWait(call, "Сделай PowerPoint про погоду — 3 слайда. Используй формат bap-pptx с JSON.", "bap-pptx");
console.log("  Alice returned bap-pptx:", !!pptxResp);
if (pptxResp) {
  console.log("  lang:", pptxResp.lang);
  try { JSON.parse(pptxResp.content); console.log("  JSON parses ✓"); } catch (e) { console.log("  JSON parse FAILED:", e.message); }
  const file = await clickDownloadAndVerify(call, "/pptx/i", /\.pptx$/i, TEST_START);
  console.log("  downloaded file:", file ? `${file.name} (${file.size} bytes)` : "✗ no file");
  results.push({test: "pptx", responded: !!pptxResp, downloaded: !!file});
}

// ── excel ─────────────────────────────────────────────────────────
console.log("\n=== TEST 2: bap-excel ===");
const excelStart = new Date();
const excelResp = await sendAndWait(call, "Сделай Excel таблицу 'бюджет на месяц' с 5 категориями: еда, транспорт, развлечения, аренда, прочее. Колонки: категория, плановая сумма, фактическая. Используй формат bap-excel с JSON.", "bap-excel");
console.log("  Alice returned bap-excel:", !!excelResp);
if (excelResp) {
  try { JSON.parse(excelResp.content); console.log("  JSON parses ✓"); } catch (e) { console.log("  JSON parse FAILED:", e.message); }
  const file = await clickDownloadAndVerify(call, "/xlsx/i", /\.xlsx$/i, excelStart);
  console.log("  downloaded file:", file ? `${file.name} (${file.size} bytes)` : "✗ no file");
  results.push({test: "excel", responded: !!excelResp, downloaded: !!file});
}

// ── docx ─────────────────────────────────────────────────────────
console.log("\n=== TEST 3: bap-docx ===");
const docxStart = new Date();
const docxResp = await sendAndWait(call, "Сделай Word документ — резюме программиста: заголовок, имя, скиллы списком, опыт работы. Используй формат bap-docx с JSON.", "bap-docx");
console.log("  Alice returned bap-docx:", !!docxResp);
if (docxResp) {
  try { JSON.parse(docxResp.content); console.log("  JSON parses ✓"); } catch (e) { console.log("  JSON parse FAILED:", e.message); }
  const file = await clickDownloadAndVerify(call, "/docx/i", /\.docx$/i, docxStart);
  console.log("  downloaded file:", file ? `${file.name} (${file.size} bytes)` : "✗ no file");
  results.push({test: "docx", responded: !!docxResp, downloaded: !!file});
}

// ── visualizer ─────────────────────────────────────────────────────────
console.log("\n=== TEST 4: bap-visualizer ===");
const vizResp = await sendAndWait(call, "Нарисуй интерактивную схему атома водорода: ядро + один электрон на круговой орбите, анимируй вращение. Используй формат bap-visualizer.", "bap-visualizer");
console.log("  Alice returned bap-visualizer:", !!vizResp);
if (vizResp) {
  console.log("  has SVG:", /<svg/i.test(vizResp.content));
  // Check iframe got rendered
  await new Promise(r => setTimeout(r, 3000));
  const iframeCheck = await call("Runtime.evaluate", {
    expression: `(()=>{const wrappers = [...document.querySelectorAll('.bal-visualizer-wrapper, iframe[sandbox]')];return wrappers.length;})()`,
    returnByValue: true,
  });
  console.log("  visualizer iframe mounted:", iframeCheck.result?.value > 0);
  results.push({test: "visualizer", responded: !!vizResp, downloaded: "iframe-render"});
}

// ── filename ─────────────────────────────────────────────────────────
console.log("\n=== TEST 5: filename= ===");
const fileStart = new Date();
const fileResp = await sendAndWait(call, "Напиши hello world на Python в формате filename=hello-test.py чтобы я мог его скачать.", "filename=");
console.log("  Alice returned filename= block:", !!fileResp);
if (fileResp) {
  const file = await clickDownloadAndVerify(call, "/hello-test\\\\.py|\\\\.py/i", /hello.*\.py$/i, fileStart);
  console.log("  downloaded file:", file ? `${file.name} (${file.size} bytes)` : "✗ no file");
  results.push({test: "filename", responded: !!fileResp, downloaded: !!file});
}

console.log("\n\n=== SUMMARY ===");
for (const r of results) {
  console.log(`  ${r.responded && r.downloaded ? "✓" : "✗"} ${r.test}: responded=${r.responded}, downloaded=${r.downloaded}`);
}

ws.close();
process.exit(0);
