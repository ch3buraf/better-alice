// QA runner for AlicePro INSIDE a project that already has the
// system_prompt.txt loaded as a source. We navigate to the project URL,
// click "Создать чат", send the prompt, screenshot.

import fs from "node:fs";

const PROJECT_ID = "f67d3ec3542011f1a4dafe1ae4d1962b"; // юзер собрал у себя
const PROJECT_URL = `https://alicepro.yandex.ru/expert/projects/${PROJECT_ID}`;
// Использовать готовый чат пользователя в проекте (source-файл активен)
const CHAT_URL = `https://alicepro.yandex.ru/expert/projects/${PROJECT_ID}/chats/f1c8e246542111f1aac0666e66f5a9a9`;

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

const SCRDIR = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\screenshots\\qa-pro";
fs.mkdirSync(SCRDIR, { recursive: true });

const tests = [
  { id: "01-self-check", prompt: "Перечисли через запятую все форматы кодовых блоков расширения Better Alice (bap-*), которые ты поддерживаешь. Просто список через запятую.",
    check: `(()=>{ const t=(document.body?.textContent||'').toLowerCase(); const k=['bap-docx','bap-pptx','bap-excel','bap-latex','bap-zip','bap-ask','bap-memory','bap-character','bap-visualizer','bap-run-python'].filter(x=>t.includes(x)); return { ok: k.length>=7, count: k.length, list: k }; })()` },
  { id: "02-pptx", prompt: "Сделай PowerPoint про осень (3 слайда). Используй формат ```bap-pptx с JSON {fileName,slides:[{layout,title,bullets|text|subtitle}]}.",
    countSelector: "button", filterRe: "Скачать \\.pptx" },
  { id: "03-excel", prompt: "Сделай Excel таблицу 'мои покупки' с 3 строками. Используй ```bap-excel с JSON {fileName,sheets:[{name,rows:[[...]]}]}.",
    countSelector: "button", filterRe: "Скачать \\.xlsx" },
  { id: "04-docx", prompt: "Сделай Word документ — список покупок (3-4 пункта). Используй ```bap-docx с JSON {fileName,paragraphs:[{text,heading?,bold?}]}.",
    countSelector: "button", filterRe: "Скачать \\.docx" },
  { id: "05-filename", prompt: "Напиши на JS функцию для расчёта факториала. Оформи как ```filename=fact.js — код-блок, НЕ markdown-ссылку. ВАЖНО: в первой строке тела продублируй имя как `// filename: fact.js`.",
    countSelector: "button", filterRe: "⬇.*fact\\.js" },
  { id: "06-visualizer", prompt: "Нарисуй интерактивную схему: солнце с 4 планетами. Используй ```bap-visualizer с HTML+SVG.",
    countSelector: ".bap-visualizer-wrapper", filterRe: "" },
  { id: "07-latex-big", prompt: "Напиши матрицу 4×4 через ```bap-latex (используй \\begin{bmatrix}). После — длинная формула det с раскрытием.",
    countSelector: ".bap-latex-wrapper", filterRe: "" },
  { id: "08-ask-long", prompt: "Помоги мне выбрать стек для веб-приложения. Задай 3 уточняющих вопроса через ```bap-ask. Каждый type=single с 5 опциями длинных названий.",
    countSelector: ".bap-question-panel", filterRe: "" },
  { id: "09-memory", prompt: "Запомни: меня зовут Семён, я архитектор. Сохрани через ```bap-memory с JSON [{key:user_name,value:Семён,importance:always},{key:user_role,value:архитектор,importance:always}].",
    countSelector: ".bap-memory-chip", filterRe: "" },
  { id: "10-character", prompt: "Создай персонажа для RP: детектив Шерлок. Используй ```bap-character с JSON {name,usage,content}.",
    countSelector: ".bap-character-chip", filterRe: "" },
  { id: "11-zip", prompt: "Сделай минимальный Node.js проект (3 файла). Упакуй через ```bap-zip с JSON {fileName,files:[{path,content}]}.",
    countSelector: "button", filterRe: "Скачать \\.zip" },
  { id: "12-run-python", prompt: "Посчитай sum(range(1,101)). Используй ```bap-run-python чтобы расширение само запустило код. Внутри блока — только print(sum(range(1,101))).",
    // User-gesture для Pyodide. Interval-click каждые 2 сек до появления «5050»
    // или 60 сек timeout. Кнопка disabled во время Pyodide-load — нужны retries.
    preCheck: `(()=>{ const c=document.querySelector('.bap-auto-run-container'); if(!c) return 'no container'; window.__balRunRetry = setInterval(() => { const cur = document.querySelector('.bap-auto-run-container'); if (!cur) return; if (/\\b5050\\b/.test(cur.textContent||'')) { clearInterval(window.__balRunRetry); return; } const btn = [...cur.querySelectorAll('button')].find(b => /Run Python|▶/i.test(b.textContent||'') && !b.disabled); if (btn) btn.click(); }, 2000); setTimeout(() => { try { clearInterval(window.__balRunRetry); } catch(e){} }, 90000); return 'retry-click started'; })()`,
    // Async poll до 90 сек на появление вывода «5050». Pyodide грузится из CDN
    // и может медленно стартовать в CDP-headless; e2e check ждёт реальный output.
    check: `(async () => { for (let i = 0; i < 90; i++) { const c=document.querySelector('.bap-auto-run-container'); const text=c?.textContent||''; if (/\\b5050\\b/.test(text)) return { ok: true, out: text.slice(0,200), iter: i }; await new Promise(r => setTimeout(r, 1000)); } const c=document.querySelector('.bap-auto-run-container'); const text=c?.textContent||''; return { ok: /\\b5050\\b/.test(text), out: text.slice(0,200), timeout: true }; })()`,
    extraWait: 1000, noReloadRetry: true },
];

