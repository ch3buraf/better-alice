/**
 * JSON-DSL parsers for bap-pptx / bap-excel / bap-docx code blocks.
 *
 * Instead of running model-generated JavaScript (which is blocked by Yandex CSP),
 * we ask Алиса to return a declarative JSON spec, and we build the file ourselves
 * using PptxGenJS / SheetJS / docx-js called from compiled extension code.
 *
 * Robust to common model quirks:
 *  - Extra whitespace / trailing commas (tolerate via simple cleanup)
 *  - YAML-style output (detected, friendly error returned)
 *  - JSON with comments (// stripped before parse)
 */

import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx";
import * as DOCX from "docx";

function cleanupJson(text) {
  // Strip // line comments and /* */ block comments — common model artifact
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/,(\s*[}\]])/g, "$1") // trailing commas
    .trim();
}

function tryParseJson(text) {
  const cleaned = cleanupJson(text);
  try {
    return { ok: true, data: JSON.parse(cleaned) };
  } catch (e) {
    // Detect YAML-ish output (model didn't follow spec)
    const looksYaml = /^[\w-]+:\s*$/m.test(cleaned) || /^\s+-\s+/m.test(cleaned);
    return {
      ok: false,
      error: looksYaml
        ? "Алиса вернула YAML вместо JSON. Попроси её: \"Используй ИМЕННО валидный JSON, не YAML и не комментарии\""
        : "Не получилось распарсить JSON: " + (e.message || e),
    };
  }
}

// ── PPTX ──────────────────────────────────────────────────────────────

export async function buildPptx(jsonText) {
  const parsed = tryParseJson(jsonText);
  if (!parsed.ok) throw new Error(parsed.error);
  let spec = parsed.data;
  if (!spec || typeof spec !== "object") throw new Error("Ожидался JSON-объект");
  // Unwrap Alice Pro wrappers: {presentation: {slides:[]}}, {document: {slides:[]}}
  if (spec.presentation && typeof spec.presentation === "object") spec = spec.presentation;
  else if (spec.document && typeof spec.document === "object") spec = spec.document;

  const pptx = new PptxGenJS();
  const slides = Array.isArray(spec.slides) ? spec.slides : [];
  if (!slides.length) throw new Error("Нет ни одного слайда в spec.slides");

  for (let idx = 0; idx < slides.length; idx++) {
    const s = slides[idx];
    const slide = pptx.addSlide();
    // Infer layout when Алиса не указала: первый слайд = title, есть bullets =
    // content, иначе text. Это даёт robust experience даже без явного layout.
    let layout = String(s.layout || "").toLowerCase();
    if (!layout) {
      if (idx === 0 && (s.subtitle || /титул|заголовок/i.test(String(s.title || "")))) {
        layout = "title";
      } else if (Array.isArray(s.bullets) || Array.isArray(s.items) || Array.isArray(s.points)) {
        layout = "content";
      } else if (s.left || s.right || s.leftColumn || s.rightColumn) {
        layout = "two-columns";
      } else if (s.footer || /итог|заключение|conclusion|summary/i.test(String(s.title || ""))) {
        layout = "summary";
      } else {
        layout = "text";
      }
    }

    if (layout === "title") {
      slide.addText(String(s.title || ""), {
        x: 0.5, y: 1.2, w: 9, h: 1.5,
        align: "center", fontSize: 32, bold: true, color: "003366",
      });
      if (s.subtitle || s.content) {
        slide.addText(String(s.subtitle || s.content || ""), {
          x: 0.5, y: 3.0, w: 9, h: 1,
          align: "center", fontSize: 18, color: "666666",
        });
      }
    } else if (layout === "content") {
      if (s.title) {
        slide.addText(String(s.title), { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 24, bold: true, color: "C00000" });
      }
      const bullets = Array.isArray(s.bullets) ? s.bullets
        : Array.isArray(s.items) ? s.items
        : Array.isArray(s.points) ? s.points
        : [];
      if (bullets.length) {
        slide.addText(
          bullets.map((b) => ({ text: String(b), options: { bullet: true } })),
          { x: 0.7, y: 1.3, w: 8.5, h: 4, fontSize: 18, color: "333333" }
        );
      } else if (s.content) {
        // Алиса иногда даёт "content" в content-слайде
        slide.addText(String(s.content), { x: 0.7, y: 1.3, w: 8.5, h: 4, fontSize: 16, color: "333333" });
      }
    } else if (layout === "text") {
      if (s.title) {
        slide.addText(String(s.title), { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 24, bold: true });
      }
      slide.addText(String(s.text || ""), { x: 0.7, y: 1.3, w: 8.5, h: 5, fontSize: 16, color: "333333" });
    } else if (layout === "two-columns") {
      if (s.title) {
        slide.addText(String(s.title), { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 24, bold: true });
      }
      slide.addText(String(s.left || s.leftColumn || ""), { x: 0.5, y: 1.3, w: 4.3, h: 5, fontSize: 14, color: "333333" });
      slide.addText(String(s.right || s.rightColumn || ""), { x: 5.2, y: 1.3, w: 4.3, h: 5, fontSize: 14, color: "333333" });
    } else if (layout === "summary") {
      if (s.title) {
        slide.addText(String(s.title), { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 24, bold: true, color: "C00000" });
      }
      slide.addText(String(s.content || s.text || ""), { x: 0.7, y: 1.3, w: 8.5, h: 4, fontSize: 16 });
      if (s.footer) {
        slide.addText(String(s.footer), { x: 0.5, y: 6.5, w: 9, h: 0.5, align: "center", fontSize: 14, italic: true, color: "666666" });
      }
    } else {
      // Unknown layout — fall back to title + dump JSON content as text
      slide.addText(String(s.title || `(layout: ${layout})`), { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 24, bold: true });
      slide.addText(JSON.stringify(s, null, 2), { x: 0.5, y: 1.3, w: 9, h: 5, fontSize: 10, fontFace: "Courier New" });
    }
  }

  const fileName = String(spec.fileName || "Presentation.pptx");
  console.log("[BetterAlice/buildPptx] writing", fileName, "with", slides.length, "slides");
  // Instead of pptx.writeFile() (which uses FileSaver internally and might not work
  // in all extension/page contexts), explicitly write to a blob and download via <a>.
  const blob = await pptx.write({ outputType: "blob" });
  console.log("[BetterAlice/buildPptx] blob created", blob?.size, "bytes");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  console.log("[BetterAlice/buildPptx] download triggered");
}

