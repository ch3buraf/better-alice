// Comprehensive Alice recon:
// 1. Attach to tab via CDP
// 2. Enable Network domain (catches ALL HTTP + WS regardless of how initiated)
// 3. BringToFront the page
// 4. Type message via Input.insertText (real input events)
// 5. Click submit button by coords (real mouse event)
// 6. Capture everything for N seconds
// 7. Print full report
//
// usage: node cdp-full-recon.mjs <urlSub> <message> <maxSec>

const [, , urlSub, message, secStr] = process.argv;
const maxSec = Number(secStr) || 40;
if (!urlSub || !message) {
  console.error("usage: node cdp-full-recon.mjs <urlSub> <message> <maxSec>");
  process.exit(1);
}

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
if (!target) {
  console.error("no tab matches:", urlSub);
  console.error("available:", tabs.map((t) => t.url));
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(m.error) : p.res(m.result);
    return;
  }
  events.push(m);
});

function call(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const events = [];
const requests = new Map();
const responses = new Map();
const wsFrames = [];

// Set up handlers — we already push events; this just decodes/correlates after
function processEvents() {
  for (const msg of events.splice(0)) {
    const p = msg.params;
    if (msg.method === "Network.requestWillBeSent") {
      requests.set(p.requestId, {
        url: p.request.url,
        method: p.request.method,
        type: p.type,
        postData: p.request.postData,
        headers: p.request.headers,
      });
    } else if (msg.method === "Network.responseReceived") {
      responses.set(p.requestId, {
        status: p.response.status,
        mimeType: p.response.mimeType,
        headers: p.response.headers,
      });
    } else if (msg.method === "Network.webSocketCreated") {
      wsFrames.push({ kind: "ws-open", url: p.url });
    } else if (msg.method === "Network.webSocketFrameSent") {
      const payload = String(p.response?.payloadData || "");
      if (!isNoise(payload)) wsFrames.push({ kind: "ws-out", payload: payload.slice(0, 3000) });
    } else if (msg.method === "Network.webSocketFrameReceived") {
      const payload = String(p.response?.payloadData || "");
      if (!isNoise(payload)) wsFrames.push({ kind: "ws-in", payload: payload.slice(0, 3000) });
    } else if (msg.method === "Network.eventSourceMessageReceived") {
      wsFrames.push({ kind: "sse", data: String(p.data || "").slice(0, 3000) });
    }
  }
}
function isNoise(s) {
  return s.includes('"ping"') || s.includes('"pong"') || s.includes('"mousemove"') || s.includes('"event":"focus"') || s.includes('"event":"blur"') || s.includes('windowfocus') || s.includes('windowblur');
}

await call("Network.enable");
await call("Page.enable");
await call("Runtime.enable");
await call("Page.bringToFront").catch(() => {});
await new Promise((r) => setTimeout(r, 500));

console.error("Focusing textarea + clearing it...");
await call("Runtime.evaluate", {
  expression: `(()=>{const t=document.getElementById('message-textarea')||document.querySelector('textarea');if(!t)return 'no textarea';t.focus();t.value='';t.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';})()`,
  returnByValue: true,
});

console.error("Typing:", JSON.stringify(message));
await call("Input.insertText", { text: message });
await new Promise((r) => setTimeout(r, 300));

const valCheck = await call("Runtime.evaluate", {
  expression: `(document.getElementById('message-textarea')||document.querySelector('textarea')).value`,
  returnByValue: true,
});
console.error("Textarea now:", JSON.stringify(valCheck.result?.value));

// Find submit button coords
const btnInfo = await call("Runtime.evaluate", {
  expression: `(()=>{const f=document.getElementById('message-form')||document.querySelector('form');if(!f)return null;const b=f.querySelector('button.submit, button[type="submit"], button:not([type="button"])');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,visible:r.width>0&&r.height>0,disabled:b.disabled};})()`,
  returnByValue: true,
});
console.error("Submit button:", JSON.stringify(btnInfo.result?.value));

if (btnInfo.result?.value?.visible && !btnInfo.result?.value?.disabled) {
  const { x, y } = btnInfo.result.value;
  console.error(`Clicking submit at (${x},${y})...`);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
} else {
  console.error("Submit button not clickable, trying form.requestSubmit() via JS...");
  await call("Runtime.evaluate", {
    expression: `(()=>{const f=document.getElementById('message-form');if(!f)return 'no-form';f.requestSubmit?f.requestSubmit():f.submit();return 'submitted';})()`,
    returnByValue: true,
  });
}

console.error(`Recording for ${maxSec}s...`);
const startedAt = Date.now();
const deadline = startedAt + maxSec * 1000;
while (Date.now() < deadline) {
  processEvents();
  await new Promise((r) => setTimeout(r, 200));
}
processEvents();

// Get response bodies for interesting requests
const bodies = {};
for (const [id, req] of requests.entries()) {
  if (!req.url.includes("alicepro") && !req.url.includes("alice.yandex")) continue;
  if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico)(\?|$)/i.test(req.url)) continue;
  if (req.url.includes("yastatic")) continue;
  try {
    const r = await call("Network.getResponseBody", { requestId: id });
    bodies[id] = { body: r.body?.slice(0, 5000), base64: r.base64Encoded };
  } catch (e) {
    bodies[id] = { error: String(e).slice(0, 200) };
  }
}

const interesting = [];
for (const [id, req] of requests.entries()) {
  if (req.url.startsWith("data:") || req.url.startsWith("blob:")) continue;
  if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico|js)(\?|$)/i.test(req.url)) continue;
  if (!req.url.includes("alicepro") && !req.url.includes("alice.yandex")) continue;
  if (req.url.includes("yastatic")) continue;
  const resp = responses.get(id);
  interesting.push({
    url: req.url,
    method: req.method,
    type: req.type,
    status: resp?.status,
    mime: resp?.mimeType,
    contentType: resp?.headers?.["content-type"],
    postBytes: req.postData?.length,
    postPreview: req.postData ? req.postData.slice(0, 2000) : null,
    body: bodies[id]?.body?.slice(0, 3000),
  });
}

console.log(JSON.stringify({ requests: interesting, wsFrames }, null, 2));
ws.close();
process.exit(0);
