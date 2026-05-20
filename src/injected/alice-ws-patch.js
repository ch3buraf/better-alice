/**
 * Adapter for alice.yandex.ru — WebSocket-based transport.
 *
 * Alice uses the Yandex SpeechKit / "Vins" protocol over a long-lived
 * WebSocket. User text is sent as:
 *   {"event":{"header":{"namespace":"Vins","name":"TextInput",...},
 *             "payload":{"...","request":{"event":{"type":"text_input","text":"..."}}}}}
 *
 * Server responses stream back as:
 *   {"directive":{"header":{"namespace":"Vins","name":"DeferredAliceResponse",...},
 *                 "payload":{"json_response":{"is_last":...,
 *                                             "base_response":{"text":"...","cards":[...]}}}}}
 *
 * We hook BOTH WebSocket.prototype.send (catches all instances including
 * pre-existing ones via shared prototype) AND the WebSocket constructor
 * (so we can subscribe to incoming messages for response capture).
 */

import { buildPrefixedText } from "./prefix-builder.js";

const EVENTS = {
  mutationApplied: "bap:mutation-applied",
  responseChunk: "bap:alice-response-chunk",
  responseFinal: "bap:alice-response-final",
};

export function patchAliceWebSocket(state) {
  if (window.__betterAliceWsPatched) return;
  window.__betterAliceWsPatched = true;

  const _send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === "string" && data.length < 200000 && data.includes('"Vins"')) {
        const obj = JSON.parse(data);
        if (isTextInput(obj)) {
          const dialogId = obj?.event?.payload?.header?.dialog_id || "(no-id)";
          const original = obj.event.payload.request.event.text;
          const { text: nextText, changed } = buildPrefixedText(original, state, dialogId);
          if (changed) {
            obj.event.payload.request.event.text = nextText;
            data = JSON.stringify(obj);
            window.dispatchEvent(
              new CustomEvent(EVENTS.mutationApplied, {
                detail: JSON.stringify({
                  host: "alice",
                  conversationId: dialogId,
                  userPrompt: original,
                  injectedText: nextText.slice(0, 4000),
                }),
              })
            );
          }
        }
      }
    } catch (e) {
      // never block the original send on a parse error
      // eslint-disable-next-line no-console
      console.debug("[BetterAlice] send-patch parse error:", e?.message);
    }
    // call with `data` (potentially mutated above) — NOT `arguments`,
    // since in strict mode (ES modules) arguments is not aliased to params,
    // so reassigning data wouldn't reflect in arguments[0].
    return _send.call(this, data);
  };

  // Patch constructor so we can listen on incoming messages.
  // Note: this only affects NEW WebSocket instances; if Alice already opened
  // its WS before we ran, we'd miss incoming frames. Mitigation: hook also
  // any existing instances via a MutationObserver on document — but simpler
  // path is `run_at: document_start` in manifest, which we have.
  const _WS = window.WebSocket;
  function PatchedWS(...args) {
    const inst = new _WS(...args);
    inst.addEventListener("message", (ev) => {
      try {
        if (typeof ev.data !== "string") return;
        if (!ev.data.includes('"Vins"') && !ev.data.includes('"DeferredAliceResponse"')) return;
        const obj = JSON.parse(ev.data);
        if (isDeferredResponse(obj)) {
          const jr = obj.directive.payload.json_response;
          const base = jr.base_response || {};
          const detail = {
            requestId: jr.request_id,
            partialNum: jr.response_partial_num,
            isLast: !!jr.is_last,
            text: base.text || "",
            cards: base.cards || [],
          };
          const eventName = jr.is_last ? EVENTS.responseFinal : EVENTS.responseChunk;
          window.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify(detail) }));
        }
      } catch (e) {
        // swallow
      }
    });
    return inst;
  }
  // Preserve prototype + statics so app's `instanceof WebSocket` checks still work
  PatchedWS.prototype = _WS.prototype;
  Object.setPrototypeOf(PatchedWS, _WS);
  PatchedWS.CONNECTING = _WS.CONNECTING;
  PatchedWS.OPEN = _WS.OPEN;
  PatchedWS.CLOSING = _WS.CLOSING;
  PatchedWS.CLOSED = _WS.CLOSED;
  window.WebSocket = PatchedWS;
}

function isTextInput(obj) {
  return (
    obj &&
    obj.event &&
    obj.event.header &&
    obj.event.header.namespace === "Vins" &&
    obj.event.header.name === "TextInput" &&
    obj.event.payload &&
    obj.event.payload.request &&
    obj.event.payload.request.event &&
    obj.event.payload.request.event.type === "text_input" &&
    typeof obj.event.payload.request.event.text === "string"
  );
}

function isDeferredResponse(obj) {
  return (
    obj &&
    obj.directive &&
    obj.directive.header &&
    obj.directive.header.namespace === "Vins" &&
    obj.directive.header.name === "DeferredAliceResponse" &&
    obj.directive.payload &&
    obj.directive.payload.json_response
  );
}
