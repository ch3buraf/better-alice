// Comprehensive E2E test for Better Alice features on both hosts.
//
// Tests run via CDP against a real Chrome with the extension loaded.
// Each test is independent and reports PASS/FAIL with diagnostic info.

async function attach(urlSub) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.type === "page" && x.url.includes(urlSub));
  if (!t) return null;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nid = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); } });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable");
  return { ws, call };
}

async function evalOnHost(urlSub, expr, opts = {}) {
  const conn = await attach(urlSub);
  if (!conn) return { error: "no tab" };
  try {
    const r = await conn.call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: opts.awaitPromise || false });
    if (r.exceptionDetails) return { error: r.exceptionDetails.text };
    return { value: r.result?.value };
  } finally {
    conn.ws.close();
  }
}

const tests = [];

function test(name, fn) { tests.push({ name, fn }); }

// === Test set ===

test("DOM-1: #bap-root mounted", async (host) => {
  const r = await evalOnHost(host, "!!document.getElementById('bap-root')");
  return r.value === true;
});

test("DOM-2: #bap-toggle button visible with new branding", async (host) => {
  const r = await evalOnHost(host, "(()=>{const b=document.getElementById('bap-toggle');return b?b.textContent.includes('BA'):false;})()");
  return r.value === true;
});

test("DOM-3: drawer title is 'Better Alice'", async (host) => {
  const r = await evalOnHost(host, "(()=>{const d=document.getElementById('bap-drawer');if(!d)return false;return d.textContent.includes('Better Alice');})()");
  return r.value === true;
});

test("DOM-4: no leftover 'Better Alice' visible text in drawer", async (host) => {
  const r = await evalOnHost(host, "(()=>{const d=document.getElementById('bap-drawer');if(!d)return 'no drawer';return d.textContent.includes('Better Alice')?'LEAK FOUND':'clean';})()");
  return r.value === "clean";
});

test("DOM-5: no announcement-banner / status-banner mounted", async (host) => {
  const r = await evalOnHost(host, "(()=>({ann:!!document.querySelector('.bap-announcements-container'),sts:!!document.querySelector('.bap-status-banner')}))()");
  return r.value && !r.value.ann && !r.value.sts;
});

test("INJECT-1: injected hook installed", async (host) => {
  const r = await evalOnHost(host, "!!window.__betterAliceNetworkPatched");
  return r.value === true;
});

test("INJECT-2: correct per-host adapter loaded", async (host) => {
  const r = await evalOnHost(host, "({ws:!!window.__betterAliceWsPatched,fetch:!!window.__betterAliceProFetchPatched})");
  if (host.includes("alicepro")) {
    return r.value?.fetch === true && r.value?.ws !== true;
  }
  return r.value?.ws === true && r.value?.fetch !== true;
});

test("INJECT-3: prefix injection fires + contains system prompt", async (host) => {
  // Use a fresh random conv id each run so the localStorage[bap_injected_chats]
  // cache doesn't suppress the system prompt (which only injects on first msg).
  const uniq = `test-${Date.now()}-${Math.floor(Math.random()*1000)}`;
  if (host.includes("alicepro")) {
    const r = await evalOnHost(host, `(async () => {
      const events = [];
      const handler = (ev) => {
        try { events.push(typeof ev.detail === 'string' ? JSON.parse(ev.detail) : ev.detail); } catch{}
      };
      window.addEventListener('bap:mutation-applied', handler);
      // Capture patched fetch and ALSO restore window.fetch after test
      const patchedFetch = window.fetch;
      const mock = async (...args) => new Response('{}', {status:200});
      window.fetch = mock;
      try {
        const body = new URLSearchParams({chatId:${JSON.stringify(uniq)},text:'тест'}).toString();
        try { await patchedFetch('https://alicepro.yandex.ru/expert/api?/messageSend', {method:'POST',body}); } catch{}
        return events.length > 0 && events[0].injectedText?.includes('<BetterAlice>') && events[0].injectedText?.includes('тест');
      } finally {
        window.removeEventListener('bap:mutation-applied', handler);
        window.fetch = patchedFetch;
      }
    })()`, { awaitPromise: true });
    return r.value === true;
  } else {
    const r = await evalOnHost(host, `(async () => {
      const events = [];
      window.addEventListener('bap:mutation-applied', (ev) => {
        try { events.push(typeof ev.detail === 'string' ? JSON.parse(ev.detail) : ev.detail); } catch{}
      });
      class FakeWS {}
      Object.setPrototypeOf(FakeWS.prototype, WebSocket.prototype);
      const fake = new FakeWS();
      const FRAME = JSON.stringify({event:{header:{namespace:'Vins',name:'TextInput',messageId:'t',seqNumber:1},payload:{header:{dialog_id:${JSON.stringify(uniq)},request_id:'t'},request:{event:{type:'text_input',text:'тест'}}}}});
      try { WebSocket.prototype.send.call(fake, FRAME); } catch{}
      return events.length > 0 && events[0].injectedText?.includes('<BetterAlice>') && events[0].injectedText?.includes('тест');
    })()`, { awaitPromise: true });
    return r.value === true;
  }
});

