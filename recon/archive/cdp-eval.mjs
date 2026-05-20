// Quick CDP-eval: connect to an existing Chrome tab on 9222 by URL substring
// and run an arbitrary expression in its page context.
//
// usage: node cdp-eval.mjs <urlSubstring> <jsExpression>

const [, , urlSub, expr] = process.argv;
if (!urlSub || !expr) {
  console.error("usage: node cdp-eval.mjs <urlSubstring> <jsExpression>");
  process.exit(1);
}

const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const target = tabs.find((t) => t.type === "page" && t.url.includes(urlSub));
if (!target) {
  console.error("no tab matches:", urlSub);
  console.error("open tabs:", tabs.map((t) => t.url));
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

const id = 1;
const result = await new Promise((res, rej) => {
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === id) res(msg);
  });
  ws.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }),
  );
});

ws.close();

if (result.error) {
  console.error("CDP error:", result.error);
  process.exit(3);
}
if (result.result?.result?.subtype === "error") {
  console.error("JS error:", result.result.result.description);
  process.exit(4);
}
const value = result.result?.result?.value;
console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
