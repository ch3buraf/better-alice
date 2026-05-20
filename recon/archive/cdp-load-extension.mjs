// Enable dev mode in chrome://extensions and inspect installed extensions.
// Cannot programmatically click "Load unpacked" (it opens an OS dialog),
// but we can toggle dev mode, check for our extension, and report errors.

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const target = tabs.find((t) => t.url?.includes("chrome://extensions"));
if (!target) { console.error("no extensions tab"); process.exit(1); }

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

// Step 1: Enable dev mode toggle and check what's there
const r = await call("Runtime.evaluate", {
  expression: `(async () => {
    const out = {};
    const mgr = document.querySelector('extensions-manager');
    if (!mgr) return 'no extensions-manager';
    const toolbar = mgr.shadowRoot.querySelector('extensions-toolbar');
    out.toolbarFound = !!toolbar;
    if (toolbar) {
      const devToggle = toolbar.shadowRoot.querySelector('#devMode');
      out.devToggleFound = !!devToggle;
      out.devModeWas = devToggle?.checked;
      if (devToggle && !devToggle.checked) {
        devToggle.click();
        await new Promise(r => setTimeout(r, 500));
      }
      out.devModeNow = devToggle?.checked;
      const loadBtn = toolbar.shadowRoot.querySelector('#load-unpacked');
      out.loadBtnVisible = loadBtn ? !loadBtn.hidden : false;
    }
    return out;
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log("Dev mode check:", JSON.stringify(r.result?.value, null, 2));

// Step 2: Try chrome.developerPrivate.loadDirectory API directly
// (available only on chrome://extensions/ pages)
const r2 = await call("Runtime.evaluate", {
  expression: `(async () => {
    if (typeof chrome === 'undefined' || !chrome.developerPrivate) return 'no developerPrivate api';
    const apis = Object.keys(chrome.developerPrivate);
    return apis;
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log("developerPrivate APIs:", JSON.stringify(r2.result?.value, null, 2));

ws.close();
process.exit(0);
