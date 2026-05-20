// Bypass React UI entirely: capture Alice's WebSocket from prototype.send,
// then post a Vins/TextInput frame directly. Our extension's WebSocket-patch
// will intercept and inject the system prompt prefix.

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

console.log("Step 1: install spy on WebSocket.send to capture Alice's WS instance + listener for incoming Vins responses...");
await call("Runtime.evaluate", {
  expression: `(()=>{
    if (window.__bal_capturedWS) return 'already-installed';
    window.__bal_capturedWS = null;
    window.__bal_responses = [];
    window.__bal_mutations = [];

    // Listen for our extension's mutation event
    window.addEventListener('bap:mutation-applied', (ev) => {
      try { window.__bal_mutations.push(typeof ev.detail==='string'?JSON.parse(ev.detail):ev.detail); } catch{}
    });

    // Add ANOTHER layer of WS.send spy that captures the WS instance and incoming messages.
    // Our extension's patch is already on prototype.send; we wrap again.
    const protoSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      if (!window.__bal_capturedWS && typeof data === 'string') {
        try {
          const obj = JSON.parse(data);
          if (obj?.event?.header?.namespace) {
            window.__bal_capturedWS = this;
            // Also attach a message listener to capture incoming Vins responses
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
    return 'spy installed';
  })()`,
  returnByValue: true,
});

console.log("Step 2: wait up to 60s for Alice WS to send a ping/pong (capturing the instance)...");
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const check = await call("Runtime.evaluate", {
    expression: `!!window.__bal_capturedWS`,
    returnByValue: true,
  });
  if (check.result?.value) {
    console.log(`  ✓ captured at +${i+1}s`);
    break;
  }
  if (i === 59) {
    console.log("  ✗ timeout — no Vins/System frame sent in 60s");
    process.exit(1);
  }
}

console.log("Step 3: build Vins/TextInput frame and send it through Alice's captured WS (our extension's patch will inject system prompt prefix)...");

// Generate UUIDs and timestamps as Alice's client does
const result = await call("Runtime.evaluate", {
  expression: `(async () => {
    const ws = window.__bal_capturedWS;
    if (!ws) return {error: 'no ws'};

    // Find current dialog_id from URL
    const dialogId = location.pathname.split('/')[2] || 'auto-' + Math.random().toString(36).slice(2,10);

    // Generate uuids (v4-ish)
    const u = () => {
      const r = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);}));
      return r;
    };
    const requestId = u();

    const frame = {
      event: {
        header: {
          namespace: 'Vins',
          name: 'TextInput',
          messageId: requestId,
          seqNumber: Math.floor(Math.random() * 100),
        },
        payload: {
          application: {
            app_id: 'ru.yandex.webstandalone.desktop',
            app_version: 'unknown',
            platform: 'windows',
            os_version: navigator.userAgent.toLowerCase(),
            uuid: '00000000000000508366871779190740',
            lang: 'ru-RU',
            client_time: new Date().toISOString().replace(/[-:.]/g,'').slice(0,15),
            timezone: 'Europe/Moscow',
            timestamp: Math.floor(Date.now()/1000).toString(),
          },
          header: {
            prev_req_id: null,
            request_id: requestId,
            dialog_id: dialogId,
            dialog_type: 2,
          },
          request: {
            event: {
              type: 'text_input',
              text: 'Сделай PowerPoint про "Что такое программирование" — 3 слайда: титульный, основные понятия буллетами, итоги. Используй ИМЕННО валидный JSON внутри блока \`\`\`bap-pptx как описано в инструкциях системы.',
            },
            voice_session: false,
            experiments: ['standalone_alice_2_0', 'read_dialogs_for_unauthorized_users'],
          }
        }
      }
    };

    const data = JSON.stringify(frame);
    ws.send(data);
    return {requestId, dialogId, frameSent: data.slice(0, 300)};
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log("  Sent:", JSON.stringify(result.result?.value));

console.log("Step 4: poll for mutation event + Vins DeferredAliceResponse...");
const startedAt = Date.now();
let mutShown = 0;
let respFinalShown = false;
while (Date.now() - startedAt < 60000) {
  await new Promise(r => setTimeout(r, 1500));
  const tick = await call("Runtime.evaluate", {
    expression: `(()=>{
      const muts = window.__bal_mutations || [];
      const resps = window.__bal_responses || [];
      const finalResp = resps.find(r => r?.payload?.json_response?.is_last);
      return {
        mc: muts.length,
        lastMutInjected: muts[muts.length-1]?.injectedText?.slice(0, 500),
        rc: resps.length,
        finalText: finalResp?.payload?.json_response?.base_response?.text?.slice(0, 1500) || null,
      };
    })()`,
    returnByValue: true,
  });
  const v = tick.result?.value;
  if (v?.mc > mutShown) {
    console.log(`  [+${Math.floor((Date.now()-startedAt)/1000)}s] mutation #${v.mc}`);
    console.log("     injected head:", (v.lastMutInjected||"").slice(0, 400));
    mutShown = v.mc;
  }
  if (v?.finalText && !respFinalShown) {
    console.log(`\n  [+${Math.floor((Date.now()-startedAt)/1000)}s] FINAL RESPONSE:`);
    console.log("  " + v.finalText.split("\n").join("\n  "));
    respFinalShown = true;
    break;
  }
}

if (!respFinalShown) {
  console.log("  ✗ no final response in 60s");
}

ws.close();
process.exit(0);
