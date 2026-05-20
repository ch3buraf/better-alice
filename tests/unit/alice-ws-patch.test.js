// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { patchAliceWebSocket } from "../../src/injected/alice-ws-patch.js";

function makeState() {
  return {
    config: {
      systemPrompt: "You are Better Alice.",
      systemPromptInjectionFrequency: "first",
      skills: [],
      memories: [{ key: "name", value: "Alex", importance: "always" }],
      activeCharacter: null,
      activeProject: null,
      disableSystemPrompt: false,
      disableMemory: false,
    },
    hasInjected: () => false,
    markInjected: () => {},
    sessionUserMsgCounts: {},
  };
}

/**
 * jsdom has no WebSocket. We stub a minimal version that lets the patch:
 *   - override .send (via WebSocket.prototype.send replacement)
 *   - subscribe to messages on new instances
 */
function installStubWebSocket() {
  const sentFrames = [];
  class StubWS {
    constructor(url) {
      this.url = url;
      this.listeners = { message: [] };
    }
    send(data) {
      sentFrames.push({ url: this.url, data });
    }
    addEventListener(type, handler) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(handler);
    }
    // Helper for tests — simulate incoming message
    _fireMessage(payload) {
      for (const h of this.listeners.message || []) {
        h({ data: typeof payload === "string" ? payload : JSON.stringify(payload) });
      }
    }
  }
  StubWS.CONNECTING = 0;
  StubWS.OPEN = 1;
  StubWS.CLOSING = 2;
  StubWS.CLOSED = 3;
  globalThis.WebSocket = StubWS;
  window.WebSocket = StubWS;
  return { sentFrames, StubWS };
}

const VINS_TEXT_INPUT = {
  event: {
    header: {
      namespace: "Vins",
      name: "TextInput",
      messageId: "uuid-1",
      seqNumber: 8,
    },
    payload: {
      application: { app_id: "ru.yandex.webstandalone.desktop" },
      header: {
        prev_req_id: null,
        request_id: "uuid-1",
        dialog_id: "dialog-A",
        dialog_type: 2,
      },
      request: {
        event: { type: "text_input", text: "привет, Алиса" },
        voice_session: false,
        experiments: [],
      },
    },
  },
};

const VINS_DEFERRED_RESPONSE = {
  streaming: { source: "InitialRequest", routing: { dialog_id: "dialog-A" } },
  directive: {
    payload: {
      json_response: {
        response_partial_num: 1,
        is_last: false,
        request_id: "uuid-1",
        base_response: {
          text: "Привет! Чем помочь?",
          cards: [{ card_id: "c1", text_card: { text: "Привет! Чем помочь?", progressive_printing: true } }],
        },
      },
    },
    header: { namespace: "Vins", name: "DeferredAliceResponse", refMessageId: "uuid-1", messageId: "resp-1" },
  },
};

