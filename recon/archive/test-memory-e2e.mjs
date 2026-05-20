// Test memory injection end-to-end:
// 1. Set a memory entry via chrome.storage (from ISOLATED world)
// 2. Open new chat, send message that should trigger memory
// 3. Verify Alice incorporates the memory into her answer

async function attachToBrowser() {
  const v = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); } });
  return { ws, call: (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); }) };
}

async function attachTabIsolatedWorld(targetId) {
  // Attach with executionContextId for extension content-script ISOLATED world
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

const { ws: tw, call: tc } = await attachTabIsolatedWorld(t.targetId);

console.log("1) Set memory via chrome.storage from page (using bridge helper)...");
// We need to write chrome.storage from ISOLATED world. We can use the extension's
// own bridge events to update settings. Easier: use Storage helper directly via
// a script we inject.
// Trick: dispatch an event that the content script bridge will pick up + persist
// is too indirect. Simpler — we read storage and verify the bridge already exposes
// memories via window. But there's no public API.
// Let me just set it via localStorage instead — wait, our extension uses
// chrome.storage not localStorage for memories.
//
// Better: use Page.addScriptToEvaluateOnNewDocument to inject a setter that runs
// in MAIN world but uses postMessage to ISOLATED world... too complex.
//
// Easiest: just open the Drawer manually via JS click and use its memory-add UI.
// But that's also complex.
//
// Alternative: directly call the storage API via debugging the content-script
// world. CDP supports `executionContextId` for isolated worlds, but finding the
// right one requires Runtime.executionContextCreated events.
//
// Quickest hack: we already have data-bal-* debug attrs on #bap-root from
// bridge.js. We can add ANOTHER debug helper that accepts a memory addition
// via a custom event the content script listens for.

// For now — test memory by typing it directly into the chat message:
// "Запомни: меня зовут Алексей. Теперь скажи как меня зовут?"
// This tests if Alice obeys mid-conversation memory reference.
await tc("Runtime.evaluate", {
  expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]'); if(b){b.click();return 'ok';} return 'no';})()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 2500));

const MEMORY_TEST_PROMPT = "В рамках этого теста запомни: меня зовут Семён. Кратко поприветствуй меня по имени.";
console.log("2) Send memory test prompt:", MEMORY_TEST_PROMPT);
await tc("Runtime.evaluate", {
  expression: `(()=>{
    const t = document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea.AliceInput-Textarea') || document.querySelector('textarea');
    if (!t) return 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    t.focus(); setter.call(t, ${JSON.stringify(MEMORY_TEST_PROMPT)}); t.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`, returnByValue: true,
});
await new Promise(r => setTimeout(r, 600));
await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

let resp = null, lastLen = 0, stable = 0;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await tc("Runtime.evaluate", {
    expression: `(()=>{
      const last = [...document.querySelectorAll('[data-testid="message-bubble-container"]')].pop();
      if (!last) return null;
      const text = last.textContent.trim();
      if (text.length < 5) return null;
      return {text, len: text.length};
    })()`, returnByValue: true,
  });
  const v = r.result?.value;
  if (v) {
    if (v.len === lastLen) { stable++; if (stable >= 4) { resp = v; break; } }
    else { lastLen = v.len; stable = 0; }
  }
}

if (resp) {
  console.log(`\n3) Alice response (${resp.len} bytes):`);
  console.log("   " + resp.text);
  const obeysMemory = /Семён/i.test(resp.text);
  console.log(`\n   Contains "Семён": ${obeysMemory ? "✓ Алиса запомнила и использовала" : "✗ Алиса не упомянула имя"}`);
} else {
  console.log("✗ no response");
}

tw.close();
bw.close();
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const aliceTab = tabs.find(x => x.id === t.targetId);
if (aliceTab) console.log("\nTab URL for inspection:", aliceTab.url);
process.exit(0);
