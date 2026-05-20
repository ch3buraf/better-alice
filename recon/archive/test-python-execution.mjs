// Test that clicking Run Python actually executes and shows output.

async function attachBrowser() {
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
  await call("Runtime.enable"); await call("Page.enable");
  return { ws, call };
}

const { ws: bw, call: bc } = await attachBrowser();
const t = await bc("Target.createTarget", { url: "https://alice.yandex.ru/", background: false });
console.log("opened tab", t.targetId);
await new Promise(r => setTimeout(r, 9000));
const { ws: tw, call: tc } = await attachTab(t.targetId);

await tc("Runtime.evaluate", { expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]'); if(b){b.click();return 'ok';} return 'no';})()`, returnByValue: true });
await new Promise(r => setTimeout(r, 2500));

const PROMPT = "Напиши на Python код который выводит print('hello from bds runner!') и вычисляет 2+2=. Используй обычный ```python блок без всяких bap-форматов.";
await tc("Runtime.evaluate", {
  expression: `(()=>{
    const t=document.querySelector('[data-testid="inputbase-textarea"]')||document.querySelector('textarea');
    const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    t.focus(); s.call(t,${JSON.stringify(PROMPT)}); t.dispatchEvent(new Event('input',{bubbles:true}));
    return 'ok';
  })()`, returnByValue: true,
});
await new Promise(r => setTimeout(r, 700));
await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

console.log("waiting for Python code response...");
let codeLen = 0, stable = 0;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await tc("Runtime.evaluate", {
    expression: `(()=>{const last=[...document.querySelectorAll('[data-testid="message-bubble-container"]')].pop();const code=last?.querySelector('pre code[class*="language-python"]');if(!code) return null;const len=(code.textContent||'').length;return {len};})()`,
    returnByValue: true,
  });
  const v = r.result?.value;
  if (v?.len) {
    if (v.len === codeLen) { stable++; if (stable >= 3) break; }
    else { codeLen = v.len; stable = 0; }
  }
}
console.log("Python code received, len:", codeLen);

console.log("clicking Run Python button...");
await tc("Runtime.evaluate", {
  expression: `(()=>{const btns=[...document.querySelectorAll('button.bap-run-btn, button')].filter(b=>/Run Python/i.test(b.textContent||''));if(btns[0]){btns[0].click();return 'clicked';}return 'no btn';})()`,
  returnByValue: true,
});

console.log("waiting for execution result (45s)...");
let runnerOutput = null;
for (let i = 0; i < 45; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await tc("Runtime.evaluate", {
    expression: `(()=>{
      const runners=[...document.querySelectorAll('.bap-code-runner-card')];
      if (!runners.length) return null;
      const last=runners[runners.length-1];
      const statusEl=last.querySelector('.bap-status-text');
      const outEl=last.querySelector('.bap-runner-output, .output, [class*="output"]');
      return {status: statusEl?.textContent, outputText: outEl?.textContent?.slice(0,500), fullCard: last.textContent.slice(-500)};
    })()`,
    returnByValue: true,
  });
  const v = r.result?.value;
  if (v?.status && /finished|готово|done|error/i.test(v.status)) {
    runnerOutput = v;
    break;
  }
  if (i % 5 === 0 && v) {
    console.log(`  [+${i+1}s] status: ${v.status}`);
  }
}

if (runnerOutput) {
  console.log("\n=== RESULT ===");
  console.log("status:", runnerOutput.status);
  console.log("output:", runnerOutput.outputText);
  console.log("card tail:", runnerOutput.fullCard);
  console.log("\nContains 'hello':", /hello/i.test(runnerOutput.fullCard || ""));
} else {
  console.log("\n✗ no completion in 45s");
}

tw.close();
bw.close();
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const finalTab = tabs.find(x => x.id === t.targetId);
if (finalTab) console.log("\nTab URL:", finalTab.url);
process.exit(0);
