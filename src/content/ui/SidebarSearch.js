/**
 * Sidebar Search functionality.
 * Injects a search bar that filters the native chat list.
 * Supports tag-based filtering with #tagname syntax.
 */

import state from "../state.js";
import { extractSessionId } from "../tags/tag-manager.js";

let searchInput = null;
let tagChipsContainer = null;
let searchWrapper = null;
let activeTags = new Set();
let searchDebounceTimer = 0;
let searchSuggestionsContainer = null;

export function initSidebarSearch() {
  if (document.getElementById('bap-sidebar-search-container')) return;
  injectSearchInput();
}

export function injectSearchInput() {
  if (document.getElementById('bap-sidebar-search-container')) return;

  // Find the anchor element to insert the search input next to.
  //
  // Alice (regular): [data-testid="new-chat-button"]
  // Alice Pro:       [data-testid="new-chat-button"] OR #new-boltalka-form
  // Yandex Alice legacy: SVG with path d="M8 0.599609..."

  let anchor =
    document.querySelector('[data-testid="new-chat-button"]') ||
    document.querySelector('#new-boltalka-form');

  if (!anchor) {
    // Legacy Yandex Alice SVG-based detection
    const allSvgs = document.querySelectorAll('svg');
    let newChatSvg = null;
    for (const svg of allSvgs) {
      if (svg.querySelector('path[d*="M8 0.599609"]')) {
        newChatSvg = svg;
        break;
      }
    }
    if (newChatSvg) {
      anchor = newChatSvg.closest('a.bap-logo-link') || newChatSvg.closest('div[tabindex="0"]');
    }
  }

  if (!anchor) return;

  const newChatLink = anchor;

  const container = document.createElement('div');
  container.id = 'bap-sidebar-search-container';
  container.className = 'bap-sidebar-search-wrapper';
  searchWrapper = container;
  
  container.innerHTML = `
    <div class="bap-sidebar-search-inner">
      <div class="bap-search-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </div>
      <input
        type="text"
        id="bap-sidebar-search-input"
        placeholder="Поиск по чатам... (#тег)"
        autocomplete="off"
      />
    </div>
    <div id="bap-search-suggestions" class="bap-tag-suggestions bap-search-suggestions" style="display: none;"></div>
    <div id="bap-tag-chips-container" class="bap-tag-chips-wrapper"></div>
  `;

  // Insert it after the "New Chat" button
  newChatLink.parentNode.insertBefore(container, newChatLink.nextSibling);

  searchInput = container.querySelector('#bap-sidebar-search-input');
  tagChipsContainer = container.querySelector('#bap-tag-chips-container');
  searchSuggestionsContainer = container.querySelector('#bap-search-suggestions');

  searchInput.addEventListener('input', (e) => {
    handleSearch(e.target.value);
  });

  searchInput.addEventListener('focus', () => {
    searchWrapper.classList.add('bap-sidebar-search-wrapper--active');
  });

  searchInput.addEventListener('blur', () => {
    searchWrapper.classList.remove('bap-sidebar-search-wrapper--active');
    setTimeout(hideSuggestions, 200);
  });

  renderTagChips();
  watchSidebarVisibility(container);
  setupSidebarObserver(container);
}

/**
 * Use rAF to track the sidebar panel width and hide the search container
 * when the sidebar is collapsed (width collapses to 0 via CSS transition).
 * @param {HTMLElement} container
 */
function watchSidebarVisibility(container) {
  const sidebarPanel = container.closest('.dc04ec1d');
  if (!sidebarPanel) return;

  const isHidden = () => sidebarPanel.getBoundingClientRect().width === 0;
  let lastHidden = isHidden();
  container.style.display = lastHidden ? 'none' : '';

  function tick() {
    const hidden = isHidden();
    if (hidden !== lastHidden) {
      container.style.display = hidden ? 'none' : '';
      lastHidden = hidden;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function handleSearch(query) {
  clearTimeout(searchDebounceTimer);
  const q = query.toLowerCase().trim();
  
  if (q.includes("#")) {
    const parts = query.split("#");
    const lastPart = parts[parts.length - 1];
    if (lastPart.length >= 0) {
      showSuggestions(lastPart);
    } else {
      hideSuggestions();
    }
  } else {
    hideSuggestions();
  }

  searchDebounceTimer = setTimeout(() => {
    performFiltering(q);
  }, 100);
}

function showSuggestions(filter) {
  if (!searchSuggestionsContainer) return;
  
  // Get unique tags
  const allKnownTags = [];
  const tagCounts = {};
  Object.values(state.chatTags).forEach(tags => {
    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      if (!allKnownTags.includes(tag)) allKnownTags.push(tag);
    });
  });

  const filtered = allKnownTags.filter(
    (t) =>
      t.toLowerCase().includes(filter.toLowerCase()) &&
      !activeTags.has(t)
  );

  if (filtered.length === 0) {
    hideSuggestions();
    return;
  }

  searchSuggestionsContainer.innerHTML = "";
  searchSuggestionsContainer.style.display = "block";

  filtered.slice(0, 5).forEach(tag => {
    const item = document.createElement("div");
    item.className = "bap-tag-suggestion-item";
    item.innerHTML = `
      <span class="bap-tag-suggestion-label">#${tag}</span>
      <span class="bap-tag-suggestion-count">${tagCounts[tag]}</span>
    `;
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // Replace the current #tag with the selected one
      const val = searchInput.value;
      const hashIndex = val.lastIndexOf("#");
      const newVal = val.substring(0, hashIndex) + "#" + tag + " ";
      searchInput.value = newVal;
      hideSuggestions();
      handleSearch(newVal);
      searchInput.focus();
    });
    searchSuggestionsContainer.appendChild(item);
  });
}

