// Screenshot any tab matching urlSub, save to screenshots/<name>.png
import fs from 'node:fs';
import path from 'node:path';

const urlSub = process.argv[2];
const outName = process.argv[3] || "screenshot.png";
if (!urlSub) { console.log("usage: <urlSub> <outName>"); process.exit(1); }

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const t = tabs.find((x) => x.url && x.url.includes(urlSub) && x.type === "page");
if (!t) { console.log("no tab matches", urlSub); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
const p = new Map(); let n = 1;
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }
});
const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

await call("Page.enable");
await call("Page.bringToFront");
await new Promise(r => setTimeout(r, 1200));
const ss = await call("Page.captureScreenshot", { format: "png" });
const dir = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots";
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, outName);
fs.writeFileSync(out, Buffer.from(ss.data, "base64"));
console.log("saved:", out, "size:", fs.statSync(out).size);
ws.close();
process.exit(0);
