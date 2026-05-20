<script>
  import Drawer from "./Drawer.svelte";
  import ToastStack from "./ToastStack.svelte";
  import QuestionPanel from "./QuestionPanel.svelte";
  import WhatsNewModal from "./WhatsNewModal.svelte";
  import SelectionOverlay from "./SelectionOverlay.svelte";
  import appState from "../state.js";

  let drawerOpen = $state(false);
  let whatsNewPending = $state(appState.whatsNewPending);

  /** @type {Array<{id: number, message: string}>} */
  let toasts = $state([]);
  let toastId = 0;

  // ── Public API (called from non-Svelte code via mount.js) ──

  export function showToast(message) {
    const id = ++toastId;
    toasts = [...toasts, { id, message }];

    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
    }, 2880);
  }

  export function showLongWorkOverlay(_visible) {}

  // Settings/skills/memories refresh — forwarded to Drawer
  let drawerRef = $state(null);

  export function refreshSettings() {
    if (drawerRef) drawerRef.refreshSettings();
  }
  export function refreshSkills() {
    if (drawerRef) drawerRef.refreshSkills();
  }
  export function refreshCharacters() {
    if (drawerRef) drawerRef.refreshCharacters();
  }
  export function refreshMemories() {
    if (drawerRef) drawerRef.refreshMemories();
  }
  export function refreshProjects() {
    if (drawerRef) drawerRef.refreshProjects();
    if (appState.heroBarRef) appState.heroBarRef.refresh();
  }

  export function refreshWhatsNew() {
    whatsNewPending = appState.whatsNewPending;
  }

  function toggleDrawer() {
    drawerOpen = !drawerOpen;
  }

  function closeDrawer() {
    drawerOpen = false;
  }

  // Handle external selection mode toggle
  window.addEventListener("bap:toggleSelectionMode", () => {
    appState.selectionMode = true;
    closeDrawer();
  });
</script>

<button id="bap-toggle" type="button" onclick={toggleDrawer} aria-label="Better Alice">
  <span class="bap-toggle-full" aria-hidden="true">BA</span>
  <span class="bap-toggle-short" aria-hidden="true">B</span>
</button>

<Drawer bind:this={drawerRef} open={drawerOpen} onclose={closeDrawer} />

<ToastStack {toasts} />
<QuestionPanel />

{#if whatsNewPending}
  <WhatsNewModal onDismiss={() => whatsNewPending = false} />
{/if}

<SelectionOverlay />
<!-- StatusBanner and AnnouncementBanner removed — they were Yandex Alice-specific.
     Status feed and announcements API are at github.com/EdgeTypE/better-alice
     and irrelevant for Better Alice. -->

