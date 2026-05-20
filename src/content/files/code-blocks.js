/**
 * Enhance code blocks with download buttons and bap-fence detection.
 *
 * Recognises Алисины ответы, выданные по нашим инструкциям из system prompt:
 *   ```bap-visualizer ... ```  → HTML/SVG iframe preview
 *   ```bap-pptx ... ```        → PptxGenJS file generation
 *   ```bap-excel ... ```       → SheetJS file generation
 *   ```bap-docx ... ```        → docx library file generation
 *   ```filename=path/X.ext ... ```  → arbitrary downloadable file
 */

import state from "../state.js";
import { CODE_EXTENSION_MAP } from "../../lib/constants.js";
import { triggerTextDownload } from "../../lib/utils/download.js";
import { buildPptx, buildXlsx, buildDocx } from "../tools/office-dsl.js";
import { upsertMemories } from "../parser/memory-parser.js";
import { upsertCharacters } from "../parser/character-parser.js";
import { mount } from "svelte";
import CodeRunner from "../ui/CodeRunner.svelte";

// Canonical fence-language values (BAP = Better Alice Pro). The extension
// also accepts the legacy `bap-*` aliases (Better Alice heritage) — they
// are normalised to BAP via `normaliseBapLang` below.
const BAP_VISUALIZER_LANG = "bap-visualizer";
const BAP_PPTX_LANG = "bap-pptx";
const BAP_EXCEL_LANG = "bap-excel";
const BAP_DOCX_LANG = "bap-docx";
const BAP_LATEX_LANG = "bap-latex";
const BAP_ASK_LANG = "bap-ask";
const BAP_MEMORY_LANG = "bap-memory";
const BAP_CHARACTER_LANG = "bap-character";
const BAP_ZIP_LANG = "bap-zip";
const FILENAME_PREFIX = "filename=";

/** Accept both legacy `bap-` and new `bap-` prefixes — normalise to `bap-`. */
function normaliseBapLang(lang) {
  if (!lang) return "";
  const s = String(lang).toLowerCase();
  if (s.startsWith("bap-")) return "bap-" + s.slice(4);
  return s;
}

let latexMsgCounter = 0;
const pendingLatex = new Map();
// Guard against non-browser environments (Vitest jsdom may not always provide window).
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (e) => {
    const { type, id, height, error } = e.data || {};
    if (type === "LATEX_RENDERED" && pendingLatex.has(id)) {
      const { iframe } = pendingLatex.get(id);
      iframe.style.height = `${height}px`;
      pendingLatex.delete(id);
    } else if (type === "LATEX_ERROR" && pendingLatex.has(id)) {
      const { fallback } = pendingLatex.get(id);
      fallback(error);
      pendingLatex.delete(id);
    }
  });
}

/**
 * Smart sniff: Alice Pro often emits raw LaTeX (\begin{displaymath}/$$/\[)
 * as plain text without using our bap-latex fence. Find such patterns in
 * assistant bubbles and render them inline through the same sandbox path.
 */
