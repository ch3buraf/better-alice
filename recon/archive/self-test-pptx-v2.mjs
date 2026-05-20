// Self-test v2: more diagnostics, no new-chat click (use existing chat)

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
console.log("=== self-test v2: alice.yandex.ru ===\n");
const { ws, call } = await attach(HOST);

console.log("0) Checking extension state...");
const state = await call("Runtime.evaluate", {
  expression: `({
    url: location.href,
    dialogId: location.pathname.split('/')[2],
    bootstrap: !!window.__bdsContentBootstrapped,
    netPatched: !!window.__betterAliceNetworkPatched,
    wsPatched: !!window.__betterAliceWsPatched,
    bdsRoot: !!document.getElementById('bap-root'),
    injectedChats: JSON.parse(localStorage.getItem('bap_injected_chats')||'[]'),
  })`,
  returnByValue: true,
});
console.log("  ", JSON.stringify(state.result?.value, null, 2));

const dialogId = state.result?.value?.dialogId;
console.log(`\n1) Clearing localStorage[bap_injected_chats] entry for '${dialogId}' to force re-injection...`);
await call("Runtime.evaluate", {
  expression: `(()=>{
    const arr = JSON.parse(localStorage.getItem('bap_injected_chats')||'[]');
    const id = location.pathname.split('/')[2];
    const next = arr.filter(x => x !== id);
    localStorage.setItem('bap_injected_chats', JSON.stringify(next));
    return next;
  })()`,
  returnByValue: true,
});

console.log("\n2) Setting up listener for bap:mutation-applied...");
await call("Runtime.evaluate", {
  expression: `(()=>{
    window.__balMutations = [];
    if (window.__balListener) window.removeEventListener('bap:mutation-applied', window.__balListener);
    window.__balListener = (ev) => {
      try { window.__balMutations.push(typeof ev.detail==='string'?JSON.parse(ev.detail):ev.detail); } catch(e){}
    };
    window.addEventListener('bap:mutation-applied', window.__balListener);
    return 'ok';
  })()`,
  returnByValue: true,
});

console.log("\n3) Sending message via type+click (Alice DOM)...");
const PROMPT = "Сделай PowerPoint презентацию на тему 'Hello World в программировании', 3 слайда: титульный, что такое hello world, и итоги. Используй формат ```bap-pptx как описано в инструкциях.";

await call("Runtime.evaluate", {
  expression: `(()=>{
    const t = document.querySelector('[data-testid="inputbase-textarea"]') ||
              document.querySelector('textarea.AliceInput-Textarea') ||
              document.querySelector('textarea');
    if (!t) return 'no textarea';
    t.focus(); t.value = '';
    t.dispatchEvent(new Event('input',{bubbles:true}));
    return 'focused: '+t.tagName;
  })()`,
  returnByValue: true,
});
await call("Input.insertText", { text: PROMPT });
await new Promise(r => setTimeout(r, 600));

const sendBtn = await call("Runtime.evaluate", {
  expression: `(()=>{
    const b = document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow') ||
              document.querySelector('button[aria-label="Отправить"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {x:r.x+r.width/2, y:r.y+r.height/2, classes:String(b.className).slice(0,80)};
  })()`,
  returnByValue: true,
});
console.log("  submit button:", JSON.stringify(sendBtn.result?.value));
if (!sendBtn.result?.value) {
  console.log("  ✗ no submit button found"); ws.close(); process.exit(1);
}
const { x, y } = sendBtn.result.value;
await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });

console.log("\n4) Polling for mutation event + DOM response (30s max)...");
let mutations = [];
let lastAssistantText = "";
const start = Date.now();
while (Date.now() - start < 30000) {
  const tick = await call("Runtime.evaluate", {
    expression: `(()=>{
      const muts = window.__balMutations || [];
      const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
      const last = bubbles[bubbles.length - 1];
      return {
        mutCount: muts.length,
        lastMutInjectedHead: muts[muts.length-1]?.injectedText?.slice(0, 300),
        lastBubbleText: last?.textContent?.trim().slice(0, 400),
      };
    })()`,
    returnByValue: true,
  });
  const v = tick.result?.value;
  if (v?.mutCount > mutations.length) {
    console.log(`  [+${Math.floor((Date.now()-start)/1000)}s] mutation #${v.mutCount} fired`);
    console.log("     injected head:", v.lastMutInjectedHead?.slice(0, 200));
    mutations.push({head: v.lastMutInjectedHead});
  }
  if (v?.lastBubbleText && v.lastBubbleText !== lastAssistantText) {
    lastAssistantText = v.lastBubbleText;
  }
  await new Promise(r => setTimeout(r, 1500));
}

console.log(`\n5) After 30s: ${mutations.length} mutations, response head:`);
console.log("  ", lastAssistantText.slice(0, 500));

console.log("\n6) Reading code blocks specifically...");
const codeBlocks = await call("Runtime.evaluate", {
  expression: `(()=>{
    const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
    const last = bubbles[bubbles.length - 1];
    if (!last) return [];
    return [...last.querySelectorAll('pre code, code')].map(el => ({
      tag: el.tagName,
      classes: String(el.className).slice(0,80),
      content: (el.textContent||'').slice(0, 1500),
      hasBdsButton: !!el.closest('pre')?.querySelector('.bap-code-download'),
    })).filter(b => b.content.length > 5);
  })()`,
  returnByValue: true,
});
const blocks = codeBlocks.result?.value || [];
console.log("  code blocks found:", blocks.length);
for (const b of blocks) {
  console.log("    classes:", b.classes, "hasBdsButton:", b.hasBdsButton);
  console.log("    content:");
  for (const line of String(b.content).split('\n').slice(0, 20)) console.log("      " + line);
  console.log("    ...");
}

ws.close();
process.exit(0);
