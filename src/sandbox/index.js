/**
 * Sandbox script for safe PPTX generation.
 * Runs in a null-origin iframe with 'unsafe-eval' allowed.
 */

import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx";
import * as docx from "docx";

// Attach to window so AI can access them globally or via window.Library
window.PptxGenJS = PptxGenJS;
window.pptxgen = PptxGenJS; // Alias often used
window.XLSX = XLSX;
window.docx = docx;
window.DOCX = docx; // Common naming convention

// Expose all docx exports as globals for easier AI access
Object.keys(docx).forEach(key => {
  if (!(key in window)) {
    window[key] = docx[key];
  }
});

console.log("BDS Sandbox: Initialized");

// Helper for executing AI code which might contain 'await'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

window.addEventListener("message", async (event) => {
  const { type, code, id } = event.data;

  if (type === "GEN_PPTX") {
    console.log("BDS Sandbox: Received PPTX generation request", id);
    try {
      // Intercept writeFile to capture the promise
      const originalWriteFile = PptxGenJS.prototype.writeFile;
      let generationPromise = null;
      
      PptxGenJS.prototype.writeFile = function(args) {
        console.log("BDS Sandbox: pptx.writeFile() intercepted");
        generationPromise = this.write({ outputType: 'base64' });
        return generationPromise;
      };

      // Execute the AI code. 
      const func = new AsyncFunction(code);
      await func();
      
      if (generationPromise) {
        const capturedBase64 = await generationPromise;
        window.parent.postMessage({ type: "PPTX_RESULT", base64: capturedBase64, id }, "*");
      } else {
        throw new Error("No PPTX data was generated. Did the script call pptx.writeFile()?");
      }

      PptxGenJS.prototype.writeFile = originalWriteFile;
    } catch (err) {
      console.error("BDS Sandbox Error (PPTX):", err);
      window.parent.postMessage({ type: "PPTX_ERROR", error: err.message, id }, "*");
    }
  }

  if (type === "GEN_EXCEL") {
    console.log("BDS Sandbox: Received Excel generation request", id);
    try {
      let capturedBase64 = null;

      // Create a wrapper for XLSX to intercept writeFile
      const XLSX_WRAPPER = {
        ...XLSX,
        writeFile: (wb, filename, opts) => {
          console.log("BDS Sandbox: XLSX.writeFile() intercepted");
          capturedBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx', ...opts });
        }
      };

      // Temporarily override global XLSX for this execution
      const originalGlobalXLSX = window.XLSX;
      window.XLSX = XLSX_WRAPPER;

      const func = new AsyncFunction(code);
      await func();

      if (capturedBase64) {
        window.parent.postMessage({ type: "EXCEL_RESULT", base64: capturedBase64, id }, "*");
      } else {
        throw new Error("No Excel data was generated. Did the script call XLSX.writeFile()?");
      }

      // Restore
      window.XLSX = originalGlobalXLSX;
    } catch (err) {
      console.error("BDS Sandbox Error (Excel):", err);
      window.parent.postMessage({ type: "EXCEL_ERROR", error: err.message, id }, "*");
    }
  }

  if (type === "GEN_DOCX") {
    console.log("BDS Sandbox: Received DOCX generation request", id);
    try {
      let generationPromise = null;

      // Create a wrapper for docx to provide a simple save() method and intercept Packer
      const DOCX_WRAPPER = {
        ...docx,
        save: (doc) => {
          console.log("BDS Sandbox: docx.save() called");
          generationPromise = docx.Packer.toBase64String(doc);
          return generationPromise;
        },
        Packer: {
          ...docx.Packer,
          toBase64String: (doc, ...args) => {
            console.log("BDS Sandbox: Packer.toBase64String() intercepted");
            generationPromise = docx.Packer.toBase64String(doc, ...args);
            return generationPromise;
          },
          toBlob: (doc, ...args) => {
            console.log("BDS Sandbox: Packer.toBlob() intercepted");
            generationPromise = docx.Packer.toBase64String(doc, ...args);
            return docx.Packer.toBlob(doc, ...args);
          }
        }
      };

      // Temporarily override globals
      const originalDocx = window.docx;
      const originalDOCX = window.DOCX;
      const originalPacker = window.Packer;

      window.docx = DOCX_WRAPPER;
      window.DOCX = DOCX_WRAPPER;
      window.Packer = DOCX_WRAPPER.Packer;

      const func = new AsyncFunction(code);
      await func();

      if (generationPromise) {
        const capturedBase64 = await generationPromise;
        window.parent.postMessage({ type: "DOCX_RESULT", base64: capturedBase64, id }, "*");
      } else {
        throw new Error("No Word document data was generated. Did the script call DOCX.save(doc) or Packer.toBlob(doc)?");
      }

      window.docx = originalDocx;
      window.DOCX = originalDOCX;
      window.Packer = originalPacker;
    } catch (err) {
      console.error("BDS Sandbox Error (DOCX):", err);
      window.parent.postMessage({ type: "DOCX_ERROR", error: err.message, id }, "*");
    }
  }

  // RENDER_LATEX — used by code-blocks.js for ```bap-latex blocks.
  // Sandbox loads KaTeX from CDN (allowed by sandbox CSP), renders the
  // formula into its OWN document body. The parent simply embeds this
  // iframe as a viewer — no HTML/CSS marshalling required.
  if (type === "RENDER_LATEX") {
    const { latex, id: msgId, displayMode } = event.data;
    try {
      if (!window.katex) {
        await new Promise((resolve, reject) => {
          const css = document.createElement("link");
          css.rel = "stylesheet";
          css.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
          document.head.appendChild(css);
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
          s.onload = resolve;
          s.onerror = () => reject(new Error("Failed to load KaTeX from CDN"));
          document.head.appendChild(s);
        });
      }
      // Clear any previous render. Sandbox is one-shot per iframe so we just
      // reset the body each time RENDER_LATEX arrives.
      document.body.innerHTML = "";
      document.body.style.margin = "8px 12px";
      document.body.style.fontSize = "16px";
      document.body.style.fontFamily = "KaTeX_Main, system-ui, sans-serif";
      document.body.style.overflow = "visible";
      const host = document.createElement("div");
      host.style.cssText = "overflow-x:auto;max-width:100%;padding-bottom:4px";
      document.body.appendChild(host);
      window.katex.render(latex, host, {
        throwOnError: false,
        displayMode: displayMode !== false,
        output: "html",
      });
      const sendHeight = () => {
        // include host's scrollHeight (LaTeX block) + bodyscroll to capture
        // any tall display-math (matrices, multi-line aligned).
        const h = Math.max(40, document.body.scrollHeight + 8);
        window.parent.postMessage({ type: "LATEX_RENDERED", height: h, id: msgId }, "*");
      };
      sendHeight();
      // KaTeX fonts may still be loading; re-measure on font ready + observer.
      if (document.fonts?.ready) document.fonts.ready.then(sendHeight).catch(() => {});
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => sendHeight());
        ro.observe(host);
        // Stop observing after a few seconds (latex render is one-shot).
        setTimeout(() => ro.disconnect(), 5000);
      }
    } catch (err) {
      console.error("BDS Sandbox Error (LaTeX):", err);
      window.parent.postMessage({ type: "LATEX_ERROR", error: err.message, id: msgId }, "*");
    }
  }

  // RUN_CODE — used by CodeRunner.svelte for ```python / ```js / ```ts blocks
  if (type === "RUN_CODE") {
    const { code: userCode, language, id: msgId } = event.data;
    const isPython = language === "python" || language === "py";
    const isTS = language === "typescript" || language === "ts";

    // Capture console output and forward to parent
    const sendLog = (method, args) => {
      window.parent.postMessage({
        type: "CONSOLE_LOG",
        data: { method, args: args.map(a => {
          if (a === undefined) return "undefined";
          if (a === null) return "null";
          try { return typeof a === "object" ? JSON.stringify(a, null, 2) : String(a); }
          catch { return String(a); }
        })},
        id: msgId,
      }, "*");
    };
    const origCons = { ...console };
    ['log', 'error', 'warn', 'info'].forEach(m => {
      console[m] = (...args) => { origCons[m](...args); sendLog(m, args); };
    });

    const status = (s) => window.parent.postMessage({ type: "STATUS", data: s, id: msgId }, "*");

    try {
      if (isPython) {
        if (!window.pyodide) {
          status("LOADING_PYODIDE");
          // Dynamically load pyodide.js. Sandbox CSP allows cdn.jsdelivr.net.
          if (!window.loadPyodide) {
            await new Promise((resolve, reject) => {
              const s = document.createElement("script");
              s.src = "https://cdn.jsdelivr.net/pyodide/v0.27.3/full/pyodide.js";
              s.onload = resolve;
              s.onerror = () => reject(new Error("Failed to load pyodide.js from CDN"));
              document.head.appendChild(s);
            });
          }
          window.pyodide = await window.loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.3/full/",
          });
        }
        status("RUNNING");
        window.pyodide.globals.set("bap_user_code", userCode);
        const result = await window.pyodide.runPythonAsync(
          "import io, sys, traceback\n" +
          "_buf = io.StringIO()\n" +
          "_old_o, _old_e = sys.stdout, sys.stderr\n" +
          "sys.stdout = _buf; sys.stderr = _buf\n" +
          "try:\n" +
          "    exec(bap_user_code, {})\n" +
          "except Exception:\n" +
          "    traceback.print_exc()\n" +
          "finally:\n" +
          "    sys.stdout = _old_o; sys.stderr = _old_e\n" +
          "_buf.getvalue()"
        );
        if (result) console.log(String(result).trimEnd());
        status("FINISHED");
      } else {
        status("RUNNING");
        let finalCode = userCode;
        if (isTS) {
          // Load Babel from CDN if not loaded
          if (!window.Babel) {
            await new Promise((resolve, reject) => {
              const s = document.createElement("script");
              s.src = "https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.0/babel.min.js";
              s.onload = resolve;
              s.onerror = () => reject(new Error("Failed to load Babel from CDN"));
              document.head.appendChild(s);
            });
          }
          finalCode = window.Babel.transform(userCode, { presets: ["typescript"], filename: "script.ts" }).code;
        }
        const fn = new AsyncFunction(finalCode);
        const r = await fn();
        if (r !== undefined) console.log("Return:", r);
        status("FINISHED");
      }
    } catch (e) {
      console.error(e.message || e);
      status("ERROR");
    } finally {
      // Restore console
      ['log', 'error', 'warn', 'info'].forEach(m => { console[m] = origCons[m]; });
    }
  }
});

