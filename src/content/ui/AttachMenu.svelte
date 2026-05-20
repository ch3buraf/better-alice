<script>
  import { onMount } from "svelte";
  import { pickFolderAndConcatenate } from "../files/folder-reader.js";
  import { fetchGitHubRepo, parseGitHubUrl } from "../files/github-reader.js";
  import {
    DEFAULT_GITHUB_COMMIT_COUNT,
    fetchGitHubCommits,
    normalizeGitHubCommitCount,
  } from "../files/github-commits.js";
  import { fetchAndConvertWebPage } from "../files/web-reader.js";
  import { projectFilesToFile } from "../files/project-file-builder.js";
  import { openNativeFilePicker } from "../files/native-file-input.js";
  import {
    buildFolderFileFromNative,
    isNativeFilePickerAvailable,
    nativePickFiles,
  } from "../../platform/android-file-picker.js";
  import {
    getFilesForProject,
    setActiveProject,
    clearActiveProject,
    tickFile,
    untickFile,
    clearActiveFiles,
  } from "../project-manager.js";
  import { pushConfigToPage } from "../bridge.js";
  import appState from "../state.js";
  import { BRIDGE_EVENTS } from "../../lib/constants.js";

  // The native input[type="file"] reference passed from scanner
  export let nativeInput;

  let isOpen = false;
  let menuRef;
  let dropdownStyle = "";

  // GitHub dialog state
  let showGithubDialog = false;
  let githubUrl = "";
  let githubStatus = "";
  let githubLoading = false;
  let githubError = "";
  let includeCommits = false;
  let commitCountInput = "";

  // Web Import dialog state
  let showWebDialog = false;
  let webUrl = "";
  let webStatus = "";
  let webLoading = false;
  let webError = "";

  let dialogRef;

  // Project panel (folder button) state
  let showProjectPanel = false;
  let projectPanelStyle = "";
  let projectBtnRef;
  let projectPanelRef;
  let panelProjects = [...appState.projects];
  let panelActiveProjectId = "";
  let panelFiles = [];
  let panelTickedIds = [];

  // Speech Recognition state
  let isRecording = false;
  let recognition = null;

  // Replaced at build time by Vite's `define` (see build.js sharedDefine).
  // Vite inlines the literal string, e.g. `process.env.bap_TARGET` → `"android"`,
  // so `"android" || "chrome"` → `"android"`. In Vitest the env var is undefined
  // so the `"chrome"` fallback is hit, which mirrors the default extension target.
  const bap_TARGET = process.env.bap_TARGET || "chrome";
  const isAndroidTarget = bap_TARGET === "android";

  // Folder upload uses window.showDirectoryPicker — unavailable in Android
  // WebView. Voice input is hidden on Android because SpeechRecognition isn't
  // wired up in WebView; the on-screen keyboard mic is always reachable.
  // On non-Android targets we keep the buttons visible and let the existing
  // runtime fallbacks (toast on missing API) handle older Chromium variants.
  // Android native bridge re-enables folder upload when pickFiles exists.
  const supportsFolderUpload = !isAndroidTarget || isNativeFilePickerAvailable();
  const supportsVoiceInput = !isAndroidTarget;

  function hasGithubToken() {
    return Boolean(String(appState.settings.githubToken || "").trim());
  }

  function stopTTS() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  function toggleSpeechRecognition() {
    if (isRecording) {
      if (recognition) recognition.stop();
      isRecording = false;
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (appState.ui)
        appState.ui.showToast("Browser does not support Speech Recognition.");
      return;
    }

    stopTTS();

    recognition = new SpeechRecognition();
    recognition.lang =
      appState.settings.voiceLanguage || navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      isRecording = true;
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0])
        .map((result) => result.transcript)
        .join("");

      injectTextIntoYandexAlice(transcript, event.results[0].isFinal);
    };

    recognition.onerror = (event) => {
      console.error("Speech Recognition Error:", event.error);
      isRecording = false;
      if (appState.ui) appState.ui.showToast(`Voice Error: ${event.error}`);
    };

    recognition.onend = () => {
      isRecording = false;
    };

    recognition.start();
  }

  function injectTextIntoYandexAlice(text, isFinal) {
    // Alice Pro: <textarea id="message-textarea">
    // Alice (regular): <textarea class="AliceInput-Textarea"> with data-testid="inputbase-textarea"
    // Legacy Yandex Alice: textarea#chat-input or .ds-textarea textarea
    const textarea =
      document.querySelector("textarea#message-textarea") ||
      document.querySelector('[data-testid="inputbase-textarea"]') ||
      document.querySelector("textarea.AliceInput-Textarea") ||
      document.querySelector("textarea#chat-input") ||
      document.querySelector(".ds-textarea textarea") ||
      document.querySelector("textarea");

    if (!textarea) {
      if (isFinal && appState.ui)
        appState.ui.showToast("Не удалось найти поле ввода Алисы.");
      return;
    }

    // For React (Alice): use the native setter via prototype descriptor so
    // React's synthetic-event system notices the change. For Svelte (Alice Pro)
    // and Yandex Alice the plain setter also works, but going through the
    // descriptor doesn't hurt — it's the universal "drive input from JS" path.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set;
    if (setter) {
      setter.call(textarea, text);
    } else {
      textarea.value = text;
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    if (isFinal && appState.settings.autoSubmitVoice) {
      setTimeout(robustSend, 400);
    }
  }

  function robustSend() {
    // Notify the injected script that this is a voice message
    window.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.markVoiceMessage));

    let attempts = 0;
    const maxAttempts = 50;

    const attempt = () => {
      attempts++;
      const buttons = Array.from(
        document.querySelectorAll('div[role="button"], button'),
      );
      const sendBtn = buttons.find((b) => {
        // Alice Pro: <button class="submit ..."> inside <form id="message-form">
        // Alice: <button data-testid="oknyx" class="StandaloneOknyx_arrow"> (when input filled)
        // Legacy Yandex Alice: SVG-path-based heuristics
        const isAlicePro =
          b.classList?.contains?.("submit") &&
          b.closest?.("#message-form");
        const isAlice =
          b.getAttribute?.("data-testid") === "oknyx" &&
          b.classList?.contains?.("StandaloneOknyx_arrow");
        const isAliceByAria = b.getAttribute?.("aria-label") === "Отправить";
        const isLegacyYandexAlice =
          b.querySelector?.('svg path[d*="M8.3125"], .ds-icon-send') ||
          b.querySelector?.('svg path[d*="M13.12 19.98"]') ||
          b.title === "Send message" ||
          b.ariaLabel === "Send Message";
        const isSend = isAlicePro || isAlice || isAliceByAria || isLegacyYandexAlice;
        const isAttach =
          b.classList.contains("bap-plus-btn") || b.querySelector("svg line");
        return isSend && !isAttach;
      });

      if (sendBtn) {
        const isDisabled =
          sendBtn.getAttribute("aria-disabled") === "true" ||
          sendBtn.classList.contains("ds-icon-button--disabled");

        if (!isDisabled) {
          sendBtn.click();
          return;
        }
      }

      if (attempts < maxAttempts) {
        setTimeout(attempt, 200);
      } else {
        // Fallback: Try Enter key on input
        const textarea =
          document.querySelector("textarea#message-textarea") ||
          document.querySelector('[data-testid="inputbase-textarea"]') ||
          document.querySelector("textarea.AliceInput-Textarea") ||
          document.querySelector("textarea#chat-input") ||
          document.querySelector(".ds-textarea textarea");
        if (textarea) {
          textarea.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              keyCode: 13,
            }),
          );
        }
      }
    };

    attempt();
  }

  function toggleMenu(e) {
    e.stopPropagation();
    if (!isOpen) {
      updatePosition();
      isOpen = true;
    } else {
      isOpen = false;
    }
  }

  function updatePosition() {
    if (!menuRef) return;
    const rect = menuRef.getBoundingClientRect();
    dropdownStyle = `bottom: calc(100vh - ${rect.top}px + 8px); right: calc(100vw - ${rect.right}px);`;
  }

  function portal(node) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }

  function closeMenu() {
    isOpen = false;
  }

  onMount(() => {
    panelProjects = [...appState.projects];
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    appState.heroBarRef = { refresh: refreshProjectPanel };
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      if (appState.heroBarRef?.refresh === refreshProjectPanel) {
        appState.heroBarRef = null;
      }
    };
  });

  function handleClickOutside(e) {
    const inMenu = menuRef && menuRef.contains(e.target);
    const inDialog = dialogRef && dialogRef.contains(e.target);
    const inPanel = projectPanelRef && projectPanelRef.contains(e.target);
    if (!inMenu && !inDialog && !inPanel) {
      closeMenu();
      showProjectPanel = false;
    }
  }

  function handleEscape(e) {
    if (e.key === "Escape") {
      if (showGithubDialog && !githubLoading) showGithubDialog = false;
      if (showWebDialog && !webLoading) showWebDialog = false;
      showProjectPanel = false;
      closeMenu();
    }
  }

  async function handleUploadFile() {
    closeMenu();
    if (isAndroidTarget && isNativeFilePickerAvailable()) {
      try {
        const result = await nativePickFiles("files");
        if (!result.cancelled && result.files && result.files.length > 0) {
          for (const file of result.files) {
            const blob = new Blob([file.content], { type: "text/plain" });
            injectFile(new File([blob], file.name, { type: "text/plain" }));
          }
        }
      } catch (err) {
        if (appState.ui) {
          appState.ui.showToast(err?.message || "File pick failed.");
        }
      }
      return;
    }

    if (nativeInput) {
      // Native picker behavior is selected via a file-flow strategy. Android's
      // "Загрузить файл" path prefers the single-file strategy so WebView asks the
      // platform chooser for one file even though Алисы DOM input is `multiple`.
      openNativeFilePicker(nativeInput, { preferSingle: isAndroidTarget });
    }
  }

  async function handleUploadFolder() {
    closeMenu();

    if (isAndroidTarget) {
      if (isNativeFilePickerAvailable()) {
        try {
          const result = await nativePickFiles("folder");
          if (!result.cancelled && result.files && result.files.length > 0) {
            const fakeFile = buildFolderFileFromNative(
              result.files,
              result.folderName,
            );
            if (fakeFile) injectFile(fakeFile);
          }
        } catch (err) {
          if (appState.ui) {
            appState.ui.showToast(err?.message || "Folder pick failed.");
          }
        }
      } else if (appState.ui) {
        appState.ui.showToast("Folder upload requires a newer version of the app.");
      }
      return;
    }

    if (!nativeInput) return;

    try {
      const fakeFile = await pickFolderAndConcatenate();
      if (fakeFile) {
        injectFile(fakeFile);
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        return;
      }

      console.error("[AttachMenu] Folder upload failed:", err);
      if (appState.ui) {
        appState.ui.showToast(err?.message || "Folder upload failed.");
      }
    }
  }

  function handleGithubImport() {
    closeMenu();
    githubUrl = "";
    githubStatus = "";
    githubError = "";
    githubLoading = false;
    includeCommits = false;
    commitCountInput = "";
    showGithubDialog = true;
  }

  function handleCommitCountInput(event) {
    commitCountInput = event.currentTarget.value;
  }

  async function submitGithubUrl() {
    if (!githubUrl.trim() || githubLoading) return;

    const parsed = parseGitHubUrl(githubUrl);
    if (!parsed) {
      githubError =
        "Invalid URL. Use: https://github.com/owner/repo or owner/repo";
      return;
    }

    githubError = "";
    githubLoading = true;

    try {
      const token = String(appState.settings.githubToken || "").trim();
      const sourceFile = await fetchGitHubRepo(
        githubUrl,
        (status) => {
          githubStatus = status;
        },
        { token },
      );

      if (sourceFile) {
        injectFile(sourceFile);
      }

      if (includeCommits && sourceFile) {
        try {
          const resolvedBranch =
            sourceFile.bdsGitHub?.branch || parsed.branch || "main";
          const requestedCommitCount = normalizeGitHubCommitCount(
            commitCountInput,
            DEFAULT_GITHUB_COMMIT_COUNT,
          );
          const commitFile = await fetchGitHubCommits(
            githubUrl,
            requestedCommitCount,
            (status) => {
              githubStatus = status;
            },
            {
              token,
              branch: resolvedBranch,
            },
          );

          if (commitFile) {
            injectFile(commitFile);
          }
        } catch (error) {
          if (appState.ui) {
            appState.ui.showToast(
              error?.message || "Failed to fetch commit history.",
            );
          }
        }
      }

      if (sourceFile) {
        showGithubDialog = false;
      }
    } catch (err) {
      githubError = err.message || "Failed to fetch repository.";
    } finally {
      githubLoading = false;
    }
  }

  function handleWebImport() {
    closeMenu();
    webUrl = "";
    webStatus = "";
    webError = "";
    webLoading = false;
    showWebDialog = true;
  }

  async function submitWebUrl() {
    if (!webUrl.trim() || webLoading) return;

    try {
      new URL(webUrl); // Basic validation
    } catch {
      webError = "Please enter a valid URL (including http/https).";
      return;
    }

    webError = "";
    webLoading = true;

    try {
      const file = await fetchAndConvertWebPage(webUrl, (status) => {
        webStatus = status;
      });

      if (file) {
        showWebDialog = false;
        injectFile(file);
      }
    } catch (err) {
      webError = err.message || "Не удалось получить содержимое страницы.";
    } finally {
      webLoading = false;
    }
  }

  function injectFile(file) {
    // Three strategies, in priority order:
    //   1. Real Yandex Alice upload — drive the native file input via DataTransfer
    //   2. Synthetic input (Alice / Alice Pro) — read text content and insert
    //      it into the chat textarea, prefixed with a fence/header so it's
    //      obvious it's a pasted file. Image/binary files are skipped on Alice.
    //   3. No input at all — toast and bail.
    const isSynthetic = nativeInput?.getAttribute?.("data-bap-synthetic") === "true";

    if (nativeInput && !isSynthetic) {
      const dt = new DataTransfer();
      if (nativeInput.files) {
        for (let i = 0; i < nativeInput.files.length; i++) {
          dt.items.add(nativeInput.files[i]);
        }
      }
      dt.items.add(file);
      nativeInput.files = dt.files;
      nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // Alice path — content goes into the textarea as text
    const ALICE_TEXT_MIMES = ["text/", "application/json", "application/xml"];
    const isTextLike =
      file.type === "" ||
      ALICE_TEXT_MIMES.some((p) => file.type.startsWith(p)) ||
      /\.(md|txt|json|xml|yaml|yml|html|csv|log|gitingest)$/i.test(file.name);

    if (!isTextLike) {
      if (appState.ui) {
        appState.ui.showToast(
          `Файл «${file.name}» не вставлен в чат: тип ${file.type || "binary"} не поддерживается Алисой через текст.`
        );
      }
      return;
    }

    file.text().then((text) => {
      const textarea =
        document.querySelector("textarea#message-textarea") ||
        document.querySelector('[data-testid="inputbase-textarea"]') ||
        document.querySelector("textarea.AliceInput-Textarea") ||
        document.querySelector("textarea");
      if (!textarea) {
        if (appState.ui) appState.ui.showToast("Не удалось найти поле ввода Алисы.");
        return;
      }
      const prefix = textarea.value ? textarea.value + "\n\n" : "";
      const header = `--- ${file.name} ---\n\n`;
      const newVal = prefix + header + text;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;
      if (setter) setter.call(textarea, newVal); else textarea.value = newVal;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      if (appState.ui) {
        appState.ui.showToast(`Вставлено: ${file.name} (${formatSize(file.size)})`);
      }
    }).catch((err) => {
      if (appState.ui) appState.ui.showToast(`Ошибка чтения файла: ${err.message}`);
    });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function hasMessages() {
    return document.querySelectorAll("div.ds-message").length > 0;
  }

  function openProjectPanel(e) {
    e.stopPropagation();
    if (showProjectPanel) {
      showProjectPanel = false;
      return;
    }
    refreshProjectPanel();
    if (projectBtnRef) {
      const rect = projectBtnRef.getBoundingClientRect();
      // Guard against overflow on narrow viewports: if the panel would
      // extend past the right edge, align it to the right instead.
      const panelW = 300;
      const viewportW = window.innerWidth;
      let left = rect.left;
      if (left + panelW > viewportW - 8) {
        left = Math.max(8, viewportW - panelW - 8);
      }
      projectPanelStyle =
        `bottom: calc(100vh - ${rect.top}px + 8px); left: ${left}px; max-width: ${Math.min(panelW, viewportW - 16)}px;`;
    }
    showProjectPanel = true;
  }

  function refreshProjectPanel() {
    panelProjects = [...appState.projects];
    panelActiveProjectId = appState.activeProjectId || "";
    panelFiles = panelActiveProjectId
      ? getFilesForProject(panelActiveProjectId)
      : [];
    panelTickedIds = [...appState.activeFileIds];
  }

  function handlePanelProjectChange(e) {
    applyPanelSwitch(e.target.value || "");
  }

  function applyPanelSwitch(id) {
    if (id) setActiveProject(id);
    else clearActiveProject();
    panelActiveProjectId = appState.activeProjectId || "";
    panelFiles = panelActiveProjectId
      ? getFilesForProject(panelActiveProjectId)
      : [];
    panelTickedIds = [...appState.activeFileIds];
    pushConfigToPage();
    if (appState.ui) appState.ui.refreshProjects();
  }

  function handlePanelFileToggle(fileId, checked) {
    if (checked) tickFile(fileId);
    else untickFile(fileId);
    panelTickedIds = [...appState.activeFileIds];
    pushConfigToPage();
  }

  function attachPanelFiles() {
    if (!nativeInput || !panelTickedIds.length) return;
    const activeFiles = panelFiles.filter((f) => panelTickedIds.includes(f.id));
    if (!activeFiles.length) return;
    const activeProject = panelProjects.find(
      (p) => p.id === panelActiveProjectId,
    );
    const file = projectFilesToFile(
      activeFiles,
      activeProject?.name || "Project",
    );
    if (!file) return;
    injectFile(file);
    showProjectPanel = false;
  }

  function toggleSelectAll() {
    if (panelTickedIds.length === panelFiles.length) {
      for (const id of [...panelTickedIds]) untickFile(id);
      panelTickedIds = [];
    } else {
      for (const file of panelFiles) {
        if (!panelTickedIds.includes(file.id)) tickFile(file.id);
      }
      panelTickedIds = [...appState.activeFileIds];
    }
    pushConfigToPage();
  }

  function handleDialogKeydown(e, type) {
    if (e.key === "Enter") {
      if (type === "github" && !githubLoading) submitGithubUrl();
      if (type === "web" && !webLoading) submitWebUrl();
    }
  }
</script>

<div class="bap-attach-wrapper" bind:this={menuRef}>
  <button class="bap-plus-btn" on:click={toggleMenu} title="Advanced Upload">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  </button>

  <button
    class="bap-project-btn"
    bind:this={projectBtnRef}
    on:click={openProjectPanel}
    title="Attach Project"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="opacity:0.65"
    >
      <path
        d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
      />
    </svg>
  </button>

  {#if supportsVoiceInput}
    <button
      class="bap-mic-btn {isRecording ? 'bap-recording' : ''}"
      on:click={toggleSpeechRecognition}
      title={isRecording ? "Остановить запись" : "Voice Prompt"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={isRecording ? "currentColor" : "none"}
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
      {#if isRecording}
        <div class="bap-recording-pulse"></div>
      {/if}
    </button>
  {/if}

  {#if isOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="bap-attach-dropdown"
      style={dropdownStyle}
      use:portal
      on:click|stopPropagation
    >
      <button class="bap-attach-item" on:click={handleUploadFile}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="bap-item-icon"
          ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          ></path><polyline points="14 2 14 8 20 8"></polyline><line
            x1="12"
            y1="18"
            x2="12"
            y2="12"
          ></line><line x1="9" y1="15" x2="15" y2="15"></line></svg
        >
        Загрузить файл
      </button>
      {#if supportsFolderUpload}
        <button class="bap-attach-item" on:click={handleUploadFolder}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="bap-item-icon"
            ><path
              d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
            ></path><line x1="12" y1="11" x2="12" y2="17"></line><line
              x1="9"
              y1="14"
              x2="15"
              y2="14"
            ></line></svg
          >
          Загрузить папку
        </button>
      {/if}
      <div class="bap-attach-divider"></div>
      <button class="bap-attach-item" on:click={handleGithubImport}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="bap-item-icon"
          ><path
            d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
          ></path></svg
        >
        <span class="bap-attach-item-label">
          <span>GitHub репо</span>
          {#if hasGithubToken()}
            <span
              class="bap-github-auth-icon"
              aria-label="Authenticated GitHub access"
              title="Authenticated GitHub access"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.15"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="5" y="11" width="14" height="10" rx="2"></rect>
                <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
              </svg>
            </span>
          {/if}
        </span>
      </button>
      <button class="bap-attach-item" on:click={handleWebImport}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="bap-item-icon"
          ><circle cx="12" cy="12" r="10"></circle><line
            x1="2"
            y1="12"
            x2="22"
            y2="12"
          ></line><path
            d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
          ></path></svg
        >
        Fetch Веб-страница
      </button>
    </div>
  {/if}
</div>

{#if showGithubDialog}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="bap-github-overlay"
    use:portal
    on:click|self={() => {
      if (!githubLoading) showGithubDialog = false;
    }}
  >
    <div
      class="bap-github-dialog"
      bind:this={dialogRef}
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <div class="bap-github-header">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="bap-github-logo"
          ><path
            d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
          ></path></svg
        >
        <span>GitHub репо Import</span>
        {#if hasGithubToken()}
          <span class="bap-github-auth-pill">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.15"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="5" y="11" width="14" height="10" rx="2"></rect>
              <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
            </svg>
            Authenticated
          </span>
        {/if}
        {#if !githubLoading}
          <button
            class="bap-github-close"
            on:click={() => (showGithubDialog = false)}>&times;</button
          >
        {/if}
      </div>

      <div class="bap-github-body">
        <input
          class="bap-github-input"
          type="text"
          placeholder="https://github.com/owner/repo or owner/repo"
          bind:value={githubUrl}
          on:keydown={(e) => handleDialogKeydown(e, "github")}
          disabled={githubLoading}
          autofocus
        />

        <label class="bap-github-checkbox">
          <input
            type="checkbox"
            bind:checked={includeCommits}
            disabled={githubLoading}
          />
          <span>Include commit history</span>
        </label>

        {#if includeCommits}
          <label class="bap-github-number">
            <span>Количество коммитов:</span>
            <input
              class="bap-github-number-input"
              type="number"
              step="1"
              inputmode="numeric"
              value={commitCountInput}
              placeholder={String(DEFAULT_GITHUB_COMMIT_COUNT)}
              on:input={handleCommitCountInput}
              on:keydown={(e) => handleDialogKeydown(e, "github")}
              disabled={githubLoading}
            />
          </label>
        {/if}

        {#if githubError}
          <div class="bap-github-error">{githubError}</div>
        {/if}

        {#if githubStatus && githubLoading}
          <div class="bap-github-status">
            <div class="bap-spinner"></div>
            <span>{githubStatus}</span>
          </div>
        {/if}
      </div>

      <div class="bap-github-footer">
        <button
          class="bap-github-btn bap-github-btn-cancel"
          on:click={() => {
            if (!githubLoading) showGithubDialog = false;
          }}
          disabled={githubLoading}
        >
          Close
        </button>
        <button
          class="bap-github-btn bap-github-btn-import"
          on:click={submitGithubUrl}
          disabled={githubLoading || !githubUrl.trim()}
        >
          {githubLoading ? "Fetching..." : "Fetch"}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showProjectPanel}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="bap-project-panel"
    style={projectPanelStyle}
    use:portal
    bind:this={projectPanelRef}
    on:click|stopPropagation
  >
    <div class="bap-pp-header">
      <span class="bap-pp-label">Project</span>
      <select
        class="bap-pp-select"
        value={panelActiveProjectId}
        on:change={handlePanelProjectChange}
      >
        <option value="">None</option>
        {#each panelProjects as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </div>

    <p class="bap-pp-hint">
      Instructions from selected project apply at first message only.
    </p>

    {#if panelActiveProjectId && panelFiles.length > 0}
      <div class="bap-pp-files-header">
        <span class="bap-pp-files-count"
          >{panelFiles.length} file{panelFiles.length === 1 ? "" : "s"}</span
        >
        <button class="bap-pp-select-all" on:click={toggleSelectAll}>
          {panelTickedIds.length === panelFiles.length
            ? "Deselect all"
            : "Select all"}
        </button>
      </div>
      <div class="bap-pp-files">
        {#each panelFiles as file (file.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <label
            class="bap-pp-pill{panelTickedIds.includes(file.id)
              ? ' bap-pp-pill--active'
              : ''}"
            title={file.name}
          >
            <input
              type="checkbox"
              class="bap-sr-only"
              checked={panelTickedIds.includes(file.id)}
              on:change={(e) =>
                handlePanelFileToggle(file.id, e.target.checked)}
            />
            <span class="bap-pp-pill-check" aria-hidden="true">
              {#if panelTickedIds.includes(file.id)}
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="currentColor"
                  ><path d="M8.5 2L4 7 1.5 4.5l-.7.7L4 8.5 9.2 2.7z" /></svg
                >
              {:else}
                <span class="bap-pp-pill-box"></span>
              {/if}
            </span>
            <span class="bap-pp-pill-name">{file.name.split("/").pop()}</span>
          </label>
        {/each}
      </div>
      {#if panelTickedIds.length > 0}
        <div class="bap-pp-footer">
          <button class="bap-pp-attach" on:click={attachPanelFiles}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
              />
            </svg>
            Attach ({panelTickedIds.length})
          </button>
        </div>
      {/if}
    {:else if panelActiveProjectId}
      <p class="bap-pp-empty">No files — add via Manage Проекты</p>
    {:else}
      <p class="bap-pp-empty">No project selected</p>
    {/if}
  </div>
{/if}

{#if showWebDialog}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="bap-github-overlay"
    use:portal
    on:click|self={() => {
      if (!webLoading) showWebDialog = false;
    }}
  >
    <div
      class="bap-github-dialog"
      bind:this={dialogRef}
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <div class="bap-github-header">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><circle cx="12" cy="12" r="10"></circle><line
            x1="2"
            y1="12"
            x2="22"
            y2="12"
          ></line><path
            d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
          ></path></svg
        >
        <span>Fetch Веб-страница</span>
        {#if !webLoading}
          <button
            class="bap-github-close"
            on:click={() => (showWebDialog = false)}>&times;</button
          >
        {/if}
      </div>

      <div class="bap-github-body">
        <input
          class="bap-github-input"
          type="text"
          placeholder="https://example.com/article"
          bind:value={webUrl}
          on:keydown={(e) => handleDialogKeydown(e, "web")}
          disabled={webLoading}
          autofocus
        />

        {#if webError}
          <div class="bap-github-error">{webError}</div>
        {/if}

        {#if webStatus && webLoading}
          <div class="bap-github-status">
            <div class="bap-spinner"></div>
            <span>{webStatus}</span>
          </div>
        {/if}
      </div>

      <div class="bap-github-footer">
        <button
          class="bap-github-btn bap-github-btn-cancel"
          on:click={() => {
            if (!webLoading) showWebDialog = false;
          }}
          disabled={webLoading}
        >
          Close
        </button>
        <button
          class="bap-github-btn bap-github-btn-import"
          on:click={submitWebUrl}
          disabled={webLoading || !webUrl.trim()}
        >
          {webLoading ? "Fetching..." : "Fetch"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .bap-attach-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: 6px;
  }

  .bap-plus-btn {
    background: transparent;
    border: none;
    color: var(--bap-accent);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      background-color var(--bap-transition, 0.18s ease),
      transform 0.1s ease;
  }

  .bap-plus-btn:hover {
    background-color: var(--bap-accent-glow);
  }

  .bap-plus-btn:active {
    transform: scale(0.95);
  }

  .bap-mic-btn {
    position: relative;
    background: transparent;
    border: none;
    color: var(--bap-accent);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all var(--bap-transition, 0.18s ease);
    margin-right: 2px;
  }

  .bap-mic-btn:hover {
    background-color: var(--bap-accent-glow);
  }

  .bap-mic-btn.bap-recording {
    color: #ef4444;
    background-color: rgba(239, 68, 68, 0.1);
  }

  .bap-recording-pulse {
    position: absolute;
    inset: -2px;
    border: 2px solid #ef4444;
    border-radius: 50%;
    animation: bap-pulse 1.5s infinite;
    opacity: 0;
  }

  @keyframes bap-pulse {
    0% {
      transform: scale(1);
      opacity: 0.6;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }

  .bap-attach-dropdown {
    position: fixed;
    background: var(--bap-bg-panel);
    border: 1px solid var(--bap-border);
    border-radius: var(--bap-radius, 14px);
    box-shadow: var(--bap-shadow);
    padding: 6px;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    z-index: 999999;
  }

  .bap-attach-item {
    background: none;
    border: none;
    color: var(--bap-text-primary);
    padding: 10px 12px;
    text-align: left;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: background-color var(--bap-transition, 0.18s ease);
    white-space: nowrap;
  }

  .bap-attach-item:hover {
    background: var(--bap-bg-hover);
  }

  .bap-item-icon {
    opacity: 0.8;
    flex-shrink: 0;
  }

  .bap-attach-item-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .bap-github-auth-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    color: var(--bap-accent);
    background: var(--bap-accent-glow);
    border: 1px solid var(--bap-border);
    flex-shrink: 0;
  }

  .bap-attach-divider {
    height: 1px;
    background: var(--bap-border);
    margin: 4px 6px;
  }

  /* ─── GitHub Dialog ─── */

  .bap-github-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999999;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
  }

  .bap-github-dialog {
    background: var(--bap-bg-panel);
    border: 1px solid var(--bap-border);
    border-radius: var(--bap-radius, 14px);
    width: 440px;
    max-width: 90vw;
    box-shadow: var(--bap-shadow);
    overflow: hidden;
  }

  .bap-github-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--bap-border);
    font-size: 15px;
    font-weight: 600;
    color: var(--bap-text-primary);
  }

  .bap-github-logo {
    opacity: 0.9;
  }

  .bap-github-close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--bap-text-tertiary);
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .bap-github-close:hover {
    color: var(--bap-text-primary);
  }

  .bap-github-auth-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid var(--bap-border);
    background: var(--bap-accent-glow);
    color: var(--bap-accent);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  }

  .bap-github-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .bap-github-body > * {
    min-width: 0;
  }

  .bap-github-input {
    display: block;
    box-sizing: border-box;
    max-width: 100%;
    background: var(--bap-bg-input);
    border: 1px solid var(--bap-border);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 13px;
    color: var(--bap-text-primary);
    outline: none;
    transition:
      border-color var(--bap-transition, 0.18s ease),
      box-shadow var(--bap-transition, 0.18s ease);
    font-family: inherit;
    width: 100%;
  }

  .bap-github-input:focus {
    border-color: var(--bap-accent);
    box-shadow: 0 0 0 3px var(--bap-accent-glow);
  }

  .bap-github-input:disabled {
    opacity: 0.6;
  }

  .bap-github-error {
    color: var(--bap-danger, #f87171);
    font-size: 13px;
    padding: 0 2px;
  }

  .bap-github-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--bap-text-primary);
    font-size: 13px;
    cursor: pointer;
    user-select: none;
  }

  .bap-github-checkbox input {
    margin: 0;
    accent-color: var(--bap-accent);
  }

  .bap-github-number {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--bap-text-secondary);
    font-size: 13px;
    flex-wrap: wrap;
  }

  .bap-github-number-input {
    width: 96px;
    min-width: 0;
    background: var(--bap-bg-input);
    border: 1px solid var(--bap-border);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--bap-text-primary);
    outline: none;
    transition:
      border-color var(--bap-transition, 0.18s ease),
      box-shadow var(--bap-transition, 0.18s ease);
  }

  .bap-github-number-input:focus {
    border-color: var(--bap-accent);
    box-shadow: 0 0 0 3px var(--bap-accent-glow);
  }

  .bap-github-number-input:disabled {
    opacity: 0.6;
  }

  .bap-github-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--bap-accent);
    padding: 0 2px;
  }

  .bap-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: var(--bap-accent);
    border-radius: 50%;
    animation: bap-spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  @keyframes bap-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .bap-github-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--bap-border);
  }

  .bap-github-btn {
    padding: 7px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--bap-transition, 0.18s ease);
  }

  .bap-github-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .bap-github-btn-cancel {
    border: 1px solid var(--bap-border);
    background: transparent;
    color: var(--bap-text-primary);
  }

  .bap-github-btn-cancel:hover:not(:disabled) {
    background: var(--bap-bg-elevated);
    border-color: var(--bap-border-hover);
  }

  .bap-github-btn-import {
    border: none;
    background: var(--bap-accent);
    color: #fff;
  }

  .bap-github-btn-import:hover:not(:disabled) {
    opacity: 0.88;
  }

  .bap-attach-item--project {
    color: var(--bap-accent);
  }

  .bap-attach-item--project:hover {
    background: var(--bap-accent-glow);
    color: var(--bap-accent);
  }

  .bap-picker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 4px;
    border-radius: 5px;
    cursor: pointer;
    border-bottom: 1px solid var(--bap-border);
  }

  .bap-picker-row:last-child {
    border-bottom: none;
  }

  .bap-picker-row:hover {
    background: var(--bap-bg-hover);
  }

  .bap-picker-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .bap-picker-name {
    font-size: 13px;
    color: var(--bap-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bap-picker-size {
    font-size: 10px;
    color: var(--bap-text-tertiary);
    margin-top: 1px;
  }

  /* ─── Project Panel ─── */

  .bap-project-btn {
    background: transparent;
    border: none;
    color: var(--bap-accent);
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color var(--bap-transition, 0.18s ease);
    flex-shrink: 0;
    padding: 0;
  }

  .bap-project-btn:hover {
    background-color: var(--bap-accent-glow);
  }

  .bap-project-btn--active {
    color: var(--bap-accent);
  }

  .bap-project-panel {
    position: fixed;
    background: var(--bap-bg-panel);
    border: 1px solid var(--bap-border);
    border-radius: var(--bap-radius, 14px);
    box-shadow: var(--bap-shadow);
    min-width: 240px;
    max-width: 300px;
    z-index: 999999;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
  }

  .bap-pp-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--bap-border);
  }

  .bap-pp-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--bap-text-tertiary);
    flex-shrink: 0;
  }

  .bap-pp-select {
    background: var(--bap-bg-input);
    border: 1px solid var(--bap-border);
    border-radius: 6px;
    color: var(--bap-text-primary);
    font-size: 13px;
    padding: 5px 8px;
    cursor: pointer;
    flex: 1;
    outline: none;
    min-width: 0;
    font-family: inherit;
    transition:
      border-color var(--bap-transition, 0.18s ease),
      box-shadow var(--bap-transition, 0.18s ease);
  }

  .bap-pp-select:focus {
    border-color: var(--bap-accent);
    box-shadow: 0 0 0 3px var(--bap-accent-glow);
  }

  .bap-pp-hint {
    font-size: 11px;
    color: var(--bap-text-secondary);
    padding: 6px 12px 8px;
    margin: 0;
    line-height: 1.45;
    border-bottom: 1px solid var(--bap-border);
  }

  .bap-pp-files-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px 2px;
  }

  .bap-pp-files-count {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--bap-text-tertiary);
  }

  .bap-pp-select-all {
    background: none;
    border: none;
    color: var(--bap-accent);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background var(--bap-transition, 0.18s ease);
    font-family: inherit;
  }

  .bap-pp-select-all:hover {
    background: var(--bap-accent-glow);
  }

  .bap-pp-files {
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    gap: 1px;
    max-height: 210px;
    overflow-y: auto;
  }

  .bap-pp-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: var(--bap-text-primary);
    transition: background var(--bap-transition, 0.18s ease);
    user-select: none;
  }

  .bap-pp-pill:hover {
    background: var(--bap-bg-hover);
  }

  .bap-pp-pill--active {
    color: var(--bap-accent);
    background: var(--bap-accent-glow);
  }

  .bap-pp-pill--active:hover {
    background: var(--bap-accent-glow);
    filter: brightness(1.15);
  }

  .bap-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }

  .bap-pp-pill-check {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 14px;
    height: 14px;
  }

  .bap-pp-pill-box {
    display: block;
    width: 10px;
    height: 10px;
    border: 1.5px solid currentColor;
    border-radius: 2px;
    opacity: 0.3;
  }

  .bap-pp-pill-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .bap-pp-footer {
    padding: 8px 10px;
    border-top: 1px solid var(--bap-border);
  }

  .bap-pp-attach {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 7px 12px;
    background: var(--bap-accent);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    transition: opacity var(--bap-transition, 0.18s ease);
    font-family: inherit;
  }

  .bap-pp-attach:hover {
    opacity: 0.88;
  }

  .bap-pp-empty {
    font-size: 12px;
    color: var(--bap-text-tertiary);
    font-style: italic;
    padding: 14px 12px;
    margin: 0;
    text-align: center;
  }

  .bap-pp-confirm {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .bap-pp-confirm-text {
    font-size: 12px;
    color: var(--bap-text-secondary);
  }

  .bap-pp-confirm-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
</style>
