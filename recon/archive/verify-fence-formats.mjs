// Verify what fence/format Alice and Alice Pro actually return now (after
// frequency=always). Logs the exact `language-XXX` of each returned code-fence,
// so we can tell whether smart-sniff/JSON-unwrap is still firing or dead code.

async function attachBrowser() {
  const v = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }});
  return { ws, call: (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); }) };
}
async function attachTab(id) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.id === id);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const p = new Map(); let n = 1;
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }});
  const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable"); await call("Page.enable");
  return { ws, call };
}

const tests = [
  { id: "pptx", prompt: "Сделай PowerPoint про осень — 3 слайда. Используй формат bap-pptx с JSON." },
  { id: "excel", prompt: "Сделай Excel-таблицу 'мои покупки' с 3 строками. Используй формат bap-excel с JSON." },
  { id: "docx", prompt: "Сделай Word-документ — список покупок (3-4 пункта). Используй формат bap-docx с JSON." },
  { id: "filename", prompt: "Напиши на JS функцию для расчёта факториала. Оформи как ```filename=fact.js — это код-блок, НЕ markdown-ссылку." },
];

const hosts = [
  { url: "https://alice.yandex.ru/", label: "Alice" },
  { url: "https://alicepro.yandex.ru/expert", label: "Alice Pro" },
];

const { ws: bw, call: bc } = await attachBrowser();
const results = [];

for (const host of hosts) {
  for (const test of tests) {
    console.log(`\n--- ${host.label} / ${test.id} ---`);
    const newTab = await bc("Target.createTarget", { url: host.url, background: false });
    await new Promise(r => setTimeout(r, 9000));
    const { ws: tw, call: tc } = await attachTab(newTab.targetId);
    await tc("Runtime.evaluate", { expression: `(()=>{const x=document.querySelector('.bap-close-btn');if(x)x.click();return 'ok';})()`, returnByValue: true });
    await new Promise(r => setTimeout(r, 600));

    // type + submit (form for AlicePro, Enter for Alice)
    await tc("Runtime.evaluate", {
      expression: `(()=>{
        const t = document.querySelector('textarea#message-textarea') || document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea');
        if (!t) return 'no textarea';
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        t.focus(); setter.call(t, ${JSON.stringify(test.prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()`, returnByValue: true,
    });
    await new Promise(r => setTimeout(r, 600));
    // Try form first (Alice Pro), then Enter (Alice)
    await tc("Runtime.evaluate", {
      expression: `(()=>{
        const form = document.querySelector('#message-form');
        if (form && form.requestSubmit) { const btn=form.querySelector('button.submit')||form.querySelector('button[type=submit]'); btn?form.requestSubmit(btn):form.requestSubmit(); return 'form'; }
        return 'no-form';
      })()`, returnByValue: true,
    });
    await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

    // wait for response, get exact fence lang + check for data: links
    let info = null, lastLen = 0, stable = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const r = await tc("Runtime.evaluate", {
        expression: `(()=>{
          const codes = [...document.querySelectorAll('pre code')];
          const dataLinks = [...document.querySelectorAll('a[href^="data:"]')];
          const lastBubble = [...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop();
          const text = lastBubble?.textContent || '';
          return {
            codeLangs: codes.map(c => String(c.className).match(/language-([^\\s]+)/)?.[1]),
            codeHeads: codes.map(c => c.textContent.slice(0,80)),
            dataLinkCount: dataLinks.length,
            dataLinkTexts: dataLinks.map(a => a.textContent.slice(0,60)),
            bubbleLen: text.length,
          };
        })()`, returnByValue: true,
      });
      const v = r.result?.value;
      if (v && v.bubbleLen > 30) {
        if (v.bubbleLen === lastLen) { stable++; if (stable >= 3) { info = v; break; } }
        else { lastLen = v.bubbleLen; stable = 0; }
      }
    }

    if (info) {
      console.log(`  fence langs: ${JSON.stringify(info.codeLangs)}`);
      if (info.dataLinkCount > 0) console.log(`  data: links present: ${JSON.stringify(info.dataLinkTexts)}`);
      results.push({ host: host.label, test: test.id, langs: info.codeLangs, dataLinks: info.dataLinkCount });
    } else {
      console.log("  ✗ no response");
      results.push({ host: host.label, test: test.id, error: "timeout" });
    }

    tw.close();
  }
}
bw.close();

console.log("\n\n========== SUMMARY ==========");
for (const r of results) {
  console.log(`${r.host} / ${r.test}: langs=${JSON.stringify(r.langs)}, dataLinks=${r.dataLinks ?? 0}${r.error ? ' ('+r.error+')' : ''}`);
}

// Auto-analyze: which workarounds still fire?
console.log("\n\n========== WORKAROUND USAGE ==========");
const needsJsonSniff = results.filter(r => r.langs && r.langs.includes("json") && !r.langs.some(l => /^bap-/.test(l)));
const needsMarkdownSniff = results.filter(r => r.dataLinks > 0);
console.log(`Smart JSON-sniff still required: ${needsJsonSniff.length} cases →`, needsJsonSniff.map(r => `${r.host}/${r.test}`));
console.log(`Smart markdown-link sniff still required: ${needsMarkdownSniff.length} cases →`, needsMarkdownSniff.map(r => `${r.host}/${r.test}`));
