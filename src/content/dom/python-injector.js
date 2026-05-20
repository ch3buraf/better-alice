import { mount } from "svelte";
import CodeRunner from "../ui/CodeRunner.svelte";

const INJECTED_ATTR = "data-bap-py-run-injected";

/**
 * Scan a DOM subtree for Python code blocks and inject Run buttons.
 * Uses a DOM data attribute for dedup — survives WeakSet GC and DOM re-render.
 */
export function injectPythonRunButtons(rootNode) {
  if (!rootNode) return;

  // Yandex Alice path: .md-code-block wrapper
  const deepSeekBlocks = rootNode.querySelectorAll(`.md-code-block:not([${INJECTED_ATTR}])`);
  for (const block of deepSeekBlocks) {
    if (!isPythonCodeBlock(block)) continue;
    const preEl = block.querySelector("pre");
    if (!preEl) continue;
    block.setAttribute(INJECTED_ATTR, "1");
    injectButton(block, preEl);
  }

  // Alice / generic path: any <pre><code class="language-python"> not yet injected.
  // We use the <pre> itself as the marker host. Also skip pres that live inside
  // an already-handled `.md-code-block` parent (first loop marked the parent,
  // not the pre — without this check we'd double-inject).
  const pythonCodes = rootNode.querySelectorAll(
    'pre code[class*="language-python"]:not([class*="language-bap-"]):not([class*="language-filename="])'
  );
  for (const codeEl of pythonCodes) {
    const preEl = codeEl.closest("pre");
    if (!preEl || preEl.hasAttribute(INJECTED_ATTR)) continue;
    if (preEl.closest(`.md-code-block[${INJECTED_ATTR}]`)) continue;
    preEl.setAttribute(INJECTED_ATTR, "1");
    injectButton(preEl, preEl);
  }
}

// ── Detection ────────────────────────────────────────────────────────────────

function isPythonCodeBlock(block) {
  const banner =
    block.querySelector(".md-code-block-banner") ||
    block.querySelector('[class*="code-block-banner"]');
  if (banner) {
    const spans = banner.querySelectorAll("span");
    for (const span of spans) {
      const t = span.textContent.trim().toLowerCase();
      if (t === "python" || t === "py" || t === "python3") return true;
      // If it explicitly says JS/TS, it's not Python
      if (t === "javascript" || t === "js" || t === "typescript" || t === "ts") return false;
    }
  }

  const codeEl = block.querySelector(
    'pre code[class*="language-python"], pre code[class*="language-py"]'
  );
  if (codeEl) return true;

  if (block.querySelector('.token.keyword + .token.function')) {
    const text = block.querySelector("pre")?.textContent || "";
    if (/^(import |from |def |class )/m.test(text)) {
       // Avoid false positive with JS
       if (!/^(const |let |var |function |async |await )/m.test(text)) {
         return true;
       }
    }
  }

  return false;
}

// ── Injection ────────────────────────────────────────────────────────────────

function injectButton(block, preEl) {
  const btnContainer = findButtonContainer(block);

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.setAttribute("role", "button");
  runBtn.className = "ds-atom-button ds-text-button ds-text-button--with-icon bap-run-btn";
  runBtn.style.marginRight = "8px";

  const iconHtml = `
    <div class="ds-icon ds-atom-button__icon" style="font-size: 16px; width: 16px; height: 16px; margin-right: 3px; color: #10b981;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
    </div>
  `;

  runBtn.innerHTML = `${iconHtml}<span><span class="code-info-button-text">Run Python</span></span><div class="ds-focus-ring"></div>`;

  let mounted = null;

  runBtn.addEventListener("click", () => {
    if (mounted) {
      mounted.instance.$destroy ? mounted.instance.$destroy() : mounted.unmount();
      mounted.container.remove();
      mounted = null;
      runBtn.querySelector(".code-info-button-text").textContent = "Run Python";
      runBtn.querySelector(".ds-icon").style.color = "#10b981";
      runBtn.querySelector("svg").innerHTML = '<path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>';
      return;
    }

    // Read code from <code> only (not <pre> which may include our injected
    // buttons «Run Python», «Скачать»). Fallback to cloned pre with buttons
    // stripped if there's no <code>.
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
        language: "python"
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
      // Alice / generic — no Yandex Alice banner. Position the Run button on top
      // of the <pre> using the same approach as bap-code-download.
      const pre = block.tagName === "PRE" ? block : block.querySelector("pre");
      if (pre) {
        pre.style.position = pre.style.position || "relative";
        runBtn.style.position = "absolute";
        runBtn.style.top = "8px";
        runBtn.style.right = "100px"; // place left of Download button
        runBtn.style.zIndex = "10";
        runBtn.style.background = "rgba(16, 185, 129, 0.9)";
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
