// Autonomous Alice Pro test for all features.
// - Open fresh tab per test
// - Send via form.requestSubmit (since Enter doesn't work)
// - Wait for streaming to complete
// - Click action button if any
// - Verify download / iframe / button presence
// - Screenshot

import fs from 'node:fs';
const DOWNLOADS = "C:\\Users\\LL5AI\\Downloads";
const SS_DIR = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots";
fs.mkdirSync(SS_DIR, { recursive: true });

const TESTS = [
  { id: "pptx",  prompt: "Сделай PowerPoint про четыре времени года — 4 слайда, по слайду на каждое время года. Используй формат bap-pptx с JSON.", expect: /pptx/i, fileExt: /\.pptx$/i },
  { id: "excel", prompt: "Сделай Excel-таблицу 'цены на овощи' с 5 строками: помидоры, огурцы, картофель, морковь, лук. Колонки: товар, цена. Используй формат bap-excel с JSON.", expect: /xlsx/i, fileExt: /\.xlsx$/i },
  { id: "docx",  prompt: "Сделай Word-документ — короткий доклад о пользе зарядки утром: 3-4 абзаца текста. Используй формат bap-docx с JSON.", expect: /docx/i, fileExt: /\.docx$/i },
  { id: "viz",   prompt: "Нарисуй интерактивную SVG-схему: три цветных круга (красный, синий, зелёный) подряд горизонтально, с подписями R/G/B. Используй формат bap-visualizer.", expect: null, fileExt: null },
];

async function attachBrowser() {
  const v = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }});
  return { ws, call: (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); }) };
}

async function attachTab(id) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.id === id);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }});
  const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable"); await call("Page.enable");
  return { ws, call };
}

async function dismissWhatsNew(tc) {
  await tc("Runtime.evaluate", { expression: `(()=>{const x=document.querySelector('.bap-close-btn');if(x){x.click();return 'closed';}return 'none';})()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 500));
}

async function runTest(test, bc) {
  console.log(`\n=== [${test.id}] on Alice Pro ===`);
  const newTab = await bc("Target.createTarget", { url: "https://alicepro.yandex.ru/expert", background: false });
  await new Promise(r => setTimeout(r, 10000));
  const { ws: tw, call: tc } = await attachTab(newTab.targetId);
  await dismissWhatsNew(tc);

  // Type + form.requestSubmit (Alice Pro requires form submit, Enter doesn't fire)
  console.log("  typing + requestSubmit...");
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea');
      if (!t) return 'no textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus(); setter.call(t, ${JSON.stringify(test.prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 700));
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const form = document.querySelector('#message-form');
      if (!form) return 'no form';
      const btn = form.querySelector('button.submit') || form.querySelector('button[type="submit"]');
      if (form.requestSubmit && btn) { form.requestSubmit(btn); return 'requestSubmit'; }
      if (form.requestSubmit) { form.requestSubmit(); return 'requestSubmit-noBtn'; }
      if (btn) { btn.click(); return 'btnClick'; }
      return 'no submit';
    })()`, returnByValue: true,
  });

  // Wait for code block / iframe to appear and stabilize
  console.log("  waiting for response...");
  let lastLen = 0, stable = 0, gotIt = false;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{
        if ('${test.id}' === 'viz') {
          const w = [...document.querySelectorAll('.bap-visualizer-wrapper iframe')];
          if (w[0]) return {kind: 'viz', srcdocLen: w[0].getAttribute('srcdoc')?.length || 0};
          return null;
        }
        const btns = [...document.querySelectorAll('.bap-code-download')];
        const exp = ${test.expect ? test.expect.toString() : 'null'};
        const targetBtn = exp ? btns.find(b => exp.test(b.textContent || '')) : btns[btns.length-1];
        const code = [...document.querySelectorAll('pre code')].pop();
        const len = code ? (code.textContent || '').length : 0;
        return targetBtn ? {kind: 'btn', btnText: targetBtn.textContent, codeLen: len} : null;
      })()`, returnByValue: true,
    });
    const v = r.result?.value;
    if (v) {
      const cur = v.srcdocLen || v.codeLen || 0;
      if (cur === lastLen && cur > 30) {
        stable++;
        if (stable >= 3) { gotIt = v; break; }
      } else {
        lastLen = cur;
        stable = 0;
      }
    }
  }

  if (!gotIt) {
    console.log("  ✗ timeout — no button/iframe in 120s");
    const dump = await tc("Runtime.evaluate", {
      expression: `(()=>{
        const codes = [...document.querySelectorAll('pre code')];
        return codes.map(c => ({lang: String(c.className).match(/language-([^\\s]+)/)?.[1], len: (c.textContent||'').length, head: c.textContent.slice(0,100)}));
      })()`, returnByValue: true,
    });
    console.log("  code blocks present:", JSON.stringify(dump.result?.value));
    tw.close();
    return { ...test, ok: false, targetId: newTab.targetId };
  }
  console.log(`  ✓ ${gotIt.kind}:`, gotIt.btnText || `srcdoc=${gotIt.srcdocLen}`);

  // Screenshot
  const ss = await tc("Page.captureScreenshot", { format: "png" });
  const ssPath = `${SS_DIR}\\alicepro-auto-${test.id}.png`;
  fs.writeFileSync(ssPath, Buffer.from(ss.data, "base64"));
  console.log("  screenshot:", ssPath);

  // For file tests — click and verify
  let downloadOk = null;
  if (test.id !== "viz" && test.fileExt) {
    const before = new Set(fs.readdirSync(DOWNLOADS));
    await tc("Runtime.evaluate", {
      expression: `(()=>{const b=[...document.querySelectorAll('.bap-code-download')].find(x=>${test.expect.toString()}.test(x.textContent||''));if(b){b.click();return 'clicked';}return 'no btn';})()`,
      returnByValue: true,
    });
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const files = fs.readdirSync(DOWNLOADS);
      const newFile = files.find(f => !before.has(f) && test.fileExt.test(f));
      if (newFile) {
        const stat = fs.statSync(DOWNLOADS + "\\" + newFile);
        downloadOk = { name: newFile, size: stat.size };
        console.log(`  ✓ FILE: ${newFile} (${stat.size}b)`);
        break;
      }
    }
    if (!downloadOk) console.log("  ✗ no file");
  } else if (test.id === "viz") {
    downloadOk = { iframe: true, srcdocLen: gotIt.srcdocLen };
  }

  tw.close();
  return { ...test, ok: !!downloadOk, downloadOk, screenshot: ssPath, targetId: newTab.targetId };
}

const { ws: bw, call: bc } = await attachBrowser();
const results = [];
for (const t of TESTS) {
  results.push(await runTest(t, bc));
}
bw.close();

console.log("\n========== ALICE PRO AUTO TEST FINAL ==========");
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.id}: ${r.downloadOk?.name || r.downloadOk?.iframe ? "iframe-OK" : "no file"}`);
  if (r.screenshot) console.log(`    screenshot: ${r.screenshot}`);
}
