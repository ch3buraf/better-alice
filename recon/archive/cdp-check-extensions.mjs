// Open chrome://extensions tab and read its content (limited but informative)

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());

// Try to create a new tab pointing to chrome://extensions/
const newTab = await fetch("http://127.0.0.1:9222/json/new?chrome://extensions/").then((r) => r.json()).catch((e) => ({ error: String(e) }));
console.log("New tab result:", JSON.stringify(newTab, null, 2));

// Wait a bit
await new Promise((r) => setTimeout(r, 2000));

// Re-list tabs
const tabs2 = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const ext = tabs2.find((t) => t.url?.includes("chrome://extensions"));
if (!ext) {
  console.log("No extensions tab. All tabs:");
  console.log(tabs2.map((t) => `${t.type} ${t.url}`).join("\n"));
  process.exit(0);
}

// Attach and evaluate
const ws = new WebSocket(ext.webSocketDebuggerUrl);
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
const r = await call("Runtime.evaluate", {
  expression: `(async()=>{
    const ext = document.querySelector('extensions-manager');
    if (!ext) return 'no extensions-manager';
    const items = ext.shadowRoot?.querySelector('extensions-item-list');
    if (!items) return 'no item-list';
    const cards = items.shadowRoot?.querySelectorAll('extensions-item');
    if (!cards || !cards.length) return 'no extension cards';
    return [...cards].map(c => {
      const name = c.shadowRoot?.querySelector('#name')?.textContent;
      const desc = c.shadowRoot?.querySelector('#description')?.textContent;
      const errors = c.shadowRoot?.querySelector('#errors-button')?.textContent;
      return {name, desc, errors};
    });
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log("Extensions:", JSON.stringify(r.result?.value || r.result, null, 2));
ws.close();
process.exit(0);