function hideSuggestions() {
  if (searchSuggestionsContainer) {
    searchSuggestionsContainer.style.display = "none";
    searchSuggestionsContainer.innerHTML = "";
  }
}

export function renderTagChips() {
  if (!tagChipsContainer) return;
  
  // Get all unique tags and their counts
  const tagCounts = {};
  Object.values(state.chatTags).forEach(tags => {
    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  const uniqueTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);
  
  if (uniqueTags.length === 0) {
    tagChipsContainer.style.display = 'none';
    return;
  }
  
  tagChipsContainer.style.display = 'flex';
  tagChipsContainer.innerHTML = '';

  uniqueTags.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = `bap-tag-chip ${activeTags.has(tag) ? 'bap-tag-chip--active' : ''}`;
    chip.innerHTML = `
      <span class="bap-tag-chip-label">${tag}</span>
      <span class="bap-tag-chip-count">${tagCounts[tag]}</span>
    `;
    chip.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent input blur
      toggleTagFilter(tag);
      if (searchInput) searchInput.focus();
    });
    tagChipsContainer.appendChild(chip);
  });
}

let sidebarObserver = null;

function setupSidebarObserver(container) {
  if (sidebarObserver) sidebarObserver.disconnect();

  // Find the list container that holds chat items. Try platforms in order:
  //   - Alice: [data-testid="chat-list-wrapper"] (preferred) or [data-testid="chat-sidebar"]
  //   - Yandex Alice/legacy: div.flex-1.overflow-y-auto
  //   - Last resort: search container's own parent (so we at least observe siblings)
  const sidebarNav =
    document.querySelector('[data-testid="chat-list-wrapper"]') ||
    document.querySelector('[data-testid="chat-sidebar"]') ||
    document.querySelector('div.flex-1.overflow-y-auto') ||
    container.parentElement;
  if (!sidebarNav) return;

  sidebarObserver = new MutationObserver(() => {
    // Re-apply filtering when sidebar content changes (e.g. Yandex Alice re-renders)
    const query = searchInput ? searchInput.value : "";
    performFiltering(query);
  });

  sidebarObserver.observe(sidebarNav, {
    childList: true,
    subtree: true
  });
}

function toggleTagFilter(tag) {
  if (activeTags.has(tag)) {
    activeTags.delete(tag);
  } else {
    activeTags.add(tag);
  }
  
  if (activeTags.size > 0) {
    searchWrapper.classList.add('bap-sidebar-search-wrapper--has-filter');
  } else {
    searchWrapper.classList.remove('bap-sidebar-search-wrapper--has-filter');
  }

  renderTagChips();
  performFiltering(searchInput ? searchInput.value : "");
}

function performFiltering(query) {
  // Collect chat-list items across all supported platforms:
  //   - Alice: [data-testid^="chatlist-item-"]
  //   - Yandex Alice: a._546d736
  //   - Alice Pro: links in sidebar with /chats/{uuid} URL pattern
  const chatItems = [
    ...document.querySelectorAll('[data-testid^="chatlist-item-"]'),
    ...document.querySelectorAll('a._546d736'),
    ...document.querySelectorAll('a[href*="/chats/"]'),
  ];
  const q = query.toLowerCase().trim();

  // Check if this is a tag search (#tagname) from the input field
  const inputTagSearch = q.startsWith("#") ? q.slice(1).trim() : null;

  chatItems.forEach(item => {
    // Try Yandex Alice title element first, fall back to whole item textContent
    const titleEl = item.querySelector('.c08e6e93') || item;
    const fullTitle = titleEl?.getAttribute("data-bap-full-title") || "";
    const visibleTitle = titleEl ? titleEl.textContent.toLowerCase() : '';
    const searchableTitle = (fullTitle || visibleTitle).toLowerCase();
    
    // Session id can come from href (Yandex Alice/Alice Pro) or from data-testid (Alice)
    const sessionId = extractSessionId(item.href || item.getAttribute("data-testid") || "");
    const sessionTags = sessionId ? (state.chatTags[sessionId] || []) : [];
    const sessionTagsLower = sessionTags.map(t => t.toLowerCase());

    let matches = true;

    // 1. Filter by active tag chips (AND logic)
    if (activeTags.size > 0) {
      for (const activeTag of activeTags) {
        if (!sessionTagsLower.includes(activeTag.toLowerCase())) {
          matches = false;
          break;
        }
      }
    }

    if (!matches) {
      item.style.setProperty('display', 'none', 'important');
      return;
    }

    // 2. Filter by search input
    if (q) {
      if (inputTagSearch) {
        // Tag search in input: check if any tag matches the query
        const hasTagMatch = sessionTagsLower.some(t => t.includes(inputTagSearch));
        if (!hasTagMatch) matches = false;
      } else {
        // Normal text search
        if (!searchableTitle.includes(q)) matches = false;
      }
    }

    if (matches) {
      item.style.removeProperty('display');
    } else {
      item.style.setProperty('display', 'none', 'important');
    }
  });

  // Filter history group headers
  const groups = document.querySelectorAll('div._3098d02');
  groups.forEach(group => {
    const items = group.querySelectorAll('a._546d736');
    const hasVisibleItems = Array.from(items).some(item => item.style.display !== 'none');
    
    if (hasVisibleItems || !query && activeTags.size === 0) {
      group.style.removeProperty('display');
    } else {
      group.style.setProperty('display', 'none', 'important');
    }
  });
}
