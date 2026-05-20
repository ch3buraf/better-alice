// Bring chrome://extensions/ to front, inject a big banner, wait for user.

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
await call("Page.enable").catch(()=>{});
await call("Page.bringToFront").catch(()=>{});

// Inject a glaring banner with path-to-copy (DOM API only — chrome://extensions blocks innerHTML via TrustedHTML)
const banner = `(()=>{
  document.getElementById('bal-loader')?.remove();
  const b = document.createElement('div');
  b.id = 'bal-loader';
  b.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#ff4444;color:white;padding:24px 32px;border-radius:8px;z-index:99999;font-size:18px;font-family:system-ui;box-shadow:0 8px 24px rgba(0,0,0,0.3);max-width:600px;text-align:center';
  const make = (tag, style, txt) => { const el = document.createElement(tag); if (style) el.style.cssText = style; if (txt) el.textContent = txt; return el; };
  b.appendChild(make('div', 'font-size:22px;font-weight:bold;margin-bottom:12px', 'Better Alice — один клик'));
  b.appendChild(make('div', 'margin-bottom:14px', 'Кнопка Load unpacked сверху → выбрать папку:'));
  b.appendChild(make('code', 'background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:4px;display:inline-block;font-size:14px;word-break:break-all', 'C:\\\\Users\\\\LL5AI\\\\Documents\\\\CODE_AGENTS_ZONE\\\\alisa\\\\better-alice\\\\dist-chrome'));
  b.appendChild(make('div', 'margin-top:14px;font-size:14px;opacity:0.9', 'Баннер исчезнет после загрузки'));
  if (!document.body) return 'no body yet';
  document.body.appendChild(b);
  return 'banner shown';
})()`;
const r = await call("Runtime.evaluate", { expression: banner, returnByValue: true });
console.log(r.result?.value);

// Poll for Better Alice in extension list every 2s, max 5min
console.log("Polling for Better Alice extension...");
const start = Date.now();
const timeout = 300000;
let found = null;
while (Date.now() - start < timeout) {
  await new Promise((r) => setTimeout(r, 2000));
  const check = await call("Runtime.evaluate", {
    expression: `(()=>{const m=document.querySelector('extensions-manager');if(!m)return null;const list=m.shadowRoot.querySelector('extensions-item-list');if(!list)return null;const cards=list.shadowRoot.querySelectorAll('extensions-item');return [...(cards||[])].map(c=>({name:c.shadowRoot.querySelector('#name')?.textContent?.trim(),id:c.id,enabled:c.shadowRoot.querySelector('#enableToggle')?.checked}));})()`,
    returnByValue: true,
  });
  const list = check.result?.value || [];
  const better = list.find((x) => x.name === 'Better Alice');
  if (better) {
    found = better;
    break;
  }
}

if (found) {
  console.log("✓ Better Alice loaded:", JSON.stringify(found));
  // Remove the banner
  await call("Runtime.evaluate", { expression: `document.getElementById('bal-loader')?.remove();`, returnByValue: true });
} else {
  console.log("✗ Timed out waiting for extension to load");
  process.exit(1);
}

ws.close();
process.exit(0);
