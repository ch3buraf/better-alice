// Same as cdp-full-recon but tailored for alice.yandex.ru (no form, React).

const [, , urlSub, message, secStr] = process.argv;
const maxSec = Number(secStr) || 40;
if (!urlSub || !message) { console.error("usage: <urlSub> <msg> <sec>"); process.exit(1); }

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
if (!target) { console.error("no tab matches:", urlSub); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(m.error) : p.res(m.result);
    return;
  }
  events.push(m);
});

function call(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}

const events = [];
const requests = new Map();
const responses = new Map();
const wsFrames = [];

function isNoise(s) {
  return s.includes('"ping"') || s.includes('"pong"') || s.includes('"mousemove"') || s.includes('"event":"focus"') || s.includes('"event":"blur"') || s.includes('windowfocus') || s.includes('windowblur');
}

function processEvents() {
  for (const msg of events.splice(0)) {
    const p = msg.params;
    if (msg.method === "Network.requestWillBeSent") {
      requests.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type, postData: p.request.postData, headers: p.request.headers });
    } else if (msg.method === "Network.responseReceived") {
      responses.set(p.requestId, { status: p.response.status, mimeType: p.response.mimeType, headers: p.response.headers });
    } else if (msg.method === "Network.webSocketCreated") {
      wsFrames.push({ kind: "ws-open", url: p.url });
    } else if (msg.method === "Network.webSocketFrameSent") {
      const payload = String(p.response?.payloadData || "");
      if (!isNoise(payload)) wsFrames.push({ kind: "ws-out", payload: payload.slice(0, 4000) });
    } else if (msg.method === "Network.webSocketFrameReceived") {
      const payload = String(p.response?.payloadData || "");
      if (!isNoise(payload)) wsFrames.push({ kind: "ws-in", payload: payload.slice(0, 4000) });
    } else if (msg.method === "Network.eventSourceMessageReceived") {
      wsFrames.push({ kind: "sse", data: String(p.data || "").slice(0, 4000) });
    }
  }
}

await call("Network.enable");
await call("Page.enable");
await call("Runtime.enable");
await call("Page.bringToFront").catch(() => {});
await new Promise((r) => setTimeout(r, 500));

// Focus the textarea
console.error("Focusing alice textarea...");
const focusRes = await call("Runtime.evaluate", {
  expression: `(()=>{const t=document.querySelector('textarea.AliceInput-Textarea')||document.querySelector('[data-testid="inputbase-textarea"]')||document.querySelector('textarea');if(!t)return 'no textarea';t.focus();t.click();return 'focused: '+t.tagName+'#'+(t.id||'(noid)');})()`,
  returnByValue: true,
});
console.error(focusRes.result?.value);

// Type message
console.error("Typing:", JSON.stringify(message));
await call("Input.insertText", { text: message });
await new Promise((r) => setTimeout(r, 400));

const valCheck = await call("Runtime.evaluate", {
  expression: `(document.querySelector('textarea.AliceInput-Textarea')||document.querySelector('[data-testid="inputbase-textarea"]')||document.querySelector('textarea')).value`,
  returnByValue: true,
});
console.error("Textarea now:", JSON.stringify(valCheck.result?.value));

// Find submit button - on alice.yandex.ru it's a button with data-testid or a sibling near input
const btnInfo = await call("Runtime.evaluate", {
  expression: `(()=>{
    const cands=[
      document.querySelector('[data-testid="send-button"]'),
      document.querySelector('[data-testid*="send"]'),
      document.querySelector('button[aria-label*="тправить"]'),
      document.querySelector('button[aria-label*="end"]'),
      document.querySelector('.AliceInput button'),
      document.querySelector('.StandaloneInput button'),
    ].filter(Boolean);
    for (const b of cands) {
      const r=b.getBoundingClientRect();
      if (r.width>0 && r.height>0 && !b.disabled) return {x:r.x+r.width/2,y:r.y+r.height/2,aria:b.getAttribute('aria-label'),tid:b.getAttribute('data-testid'),className:String(b.className).slice(0,80)};
    }
    return null;
  })()`,
  returnByValue: true,
});
console.error("Submit button found:", JSON.stringify(btnInfo.result?.value));

if (btnInfo.result?.value) {
  const { x, y } = btnInfo.result.value;
  console.error(`Clicking submit at (${x},${y})...`);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
} else {
  console.error("No submit button found, pressing Enter...");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

console.error(`Recording for ${maxSec}s...`);
const deadline = Date.now() + maxSec * 1000;
let chatFramesSeen = 0;
while (Date.now() < deadline) {
  processEvents();
  // Live progress: count Vins/Audio/Speaker frames (not System pings)
  const chatNow = wsFrames.filter(f => f.payload && !f.payload.includes('"System"')).length;
  if (chatNow > chatFramesSeen) {
    console.error(`  +${chatNow - chatFramesSeen} chat WS frames (total ${chatNow})`);
    chatFramesSeen = chatNow;
  }
  await new Promise((r) => setTimeout(r, 200));
}
processEvents();

// Get response bodies
const bodies = {};
for (const [id, req] of requests.entries()) {
  if (!req.url.includes("yandex")) continue;
  if (req.url.includes("mc.yandex") || req.url.includes("strm.yandex") || req.url.includes("yastatic")) continue;
  if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico)(\?|$)/i.test(req.url)) continue;
  try {
    const r = await call("Network.getResponseBody", { requestId: id });
    bodies[id] = { body: r.body?.slice(0, 8000), base64: r.base64Encoded };
  } catch (e) { bodies[id] = { error: String(e).slice(0, 100) }; }
}

const interesting = [];
for (const [id, req] of requests.entries()) {
  if (req.url.startsWith("data:") || req.url.startsWith("blob:")) continue;
  if (req.url.includes("mc.yandex") || req.url.includes("strm.yandex") || req.url.includes("yastatic")) continue;
  if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico|js)(\?|$)/i.test(req.url)) continue;
  if (!req.url.includes("yandex")) continue;
  const resp = responses.get(id);
  interesting.push({
    url: req.url, method: req.method, type: req.type, status: resp?.status, mime: resp?.mimeType,
    contentType: resp?.headers?.["content-type"], postBytes: req.postData?.length,
    postPreview: req.postData ? req.postData.slice(0, 3000) : null,
    body: bodies[id]?.body,
  });
}

console.log(JSON.stringify({ requests: interesting, wsFrames }, null, 2));
ws.close();
process.exit(0);
