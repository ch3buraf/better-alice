<script>
  import { onMount, onDestroy } from "svelte";
  import { slide } from "svelte/transition";
  import { searchActiveProjectRAG } from "../../lib/rag-engine.js";
  import { getActiveProject, getFilesForProject, getActiveFiles } from "../project-manager.js";
  import appState from "../state.js";

  let allChunks = $state([]);
  let panelExpanded = $state(false);
  let isVisible = $state(false);
  let debounceTimer = null;
  let textarea = $state(null);
  let rootEl = $state(null);
  let expandedFiles = $state(new Set());

  const DEBOUNCE_MS = 350;
  const MIN_QUERY_LENGTH = 8;
  const MAX_FILES = 10;

  let totalUniqueFiles = $derived.by(() => {
    const s = new Set();
    for (const c of allChunks) s.add(c.fileName);
    return s.size;
  });

  let fileGroups = $derived.by(() => {
    const map = new Map();
    for (const chunk of allChunks) {
      if (!map.has(chunk.fileName)) {
        map.set(chunk.fileName, []);
      }
      map.get(chunk.fileName).push(chunk);
    }
    const entries = Array.from(map.entries()).slice(0, MAX_FILES);
    return entries.map(([fileName, chunks]) => ({
      fileName,
      lines: chunks.map(c => `${c.startLine}-${c.endLine}`).join(", "),
      chunks: chunks.map(c => ({
        startLine: c.startLine,
        endLine: c.endLine,
        content: c.content,
      })),
    }));
  });

  function toggleFile(fileName) {
    const next = new Set(expandedFiles);
    if (next.has(fileName)) next.delete(fileName);
    else next.add(fileName);
    expandedFiles = next;
  }

  function findTextarea() {
    return document.querySelector("textarea#chat-input") ||
           document.querySelector(".ds-textarea textarea") ||
           document.querySelector("textarea");
  }

  function findChatContainer() {
    return document.querySelector("._75e1990") ||
           document.querySelector("._6f68655") ||
           document.querySelector("._77cefa5") ||
           document.querySelector("._24fad49") ||
           document.querySelector(".ds-textarea") ||
           findTextarea()?.closest(".ds-textarea") ||
           findTextarea()?.parentElement;
  }

  function attachToContainer() {
    if (!rootEl) return;
    const target = findChatContainer();
    if (target && rootEl.parentElement !== target) {
      target.prepend(rootEl);
    }
  }

  function getProjectFiles() {
    const project = getActiveProject();
    if (!project) return null;

    if (appState.settings.projectRagEnabled) {
      return getFilesForProject(project.id);
    }
    return getActiveFiles();
  }

  function runRagSearch(query) {
    const files = getProjectFiles();
    if (!files || !files.length || !appState.settings.projectRagEnabled) {
      isVisible = false;
      return;
    }

    const limit = Number(appState.settings.projectRagLimit) || 5;
    const chunks = searchActiveProjectRAG(query, files, limit);

    if (chunks && chunks.length > 0) {
      allChunks = chunks;
      expandedFiles = new Set();
      panelExpanded = false;
      isVisible = true;
      attachToContainer();
    } else {
      isVisible = false;
      panelExpanded = false;
    }
  }

  function handleInput() {
    if (!textarea) return;
    const text = textarea.value.trim();

    if (text.length < MIN_QUERY_LENGTH) {
      isVisible = false;
      panelExpanded = false;
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      panelExpanded = false;
      runRagSearch(text);
    }, DEBOUNCE_MS);
  }

  let pollInterval = null;
  let prevListenerTextarea = null;

  function attachListener() {
    const ta = findTextarea();
    if (ta && ta !== prevListenerTextarea) {
      if (prevListenerTextarea) {
        prevListenerTextarea.removeEventListener("input", handleInput);
      }
      ta.addEventListener("input", handleInput);
      prevListenerTextarea = ta;
    }
    return ta;
  }

  onMount(() => {
    textarea = attachListener();
    attachToContainer();
    pollInterval = setInterval(() => {
      textarea = attachListener();
      if (isVisible) attachToContainer();
    }, 1000);
  });

  onDestroy(() => {
    clearInterval(pollInterval);
    clearTimeout(debounceTimer);
    if (prevListenerTextarea) {
      prevListenerTextarea.removeEventListener("input", handleInput);
    }
  });
</script>

