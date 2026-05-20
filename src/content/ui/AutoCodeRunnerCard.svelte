<script>
  import { onMount } from "svelte";
  import { buildHeadlessRunnerDocument } from "../../lib/utils/html-utils.js";
  import { handleAutoCodeRunnerResult } from "../auto.js";

  /** @type {{content: string, language: string}} */
  let { content, language } = $props();
  const instanceId = Math.random().toString(36).substring(2, 9);

  let status = $state("pending"); // pending, running, success, error, rejected
  let output = $state([]);
  let showCode = $state(false);
  let iframe = $state();

  const sandboxUrl = chrome.runtime.getURL("sandbox.html");
  let headlessSrcDoc = $derived(buildHeadlessRunnerDocument(language));

  let isPython = $derived(language === "python" || language === "py");
  let isTypeScript = $derived(language === "typescript" || language === "ts");
  let langLabel = $derived(isPython ? "Python" : (isTypeScript ? "TypeScript" : "JavaScript"));
  let langColor = $derived(isPython ? "#10b981" : (isTypeScript ? "#3b82f6" : "#f59e0b"));

  function handleMessage(event) {
    const { type, data, id } = event.data;
    if (id && id !== instanceId) return;

    if (type === "CONSOLE_LOG") {
      output = [...output, { method: data.method, text: data.args.join(" ") }];
    } else if (type === "STATUS") {
      if (data === "FINISHED") {
        status = "success";
        handleAutoCodeRunnerResult(language, "success", output);
      }
      if (data === "ERROR") {
        status = "error";
        handleAutoCodeRunnerResult(language, "error", output);
      }
    }
  }

  onMount(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  function runCode() {
    status = "running";
    output = [];
    iframe.contentWindow.postMessage({
      type: "RUN_CODE",
      code: content,
      id: instanceId
    }, "*");
  }

  function rejectCode() {
    status = "rejected";
    output = [{ method: "warn", text: "User rejected code execution." }];
    handleAutoCodeRunnerResult(language, "rejected", output);
  }

  function toggleCode() {
    showCode = !showCode;
  }
</script>

<article class="bap-auto-runner-card" class:rejected={status === 'rejected'} style="--lang-color: {langColor}">
  <div class="bap-auto-runner-header">
    <div class="bap-auto-runner-info">
      <div class="bap-auto-runner-icon">
        {#if isPython}
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 18l6-6-6-6M8 6l-6 6 6 6"></path>
          </svg>
        {/if}
      </div>
      <div class="bap-auto-runner-details">
        <h4>AI wants to run {langLabel} code</h4>
        <p>This will execute in a safe sandbox.</p>
      </div>
    </div>

    <div class="bap-auto-runner-actions">
      {#if status === 'pending'}
        <button type="button" class="bap-btn run" onclick={runCode}>▶ Run Code</button>
        <button type="button" class="bap-btn reject" onclick={rejectCode}>✕ Reject</button>
      {:else if status === 'running'}
        <span class="bap-status-bubble">Running...</span>
      {:else if status === 'success'}
        <span class="bap-status-bubble success">Finished</span>
        <button type="button" class="bap-btn-text" onclick={runCode}>Запустить снова</button>
      {:else if status === 'error'}
        <span class="bap-status-bubble error">Error</span>
        <button type="button" class="bap-btn-text" onclick={runCode}>Retry</button>
      {:else if status === 'rejected'}
        <span class="bap-status-bubble">Rejected</span>
        <button type="button" class="bap-btn-text" onclick={runCode}>Actually, Run</button>
      {/if}
      <button type="button" class="bap-btn-text toggle" onclick={toggleCode}>
        {showCode ? 'Hide Code ▴' : 'Show Code ▾'}
      </button>
    </div>
  </div>

  {#if showCode}
    <div class="bap-auto-runner-source">
      <pre>{content.trim()}</pre>
    </div>
  {/if}

  {#if output.length > 0}
    <div class="bap-auto-runner-output">
      <div class="bap-output-label">Вывод консоли</div>
      <div class="bap-output-logs">
        {#each output as log}
          <div class="bap-log-line" class:error={log.method === 'error'} class:warn={log.method === 'warn'}>
            <span class="bap-log-text">{log.text}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <iframe 
    bind:this={iframe} 
    srcdoc={headlessSrcDoc} 
    style="display: none;" 
    title="BDS Auto Code Runner Sandbox"
  ></iframe>
</article>

<style>
  .bap-auto-runner-card {
    margin: 10px 0;
    border: 1px solid var(--bap-border);
    border-radius: var(--bap-radius);
    background: var(--bap-bg-panel);
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .bap-auto-runner-card.rejected {
    opacity: 0.8;
  }

  .bap-auto-runner-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
  }

  .bap-auto-runner-info {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .bap-auto-runner-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    background-color: var(--bap-bg-elevated);
    border: 1px solid var(--bap-border);
    border-radius: 10px;
    color: var(--lang-color);
    flex-shrink: 0;
  }

  .bap-auto-runner-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .bap-auto-runner-details h4 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--bap-text-primary);
  }

  .bap-auto-runner-details p {
    margin: 0;
    font-size: 11px;
    color: var(--bap-text-tertiary);
  }

  .bap-auto-runner-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bap-btn {
    border: 1px solid var(--bap-border);
    border-radius: 8px;
    background: var(--bap-bg-elevated);
    color: var(--bap-text-primary);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 12px;
    transition: all 0.2s;
  }

  .bap-btn.run {
    background: var(--lang-color);
    color: #fff;
    border: none;
  }

  .bap-btn:hover {
    opacity: 0.9;
  }

  .bap-btn-text {
    background: transparent;
    border: none;
    color: var(--bap-text-tertiary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }

  .bap-btn-text:hover {
    color: var(--bap-text-secondary);
  }

  .bap-status-bubble {
    font-size: 11px;
    font-weight: 700;
    color: var(--bap-text-tertiary);
    text-transform: uppercase;
  }

  .bap-status-bubble.success { color: #10b981; }
  .bap-status-bubble.error { color: #ef4444; }

  .bap-auto-runner-source {
    padding: 0 16px 12px;
    border-top: 1px solid var(--bap-border);
    padding-top: 10px;
  }

  .bap-auto-runner-source pre {
    margin: 0;
    max-height: 150px;
    overflow-y: auto;
    background: var(--bap-bg-elevated);
    border-radius: 8px;
    padding: 10px;
    font-size: 11px;
    border: 1px solid var(--bap-border);
    font-family: monospace;
    white-space: pre-wrap;
    color: var(--bap-text-primary);
  }

  .bap-auto-runner-output {
    padding: 12px 16px;
    border-top: 1px solid var(--bap-border);
    background: rgba(0,0,0,0.02);
  }

  :global(.dark) .bap-auto-runner-output {
    background: rgba(255,255,255,0.02);
  }

  .bap-output-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--bap-text-tertiary);
    margin-bottom: 6px;
    letter-spacing: 0.5px;
  }

  .bap-output-logs {
    font-family: monospace;
    font-size: 12px;
    line-height: 1.4;
  }

  .bap-log-line {
    padding: 2px 0;
  }

  .bap-log-line.error { color: #ef4444; }
  .bap-log-line.warn { color: #f59e0b; }
</style>
