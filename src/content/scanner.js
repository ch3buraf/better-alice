/**
 * DOM observation and page scanning.
 */

import state, { withObserverPaused } from "./state.js";
import { LONG_WORK_STALE_MS } from "../lib/constants.js";
import { processMessageNode } from "./message-processor.svelte.js";
import { enhanceCodeBlockDownloads } from "./files/code-blocks.js";
import { mount } from "svelte";
import AttachMenu from "./ui/AttachMenu.svelte";
import ExpandToggle from "./ui/ExpandToggle.svelte";
import RagPreview from "./ui/RagPreview.svelte";
import { injectSearchInput } from "./ui/SidebarSearch.js";
import { checkPendingExport } from "./tools/pending-export.js";
import { hideTagsInSidebar, hideTagsInHeader } from "./tags/tag-hider.js";

/**
 * Collect all message nodes from the chat DOM.
 *
 * Supports three platforms:
 *   - Yandex Alice:   div.ds-message._63c77b1 (preferred) or div.ds-message (fallback)
 *   - Alice:      [data-testid="message-bubble-container"] (assistant) and
 *                 [data-testid="message-bubble-container-from-user"] (user)
 *   - Alice Pro:  .message-form-wrapper .message (Svelte BEM-style)
 */
export function collectMessageNodes() {
  const set = new Set();

  // Yandex Alice path
  for (const node of document.querySelectorAll("div.ds-message._63c77b1")) {
    set.add(node);
  }
  if (!set.size) {
    for (const node of document.querySelectorAll("div.ds-message")) {
      set.add(node);
    }
  }

  // Alice path (React, data-testid based)
  if (!set.size) {
    for (const node of document.querySelectorAll('[data-testid="message-bubble-container"], [data-testid="message-bubble-container-from-user"]')) {
      set.add(node);
    }
  }

  // Alice Pro path (Svelte, BEM-like)
  if (!set.size) {
    for (const node of document.querySelectorAll(".message-form-wrapper .message, [class*=\"message-bubble\"]:not(.message-input-buttons):not(.message-input-toolbar):not(.message-form-wrapper)")) {
      set.add(node);
    }
  }

  return Array.from(set);
}

/**
 * Find the latest assistant message node.
 */
export function findLatestAssistantMessageNode() {
  const nodes = collectMessageNodes();
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];
    if (!candidate || candidate.closest("#bap-root")) {
      continue;
    }

    if (detectMessageRole(candidate) === "assistant") {
      return candidate;
    }
  }

  return null;
}

/**
 * Detect the role of a message DOM node.
 */
export function detectMessageRole(node) {
  if (!node) return "unknown";

  // Alice (regular) — data-testid based
  const testId = node.getAttribute?.("data-testid");
  if (testId === "message-bubble-container-from-user") return "user";
  if (testId === "message-bubble-container") return "assistant";

  // Alice Pro (Svelte) — BEM-style modifier classes
  if (node.classList) {
    if (node.classList.contains("user")) return "user";
    if (node.classList.contains("assistant") || node.classList.contains("alice-message")) return "assistant";
    // Alice Pro renders user messages inside a wrapper carrying classes like
    // "user-message", "from-user", or similar. Broad pattern.
    const cls = String(node.className || "");
    if (/(?:^|[\s_-])user(?:[\s_-]|$)|from-user|user-message|user-bubble/i.test(cls)) return "user";
  }

  // Yandex Alice selectors (legacy fallback)
  if (node.classList && node.classList.contains("d29f3d7d")) return "user";
  if (node.closest && node.closest("div._4f9bf79._43c05b5")) return "assistant";
  if (node.closest && node.closest("div._9663006")) return "user";
  if (node.classList && node.classList.contains("ds-message")) return "assistant";

  const roleAttr = node.getAttribute?.("data-message-author-role");
  if (roleAttr) return String(roleAttr).toLowerCase();

  // Generic Alice Pro fallback — class "message" + parent has either "user" or "alice-message"
  const parent = node.parentElement;
  if (parent?.classList?.contains?.("question")) return "user"; // Alice Pro user bubble inside .question
  if (parent?.closest?.(".alice-message")) return "assistant";

  return "unknown";
}

/**
 * Check if a node is the absolute last message in the entire chat.
 */
