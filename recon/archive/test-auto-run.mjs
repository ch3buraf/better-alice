// Test: ask Alice to use bap-run-python and check that code auto-executes
async function attachBrowser() {
  const v = await fetch("http://127.0.0.1:9222/json/version").then(r => r.json());
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }});
  return { ws, call: (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); }) };
}
async function attachTab(id) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
  const t = tabs.find(x => x.id === id);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }});
  const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable"); await call("Page.enable");
  return { ws, call };
}

const prompt = "Посчитай сумму чисел от 1 до 100. Используй формат ```bap-run-python чтобы расширение само запустило код и показало результат. ВНУТРИ блока — только print(sum(...)).";

for (const host of [
  { url: "https://alice.yandex.ru/", label: "Alice" },
  { url: "https://alicepro.yandex.ru/expert", label: "Alice Pro" },
]) {
  console.log(`\n=== ${host.label} ===`);
  const { ws: bw, call: bc } = await attachBrowser();
  const newTab = await bc("Target.createTarget", { url: host.url, background: false });
  await new Promise(r => setTimeout(r, 9000));
  const { ws: tw, call: tc } = await attachTab(newTab.targetId);
  await tc("Runtime.evaluate", { expression: `(()=>{
    const close = () => { document.querySelectorAll('.bap-close-btn').forEach(b=>b.click?.()); const btn=[...document.querySelectorAll('button')].find(b=>/Понятно|спасибо|OK/i.test(b.textContent||'')); if(btn) btn.click(); };
    close(); setTimeout(close, 500); setTimeout(close, 1500);
    return 'ok';
  })()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 2000));

  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea') || document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus(); setter.call(t, ${JSON.stringify(prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 600));
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const form = document.querySelector('#message-form');
      if (form?.requestSubmit) { const btn=form.querySelector('button.submit')||form.querySelector('button[type=submit]'); btn?form.requestSubmit(btn):form.requestSubmit(); return 'form'; }
      return 'no-form';
    })()`, returnByValue: true,
  });
  await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

  // Wait for stable assistant message
  let lastLen = 0, stable = 0, settled = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{
        const lastBubble = [...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop();
        return lastBubble?.textContent?.length || 0;
      })()`, returnByValue: true,
    });
    const len = r.result.value;
    if (len > 30) {
      if (len === lastLen) { stable++; if (stable >= 4) { settled = true; break; } }
      else { lastLen = len; stable = 0; }
    }
  }
  console.log("  settled:", settled, "len:", lastLen);

  // Now wait extra 25s for Pyodide to download and execute
  await new Promise(r => setTimeout(r, 25000));

  const r = await tc("Runtime.evaluate", {
    expression: `(()=>{
      const codes = [...document.querySelectorAll('pre code')];
      const autoContainer = document.querySelector('.bap-auto-run-container');
      const output = autoContainer?.textContent || '';
      return {
        codeLangs: codes.map(c => String(c.className).match(/language-([^\\s]+)/)?.[1]),
        codeHeads: codes.map(c => c.textContent.slice(0,80)),
        autoContainerExists: !!autoContainer,
        autoOutput: output.slice(0, 300),
        hasFiveZero5Zero: /\\b5050\\b/.test(output),
      };
    })()`, returnByValue: true,
  });
  const v = r.result.value;
  console.log(`  fence langs: ${JSON.stringify(v.codeLangs)}`);
  console.log(`  auto container present: ${v.autoContainerExists}`);
  console.log(`  auto output: "${v.autoOutput}"`);
  console.log(`  contains 5050: ${v.hasFiveZero5Zero}`);
  console.log(`  RESULT: ${v.hasFiveZero5Zero ? '✓ Auto-execution produced expected result 5050' : (v.autoContainerExists ? '⚠ Container exists but no 5050 in output' : '✗ No auto-run container')}`);

  const ss = await tc("Page.captureScreenshot", { format: "png" });
  const fs = await import("node:fs");
  const out = `C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots\\autorun-${host.label.replace(/\\s/g,"")}.png`;
  fs.writeFileSync(out, Buffer.from(ss.data, "base64"));
  console.log(`  screenshot: ${out}`);

  tw.close(); bw.close();
}
console.log("\nDone.");
