// Find a tab by targetId, click .bap-code-download matching filter, screenshot
import fs from 'node:fs';

const targetId = process.argv[2];
const btnFilter = new RegExp(process.argv[3] || ".", "i");
const ssName = process.argv[4] || "screenshot.png";

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const t = tabs.find((x) => x.id === targetId);
if (!t) { console.log("no tab"); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
const p = new Map(); let n = 1;
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }});
const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

await call("Runtime.enable"); await call("Page.enable"); await call("Page.bringToFront");
await new Promise(r => setTimeout(r, 1000));

// Dismiss modal if any
await call("Runtime.evaluate", {
  expression: `(()=>{const x=document.querySelector('.bap-close-btn');if(x)x.click();return 'ok';})()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 1000));

// Inspect buttons
const inspect = await call("Runtime.evaluate", {
  expression: `(()=>{const btns=[...document.querySelectorAll('.bap-code-download')];return btns.map(b=>b.textContent);})()`,
  returnByValue: true,
});
console.log("buttons:", inspect.result?.value);

// Screenshot before click
const ss1 = await call("Page.captureScreenshot", { format: "png" });
const ssDir = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots";
fs.mkdirSync(ssDir, { recursive: true });
fs.writeFileSync(`${ssDir}\\${ssName}`, Buffer.from(ss1.data, "base64"));
console.log("saved before-click:", ssName);

// Click
const clickRes = await call("Runtime.evaluate", {
  expression: `(()=>{const b=[...document.querySelectorAll('.bap-code-download')].find(x=>${btnFilter.toString()}.test(x.textContent||''));if(b){b.click();return 'clicked: '+b.textContent;}return 'no match';})()`,
  returnByValue: true,
});
console.log(clickRes.result?.value);

ws.close();
process.exit(0);
