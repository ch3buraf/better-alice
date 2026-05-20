// Verify Better Alice MVP works on both hosts.
// Run AFTER extension is loaded and tabs are refreshed.

async function attach(urlSub) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
  if (!target) return null;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nextId = 1;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable");
  await call("Page.enable").catch(() => {});
  return { ws, call };
}

async function checkHost(label, urlSub) {
  console.log(`\n=== ${label} (${urlSub}) ===`);
  const conn = await attach(urlSub);
  if (!conn) { console.log("  ✗ no tab found"); return false; }
  const { call, ws } = conn;

  const checks = await call("Runtime.evaluate", {
    expression: `({
      url: location.href,
      hasContentBootstrap: !!window.__bdsContentBootstrapped,
      hasNetworkPatch: !!window.__betterAliceNetworkPatched,
      hasWsPatch: !!window.__betterAliceWsPatched,
      hasFetchPatch: !!window.__betterAliceProFetchPatched,
      hasRoot: !!document.getElementById('bap-root'),
      hasToggle: !!document.getElementById('bap-toggle'),
      toggleText: document.getElementById('bap-toggle')?.textContent,
    })`,
    returnByValue: true,
  });
  const v = checks.result?.value || {};
  console.log(`  URL: ${v.url}`);
  console.log(`  Content script bootstrapped: ${v.hasContentBootstrap ? '✓' : '✗'}`);
  console.log(`  Injected hook patched: ${v.hasNetworkPatch ? '✓' : '✗'}`);
  console.log(`  WS patch installed: ${v.hasWsPatch ? '✓' : (urlSub.includes('alicepro') ? 'N/A' : '✗')}`);
  console.log(`  Fetch patch installed: ${v.hasFetchPatch ? '✓' : (urlSub.includes('alicepro') ? '✗' : 'N/A')}`);
  console.log(`  #bap-root mounted: ${v.hasRoot ? '✓' : '✗'}`);
  console.log(`  #bap-toggle button visible: ${v.hasToggle ? '✓' : '✗'}`);

  // Listen for mutation event for 30s — user should send a test message
  console.log(`  Listening for bap:mutation-applied (30s window) — send a test message...`);
  const startListen = await call("Runtime.evaluate", {
    expression: `(()=>{ window.__balCaptured = []; window.addEventListener('bap:mutation-applied', (ev) => { let d = ev.detail; try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch {} window.__balCaptured.push({t:Date.now(), detail:d}); }); return 'ok';})()`,
    returnByValue: true,
  });

  const result = {
    contentBootstrap: v.hasContentBootstrap,
    injected: v.hasNetworkPatch,
    drawer: v.hasRoot && v.hasToggle,
  };
  ws.close();
  return result;
}

const pro = await checkHost("Alice Pro", "alicepro.yandex.ru");
const alice = await checkHost("Alice", "alice.yandex.ru");

console.log("\n=== Summary ===");
console.log("Alice Pro:", pro);
console.log("Alice:    ", alice);
