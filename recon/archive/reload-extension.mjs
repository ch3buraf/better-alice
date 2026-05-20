// Reload the (folder-based) Better Alice extension via chrome.developerPrivate.reload
// and refresh both Alice tabs.

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const extTab = tabs.find((t) => t.url?.includes("chrome://extensions"));
if (!extTab) {
  // Open one
  const verRes = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
  const bws = new WebSocket(verRes.webSocketDebuggerUrl);
  await new Promise((res, rej) => { bws.addEventListener("open", res, { once: true }); bws.addEventListener("error", rej, { once: true }); });
  let nid = 1;
  await new Promise((res, rej) => {
    bws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id === nid) (m.error ? rej(m.error) : res(m.result)); }, { once: true });
    bws.send(JSON.stringify({ id: nid, method: "Target.createTarget", params: { url: "chrome://extensions/" } }));
  });
  bws.close();
  await new Promise((r) => setTimeout(r, 1500));
}

// Re-list
const tabs2 = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const ext = tabs2.find((t) => t.url?.includes("chrome://extensions"));
if (!ext) { console.error("no ext tab"); process.exit(1); }

async function attach(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nid = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); } });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, call };
}

const { ws, call } = await attach(ext);
await call("Runtime.enable");

// List all Better Alice extensions and find the one loaded from FOLDER (path includes dist-chrome but not .zip)
const res = await call("Runtime.evaluate", {
  expression: `(async () => {
    const list = await new Promise(r => chrome.developerPrivate.getExtensionsInfo({}, r));
    const ba = list.filter(x => x.name === 'Better Alice');
    return ba.map(x => ({id:x.id, location:x.location, path:x.path, state:x.state}));
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log("All Better Alice extensions:", JSON.stringify(res.result?.value, null, 2));

// Find the one with path including 'dist-chrome' (folder install, not zip)
const folderExt = res.result?.value?.find(x => x.path?.includes("dist-chrome") || x.path?.includes("better-alice"));
if (!folderExt) {
  console.error("no folder-installed Better Alice found");
  ws.close();
  process.exit(1);
}
console.log("Reloading:", folderExt.id, "(path:", folderExt.path, ")");

// Make sure it's ENABLED first (we earlier disabled the duplicate, might have hit wrong one)
const enableRes = await call("Runtime.evaluate", {
  expression: `(async () => {
    return new Promise(r => chrome.developerPrivate.updateExtensionConfiguration({extensionId: ${JSON.stringify(folderExt.id)}, userScriptsAccess: undefined, fileAccess: undefined}, r));
  })()`,
  returnByValue: true,
  awaitPromise: true,
});

// Enable if disabled (state could be 'DISABLED')
if (folderExt.state !== "ENABLED") {
  console.log("Extension was", folderExt.state, "— enabling...");
  await call("Runtime.evaluate", {
    expression: `(async () => {
      return new Promise(r => chrome.management.setEnabled(${JSON.stringify(folderExt.id)}, true, r));
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  await new Promise(r => setTimeout(r, 500));
}

// Reload
const reloadRes = await call("Runtime.evaluate", {
  expression: `(async () => {
    return new Promise((res, rej) => {
      chrome.developerPrivate.reload(${JSON.stringify(folderExt.id)}, {failQuietly: false}, (err) => {
        if (err && err.error) rej(err.error); else res('ok');
      });
    });
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log("Reload:", reloadRes.result?.value || JSON.stringify(reloadRes));

// Disable the OTHER Better Alice (zip-based) to avoid double-injection
const others = res.result?.value?.filter(x => x.id !== folderExt.id);
for (const o of others) {
  console.log("Disabling duplicate:", o.id);
  await call("Runtime.evaluate", {
    expression: `(async () => {
      return new Promise(r => chrome.management.setEnabled(${JSON.stringify(o.id)}, false, r));
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
}

ws.close();

// Refresh both Alice tabs
console.log("\nRefreshing Alice tabs...");
for (const sub of ["alice.yandex.ru", "alicepro.yandex.ru"]) {
  const tab = tabs2.find(t => t.type === "page" && t.url.includes(sub));
  if (!tab) { console.log(`  no tab for ${sub}`); continue; }
  const a = await attach(tab);
  await a.call("Page.enable").catch(() => {});
  await a.call("Page.reload");
  a.ws.close();
  console.log(`  ${sub}: reloaded`);
}

console.log("\nDone.");
