// Check state of all 4 test tabs + retry failed (pptx + visualizer).

import fs from 'node:fs';

async function attach(targetId) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.id === targetId) || tabs.find((x) => x.type === "page" && x.url.includes("alice.yandex.ru"));
  if (!t) throw new Error("no target");
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
  return { ws, call, url: t.url, targetId: t.id };
}

// Check visualizer tab
console.log("=== Check visualizer tab ===");
const tabs1 = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const vizTab = tabs1.find(t => t.url.includes("019e4162-9625"));
if (vizTab) {
  const { ws, call } = await attach(vizTab.id);
  const r = await call("Runtime.evaluate", {
    expression: `(()=>{
      const wrappers = [...document.querySelectorAll('.bap-visualizer-wrapper')];
      const iframes = [...document.querySelectorAll('.bap-visualizer-wrapper iframe')];
      return {
        wrapperCount: wrappers.length,
        iframeCount: iframes.length,
        firstIframeSrcdocLen: iframes[0]?.getAttribute('srcdoc')?.length || 0,
      };
    })()`,
    returnByValue: true,
  });
  console.log("  visualizer state:", JSON.stringify(r.result?.value));
  ws.close();
}

// Retry pptx in a NEW tab
console.log("\n=== Retry pptx in new tab ===");
const browserVer = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
const bWs = new WebSocket(browserVer.webSocketDebuggerUrl);
await new Promise((res, rej) => { bWs.addEventListener("open", res, { once: true }); bWs.addEventListener("error", rej, { once: true }); });
const bp = new Map(); let bnid = 1;
bWs.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && bp.has(m.id)) { const p = bp.get(m.id); bp.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
});
const bCall = (method, params = {}) => new Promise((res, rej) => { const id = bnid++; bp.set(id, { res, rej }); bWs.send(JSON.stringify({ id, method, params })); });

const newPptxTab = await bCall("Target.createTarget", { url: "https://alice.yandex.ru/", background: false });
console.log("  opened tab:", newPptxTab.targetId);
await new Promise(r => setTimeout(r, 9000));

const { ws: pWs, call: pCall } = await attach(newPptxTab.targetId);

console.log("  click new-chat...");
await pCall("Runtime.evaluate", {
  expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]'); if(b){b.click();return 'ok';} return 'no btn';})()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 3000));

const PROMPT = "Сделай PowerPoint про погоду — 3 слайда: титульный, типы погоды буллетами, итоги. Используй формат bap-pptx с JSON как указано в инструкциях системы.";
console.log("  send prompt...");
await pCall("Runtime.evaluate", {
  expression: `(()=>{
    const t = document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea.AliceInput-Textarea') || document.querySelector('textarea');
    if (!t) return 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    t.focus();
    setter.call(t, ${JSON.stringify(PROMPT)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`, returnByValue: true,
});
await new Promise(r => setTimeout(r, 800));
await pCall("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await pCall("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

console.log("  wait for response (up to 120s)...");
let lastLen = 0;
let stable = 0;
let resp = null;
for (let i = 0; i < 120; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await pCall("Runtime.evaluate", {
    expression: `(()=>{
      const last = [...document.querySelectorAll('[data-testid="message-bubble-container"]')].pop();
      if (!last) return null;
      const code = last.querySelector('pre code[class*="language-bap-pptx"]');
      if (!code) return {pending: true, bubbleText: last.textContent?.slice(0,200)};
      return {content: code.textContent || '', len: (code.textContent||'').length};
    })()`, returnByValue: true,
  });
  const v = r.result?.value;
  if (v?.content) {
    if (v.len === lastLen) { stable++; if (stable >= 3) { resp = v; break; } }
    else { lastLen = v.len; stable = 0; }
  } else if (i % 10 === 0) {
    console.log(`    [+${i+1}s] pending... bubble text: ${(v?.bubbleText||'').slice(0,100)}`);
  }
}

if (!resp) {
  console.log("  ✗ still no response after 120s");
} else {
  console.log(`  ✓ pptx response (${resp.len} bytes)`);
  try { JSON.parse(resp.content); console.log("  ✓ JSON valid"); } catch (e) { console.log("  ✗ JSON invalid:", e.message); }

  const before = new Set(fs.readdirSync("C:\\Users\\LL5AI\\Downloads"));
  console.log("  clicking download...");
  await pCall("Runtime.evaluate", {
    expression: `(()=>{const b=[...document.querySelectorAll('.bap-code-download')].find(x=>/pptx/i.test(x.textContent||''));if(b){b.click();return 'clicked';}return 'no btn';})()`,
    returnByValue: true,
  });
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const files = fs.readdirSync("C:\\Users\\LL5AI\\Downloads");
    const newFile = files.find(f => !before.has(f) && /\.pptx$/i.test(f));
    if (newFile) {
      console.log(`  ✓ DOWNLOADED: ${newFile}`);
      break;
    }
  }
}

pWs.close();
bWs.close();

console.log("\n=== ALL 4 TABS NOW OPEN ===");
const finalTabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const aliceTabs = finalTabs.filter(t => t.type === "page" && t.url.includes("alice.yandex.ru") && t.url.includes("/chat/"));
for (const t of aliceTabs) {
  console.log(`  ${t.url}  — ${t.title}`);
}
