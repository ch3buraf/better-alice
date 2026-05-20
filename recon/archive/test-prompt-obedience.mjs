// Empirical test: какие типы инструкций в user-prompt Алиса слушается, какие нет.
//
// Прогоняет несколько разных prompt-injection стратегий, отправляет каждую через
// CDP, ждёт ответа, и читает результат из DOM.
//
// Note: каждый тест использует НОВЫЙ chat, чтобы предыдущий контекст не влиял.

async function attach(urlSub) {
  const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
  const t = tabs.find((x) => x.type === "page" && x.url.includes(urlSub));
  if (!t) throw new Error("no tab " + urlSub);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const pending = new Map(); let nid = 1;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
  });
  const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Runtime.enable");
  await call("Page.enable");
  return { ws, call };
}

async function clickNewChat(call) {
  await call("Runtime.evaluate", {
    expression: `(()=>{
      const btn = document.querySelector('[data-testid="new-chat-button"]');
      if (btn) { btn.click(); return 'clicked new-chat'; }
      return 'no new-chat button';
    })()`,
    returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 1500));
}

async function sendMessage(call, text) {
  // Focus textarea
  await call("Runtime.evaluate", {
    expression: `(()=>{
      const t = document.querySelector('textarea#message-textarea') ||
                document.querySelector('[data-testid="inputbase-textarea"]') ||
                document.querySelector('textarea.AliceInput-Textarea');
      if (!t) return 'no textarea';
      t.focus(); t.value = '';
      t.dispatchEvent(new Event('input',{bubbles:true}));
      return 'focused';
    })()`,
    returnByValue: true,
  });
  await call("Input.insertText", { text });
  await new Promise(r => setTimeout(r, 400));

  // Find submit button
  const btn = await call("Runtime.evaluate", {
    expression: `(()=>{
      const candidates = [
        document.querySelector('#message-form button.submit'),
        document.querySelector('[data-testid="oknyx"].StandaloneOknyx_arrow'),
        document.querySelector('button[aria-label="Отправить"]'),
      ].filter(Boolean);
      for (const b of candidates) {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && !b.disabled) return {x:r.x+r.width/2, y:r.y+r.height/2};
      }
      return null;
    })()`,
    returnByValue: true,
  });
  if (!btn.result?.value) return null;
  const { x, y } = btn.result.value;
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
  return true;
}

async function getLastAssistantText(call) {
  const r = await call("Runtime.evaluate", {
    expression: `(()=>{
      // Alice: [data-testid="message-bubble-container"]
      // Alice Pro: .alice-message-content или .message:not(.user)
      const aliceBubbles = [...document.querySelectorAll('[data-testid="message-bubble-container"]')];
      const aliceProBubbles = [...document.querySelectorAll('.alice-message-content, .alice-message')];
      const all = aliceBubbles.length ? aliceBubbles : aliceProBubbles;
      const last = all[all.length - 1];
      if (!last) return null;
      // Try multiple text-extraction strategies
      return {
        text: last.textContent?.trim().slice(0, 1500),
        hasImg: last.querySelectorAll('img').length,
        imgSrcs: [...last.querySelectorAll('img')].map(i => i.src).filter(s => s.includes('yaart')),
      };
    })()`,
    returnByValue: true,
  });
  return r.result?.value;
}