function enhanceInlineLatex() {
  const bubbles = document.querySelectorAll(
    '[data-testid="message-bubble-container"]:not([data-testid$="from-user"]), .alice-message'
  );
  const patterns = [
    { re: /\\begin\{(displaymath|equation\*?|align\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g, group: 2 },
    { re: /\\\[([\s\S]*?)\\\]/g, group: 1 },
    { re: /\$\$([\s\S]*?)\$\$/g, group: 1 },
  ];
  for (const bubble of bubbles) {
    if (bubble.dataset.balLatexScanned === "1") continue;
    const text = bubble.textContent || "";
    let matched = false;
    for (const { re } of patterns) { re.lastIndex = 0; if (re.test(text)) { matched = true; break; } }
    if (!matched) continue;

    // Find leaf text nodes (skip nodes inside <pre>, our wrappers, links)
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest("pre, code, .bap-latex-wrapper, .bap-visualizer-wrapper, #bap-root")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const candidates = [];
    let n; while ((n = walker.nextNode())) candidates.push(n);

    // Collect contiguous text-node runs that contain a LaTeX pattern, then
    // pull whole formulas spanning multiple text nodes (Alice Pro splits
    // \begin{displaymath} ... \end{displaymath} across lines).
    const blockTexts = candidates.map(n => n.nodeValue).join("\n");
    let anyMatchInBlock = false;
    for (const { re } of patterns) {
      re.lastIndex = 0;
      if (re.test(blockTexts)) { anyMatchInBlock = true; break; }
    }
    if (!anyMatchInBlock) { bubble.dataset.balLatexScanned = "1"; continue; }

    // Strategy: instead of micro-splicing across text nodes, render each
    // matched formula as a sibling iframe and strike-through the original
    // text. We collect formulas from the assembled blockTexts.
    const formulas = [];
    for (const { re, group } of patterns) {
      re.lastIndex = 0;
      let m; while ((m = re.exec(blockTexts))) {
        const tex = m[group].trim();
        if (tex && tex.length < 600) formulas.push(tex);
      }
    }
    if (!formulas.length) { bubble.dataset.balLatexScanned = "1"; continue; }

    // Mount each formula at the end of the bubble. (Inline replacement
    // across text nodes is fragile when content streams; appending is
    // robust and good enough as a fallback.)
    for (const tex of formulas) {
      const wrapper = makeLatexWrapper(tex);
      bubble.appendChild(wrapper);
    }
    bubble.dataset.balLatexScanned = "1";
  }
}

function makeLatexWrapper(latex) {
  const wrapper = document.createElement("div");
  wrapper.className = "bap-latex-wrapper";
  wrapper.style.cssText = "margin:8px 0;border:1px solid #888;border-radius:6px;overflow:auto;background:white;max-width:100%";

  const header = document.createElement("div");
  header.style.cssText = "padding:4px 10px;background:#f5f5f5;font-size:11px;font-family:system-ui;color:#333";
  header.textContent = "Better Alice • LaTeX (auto-detect)";
  wrapper.appendChild(header);

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:80px;border:0;background:white;display:block";
  iframe.src = chrome.runtime.getURL("sandbox.html");
  wrapper.appendChild(iframe);

  iframe.addEventListener("load", () => {
    setTimeout(() => {
      const id = `latex-${++latexMsgCounter}`;
      pendingLatex.set(id, {
        iframe,
        fallback: (err) => {
          iframe.replaceWith(Object.assign(document.createElement("div"), {
            textContent: "LaTeX: " + (err || "render failed"),
            style: "padding:8px 12px;font-family:system-ui;font-size:12px;color:#b00",
          }));
        },
      });
      iframe.contentWindow?.postMessage({ type: "RENDER_LATEX", latex, id, displayMode: true }, "*");
    }, 50);
  });
  return wrapper;
}

/**
 * Stream-watcher: вешает MutationObserver на <pre>/<code>; когда Алиса дописывает
 * стрим, ждёт ~700ms тишины и триггерит enhanceCodeBlockDownloads() заново —
 * stream-aware re-attach внутри неё пересоберёт handler по уже полному контенту.
 * Сам observer disconnect-ится через 8 сек bez изменений (то есть стрим закончился).
 */
function attachStreamWatcher(pre, codeElement) {
  if (pre.dataset.balStreamWatched === "1") return;
  pre.dataset.balStreamWatched = "1";

  let lastChange = Date.now();
  let rescanTimer = 0;
  const STABLE_MS = 700;       // ms тишины после последнего mutation → rescan
  const DETACH_MS = 8000;      // ms тишины → стрим закончился, observer не нужен

  const observer = new MutationObserver(() => {
    lastChange = Date.now();
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      rescanTimer = 0;
      // Триггерим повторный scan — внутри enhanceCodeBlockDownloads() сработает
      // stream-aware re-attach (видит что pre.bdsCodeSeenLen меньше текущей длины).
      try { enhanceCodeBlockDownloads(); } catch (e) { /* swallow */ }
    }, STABLE_MS);
  });
  observer.observe(codeElement, { childList: true, characterData: true, subtree: true });

  // Auto-detach после периода без изменений — стрим явно закончился.
  const detachCheck = setInterval(() => {
    if (Date.now() - lastChange > DETACH_MS) {
      observer.disconnect();
      clearInterval(detachCheck);
      pre.dataset.balStreamWatched = "done";
    }
  }, 1000);
}

/**
 * Scan all <pre> elements and attach the right action button.
 */
