<script>
  import { marked } from 'marked';
  import VisualizerCard from "./VisualizerCard.svelte";
  import ToolCard from "./ToolCard.svelte";
  import PptxCard from "./PptxCard.svelte";
  import ExcelCard from "./ExcelCard.svelte";
  import DocxCard from "./DocxCard.svelte";
  import AutoCodeRunnerCard from "./AutoCodeRunnerCard.svelte";
  import AutoCodeResultCard from "./AutoCodeResultCard.svelte";
  import LoadingIndicator from "./LoadingIndicator.svelte";


  /** 
   * @typedef {object} ToolBlock
   * @property {string} name
   * @property {string} content
   * @property {object} attrs
   */

  /** @type {{
   *   text: string, 
   *   blocks: ToolBlock[],
   *   loading?: boolean
   * }} */
  let { text, blocks = [], loading = false, loadingIndex = 1 } = $props();

  // Configure marked for better rendering
  marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false
  });
</script>

<div class="bap-message-overlay">
  <!-- TEXT -->
  {#if text && text.trim()}
    <div class="bap-sanitized-text">
      {@html marked.parse(text)}
    </div>
  {/if}

  <!-- TOOLS BELOW TEXT -->
  <div class="bap-tool-blocks">
    {#each blocks as block}
      {#if block.name === 'visualizer'}
        <VisualizerCard content={block.content} />
      {:else if block.name === 'pptx'}
        <PptxCard content={block.content} />
      {:else if block.name === 'excel'}
        <ExcelCard content={block.content} />
      {:else if block.name === 'docx'}
        <DocxCard content={block.content} />
      {:else if block.name === 'auto:code_runner'}
        <AutoCodeRunnerCard language={block.attrs.language || block.attrs.lang} content={block.content} />
      {:else if block.name === 'auto_code_result'}
        <AutoCodeResultCard language={block.attrs.language} status={block.attrs.status} output={block.content} />
      {:else if block.name === 'ask_question'}
        <div class="bap-question-info-card">
          <div class="bap-question-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          <div class="bap-question-content">
            <div class="bap-question-title">Clarifying questions asked.</div>
            <div class="bap-question-subtitle">Please provide your answers in the interaction panel below.</div>
          </div>
        </div>
      {:else if block.name === 'character_create'}
        <div class="bap-question-info-card bap-character-card">
          <div class="bap-question-icon bap-character-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
          <div class="bap-question-content">
            <div class="bap-question-title">Character/Persona created.</div>
            <div class="bap-question-subtitle">Active character: <strong>{block.attrs.name || 'New Character'}</strong></div>
          </div>
        </div>
      {:else}
        <ToolCard name={block.name} content={block.content} />
      {/if}
    {/each}
  </div>

  <!-- LOADING INDICATOR AT THE BOTTOM -->
  {#if loading}
    <div class="bap-loading-wrapper">
      <LoadingIndicator index={loadingIndex} />
    </div>
  {/if}
</div>

<style>
  .bap-question-info-card {
    background: var(--bap-bg-panel, #1e1f23);
    border: 1px solid var(--bap-border, #3a3b3f);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 10px 0;
  }

  .bap-question-icon {
    font-size: 20px;
    background: var(--bap-bg-hover, rgba(255, 255, 255, 0.08));
    color: var(--bap-accent, #5b7bff);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .bap-question-title {
    font-weight: 600;
    font-size: 15px;
    color: var(--bap-text-primary, #ececec);
  }

  .bap-question-subtitle {
    font-size: 13px;
    color: var(--bap-text-secondary, #8e8ea0);
    margin-top: 2px;
  }

  .bap-character-icon {
    color: #10b981; /* Emerald Green for success/creation */
    background: rgba(16, 185, 129, 0.1);
  }

  .bap-character-card {
    border-left: 3px solid #10b981;
  }

  .bap-message-overlay {
    margin-top: 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-family: inherit;
    color: #333; 
  }

  .bap-sanitized-text {
    font-size: 14px;
    line-height: 1.6;
    color: inherit;
    background: transparent;
  }

  .bap-sanitized-text :global(p) {
    margin-bottom: 1em;
  }

  .bap-sanitized-text :global(p:last-child) {
    margin-bottom: 0;
  }

  .bap-sanitized-text :global(pre) {
    background: var(--bap-bg-panel, #1e1f23);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
    border: 1px solid var(--bap-border, #3a3b3f);
  }

  .bap-sanitized-text :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.9em;
    background: var(--bap-bg-hover, rgba(255, 255, 255, 0.08));
    padding: 0.2em 0.4em;
    border-radius: 4px;
  }

  .bap-sanitized-text :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .bap-sanitized-text :global(ul), .bap-sanitized-text :global(ol) {
    margin-bottom: 1em;
    padding-left: 1.5em;
  }

  .bap-sanitized-text :global(li) {
    margin-bottom: 0.4em;
  }

  .bap-sanitized-text :global(strong) {
    font-weight: 600;
  }

  .bap-sanitized-text :global(em) {
    font-style: italic;
  }

  /* Tables */
  .bap-sanitized-text :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 13px;
    border: 1px solid var(--bap-border, #3a3b3f);
  }

  .bap-sanitized-text :global(th), .bap-sanitized-text :global(td) {
    padding: 8px 12px;
    border: 1px solid var(--bap-border, #3a3b3f);
    text-align: left;
  }

  .bap-sanitized-text :global(th) {
    background: var(--bap-bg-hover, rgba(255, 255, 255, 0.08));
    font-weight: 600;
  }

  .bap-sanitized-text :global(tr:nth-child(even)) {
    background: rgba(255, 255, 255, 0.02);
  }

  /* Blockquotes */
  .bap-sanitized-text :global(blockquote) {
    margin: 16px 0;
    padding-left: 16px;
    border-left: 4px solid var(--bap-accent, #5b7bff);
    color: var(--bap-text-secondary, #8e8ea0);
    font-style: italic;
  }

  /* Headers */
  .bap-sanitized-text :global(h1), .bap-sanitized-text :global(h2), .bap-sanitized-text :global(h3) {
    margin: 20px 0 12px 0;
    font-weight: 600;
    line-height: 1.3;
  }

  .bap-sanitized-text :global(h1) { font-size: 1.5em; }
  .bap-sanitized-text :global(h2) { font-size: 1.3em; }
  .bap-sanitized-text :global(h3) { font-size: 1.1em; }

  /* Yandex Alice color sync */
  :global(.dark) .bap-message-overlay {
    color: #ececec;
  }


</style>