export function isAbsoluteLastMessage(node) {
  const nodes = collectMessageNodes();
  return nodes[nodes.length - 1] === node;
}

/**
 * Check if a node is the latest assistant message.
 */
export function isLatestAssistantMessage(node) {
  return findLatestAssistantMessageNode() === node;
}

/**
 * Set up a MutationObserver on the document body.
 */
export function observeChatDom() {
  if (state.observer || !document.body) {
    return;
  }

  state.observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.addedNodes.length || r.removedNodes.length) {
        scheduleScan();
        return;
      }
    }
  });

  state.observer.observe(document.body, {
    subtree: true,
    childList: true,
  });
}

/**
 * Debounced page scan scheduler. Trailing-edge: coalesces bursts into one
 * scan ~140ms after the LAST mutation.
 */
export function scheduleScan() {
  if (state.scanTimer) {
    clearTimeout(state.scanTimer);
  }

  state.scanTimer = window.setTimeout(() => {
    state.scanTimer = 0;
    scanPage();
  }, 140);
}

/**
 * Idle-rescan safety net: каждые 2 сек через requestIdleCallback проверяем,
 * не остались ли в DOM `<pre>` без `bdsCodeDownloadAttached`. Если есть — это
 * значит scanner.js пропустил их (race condition при mount/virtualize/scroll),
 * принудительно гоняем enhanceCodeBlockDownloads. Дёшево — пропускает уже
 * обработанные.
 */
let idleRescanStarted = false;
export function startIdleRescanLoop() {
  if (idleRescanStarted) return;
  idleRescanStarted = true;

  const tick = () => {
    try {
      const orphans = document.querySelectorAll('pre:not([data-bds-code-download-attached]) code');
      if (orphans.length > 0) {
        withObserverPaused(() => enhanceCodeBlockDownloads());
      }
    } catch (e) { /* swallow */ }
    // Schedule next tick — prefer idle callback to не дёргать main thread.
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => setTimeout(tick, 2000), { timeout: 2500 });
    } else {
      setTimeout(tick, 2000);
    }
  };
  setTimeout(tick, 2500); // первый tick через 2.5с после init — даём UI смонтироваться
}

/**
 * Mount «🔄 Активировать» button on every message — для редких случаев, когда
 * даже idle-rescan не помог (например AlicePro отдала чанк после disconnect'a
 * stream-watcher'а). Клик принудительно re-сканит блоки этого сообщения.
 */
function mountForceRescanButtons() {
  const messages = collectMessageNodes();
  for (const msg of messages) {
    if (msg.dataset.balForceRescanMounted === "1") continue;
    // Только если в сообщении есть `<pre>` (иначе нет смысла)
    if (!msg.querySelector("pre")) continue;
    msg.dataset.balForceRescanMounted = "1";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bap-force-rescan-btn";
    btn.title = "Перезапустить обработчики Better Alice на этом сообщении (если что-то не подхватилось)";
    btn.textContent = "🔄";
    btn.style.cssText = "position:absolute;top:4px;right:4px;padding:2px 6px;border:1px solid #ccc;border-radius:4px;background:rgba(255,255,255,0.9);font-size:12px;cursor:pointer;opacity:0.4;z-index:5;transition:opacity 150ms";
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.4"; });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Сбрасываем флаги во всех <pre> этого сообщения и пере-сканим.
      for (const pre of msg.querySelectorAll("pre")) {
        delete pre.dataset.bdsCodeDownloadAttached;
        delete pre.dataset.bdsCodeSeenLen;
        delete pre.dataset.balMemoryDone;
        delete pre.dataset.balCharacterDone;
        delete pre.dataset.balAutoRunDone;
        delete pre.dataset.balAskDispatched;
        delete pre.dataset.balStreamWatched;
        // Убираем наши старые кнопки и wrapper'ы в этом сообщении.
        for (const b of pre.querySelectorAll("button")) {
          if (b === btn) continue;
          const t = b.textContent || "";
          if (/Скачать|⬇|📦|📄|📊|📈|Save memory|Создать персонажа|▶ Run/.test(t)) b.remove();
        }
      }
      msg.querySelectorAll(".bap-memory-chip, .bap-character-chip, .bap-question-panel, .bap-auto-run-container, .bap-visualizer-wrapper, .bap-latex-wrapper")
        .forEach(el => el.remove());
      withObserverPaused(() => enhanceCodeBlockDownloads());
      btn.textContent = "✓";
      setTimeout(() => { btn.textContent = "🔄"; }, 1200);
    });

    // Гарантируем relative-позиционирование родителя, чтобы absolute-кнопка встала справа-вверху.
    const cs = window.getComputedStyle(msg);
    if (cs.position === "static") msg.style.position = "relative";
    msg.appendChild(btn);
  }
}

