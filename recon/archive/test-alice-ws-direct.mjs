// Cleaner Alice WS-patch test: hook the patched send by spying on its inner _send call.
// We can't access the closure, but we CAN intercept by replacing the ORIGINAL send
// that the patch captured at install time. Trick: patch installs on prototype, so if
// we set prototype.send = our spy BEFORE creating a WS and call send through that
// instance, the patch's _send will be... no, the patch already captured the original
// at install time.
//
// Simplest reliable test: trigger the patched send and verify the bap:mutation-applied
// event fires with the expected payload. We already know the patch was installed
// (__betterAliceWsPatched = true verified earlier).

async function attach(urlSub) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.type === "page" && x.url.includes(urlSub));
  if (!t) throw new Error("no tab");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nextId = 1;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, call };
}

const { ws, call } = await attach("alice.yandex.ru");
await call("Runtime.enable");

const res = await call("Runtime.evaluate", {
  expression: `(async () => {
    const events = [];
    const handler = (ev) => { let d = ev.detail; try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch{} events.push(d); };
    window.addEventListener('bap:mutation-applied', handler);

    // Verify the patch marker
    const patched = !!window.__betterAliceWsPatched;

    // Find a real WebSocket instance the page already has, or create a no-op one.
    // Easiest: temporarily save WebSocket.prototype.send, replace with a no-op spy.
    // Then call the patched send through ANY WS instance.
    const protoSend = WebSocket.prototype.send;

    // Replace the deepest original send with a no-op so we don't actually transmit.
    // But our patch was installed on top of this — its closure holds the OLD send.
    // We can't intercept the closure's _send. So just verify that the event fires.

    // Create a real but never-opened WebSocket — calling send before open will throw,
    // but ONLY in the inner _send call. The mutation logic runs before that, so the event fires.
    let testWs;
    try {
      testWs = new WebSocket('wss://uniproxy.alice.yandex.net/');
    } catch (e) {
      return { patched, events: [], error: String(e) };
    }

    const VINS_FRAME = JSON.stringify({
      event: {
        header: { namespace: 'Vins', name: 'TextInput', messageId: 'test-uuid', seqNumber: 1 },
        payload: {
          application: { lang: 'ru-RU' },
          header: { prev_req_id: null, request_id: 'test-uuid', dialog_id: 'd-test', dialog_type: 2 },
          request: { event: { type: 'text_input', text: 'мой тестовый текст' } }
        }
      }
    });

    try {
      testWs.send(VINS_FRAME);
    } catch (e) {
      // Expected — WS not open yet
    }

    await new Promise(r => setTimeout(r, 50));
    window.removeEventListener('bap:mutation-applied', handler);
    try { testWs.close(); } catch {}
    return { patched, events };
  })()`,
  returnByValue: true,
  awaitPromise: true,
});

if (res.exceptionDetails) {
  console.log("JS error:", res.exceptionDetails.text);
  ws.close();
  process.exit(1);
}
const v = res.result?.value || {};
console.log("=== Alice WS-patch test ===");
console.log(`Patched marker: ${v.patched ? "✓" : "✗"}`);
console.log(`Mutation events: ${v.events?.length || 0}`);
if (v.events?.length) {
  const e = v.events[0];
  console.log(`  host: ${e.host}`);
  console.log(`  conversationId: ${e.conversationId}`);
  console.log(`  userPrompt: ${e.userPrompt}`);
  console.log(`  injectedText (head):\n${e.injectedText?.slice(0, 400)}`);
  const hasPrefix = e.injectedText?.includes("<BetterAlice>");
  const hasUser = e.injectedText?.includes("мой тестовый текст");
  console.log(`  contains <BetterAlice>: ${hasPrefix ? "✓" : "✗"}`);
  console.log(`  contains user text:    ${hasUser ? "✓" : "✗"}`);
}
ws.close();
process.exit(v.events?.length && v.patched ? 0 : 1);