// ── XLSX ──────────────────────────────────────────────────────────────

export async function buildXlsx(jsonText) {
  const parsed = tryParseJson(jsonText);
  if (!parsed.ok) throw new Error(parsed.error);
  let spec = parsed.data;
  if (spec === null || spec === undefined) throw new Error("Ожидался JSON-объект или массив");
  // Unwrap Alice Pro wrappers
  if (!Array.isArray(spec) && typeof spec === "object") {
    if (spec.spreadsheet && typeof spec.spreadsheet === "object") spec = spec.spreadsheet;
    else if (spec.workbook && typeof spec.workbook === "object") spec = spec.workbook;
    else if (spec.document && typeof spec.document === "object") spec = spec.document;
  }

  const wb = XLSX.utils.book_new();
  let sheetsAdded = 0;

  // Format 0 (Alice-стиль): JSON просто массив объектов с одинаковыми ключами
  // [{товар: "...", цена: 50}, ...]. Используем XLSX.utils.json_to_sheet.
  if (Array.isArray(spec) && spec.length && typeof spec[0] === "object") {
    const ws = XLSX.utils.json_to_sheet(spec);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    sheetsAdded++;
  }
  // Format 1: {sheets: [{name, rows: [[...]]}]}
  else if (Array.isArray(spec.sheets) && spec.sheets.length) {
    for (const s of spec.sheets) {
      const rows = Array.isArray(s.rows) ? s.rows : [];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, String(s.name || "Sheet").slice(0, 31));
      sheetsAdded++;
    }
  }
  // Format 2 (Alice-стиль): {columns: [...], data: [{col1:v1, col2:v2}]}
  else if (Array.isArray(spec.columns) && Array.isArray(spec.data)) {
    const cols = spec.columns.map(String);
    const rows = [cols, ...spec.data.map((r) =>
      cols.map((c) => (r && r[c] !== undefined ? r[c] : ""))
    )];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    sheetsAdded++;
  }
  // Format 3: {rows: [[...]]} или {data: [[...]]}
  else if (Array.isArray(spec.rows) || (Array.isArray(spec.data) && Array.isArray(spec.data[0]))) {
    const rows = Array.isArray(spec.rows) ? spec.rows : spec.data;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    sheetsAdded++;
  }

  if (!sheetsAdded) throw new Error("Не удалось построить таблицу: нужен sheets[], columns+data, или rows[]");

  const fileName = String(spec.fileName || "data.xlsx");
  console.log("[BetterAlice/buildXlsx] writing", fileName);
  // Same blob-based approach as pptx — bypass XLSX.writeFile which might rely on Node FS
  const wbArrayBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── DOCX ──────────────────────────────────────────────────────────────

