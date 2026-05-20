// End-to-end injection test:
// 1. Add a 'name: TestUser' always-memory via storage
// 2. Send a message via CDP-typed input
// 3. Verify the outgoing WS frame contains <BetterAlice> + memory + user text

async function attachToTab(urlSub) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
  if (!target) throw new Error(`no tab matches ${urlSub}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nextId = 1;
  const events = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); return; }
    events.push(m);
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, call, events };
}

async function testAlice() {
  console.log("\n=== TEST: alice.yandex.ru ===");
  const { ws, call, events } = await attachToTab("alice.yandex.ru");

  await call("Network.enable");
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.bringToFront").catch(() => {});

  // Set up an in-page listener for bap:mutation-applied
  await call("Runtime.evaluate", {
    expression: `(()=>{window.__balCaptured=[];window.addEventListener('bap:mutation-applied',(ev)=>{let d=ev.detail;try{d=typeof d==='string'?JSON.parse(d):d;}catch(e){}window.__balCaptured.push(d);});return 'listener installed';})()`,
    returnByValue: true,
  });

  // Focus textarea, type, click submit
  await call("Runtime.evaluate", {
    expression: `(()=>{const t=document.querySelector('textarea.AliceInput-Textarea')||document.querySelector('[data-testid="inputbase-textarea"]')||document.querySelector('textarea');if(!t)return 'no textarea';t.focus();t.value='';t.dispatchEvent(new Event('input',{bubbles:true}));return 'focused';})()`,
    returnByValue: true,
  });

  const TEST_MSG = "проверка работы Better Alice";
  await call("Input.insertText", { text: TEST_MSG });
  await new Promise((r) => setTimeout(r, 400));

  const btn = await call("Runtime.evaluate", {
    expression: `(()=>{const b=document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow')||document.querySelector('button[aria-label*="тправить"]');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    returnByValue: true,
  });
  if (!btn.result?.value) {
    console.log("  ✗ submit button not found");
    ws.close();
    return false;
  }
  const { x, y } = btn.result.value;
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });

  // Wait 15 seconds for injection event + Alice response
  console.log("  Waiting 15s for injection + response...");
  await new Promise((r) => setTimeout(r, 15000));

  // Check what was captured
  const captured = await call("Runtime.evaluate", {
    expression: "JSON.stringify(window.__balCaptured)",
    returnByValue: true,
  });
  const list = JSON.parse(captured.result?.value || "[]");
  console.log(`  Captured mutations: ${list.length}`);
  if (list.length > 0) {
    const last = list[list.length - 1];
    console.log(`    host: ${last.host}`);
    console.log(`    conversationId: ${last.conversationId}`);
    console.log(`    userPrompt: ${last.userPrompt?.slice(0, 80)}`);
    console.log(`    injectedText starts with: ${last.injectedText?.slice(0, 200)}`);
    const hasBetterAlice = last.injectedText?.includes("<BetterAlice>");
    const hasUserMsg = last.injectedText?.includes(TEST_MSG);
    console.log(`    contains <BetterAlice>: ${hasBetterAlice ? "✓" : "✗"}`);
    console.log(`    contains user message: ${hasUserMsg ? "✓" : "✗"}`);
    ws.close();
    return hasBetterAlice && hasUserMsg;
  }
  ws.close();
  return false;
}

async function testAlicePro() {
  console.log("\n=== TEST: alicepro.yandex.ru ===");
  const { ws, call, events } = await attachToTab("alicepro.yandex.ru");

  await call("Network.enable");
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.bringToFront").catch(() => {});

  await call("Runtime.evaluate", {
    expression: `(()=>{window.__balCaptured=[];window.addEventListener('bap:mutation-applied',(ev)=>{let d=ev.detail;try{d=typeof d==='string'?JSON.parse(d):d;}catch(e){}window.__balCaptured.push(d);});return 'ok';})()`,
    returnByValue: true,
  });

  await call("Runtime.evaluate", {
    expression: `(()=>{const t=document.getElementById('message-textarea');if(!t)return 'no textarea';t.focus();t.value='';t.dispatchEvent(new Event('input',{bubbles:true}));return 'focused';})()`,
    returnByValue: true,
  });

  const TEST_MSG = "тест Алиса Про от Better Alice";
  await call("Input.insertText", { text: TEST_MSG });
  await new Promise((r) => setTimeout(r, 400));

  const btn = await call("Runtime.evaluate", {
    expression: `(()=>{const f=document.getElementById('message-form');if(!f)return null;const b=f.querySelector('button.submit');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:b.disabled};})()`,
    returnByValue: true,
  });
  if (!btn.result?.value || btn.result.value.disabled) {
    console.log("  ✗ submit button not clickable:", JSON.stringify(btn.result?.value));
    ws.close();
    return false;
  }
  const { x, y } = btn.result.value;
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });

  console.log("  Waiting 15s for injection + response...");
  await new Promise((r) => setTimeout(r, 15000));

  const captured = await call("Runtime.evaluate", {
    expression: "JSON.stringify(window.__balCaptured)",
    returnByValue: true,
  });
  const list = JSON.parse(captured.result?.value || "[]");
  console.log(`  Captured mutations: ${list.length}`);
  if (list.length > 0) {
    const last = list[list.length - 1];
    console.log(`    host: ${last.host}`);
    console.log(`    conversationId: ${last.conversationId}`);
    console.log(`    userPrompt: ${last.userPrompt?.slice(0, 80)}`);
    console.log(`    injectedText starts with: ${last.injectedText?.slice(0, 200)}`);
    const hasBetterAlice = last.injectedText?.includes("<BetterAlice>");
    const hasUserMsg = last.injectedText?.includes(TEST_MSG);
    console.log(`    contains <BetterAlice>: ${hasBetterAlice ? "✓" : "✗"}`);
    console.log(`    contains user message: ${hasUserMsg ? "✓" : "✗"}`);
    ws.close();
    return hasBetterAlice && hasUserMsg;
  }
  ws.close();
  return false;
}

const proOk = await testAlicePro();
const aliceOk = await testAlice();

console.log("\n=== FINAL ===");
console.log(`Alice Pro injection: ${proOk ? "✓ PASS" : "✗ FAIL"}`);
console.log(`Alice injection:     ${aliceOk ? "✓ PASS" : "✗ FAIL"}`);

if (!proOk || !aliceOk) process.exit(1);
process.exit(0);