/**
 * Full page scan — process all message nodes.
 */
function scanPage() {
  withObserverPaused(() => {
    enhanceCodeBlockDownloads();
    mountForceRescanButtons();

    if (
      state.longWork.active &&
      Date.now() - state.longWork.lastActivityAt > LONG_WORK_STALE_MS
    ) {
      state.longWork.active = false;
      state.longWork.files.clear();
      if (state.ui) {
        state.ui.showLongWorkOverlay(false);
        state.ui.showToast("LONG_WORK timeout cleared.");
      }
    }

    const nodes = collectMessageNodes();
    for (const node of nodes) {
      try {
        processMessageNode(node);
      } catch (err) {
        console.error("[BDS] Error processing message node:", err, node);
      }
    }

    linkifyLogo();
    linkifyNewChatButton();
    injectSearchInput();
    scanInputArea();
    hideTagsInSidebar();
    hideTagsInHeader();
  });
}

/**
 * Scan for the chat text input area to inject custom attachment menu.
 *
 * Strategy:
 *   1. Yandex Alice path — find `input[type="file"][multiple]` and mount next to it.
 *   2. Alice Pro path — find `form#message-form .message-input-toolbar` and
 *      mount inside the toolbar. Create a synthetic file input so AttachMenu
 *      has something to drive native file upload through.
 *   3. Alice path — find `.AliceInput` container; same synthetic-input trick.
 */
function scanInputArea() {
  // Path 1: Yandex Alice native file input
  let fileInput = document.querySelector('input[type="file"][multiple]');
  let wrapper = fileInput?.parentElement || null;

  // Path 2/3: Alice variants
  if (!fileInput) {
    const aliceProToolbar = document.querySelector("#message-form .message-input-toolbar");
    const aliceContainer = document.querySelector(".AliceInput .StandaloneInput-Field, .AliceInput");
    const aliceProForm = document.querySelector("#message-form");

    const target = aliceProToolbar || aliceContainer || aliceProForm;
    if (!target) return;

    if (target.hasAttribute("data-bap-attach-menu-mounted")) return;

    // Synthesize a hidden file input — AttachMenu uses it for native picker fallback
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    fileInput.setAttribute("data-bap-synthetic", "true");
    target.appendChild(fileInput);
    wrapper = target;
  }

  if (!wrapper || wrapper.hasAttribute("data-bap-attach-menu-mounted")) {
    return;
  }

  const prevSibling = fileInput.previousElementSibling;
  let nativeButton = null;
  if (prevSibling && prevSibling.getAttribute("role") === "button") {
    nativeButton = prevSibling;
  } else {
    nativeButton = wrapper.querySelector('div[role="button"][tabindex="0"]');
  }

  if (nativeButton) {
    nativeButton.style.setProperty("display", "none", "important");
  }

  const mountPoint = document.createElement("div");
  wrapper.insertBefore(mountPoint, fileInput);

  mount(AttachMenu, {
    target: mountPoint,
    props: {
      nativeInput: fileInput
    }
  });

  const toggleMountPoint = document.createElement("div");
  wrapper.insertBefore(toggleMountPoint, fileInput);
  mount(ExpandToggle, { target: toggleMountPoint });

  const ragMountPoint = document.createElement("div");
  wrapper.insertBefore(ragMountPoint, fileInput);
  mount(RagPreview, { target: ragMountPoint });

  wrapper.setAttribute("data-bap-attach-menu-mounted", "true");
}

/**
 * Transforms the logo div into a real <a> tag to support "Open in new tab".
 */
