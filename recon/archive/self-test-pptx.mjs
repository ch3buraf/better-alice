// Self-test: open new chat on alice.yandex.ru via CDP, send pptx request,
// wait for response, verify Alice returned JSON in bap-pptx fence.

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

console.log("Step 1: clicking 'new chat' to ensure fresh chat with fresh system prompt injection...");
await call("Runtime.evaluate", {
  expression: `(()=>{
    const btn = document.querySelector('[data-testid="new-chat-button"]');
    if (btn) btn.click();
    return btn ? 'clicked' : 'no btn';
  })()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 2000));

console.log("Step 2: capturing dialog_id and verifying it's NOT yet injected...");
const stateBefore = await call("Runtime.evaluate", {
  expression: `(()=>{
    const id = location.pathname.split('/')[2];
    const injected = JSON.parse(localStorage.getItem('bap_injected_chats')||'[]');
    return {dialogId: id, alreadyInjected: injected.includes(id)};
  })()`,
  returnByValue: true,
});
console.log("  ", JSON.stringify(stateBefore.result?.value));

console.log("Step 3: registering listener for bap:mutation-applied so we'll see if injection fires...");
await call("Runtime.evaluate", {
  expression: `window.__balMutations = [];
    window.addEventListener('bap:mutation-applied', (ev) => {
      try { window.__balMutations.push(typeof ev.detail==='string'?JSON.parse(ev.detail):ev.detail); } catch{}
    });
    'listener installed'`,
  returnByValue: true,
});

console.log("Step 4: typing prompt and clicking send...");
const PROMPT = "Сделай PowerPoint презентацию на тему 'Hello World в программировании', 3 слайда: титульный, что такое hello world, и итоги. Используй формат ```bap-pptx как описано в инструкциях.";

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
await new Promise(r => setTimeout(r, 500));

const btnLookup = await call("Runtime.evaluate", {
  expression: `(()=>{
    const b = document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow') ||
              document.querySelector('button[aria-label="Отправить"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {x:r.x+r.width/2, y:r.y+r.height/2};
  })()`,
  returnByValue: true,
});
if (!btnLookup.result?.value) {
  console.log("  ✗ submit button not found"); ws.close(); process.exit(1);
}
const { x, y } = btnLookup.result.value;
await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });

console.log("Step 5: waiting 30s for response stream...");
await new Promise(r => setTimeout(r, 30000));

console.log("Step 6: checking if mutation event fired (injection happened)...");
const mutationsCheck = await call("Runtime.evaluate", {
  expression: `JSON.stringify((window.__balMutations||[]).map(m => ({host:m.host, conv:m.conversationId, userPromptHead:String(m.userPrompt||'').slice(0,60), injectedHead:String(m.injectedText||'').slice(0,300)})))`,
  returnByValue: true,
});
const mutations = JSON.parse(mutationsCheck.result?.value || "[]");
console.log("  mutations captured:", mutations.length);
for (const m of mutations) {
  console.log("   - conv:", m.conv, "user:", m.userPromptHead);
  console.log("     injected head:", m.injectedHead);
}

console.log("Step 7: reading Alice's response from DOM...");
const respCheck = await call("Runtime.evaluate", {
  expression: `(()=>{
    const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
    const last = bubbles[bubbles.length - 1];
    if (!last) return null;
    const text = last.textContent.trim();
    // Find first code-fence inside the bubble's code blocks
    const codeBlocks = [...last.querySelectorAll('pre code, code')].map(el => ({
      classes: String(el.className).slice(0, 80),
      content: el.textContent.trim().slice(0, 800),
    }));
    return {textHead: text.slice(0, 200), codeBlocks};
  })()`,
  returnByValue: true,
});
console.log("  response text head:", respCheck.result?.value?.textHead);
console.log("  code blocks:");
for (const cb of (respCheck.result?.value?.codeBlocks || [])) {
  console.log("    class:", cb.classes);
  console.log("    content:");
  for (const line of cb.content.split("\n")) console.log("      " + line);
}

ws.close();
process.exit(0);
