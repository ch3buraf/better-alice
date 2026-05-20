// v2: click "new chat" first to get a real dialog_id from URL, then WS send.

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const tab = tabs.find((x) => x.type === "page" && x.url.includes("alice.yandex.ru"));
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
const pending = new Map(); let nid = 1;
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); }
});
const call = (method, params = {}) => new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

await call("Runtime.enable");
await call("Page.bringToFront");

console.log("1) Click 'new chat' via JS (no React-event needed for this button)...");
await call("Runtime.evaluate", {
  expression: `(()=>{const b = document.querySelector('[data-testid="new-chat-button"]'); if (b) {b.click(); return 'clicked';} return 'no btn';})()`,
  returnByValue: true,
});
await new Promise(r => setTimeout(r, 3000));

console.log("2) Wait for URL to have dialog_id...");
let dialogId = null;
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 500));
  const urlCheck = await call("Runtime.evaluate", {
    expression: `location.pathname`,
    returnByValue: true,
  });
  const path = urlCheck.result?.value || "";
  const match = path.match(/\/chat\/([a-f0-9-]{8,})/);
  if (match) { dialogId = match[1]; break; }
}
if (!dialogId) {
  console.log("  ✗ no dialog_id appeared in URL");
  // Pick from any existing chatlist-item
  const fallback = await call("Runtime.evaluate", {
    expression: `(()=>{const items = [...document.querySelectorAll('[data-testid^="chatlist-item-"]')]; if(items.length){const id=items[0].getAttribute('data-testid').replace('chatlist-item-',''); return id;} return null;})()`,
    returnByValue: true,
  });
  dialogId = fallback.result?.value;
  if (dialogId) console.log(`  using fallback from chatlist: ${dialogId}`);
}
if (!dialogId) { console.log("  ✗ no dialog id at all"); process.exit(1); }
console.log(`  dialog_id = ${dialogId}`);

console.log("3) Install spy (reset state if previously set), capture WS, install listeners...");
await call("Runtime.evaluate", {
  expression: `(()=>{
    // Reset arrays so previous run's data doesn't pollute
    window.__bal_responses = [];
    window.__bal_mutations = [];
    if (window.__bal_spyV2) return 'reset-existing';
    window.__bal_spyV2 = true;
    window.__bal_capturedWS = null;
    window.addEventListener('bap:mutation-applied', (ev) => {
      try { window.__bal_mutations.push(typeof ev.detail==='string'?JSON.parse(ev.detail):ev.detail); } catch{}
    });
    const protoSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      if (!window.__bal_capturedWS && typeof data === 'string') {
        try {
          const obj = JSON.parse(data);
          if (obj?.event?.header?.namespace) {
            window.__bal_capturedWS = this;
            this.addEventListener('message', (ev) => {
              try {
                const m = JSON.parse(ev.data);
                if (m?.directive?.header?.namespace === 'Vins') {
                  window.__bal_responses.push(m.directive);
                }
              } catch{}
            });
          }
        } catch{}
      }
      return protoSend.apply(this, arguments);
    };
    return 'ok';
  })()`,
  returnByValue: true,
});

console.log("4) Wait up to 30s for any ws.send so we capture Alice's WS...");
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const check = await call("Runtime.evaluate", { expression: `!!window.__bal_capturedWS`, returnByValue: true });
  if (check.result?.value) { console.log(`  ✓ ws captured at +${i+1}s`); break; }
  if (i === 29) { console.log("  ✗ no WS captured"); process.exit(1); }
}

