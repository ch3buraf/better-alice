// v3: force-reload page, click new chat, install listener AFTER all that.

async function attach(urlSub) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.type === "page" && x.url.includes(urlSub));
  if (!t) throw new Error("no tab " + urlSub);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nid = 1;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable");
  await call("Page.enable").catch(() => {});
  await call("Page.bringToFront").catch(() => {});
  return { ws, call };
}

const HOST = "alice.yandex.ru";
const { ws, call } = await attach(HOST);

console.log("1) Hard refresh + wait 6s for Alice's SPA to mount...");
await call("Page.reload", { ignoreCache: true });
await new Promise(r => setTimeout(r, 6000));

console.log("2) Clicking 'new chat' (if button exists)...");
const newChatResult = await call("Runtime.evaluate", {
  expression: `(()=>{
    const btn = document.querySelector('[data-testid="new-chat-button"]');
    if (btn) { btn.click(); return 'clicked'; }
    return 'no btn (already at empty state?)';
  })()`,
  returnByValue: true,
});
console.log("  ", newChatResult.result?.value);
await new Promise(r => setTimeout(r, 3000));

console.log("3) Installing listener + clearing localStorage entry for current dialog...");
await call("Runtime.evaluate", {
  expression: `(()=>{
    const id = location.pathname.split('/')[2] || '__no_id__';
    const arr = JSON.parse(localStorage.getItem('bap_injected_chats')||'[]');
    localStorage.setItem('bap_injected_chats', JSON.stringify(arr.filter(x => x !== id)));
    window.__balMutations = [];
    if (window.__balListener) window.removeEventListener('bap:mutation-applied', window.__balListener);
    window.__balListener = (ev) => {
      try { window.__balMutations.push(typeof ev.detail==='string'?JSON.parse(ev.detail):ev.detail); } catch{}
    };
    window.addEventListener('bap:mutation-applied', window.__balListener);
    return {clearedFor: id, listenerInstalled: true};
  })()`,
  returnByValue: true,
});

console.log("4) Typing prompt...");
const PROMPT = "Сделай PowerPoint на тему 'Hello World в программировании', 3 слайда. Используй ИМЕННО формат ```bap-pptx с JSON внутри (НЕ YAML), как описано в инструкциях системы.";
await call("Runtime.evaluate", {
  expression: `(()=>{
    const t = document.querySelector('[data-testid="inputbase-textarea"]') ||
              document.querySelector('textarea.AliceInput-Textarea') ||
              document.querySelector('textarea');
    if (!t) return 'no textarea';
    t.focus(); t.value = '';
    t.dispatchEvent(new Event('input',{bubbles:true}));
    return 'focused';
  })()`,
  returnByValue: true,
});
await call("Input.insertText", { text: PROMPT });
await new Promise(r => setTimeout(r, 800));

console.log("5) Clicking submit (with pointer events as backup)...");
const btnPos = await call("Runtime.evaluate", {
  expression: `(()=>{
    const b = document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow') ||
              document.querySelector('button[aria-label="Отправить"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {x:r.x+r.width/2, y:r.y+r.height/2};
  })()`,
  returnByValue: true,
});
if (!btnPos.result?.value) { console.log("  ✗ no submit btn"); ws.close(); process.exit(1); }
const { x, y } = btnPos.result.value;

// Try mouseDown/Up first
await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
await new Promise(r => setTimeout(r, 50));
await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });

// Also try plain JS click as backup
await new Promise(r => setTimeout(r, 200));
await call("Runtime.evaluate", {
  expression: `(()=>{
    const b = document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow') ||
              document.querySelector('button[aria-label="Отправить"]');
    if (b) { b.click(); return 'clicked-js'; }
    return 'no btn for js-click';
  })()`,
  returnByValue: true,
});

console.log("6) Polling for 45s...");
let mutShown = 0;
let lastText = "";
const start = Date.now();
while (Date.now() - start < 45000) {
  const tick = await call("Runtime.evaluate", {
    expression: `(()=>{
      const muts = window.__balMutations || [];
      const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
      const last = bubbles[bubbles.length - 1];
      return {
        mutCount: muts.length,
        lastInject: muts[muts.length-1]?.injectedText?.slice(0, 1500),
        lastBubbleText: last?.textContent?.slice(0, 400),
      };
    })()`,
    returnByValue: true,
  });
  const v = tick.result?.value;
  if (v?.mutCount > mutShown) {
    console.log(`  [+${Math.floor((Date.now()-start)/1000)}s] mutation #${v.mutCount}:`);
    console.log("     " + (v.lastInject || "").slice(0, 400));
    mutShown = v.mutCount;
  }
  if (v?.lastBubbleText && v.lastBubbleText !== lastText) {
    lastText = v.lastBubbleText;
  }
  await new Promise(r => setTimeout(r, 1500));
}

console.log("\n=== FINAL ===");
console.log("mutations:", mutShown);
console.log("\nLast assistant bubble text:");
console.log(lastText);

console.log("\nCode blocks in last bubble:");
const codeBlocks = await call("Runtime.evaluate", {
  expression: `(()=>{
    const b = [...document.querySelectorAll('[data-testid="message-bubble-container"]')].pop();
    if (!b) return [];
    return [...b.querySelectorAll('pre code, code')].filter(el => (el.textContent||'').length > 5)
      .map(el => ({
        lang: String(el.className).match(/language-([^\\s]+)/)?.[1] || '',
        contentHead: el.textContent.slice(0, 800)
      }));
  })()`,
  returnByValue: true,
});
for (const cb of (codeBlocks.result?.value || [])) {
  console.log("  lang:", cb.lang);
  for (const line of cb.contentHead.split('\n')) console.log("    " + line);
}

ws.close();
process.exit(0);
