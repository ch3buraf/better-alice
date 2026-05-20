<script>
  import { buildVisualizerDocument } from "../../lib/utils/html-utils.js";

  /** @type {{content: string}} */
  let { content } = $props();

  let iframeSrcDoc = $derived(buildVisualizerDocument(content));
</script>

<div class="bap-visualizer-card">
  <header class="bap-visualizer-header">
    <h4>Visualizer</h4>
    <p>Интерактивная симуляция</p>
  </header>
  
  <div class="bap-visualizer-body">
    <iframe
      class="bap-visualizer-frame"
      title="Visualizer"
      sandbox="allow-scripts allow-forms"
      srcdoc={iframeSrcDoc}
    ></iframe>
  </div>
</div>

<style>
  .bap-visualizer-card {
    border: 1px solid #000;
    border-radius: 4px;
    background: #fff;
    padding: 12px;
    margin: 10px 0;
    font-family: inherit;
    color: #000;
    /* Fix card size and prevent overflow */
    height: 600px; 
    display: flex;
    flex-direction: column;
    overflow: hidden; 
  }

  .bap-visualizer-header {
    margin-bottom: 8px;
    border-bottom: 1px solid #000;
    padding-bottom: 4px;
    flex-shrink: 0; /* Prevents the header from shrinking */
  }

  .bap-visualizer-header h4 {
    margin: 0;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    color: #1e3a8a;
    letter-spacing: 0.05em;
  }

  .bap-visualizer-header p {
    margin: 0;
    font-size: 10px;
    color: #666;
  }

  .bap-visualizer-body {
    flex-grow: 1; /* Body occupies the remaining space */
    overflow: hidden;
  }

  .bap-visualizer-frame {
    width: 100%;
    height: 100%; /* Fills the entire body */
    border: 1px solid #000;
    background: #fff;
    display: block;
    overflow: hidden; /* Prevents scrolling */
  }

  /* Hide internal iframe scrollbar with CSS (for some browsers) */
  .bap-visualizer-frame::-webkit-scrollbar {
    display: none;
  }

  :global(.dark) .bap-visualizer-card {
    background: #111;
    border-color: #444;
  }
</style>