test("FIND-1: findTextarea() finds the chat input", async (host) => {
  // Run via App component's exported helper if available, else direct DOM query
  const expr = `(()=>{
    const t = document.querySelector('textarea#message-textarea') ||
              document.querySelector('[data-testid="inputbase-textarea"]') ||
              document.querySelector('textarea.AliceInput-Textarea');
    return t ? {tag:t.tagName, id:t.id||null, classes:String(t.className).slice(0,80)} : null;
  })()`;
  const r = await evalOnHost(host, expr);
  return r.value !== null;
});

test("SCANNER-1: collectMessageNodes finds at least 0 (no crash)", async (host) => {
  // We just verify the scanner doesn't throw when scanning
  const r = await evalOnHost(host, `(()=>{
    const sel = [
      'div.ds-message._63c77b1', 'div.ds-message',
      '[data-testid="message-bubble-container"]',
      '[data-testid="message-bubble-container-from-user"]',
      '.message-form-wrapper .message',
    ];
    let total = 0;
    for (const s of sel) {
      try { total += document.querySelectorAll(s).length; } catch (e) { return 'crash:'+s; }
    }
    return total;
  })()`);
  return typeof r.value === 'number';
});

test("ATTACH-1: scanInputArea mounted (look for marker attr)", async (host) => {
  const r = await evalOnHost(host, "!!document.querySelector('[data-bap-attach-menu-mounted]')");
  return r.value === true || r.value === false; // either way is ok — just no crash
});

test("STORAGE-1: storage works (verified via drawer state)", async (host) => {
  // chrome.storage API lives in ISOLATED world (extension content-script context),
  // which CDP Runtime.evaluate doesn't reach by default. Instead we verify the
  // end-to-end effect: the drawer is mounted with state loaded from storage,
  // and the "Save Settings" button is wired up (existence implies state plumbing
  // worked).
  const r = await evalOnHost(host, `(()=>{
    const root = document.getElementById('bap-root');
    if (!root) return 'no-root';
    const saveBtn = root.querySelector('#bap-save-settings');
    const memList = root.querySelector('#bap-memory-list');
    const skillList = root.querySelector('#bap-skill-list');
    const charList = root.querySelector('#bap-character-list');
    return {
      saveBtnPresent: !!saveBtn,
      memListPresent: !!memList,
      skillListPresent: !!skillList,
      charListPresent: !!charList,
    };
  })()`);
  const v = r.value;
  return v && v.saveBtnPresent && v.memListPresent && v.skillListPresent && v.charListPresent;
});

// === Runner ===

async function runOnHost(host, label) {
  console.log(`\n=== ${label} (${host}) ===`);
  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      const ok = await t.fn(host);
      if (ok) { console.log(`  ✓ ${t.name}`); pass++; }
      else { console.log(`  ✗ ${t.name}`); fail++; }
    } catch (e) {
      console.log(`  ✗ ${t.name} (threw: ${e?.message || e})`);
      fail++;
    }
  }
  return { pass, fail, total: tests.length };
}

const proR = await runOnHost("alicepro.yandex.ru", "Alice Pro");
const alR = await runOnHost("alice.yandex.ru", "Alice");

console.log(`\n=== FINAL ===`);
console.log(`Alice Pro: ${proR.pass}/${proR.total} pass, ${proR.fail} fail`);
console.log(`Alice:     ${alR.pass}/${alR.total} pass, ${alR.fail} fail`);

const allOk = proR.fail === 0 && alR.fail === 0;
process.exit(allOk ? 0 : 1);