describe("patchAliceWebSocket", () => {
  let stub;

  beforeEach(() => {
    delete window.__betterAliceWsPatched;
    stub = installStubWebSocket();
  });

  afterEach(() => {
    delete window.__betterAliceWsPatched;
  });

  it("is idempotent — second call does nothing", () => {
    const state = makeState();
    patchAliceWebSocket(state);
    const send1 = WebSocket.prototype.send;
    patchAliceWebSocket(state);
    expect(WebSocket.prototype.send).toBe(send1);
  });

  it("mutates Vins/TextInput frames to inject prefix", () => {
    const state = makeState();
    patchAliceWebSocket(state);

    const ws = new WebSocket("wss://uniproxy.alice.yandex.net/");
    ws.send(JSON.stringify(VINS_TEXT_INPUT));

    expect(stub.sentFrames.length).toBe(1);
    const sent = JSON.parse(stub.sentFrames[0].data);
    const sentText = sent.event.payload.request.event.text;
    expect(sentText).toContain("<BetterAlice>");
    expect(sentText).toContain("You are Better Alice.");
    expect(sentText).toContain("name: Alex");
    expect(sentText).toContain("привет, Алиса");
  });

  it("does NOT touch non-Vins frames (e.g. System Pong)", () => {
    const state = makeState();
    patchAliceWebSocket(state);

    const ws = new WebSocket("wss://uniproxy.alice.yandex.net/");
    const pong = JSON.stringify({
      event: { header: { namespace: "System", name: "Pong" }, payload: {} },
    });
    ws.send(pong);
    expect(stub.sentFrames[0].data).toBe(pong);
  });

  it("dispatches bap:mutation-applied on injection", () => {
    const state = makeState();
    patchAliceWebSocket(state);

    const events = [];
    window.addEventListener("bap:mutation-applied", (ev) => events.push(ev.detail));

    const ws = new WebSocket("wss://uniproxy.alice.yandex.net/");
    ws.send(JSON.stringify(VINS_TEXT_INPUT));

    expect(events.length).toBe(1);
    const detail = JSON.parse(events[0]);
    expect(detail.host).toBe("alice");
    expect(detail.conversationId).toBe("dialog-A");
    expect(detail.userPrompt).toBe("привет, Алиса");
    expect(detail.injectedText).toContain("привет, Алиса");
  });

  it("dispatches bap:alice-response-chunk for non-final response", () => {
    const state = makeState();
    patchAliceWebSocket(state);

    const events = { chunk: [], final: [] };
    window.addEventListener("bap:alice-response-chunk", (ev) => events.chunk.push(JSON.parse(ev.detail)));
    window.addEventListener("bap:alice-response-final", (ev) => events.final.push(JSON.parse(ev.detail)));

    const ws = new WebSocket("wss://uniproxy.alice.yandex.net/");
    ws._fireMessage(VINS_DEFERRED_RESPONSE);

    expect(events.chunk.length).toBe(1);
    expect(events.final.length).toBe(0);
    expect(events.chunk[0].text).toBe("Привет! Чем помочь?");
    expect(events.chunk[0].requestId).toBe("uuid-1");
    expect(events.chunk[0].isLast).toBe(false);
    expect(events.chunk[0].cards.length).toBe(1);
  });

  it("dispatches bap:alice-response-final on is_last=true", () => {
    const state = makeState();
    patchAliceWebSocket(state);

    const events = [];
    window.addEventListener("bap:alice-response-final", (ev) => events.push(JSON.parse(ev.detail)));

    const ws = new WebSocket("wss://uniproxy.alice.yandex.net/");
    const final = JSON.parse(JSON.stringify(VINS_DEFERRED_RESPONSE));
    final.directive.payload.json_response.is_last = true;
    ws._fireMessage(final);

    expect(events.length).toBe(1);
    expect(events[0].isLast).toBe(true);
  });

  it("ignores non-Vins directives", () => {
    const state = makeState();
    patchAliceWebSocket(state);

    const events = [];
    window.addEventListener("bap:alice-response-chunk", (ev) => events.push(ev));

    const ws = new WebSocket("wss://uniproxy.alice.yandex.net/");
    ws._fireMessage({ directive: { header: { namespace: "System", name: "Ping" }, payload: {} } });
    expect(events.length).toBe(0);
  });

  it("survives malformed JSON in send (does not throw)", () => {
    const state = makeState();
    patchAliceWebSocket(state);

    const ws = new WebSocket("wss://uniproxy.alice.yandex.net/");
    // String that looks Vins-like but is not valid JSON
    expect(() => ws.send('{"Vins"-incomplete')).not.toThrow();
    expect(stub.sentFrames[0].data).toBe('{"Vins"-incomplete');
  });

  it("survives non-string send payloads (binary)", () => {
    const state = makeState();
    patchAliceWebSocket(state);

    const ws = new WebSocket("wss://uniproxy.alice.yandex.net/");
    const buf = new ArrayBuffer(8);
    expect(() => ws.send(buf)).not.toThrow();
    expect(stub.sentFrames[0].data).toBe(buf);
  });
});