<div bind:this={rootEl} class="bap-rag-preview" class:visible={isVisible} role="status" aria-live="polite">
  {#if isVisible && allChunks.length > 0}
    <button
      class="bap-rag-header"
      onclick={() => (panelExpanded = !panelExpanded)}
      aria-expanded={panelExpanded}
    >
      <span class="bap-rag-header-main">
        <span class="bap-rag-icon">&#x1F50D;</span>
        <span class="bap-rag-title">RAG matched files</span>
        <span class="bap-rag-count">{totalUniqueFiles}</span>
      </span>
      <span class="bap-rag-chevron">{panelExpanded ? "▲" : "▼"}</span>
    </button>

    {#if panelExpanded}
      <div class="bap-rag-files" transition:slide={{ duration: 200 }}>
        {#each fileGroups as group (group.fileName)}
          <div class="bap-rag-file-group">
            <button
              class="bap-rag-file-row"
              onclick={() => toggleFile(group.fileName)}
              aria-expanded={expandedFiles.has(group.fileName)}
            >
              <span class="bap-rag-file-chevron">
                {expandedFiles.has(group.fileName) ? "▼" : "▶"}
              </span>
              <span class="bap-rag-file-name">{group.fileName}</span>
              <span class="bap-rag-file-lines">{group.lines}</span>
            </button>

            {#if expandedFiles.has(group.fileName)}
              <div class="bap-rag-chunks" transition:slide={{ duration: 150 }}>
                {#each group.chunks as chunk, i}
                  <div class="bap-rag-chunk">
                    <div class="bap-rag-chunk-label">
                      Lines {chunk.startLine}&ndash;{chunk.endLine}
                    </div>
                    <pre class="bap-rag-chunk-code"><code>{chunk.content}</code></pre>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
        {#if totalUniqueFiles > MAX_FILES}
          <div class="bap-rag-more">+{totalUniqueFiles - MAX_FILES} more files</div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .bap-rag-preview {
    display: none;
    margin-bottom: 4px;
    user-select: none;
  }

  .bap-rag-preview.visible {
    display: block;
    animation: bap-rag-fadein 0.15s ease-out;
  }

  .bap-rag-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 10px;
    background: var(--bap-bg-elevated, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--bap-border, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    color: var(--bap-text-tertiary, rgba(255, 255, 255, 0.5));
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
    box-sizing: border-box;
    -webkit-appearance: none;
    appearance: none;
    font-family: inherit;
    line-height: 1.4;
    gap: 8px;
  }

  .bap-rag-header:hover {
    background: var(--bap-bg-hover, rgba(255, 255, 255, 0.08));
  }

  .bap-rag-header-main {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .bap-rag-icon {
    font-size: 10px;
    flex-shrink: 0;
  }

  .bap-rag-title {
    opacity: 0.6;
    white-space: nowrap;
  }

  .bap-rag-count {
    background: var(--bap-accent, #4f9bff);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 99px;
    line-height: 1.5;
    flex-shrink: 0;
  }

  .bap-rag-chevron {
    font-size: 8px;
    opacity: 0.4;
    flex-shrink: 0;
  }

  .bap-rag-files {
    margin-top: 4px;
    border: 1px solid var(--bap-border, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    overflow: hidden;
  }

  .bap-rag-file-group {
    border-bottom: 1px solid var(--bap-border, rgba(255, 255, 255, 0.05));
  }

  .bap-rag-file-group:last-child {
    border-bottom: none;
  }

  .bap-rag-file-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 5px 10px;
    font-size: 10px;
    cursor: pointer;
    transition: background 0.12s;
    box-sizing: border-box;
    -webkit-appearance: none;
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    line-height: inherit;
    text-align: left;
  }

  .bap-rag-file-row:hover {
    background: var(--bap-bg-hover, rgba(255, 255, 255, 0.06));
  }

  .bap-rag-file-chevron {
    font-size: 7px;
    opacity: 0.35;
    flex-shrink: 0;
    width: 10px;
  }

  .bap-rag-file-name {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    color: var(--bap-accent, #4f9bff);
    opacity: 0.85;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .bap-rag-file-lines {
    font-size: 9px;
    color: var(--bap-text-tertiary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .bap-rag-chunks {
    border-top: 1px solid var(--bap-border, rgba(255, 255, 255, 0.05));
  }

  .bap-rag-chunk {
    border-bottom: 1px solid var(--bap-border, rgba(255, 255, 255, 0.04));
  }

  .bap-rag-chunk:last-child {
    border-bottom: none;
  }

  .bap-rag-chunk-label {
    padding: 3px 10px 0;
    font-size: 9px;
    color: var(--bap-text-tertiary);
  }

  .bap-rag-chunk-code {
    margin: 0;
    padding: 4px 10px 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    line-height: 1.5;
    color: var(--bap-text-secondary, rgba(255, 255, 255, 0.65));
    overflow-x: auto;
    white-space: pre;
    max-height: 160px;
    overflow-y: auto;
  }

  .bap-rag-chunk-code code {
    font-family: inherit;
  }

  .bap-rag-more {
    padding: 5px 10px;
    font-size: 10px;
    opacity: 0.4;
    text-align: center;
  }

  @keyframes bap-rag-fadein {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
