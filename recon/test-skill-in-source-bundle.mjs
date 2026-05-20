// Автономный smoke-test: открывает Drawer Better Alice в живой Алисе Про,
// программно заливает landing-page-builder skill в localStorage расширения,
// триггерит "Скачать system_prompt.txt", читает скачанный файл и проверяет
// что в нём есть и сам skill (название/содержимое), и инструкции по bap-*.

import fs from "node:fs";
import path from "node:path";

const SKILL_PATH = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\skills\\landing-page-builder.md";
const SKILL_CONTENT = fs.readFileSync(SKILL_PATH, "utf8");

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

const { ws: bw, call: bc } = await attachBrowser();
const newTab = await bc("Target.createTarget", {
  url: "https://alicepro.yandex.ru/expert/projects/f67d3ec3542011f1a4dafe1ae4d1962b",
  background: false,
});
await new Promise(r => setTimeout(r, 8000));
const { ws: tw, call: tc } = await attachTab(newTab.targetId);

// 1. Программно влить skill в state расширения через chrome.storage
const skillJson = JSON.stringify(SKILL_CONTENT);
const inject = await tc("Runtime.evaluate", {
  expression: `(async () => {
    const id = 'skill-test-' + Date.now();
    const skill = { id, name: 'landing-page-builder', content: ${skillJson}, enabled: true };
    // Пишем напрямую в chrome.storage.local — расширение подхватит при следующем рендере
    return await new Promise((res) => {
      try {
        chrome.storage.local.get(['bap_skills'], (cur) => {
          const arr = Array.isArray(cur.bap_skills) ? cur.bap_skills : [];
          arr.push(skill);
          chrome.storage.local.set({ bap_skills: arr }, () => res({ ok: true, count: arr.length }));
        });
      } catch (e) { res({ ok: false, err: String(e) }); }
    });
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log("skill injected:", JSON.stringify(inject.result.value));

await new Promise(r => setTimeout(r, 2000));

// 2. Найти кнопку "Скачать system_prompt.txt" в Drawer и кликнуть.
//    Сначала открыть Drawer (FAB).
await tc("Runtime.evaluate", {
  expression: `(()=>{
    const fab = document.querySelector('.bap-fab, [class*="fab"]');
    if (fab) fab.click();
    return fab ? 'fab clicked' : 'no fab';
  })()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 1500));

// 3. Перехватить download через monkey-patch triggerTextDownload (через blob URL).
//    Подменяем createObjectURL, чтобы поймать содержимое.
await tc("Runtime.evaluate", {
  expression: `(()=>{
    window.__capturedDownload = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function(blob){
      blob.text().then(t => { window.__capturedDownload = t; });
      return orig(blob);
    };
    return 'patched';
  })()`,
  returnByValue: true,
});

// Клик по кнопке Скачать
const clickRes = await tc("Runtime.evaluate", {
  expression: `(()=>{
    const btn = [...document.querySelectorAll('button')].find(b => /Скачать system_prompt\\.txt/.test(b.textContent || ''));
    if (btn) { btn.click(); return 'clicked'; }
    return 'no-button';
  })()`,
  returnByValue: true,
});
console.log("download button:", clickRes.result.value);

await new Promise(r => setTimeout(r, 2000));

const captured = await tc("Runtime.evaluate", {
  expression: `window.__capturedDownload || ''`,
  returnByValue: true,
});
const body = captured.result.value || "";

const checks = {
  hasSystemPromptHeader: /## СИСТЕМНЫЙ ПРОМПТ/.test(body),
  hasBapCheatsheet: /bap-pptx|bap-docx|bap-zip/.test(body),
  hasSkillsSection: /## АКТИВНЫЕ НАВЫКИ/.test(body),
  hasSkillName: /landing-page-builder/.test(body),
  hasSkillContent: /Tailwind CSS|Shadcn UI/.test(body),
  bodyLength: body.length,
};
console.log("\n=== RESULTS ===");
console.log(JSON.stringify(checks, null, 2));

const allOk = checks.hasSystemPromptHeader && checks.hasBapCheatsheet
  && checks.hasSkillsSection && checks.hasSkillName && checks.hasSkillContent;
console.log(`\n${allOk ? '✓ PASS' : '✗ FAIL'}: skill bundle test`);

// Сохранить скачанный body на диск для ручной проверки
const OUT = "C:\\Users\\LL5AI\\Documents\\CODE_AGENTS_ZONE\\alisa\\recon\\captured-source-file.txt";
fs.writeFileSync(OUT, body);
console.log("saved to:", OUT);

tw.close(); bw.close();
process.exit(allOk ? 0 : 1);
