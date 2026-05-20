// Install in-page hook on the Alice tab that intercepts WebSocket and fetch,
// storing all relevant frames in window.__aliceRecon.

const urlSub = process.argv[2] || "alicepro";
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
if (!target) { console.error("no tab matches:", urlSub); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(m.error) : p.res(m.result);
  }
});
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}

const hookSrc = `(()=>{
  if (window.__aliceRecon) return 'already-installed';
  const log = [];
  window.__aliceRecon = { log, ts: Date.now() };

  // WebSocket hook
  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function(data) {
    try {
      const sample = typeof data === 'string' ? data.slice(0, 4000) : '[binary len='+ (data.byteLength||data.size||'?') +']';
      if (!sample.includes('"ping"')) {
        log.push({ kind: 'ws-out', url: this.url, t: Date.now(), data: sample });
      }
    } catch(e) {}
    return origSend.apply(this, arguments);
  };

  // intercept WebSocket constructor to wrap onmessage
  const OrigWS = window.WebSocket;
  function PatchedWS(...args) {
    const inst = new OrigWS(...args);
    log.push({ kind: 'ws-open', url: args[0], t: Date.now() });
    inst.addEventListener('message', (ev) => {
      try {
        const sample = typeof ev.data === 'string' ? ev.data.slice(0, 4000) : '[binary len='+ (ev.data?.byteLength||ev.data?.size||'?') +']';
        if (!sample.includes('"pong"')) {
          log.push({ kind: 'ws-in', url: inst.url, t: Date.now(), data: sample });
        }
      } catch(e) {}
    });
    return inst;
  }
  PatchedWS.prototype = OrigWS.prototype;
  PatchedWS.CONNECTING = OrigWS.CONNECTING; PatchedWS.OPEN = OrigWS.OPEN;
  PatchedWS.CLOSING = OrigWS.CLOSING; PatchedWS.CLOSED = OrigWS.CLOSED;
  window.WebSocket = PatchedWS;

  // fetch hook
  const origFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    let postPreview = null;
    try {
      if (init && typeof init.body === 'string') postPreview = init.body.slice(0, 4000);
      else if (init && init.body instanceof FormData) {
        const pairs = []; for (const [k,v] of init.body.entries()) pairs.push(k+'='+(typeof v === 'string' ? v.slice(0,200) : '[blob]'));
        postPreview = '[FormData] '+ pairs.join('&').slice(0, 4000);
      }
    } catch(e){}
    const startedAt = Date.now();
    const resp = await origFetch.apply(this, arguments);
    const clone = resp.clone();
    let bodyPreview = null;
    try {
      const ct = clone.headers.get('content-type') || '';
      if (ct.includes('json') || ct.includes('text') || ct.includes('event-stream')) {
        const text = await clone.text();
        bodyPreview = text.slice(0, 6000);
      }
    } catch(e){}
    if (url && url.includes('alicepro') && !url.match(/\\.(png|jpg|svg|css|woff2?|ico)/)) {
      log.push({ kind: 'fetch', url, method: init?.method || 'GET', postPreview, status: resp.status, body: bodyPreview, t: startedAt });
    }
    return resp;
  };

  return 'installed';
})()`;

await call("Runtime.enable");
const r = await call("Runtime.evaluate", { expression: hookSrc, returnByValue: true });
console.log("Hook install result:", r.result?.value);
ws.close();
process.exit(0);
