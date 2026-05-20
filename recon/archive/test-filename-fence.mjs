// Test filename= code-fence in a new tab.

import fs from 'node:fs';
const DOWNLOADS = "C:\\Users\\LL5AI\\Downloads";

async function attachToBrowser() {
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

const { ws: bw, call: bc } = await attachToBrowser();
const t = await bc("Target.createTarget", { url: "https://alice.yandex.ru/", background: false });
console.log("opened tab", t.targetId);
await new Promise(r => setTimeout(r, 9000));
const { ws: tw, call: tc } = await attachTab(t.targetId);

await tc("Runtime.evaluate", { expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]'); if(b){b.click();return 'ok';} return 'no';})()`, returnByValue: true });
await new Promise(r => setTimeout(r, 2500));

const PROMPT = "Напиши скрипт hello-world на Python с тремя функциями (приветствие, простая арифметика, обработка списка) — оформи как ```filename=hello-world.py чтобы я мог скачать одним кликом.";
await tc("Runtime.evaluate", {
  expression: `(()=>{
    const t = document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea.AliceInput-Textarea') || document.querySelector('textarea');
    if (!t) return 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    t.focus(); setter.call(t, ${JSON.stringify(PROMPT)}); t.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`, returnByValue: true,
});
await new Promise(r => setTimeout(r, 600));
await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

// Poll
let resp = null;
let stable = 0, lastLen = 0;
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await tc("Runtime.evaluate", {
    expression: `(()=>{
      const last = [...document.querySelectorAll('[data-testid="message-bubble-container"]')].pop();
      if (!last) return null;
      const code = last.querySelector('pre code[class*="language-filename="]');
      if (!code) return null;
      return {lang: String(code.className).match(/language-([^\\s]+)/)?.[1], content: code.textContent || '', len: (code.textContent||'').length};
    })()`, returnByValue: true,
  });
  const v = r.result?.value;
  if (v) {
    if (v.len === lastLen) { stable++; if (stable >= 3) { resp = v; break; } }
    else { lastLen = v.len; stable = 0; }
  }
}

if (!resp) {
  console.log("✗ no filename= response");
} else {
  console.log(`✓ Alice returned ${resp.lang} block (${resp.len} bytes)`);
  console.log("  content head:", resp.content.slice(0, 200).replace(/\n/g, " | "));

  const before = new Set(fs.readdirSync(DOWNLOADS));
  console.log("  clicking ⬇ button...");
  await tc("Runtime.evaluate", {
    expression: `(()=>{const b=[...document.querySelectorAll('.bap-code-download')].find(x=>/hello|⬇/i.test(x.textContent||''));if(b){b.click();return 'clicked: '+b.textContent;}return 'no btn';})()`,
    returnByValue: true,
  });
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 800));
    const files = fs.readdirSync(DOWNLOADS);
    const newFile = files.find(f => !before.has(f) && /hello-world.*\.py$|hello.*\.py$/i.test(f));
    if (newFile) {
      const stat = fs.statSync(DOWNLOADS + "\\" + newFile);
      console.log(`  ✓ DOWNLOADED: ${newFile} (${stat.size} bytes)`);
      // Read first few lines
      const content = fs.readFileSync(DOWNLOADS + "\\" + newFile, "utf8").slice(0, 300);
      console.log("  file content head:");
      for (const line of content.split("\n").slice(0, 8)) console.log("    " + line);
      break;
    }
  }
}

tw.close();
bw.close();
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const aliceTab = tabs.find(x => x.id === t.targetId);
if (aliceTab) console.log("\nTab URL for visual inspection:", aliceTab.url);
process.exit(0);