export function enhanceCodeBlockDownloads() {
  enhanceInlineLatex();
  const blocks = document.querySelectorAll("pre");

  for (const pre of blocks) {
    if (pre.closest("#bap-root")) continue;

    const codeElement = pre.querySelector("code");
    if (!codeElement) {
      continue;
    }

    const initialText = String(codeElement.textContent || "");
    if (!initialText.trim()) {
      continue;
    }

    // Стрим-aware re-attach: AlicePro отдаёт сообщение пакетами; если блок
    // был обработан когда контент был ещё неполным (короткий JSON), handler
    // мог упасть на attachGenericDownload вместо attachOfficeRunButton.
    // Сравниваем длину сохранённого snapshot'а — если контент сильно вырос,
    // удаляем старую кнопку и пересобираем handler по полному контенту.
    if (pre.dataset.bdsCodeDownloadAttached === "1") {
      const seen = parseInt(pre.dataset.bdsCodeSeenLen || "0", 10);
      // Любой прирост = есть что доположить (даже одна строка кода). Без порога,
      // т.к. финальный `console.log(...)` может быть <40 символов и его потеряем.
      if (initialText.length <= seen) continue;
      // Re-attach: удалить нашу старую кнопку (если есть) и сбросить флаги.
      for (const b of pre.querySelectorAll("button")) {
        const t = b.textContent || "";
        if (/Скачать|⬇|📦|📄|📊|📈|Save memory|Создать персонажа|▶ Run/.test(t)) b.remove();
      }
      // Также убрать наши wrapper'ы (memory chip, character chip, etc.) если есть.
      pre.parentElement?.querySelectorAll(":scope > .bap-memory-chip, :scope > .bap-character-chip, :scope > .bap-question-panel, :scope > .bap-auto-run-container, :scope > .bap-visualizer-wrapper, :scope > .bap-latex-wrapper")
        ?.forEach(el => el.remove());
      delete pre.dataset.balMemoryDone;
      delete pre.dataset.balCharacterDone;
      delete pre.dataset.balAutoRunDone;
      delete pre.dataset.balAskDispatched;
    }

    pre.dataset.bdsCodeDownloadAttached = "1";
    pre.dataset.bdsCodeSeenLen = String(initialText.length);
    pre.style.setProperty("position", "relative", "important");

    // Стрим-watcher: пока Алиса дописывает контент в <code>, нам нужно
    // пере-сканить блок когда он "успокоится" (потом ещё подрос). Без этого
    // юзеру приходится делать F5, чтобы handler перевыбрался по уже полному
    // контенту. Наблюдатель сам disconnect'ится через ~8 сек stable period.
    attachStreamWatcher(pre, codeElement);

    let lang = normaliseBapLang(detectLanguage(codeElement));

    // Quirk: when Alice doesn't recognise the fence language (e.g. `bap-ask`,
    // `filename=...`) her renderer drops the language onto the FIRST LINE of
    // <code> textContent instead of setting `language-…` class. Detect such
    // patterns, treat them as the language, and strip the first line so the
    // download still produces clean content.
    if (lang === "" || lang === "json" || lang === "plaintext") {
      const firstLine = String(initialText).split(/\r?\n/, 1)[0].trim();
      if (/^(bap-[a-z]+|bap-[a-z]+|filename=.+)$/i.test(firstLine)) {
        lang = normaliseBapLang(firstLine.toLowerCase());
        // Replace code content with the rest (everything after first line),
        // so subsequent handlers see only the JSON / file body.
        const rest = String(codeElement.textContent || "").replace(/^.*\r?\n/, "");
        codeElement.textContent = rest;
      }
    }

    // Smart fallback: Alice Pro especially clobbers data-language via hljs
    // auto-detect (dust/prolog/nix/fortran/json — anything but bap-*).
    // ALWAYS try content sniff when the lang isn't already one of OUR fence
    // names. Cost: parse JSON / scan first chars. Reward: works regardless
    // of what hljs thinks the language is.
    const isOurFenceLang =
      lang.startsWith("bap-") ||
      lang.startsWith(FILENAME_PREFIX);
    if (!isOurFenceLang) {
      const promoted = sniffOfficeFromJsonContent(String(codeElement.textContent || ""));
      if (promoted) lang = normaliseBapLang(promoted);
    }

    if (lang === BAP_VISUALIZER_LANG) {
      attachVisualizerButton(pre, codeElement);
    } else if (lang.startsWith(FILENAME_PREFIX)) {
      const filename = lang.slice(FILENAME_PREFIX.length);
      attachFilenameDownload(pre, codeElement, filename);
    } else if ([BAP_PPTX_LANG, BAP_EXCEL_LANG, BAP_DOCX_LANG].includes(lang)) {
      attachOfficeRunButton(pre, codeElement, lang);
    } else if (lang === BAP_LATEX_LANG) {
      attachLatexRenderer(pre, codeElement);
    } else if (lang === BAP_ASK_LANG) {
      attachAskQuestion(pre, codeElement);
    } else if (lang === BAP_MEMORY_LANG) {
      attachMemoryWrite(pre, codeElement);
    } else if (lang === BAP_CHARACTER_LANG) {
      attachCharacterCreate(pre, codeElement);
    } else if (lang === BAP_ZIP_LANG) {
      attachZipDownload(pre, codeElement);
    } else if (/^bap-run-(python|py|javascript|js|typescript|ts)$/i.test(lang)) {
      const codeLang = lang.replace(/^bap-run-/i, "").toLowerCase();
      attachAutoRun(pre, codeElement, codeLang);
    } else {
      attachGenericDownload(pre, codeElement);
    }
  }
}

/**
 * Quick structural sniff: detect whether a JSON blob is our office-DSL
 * (slides → pptx, sheets/rows → excel, paragraphs → docx) so we can
 * gracefully handle Алисины ```json fallbacks when she ignores the
 * ```bap-pptx fence marker.
 */
/**
 * Strip leading blank lines + a single `bap-X` / `filename=...` marker line
 * from textContent. Used by every fence-handler that needs clean JSON / code.
 */
