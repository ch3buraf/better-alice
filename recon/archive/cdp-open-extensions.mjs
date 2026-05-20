// Use Target.createTarget to open chrome://extensions/ properly

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const wsUrl = tabs[0]?.webSocketDebuggerUrl;
if (!wsUrl) { console.error("no tab"); process.exit(1); }

// Browser-level WS endpoint:
const verRes = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
const browserWs = verRes.webSocketDebuggerUrl;

const ws = new WebSocket(browserWs);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
const pending = new Map(); let nextId = 1;
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
});
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}

const created = await call("Target.createTarget", { url: "chrome://extensions/" });
console.log("Created target:", JSON.stringify(created));
ws.close();
