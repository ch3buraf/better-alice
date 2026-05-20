import { mount } from "svelte";
import CodeRunner from "../ui/CodeRunner.svelte";

const INJECTED_ATTR = "data-bap-js-run-injected";

/**
 * Scan a DOM subtree for JS code blocks and inject Run buttons.
 * Uses a DOM data attribute for dedup — survives WeakSet GC and DOM re-render.
 */
export function injectJavaScriptRunButtons(rootNode) {
  if (!rootNode) return;

  // Yandex Alice path
  const deepSeekBlocks = rootNode.querySelectorAll(`.md-code-block:not([${INJECTED_ATTR}])`);
  for (const block of deepSeekBlocks) {
    const lang = getCodeBlockLanguage(block);
    if (!lang) continue;
    const preEl = block.querySelector("pre");
    if (!preEl) continue;
    block.setAttribute(INJECTED_ATTR, "1");
    injectButton(block, preEl, lang);
  }

  // Alice / generic path: <pre><code class="language-javascript|language-js|language-typescript|language-ts">
  const jsCodes = rootNode.querySelectorAll(
    'pre code[class*="language-javascript"]:not([class*="language-bap-"]),' +
    'pre code[class*="language-js"]:not([class*="language-bap-"]):not([class*="language-json"]),' +
    'pre code[class*="language-typescript"]:not([class*="language-bap-"]),' +
    'pre code[class*="language-ts"]:not([class*="language-bap-"]):not([class*="language-tsx"])'
  );
  for (const codeEl of jsCodes) {
    const preEl = codeEl.closest("pre");
    if (!preEl || preEl.hasAttribute(INJECTED_ATTR)) continue;
    // Skip pres whose .md-code-block parent was already handled in the first
    // loop (parent has the attr, not the pre — without this check we'd double-inject).
    if (preEl.closest(`.md-code-block[${INJECTED_ATTR}]`)) continue;
    preEl.setAttribute(INJECTED_ATTR, "1");
    const cls = String(codeEl.className);
    const lang = /typescript|language-ts(\s|$)/.test(cls) ? "typescript" : "javascript";
    injectButton(preEl, preEl, lang);
  }
}

// ── Detection ────────────────────────────────────────────────────────────────

function getCodeBlockLanguage(block) {
  const banner =
    block.querySelector(".md-code-block-banner") ||
    block.querySelector('[class*="code-block-banner"]');
  
  if (banner) {
    const spans = banner.querySelectorAll("span");
    for (const span of spans) {
      const t = span.textContent.trim().toLowerCase();
      if (t === "javascript" || t === "js") return "javascript";
      if (t === "typescript" || t === "ts") return "typescript";
      // If it says something else (like python), it's definitely not JS
      if (t === "python" || t === "py" || t === "cpp" || t === "java") return null;
    }
  }

  const codeEl = block.querySelector('pre code[class*="language-"]');
  if (codeEl) {
    const cls = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
    if (cls) {
      const lang = cls.replace('language-', '').toLowerCase();
      if (lang === 'javascript' || lang === 'js') return 'javascript';
      if (lang === 'typescript' || lang === 'ts') return 'typescript';
    }
  }

  // Final check: look for JS keywords if language is unknown
  const text = block.querySelector("pre")?.textContent || "";
  if (/^(import |export |const |let |var |function |async |await |window\.|document\.)/m.test(text)) {
    // Only if it doesn't look like Python
    if (!/^(def |class |import sys|print\()/m.test(text)) {
       return "javascript";
    }
  }

  return null;
}

// ── Injection ────────────────────────────────────────────────────────────────

function injectButton(block, preEl, lang) {
  const btnContainer = findButtonContainer(block);

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.setAttribute("role", "button");
  runBtn.className = "ds-atom-button ds-text-button ds-text-button--with-icon bap-run-btn";
  runBtn.style.marginRight = "8px";
  
  const iconHtml = `
    <div class="ds-icon ds-atom-button__icon" style="font-size: 16px; width: 16px; height: 16px; margin-right: 3px; color: #f59e0b;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 18l6-6-6-6M8 6l-6 6 6 6"></path>
      </svg>
    </div>
  `;

  runBtn.innerHTML = `${iconHtml}<span><span class="code-info-button-text">Run JS</span></span><div class="ds-focus-ring"></div>`;

  let mounted = null;

  runBtn.addEventListener("click", () => {
    if (mounted) {
      mounted.instance.$destroy ? mounted.instance.$destroy() : mounted.unmount();
      mounted.container.remove();
      mounted = null;
      runBtn.querySelector(".code-info-button-text").textContent = "Run JS";
      runBtn.querySelector(".ds-icon").style.color = "#f59e0b";
      runBtn.querySelector("svg").innerHTML = '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"></path>';
      return;
    }

    // Берём только из <code> (там нет наших инжектированных button'ов).
    // Fallback: клонируем pre, удаляем все наши кнопки, тогда textContent чистый.
    const codeEl = preEl.querySelector("code");
    let code;
    if (codeEl) {
      code = codeEl.textContent || "";
    } else {
      const clone = preEl.cloneNode(true);
      clone.querySelectorAll("button, .bap-run-btn, .bap-code-download").forEach(el => el.remove());
      code = clone.textContent || "";
    }
    const container = document.createElement("div");
    block.parentNode.insertBefore(container, block.nextSibling);

    const instance = mount(CodeRunner, {
      target: container,
      props: {
        content: code,
        language: lang
      }
    });

    mounted = { instance, container, unmount: () => {} };
    import("svelte").then(({ unmount: svelteUnmount }) => {
      mounted.unmount = () => svelteUnmount(instance);
    });

    runBtn.querySelector(".code-info-button-text").textContent = "Close";
    runBtn.querySelector(".ds-icon").style.color = "#ef4444";
    runBtn.querySelector("svg").innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';
  });

  if (btnContainer) {
    btnContainer.insertBefore(runBtn, btnContainer.firstChild);
  } else {
    const banner =
      block.querySelector(".md-code-block-banner") ||
      block.querySelector('[class*="code-block-banner"]');
    if (banner) {
      banner.appendChild(runBtn);
    } else {
      // Alice / generic fallback — overlay button on <pre>
      const pre = block.tagName === "PRE" ? block : block.querySelector("pre");
      if (pre) {
        pre.style.position = pre.style.position || "relative";
        runBtn.style.position = "absolute";
        runBtn.style.top = "8px";
        runBtn.style.right = "100px";
        runBtn.style.zIndex = "10";
        runBtn.style.background = "rgba(245, 158, 11, 0.9)";
        runBtn.style.color = "white";
        runBtn.style.padding = "4px 10px";
        runBtn.style.borderRadius = "4px";
        runBtn.style.border = "none";
        runBtn.style.cursor = "pointer";
        runBtn.style.fontSize = "12px";
        pre.appendChild(runBtn);
      }
    }
  }
}

function findButtonContainer(block) {
  // Find the Copy button that Yandex Alice renders — skip buttons we injected.
  const btnText = block.querySelector(
    `.code-info-button-text:not(.bap-run-btn-text)`,
  );
  if (btnText) {
    const btn = btnText.closest("button");
    if (btn && btn.parentElement && !btn.classList.contains("bap-run-btn")) {
      return btn.parentElement;
    }
  }

  // Look for any ds-atom-button that isn't ours.
  const dsBtns = block.querySelectorAll(".ds-atom-button");
  for (const b of dsBtns) {
    if (!b.classList.contains("bap-run-btn") && b.parentElement) {
      return b.parentElement;
    }
  }

  return null;
}
