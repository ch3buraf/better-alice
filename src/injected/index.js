/**
 * Injected script entry — runs in the page's MAIN world.
 *
 * Dispatches to the appropriate adapter based on hostname:
 *   - alice.yandex.ru  → WebSocket interceptor (Vins/TextInput payloads)
 *   - alicepro.yandex.ru → fetch interceptor (SvelteKit messageSend form POST)
 *
 * Common state (config, memories, skills, character) is owned here and
 * passed to both adapters; the content script feeds config via a CustomEvent.
 */

import { normalizeConfig } from "./config.js";
import { patchAliceWebSocket } from "./alice-ws-patch.js";
import { patchAliceProFetch } from "./alicepro-fetch-patch.js";

(function () {
  "use strict";

  const EVENTS = {
    configUpdate: "bap:config-update",
    requestConfig: "bap:request-config",
    markVoiceMessage: "bap:mark-voice-message",
  };

  function getInjectedChats() {
    try {
      return JSON.parse(localStorage.getItem("bap_injected_chats") || "[]");
    } catch {
      return [];
    }
  }
  function addInjectedChat(id) {
    const chats = getInjectedChats();
    if (!chats.includes(id)) {
      chats.push(id);
      if (chats.length > 50) chats.shift();
      localStorage.setItem("bap_injected_chats", JSON.stringify(chats));
    }
  }
  function getInjectedCharacters() {
    try {
      return JSON.parse(localStorage.getItem("bap_injected_chars") || "{}");
    } catch {
      return {};
    }
  }
  function setInjectedCharacter(id, name) {
    const chars = getInjectedCharacters();
    chars[id] = name;
    const keys = Object.keys(chars);
    if (keys.length > 50) delete chars[keys[0]];
    localStorage.setItem("bap_injected_chars", JSON.stringify(chars));
  }

  const state = {
    config: {
      systemPrompt: "",
      skills: [],
      memories: [],
      activeCharacter: null,
      activeProject: null,
      preferredLang: "",
      disableSystemPrompt: false,
      disableMemory: false,
      systemPromptInjectionFrequency: "first",
      systemPromptInjectionInterval: 3,
      projectRagEnabled: false,
      projectRagLimit: 5,
    },
    hasInjected: (id) => getInjectedChats().includes(id),
    markInjected: (id) => addInjectedChat(id),
    getLastChar: (id) => getInjectedCharacters()[id] || null,
    setLastChar: (id, name) => setInjectedCharacter(id, name),
    sessionUserMsgCounts: {},
    isNextVoiceMessage: false,
  };

  if (window.__betterAliceNetworkPatched) return;
  window.__betterAliceNetworkPatched = true;

  window.addEventListener(EVENTS.configUpdate, (event) => {
    let nextConfig = event && event.detail ? event.detail : {};
    if (typeof nextConfig === "string") {
      try {
        nextConfig = JSON.parse(nextConfig);
      } catch (e) {
        console.error("[BetterAlice] Failed to parse configUpdate detail:", e);
        return;
      }
    }
    state.config = normalizeConfig(nextConfig || {});
  });

  window.addEventListener(EVENTS.markVoiceMessage, () => {
    state.isNextVoiceMessage = true;
  });

  // Request initial config from the content script
  window.dispatchEvent(new CustomEvent(EVENTS.requestConfig));

  // Dispatch by hostname — install all adapters that match (page can navigate
  // between alice and alicepro hosts but we run in a single tab, so usually
  // only one applies).
  const host = location.hostname;
  if (host === "alice.yandex.ru") {
    patchAliceWebSocket(state);
  } else if (host === "alicepro.yandex.ru") {
    patchAliceProFetch(state);
  } else {
    // Should not happen given manifest matches, but guard anyway
    console.warn("[BetterAlice] no adapter for hostname:", host);
  }
})();
