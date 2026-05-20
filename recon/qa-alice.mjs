// QA runner specifically for Alice (regular, NOT AlicePro). Tests all bap-*
// fence handlers via WS-injection path. AlicePro is handled separately via
// the source-file workflow (no auto-test possible without project setup).

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
  ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { const x = p.get(m.id); p.delete(m.id); m.error ? x.rej(m.error) : x.res(m.result); }});
  const call = (method, params = {}) => new Promise((res, rej) => { const id = n++; p.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable"); await call("Page.enable");
  return { ws, call };
}

const SCRDIR = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots\\qa-alice";
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
    check: `(()=>{ const btn=[...document.querySelectorAll('button')].find(b=>/Скачать \\.pptx/.test(b.textContent||'')); return { ok: !!btn }; })()`,
  },
  {
    id: "03-excel",
    prompt: "Сделай Excel таблицу 'мои покупки' с 3 строками. Используй формат ```bap-excel с JSON {fileName,sheets:[{name,rows:[[...]]}]}.",
    check: `(()=>{ const btn=[...document.querySelectorAll('button')].find(b=>/Скачать \\.xlsx/.test(b.textContent||'')); return { ok: !!btn }; })()`,
  },
  {
    id: "04-docx",
    prompt: "Сделай Word документ — список покупок (3-4 пункта). Используй формат ```bap-docx с JSON {fileName,paragraphs:[{text,heading?,bold?}]}.",
    check: `(()=>{ const btn=[...document.querySelectorAll('button')].find(b=>/Скачать \\.docx/.test(b.textContent||'')); return { ok: !!btn }; })()`,
  },
  {
    id: "05-filename",
    prompt: "Напиши на JS функцию для расчёта факториала. Оформи как ```filename=fact.js — это код-блок, НЕ markdown-ссылку.",
    check: `(()=>{ const btn=[...document.querySelectorAll('button')].find(b=>/⬇.*fact\\.js/i.test(b.textContent||'')); return { ok: !!btn }; })()`,
  },
  {
    id: "06-visualizer",
    prompt: "Нарисуй интерактивную схему: солнце с 4 планетами. Используй формат ```bap-visualizer с HTML+SVG (можно с анимацией).",
    check: `(()=>{ const ifr=document.querySelector('.bap-visualizer-wrapper iframe'); return { ok: !!ifr, srcdocLen: ifr?.srcdoc?.length || 0 }; })()`,
  },
  {
    id: "07-latex-big",
    prompt: "Напиши матрицу 4×4 через ```bap-latex (используй \\begin{bmatrix}). После — длинная формула det с раскрытием.",
    check: `(()=>{ const wr=document.querySelector('.bap-latex-wrapper'); const ifr=wr?.querySelector('iframe'); const h=parseInt(ifr?.style?.height)||0; return { ok: h >= 100, height: h }; })()`,
  },
  {
    id: "08-ask-long",
    prompt: "Помоги мне выбрать стек для веб-приложения. Задай 3 уточняющих вопроса через ```bap-ask. Каждый type=single с 5 опциями длинных названий.",
    check: `(()=>{ const panel=document.querySelector('.bap-question-panel'); if (!panel) return { ok:false }; const opts=[...panel.querySelectorAll('.bap-option-item')]; const ovf=opts.some(o=>o.scrollWidth > o.clientWidth + 2); return { ok: !ovf && opts.length > 0, opts: opts.length, overflowing: ovf }; })()`,
  },
  {
    id: "09-memory",
    prompt: "Запомни: меня зовут Семён, я архитектор. Сохрани через ```bap-memory с JSON массивом [{key:user_name,value:Семён,importance:always},{key:user_role,value:архитектор,importance:always}].",
    check: `(()=>{ const chip=[...document.querySelectorAll('div')].find(d=>/запомнил/.test(d.textContent||'')); return { ok: !!chip, chip: chip?.textContent?.slice(0,80) }; })()`,
  },
  {
    id: "10-character",
    prompt: "Создай персонажа для RP: детектив Шерлок. Используй ```bap-character с JSON {name,usage,content}.",
    check: `(()=>{ const chip=[...document.querySelectorAll('div')].find(d=>/сохранил персонажа/.test(d.textContent||'')); return { ok: !!chip, chip: chip?.textContent?.slice(0,80) }; })()`,
  },
  {
    id: "11-zip",
    prompt: "Сделай минимальный Node.js проект (3 файла). Упакуй через ```bap-zip с JSON {fileName,files:[{path,content}]}.",
    check: `(()=>{ const btn=[...document.querySelectorAll('button')].find(b=>/Скачать \\.zip/.test(b.textContent||'')); return { ok: !!btn }; })()`,
  },
  {
    id: "12-run-python",
    prompt: "Посчитай sum(range(1,101)). Используй формат ```bap-run-python чтобы расширение само запустило код. Внутри блока — только print(sum(range(1,101))).",
    // User-gesture для запуска Pyodide. Кнопка «Run Python» disabled пока
    // runtime грузится — поэтому ставим interval-click который кликает каждые
    // 2 сек пока в выводе не появится «5050». Auto-stops через 60 сек.
    preCheck: `(()=>{ const c=document.querySelector('.bap-auto-run-container'); if(!c) return 'no container'; window.__balRunRetry = setInterval(() => { const cur = document.querySelector('.bap-auto-run-container'); if (!cur) return; if (/\\b5050\\b/.test(cur.textContent||'')) { clearInterval(window.__balRunRetry); return; } const btn = [...cur.querySelectorAll('button')].find(b => /Run Python|▶/i.test(b.textContent||'') && !b.disabled); if (btn) btn.click(); }, 2000); setTimeout(() => { try { clearInterval(window.__balRunRetry); } catch(e){} }, 60000); return 'retry-click started'; })()`,
    // Poll до 90 сек на появление вывода «5050» (e2e: Pyodide load + execute).
    check: `(async () => { for (let i = 0; i < 90; i++) { const c=document.querySelector('.bap-auto-run-container'); const text=c?.textContent||''; if (/\\b5050\\b/.test(text)) return { ok: true, out: text.slice(0,200), iter: i }; await new Promise(r => setTimeout(r, 1000)); } const c=document.querySelector('.bap-auto-run-container'); const text=c?.textContent||''; return { ok: /\\b5050\\b/.test(text), out: text.slice(0,200), timeout: true }; })()`,
    extraWait: 1000,
    // Reload убивает Pyodide runtime — для этого кейса retry-через-reload запрещён.
    noReloadRetry: true,
  },
];

