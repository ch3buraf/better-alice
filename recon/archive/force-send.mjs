// The textarea is filled, the button is visible — just need to figure out how
// to actually trigger Alice's React submit handler.

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const t = tabs.find((x) => x.type === "page" && x.url.includes("alice.yandex.ru"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
const pending = new Map(); let nid = 1;
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
});
const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

await call("Runtime.enable");
await call("Page.bringToFront");

// Capture mutation events
await call("Runtime.evaluate", {
  expression: `if (!window.__balListener) { window.__balMutations = []; window.__balListener = (ev) => { try { window.__balMutations.push(typeof ev.detail==='string'?JSON.parse(ev.detail):ev.detail); } catch{} }; window.addEventListener('bap:mutation-applied', window.__balListener); }`,
});

// Strategy 1: re-focus textarea, dispatch pointerdown+pointerup+click on button
console.log("Try 1: pointer events on button");
const btn = await call("Runtime.evaluate", {
  expression: `(()=>{
    const b = document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {x: r.x + r.width/2, y: r.y + r.height/2};
  })()`, returnByValue: true,
});
if (btn.result?.value) {
  const { x, y } = btn.result.value;
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  // PointerDown
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1, pointerType: "mouse" });
  await new Promise(r => setTimeout(r, 100));
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0, pointerType: "mouse" });
}
await new Promise(r => setTimeout(r, 4000));

// Check if mutation happened
const after1 = await call("Runtime.evaluate", {
  expression: `({muts: (window.__balMutations||[]).length, taValue: (document.querySelector('[data-testid="inputbase-textarea"]')?.value || '').slice(0,100)})`,
  returnByValue: true,
});
console.log("  after Try 1:", JSON.stringify(after1.result?.value));

// Strategy 2: focus textarea, press Ctrl+Enter
if (after1.result?.value?.muts === 0) {
  console.log("\nTry 2: focus textarea + Ctrl+Enter");
  await call("Runtime.evaluate", {
    expression: `(document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea')).focus()`,
  });
  await new Promise(r => setTimeout(r, 200));
  await call("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await new Promise(r => setTimeout(r, 4000));
  const after2 = await call("Runtime.evaluate", {
    expression: `({muts: (window.__balMutations||[]).length, taValue: (document.querySelector('[data-testid="inputbase-textarea"]')?.value || '').slice(0,100)})`,
    returnByValue: true,
  });
  console.log("  after Try 2:", JSON.stringify(after2.result?.value));
}

// Strategy 3: directly call button.click() via JS
const beforeT3 = await call("Runtime.evaluate", {
  expression: `({muts: (window.__balMutations||[]).length})`,
  returnByValue: true,
});
if (beforeT3.result?.value?.muts === 0) {
  console.log("\nTry 3: programmatic btn.click()");
  await call("Runtime.evaluate", {
    expression: `(() => {
      const b = document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow');
      if (!b) return 'no btn';
      // Mimic real user interaction: dispatch pointerdown on parent then click
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      b.dispatchEvent(ev);
      return 'clicked';
    })()`,
    returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 4000));
  const after3 = await call("Runtime.evaluate", {
    expression: `({muts: (window.__balMutations||[]).length, taValue: (document.querySelector('[data-testid="inputbase-textarea"]')?.value || '').slice(0,100)})`,
    returnByValue: true,
  });
  console.log("  after Try 3:", JSON.stringify(after3.result?.value));
}

// Wait longer and check for response
console.log("\nFinal wait 20s + read state...");
await new Promise(r => setTimeout(r, 20000));
const final = await call("Runtime.evaluate", {
  expression: `(()=>{
    const muts = window.__balMutations || [];
    const bubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
    return {
      muts: muts.length,
      lastInjectedHead: muts[muts.length-1]?.injectedText?.slice(0,800),
      bubbleCount: bubbles.length,
      lastBubble: bubbles[bubbles.length-1]?.textContent?.slice(0,500)
    };
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(final.result?.value, null, 2));

ws.close();
process.exit(0);