console.log("5) Send Vins/TextInput frame...");
const PROMPT = "Сделай PowerPoint про \"Что такое программирование\" — 3 слайда: титульный, основные понятия буллетами, итоги. Используй ИМЕННО валидный JSON внутри блока ```bap-pptx как описано в инструкциях системы.";
const result = await call("Runtime.evaluate", {
  expression: `(()=>{
    const ws = window.__bal_capturedWS;
    const u = () => crypto.randomUUID();
    const reqId = u();
    const dialogId = ${JSON.stringify(dialogId)};
    const frame = {
      event: {
        header: { namespace: 'Vins', name: 'TextInput', messageId: reqId, seqNumber: Math.floor(Math.random()*100) },
        payload: {
          application: {
            app_id: 'ru.yandex.webstandalone.desktop', app_version: 'unknown',
            platform: 'windows', os_version: navigator.userAgent.toLowerCase(),
            uuid: '00000000000000508366871779190740', lang: 'ru-RU',
            client_time: new Date().toISOString().replace(/[-:.]/g,'').slice(0,15),
            timezone: 'Europe/Moscow', timestamp: Math.floor(Date.now()/1000).toString(),
          },
          header: { prev_req_id: null, request_id: reqId, dialog_id: dialogId, dialog_type: 2 },
          request: {
            event: { type: 'text_input', text: ${JSON.stringify(PROMPT)} },
            voice_session: false,
            experiments: [
              'standalone_alice_2_0',
              'read_dialogs_for_unauthorized_users',
              'mm_allow_anonymous_request',
              'enable_parallel_requests_to_chats',
              'mm_enable_protocol_scenario=WebAliceControls',
              'div2cards_in_external_skills_for_web_standalone',
              'skills_standalone_use_div_render',
              'standalone_skill_card_cloud_ui',
              'use_server_pings',
              'erase_serialized_response_from_json_deferred_alice_response',
            ],
            uniproxy_options: {
              background_response_streaming_options: {}
            },
            additional_options: {
              bass_options: { user_agent: navigator.userAgent }
            }
          }
        }
      }
    };
    const data = JSON.stringify(frame);
    ws.send(data);
    return {reqId, dialogId, byteLen: data.length};
  })()`,
  returnByValue: true,
});
console.log("  ", JSON.stringify(result.result?.value));

console.log("6) Poll 90s for response...");
let mutShown = 0;
let respShown = 0;
let finalText = null;
const startedAt = Date.now();
while (Date.now() - startedAt < 90000) {
  await new Promise(r => setTimeout(r, 1500));
  const tick = await call("Runtime.evaluate", {
    expression: `(()=>{
      const muts = window.__bal_mutations || [];
      const resps = window.__bal_responses || [];
      const last = resps[resps.length-1];
      // Try both response formats: streaming (DeferredAliceResponse) and sync (VinsResponse)
      const streamFinal = resps.find(r => r?.payload?.json_response?.is_last);
      const syncFinal = resps.find(r => r?.payload?.response?.card?.text || r?.payload?.response?.cards?.length);
      let finalText = null;
      if (streamFinal) {
        finalText = streamFinal.payload?.json_response?.base_response?.text || JSON.stringify(streamFinal.payload?.json_response?.base_response?.cards);
      } else if (syncFinal) {
        const r = syncFinal.payload.response;
        finalText = r.card?.text || (r.cards||[]).map(c => c.text_card?.text || c.text || JSON.stringify(c)).join('\\n---\\n');
      }
      return {mc: muts.length, rc: resps.length, lastRespHead: last?.header?.name, finalText: finalText?.slice(0, 5000)};
    })()`,
    returnByValue: true,
  });
  const v = tick.result?.value;
  if (v?.mc > mutShown) {
    console.log(`  [+${Math.floor((Date.now()-startedAt)/1000)}s] mutation #${v.mc}`);
    mutShown = v.mc;
  }
  if (v?.rc > respShown) {
    console.log(`  [+${Math.floor((Date.now()-startedAt)/1000)}s] response #${v.rc} (${v.lastRespHead})`);
    respShown = v.rc;
  }
  if (v?.finalText) {
    finalText = v.finalText;
    break;
  }
}

if (finalText) {
  console.log("\n=== ALICE'S FINAL RESPONSE ===");
  console.log(finalText);
} else {
  console.log("\n✗ no final response in 90s. Mutations:", mutShown, "Responses:", respShown);
}
ws.close();
process.exit(0);