const filterId = process.argv[2];
const results = [];

for (const test of tests) {
  if (filterId && !test.id.includes(filterId)) continue;
  console.log(`\n=== ${test.id} ===`);
  process.stdout.write("");

  const { ws: bw, call: bc } = await attachBrowser();
  const newTab = await bc("Target.createTarget", { url: "https://alice.yandex.ru/", background: false });
  await new Promise(r => setTimeout(r, 8000));
  const { ws: tw, call: tc } = await attachTab(newTab.targetId);
  await tc("Runtime.evaluate", { expression: `(()=>{
    const close = () => { document.querySelectorAll('.bap-close-btn').forEach(b=>b.click?.()); const btn=[...document.querySelectorAll('button')].find(b=>/Понятно|спасибо|OK/i.test(b.textContent||'')); if(btn) btn.click(); };
    close(); setTimeout(close, 500); setTimeout(close, 1500);
    return 'ok';
  })()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 1800));

  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea') || document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus(); setter.call(t, ${JSON.stringify(test.prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 500));
  await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

  let lastLen = 0, stable = 0;
  for (let i = 0; i < 70; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{ const last=[...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop(); return last?.textContent?.length || 0; })()`,
      returnByValue: true,
    });
    const len = r.result.value;
    if (len > 30) {
      if (len === lastLen) { stable++; if (stable >= 5) break; }
      else { lastLen = len; stable = 0; }
    }
  }
  // preCheck — выполняется перед основным extraWait + check. Например, клик
  // «Run Python» нужен как user-gesture для запуска Pyodide в headless-CDP.
  if (test.preCheck) {
    const pr = await tc("Runtime.evaluate", { expression: test.preCheck, returnByValue: true });
    console.log("  preCheck:", pr.result.value);
  }
  await new Promise(r => setTimeout(r, test.extraWait || 4000));

  async function runCheck() {
    const isAsync = String(test.check).trim().startsWith("(async") || String(test.check).includes("await ");
    const r = await tc("Runtime.evaluate", { expression: test.check, returnByValue: true, awaitPromise: isAsync });
    return r.result.value;
  }

  let v = await runCheck();
  console.log("  first check:", JSON.stringify(v));

  // Retry с обновлением страницы: extension мог обработать <pre> до того как
  // Алиса дострелила всю разметку. Reload форсит свежий scan по полному DOM.
  if (!v?.ok && !test.noReloadRetry) {
    console.log("  ↻ reloading and retrying...");
    await tc("Page.reload", { ignoreCache: true });
    await new Promise(r => setTimeout(r, 9000));
    await tc("Runtime.evaluate", {
      expression: `document.body.setAttribute('data-bal-test-trigger', String(Date.now()))`,
      returnByValue: true,
    });
    await new Promise(r => setTimeout(r, 2500));
    const v2 = await runCheck();
    console.log("  after reload:", JSON.stringify(v2));
    if (v2?.ok) v = v2;
  }
  console.log(`  ${v?.ok ? '✓ PASS' : '✗ FAIL'}`);

  const ss = await tc("Page.captureScreenshot", { format: "png" });
  const out = `${SCRDIR}\\${test.id}.png`;
  fs.writeFileSync(out, Buffer.from(ss.data, "base64"));
  console.log("  screenshot:", out);

  results.push({ id: test.id, ok: !!v?.ok, result: v });
  tw.close(); bw.close();

  // Flush stdout
  await new Promise(r => process.stdout.write("", r));
}

console.log("\n\n========== SUMMARY (Alice regular) ==========");
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.id}`);
const passed = results.filter(r => r.ok).length;
console.log(`\nTotal: ${passed}/${results.length}`);
process.exit(0);