function stripFenceMarker(raw) {
  let s = String(raw || "");
  // Drop leading blank lines
  s = s.replace(/^(?:\s*\r?\n)+/, "");
  // Then drop the lang marker line itself if present (both bap- and bap- aliases)
  s = s.replace(/^(?:bap-[a-z][a-z0-9-]*|bap-[a-z][a-z0-9-]*|filename=[^\s]+)\r?\n/i, "");
  return s.trim();
}

/**
 * Content-based language sniff. On Alice Pro the data-language attribute
 * gets clobbered by hljs auto-detect (dust/prolog/nix/fortran/json/python
 * for actual bap-* content), so we cannot rely on declared language at all.
 * Sniff the actual textContent and recover the original fence intent.
 */
function sniffOfficeFromJsonContent(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // Non-JSON content sniffs FIRST — these match by textual pattern, not
  // structural JSON. Important because bap-latex / bap-visualizer / bap-run /
  // filename= content is not JSON at all.

  // Alice Pro sometimes keeps the fence marker as the first non-empty
  // textContent line (when hljs doesn't recognise the lang). Also Alice
  // occasionally inserts a blank line right after the opening backticks
  // (so the marker sits on line 2). Find the first non-empty line and check
  // for `bap-X` or `filename=…`.
  const lines = raw.split(/\r?\n/);
  let firstNonEmpty = "";
  for (const l of lines) { if (l.trim()) { firstNonEmpty = l.trim(); break; } }
  if (/^filename=[^\s]+/i.test(firstNonEmpty)) return firstNonEmpty.toLowerCase();
  if (/^(?:bds|bap)-[a-z][a-z0-9-]*$/i.test(firstNonEmpty)) return normaliseBapLang(firstNonEmpty.toLowerCase());
  // Alice Pro sometimes strips `filename=…` line entirely and replaces lang
  // with hljs auto-detect. Recover via inline comment: `// filename: fact.js`
  // (and `# filename: ...` for Python, `-- filename: ...` for SQL, etc.).
  const commentFilenameMatch = firstNonEmpty.match(/^(?:\/\/|#|--|;)\s*filename:\s*(\S+)/i);
  if (commentFilenameMatch) return ("filename=" + commentFilenameMatch[1]).toLowerCase();

  // LaTeX: \begin{...} / \frac / \sum / \int / \[ / explicit display math
  if (/\\begin\{[a-z*]+\}|\\frac\b|\\sum\b|\\int\b|\\det\b|\\sqrt\b/i.test(raw)) {
    if (!/^\s*[\{\[]/.test(raw)) return BAP_LATEX_LANG;
  }
  // Visualizer: HTML/SVG markup at top level
  if (/^\s*<(svg|html|div|canvas|script|style)[\s>]/i.test(raw) ||
      (/<svg[\s>][\s\S]*<\/svg>/i.test(raw) && /<(circle|rect|path|line)[\s>]/i.test(raw))) {
    return BAP_VISUALIZER_LANG;
  }

  // Python content (Alice Pro mis-detects bap-run-python as hljs language
  // like "fortran", "dust", "python" — promote based on content patterns).
  // Conservative match — must START with Python-keyword, not be JSON/JS.
  if (/^[\s#]*(?:import |from |def |print\(|#!\/usr\/bin\/env python|class .+:)/m.test(raw) &&
      !/^[\s]*[\{\[]/.test(raw) && !/^\s*(?:const |let |var |function |=>)/m.test(raw)) {
    return "bap-run-python";
  }

  try {
    const obj = JSON.parse(raw);
    if (obj === null || obj === undefined) return null;

    // ─── Array sniffs (priority order matters) ─────────────────────────
    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
      // Array of {key, value, importance} → bap-memory (MUST come before Excel
      // sniff — array of objects with 2+ keys also matches Excel, but memory
      // has a recognisable signature).
      if (obj.every(q => q && typeof q === "object" && "key" in q && ("value" in q || "content" in q))) {
        return BAP_MEMORY_LANG;
      }
      // Array of {question, ...} → bap-ask
      if (obj.every(q => q && typeof q === "object" && "question" in q)) {
        return BAP_ASK_LANG;
      }
      // Array of {path, content} or {filename, content} → bap-zip (without wrapper)
      if (obj.every(f => f && typeof f === "object" && ("path" in f || "filename" in f) && "content" in f)) {
        return BAP_ZIP_LANG;
      }
      // Last resort: array of objects with consistent keys → Excel sheet
      const keys = Object.keys(obj[0]);
      if (keys.length >= 2) return BAP_EXCEL_LANG;
    }

    // ─── Wrapped/single-object sniffs ──────────────────────────────────
    if (obj && typeof obj === "object" && Array.isArray(obj.questions) && obj.questions[0]?.question) {
      return BAP_ASK_LANG;
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      // Single memory entry: {key, value, importance?}
      if ("key" in obj && ("value" in obj || "content" in obj)) {
        return BAP_MEMORY_LANG;
      }
      // Character: {name, content, usage|description}
      if ("name" in obj && ("content" in obj || "prompt" in obj || "persona" in obj) &&
          ("usage" in obj || "description" in obj)) {
        return BAP_CHARACTER_LANG;
      }
    }

    if (typeof obj !== "object") return null;

    // Unwrap common wrappers
    const inner = obj.document || obj.doc || obj.presentation || obj.spreadsheet || obj.workbook || obj;

    if (Array.isArray(inner.slides)) return BAP_PPTX_LANG;
    if (Array.isArray(inner.sheets)) return BAP_EXCEL_LANG;
    if (Array.isArray(inner.paragraphs)) return BAP_DOCX_LANG;
    if (Array.isArray(inner.files) && inner.files[0] && ("path" in inner.files[0] || "filename" in inner.files[0])) return BAP_ZIP_LANG;
    if (Array.isArray(inner.sections)) return BAP_DOCX_LANG;
    if (Array.isArray(inner.data) && Array.isArray(inner.columns)) return BAP_EXCEL_LANG;
    if (Array.isArray(inner.rows)) return BAP_EXCEL_LANG;

    // Plain key-value (e.g. {понедельник:"...",вторник:"..."}) → docx
    const vals = Object.values(obj);
    if (vals.length >= 3 && vals.every(v => typeof v === "string" || (typeof v === "object" && v !== null))) {
      return BAP_DOCX_LANG;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function attachGenericDownload(pre, codeElement) {
  const button = mkButton("Скачать", () => {
    const freshText = String(codeElement.textContent || "").trim();
    if (!freshText) return;
    const extension = detectCodeExtension(codeElement);
    const fileName = `snippet-${++state.downloadCounter}.${extension}`;
    triggerTextDownload(freshText, fileName);
  });
  pre.appendChild(button);
}

function attachFilenameDownload(pre, codeElement, filename) {
  // Hide the raw fence in the page (it's not useful for the user)
  pre.style.maxHeight = "200px";
  pre.style.overflow = "auto";
  const button = mkButton(`⬇ ${filename}`, () => {
    const freshText = String(codeElement.textContent || "").trim();
    if (!freshText) return;
    triggerTextDownload(freshText, filename);
  });
  pre.appendChild(button);

  // Auto-download if user enabled the setting
  if (state.settings?.autoDownloadFiles) {
    const freshText = String(codeElement.textContent || "").trim();
    if (freshText) triggerTextDownload(freshText, filename);
  }
}

function attachVisualizerButton(pre, codeElement) {
  pre.style.maxHeight = "100px";
  pre.style.overflow = "auto";
  pre.style.opacity = "0.4";

  const wrapper = document.createElement("div");
  wrapper.className = "bap-visualizer-wrapper";
  wrapper.style.cssText = "margin:8px 0;border:1px solid #888;border-radius:6px;overflow:auto;background:white;max-width:100%";

  const header = document.createElement("div");
  header.style.cssText = "padding:6px 12px;background:#f5f5f5;font-size:12px;font-family:system-ui;display:flex;justify-content:space-between;align-items:center;color:#333";
  const label = document.createElement("span");
  label.textContent = "Better Alice • Визуализация";
  header.appendChild(label);

  const expandBtn = document.createElement("button");
  expandBtn.textContent = "↗ Открыть код";
  expandBtn.style.cssText = "background:transparent;border:1px solid #999;border-radius:3px;padding:2px 6px;font-size:11px;cursor:pointer;color:#333";
  expandBtn.addEventListener("click", () => {
    pre.style.maxHeight = pre.style.maxHeight === "100px" ? "none" : "100px";
    pre.style.opacity = pre.style.opacity === "0.4" ? "1" : "0.4";
  });
  header.appendChild(expandBtn);

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:400px;border:0;background:white";
  iframe.setAttribute("sandbox", "allow-scripts");

  wrapper.appendChild(header);
  wrapper.appendChild(iframe);
  pre.insertAdjacentElement("afterend", wrapper);

  // Re-render on streaming completion: re-read text and update iframe srcdoc
  let lastText = "";
  const updateFrame = () => {
    const text = String(codeElement.textContent || "").trim();
    if (text === lastText) return;
    lastText = text;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;padding:8px;color:#000}.v-card{border:1px solid #000;padding:1em}.v-btn{background:#1e3a8a;color:white;padding:6px 12px;border:0;cursor:pointer}.v-title{font-weight:bold;text-transform:uppercase;border-bottom:1px solid #000;padding-bottom:4px;margin-bottom:8px}</style></head><body>${text}</body></html>`;
    iframe.srcdoc = html;
  };
  updateFrame();
  // Poll for streaming updates (cheap; runs while element is in DOM)
  const interval = setInterval(() => {
    if (!document.body.contains(pre)) { clearInterval(interval); return; }
    updateFrame();
  }, 800);
  // Stop polling after 60s (assume streaming finished)
  setTimeout(() => clearInterval(interval), 60000);
}

function attachLatexRenderer(pre, codeElement) {
  // Render via extension sandbox (KaTeX loaded from CDN there — Yandex page
  // CSP blocks jsdelivr.net for us, but sandbox CSP allows it).
  pre.style.maxHeight = "80px";
  pre.style.overflow = "auto";
  pre.style.opacity = "0.5";

  const wrapper = document.createElement("div");
  wrapper.className = "bap-latex-wrapper";
  wrapper.style.cssText = "margin:8px 0;border:1px solid #888;border-radius:6px;overflow:auto;background:white;max-width:100%";

  const header = document.createElement("div");
  header.style.cssText = "padding:4px 10px;background:#f5f5f5;font-size:11px;font-family:system-ui;color:#333;display:flex;justify-content:space-between;align-items:center";
  const label = document.createElement("span");
  label.textContent = "Better Alice • LaTeX";
  header.appendChild(label);
  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "↗ Исходник";
  toggleBtn.style.cssText = "background:transparent;border:1px solid #999;border-radius:3px;padding:2px 6px;font-size:11px;cursor:pointer;color:#333";
  toggleBtn.addEventListener("click", () => {
    const collapsed = pre.style.maxHeight === "80px";
    pre.style.maxHeight = collapsed ? "none" : "80px";
    pre.style.opacity = collapsed ? "1" : "0.5";
  });
  header.appendChild(toggleBtn);

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:80px;border:0;background:white;display:block";
  iframe.src = chrome.runtime.getURL("sandbox.html");

  wrapper.appendChild(header);
  wrapper.appendChild(iframe);
  pre.insertAdjacentElement("afterend", wrapper);

  const sendLatex = () => {
    const latex = String(codeElement.textContent || "").trim();
    if (!latex) return;
    const id = `latex-${++latexMsgCounter}`;
    pendingLatex.set(id, {
      iframe,
      fallback: (err) => {
        const errBox = document.createElement("div");
        errBox.style.cssText = "padding:8px 12px;font-family:system-ui;font-size:12px;color:#b00";
        errBox.textContent = "LaTeX: " + (err || "render failed");
        iframe.replaceWith(errBox);
      },
    });
    iframe.contentWindow?.postMessage({ type: "RENDER_LATEX", latex, id, displayMode: true }, "*");
  };

  iframe.addEventListener("load", () => {
    // Give the sandbox a tick to wire up its message listener.
    setTimeout(sendLatex, 50);
  });

  // Re-render on streaming completion
  let lastText = String(codeElement.textContent || "");
  const interval = setInterval(() => {
    if (!document.body.contains(pre)) { clearInterval(interval); return; }
    const t = String(codeElement.textContent || "");
    if (t !== lastText) {
      lastText = t;
      sendLatex();
    }
  }, 800);
  setTimeout(() => clearInterval(interval), 60000);
}

function attachAskQuestion(pre, codeElement) {
  // Hide the raw fence and dispatch a `bap-ask-questions` event so the
  // QuestionPanel.svelte component picks it up and renders the interactive
  // panel directly inside the prompt box.
  pre.style.display = "none";
  if (pre.dataset.balAskDispatched === "1") return;
  pre.dataset.balAskDispatched = "1";

  let lastNormalised = null;
  const tryDispatch = () => {
    const raw = stripFenceMarker(String(codeElement.textContent || ""));
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const questions = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.questions) ? parsed.questions : null);
      if (!questions || !questions.length) return false;
      const normalised = questions.map((q, i) => ({
        id: q.id || `q_${i}`,
        question: String(q.question || q.text || ""),
        type: q.type || "single",
        options: Array.isArray(q.options) ? q.options : [],
        allowCustom: q.allowCustom !== false,
      })).filter(q => q.question);
      if (!normalised.length) return false;
      lastNormalised = normalised;
      window.dispatchEvent(new CustomEvent("bap-ask-questions", {
        detail: { questions: normalised, messageNode: pre.closest('[data-testid="message-bubble-container"], .alice-message') },
      }));
      return true;
    } catch (e) {
      return false;
    }
  };

  if (!tryDispatch()) {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (tryDispatch() || tries > 20 || !document.body.contains(pre)) clearInterval(iv);
    }, 500);
  }

  // QuestionPanel.svelte mounts after scanner first-pass, so the initial
  // window dispatch may fire before its listener attaches. Re-dispatch
  // every 800ms until the panel actually appears in the DOM (max 30 tries).
  let pollTries = 0;
  const poll = setInterval(() => {
    pollTries++;
    if (document.querySelector(".bap-question-panel") || pollTries > 30 || !lastNormalised) {
      clearInterval(poll);
      return;
    }
    window.dispatchEvent(new CustomEvent("bap-ask-questions", {
      detail: { questions: lastNormalised, messageNode: pre.closest('[data-testid="message-bubble-container"], .alice-message') },
    }));
  }, 800);
}

function attachMemoryWrite(pre, codeElement) {
  if (pre.dataset.balMemoryDone === "1") return;
  pre.dataset.balMemoryDone = "1";
  pre.style.display = "none";

  const tryPersist = () => {
    const raw = stripFenceMarker(String(codeElement.textContent || ""));
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const valid = items
        .map(it => ({
          key: it.key || it.name || it.key_name,
          value: it.value ?? it.content ?? "",
          importance: it.importance || "called",
        }))
        .filter(it => it.key && String(it.value).trim());
      if (!valid.length) return false;
      upsertMemories(valid);
      // Surface to user
      if (state.ui?.showToast) {
        state.ui.showToast(`Память: записано ${valid.length} ${valid.length === 1 ? 'факт' : 'фактов'}`);
      }
      // Insert visible chip so the user knows it happened (vs silent persist)
      const chip = document.createElement("div");
      chip.className = "bap-memory-chip";
      chip.style.cssText = "margin:8px 0;padding:8px 12px;background:#eaf3ff;border:1px solid #bcd6ff;border-radius:6px;font-family:system-ui;font-size:13px;color:#234;display:inline-block";
      chip.textContent = `💾 Better Alice запомнил: ${valid.map(v => v.key).join(", ")}`;
      pre.insertAdjacentElement("afterend", chip);
      return true;
    } catch (e) {
      return false;
    }
  };

  if (!tryPersist()) {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (tryPersist() || tries > 20 || !document.body.contains(pre)) clearInterval(iv);
    }, 500);
  }
}

function attachCharacterCreate(pre, codeElement) {
  if (pre.dataset.balCharacterDone === "1") return;
  pre.dataset.balCharacterDone = "1";
  pre.style.display = "none";

  const tryPersist = () => {
    const raw = stripFenceMarker(String(codeElement.textContent || ""));
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const valid = items
        .map(it => ({
          name: it.name || "New Character",
          usage: it.usage || it.kullanim_alani || it.description || "",
          content: it.content || it.prompt || it.persona || "",
        }))
        .filter(it => it.content);
      if (!valid.length) return false;
      upsertCharacters(valid);
      if (state.ui?.showToast) {
        state.ui.showToast(`Персонаж сохранён: ${valid.map(v => v.name).join(", ")}`);
      }
      const chip = document.createElement("div");
      chip.className = "bap-character-chip";
      chip.style.cssText = "margin:8px 0;padding:8px 12px;background:#fff4e6;border:1px solid #ffcb91;border-radius:6px;font-family:system-ui;font-size:13px;color:#5a3a00;display:inline-block";
      chip.textContent = `🎭 Better Alice сохранил персонажа: ${valid.map(v => v.name).join(", ")}`;
      pre.insertAdjacentElement("afterend", chip);
      return true;
    } catch (e) {
      return false;
    }
  };

  if (!tryPersist()) {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (tryPersist() || tries > 20 || !document.body.contains(pre)) clearInterval(iv);
    }, 500);
  }
}

