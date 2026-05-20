// Test: ask Alice Pro literally "знаешь ли ты bap-visualizer?" in a fresh chat
// after our system prompt v15 (frequency=always). Expect Alice to mention bap-*.

import fs from 'node:fs';

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

const { ws: bw, call: bc } = await attachBrowser();

// Open fresh tabs for Alice + Alice Pro, ask both about bap-*
const tests = [
  { host: "https://alicepro.yandex.ru/expert", label: "Alice Pro" },
  { host: "https://alice.yandex.ru/", label: "Alice" },
];

for (const test of tests) {
  console.log(`\n=== ${test.label} ===`);
  const newTab = await bc("Target.createTarget", { url: test.host, background: false });
  await new Promise(r => setTimeout(r, 10000));
  const { ws: tw, call: tc } = await attachTab(newTab.targetId);
  // Dismiss what's new
  await tc("Runtime.evaluate", { expression: `(()=>{const x=document.querySelector('.bap-close-btn');if(x){x.click();}return 'ok';})()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 1000));

  const PROMPT = "Опиши кратко (буквально 1-2 предложения каждый) — какие специальные форматы кодовых блоков ты знаешь? Конкретно: знаешь ли ты bap-visualizer, bap-pptx, bap-excel, bap-docx, filename=? Если знаешь — перечисли что они делают.";

  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea') || document.querySelector('[data-testid="inputbase-textarea"]') || document.querySelector('textarea');
      if (!t) return 'no textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      t.focus(); setter.call(t, ${JSON.stringify(PROMPT)}); t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`, returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 700));

  // Send — try both Enter and form.requestSubmit
  await tc("Runtime.evaluate", {
    expression: `(()=>{
      const form = document.querySelector('#message-form');
      if (form) { const btn = form.querySelector('button.submit') || form.querySelector('button[type=submit]'); if (form.requestSubmit && btn) { form.requestSubmit(btn); return 'rsForm'; } if (form.requestSubmit) { form.requestSubmit(); return 'rsForm-noBtn'; }}
      return 'no form';
    })()`, returnByValue: true,
  });
  await tc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await tc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

  // Wait for response
  let response = null, lastLen = 0, stable = 0;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const r = await tc("Runtime.evaluate", {
      expression: `(()=>{
        const bubble = [...document.querySelectorAll('[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message')].pop();
        if (!bubble) return null;
        const text = bubble.textContent.trim();
        if (text.length < 20) return null;
        return {text: text.slice(0, 2000), len: text.length};
      })()`, returnByValue: true,
    });
    const v = r.result?.value;
    if (v) {
      if (v.len === lastLen) { stable++; if (stable >= 3) { response = v; break; } }
      else { lastLen = v.len; stable = 0; }
    }
  }

  if (response) {
    console.log(`Response (${response.len}b):`);
    console.log(response.text);
    const knows = {
      "bap-visualizer": /bap-visualizer/i.test(response.text),
      "bap-pptx": /bap-pptx/i.test(response.text),
      "bap-excel": /bap-excel/i.test(response.text),
      "bap-docx": /bap-docx/i.test(response.text),
      "filename=": /filename=/i.test(response.text),
    };
    console.log("\nKnowledge:", JSON.stringify(knows));
  } else {
    console.log("✗ no response");
  }
  tw.close();
}
bw.close();
process.exit(0);
