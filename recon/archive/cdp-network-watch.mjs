// CDP Network watcher: attaches to a tab on 9222 by URL substring,
// enables Network domain, prints every request/response for N seconds.
//
// usage: node cdp-network-watch.mjs <urlSubstring> <seconds>

const [, , urlSub, secStr] = process.argv;
const seconds = Number(secStr) || 30;
if (!urlSub) {
  console.error("usage: node cdp-network-watch.mjs <urlSubstring> <seconds>");
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
const send = (method, params = {}) =>
  ws.send(JSON.stringify({ id: nextId++, method, params }));

const requests = new Map();
const responses = new Map();
const wsFrames = [];

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Network.requestWillBeSent") {
    const { requestId, request, type } = msg.params;
    requests.set(requestId, { url: request.url, method: request.method, type, postData: request.postData });
  } else if (msg.method === "Network.responseReceived") {
    const { requestId, response } = msg.params;
    responses.set(requestId, {
      status: response.status,
      mimeType: response.mimeType,
      headers: response.headers,
    });
  } else if (msg.method === "Network.webSocketCreated") {
    wsFrames.push({ kind: "ws-open", url: msg.params.url, requestId: msg.params.requestId });
  } else if (msg.method === "Network.webSocketFrameSent") {
    wsFrames.push({ kind: "ws-out", payload: String(msg.params.response?.payloadData || "").slice(0, 800) });
  } else if (msg.method === "Network.webSocketFrameReceived") {
    wsFrames.push({ kind: "ws-in", payload: String(msg.params.response?.payloadData || "").slice(0, 800) });
  } else if (msg.method === "Network.eventSourceMessageReceived") {
    wsFrames.push({ kind: "sse", eventName: msg.params.eventName, data: String(msg.params.data || "").slice(0, 800) });
  }
});

send("Network.enable");
console.error(`Watching for ${seconds}s. Send your test message in the Alice tab now...`);
await new Promise((r) => setTimeout(r, seconds * 1000));

const interesting = [];
for (const [id, req] of requests.entries()) {
  const u = req.url;
  if (u.startsWith("data:") || u.startsWith("blob:")) continue;
  if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico)(\?|$)/i.test(u)) continue;
  const resp = responses.get(id);
  interesting.push({
    url: u,
    method: req.method,
    type: req.type,
    status: resp?.status,
    mime: resp?.mimeType,
    postBytes: req.postData?.length,
    postPreview: req.postData ? req.postData.slice(0, 800) : null,
  });
}

console.log(JSON.stringify({ requests: interesting, wsFrames: wsFrames.slice(0, 40) }, null, 2));

ws.close();
process.exit(0);