export async function buildDocx(jsonText) {
  const parsed = tryParseJson(jsonText);
  if (!parsed.ok) throw new Error(parsed.error);
  let spec = parsed.data;
  if (!spec || typeof spec !== "object") throw new Error("Ожидался JSON-объект");
  // Unwrap common wrappers Alice Pro uses: {document: {...}}, {doc: {...}}
  if (spec.document && typeof spec.document === "object") spec = spec.document;
  else if (spec.doc && typeof spec.doc === "object") spec = spec.doc;

  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = DOCX;
  const HEADING_LEVELS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  let paragraphs = [];
  // Format 1 (canonical): {paragraphs: [{text, heading?, bold?, italic?}]}
  if (Array.isArray(spec.paragraphs) && spec.paragraphs.length) {
    if (spec.title) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: String(spec.title), bold: true })] }));
    }
    spec.paragraphs.forEach((p) => {
      // Alice often gives paragraphs as plain strings, not {text:...}
      if (typeof p === "string") {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: p })] }));
        return;
      }
      const text = String(p.text || "");
      if (!text) return;
      const opts = {};
      if (p.heading && Number(p.heading) >= 1 && Number(p.heading) <= 6) {
        opts.heading = HEADING_LEVELS[Number(p.heading) - 1];
      }
      const runOpts = {};
      if (p.bold) runOpts.bold = true;
      if (p.italic) runOpts.italic = true;
      paragraphs.push(new Paragraph({ ...opts, children: [new TextRun({ text, ...runOpts })] }));
    });
  }
  // Format 2 (Alice-стиль): {sections: [{title, content}]}
  else if (Array.isArray(spec.sections)) {
    for (const s of spec.sections) {
      if (s.title) {
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: String(s.title) })] }));
      }
      if (s.content) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: String(s.content) })] }));
      }
    }
  }
  // Format 3 (Alice-стиль): plain key-value object (e.g. {понедельник: "...", вторник: "..."})
  else {
    // Title from spec.title or fileName
    if (spec.title) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: String(spec.title), bold: true })] }));
    }
    const skip = new Set(["title", "fileName", "filename"]);
    for (const [k, v] of Object.entries(spec)) {
      if (skip.has(k)) continue;
      if (v === null || v === undefined) continue;
      // Key as bold prefix, value as text
      if (typeof v === "string") {
        paragraphs.push(new Paragraph({ children: [
          new TextRun({ text: k + ": ", bold: true }),
          new TextRun({ text: v }),
        ]}));
      } else if (Array.isArray(v)) {
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: k })] }));
        for (const item of v) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: "• " + (typeof item === "string" ? item : JSON.stringify(item)) })] }));
        }
      } else if (typeof v === "object") {
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: k })] }));
        for (const [k2, v2] of Object.entries(v)) {
          paragraphs.push(new Paragraph({ children: [
            new TextRun({ text: k2 + ": ", bold: true }),
            new TextRun({ text: typeof v2 === "string" ? v2 : JSON.stringify(v2) }),
          ]}));
        }
      } else {
        paragraphs.push(new Paragraph({ children: [
          new TextRun({ text: k + ": ", bold: true }),
          new TextRun({ text: String(v) }),
        ]}));
      }
    }
  }

  if (!paragraphs.length) throw new Error("Нет ни одного абзаца / секции в JSON");

  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  const fileName = String(spec.fileName || "Document.docx");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