function attachAutoRun(pre, codeElement, language) {
  if (pre.dataset.balAutoRunDone === "1") return;
  pre.dataset.balAutoRunDone = "1";

  pre.style.maxHeight = "120px";
  pre.style.overflow = "auto";
  pre.style.opacity = "0.6";

  const raw = stripFenceMarker(String(codeElement.textContent || ""));
  if (!raw) return;

  const container = document.createElement("div");
  container.className = "bap-auto-run-container";
  container.style.cssText = "margin:8px 0;border:1px solid #888;border-radius:6px;overflow:hidden;background:white";

  const header = document.createElement("div");
  header.style.cssText = "padding:4px 10px;background:#f5f5f5;font-size:11px;font-family:system-ui;color:#333";
  header.textContent = `Better Alice • Auto-run (${language})`;
  container.appendChild(header);

  pre.insertAdjacentElement("afterend", container);
  mount(CodeRunner, {
    target: container,
    props: { content: raw, language },
  });
}

function attachZipDownload(pre, codeElement) {
  pre.style.maxHeight = "120px";
  pre.style.overflow = "auto";
  pre.style.opacity = "0.5";

  const button = mkButton("📦 Скачать .zip", async () => {
    const raw = stripFenceMarker(String(codeElement.textContent || ""));
    try {
      const parsed = JSON.parse(raw);
      const files = Array.isArray(parsed?.files) ? parsed.files : Array.isArray(parsed) ? parsed : null;
      if (!files?.length) throw new Error("Файлы не найдены в JSON-спецификации");

      const { zipSync, strToU8 } = await import("fflate");
      const entries = {};
      for (const f of files) {
        const path = String(f.path || f.fileName || f.filename || "").trim();
        const content = String(f.content ?? f.body ?? "");
        if (!path) continue;
        entries[path] = strToU8(content);
      }
      const zipped = zipSync(entries, { level: 6 });
      const blob = new Blob([zipped], { type: "application/zip" });
      const fileName = String(parsed?.fileName || parsed?.filename || "project.zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; document.body.appendChild(a);
      a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      button.textContent = `✓ ${fileName} (${Object.keys(entries).length} ф.)`;
      setTimeout(() => { button.textContent = "📦 Скачать .zip"; }, 2500);
    } catch (e) {
      console.error("[BetterAlice] zip build failed:", e);
      button.textContent = "✗ " + (e?.message || e).slice(0, 50);
    }
  });
  pre.appendChild(button);

  // Auto-download if setting enabled
  if (state.settings?.autoDownloadLongWorkZip) {
    setTimeout(() => button.click(), 800);
  }
}

function attachOfficeRunButton(pre, codeElement, lang) {
  const labelMap = {
    [BAP_PPTX_LANG]: "📊 Скачать .pptx",
    [BAP_EXCEL_LANG]: "📈 Скачать .xlsx",
    [BAP_DOCX_LANG]: "📄 Скачать .docx",
  };
  const originalLabel = labelMap[lang] || "Выполнить";
  const button = mkButton(originalLabel, async () => {
    const freshText = String(codeElement.textContent || "").trim();
    if (!freshText) return;
    const originalText = button.textContent;
    try {
      button.textContent = "⏳ Генерирую...";
      button.disabled = true;
      await runOfficeCode(lang, freshText);
      button.textContent = "✓ Готово";
      setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000);
    } catch (e) {
      console.error("[BetterAlice] office run failed:", e);
      button.textContent = "✗ Ошибка: " + (e?.message || e).slice(0, 40);
      setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 4000);
    }
  });
  pre.appendChild(button);
}

