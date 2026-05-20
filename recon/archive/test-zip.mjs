// Test: ask Alice to bundle multiple files via bap-zip
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
  await call("Runtime.enable"); await call("Page.enable"); await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: "C:\\Users\\LL5AI\\Downloads" }).catch(()=>{});
  return { ws, call };
}

const prompt = "Сделай минимальный Node.js проект 'hello-server' (3 файла: package.json, server.js, README.md). Упакуй через формат ```bap-zip с JSON {fileName,files:[{path,content},...]}.";

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
      if (!t) return 'no textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus(); setter.call(t, ${JSON.stringify(prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 600));
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const form = document.querySelector('#message-form');
      if (form && form.requestSubmit) { const btn=form.querySelector('button.submit')||form.querySelector('button[type=submit]'); btn?form.requestSubmit(btn):form.requestSubmit(); return 'form'; }
      return 'no-form';
    })()`, returnByValue: true,
  });
  await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

  let info = null, lastLen = 0, stable = 0;
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{
        const codes = [...document.querySelectorAll('pre code')];
        const btns = [...document.querySelectorAll('button')].filter(b => /Скачать \\.zip/.test(b.textContent || ''));
        const lastBubble = [...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop();
        const text = lastBubble?.textContent || '';
        return {
          codeLangs: codes.map(c => String(c.className).match(/language-([^\\s]+)/)?.[1]),
          codeHeads: codes.map(c => c.textContent.slice(0,80)),
          zipButtons: btns.length,
          zipBtnLabels: btns.map(b => b.textContent),
          bubbleLen: text.length,
        };
      })()`, returnByValue: true,
    });
    const v = r.result?.value;
    if (v && v.bubbleLen > 30) {
      if (v.bubbleLen === lastLen) { stable++; if (stable >= 4) { info = v; break; } }
      else { lastLen = v.bubbleLen; stable = 0; }
    }
  }

  if (info) {
    console.log(`  fence langs: ${JSON.stringify(info.codeLangs)}`);
    console.log(`  zip buttons: ${info.zipButtons} → ${JSON.stringify(info.zipBtnLabels)}`);
    console.log(`  RESULT: ${info.zipButtons > 0 ? '✓ ZIP button present' : '✗ no zip button'}`);

    if (info.zipButtons > 0) {
      // Click the button to verify download fires
      const click = await tc("Runtime.evaluate", {
        expression: `(()=>{
          const btn = [...document.querySelectorAll('button')].find(b => /Скачать \\.zip/.test(b.textContent || ''));
          if (btn) { btn.click(); return 'clicked'; }
          return 'no btn';
        })()`, returnByValue: true,
      });
      console.log(`  click result: ${click.result.value}`);
      await new Promise(r => setTimeout(r, 2500));
      const after = await tc("Runtime.evaluate", {
        expression: `(()=>{
          const btn = [...document.querySelectorAll('button')].find(b => /\\.zip/.test(b.textContent || ''));
          return btn ? btn.textContent : '(button gone)';
        })()`, returnByValue: true,
      });
      console.log(`  button after click: "${after.result.value}"`);
    }
  } else {
    console.log("  ✗ no response");
  }

  const ss = await tc("Page.captureScreenshot", { format: "png" });
  const fs = await import("node:fs");
  const out = `C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots\\zip-${host.label.replace(/\\s/g,"")}.png`;
  fs.writeFileSync(out, Buffer.from(ss.data, "base64"));
  console.log(`  screenshot: ${out}`);

  tw.close(); bw.close();
}
console.log("\nDone.");
