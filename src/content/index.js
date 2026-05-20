/**
 * Content script entry point.
 *
 * Orchestrates initialization of all subsystems:
 * - Wait for document.body
 * - Load state from chrome.storage
 * - Inject the MAIN-world hook script
 * - Set up bridge events
 * - Mount Svelte UI
 * - Bind storage change listener
 * - Start URL watcher
 * - Observe chat DOM
 * - Schedule initial scan
 * - Push config to injected script
 */

import "bap-platform-globals";
import "../styles/content.css";

import state from "./state.js";
import { loadStateFromStorage, bindStorageChangeListener } from "./storage.js";
import { injectHookScript, setupBridgeEvents, pushConfigToPage } from "./bridge.js";
import { mountUi } from "./ui/mount.js";
import { observeChatDom, scheduleScan, startUrlWatcher, startIdleRescanLoop } from "./scanner.js";
import { checkPendingExport } from "./tools/pending-export.js";
import { startThemeWatcher } from "./theme.js";
import { observeArtImages } from "./alice/art-image-enhancer.js";
import { initSidebarSearch } from "./ui/SidebarSearch.js";

const CONTENT_BOOTSTRAP_KEY = "__bdsContentBootstrapped";

if (!window[CONTENT_BOOTSTRAP_KEY]) {
  window[CONTENT_BOOTSTRAP_KEY] = true;
  init().catch((error) => {
    console.error("[BetterAlice] Init error:", error);
  });
}

function safe(label, fn) {
  try {
    return fn();
  } catch (e) {
    console.warn(`[BetterAlice] ${label} failed:`, e?.message || e);
    return null;
  }
}

async function init() {
  await waitForBody();
  await safe("loadStateFromStorage", () => loadStateFromStorage());

  // Critical path — must run for the extension to work at all
  safe("injectHookScript", () => injectHookScript());
  safe("setupBridgeEvents", () => setupBridgeEvents());
  safe("mountUi", () => mountUi());
  safe("bindStorageChangeListener", () => bindStorageChangeListener());
  safe("pushConfigToPage", () => pushConfigToPage());

  // Per-host adaptive subsystems — wrapped so Yandex Alice-DOM selectors no-op on Alice
  safe("startUrlWatcher", () => startUrlWatcher());
  safe("observeChatDom", () => observeChatDom());
  safe("scheduleScan", () => scheduleScan());
  safe("startIdleRescanLoop", () => startIdleRescanLoop());
  safe("checkPendingExport", () => checkPendingExport());
  safe("startThemeWatcher", () => startThemeWatcher());

  // Alice-specific: enhance ART-generated images with download/copy/open overlay.
  // No-op on hosts without Yandex ART image URLs.
  safe("observeArtImages", () => observeArtImages());

  // Sidebar search — chat-list filter. Adapted to both Yandex Alice and Alice
  // sidebars via data-testid + class-based fallbacks.
  // Mount slightly delayed so Alice's React-rendered sidebar is in DOM.
  setTimeout(() => safe("initSidebarSearch", () => initSidebarSearch()), 1500);

  // Yandex Alice-only subsystems — explicitly disabled for Better Alice:
  //   - initSidebarMenuInjector / initSidebarSearch: tied to Yandex Alice sidebar
  //     classes (._63c77b1 etc.). No Alice equivalent; left disabled.
  //   - startStatusMonitor: polls https://alice.yandex.ru — irrelevant.
  //   - initPricing: fetches Yandex Alice API token pricing — Yandex has no
  //     per-message token cost API.
}

async function waitForBody() {
  if (document.body) {
    return;
  }

  await new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}