async function runOfficeCode(lang, code) {
  // We parse JSON-DSL ourselves and call PptxGenJS / SheetJS / docx APIs —
  // NO eval / new Function, so Yandex CSP doesn't block us.
  if (lang === BAP_PPTX_LANG) {
    await buildPptx(code);
  } else if (lang === BAP_EXCEL_LANG) {
    await buildXlsx(code);
  } else if (lang === BAP_DOCX_LANG) {
    await buildDocx(code);
  } else {
    throw new Error("unknown office lang: " + lang);
  }
}

function mkButton(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "bap-code-download";
  b.textContent = label;
  // Force-visible inline styles. Alice Pro CSS may otherwise hide <button>
  // inside <pre>. setProperty + "important" overrides their rules.
  const force = (k, v) => b.style.setProperty(k, v, "important");
  force("display", "inline-flex");
  force("align-items", "center");
  force("gap", "4px");
  force("position", "absolute");
  force("top", "8px");
  force("right", "8px");
  force("z-index", "100");
  force("padding", "5px 10px");
  force("background", "rgba(74, 107, 254, 0.95)");
  force("color", "white");
  force("border", "none");
  force("border-radius", "5px");
  force("font-size", "12px");
  force("font-family", "system-ui, -apple-system, sans-serif");
  force("cursor", "pointer");
  force("box-shadow", "0 2px 6px rgba(0,0,0,0.2)");
  force("white-space", "nowrap");
  force("visibility", "visible");
  force("opacity", "1");
  b.addEventListener("mouseenter", () => b.style.setProperty("background", "rgba(74, 107, 254, 1)", "important"));
  b.addEventListener("mouseleave", () => b.style.setProperty("background", "rgba(74, 107, 254, 0.95)", "important"));
  b.addEventListener("click", onClick);
  return b;
}

