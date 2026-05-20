// Try native React-input setter trick.
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

const PROMPT = "Сделай PowerPoint на тему 'Hello World в программировании', 3 слайда (title, content с буллетами, summary). Используй ИМЕННО валидный JSON внутри блока ```bap-pptx как описано в инструкциях.";

console.log("Setting up listener + value via native setter...");
const setupRes = await call("Runtime.evaluate", {
  expression: `(()=>{
    if (!window.__balListener) {
      window.__balMutations = [];
      window.__balListener = (ev) => { try { window.__balMutations.push(typeof ev.detail==='string'?JSON.parse(ev.detail):ev.detail); } catch{} };
      window.addEventListener('bap:mutation-applied', window.__balListener);
    }

    // Clear localStorage entry for current chat
    const id = location.pathname.split('/')[2] || '__none__';
    const arr = JSON.parse(localStorage.getItem('bap_injected_chats')||'[]');
    localStorage.setItem('bap_injected_chats', JSON.stringify(arr.filter(x => x !== id)));

    const t = document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea.AliceInput-Textarea') || document.querySelector('textarea');
    if (!t) return 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    t.focus();
    setter.call(t, ${JSON.stringify(PROMPT)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      dialogId: id,
      valueLen: t.value.length,
    };
  })()`,
  returnByValue: true,
});
console.log("  ", JSON.stringify(setupRes.result?.value));

// Wait for React to update / button to enable
await new Promise(r => setTimeout(r, 800));

console.log("Clicking via real pointer events...");
const btn = await call("Runtime.evaluate", {
  expression: `(()=>{
    const b = document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow') ||
              document.querySelector('button[aria-label="Отправить"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {x:r.x+r.width/2, y:r.y+r.height/2};
  })()`, returnByValue: true,
});
if (btn.result?.value) {
  const { x, y } = btn.result.value;
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await new Promise(r => setTimeout(r, 50));
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await new Promise(r => setTimeout(r, 80));
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
}

console.log("Polling 40s...");
let lastMut = 0;
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const tick = await call("Runtime.evaluate", {
    expression: `(()=>{
      const m = (window.__balMutations||[]);
      const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
      return {mc: m.length, lastInj: m[m.length-1]?.injectedText?.slice(0,1500), bc: bubbles.length, lastBub: bubbles[bubbles.length-1]?.textContent?.slice(0,500)};
    })()`, returnByValue: true,
  });
  const v = tick.result?.value;
  if (v?.mc > lastMut) {
    console.log(`[+${i+1}s] mutation #${v.mc}, dialog state changed`);
    console.log("  injected:", (v.lastInj||"").slice(0, 600));
    lastMut = v.mc;
  }
  if (v?.bc > 0 && i % 5 === 0) {
    console.log(`[+${i+1}s] bubbles=${v.bc}, last: ${(v.lastBub||"").slice(0, 150)}...`);
  }
}

console.log("\n=== FINAL ===");
const final = await call("Runtime.evaluate", {
  expression: `(()=>{
    const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
    const last = bubbles[bubbles.length - 1];
    const code = last ? [...last.querySelectorAll('pre code')].map(el => ({
      lang: String(el.className).match(/language-([^\\s]+)/)?.[1] || '',
      content: el.textContent.slice(0, 1500)
    })) : [];
    return {bubbles: bubbles.length, codeBlocks: code};
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(final.result?.value, null, 2));
ws.close();
process.exit(0);
