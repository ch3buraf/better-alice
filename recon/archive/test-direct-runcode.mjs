// Direct RUN_CODE postMessage test
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const t = tabs.find((x) => x.type === "page" && x.url.includes("alice.yandex.ru/chat/"));
if (!t) { console.log("no chat tab"); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
const p = new Map(); let n = 1;
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); } });
const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await call("Runtime.enable");

const r = await call("Runtime.evaluate", {
  expression: `(async () => {
    const cards = [...document.querySelectorAll('.bap-code-runner-card')];
    const iframe = cards[cards.length - 1]?.querySelector('iframe');
    if (!iframe) return { error: 'no iframe' };
    const seen = [];
    const handler = (ev) => seen.push({ type: ev.data?.type, payload: JSON.stringify(ev.data).slice(0, 400) });
    window.addEventListener('message', handler);
    iframe.contentWindow.postMessage({
      type: 'RUN_CODE',
      code: "print('hello world test')",
      language: 'python',
      id: 'direct-test'
    }, '*');
    await new Promise(r => setTimeout(r, 20000));
    window.removeEventListener('message', handler);
    return { seenCount: seen.length, seen };
  })()`,
  returnByValue: true,
  awaitPromise: true,
});

console.log(JSON.stringify(r.result?.value, null, 2));
ws.close();
process.exit(0);
