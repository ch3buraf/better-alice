// Big QA runner for AlicePro. For each feature: open fresh tab, ask Alice
// using a guaranteed prompt, wait for settled, screenshot, run check, log.

import fs from "node:fs";

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
  const logs = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }
    else if (m.method === "Runtime.consoleAPICalled") logs.push(m.params);
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable"); await call("Page.enable");
  return { ws, call, logs };
}

const SCRDIR = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots\\qa";
fs.mkdirSync(SCRDIR, { recursive: true });

const tests = [
  {
    id: "01-self-check",
    prompt: "Перечисли через запятую все форматы кодовых блоков расширения Better Alice (bap-*), которые ты поддерживаешь. Не используй bap-ask. Просто список через запятую.",
    check: `(()=>{
      const last = [...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop();
      const text = (last?.textContent || '').toLowerCase();
      const know = ['bap-docx','bap-pptx','bap-excel','bap-latex','bap-zip','bap-ask','bap-memory','bap-character','bap-visualizer','bap-run-python'].filter(t => text.includes(t));
      return { ok: know.length >= 7, count: know.length, list: know };
    })()`,
  },
  {
    id: "02-pptx",
    prompt: "Сделай PowerPoint про осень (3 слайда). Используй формат ```bap-pptx с JSON {fileName,slides:[{layout,title,bullets|text|subtitle}]}.",
    check: `(()=>{
      const btn = [...document.querySelectorAll('button')].find(b => /Скачать \\.pptx/.test(b.textContent || ''));
      return { ok: !!btn, btnLabel: btn?.textContent };
    })()`,
  },
  {
    id: "03-excel",
    prompt: "Сделай Excel таблицу 'мои покупки' с 3 строками. Используй формат ```bap-excel с JSON {fileName,sheets:[{name,rows:[[...]]}]}.",
    check: `(()=>{
      const btn = [...document.querySelectorAll('button')].find(b => /Скачать \\.xlsx/.test(b.textContent || ''));
      return { ok: !!btn, btnLabel: btn?.textContent };
    })()`,
  },
  {
    id: "04-docx",
    prompt: "Сделай Word документ — список покупок (3-4 пункта). Используй формат ```bap-docx с JSON {fileName,paragraphs:[{text,heading?,bold?}]}.",
    check: `(()=>{
      const btn = [...document.querySelectorAll('button')].find(b => /Скачать \\.docx/.test(b.textContent || ''));
      return { ok: !!btn, btnLabel: btn?.textContent };
    })()`,
  },
  {
    id: "05-filename",
    prompt: "Напиши на JS функцию для расчёта факториала. Оформи как ```filename=fact.js — это код-блок, НЕ markdown-ссылку.",
    check: `(()=>{
      const btn = [...document.querySelectorAll('button')].find(b => /⬇.*fact\\.js/i.test(b.textContent || ''));
      return { ok: !!btn, btnLabel: btn?.textContent };
    })()`,
  },
  {
    id: "06-visualizer",
    prompt: "Нарисуй интерактивную схему: солнце с 4 планетами. Используй формат ```bap-visualizer с HTML+SVG (можно с анимацией).",
    check: `(()=>{
      const wr = document.querySelector('.bap-visualizer-wrapper');
      const iframe = wr?.querySelector('iframe');
      return { ok: !!iframe, srcdocLen: iframe?.srcdoc?.length || 0 };
    })()`,
  },
  {
    id: "07-latex-big",
    prompt: "Напиши матрицу определителя 4×4 через ```bap-latex (используй \\begin{bmatrix}). После матрицы — длинная формула det с раскрытием по первой строке.",
    check: `(()=>{
      const wr = document.querySelector('.bap-latex-wrapper');
      const iframe = wr?.querySelector('iframe');
      const h = parseInt(iframe?.style?.height) || 0;
      return { ok: h >= 100, height: h, wrapperOverflow: wr ? getComputedStyle(wr).overflow : 'no-wrapper' };
    })()`,
  },
  {
    id: "08-ask-long",
    prompt: "Помоги мне выбрать стек для веб-приложения. Сначала задай 3 уточняющих вопроса через ```bap-ask. Каждый вопрос type=single с 5 опциями длинных названий (типа 'Vue.js 3 с Composition API').",
    check: `(()=>{
      const panel = document.querySelector('.bap-question-panel');
      if (!panel) return { ok: false, why: 'no panel' };
      const rect = panel.getBoundingClientRect();
      const opts = [...panel.querySelectorAll('.bap-option-item')];
      const overflowing = opts.some(o => o.scrollWidth > o.clientWidth + 2);
      return { ok: !overflowing && rect.height > 0, panelW: rect.width, panelH: rect.height, opts: opts.length, overflowing };
    })()`,
  },
  {
    id: "09-memory",
    prompt: "Запомни обо мне: меня зовут Семён и я архитектор софта. Сохрани через ```bap-memory с JSON массивом [{key:user_name,value:Семён,importance:always},{key:user_role,value:архитектор,importance:always}].",
    check: `(async()=>{
      const chip = [...document.querySelectorAll('div')].find(d => /запомнил/.test(d.textContent || ''));
      let storedKeys = [];
      try {
        const st = await chrome.storage.local.get(['bap_memories']);
        storedKeys = Object.keys(st.bap_memories || {});
      } catch(e) {}
      return { ok: !!chip || storedKeys.length > 0, chipText: chip?.textContent?.slice(0,80), storedKeys };
    })()`,
    awaitPromise: true,
  },
  {
    id: "10-character",
    prompt: "Создай мне персонажа для ролевой игры: детектив Шерлок Холмс. Используй ```bap-character с JSON {name,usage,content}.",
    check: `(async()=>{
      const chip = [...document.querySelectorAll('div')].find(d => /сохранил персонажа/.test(d.textContent || ''));
      let names = [];
      try {
        const st = await chrome.storage.local.get(['bap_characters']);
        names = (st.bap_characters || []).map(c => c.name);
      } catch(e) {}
      return { ok: !!chip || names.length > 0, chipText: chip?.textContent?.slice(0,80), names };
    })()`,
    awaitPromise: true,
  },
  {
    id: "11-zip",
    prompt: "Сделай минимальный Node.js проект 'hello-server' с 3 файлами (package.json, server.js, README.md). Упакуй через ```bap-zip с JSON {fileName,files:[{path,content}]}.",
    check: `(()=>{
      const btn = [...document.querySelectorAll('button')].find(b => /Скачать \\.zip/.test(b.textContent || ''));
      return { ok: !!btn, btnLabel: btn?.textContent };
    })()`,
  },
  {
    id: "12-run-python",
    prompt: "Посчитай сумму чисел от 1 до 100. Используй формат ```bap-run-python чтобы расширение само запустило код. Внутри блока — только print(sum(range(1,101))).",
    check: `(()=>{
      const c = document.querySelector('.bap-auto-run-container');
      const text = c?.textContent || '';
      return { ok: /\\b5050\\b/.test(text), output: text.slice(0, 200) };
    })()`,
    extraWait: 25000,
  },
];

