// Test 3 fixes:
//   1. bap-ask panel layout doesn't overflow on long options (CSS test)
//   2. bap-latex renders huge formula with proper scroll
//   3. TOOL_FENCE_CHEATSHEET reaches Alice in every system-prompt-bearing turn

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

const tests = [
  {
    id: "ask-long",
    prompt: "Помоги мне выбрать стек для веб-приложения. Сначала задай мне 3 уточняющих вопроса через ```bap-ask. Каждый вопрос должен иметь type=single и 5+ опций с длинными названиями (например, 'Vue.js 3 с Composition API и TypeScript' или 'React 18 с Next.js App Router').",
    checkExpr: `(()=>{
      const panel = document.querySelector('.bap-question-panel');
      if (!panel) return { ok: false, why: 'no panel' };
      const rect = panel.getBoundingClientRect();
      const opts = [...panel.querySelectorAll('.bap-option-item')];
      const overflowing = opts.some(o => o.scrollWidth > o.clientWidth + 2);
      return {
        ok: !overflowing && rect.width > 0 && rect.height > 0,
        panelW: rect.width,
        panelH: rect.height,
        opts: opts.length,
        overflowing,
      };
    })()`,
  },
  {
    id: "latex-big",
    prompt: "Напиши матрицу 4x4 определителя через формат ```bap-latex. Используй \\begin{bmatrix} с 16 разными элементами. После матрицы добавь длинную формулу det = ... через \\cdot и индексы.",
    checkExpr: `(()=>{
      const wrappers = [...document.querySelectorAll('.bap-latex-wrapper')];
      if (!wrappers.length) return { ok: false, why: 'no wrapper' };
      const wr = wrappers[0];
      const iframe = wr.querySelector('iframe');
      const hStr = iframe?.style?.height || '';
      const hPx = parseInt(hStr) || 0;
      // For a 4x4 matrix the rendered iframe should be at least 120px tall.
      return {
        ok: hPx >= 100,
        iframeHeight: hPx,
        wrapperOverflow: getComputedStyle(wr).overflow,
      };
    })()`,
  },
  {
    id: "tools-cheatsheet",
    prompt: "Назови ПЕРЕЧИСЛИ все форматы кодовых блоков расширения Better Alice, которые ты знаешь (bap-*). Просто список через запятую. Не используй ```bap-ask.",
    checkExpr: `(()=>{
      const lastBubble = [...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop();
      const text = (lastBubble?.textContent || '').toLowerCase();
      const knows = ['bap-docx', 'bap-pptx', 'bap-excel', 'bap-latex', 'bap-zip', 'bap-ask', 'bap-memory', 'bap-character', 'bap-visualizer', 'bap-run-python']
        .filter(t => text.includes(t));
      return { ok: knows.length >= 6, knowsCount: knows.length, knows };
    })()`,
  },
];

for (const host of [
  { url: "https://alice.yandex.ru/", label: "Alice" },
  { url: "https://alicepro.yandex.ru/expert", label: "Alice Pro" },
]) {
  for (const test of tests) {
    console.log(`\n=== ${host.label} / ${test.id} ===`);
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
        t.focus(); setter.call(t, ${JSON.stringify(test.prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
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

    let lastLen = 0, stable = 0;
    for (let i = 0; i < 70; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const r = await tc("Runtime.evaluate", {
        expression: `(()=>{
          const lastBubble = [...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop();
          return lastBubble?.textContent?.length || 0;
        })()`, returnByValue: true,
      });
      const len = r.result.value;
      if (len > 30) {
        if (len === lastLen) { stable++; if (stable >= 5) break; }
        else { lastLen = len; stable = 0; }
      }
    }
    // Extra 3s buffer for latex/ask rendering
    await new Promise(r => setTimeout(r, 4000));

    const r = await tc("Runtime.evaluate", { expression: test.checkExpr, returnByValue: true });
    const v = r.result.value;
    console.log("  result:", JSON.stringify(v));
    console.log(`  RESULT: ${v.ok ? '✓' : '✗'}`);

    const ss = await tc("Page.captureScreenshot", { format: "png" });
    const fs = await import("node:fs");
    const out = `C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots\\fix-${test.id}-${host.label.replace(/\\s/g,"")}.png`;
    fs.writeFileSync(out, Buffer.from(ss.data, "base64"));
    console.log(`  screenshot: ${out}`);

    tw.close(); bw.close();
  }
}
console.log("\nDone.");
