<script>
  import appState from "../state.js";
  import { exportSession, collectMessages } from "../tools/exporter.js";
  import { scheduleScan } from "../scanner.js";

  let selectionMode = $state(appState.selectionMode);
  let selectedCount = $state(0);

  // Bridge presence is fixed at page load — not reactive.
  const isAndroid = typeof window !== "undefined" &&
    typeof window.AndroidBridge?.downloadBlob === "function";

  $effect(() => {
    const handleUrlChange = () => {
      // Exit selection mode on navigation
      cancelSelection();
    };

    const handleSelectionChange = () => {
      selectedCount = appState.selectedMessageIds.size;
    };

    window.addEventListener("bap:urlChanged", handleUrlChange);
    window.addEventListener("bap:selectionChanged", handleSelectionChange);

    // Check initial state periodically because appState is not reactive
    const timer = setInterval(() => {
      if (selectionMode !== appState.selectionMode) {
        selectionMode = appState.selectionMode;
        if (selectionMode) {
           document.body.classList.add("bap-selection-mode-active");
           // Sync count when opening
           selectedCount = appState.selectedMessageIds.size;
           // Ensure checkboxes are injected
           scheduleScan();
        } else {
           document.body.classList.remove("bap-selection-mode-active");
        }
      }
    }, 200);

    return () => {
      window.removeEventListener("bap:urlChanged", handleUrlChange);
      window.removeEventListener("bap:selectionChanged", handleSelectionChange);
      clearInterval(timer);
    };
  });

  function cancelSelection() {
    appState.selectionMode = false;
    appState.selectedMessageIds.clear();
    selectionMode = false;
    selectedCount = 0;
    document.body.classList.remove("bap-selection-mode-active");

    // Uncheck all checkboxes
    document.querySelectorAll(".bap-selection-checkbox").forEach(cb => {
      if (cb instanceof HTMLInputElement) cb.checked = false;
    });

    window.dispatchEvent(new CustomEvent("bap:selectionChanged"));
  }

  function selectAll() {
    const checkboxes = document.querySelectorAll(".bap-selection-checkbox");
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
      const id = cb.getAttribute("data-bap-message-id");
      if (!allChecked) {
        appState.selectedMessageIds.add(id);
      } else {
        appState.selectedMessageIds.delete(id);
      }
    });

    selectedCount = appState.selectedMessageIds.size;
    window.dispatchEvent(new CustomEvent("bap:selectionChanged"));
  }

  async function handleExport(format) {
    if (selectedCount === 0) {
      alert("Please select the messages you want to export first.");
      return;
    }

    await exportSession(format, Array.from(appState.selectedMessageIds));
    cancelSelection();
  }
</script>

{#if selectionMode}
  <div class="bap-selection-overlay">
    <div class="bap-selection-bar">

      <!-- Layer 1: count + select-all -->
      <div class="bap-row bap-row-info">
        <div class="bap-selection-info">
          <span class="bap-selection-count">{selectedCount}</span>
          <span class="bap-selection-label">selected</span>
        </div>
        <button class="bap-btn-ghost" onclick={selectAll}>
          {document.querySelectorAll(".bap-selection-checkbox").length === selectedCount ? "Deselect All" : "Select All"}
        </button>
      </div>

      <!-- Layer 2: format buttons -->
      <div class="bap-row bap-row-formats">
        <div class="bap-export-group">
          <button class="bap-export-btn" onclick={() => handleExport('markdown')} title="Markdown (.md)">
            MD
          </button>
          {#if !isAndroid}
            <button class="bap-export-btn" onclick={() => handleExport('pdf')} title="PDF Document">
              PDF
            </button>
          {/if}
          <button class="bap-export-btn" onclick={() => handleExport('html')} title="Interactive HTML">
            HTML
          </button>
          <button class="bap-export-btn" onclick={() => handleExport('image')} title="Long Screenshot">
            IMG
          </button>
        </div>
      </div>

      <!-- Layer 3: cancel (last, avoids accidental press) -->
      <div class="bap-row bap-row-cancel">
        <button class="bap-btn-cancel" onclick={cancelSelection}>Отмена</button>
      </div>

    </div>
  </div>
{/if}

<style>
  .bap-selection-overlay {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 10000;
    display: flex;
    justify-content: center;
    padding: 16px;
    pointer-events: none;
    animation: slideUp 0.3s ease-out;
  }

  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  /* Mobile-first: vertical card layout */
  .bap-selection-bar {
    background: #111111;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    pointer-events: auto;
    color: white;
    width: 100%;
    max-width: 420px;
  }

  .bap-row {
    display: flex;
    align-items: center;
  }

  .bap-row-info {
    justify-content: space-between;
    gap: 12px;
  }

  .bap-row-formats {
    justify-content: center;
  }

  .bap-row-cancel {
    justify-content: center;
  }

  /* Desktop: restore horizontal pill layout */
  @media (min-width: 620px) {
    .bap-selection-overlay {
      padding: 20px;
    }

    .bap-selection-bar {
      flex-direction: row;
      align-items: center;
      width: auto;
      max-width: none;
      border-radius: 100px;
      padding: 8px 12px 8px 24px;
      gap: 24px;
    }

    .bap-row-formats {
      justify-content: flex-start;
    }

    .bap-row-cancel {
      justify-content: flex-start;
    }

    .bap-btn-cancel {
      border: none !important;
      width: auto !important;
      padding: 6px 12px !important;
      border-radius: 20px !important;
    }
  }

  .bap-selection-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .bap-selection-count {
    background: #4d66ff;
    color: white;
    padding: 2px 10px;
    border-radius: 20px;
    font-size: 14px;
    min-width: 28px;
    text-align: center;
  }

  .bap-selection-label {
    font-size: 13px;
    color: #999;
  }

  .bap-export-group {
    display: flex;
    background: #1a1a1a;
    border-radius: 12px;
    padding: 3px;
    gap: 2px;
    border: 1px solid #333;
  }

  .bap-export-btn {
    background: transparent;
    border: none;
    color: #aaa;
    padding: 6px 12px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .bap-export-btn:hover {
    background: #333;
    color: white;
  }

  .bap-btn-ghost {
    background: transparent;
    border: 1px solid #333;
    color: #ccc;
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .bap-btn-ghost:hover {
    border-color: #555;
    background: rgba(255, 255, 255, 0.05);
    color: white;
  }

  /* Mobile: full-width bordered cancel button (easy to see, hard to accidentally hit) */
  .bap-btn-cancel {
    background: transparent;
    border: 1px solid rgba(255, 95, 86, 0.3);
    color: #ff5f56;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    padding: 8px 0;
    border-radius: 10px;
    transition: background 0.2s, border-color 0.2s;
    width: 100%;
    text-align: center;
  }

  .bap-btn-cancel:hover {
    background: rgba(255, 95, 86, 0.1);
    border-color: rgba(255, 95, 86, 0.5);
  }
</style>