function linkifyLogo() {
  // Look for the Yandex Alice logo SVG
  const logoSvg = document.querySelector('svg[viewBox="0 0 143 23"]');
  if (!logoSvg) return;

  // The clickable container is usually a few levels up
  // Based on user snippet: svg -> div (logo container) -> div (outer container)
  const container = logoSvg.closest('div');
  if (!container || container.tagName === 'A' || container.parentElement?.tagName === 'A') {
    return;
  }

  // Find the highest div that is still part of the "logo" area before hitting the nav/header
  // In the snippet, _262baab seems like the main clickable block.
  let target = container;
  if (target.parentElement && target.parentElement.classList.contains('_262baab')) {
    target = target.parentElement;
  }

  if (target.tagName === 'A') return;

  // Wrap it in an anchor
  const link = document.createElement('a');
  link.href = '/';
  link.className = 'bap-logo-link';

  link.addEventListener('click', (e) => {
    if (e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
    }
  });

  // Copy some essential layout classes if needed, but mostly we want to wrap it
  target.parentNode.insertBefore(link, target);
  link.appendChild(target);

  // Prevent the link from being processed multiple times
  link.setAttribute('data-bap-linkified', 'true');
}

/**
 * Transforms the "New Chat" div button into a real <a> tag.
 */
function linkifyNewChatButton() {
  // Look for the "Yeni sohbet" or "New chat" text
  // Since text might change with language, we use the SVG path or class if observed.
  // The SVG path provided by the user is quite unique: starts with M8 0.599609
  const allSvgs = document.querySelectorAll('svg');
  let newChatSvg = null;
  for (const svg of allSvgs) {
    if (svg.querySelector('path[d*="M8 0.599609"]')) {
      newChatSvg = svg;
      break;
    }
  }

  if (!newChatSvg) return;

  const container = newChatSvg.closest('div[tabindex="0"]');
  if (!container || container.tagName === 'A' || container.parentElement?.tagName === 'A') {
    return;
  }

  if (container.hasAttribute('data-bap-linkified')) return;

  // Wrap it in an anchor
  const link = document.createElement('a');
  link.href = '/';
  link.className = 'bap-logo-link'; // Reuse the same CSS for pass-through styling
  link.setAttribute('data-bap-linkified', 'true');

  link.addEventListener('click', (e) => {
    if (e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
    }
  });

  container.parentNode.insertBefore(link, container);
  link.appendChild(container);
}

/**
 * Watch for URL changes (SPA navigation).
 */
export function startUrlWatcher() {
  if (state.urlWatchTimer) {
    return;
  }

  state.urlWatchTimer = window.setInterval(() => {
    if (location.href === state.lastUrl) {
      return;
    }
    const oldUrl = state.lastUrl;
    state.lastUrl = location.href;
    window.dispatchEvent(new CustomEvent("bap:urlChanged"));

    const isNewSessionTransition = (oldUrl === "https://alice.yandex.ru/" || oldUrl === "https://alice.yandex.ru") && state.lastUrl.includes("/chat/s/");

    state.longWork.active = false;
    state.longWork.files.clear();
    state.longWork.lastActivityAt = 0;
    
    // Only reset session pricing if it's NOT the first message transition
    if (!isNewSessionTransition) {
      state.pricing.sessionTotals = { inputCost: 0, outputCost: 0, totalCost: 0 };
      state.pricing.sessionInputTokens = 0;
      state.pricing.sessionOutputTokens = 0;
      state.pricing.pendingInjections.clear();
    } else {
      // Migrate "default" pending injection to the new real ID
      const defaultPending = state.pricing.pendingInjections.get("default");
      if (defaultPending) {
        const newId = location.href.match(/\/chat\/s\/([^\/]+)/)?.[1];
        if (newId) {
          state.pricing.pendingInjections.set(newId, defaultPending);
          state.pricing.pendingInjections.delete("default");
        }
      }
    }
    
    if (state.ui) {
      state.ui.showLongWorkOverlay(false);
    }
    const oldTotal = document.querySelector(".bap-session-total");
    if (oldTotal) oldTotal.remove();
    scheduleScan();
    checkPendingExport();
  }, 1000);

  // Focus/Visibility triggers to handle background-to-foreground transitions
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleScan();
    }
  });

  window.addEventListener("focus", () => {
    scheduleScan();
  });
}

