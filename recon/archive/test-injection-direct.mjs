// Deterministic injection test — bypass DOM, call the patched window.fetch
// or WebSocket.send DIRECTLY via Runtime.evaluate. This proves the patch is wired.

async function attachToTab(urlSub) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
  if (!target) throw new Error(`no tab matches ${urlSub}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nextId = 1;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, call };
}

async function testAlicePro() {
  console.log("\n=== Alice Pro — direct fetch injection ===");
  const { ws, call } = await attachToTab("alicepro.yandex.ru");
  await call("Runtime.enable");

  const res = await call("Runtime.evaluate", {
    expression: `(async () => {
      const events = [];
      const handler = (ev) => { let d = ev.detail; try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch{} events.push(d); };
      window.addEventListener('bap:mutation-applied', handler);

      // Call patched fetch with a FAKE messageSend POST. We don't care about the response.
      const body = new URLSearchParams({
        projectId: 'p-test', chatId: 'c-test', type: 'input', source: 'main',
        text: 'тестовый запрос', availableServices: '7', servicesOverrides: '7'
      }).toString();
      let actualBody = null;
      // Wrap fetch one more time to capture what the patched fetch ACTUALLY sends downstream
      const origFetchAtTestTime = window.fetch;
      window.fetch = async function(input, init) {
        if (typeof input === 'string' && input.includes('messageSend')) {
          actualBody = init?.body;
        }
        // Return a fake response — don't hit network
        return new Response('{}', {status: 200});
      };
      try {
        await origFetchAtTestTime('https://alicepro.yandex.ru/expert/api?/messageSend', { method: 'POST', body });
      } finally {
        // Restore (best effort — the patched chain remains)
      }
      window.removeEventListener('bap:mutation-applied', handler);
      return { events, actualBody };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    console.log("  ✗ JS error:", res.exceptionDetails.text);
    ws.close();
    return false;
  }
  const v = res.result?.value || {};
  console.log(`  Events captured: ${v.events?.length || 0}`);
  if (v.events?.length) {
    const e = v.events[0];
    console.log(`    host=${e.host}, convId=${e.conversationId}`);
    console.log(`    userPrompt=${e.userPrompt?.slice(0, 80)}`);
    console.log(`    injectedText starts: ${e.injectedText?.slice(0, 150)}`);
  }
  console.log(`  Actual body sent to network: ${v.actualBody?.slice(0, 300)}`);
  ws.close();
  return v.events?.length > 0 && v.actualBody?.includes("<BetterAlice>");
}

async function testAlice() {
  console.log("\n=== Alice — direct WebSocket injection ===");
  const { ws, call } = await attachToTab("alice.yandex.ru");
  await call("Runtime.enable");

  const res = await call("Runtime.evaluate", {
    expression: `(async () => {
      const events = [];
      const handler = (ev) => { let d = ev.detail; try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch{} events.push(d); };
      window.addEventListener('bap:mutation-applied', handler);

      // Build a Vins/TextInput frame and call WebSocket.prototype.send directly.
      // We need a WebSocket instance. Since patching the constructor only wraps NEW instances,
      // and the patched .send is on prototype, we can use ANY WS instance the page has.
      // If the page has a live WS, find it. Otherwise, create our own.

      // Simulate by patching a fresh instance — since the patch is on prototype, ALL instances
      // share the patched send. We can use any. Make a dummy WS (won't actually connect).
      let captured = null;
      // We can't easily intercept the network send result without actually connecting.
      // So we override the original send THIRD time to capture downstream.
      // The patch order: original -> patched (mutates) -> our test capture.
      const protoSend = WebSocket.prototype.send;
      // The patched send is currently on prototype. To capture what it forwards,
      // we install yet another layer on top.
      const wrappedSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function(data) {
        // Patched send is wrappedSend. We want to see what it does. Let it run.
        // But intercept the _send.call(this, data) inside it by overriding the
        // ORIGINAL send (which the patch captured via closure when it was installed).
        // Trick: invoke the patched send via Function.prototype.call so we observe.
        const dataBefore = data;
        // Save what the original would have received
        try {
          // Mock the underlying send by replacing the WebSocket-side send with a capture
          // This is hacky — but since we don't have direct access to the patch's _send closure,
          // the cleanest demo is to just call the patched function and assume mutation happens.
          return wrappedSend.call(this, data);
        } catch (e) {
          return undefined;
        }
      };

      // Actually since this gets unwieldy: just simulate the WS message at the API level.
      // We'll construct a fake WebSocket, override send to spy, then trigger the WS prototype patch via send call.
      class FakeWS { constructor(url) { this.url = url; } }
      Object.setPrototypeOf(FakeWS.prototype, WebSocket.prototype);
      const fake = new FakeWS('wss://test/');
      // Now spy on what reaches the original (un-patched) send -- but proto chain points to patched.
      // For simplicity, just call the patched send and see if it triggers our event:
      const VINS_FRAME = JSON.stringify({
        event: {
          header: { namespace: 'Vins', name: 'TextInput', messageId: 'test-1', seqNumber: 1 },
          payload: {
            application: {},
            header: { prev_req_id: null, request_id: 'test-1', dialog_id: 'd-test', dialog_type: 2 },
            request: { event: { type: 'text_input', text: 'тест вписать' } }
          }
        }
      });

      // Capture what the layer beneath sends out by hooking the protoSend one level deeper.
      let captured2 = null;
      const origProtoSend = wrappedSend; // already patched — points to (data) => { mutate; _send.call(this, data) }
      // We need to capture inside the closure's _send. We can't from outside. So instead:
      // The event 'bap:mutation-applied' is the canonical signal — it fires AFTER mutation but BEFORE _send.
      // So just trigger and check the event.
      try {
        // Send through patched send (no real connection -- the original _send will throw on a fake WS but
        // that's fine because we'll catch it).
        wrappedSend.call(fake, VINS_FRAME);
      } catch(e) {
        // expected — fake WS isn't connected
      }

      window.removeEventListener('bap:mutation-applied', handler);
      WebSocket.prototype.send = wrappedSend; // restore
      return { events, captured };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    console.log("  ✗ JS error:", res.exceptionDetails.text);
    ws.close();
    return false;
  }
  const v = res.result?.value || {};
  console.log(`  Events captured: ${v.events?.length || 0}`);
  if (v.events?.length) {
    const e = v.events[0];
    console.log(`    host=${e.host}, convId=${e.conversationId}`);
    console.log(`    userPrompt=${e.userPrompt?.slice(0, 80)}`);
    console.log(`    injectedText starts: ${e.injectedText?.slice(0, 200)}`);
  }
  ws.close();
  return v.events?.length > 0;
}

const proOk = await testAlicePro();
const aliceOk = await testAlice();

console.log("\n=== FINAL ===");
console.log(`Alice Pro fetch-patch firing: ${proOk ? "✓ PASS" : "✗ FAIL"}`);
console.log(`Alice WS-patch firing:        ${aliceOk ? "✓ PASS" : "✗ FAIL"}`);

if (!proOk || !aliceOk) process.exit(1);
process.exit(0);
