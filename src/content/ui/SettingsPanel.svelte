<script>
  import appState from "../state.js";
  import { pushConfigToPage } from "../bridge.js";
  import {
    STORAGE_KEYS,
    SYSTEM_PROMPT_TEMPLATE_VERSION,
    DOWNLOAD_BEHAVIOR_VERSION,
    DEFAULT_SYSTEM_PROMPT,
    TOOL_FENCE_CHEATSHEET,
  } from "../../lib/constants.js";
  import { triggerTextDownload } from "../../lib/utils/download.js";
  import { getActiveProject, updateProject } from "../project-manager.js";

  let customSystemPrompts = $state(appState.settings.customSystemPrompts || []);
  let activeSystemPromptId = $state(appState.settings.activeSystemPromptId || "default");
  
  let showPromptEditor = $state(false);
  let editingPrompt = $state(null);
  let promptEditorName = $state("");
  let promptEditorContent = $state("");
  let promptEditorIsNew = $state(false);

  let autoFiles = $state(Boolean(appState.settings.autoDownloadFiles));
  let autoZip = $state(Boolean(appState.settings.autoDownloadLongWorkZip));
  let voiceMode = $state(Boolean(appState.settings.voiceMode));
  let voiceLanguage = $state(
    appState.settings.voiceLanguage ||
      (typeof navigator !== "undefined" ? navigator.language : "en-US"),
  );
  let autoSubmitVoice = $state(Boolean(appState.settings.autoSubmitVoice));
  let preferredLang = $state(appState.settings.preferredLang || "");
  let githubToken = $state(appState.settings.githubToken || "");
  let showGithubToken = $state(shouldShowGithubTokenByDefault(appState.settings.githubToken));
  let disableSystemPrompt = $state(
    Boolean(appState.settings.disableSystemPrompt),
  );
  let systemPromptInjectionFrequency = $state(
    appState.settings.systemPromptInjectionFrequency || "first",
  );
  let systemPromptInjectionInterval = $state(
    Number(appState.settings.systemPromptInjectionInterval) || 3,
  );
  let disableMemory = $state(Boolean(appState.settings.disableMemory));
  let disableAllInjection = $state(Boolean(appState.settings.disableAllInjection));
  let htmlToMarkdownMaxDepth = $state(
    Number(appState.settings.htmlToMarkdownMaxDepth) || 200,
  );
  let maxChatSessions = $state(
    Number(appState.settings.maxChatSessions) || 500,
  );
  let tokenPriceDisplay = $state(Boolean(appState.settings.tokenPriceDisplay));
  let projectRagEnabled = $state(Boolean(appState.settings.projectRagEnabled));
  let projectRagLimit = $state(Number(appState.settings.projectRagLimit) || 5);
  let processGitignoreOnUpload = $state(Boolean(appState.settings.processGitignoreOnUpload));
  let advancedOpen = $state(false);

  let activeProject = $state(getActiveProject());
  let projectInstructions = $state(activeProject?.customInstructions || "");
  let projectSaveTimer = null;
  const GITHUB_TOKEN_MASK_CHAR = "\u25cf";

  function shouldShowGithubTokenByDefault(tokenValue = githubToken) {
    return !String(tokenValue || "").trim();
  }

  export function refresh() {
    customSystemPrompts = appState.settings.customSystemPrompts || [];
    activeSystemPromptId = appState.settings.activeSystemPromptId || "default";
    autoFiles = Boolean(appState.settings.autoDownloadFiles);
    autoZip = Boolean(appState.settings.autoDownloadLongWorkZip);
    voiceMode = Boolean(appState.settings.voiceMode);
    voiceLanguage =
      appState.settings.voiceLanguage ||
      (typeof navigator !== "undefined" ? navigator.language : "en-US");
    autoSubmitVoice = Boolean(appState.settings.autoSubmitVoice);
    preferredLang = appState.settings.preferredLang || "";
    githubToken = appState.settings.githubToken || "";
    showGithubToken = shouldShowGithubTokenByDefault(githubToken);
    disableSystemPrompt = Boolean(appState.settings.disableSystemPrompt);
    systemPromptInjectionFrequency =
      appState.settings.systemPromptInjectionFrequency || "first";
    systemPromptInjectionInterval =
      Number(appState.settings.systemPromptInjectionInterval) || 3;
    disableMemory = Boolean(appState.settings.disableMemory);
    disableAllInjection = Boolean(appState.settings.disableAllInjection);
    htmlToMarkdownMaxDepth =
      Number(appState.settings.htmlToMarkdownMaxDepth) || 200;
    maxChatSessions = Number(appState.settings.maxChatSessions) || 500;
    tokenPriceDisplay = Boolean(appState.settings.tokenPriceDisplay);
    projectRagEnabled = Boolean(appState.settings.projectRagEnabled);
    projectRagLimit = Number(appState.settings.projectRagLimit) || 5;
    processGitignoreOnUpload = Boolean(appState.settings.processGitignoreOnUpload);
  }

  export function refreshProject() {
    activeProject = getActiveProject();
    projectInstructions = activeProject?.customInstructions || "";
  }

  function scheduleProjectSave() {
    if (projectSaveTimer) clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(async () => {
      projectSaveTimer = null;
      const project = getActiveProject();
      if (!project) return;
      await updateProject(project.id, {
        customInstructions: projectInstructions,
      });
      pushConfigToPage();
    }, 600);
  }

  async function save() {
    // Ensure we are saving a plain array, not a Svelte proxy
    let snapshots = [];
    try {
      // @ts-ignore
      snapshots = $state.snapshot(customSystemPrompts);
    } catch (e) {
      snapshots = JSON.parse(JSON.stringify(customSystemPrompts));
    }

    appState.settings.customSystemPrompts = snapshots;
    appState.settings.activeSystemPromptId = activeSystemPromptId;
    appState.settings.systemPromptTemplateVersion =
      SYSTEM_PROMPT_TEMPLATE_VERSION;
    appState.settings.downloadBehaviorVersion = DOWNLOAD_BEHAVIOR_VERSION;
    appState.settings.autoDownloadFiles = autoFiles;
    appState.settings.autoDownloadLongWorkZip = autoZip;
    appState.settings.voiceMode = voiceMode;
    appState.settings.voiceLanguage = voiceLanguage;
    appState.settings.autoSubmitVoice = autoSubmitVoice;
    appState.settings.preferredLang = preferredLang.trim();
    appState.settings.githubToken = githubToken.trim();
    appState.settings.disableSystemPrompt = disableSystemPrompt;
    appState.settings.systemPromptInjectionFrequency =
      systemPromptInjectionFrequency;
    appState.settings.systemPromptInjectionInterval =
      systemPromptInjectionInterval;
    appState.settings.disableMemory = disableMemory;
    appState.settings.disableAllInjection = disableAllInjection;
    appState.settings.htmlToMarkdownMaxDepth = Math.max(
      10,
      Math.floor(Number(htmlToMarkdownMaxDepth) || 200),
    );
    appState.settings.maxChatSessions = Math.max(
      10,
      Math.floor(Number(maxChatSessions) || 500),
    );
    appState.settings.tokenPriceDisplay = tokenPriceDisplay;
    appState.settings.projectRagEnabled = projectRagEnabled;
    appState.settings.projectRagLimit = Number(projectRagLimit) || 5;
    appState.settings.processGitignoreOnUpload = processGitignoreOnUpload;

    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: appState.settings,
    });
    pushConfigToPage();

    if (appState.ui) {
      appState.ui.showToast("Настройки сохранены.");
    }
  }

  // ── Live save: any toggle/input change auto-saves (debounced 300ms) ─────
  // No need to click an explicit "Save" button. State propagates to storage
  // + page world via pushConfigToPage so AlicePro/Alice see new flags on the
  // VERY NEXT message — no reload, no manual save.
  let liveSaveTimer = 0;
  function scheduleLiveSave() {
    if (liveSaveTimer) clearTimeout(liveSaveTimer);
    liveSaveTimer = setTimeout(() => { liveSaveTimer = 0; saveSilent(); }, 300);
  }
  async function saveSilent() {
    const wasUi = appState.ui;
    appState.ui = null;       // suppress toast during silent save
    try { await save(); } finally { appState.ui = wasUi; }
  }

  $effect(() => {
    // Track every primitive setting field. Svelte 5 picks up reads inside
    // $effect — listing them here registers dependencies.
    [
      autoFiles, autoZip, voiceMode, voiceLanguage, autoSubmitVoice,
      preferredLang, githubToken, disableSystemPrompt, disableMemory,
      disableAllInjection, systemPromptInjectionFrequency,
      systemPromptInjectionInterval, htmlToMarkdownMaxDepth,
      maxChatSessions, tokenPriceDisplay, projectRagEnabled,
      projectRagLimit, processGitignoreOnUpload, activeSystemPromptId,
    ];
    scheduleLiveSave();
  });

  function openPromptEditor(prompt = null) {
    if (prompt) {
      editingPrompt = prompt;
      promptEditorName = prompt.name;
      promptEditorContent = prompt.content;
      promptEditorIsNew = false;
    } else {
      editingPrompt = null;
      promptEditorName = "";
      promptEditorContent = "";
      promptEditorIsNew = true;
    }
    showPromptEditor = true;
  }

  function closePromptEditor() {
    showPromptEditor = false;
    editingPrompt = null;
  }

  function savePrompt() {
    if (!promptEditorName.trim() || !promptEditorContent.trim()) {
      if (appState.ui) appState.ui.showToast("Name and content are required.");
      return;
    }

    if (promptEditorIsNew) {
      const newPrompt = {
        id: "sp_" + Math.random().toString(36).substring(2, 9),
        name: promptEditorName.trim(),
        content: promptEditorContent.trim()
      };
      customSystemPrompts = [...customSystemPrompts, newPrompt];
    } else if (editingPrompt) {
      customSystemPrompts = customSystemPrompts.map(p => 
        p.id === editingPrompt.id 
          ? { ...p, name: promptEditorName.trim(), content: promptEditorContent.trim() }
          : p
      );
    }
    
    closePromptEditor();
    save(); // Persist immediately
  }

  function deletePrompt(id) {
    if (activeSystemPromptId === id) {
      activeSystemPromptId = "default";
    }
    customSystemPrompts = customSystemPrompts.filter(p => p.id !== id);
    save(); // Persist immediately
  }

  function baseOnDefault() {
    promptEditorContent = appState.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  function getGithubTokenDisplayValue() {
    if (showGithubToken) {
      return githubToken;
    }

    if (!githubToken) {
      return "";
    }

    // Operational security: Don't show the actual token
    // when "Show" is not active. 
    // Instead, show a fixed number of mask characters to indicate
    // that a token is set without revealing it.
    return GITHUB_TOKEN_MASK_CHAR.repeat(999);
  }
</script>

<div class="bap-section-title">
  <span class="bap-icon-inline">
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clip-path="url(#clip0_1450_63327)">
        <path
          d="M14.0861 5.51366C13.8717 5.0575 13.588 4.58542 13.2889 4.18108C13.208 4.07172 13.1596 4.04373 13.0243 4.03054C12.4277 3.97255 11.8245 4.05527 11.2269 3.9972C10.7224 3.94816 10.3133 3.71661 10.0115 3.30919C9.66986 2.84777 9.43973 2.31343 9.09824 1.85234C9.01771 1.74365 8.96805 1.71589 8.83354 1.70282C8.29432 1.65044 7.70402 1.65061 7.16656 1.70282C7.03205 1.71589 6.98239 1.74365 6.90186 1.85234C6.56067 2.31303 6.33025 2.84774 5.98855 3.30919C5.68681 3.71661 5.27774 3.94816 4.77317 3.9972C4.17564 4.05527 3.57239 3.97255 2.97585 4.03054C2.84046 4.04373 2.79208 4.07172 2.71115 4.18108C2.41212 4.58542 2.12835 5.0575 1.91403 5.51366C1.85299 5.64359 1.85286 5.7018 1.91403 5.8319C2.14865 6.33077 2.49748 6.76892 2.73237 7.26854C2.9594 7.7515 2.96041 8.24717 2.73338 8.73044C2.49837 9.23061 2.14891 9.66837 1.91403 10.1681C1.85291 10.2982 1.85299 10.3564 1.91403 10.4863C2.12856 10.9429 2.41185 11.4142 2.71115 11.8189C2.79208 11.9283 2.84046 11.9563 2.97585 11.9694C3.57239 12.0274 4.17564 11.9447 4.77317 12.0028C5.27774 12.0518 5.68681 12.2834 5.98855 12.6908C6.33024 13.1522 6.56037 13.6866 6.90186 14.1476C6.98239 14.2563 7.03205 14.2841 7.16656 14.2972C7.70402 14.3494 8.29432 14.3495 8.83354 14.2972C8.96805 14.2841 9.01771 14.2563 9.09824 14.1476C9.43944 13.687 9.66985 13.1522 10.0115 12.6908C10.3133 12.2834 10.7224 12.0518 11.2269 12.0028C11.8244 11.9447 12.4271 12.0275 13.0243 11.9694C13.1596 11.9563 13.208 11.9283 13.2889 11.8189C13.5891 11.4131 13.872 10.942 14.0861 10.4863C14.1471 10.3564 14.1472 10.2982 14.0861 10.1681C13.8513 9.66861 13.5017 9.23061 13.2667 8.73044C13.0397 8.24717 13.0407 7.7515 13.2677 7.26854C13.5026 6.7689 13.8513 6.33106 14.0861 5.8319C14.1472 5.7018 14.1471 5.64359 14.0861 5.51366ZM15.3035 6.40373C15.0685 6.90359 14.7188 7.34119 14.4841 7.84037C14.4231 7.97025 14.423 8.02855 14.4841 8.15861C14.7189 8.65833 15.0685 9.09611 15.3035 9.59626C15.5308 10.0801 15.5308 10.5744 15.3035 11.0582C15.052 11.5933 14.7225 12.1426 14.37 12.6191C14.0685 13.0265 13.6581 13.259 13.1536 13.3081C12.5566 13.366 11.9541 13.2835 11.3573 13.3414C11.2228 13.3545 11.1731 13.3823 11.0926 13.491C10.7511 13.9521 10.521 14.4864 10.1793 14.9478C9.87828 15.3542 9.46719 15.5869 8.96387 15.6358C8.34008 15.6964 7.66194 15.6966 7.03623 15.6358C6.53291 15.5869 6.12182 15.3542 5.82084 14.9478C5.47911 14.4863 5.24878 13.9517 4.90753 13.491C4.82701 13.3823 4.77734 13.3545 4.64284 13.3414C4.04647 13.2835 3.44373 13.366 2.84653 13.3081C2.34201 13.259 1.93164 13.0265 1.63013 12.6191C1.27867 12.144 0.948453 11.5941 0.696621 11.0582C0.469315 10.5744 0.469279 10.0801 0.696621 9.59626C0.931628 9.09613 1.2813 8.65807 1.51597 8.15861C1.57708 8.02855 1.57702 7.97025 1.51597 7.84037C1.28117 7.34095 0.931635 6.9036 0.696621 6.40373C0.469213 5.91992 0.469367 5.42562 0.696621 4.94183C0.948441 4.40587 1.27868 3.85598 1.63013 3.38092C1.93164 2.97349 2.34201 2.74095 2.84653 2.6919C3.44353 2.63397 4.04599 2.71649 4.64284 2.65856C4.77734 2.64549 4.82701 2.61774 4.90753 2.50904C5.24905 2.04792 5.47913 1.51362 5.82084 1.05219C6.12182 0.645806 6.53291 0.413119 7.03623 0.364178C7.66002 0.303556 8.33816 0.303369 8.96387 0.364178C9.46719 0.413119 9.87828 0.645806 10.1793 1.05219C10.521 1.51365 10.7513 2.04828 11.0926 2.50904C11.1731 2.61774 11.2228 2.64549 11.3573 2.65856C11.9541 2.71649 12.5566 2.63397 13.1536 2.6919C13.6581 2.74095 14.0685 2.97349 14.37 3.38092C14.7214 3.85598 15.0517 4.40587 15.3035 4.94183C15.5307 5.42562 15.5309 5.91992 15.3035 6.40373Z"
          fill="currentColor"
        ></path><path
          d="M9.13764 7.99999C9.13764 7.3715 8.62855 6.8624 8.00005 6.8624C7.37155 6.8624 6.86246 7.3715 6.86246 7.99999C6.86246 8.62849 7.37155 9.13759 8.00005 9.13759C8.62855 9.13759 9.13764 8.62849 9.13764 7.99999ZM10.4834 7.99999C10.4834 9.37126 9.37132 10.4833 8.00005 10.4833C6.62878 10.4833 5.51674 9.37126 5.51674 7.99999C5.51674 6.62873 6.62878 5.51669 8.00005 5.51669C9.37132 5.51669 10.4834 6.62873 10.4834 7.99999Z"
          fill="currentColor"
        ></path>
      </g>
      <defs
        ><clipPath id="clip0_1450_63327"
          ><rect width="16" height="16" fill="currentColor"></rect></clipPath
        ></defs
      >
    </svg>
  </span>
  Общие настройки
</div>

<div class="bap-section-title">
  <label class="bap-label">Системные промпты</label>
</div>

<div class="bap-list">
  <div class="bap-skill-item" class:active={activeSystemPromptId === "default"}>
    <label onclick={() => { activeSystemPromptId = "default"; save(); }} role="button" tabindex="0">
      <input type="radio" checked={activeSystemPromptId === "default"} readonly />
      <div class="bap-prompt-info">
        <span class="bap-prompt-name">По умолчанию (скрытый)</span>
        <span class="bap-prompt-status">Базовые инструкции (только просмотр)</span>
      </div>
    </label>
    <div class="bap-prompt-actions">
      <button class="bap-btn-outlined" style="font-size: 11px; padding: 4px 8px;" title="View" onclick={() => openPromptEditor({ id: 'default', name: 'По умолчанию (скрытый)', content: appState.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT, readonly: true })}>
        View
      </button>
    </div>
  </div>

  {#each customSystemPrompts as prompt (prompt.id)}
    <div class="bap-skill-item" class:active={activeSystemPromptId === prompt.id}>
      <label onclick={() => { activeSystemPromptId = prompt.id; save(); }} role="button" tabindex="0">
        <input type="radio" checked={activeSystemPromptId === prompt.id} readonly />
        <div class="bap-prompt-info">
          <span class="bap-prompt-name">{prompt.name}</span>
          <span class="bap-prompt-status">Custom saved prompt</span>
        </div>
      </label>
      <div class="bap-prompt-actions">
        <button class="bap-btn-outlined" style="font-size: 11px; padding: 4px 8px;" title="Edit" onclick={() => openPromptEditor(prompt)}>
          Edit
        </button>
        <button class="bap-btn-danger" title="Delete" onclick={() => deletePrompt(prompt.id)}>
          Delete
        </button>
      </div>
    </div>
  {/each}

  <button class="bap-add-prompt-btn" type="button" onclick={() => openPromptEditor()}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    Добавить системный промпт
  </button>
</div>

{#if showPromptEditor}
  <div class="bap-modal-overlay">
    <div class="bap-modal">
      <div class="bap-modal-header">
        <div class="ds-modal-content__title">{promptEditorIsNew ? 'Add New Prompt' : (editingPrompt?.readonly ? 'View Prompt' : 'Edit Prompt')}</div>
        <button class="bap-modal-close" onclick={closePromptEditor}>×</button>
      </div>
      
      <div class="bap-modal-body">
        <div class="bap-field">
          <label class="bap-label">Name</label>
          <input type="text" class="bap-input" bind:value={promptEditorName} placeholder="e.g. My Custom Rules" readonly={editingPrompt?.readonly} />
        </div>
        
        <div class="bap-field">
          <div class="bap-label-row">
            <label class="bap-label">Content</label>
            {#if !editingPrompt?.readonly}
              <button class="bap-reset-btn" type="button" onclick={baseOnDefault}>Base on Default</button>
            {/if}
          </div>
          <textarea class="bap-input" style="min-height: 240px;" bind:value={promptEditorContent} placeholder="System instructions here..." readonly={editingPrompt?.readonly}></textarea>
        </div>
      </div>

      <div class="bap-modal-footer">
        <button class="bap-btn-outlined" onclick={closePromptEditor}>Отмена</button>
        {#if !editingPrompt?.readonly}
          <button class="bap-btn" onclick={savePrompt}>Сохранить промпт</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if activeProject}
  <div class="bap-label-row" style="margin-top: 12px;">
    <label class="bap-label" for="bap-project-instructions">
      Project Instructions — <em style="font-weight: 400; opacity: 0.7;"
        >{activeProject.name}</em
      >
    </label>
  </div>
  <textarea
    id="bap-project-instructions"
    class="bap-input"
    spellcheck="false"
    bind:value={projectInstructions}
    oninput={scheduleProjectSave}
    placeholder="Custom instructions appended to the global system prompt for this project…"
  ></textarea>
  <p style="font-size: 10px; opacity: 0.5; margin: 2px 0 12px;">Auto-saved</p>
{/if}

<button
  type="button"
  class="bap-advanced-toggle"
  class:open={advancedOpen}
  onclick={() => (advancedOpen = !advancedOpen)}
>
  Дополнительные настройки
  <span class="bap-chevron">
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </span>
</button>

<div class="bap-advanced-content" class:open={advancedOpen}>
  <div class="bap-advanced-inner">
    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Авто-контекст проекта (локальный RAG)</span>
      <label class="bap-switch">
        <input
          id="bap-project-rag"
          type="checkbox"
          bind:checked={projectRagEnabled}
        />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    {#if projectRagEnabled}
      <div
        class="bap-toggle-row"
        style="flex-direction: column; align-items: flex-start; gap: 6px; padding-left: 12px; border-left: 2px solid rgba(255, 255, 255, 0.1); margin-left: 4px;"
      >
        <span class="bap-toggle-label">Max RAG Chunks to Inject</span>
        <select class="bap-select" bind:value={projectRagLimit}>
          <option value={3}>3 chunks (~600 words)</option>
          <option value={5}>5 chunks (~1000 words)</option>
          <option value={8}>8 chunks (~1600 words)</option>
          <option value={10}>10 chunks (~2000 words)</option>
        </select>
        <p style="font-size: 10px; opacity: 0.5; margin: 0;">
          Automatically retrieves relevant pieces from your project files.
        </p>
      </div>
    {/if}

    <div class="bap-toggle-row" style="flex-wrap: wrap;">
      <span class="bap-toggle-label">Обрабатывать .gitignore при загрузке</span>
      <label class="bap-switch">
        <input
          id="bap-gitignore-upload"
          type="checkbox"
          bind:checked={processGitignoreOnUpload}
        />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Автозагрузка файлов create_file</span>
      <label class="bap-switch">
        <input id="bap-auto-files" type="checkbox" bind:checked={autoFiles} />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">
        🚫 Отключить ВСЮ инжекцию (kill switch)
        <small style="display:block;color:#888;font-size:11px;line-height:1.3;margin-top:2px">
          Никаких системных промптов, навыков, памяти, RAG — голая Алиса. На Алисе Про инжекция всегда выключена (она ломает её ответы — используйте source-файл проекта).
        </small>
      </span>
      <label class="bap-switch">
        <input
          id="bap-disable-all-injection"
          type="checkbox"
          bind:checked={disableAllInjection}
        />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    <div class="bap-toggle-row" style="flex-direction:column;align-items:stretch;gap:8px">
      <span class="bap-toggle-label" style="font-weight:600">
        🚀 Алиса Про — setup через проект
      </span>
      <small style="color:#888;font-size:11px;line-height:1.4">
        Алиса Про игнорирует инжекцию в сообщения и отвечает только о своих базовых функциях. Решение: создай в Алисе Про проект, загрузи туда файл с системным промптом (он ниже), и работай в этом проекте — Алиса будет читать промпт как контекст-источник.
        <br><br>
        Шаги: 1) Нажми «Скачать system_prompt.txt». 2) Открой Алису Про → «Создать проект». 3) Загрузи файл в «Источники». 4) Работай в этом проекте.
      </small>
      <button
        type="button"
        class="bap-action-btn"
        onclick={async () => {
          // Читаем ВСЕ актуальные данные прямо из chrome.storage.local —
          // appState.skills/.memories/.characters могут быть stale (синк
          // через chrome.storage.onChanged не гарантирован к моменту клика).
          const fromStorage = await new Promise(res => {
            chrome.storage.local.get([
              STORAGE_KEYS.skills, STORAGE_KEYS.memories, STORAGE_KEYS.characters, STORAGE_KEYS.settings,
            ], r => res(r || {}));
          });
          const storedSkills = Array.isArray(fromStorage[STORAGE_KEYS.skills]) ? fromStorage[STORAGE_KEYS.skills] : (appState.skills || []);
          const storedMemMap = fromStorage[STORAGE_KEYS.memories] || appState.memories || {};
          const storedChars = Array.isArray(fromStorage[STORAGE_KEYS.characters]) ? fromStorage[STORAGE_KEYS.characters] : (appState.characters || []);
          const storedSettings = fromStorage[STORAGE_KEYS.settings] || appState.settings || {};

          const activeContent = (storedSettings.activeSystemPromptId &&
                                 storedSettings.activeSystemPromptId !== "default" &&
                                 Array.isArray(storedSettings.customSystemPrompts) &&
                                 storedSettings.customSystemPrompts.find(p => p.id === storedSettings.activeSystemPromptId))?.content
            || storedSettings.systemPrompt
            || appState.settings.systemPrompt
            || DEFAULT_SYSTEM_PROMPT;

          const parts = [
            "# Better Alice — системный промпт для Алисы Про",
            "# Положи этот файл в Источники проекта Алисы Про.",
            "# Алиса будет читать его как контекст и следовать инструкциям.",
            "",
            "## СИСТЕМНЫЙ ПРОМПТ",
            "",
            activeContent,
            "",
            "## ТЕХНИЧЕСКАЯ СПРАВКА (форматы кодовых блоков)",
            "",
            TOOL_FENCE_CHEATSHEET,
          ];

          // Активные навыки (skills): bundle всех .md в один блок.
          // SkillList.svelte хранит {id,name,content,active}. Включаем только active≠false.
          const skills = storedSkills.filter(s => s && s.active !== false);
          if (skills.length) {
            parts.push("", "## АКТИВНЫЕ НАВЫКИ (skills)", "");
            for (const s of skills) {
              parts.push(`### ${s.name || "skill"}`, "", (s.content || "").trim(), "");
            }
          }

          // Активный RP-персонаж
          const activeCharId = storedSettings.activeCharacterId;
          const activeChar = storedChars.find(c => c && c.id === activeCharId) || null;
          if (activeChar) {
            parts.push("", "## АКТИВНЫЙ ПЕРСОНАЖ (RP)", "");
            parts.push(`Имя: ${activeChar.name}`);
            if (activeChar.usage) parts.push(`Когда играть: ${activeChar.usage}`);
            parts.push("", (activeChar.content || "").trim(), "");
            parts.push("Играй этого персонажа от первого лица. Не выходи из роли.", "");
          }

          // Память (importance:always) — факты которые должны быть в контексте.
          // storedMemMap — это map {key: {value, importance, ...}}, не массив.
          const alwaysMemories = Object.entries(storedMemMap)
            .map(([key, v]) => ({ key, ...(v && typeof v === "object" ? v : { value: v }) }))
            .filter(m => m && m.importance === "always");
          if (alwaysMemories.length) {
            parts.push("", "## ПАМЯТЬ О ПОЛЬЗОВАТЕЛЕ (всегда учитывай)", "");
            for (const m of alwaysMemories) {
              parts.push(`- ${m.key}: ${m.value}`);
            }
            parts.push("");
          }

          const body = parts.join("\n");
          triggerTextDownload(body, "Better Alice — system prompt.txt");
          if (appState.ui) appState.ui.showToast("Файл скачан. Загрузи его в проект Алисы Про.");
        }}
      >
        📥 Скачать system_prompt.txt
      </button>
      <button
        type="button"
        class="bap-action-btn"
        onclick={() => { window.open("https://alicepro.yandex.ru/expert", "_blank"); }}
      >
        🔗 Открыть «Создать проект» в Алисе Про
      </button>
    </div>

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Отключить скрытый системный промпт</span>
      <label class="bap-switch">
        <input
          id="bap-disable-prompt"
          type="checkbox"
          bind:checked={disableSystemPrompt}
        />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Отключить инжекцию памяти</span>
      <label class="bap-switch">
        <input
          id="bap-disable-memory"
          type="checkbox"
          bind:checked={disableMemory}
        />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Частота инжекции системного промпта</span>
      <select class="bap-select" bind:value={systemPromptInjectionFrequency}>
        <option value="first">Только в первом сообщении</option>
        <option value="always">Всегда (каждое сообщение)</option>
        <option value="every_x">Каждые N сообщений</option>
      </select>
    </div>

    {#if systemPromptInjectionFrequency === "every_x"}
      <div
        class="bap-toggle-row"
        style="flex-direction: column; align-items: flex-start; gap: 6px; padding-left: 12px; border-left: 2px solid rgba(255, 255, 255, 0.1); margin-left: 4px;"
      >
        <span class="bap-toggle-label">Injection Interval (N)</span>
        <input
          id="bap-injection-interval"
          type="number"
          min="2"
          class="bap-input"
          style="width: 100px; box-sizing: border-box;"
          bind:value={systemPromptInjectionInterval}
        />
        <p style="font-size: 10px; opacity: 0.5; margin: 0;">
          Inject the prompt every {systemPromptInjectionInterval} messages.
        </p>
      </div>
    {/if}

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Голосовой режим (озвучка ответов)</span>
      <label class="bap-switch">
        <input id="bap-voice-mode" type="checkbox" bind:checked={voiceMode} />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Авто-отправка после распознавания</span>
      <label class="bap-switch">
        <input
          id="bap-voice-autosubmit"
          type="checkbox"
          bind:checked={autoSubmitVoice}
        />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Язык распознавания речи</span>
      <select class="bap-select" bind:value={voiceLanguage}>
        <option value="en-US">English (US)</option>
        <option value="en-GB">English (UK)</option>
        <option value="tr-TR">Türkçe (TR)</option>
        <option value="de-DE">Deutsch (DE)</option>
        <option value="fr-FR">Français (FR)</option>
        <option value="es-ES">Español (ES)</option>
        <option value="it-IT">Italiano (IT)</option>
        <option value="zh-CN">中文 (简体)</option>
        <option value="ja-JP">日本語 (JP)</option>
      </select>
    </div>

    <div class="bap-toggle-row">
      <span class="bap-toggle-label">Автозагрузка ZIP из LONG_WORK</span>
      <label class="bap-switch">
        <input id="bap-auto-zip" type="checkbox" bind:checked={autoZip} />
        <span class="bap-switch-track"></span>
      </label>
    </div>

    <div
      class="bap-toggle-row"
      style="flex-direction: column; align-items: flex-start; gap: 6px;"
    >
      <span class="bap-toggle-label">Язык ответов модели</span>
      <input
        id="bap-preferred-lang"
        type="text"
        class="bap-input"
        style="width: 100%; box-sizing: border-box;"
        placeholder="e.g. English, Turkish, Pirate"
        bind:value={preferredLang}
      />
      <p style="font-size: 10px; opacity: 0.5; margin: 0;">
        Оставьте пустым, чтобы модель решила сама.
      </p>
    </div>

    <div
      class="bap-toggle-row"
      style="flex-direction: column; align-items: flex-start; gap: 6px;"
    >
      <span class="bap-toggle-label">Макс. глубина обхода Markdown</span>
      <input
        id="bap-html-md-depth"
        type="number"
        min="10"
        step="10"
        class="bap-input"
        style="width: 120px; box-sizing: border-box;"
        bind:value={htmlToMarkdownMaxDepth}
      />
      <p style="font-size: 10px; opacity: 0.5; margin: 0;">
        Жёсткий лимит глубины рекурсии при сборке markdown из
        сообщения. Меньше = безопаснее против переполнения стека на глубоко вложенном контенте;
        больше = сохраняет структуру патологически вложенных сообщений. По умолчанию
        200.
      </p>
    </div>

    <div
      class="bap-toggle-row"
      style="flex-direction: column; align-items: flex-start; gap: 6px;"
    >
      <span class="bap-toggle-label">Лимит списка сессий</span>
      <input
        id="bap-max-chat-sessions"
        type="number"
        min="10"
        step="50"
        class="bap-input"
        style="width: 120px; box-sizing: border-box;"
        bind:value={maxChatSessions}
      />
      <p style="font-size: 10px; opacity: 0.5; margin: 0;">
        Максимальное число сессий, хранимых в памяти для сайдбара. Старые
        сессии сверх лимита удаляются (FIFO). Меньшие значения уменьшают память
        при долгой работе во вкладке. По умолчанию 500.
      </p>
    </div>

    <div
      class="bap-toggle-row"
      style="flex-direction: column; align-items: flex-start; gap: 8px;"
    >
      <span class="bap-toggle-label">GitHub Personal Access Token</span>
      <div class="bap-token-field">
        <input
          id="bap-github-token"
          type="text"
          class="bap-input bap-token-text"
          style="width: 100%; box-sizing: border-box;"
          placeholder="ghp_..."
          value={getGithubTokenDisplayValue()}
          readonly={!showGithubToken}
          oninput={(e) => {
            if (showGithubToken) {
              githubToken = e.currentTarget.value;
            }
          }}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <div class="bap-token-actions">
          <button
            type="button"
            class="bap-btn-outlined bap-token-btn"
            onclick={() => (showGithubToken = !showGithubToken)}
          >
            {showGithubToken ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            class="bap-btn-outlined bap-token-btn"
            onclick={() => {
              githubToken = "";
              showGithubToken = true;
            }}
            disabled={!githubToken}
          >
            Clear
          </button>
        </div>
      </div>
      <p class="bap-token-help">
        Создайте classic-токен со скоупом <code>repo</code> в GitHub Settings →
        Tokens.
      </p>
    </div>
    <!-- Token Price Estimation removed — Yandex Алиса does not expose
         per-message token usage in WebSocket / SvelteKit responses. -->
  </div>
</div>

<button id="bap-save-settings" type="button" onclick={save}>
  Сохранить настройки
</button>

<style>
  .bap-token-field {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bap-token-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .bap-token-btn {
    min-width: 58px;
    padding-inline: 10px;
  }

  .bap-token-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .bap-token-text[readonly] {
    cursor: default;
  }

  .bap-token-help {
    margin: 0;
    font-size: 10px;
    opacity: 0.6;
    line-height: 1.45;
  }

  .bap-token-help code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95em;
  }

  .bap-prompt-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .bap-prompt-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--bap-text-primary);
  }

  .bap-prompt-status {
    font-size: 11px;
    color: var(--bap-text-tertiary);
  }

  .bap-prompt-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .bap-add-prompt-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
    background: transparent;
    border: 1px dashed var(--bap-border);
    border-radius: 10px;
    color: var(--bap-text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--bap-transition);
    margin-top: 4px;
  }

  .bap-add-prompt-btn:hover {
    border-color: var(--bap-accent);
    color: var(--bap-accent);
    background: var(--bap-accent-glow);
  }

  /* Modal Overrides for Yandex Alice Aesthetics */
  .bap-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
    padding: 20px;
  }

  .bap-modal {
    background: var(--bap-bg-panel);
    border: 1px solid var(--bap-border);
    border-radius: 16px;
    width: 100%;
    max-width: 540px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--bap-shadow);
  }

  .bap-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid var(--bap-border);
  }

  .bap-modal-close {
    background: transparent;
    border: none;
    color: var(--bap-text-tertiary);
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .bap-modal-close:hover {
    color: var(--bap-text-primary);
  }

  .bap-modal-body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    overflow-y: auto;
  }

  .bap-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .bap-modal-footer {
    padding: 16px 24px;
    border-top: 1px solid var(--bap-border);
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }

  @media (max-width: 560px) {
    .bap-token-field {
      flex-direction: column;
      align-items: stretch;
    }

    .bap-token-actions {
      justify-content: flex-end;
    }
  }
</style>
