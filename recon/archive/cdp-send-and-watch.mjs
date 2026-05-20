// Attach to Alice tab, focus textarea, type via Input.insertText (bypasses
// framework reactivity issues), submit, then record all traffic.

const [, , urlSub, message, secStr] = process.argv;
const maxSeconds = Number(secStr) || 45;
if (!urlSub || !message) {
  console.error("usage: node cdp-send-and-watch.mjs <urlSubstring> <message> <maxSeconds>");
  process.exit(1);
}

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
if (!target) {
  console.error("no tab matches:", urlSub);
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

let nextId = 1;
const pending = new Map();
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const requests = new Map();
const responses = new Map();
const responseBodyPromises = [];
const wsFrames = [];

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.rej(msg.error); else p.res(msg.result);
    return;
  }
  if (msg.method === "Network.requestWillBeSent") {
    const { requestId, request, type } = msg.params;
    requests.set(requestId, { url: request.url, method: request.method, type, postData: request.postData });
  } else if (msg.method === "Network.responseReceived") {
    const { requestId, response } = msg.params;
    responses.set(requestId, { status: response.status, mimeType: response.mimeType });
  } else if (msg.method === "Network.loadingFinished") {
    const { requestId } = msg.params;
    const req = requests.get(requestId);
    const resp = responses.get(requestId);
    if (req && resp && req.url.includes("alicepro.yandex.ru") && !/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico|js)(\?|$)/i.test(req.url)) {
      responseBodyPromises.push(
        call("Network.getResponseBody", { requestId })
          .then((r) => ({ url: req.url, method: req.method, body: r.body?.slice(0, 4000), base64: r.base64Encoded }))
          .catch(() => null)
      );
    }
  } else if (msg.method === "Network.webSocketCreated") {
    wsFrames.push({ kind: "ws-open", url: msg.params.url });
  } else if (msg.method === "Network.webSocketFrameSent") {
    const payload = String(msg.params.response?.payloadData || "");
    if (!payload.includes('"ping"')) wsFrames.push({ kind: "ws-out", payload: payload.slice(0, 2000) });
  } else if (msg.method === "Network.webSocketFrameReceived") {
    const payload = String(msg.params.response?.payloadData || "");
    if (!payload.includes('"pong"')) wsFrames.push({ kind: "ws-in", payload: payload.slice(0, 2000) });
  } else if (msg.method === "Network.eventSourceMessageReceived") {
    wsFrames.push({ kind: "sse", data: String(msg.params.data || "").slice(0, 2000) });
  }
});

await call("Network.enable");
await call("Page.enable");
await call("Runtime.enable");
await call("Input.setIgnoreInputEvents", { ignore: false }).catch(() => {});
await call("Page.bringToFront").catch(() => {});
await new Promise((r) => setTimeout(r, 600));

// Clear textarea, focus it, type the message via real Input events
console.error("Focusing textarea...");
await call("Runtime.evaluate", {
  expression: `(()=>{const t=document.getElementById('message-textarea');t.focus();t.select();return 'focused';})()`,
  returnByValue: true,
});

// Delete any existing content
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete" });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete" });

console.error("Typing message:", JSON.stringify(message));
await call("Input.insertText", { text: message });

await new Promise((r) => setTimeout(r, 500));

// Check value made it
const checkRes = await call("Runtime.evaluate", {
  expression: `document.getElementById('message-textarea').value`,
  returnByValue: true,
});
console.error("Textarea value after typing:", JSON.stringify(checkRes.result?.value));

// Press Enter to submit
console.error("Pressing Enter to submit...");
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });

console.error(`Recording for up to ${maxSeconds}s...`);
await new Promise((r) => setTimeout(r, maxSeconds * 1000));

const bodies = (await Promise.all(responseBodyPromises)).filter(Boolean);

const interesting = [];
for (const [id, req] of requests.entries()) {
  const u = req.url;
  if (u.startsWith("data:") || u.startsWith("blob:")) continue;
  if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico|js)(\?|$)/i.test(u)) continue;
  if (!u.includes("alicepro") && !u.includes("yandex")) continue;
  const resp = responses.get(id);
  interesting.push({
    url: u,
    method: req.method,
    type: req.type,
    status: resp?.status,
    mime: resp?.mimeType,
    postBytes: req.postData?.length,
    postPreview: req.postData ? req.postData.slice(0, 1200) : null,
  });
}

console.log(JSON.stringify({ requests: interesting, bodies, wsFrames }, null, 2));
ws.close();
process.exit(0);
