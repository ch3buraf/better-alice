// Try plain Enter (no modifiers) as submit. Standard Yandex/Telegram-like chat UI.

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
await call("Page.bringToFront");

console.log("0) Hard refresh + 7s wait...");
await call("Page.reload", { ignoreCache: true });
await new Promise(r => setTimeout(r, 7000));

console.log("1) Click new-chat...");
await call("Runtime.evaluate", {
  expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]');if(b){b.click();return 'ok';}return 'no btn';})()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 2500));

console.log("2) Set textarea value via native setter + listener...");
const PROMPT = "Сделай PowerPoint про \"Что такое программирование\" — 3 слайда: титульный, основные понятия, итоги. Используй формат bap-pptx с JSON внутри как указано в инструкциях.";
await call("Runtime.evaluate", {
  expression: `(()=>{
    window.__bal_mutations = [];
    if (window.__bal_listener) window.removeEventListener('bap:mutation-applied', window.__bal_listener);
    window.__bal_listener = (ev) => { try { window.__bal_mutations.push(typeof ev.detail==='string'?JSON.parse(ev.detail):ev.detail); } catch{} };
    window.addEventListener('bap:mutation-applied', window.__bal_listener);

    const t = document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea.AliceInput-Textarea') || document.querySelector('textarea');
    if (!t) return 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    t.focus();
    setter.call(t, ${JSON.stringify(PROMPT)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok len=' + t.value.length;
  })()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 600));

console.log("3) Press plain Enter...");
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await new Promise(r => setTimeout(r, 50));
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

console.log("4) Poll 60s for mutation + DOM update...");
let mutShown = 0;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const tick = await call("Runtime.evaluate", {
    expression: `(()=>{
      const muts = window.__bal_mutations || [];
      const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
      const last = bubbles[bubbles.length - 1];
      const code = last ? [...last.querySelectorAll('pre code, code')].filter(el => (el.textContent||'').length > 10).map(el => ({lang: String(el.className).match(/language-([^\\s]+)/)?.[1] || '', content: el.textContent.slice(0, 1500)})) : [];
      return {mc: muts.length, bc: bubbles.length, lastBubText: last?.textContent?.slice(0, 600), codeBlocks: code, url: location.pathname};
    })()`,
    returnByValue: true,
  });
  const v = tick.result?.value;
  if (v?.mc > mutShown) {
    console.log(`  [+${i+1}s] mutation #${v.mc} fired, url=${v.url}`);
    mutShown = v.mc;
  }
  if (v?.codeBlocks?.length && v.codeBlocks[0].content.length > 100) {
    console.log(`  [+${i+1}s] FINAL — code block detected`);
    console.log("  url:", v.url);
    console.log("  bubble text head:", v.lastBubText?.slice(0, 300));
    console.log("  code block lang:", v.codeBlocks[0].lang);
    console.log("  code block content:");
    for (const line of v.codeBlocks[0].content.split("\n").slice(0, 30)) console.log("    " + line);
    break;
  }
  if (i === 59) {
    console.log(`  ✗ timeout. final state: bubbles=${v?.bc}, url=${v?.url}, lastText: ${v?.lastBubText?.slice(0, 200)}`);
  }
}

ws.close();
process.exit(0);
