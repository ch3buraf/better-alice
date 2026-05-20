<script>
  import { onMount } from "svelte";

  let isExpanded = $state(false);
  let isVisible = $state(false);
  let textarea = $state(null);
  let container = $state(null);

  const THRESHOLD_CHARS = 250;
  const THRESHOLD_LINES = 3;

  function findTextarea() {
    return document.querySelector("textarea#chat-input") || 
           document.querySelector(".ds-textarea textarea") || 
           document.querySelector("textarea");
  }

  function checkContent() {
    if (!textarea) return;
    const text = textarea.value;
    const lines = text.split("\n").length;
    isVisible = isExpanded || text.length > THRESHOLD_CHARS || lines > THRESHOLD_LINES;
  }

  function toggle() {
    isExpanded = !isExpanded;
    if (container) {
      if (isExpanded) {
        container.classList.add("bap-prompt-expanded");
      } else {
        container.classList.remove("bap-prompt-expanded");
      }
    }
    checkContent();
  }

  onMount(() => {
    const interval = setInterval(() => {
      if (!textarea || !document.contains(textarea)) {
        textarea = findTextarea();
        if (textarea) {
          textarea.addEventListener("input", checkContent);
          
          container = textarea.closest(".ds-textarea-wrapper") || 
                      textarea.closest("._75e1990") || 
                      textarea.closest("._6f68655") ||
                      textarea.closest(".ds-textarea")?.parentElement ||
                      textarea.parentElement;
          
          if (container && !container.style.position) {
            container.style.position = "relative";
          }
          checkContent();
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (textarea) {
        textarea.removeEventListener("input", checkContent);
      }
      if (container) {
        container.classList.remove("bap-prompt-expanded");
      }
    };
  });
</script>

{#if isVisible}
  <button 
    class="bap-expand-toggle {isExpanded ? 'expanded' : ''}" 
    onclick={toggle}
    aria-label={isExpanded ? "Collapse" : "Expand"}
    title={isExpanded ? "Collapse Prompt Box" : "Expand Prompt Box"}
  >
    {#if isExpanded}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 14 10 14 10 20"></polyline>
        <polyline points="20 10 14 10 14 4"></polyline>
        <line x1="14" y1="10" x2="21" y2="3"></line>
        <line x1="10" y1="14" x2="3" y2="21"></line>
      </svg>
    {:else}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 3 21 3 21 9"></polyline>
        <polyline points="9 21 3 21 3 15"></polyline>
        <line x1="21" y1="3" x2="14" y2="10"></line>
        <line x1="3" y1="21" x2="10" y2="14"></line>
      </svg>
    {/if}
  </button>
{/if}

<style>
  .bap-expand-toggle {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 10000;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bap-bg-panel);
    border: 1px solid var(--bap-border);
    border-radius: 10px;
    color: var(--bap-text-secondary);
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    opacity: 0;
    transform: translateY(-10px);
    animation: bap-slide-in 0.3s forwards;
  }

  @keyframes bap-slide-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .bap-expand-toggle:hover {
    background: var(--bap-bg-hover);
    color: var(--bap-text-primary);
    border-color: var(--bap-accent);
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
  }

  .bap-expand-toggle.expanded {
    color: #fff;
    background: var(--bap-accent);
    border-color: var(--bap-accent);
  }

  .bap-expand-toggle svg {
    transition: transform 0.3s ease;
  }

  .bap-expand-toggle:active {
    transform: scale(0.95);
  }
</style>

