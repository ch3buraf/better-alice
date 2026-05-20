/**
 * Alice ART image enhancer.
 *
 * Yandex Алиса умеет генерировать картинки через свой ART tool. Они
 * рендерятся внутри DivKit-карты как:
 *   <div class="MessageBubble-Container_type_divjson">
 *     ...
 *     <img src="https://yaart-web-alice-images.s3.yandex.net/{uuid}:1" ...>
 *   </div>
 *
 * Эта надстройка находит такие `<img>` и навешивает на каждую overlay
 * со скрытыми по умолчанию кнопками: Download, Copy URL, Open in new tab.
 * Overlay становится видимым при hover'е (или tap'е на мобильном).
 */

import { triggerTextDownload } from "../../lib/utils/download.js";

const ART_URL_PATTERN = /yaart-web-alice-images\.s3\.yandex\.net/;
const PROCESSED_ATTR = "data-bal-art-enhanced";

export function scanArtImages() {
  const imgs = document.querySelectorAll("img");
  for (const img of imgs) {
    enhanceImage(img);
  }
}

function enhanceImage(img) {
  if (!img || img.hasAttribute(PROCESSED_ATTR)) return;
  const src = img.getAttribute("src") || "";
  if (!ART_URL_PATTERN.test(src)) return;

  img.setAttribute(PROCESSED_ATTR, "1");

  // Wrap the img in a positioned container if it's not already inside one.
  // We do NOT replace the existing DOM — we add a sibling overlay.
  const parent = img.parentElement;
  if (!parent) return;

  // Ensure parent has position: relative so absolute overlay anchors correctly
  const computed = window.getComputedStyle(parent);
  if (computed.position === "static") {
    parent.style.position = "relative";
  }

  const overlay = document.createElement("div");
  overlay.className = "bal-art-overlay";
  overlay.style.cssText = [
    "position:absolute",
    "top:6px",
    "right:6px",
    "display:flex",
    "gap:4px",
    "opacity:0",
    "transition:opacity 120ms ease",
    "z-index:10",
    "pointer-events:none",
  ].join(";");

  parent.addEventListener("mouseenter", () => {
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "auto";
  });
  parent.addEventListener("mouseleave", () => {
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
  });

  const makeBtn = (label, title, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = title;
    b.textContent = label;
    b.style.cssText = [
      "padding:4px 8px",
      "background:rgba(0,0,0,0.7)",
      "color:white",
      "border:none",
      "border-radius:4px",
      "cursor:pointer",
      "font-size:11px",
      "font-family:system-ui,sans-serif",
      "white-space:nowrap",
    ].join(";");
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      onClick();
    });
    return b;
  };

  overlay.appendChild(
    makeBtn("⬇", "Скачать", () => downloadArtImage(src))
  );
  overlay.appendChild(
    makeBtn("⧉", "Копировать URL", () => {
      navigator.clipboard?.writeText(src);
    })
  );
  overlay.appendChild(
    makeBtn("↗", "Открыть в новой вкладке", () => {
      window.open(src, "_blank", "noopener");
    })
  );

  // Insert after the img inside the parent
  parent.appendChild(overlay);
}

async function downloadArtImage(src) {
  try {
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const ext = (blob.type.split("/")[1] || "png").split(";")[0];
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alice-art-${ts}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    // Fallback: open in new tab so user can right-click → save
    window.open(src, "_blank", "noopener");
  }
}

/**
 * Set up a MutationObserver that re-scans when new <img> elements appear.
 * Called once by content/index.js init.
 */
export function observeArtImages() {
  scanArtImages();
  const obs = new MutationObserver((mutations) => {
    let needsRescan = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue; // ELEMENT_NODE
        if (node.tagName === "IMG" || node.querySelector?.("img")) {
          needsRescan = true;
          break;
        }
      }
      if (needsRescan) break;
    }
    if (needsRescan) scanArtImages();
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