function detectLanguage(codeElement) {
  // Alice Pro (Svelte) emits the language as `<pre data-language="bap-docx">`
  // and uses generic `class="hljs"` on <code>, so neither language- nor
  // lang- classes are present. Read data-language first.
  const pre = codeElement.parentElement;
  const dataLang = pre?.getAttribute?.("data-language");
  if (dataLang) return String(dataLang).toLowerCase();

  const className = `${codeElement.className || ""} ${
    pre ? pre.className : ""
  }`;
  const m = className.match(/language-([^\s]+)/i) || className.match(/lang-([^\s]+)/i);
  return m ? String(m[1] || "").toLowerCase() : "";
}

/**
 * Detect file extension from a code element's language class.
 */
function detectCodeExtension(codeElement) {
  const className = `${codeElement.className || ""} ${
    codeElement.parentElement ? codeElement.parentElement.className : ""
  }`;
  const languageMatch =
    className.match(/language-([a-z0-9_+-]+)/i) ||
    className.match(/lang-([a-z0-9_+-]+)/i);

  if (languageMatch) {
    const lang = String(languageMatch[1] || "").toLowerCase();
    if (CODE_EXTENSION_MAP[lang]) {
      return CODE_EXTENSION_MAP[lang];
    }
  }

  const firstLine = String(codeElement.textContent || "")
    .split("\n")[0]
    .toLowerCase();
  if (firstLine.startsWith("#!/usr/bin/env python")) {
    return "py";
  }

  return "txt";
}