const filterId = process.argv[2];
const results = [];

for (const test of tests) {
  if (filterId && !test.id.includes(filterId)) continue;
  console.log(`\n=== ${test.id} ===`); process.stdout.write("");

  const { ws: bw, call: bc } = await attachBrowser();
  // Open the PROJECT landing page (not a specific chat). We then click
  // segmented-toggle "Чаты" to reveal the in-project "Создать чат" button
  // and click it to land in a FRESH chat that has the source-file attached.
  const newTab = await bc("Target.createTarget", { url: PROJECT_URL, background: false });
  await new Promise(r => setTimeout(r, 10000));
  const { ws: tw, call: tc } = await attachTab(newTab.targetId);

  await tc("Runtime.evaluate", { expression: `(()=>{
    const close = () => {
      document.querySelectorAll('.bap-close-btn').forEach(b=>b.click?.());
      const btn=[...document.querySelectorAll('button')].find(b=>/Понятно|спасибо|OK/i.test(b.textContent||''));
      if(btn) btn.click();
    };
    close(); setTimeout(close, 500); setTimeout(close, 1500);
    return 'ok';
  })()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 1800));

  // 1. Click segmented-toggle "Чаты" inside project view (reveals new-chat-form)
  await tc("Runtime.evaluate", { expression: `(()=>{
    const btn = [...document.querySelectorAll('button.segmented-toggle-element, button[class*="segmented-toggle"]')].find(b => /Чаты/.test(b.textContent||''));
    if (btn) { btn.click(); return 'toggled'; }
    return 'no-toggle';
  })()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 1500));

  // 2. Click the "Создать чат" button INSIDE form.new-chat-form (in-project)
  const clickRes = await tc("Runtime.evaluate", { expression: `(()=>{
    const btn = document.querySelector('form.new-chat-form button');
    if (btn) { btn.click(); return 'created-in-project'; }
    return 'no-new-chat-button';
  })()`, returnByValue: true });
  console.log("  new chat:", clickRes.result.value);
  await new Promise(r => setTimeout(r, 5000));

  // CLEAR all extension-added elements + reset ALL attached flags so the
  // scanner re-processes every <pre> after we trigger a re-scan.
  await tc("Runtime.evaluate", { expression: `(()=>{
    // Close any open QuestionPanel (click ×) before starting test
    document.querySelectorAll('.bap-question-panel .bap-close-btn').forEach(b => b.click?.());
    document.querySelectorAll('.bap-question-panel').forEach(p => p.remove());
    document.querySelectorAll('.bap-latex-wrapper, .bap-visualizer-wrapper, .bap-auto-run-container, .bap-memory-chip, .bap-character-chip').forEach(el => el.remove());
    [...document.querySelectorAll('button')].filter(b => /Скачать \\.(pptx|xlsx|docx|zip)|📄|📊|📈|📦|⬇/.test(b.textContent || '')).forEach(b => b.remove());
    document.querySelectorAll('pre').forEach(p => {
      delete p.dataset.bdsCodeDownloadAttached;
      delete p.dataset.balMemoryDone;
      delete p.dataset.balCharacterDone;
      delete p.dataset.balAutoRunDone;
      delete p.dataset.balAskDispatched;
      p.style.display = '';
      p.style.opacity = '';
      p.style.maxHeight = '';
    });
    // Force re-scan by jiggling DOM so MutationObserver fires
    document.body.setAttribute('data-bal-test-trigger', String(Date.now()));
    return 'cleared';
  })()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 1500)); // give scanner debounce + reprocess time

  // Snapshot body text length BEFORE submit; we'll watch for growth.
  const beforeRes = await tc("Runtime.evaluate", {
    expression: `(document.body?.textContent || '').length`,
    returnByValue: true,
  });
  const bodyLenBefore = beforeRes.result.value || 0;

  // Count matching elements BEFORE submit so we can detect a delta
  const selJson = JSON.stringify(test.countSelector || "");
  const reJson = JSON.stringify(test.filterRe || "");
  const countBeforeRes = await tc("Runtime.evaluate", {
    expression: `(()=>{
      const sel = ${selJson};
      if (!sel) return 0;
      const nodes = [...document.querySelectorAll(sel)];
      const re = ${reJson};
      if (!re) return nodes.length;
      const rx = new RegExp(re);
      return nodes.filter(n => rx.test(n.textContent || '')).length;
    })()`,
    returnByValue: true,
  });
  const countBefore = countBeforeRes.result.value || 0;

  // Type the prompt
  const typeRes = await tc("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea') || document.querySelector('textarea');
      if (!t) return 'no textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus(); setter.call(t, ${JSON.stringify(test.prompt)}); t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`, returnByValue: true,
  });
  console.log("  type:", typeRes.result.value, "| bodyLen before:", bodyLenBefore);
  await new Promise(r => setTimeout(r, 600));

  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const form = document.querySelector('#message-form');
      if (form?.requestSubmit) { const btn=form.querySelector('button[type=submit]')||form.querySelector('button.submit'); btn?form.requestSubmit(btn):form.requestSubmit(); return 'form'; }
      return 'no-form';
    })()`, returnByValue: true,
  });

  // Wait until body text grows (assistant streaming) AND stabilises
  let lastLen = bodyLenBefore, stable = 0;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await tc("Runtime.evaluate", {
      expression: `(document.body?.textContent || '').length`,
      returnByValue: true,
    });
    const len = r.result.value || 0;
    if (len > bodyLenBefore + 80) {
      if (len === lastLen) { stable++; if (stable >= 5) break; }
      else { lastLen = len; stable = 0; }
    }
  }
  // preCheck — выполняется перед основным extraWait + check. Используется,
  // например, чтобы кликнуть «Run» (user-gesture для auto-run в headless-CDP).
  if (test.preCheck) {
    const pr = await tc("Runtime.evaluate", { expression: test.preCheck, returnByValue: true });
    console.log("  preCheck:", pr.result.value);
  }
  await new Promise(r => setTimeout(r, test.extraWait || 4000));

  // Helper: run the check expression OR the count-delta heuristic. Returns
  // {ok, ...}. Called once on first pass, and once more after Page.reload
  // if the first pass failed (some features only attach after a fresh
  // scanner cycle — e.g. filename= where AlicePro stripped the marker).
  async function runCheck(label) {
    if (test.check) {
      const isAsync = String(test.check).trim().startsWith("(async") || String(test.check).includes("await ");
      const r = await tc("Runtime.evaluate", { expression: test.check, returnByValue: true, awaitPromise: isAsync });
      return r.result.value;
    }
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{
        const sel = ${selJson};
        if (!sel) return { count: 0 };
        const nodes = [...document.querySelectorAll(sel)];
        const re = ${reJson};
        const filtered = re ? nodes.filter(n => new RegExp(re).test(n.textContent || '')) : nodes;
        return { count: filtered.length, lastText: filtered[filtered.length-1]?.textContent?.slice(0,100) };
      })()`,
      returnByValue: true,
    });
    const countAfter = r.result.value?.count || 0;
    return { ok: countAfter > countBefore, before: countBefore, after: countAfter, lastText: r.result.value?.lastText, attempt: label };
  }

  let v = await runCheck("first");
  console.log("  first check:", JSON.stringify(v));

  // Retry с обновлением страницы: иногда extension не успевает обработать
  // блок до того как мы проверили (особенно для filename= блоков где Alice
  // могла потерять fence-маркер и handler цеплялся через content-sniff
  // только во время следующего mutation cycle).
  if (!v?.ok && !test.noReloadRetry) {
    console.log("  ↻ reloading and retrying...");
    await tc("Page.reload", { ignoreCache: true });
    // Reload вызывает navigation; ждём пока DOM не отрисуется и extension
    // re-инжектится. AlicePro загружает чат-историю асинхронно — нужно
    // больше времени чем для пустой страницы.
    await new Promise(r => setTimeout(r, 9000));
    // Дать scanner время отсканить все pre-блоки в загруженной истории
    await tc("Runtime.evaluate", {
      expression: `document.body.setAttribute('data-bal-test-trigger', String(Date.now()))`,
      returnByValue: true,
    });
    await new Promise(r => setTimeout(r, 2500));
    const v2 = await runCheck("after-reload");
    console.log("  after reload:", JSON.stringify(v2));
    if (v2?.ok) v = v2;
  }
  console.log(`  ${v?.ok ? '✓ PASS' : '✗ FAIL'}`);

  // Always probe DOM state right after check, BEFORE closing tab — helps
  // debug failures (which lang did AlicePro set on the pre? was our handler
  // attached? did our button get inserted? etc.).
  if (!v?.ok) {
    const dbg = await tc("Runtime.evaluate", { expression: `(()=>{
      const pres = [...document.querySelectorAll('pre')];
      return pres.map(p => ({
        dataLang: p.getAttribute('data-language'),
        cls: p.className?.slice(0, 60),
        attached: p.dataset?.bdsCodeDownloadAttached,
        codeCls: p.querySelector('code')?.className?.slice(0, 60),
        head: p.querySelector('code')?.textContent?.slice(0, 120),
        ourBtnsInPre: [...p.querySelectorAll('button')].map(b => b.textContent?.slice(0,40)).filter(t => /Скачать|⬇|📦|📄|📊|📈/.test(t || '')),
      }));
    })()`, returnByValue: true });
    console.log("  DEBUG pres:", JSON.stringify(dbg.result.value, null, 2));
  }

  const ss = await tc("Page.captureScreenshot", { format: "png" });
  const out = `${SCRDIR}\\${test.id}.png`;
  fs.writeFileSync(out, Buffer.from(ss.data, "base64"));
  console.log("  screenshot:", out);

  results.push({ id: test.id, ok: !!v?.ok, result: v });
  tw.close(); bw.close();
}

console.log("\n\n========== SUMMARY (AlicePro project source-file mode) ==========");
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.id}`);
const passed = results.filter(r => r.ok).length;
console.log(`\nTotal: ${passed}/${results.length}`);
process.exit(0);
