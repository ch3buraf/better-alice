// Test ART image enhancer: ask Alice to draw a photorealistic picture
// (which triggers her built-in ART tool, NOT bap-visualizer). Then verify
// our overlay (.bal-art-overlay) appears on the generated image.

async function attachToBrowser() {
  const v = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); } });
  return { ws, call: (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); }) };
}

async function attachTab(targetId) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.id === targetId);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); } });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable");
  await call("Page.enable");
  return { ws, call };
}

const { ws: bw, call: bc } = await attachToBrowser();
const t = await bc("Target.createTarget", { url: "https://alice.yandex.ru/", background: false });
console.log("opened tab", t.targetId);
await new Promise(r => setTimeout(r, 9000));
const { ws: tw, call: tc } = await attachTab(t.targetId);

await tc("Runtime.evaluate", {
  expression: `(()=>{const b=document.querySelector('[data-testid="new-chat-button"]'); if(b){b.click();return 'ok';} return 'no';})()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 2500));

// Send a "photorealistic" request → triggers ART (not bap-visualizer per our system prompt)
const PROMPT = "Нарисуй красивый фотореалистичный портрет рыжего кота на подоконнике, смотрящего в окно. (Это фотореалистичная картинка, не схема — используй ART)";
await tc("Runtime.evaluate", {
  expression: `(()=>{
    const t = document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea.AliceInput-Textarea') || document.querySelector('textarea');
    if (!t) return 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    t.focus(); setter.call(t, ${JSON.stringify(PROMPT)}); t.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`, returnByValue: true,
});
await new Promise(r => setTimeout(r, 600));
await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

// Wait for ART image (yaart-web-alice-images URL) to appear
let imgInfo = null;
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await tc("Runtime.evaluate", {
    expression: `(()=>{
      const imgs = [...document.querySelectorAll('img')].filter(img => /yaart-web-alice-images/.test(img.src));
      if (!imgs.length) return null;
      const lastImg = imgs[imgs.length - 1];
      const parent = lastImg.parentElement;
      const overlay = parent?.querySelector('.bal-art-overlay');
      return {
        imgSrc: lastImg.src,
        hasOverlay: !!overlay,
        overlayButtonsCount: overlay?.querySelectorAll('button').length || 0,
      };
    })()`, returnByValue: true,
  });
  const v = r.result?.value;
  if (v) {
    imgInfo = v;
    if (v.hasOverlay) break;
  }
}

if (imgInfo) {
  console.log("✓ ART image generated:", imgInfo.imgSrc);
  console.log(`  Overlay mounted: ${imgInfo.hasOverlay ? "✓" : "✗"}`);
  console.log(`  Overlay buttons: ${imgInfo.overlayButtonsCount}`);
} else {
  console.log("✗ no ART image found");
}

tw.close();
bw.close();
const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const aliceTab = tabs.find(x => x.id === t.targetId);
if (aliceTab) console.log("\nTab URL for inspection:", aliceTab.url);
process.exit(0);