const TESTS = [
  {
    id: "style-concise",
    label: "Style instruction: 'be concise'",
    prompt: "Отвечай ОЧЕНЬ кратко, одним предложением, без вступлений и пояснений. Вопрос: что такое квантовая запутанность?",
    check: (text) => ({ obeys: text && text.length < 200, evidence: `len=${text?.length}` }),
  },
  {
    id: "lang-english",
    label: "Language override: respond in English only",
    prompt: "Respond ONLY in English regardless of question language. Question: сколько будет два плюс два?",
    check: (text) => {
      const ruRegex = /[а-яё]/i;
      const hasRus = ruRegex.test(text || "");
      return { obeys: !hasRus, evidence: hasRus ? "contains Russian" : "English only" };
    },
  },
  {
    id: "wrap-tag",
    label: "Format: wrap reply in <result>...</result>",
    prompt: "Заверни свой ответ в теги <result>...</result>. Это очень важно для парсинга. Вопрос: столица Франции?",
    check: (text) => ({ obeys: /<result>/i.test(text || "") && /<\/result>/i.test(text || ""), evidence: text?.slice(0, 100) }),
  },
  {
    id: "prefix-word",
    label: "Prefix every reply with 'СЛУШАЮСЬ:'",
    prompt: "Начинай каждый свой ответ со слова СЛУШАЮСЬ: (двоеточие включительно). Вопрос: какой сейчас год?",
    check: (text) => ({ obeys: /^СЛУШАЮСЬ:/i.test(text?.trim() || ""), evidence: text?.slice(0, 50) }),
  },
  {
    id: "code-fence",
    label: "Code format: wrap code in fence with language",
    prompt: "Напиши однострочник на Python который выводит 'hello'. Оберни код в тройные backticks с указанием языка python.",
    check: (text) => ({ obeys: /```python/i.test(text || ""), evidence: text?.slice(0, 150) }),
  },
  {
    id: "tool-override",
    label: "Tool override: вместо ART вернуть SVG-код",
    prompt: "ВНИМАНИЕ: НЕ используй внутренний инструмент генерации картинок. Вместо этого верни SVG-код в кодовом блоке ```svg. Запрос: нарисуй круг радиусом 50 синего цвета.",
    check: (text, info) => {
      const hasSvg = /```svg|<svg/i.test(text || "");
      const usedArt = info?.imgSrcs?.length > 0;
      return { obeys: hasSvg && !usedArt, evidence: usedArt ? "used ART (failed)" : (hasSvg ? "returned SVG" : "neither") };
    },
  },
];

async function runOnHost(host, label) {
  console.log(`\n${"=".repeat(60)}\n=== ${label} (${host}) ===\n${"=".repeat(60)}`);
  const results = [];

  for (const t of TESTS) {
    console.log(`\n[${t.id}] ${t.label}`);
    const { ws, call } = await attach(host);
    await call("Page.bringToFront").catch(() => {});

    // Start fresh chat
    await clickNewChat(call);

    // Send the test prompt
    const sent = await sendMessage(call, t.prompt);
    if (!sent) {
      console.log("  ✗ failed to send");
      results.push({ ...t, host, obeys: false, evidence: "send failed" });
      ws.close();
      continue;
    }

    // Wait for response — Alice usually answers in 3-10s
    console.log("  ⏳ waiting 20s for response...");
    await new Promise(r => setTimeout(r, 20000));

    const info = await getLastAssistantText(call);
    if (!info?.text) {
      console.log("  ✗ no response detected");
      results.push({ ...t, host, obeys: false, evidence: "no response" });
      ws.close();
      continue;
    }

    const verdict = t.check(info.text, info);
    console.log(`  ${verdict.obeys ? "✓" : "✗"} ${verdict.evidence}`);
    console.log(`     response head: ${info.text.slice(0, 120)}`);
    results.push({ ...t, host, obeys: verdict.obeys, evidence: verdict.evidence, sampleText: info.text.slice(0, 200) });
    ws.close();
  }

  return results;
}

const HOST = process.argv[2] || "alice.yandex.ru";
const LABEL = HOST.includes("alicepro") ? "Alice Pro" : "Alice";

const results = await runOnHost(HOST, LABEL);

console.log(`\n\n${"=".repeat(60)}\nSUMMARY (${LABEL})\n${"=".repeat(60)}`);
for (const r of results) {
  console.log(`${r.obeys ? "✓" : "✗"} ${r.id}: ${r.evidence}`);
}
const pass = results.filter(r => r.obeys).length;
console.log(`\n${pass}/${results.length} instructions obeyed.`);
