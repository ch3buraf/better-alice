// Read the captured log from window.__aliceRecon.

const urlSub = process.argv[2] || "alicepro";
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
if (!target) { console.error("no tab matches:", urlSub); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
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
await call("Runtime.enable");
const r = await call("Runtime.evaluate", { expression: "JSON.stringify(window.__aliceRecon?.log || 'no-hook')", returnByValue: true });
console.log(r.result?.value);
ws.close();
process.exit(0);
