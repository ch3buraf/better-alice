// Read full Alice response + click the bap-code-download button and verify file download.

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

// Enable download tracking
await call("Browser.setDownloadBehavior", {
  behavior: "allowAndName",
  downloadPath: "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\downloads",
});

const downloads = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Browser.downloadWillBegin" || m.method === "Browser.downloadProgress") {
    downloads.push({event: m.method, params: m.params});
  }
});

console.log("0) Read full Alice response from DOM...");
const fullResp = await call("Runtime.evaluate", {
  expression: `(()=>{
    const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
    const last = bubbles[bubbles.length - 1];
    if (!last) return null;
    const codeBlock = last.querySelector('pre code.language-bap-pptx, pre code[class*="bap-pptx"]');
    return {
      codeBlockContent: codeBlock?.textContent || null,
      hasDownloadBtn: !!last.querySelector('.bap-code-download'),
      btnText: last.querySelector('.bap-code-download')?.textContent,
    };
  })()`,
  returnByValue: true,
});
const r = fullResp.result?.value;
if (!r) { console.log("  ✗ no Alice bubble found"); process.exit(1); }

console.log("  Code block found:", !!r.codeBlockContent);
console.log("  Download button:", r.btnText);
console.log("\n=== Full JSON Alice returned ===");
console.log(r.codeBlockContent);

// Try parsing it to verify it's valid JSON
try {
  const parsed = JSON.parse(r.codeBlockContent);
  console.log("\n=== JSON parsed successfully ===");
  console.log("  fileName:", parsed.fileName);
  console.log("  slides:", parsed.slides?.length || 0);
  for (const s of (parsed.slides || []).slice(0, 5)) {
    console.log("    layout:", s.layout, " title:", s.title?.slice(0, 60));
  }
} catch (e) {
  console.log("\n  ⚠️ JSON parse failed:", e.message);
}

console.log("\n1) Clicking '📊 Скачать .pptx' button (programmatic .click on the actual DOM button)...");
const clickRes = await call("Runtime.evaluate", {
  expression: `(()=>{
    const btns = [...document.querySelectorAll('.bap-code-download')];
    const pptxBtn = btns.find(b => /pptx/i.test(b.textContent || ''));
    if (!pptxBtn) return 'no pptx button';
    pptxBtn.click();
    return 'clicked: ' + pptxBtn.textContent;
  })()`,
  returnByValue: true,
});
console.log("  ", clickRes.result?.value);

console.log("\n2) Waiting 8s for download to fire + checking button label change...");
await new Promise(r => setTimeout(r, 8000));

const btnStateAfter = await call("Runtime.evaluate", {
  expression: `(()=>{
    const btn = [...document.querySelectorAll('.bap-code-download')].find(b => /pptx|готово|ошибка|генерирую/i.test(b.textContent || ''));
    return {text: btn?.textContent, disabled: btn?.disabled};
  })()`,
  returnByValue: true,
});
console.log("  button state after click:", JSON.stringify(btnStateAfter.result?.value));

// Check if files appeared in download dir
import fs from 'node:fs';
const dlPath = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\downloads";
try {
  const files = fs.readdirSync(dlPath);
  const pptxFiles = files.filter(f => /\.pptx$/i.test(f));
  console.log(`\n3) Files in downloads dir: ${files.length} total, ${pptxFiles.length} .pptx`);
  for (const f of pptxFiles) {
    const stat = fs.statSync(dlPath + "\\" + f);
    console.log(`  ${f}  (${stat.size} bytes)`);
  }
} catch (e) {
  console.log("  no downloads dir or empty");
}

console.log("\n4) Captured downloads (CDP):", JSON.stringify(downloads, null, 2));

ws.close();
process.exit(0);
