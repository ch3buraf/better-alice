// Test Python Run button injection on Alice's code blocks.

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

await tc("Runtime.evaluate", {
  expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]'); if(b){b.click();return 'ok';} return 'no';})()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 2500));

const PROMPT = "Напиши на Python функцию которая вычисляет факториал рекурсивно, и пример её вызова для n=5,10. Используй обычный ```python блок.";
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

let buttons = null;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await tc("Runtime.evaluate", {
    expression: `(()=>{
      const last = [...document.querySelectorAll('[data-testid="message-bubble-container"]')].pop();
      if (!last) return null;
      const pyCode = last.querySelector('pre code[class*="language-python"]');
      if (!pyCode) return null;
      const codeLen = (pyCode.textContent || '').length;
      if (codeLen < 30) return null;
      const pre = pyCode.closest('pre');
      const runBtns = [...(pre?.parentElement?.querySelectorAll('.bap-run-btn, [class*="bap-run"], button')||[])].map(b => b.textContent?.trim().slice(0, 40));
      const downloadBtn = pre?.querySelector('.bap-code-download');
      return {codeLen, runBtns: runBtns.filter(t => /run|запус|выполн/i.test(t || '')), downloadBtnText: downloadBtn?.textContent};
    })()`, returnByValue: true,
  });
  const v = r.result?.value;
  if (v?.codeLen > 100) {
    buttons = v;
    if (v.runBtns?.length) break;
  }
}

if (buttons) {
  console.log("Python code received, length:", buttons.codeLen);
  console.log("Run-like buttons:", buttons.runBtns);
  console.log("Download button:", buttons.downloadBtnText);
} else {
  console.log("✗ no python code block found");
}

tw.close();
bw.close();
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const aliceTab = tabs.find(x => x.id === t.targetId);
if (aliceTab) console.log("\nTab URL:", aliceTab.url);
process.exit(0);