async function runTest(test) {
  const filterId = process.argv[2];
  if (filterId && !test.id.includes(filterId)) return null;
  console.log(`\n=== ${test.id} ===`);
  const { ws: bw, call: bc } = await attachBrowser();
  const newTab = await bc("Target.createTarget", { url: "https://alicepro.yandex.ru/expert", background: false });
  await new Promise(r => setTimeout(r, 10000));
  const { ws: tw, call: tc } = await attachTab(newTab.targetId);
  await tc("Runtime.evaluate", { expression: `(()=>{
    const close = () => { document.querySelectorAll('.bap-close-btn').forEach(b=>b.click?.()); const btn=[...document.querySelectorAll('button')].find(b=>/Понятно|спасибо|OK/i.test(b.textContent||'')); if(btn) btn.click(); };
    close(); setTimeout(close, 500); setTimeout(close, 1500);
    return 'ok';
  })()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 2000));

  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus(); setter.call(t, ${JSON.stringify(test.prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 700));
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const form = document.querySelector('#message-form');
      if (form?.requestSubmit) { const btn=form.querySelector('button.submit')||form.querySelector('button[type=submit]'); btn?form.requestSubmit(btn):form.requestSubmit(); return 'form'; }
      return 'no-form';
    })()`, returnByValue: true,
  });

  // Wait for settled message
  let lastLen = 0, stable = 0;
  for (let i = 0; i < 70; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{
        const last = [...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop();
        return last?.textContent?.length || 0;
      })()`, returnByValue: true,
    });
    const len = r.result.value;
    if (len > 30) {
      if (len === lastLen) { stable++; if (stable >= 5) break; }
      else { lastLen = len; stable = 0; }
    }
  }
  await new Promise(r => setTimeout(r, test.extraWait || 4000));

  const r = await tc("Runtime.evaluate", { expression: test.check, returnByValue: true, awaitPromise: !!test.awaitPromise });
  const v = r.result.value;
  console.log("  result:", JSON.stringify(v));
  console.log(`  ${v?.ok ? '✓ PASS' : '✗ FAIL'}`);

  const ss = await tc("Page.captureScreenshot", { format: "png" });
  const out = `${SCRDIR}\\${test.id}.png`;
  fs.writeFileSync(out, Buffer.from(ss.data, "base64"));
  console.log("  screenshot:", out);

  tw.close(); bw.close();
  return { id: test.id, ok: v?.ok, result: v };
}

const results = [];
for (const test of tests) {
  const r = await runTest(test);
  if (r) results.push(r);
}

console.log("\n\n========== SUMMARY ==========");
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.id}`);
const passed = results.filter(r => r.ok).length;
console.log(`\nTotal: ${passed}/${results.length} passing`);
