import { test, expect } from "./helpers/extension.js";

async function addAssistantMessage(page, text) {
  await page.evaluate((rawText) => {
    window.__mockYandex Alice.addAssistantMessage(rawText);
  }, text);
}

async function addUserMessage(page, text) {
  await page.evaluate((rawText) => {
    window.__mockYandex Alice.addUserMessage(rawText);
  }, text);
}

async function addCodeMessage(page, language, code) {
  await page.evaluate(
    ({ lang, source }) => {
      window.__mockYandex Alice.addCodeMessage(lang, source);
    },
    { lang: language, source: code },
  );
}

async function updateLastAssistantMessage(page, text) {
  await page.evaluate((rawText) => {
    window.__mockYandex Alice.updateLastAssistantMessage(rawText);
  }, text);
}

async function openDrawer(page) {
  const drawer = page.locator("#bap-drawer");
  if (await drawer.evaluate((node) => node.classList.contains("bap-open"))) {
    return;
  }
  await page.locator("#bap-toggle").click();
  await expect(drawer).toHaveClass(/bap-open/);
}

async function closeDrawer(page) {
  const drawer = page.locator("#bap-drawer");
  if (!(await drawer.evaluate((node) => node.classList.contains("bap-open")))) {
    return;
  }
  await page.locator("#bap-close").click();
  await expect(drawer).toHaveClass(/bap-closed/);
}

test("loads the extension and toggles the drawer", async ({ page }) => {
  await expect(page.locator("#bap-toggle")).toBeVisible();
  await openDrawer(page);
  await closeDrawer(page);
});

test("renders visualizer and HTML tool cards from tagged assistant messages", async ({ page }) => {
  await addAssistantMessage(
    page,
    [
      "Lead text before tools.",
      '<BAL:VISUALIZER><div class="v-card"><h2 class="v-title">Chart</h2></div></BAL:VISUALIZER>',
      "<BAL:HTML><section><h1>Embedded Report</h1></section></BAL:HTML>",
    ].join("\n"),
  );

  await expect(page.locator(".bap-visualizer-card")).toBeVisible();
  await expect(page.locator(".bap-tool-card h4")).toContainText("HTML");
});

test("does not duplicate tagged reply overlays after rescans and updates", async ({ page }) => {
  await addAssistantMessage(
    page,
    [
      "Initial dedupe lead.",
      '<BAL:VISUALIZER><div class="v-card"><h2 class="v-title">Dedupe Chart</h2></div></BAL:VISUALIZER>',
    ].join("\n"),
  );

  await expect(page.locator(".bap-message-overlay")).toHaveCount(1);
  await expect(page.locator(".bap-sanitized-text")).toHaveCount(1);
  await expect(page.locator(".bap-visualizer-card")).toHaveCount(1);

  await page.evaluate(() => {
    for (let i = 0; i < 5; i += 1) {
      const marker = document.createElement("span");
      marker.className = "bap-test-rescan-marker";
      marker.textContent = String(i);
      document.body.appendChild(marker);
    }
  });
  await page.waitForTimeout(500);

  await updateLastAssistantMessage(
    page,
    [
      "Updated dedupe lead.",
      '<BAL:VISUALIZER><div class="v-card"><h2 class="v-title">Dedupe Chart</h2></div></BAL:VISUALIZER>',
    ].join("\n"),
  );
  await page.evaluate(() => {
    const marker = document.createElement("span");
    marker.className = "bap-test-rescan-marker";
    marker.textContent = "after-update";
    document.body.appendChild(marker);
  });

  await expect(page.locator(".bap-sanitized-text")).toContainText("Updated dedupe lead");
  await expect(page.locator(".bap-message-overlay")).toHaveCount(1);
  await expect(page.locator(".bap-sanitized-text")).toHaveCount(1);
  await expect(page.locator(".bap-visualizer-card")).toHaveCount(1);
});

test("renders PPTX, Excel, and Docx cards for office-generation tags", async ({ page }) => {
  await addAssistantMessage(
    page,
    [
      '<BAL:pptx>fileName: "deck.pptx"</BAL:pptx>',
      '<BAL:excel>const wb = {}; XLSX.writeFile(wb, "report.xlsx")</BAL:excel>',
      '<BAL:docx>const doc = {}; DOCX.save(doc, "brief.docx")</BAL:docx>',
    ].join("\n"),
  );

  await expect(page.locator(".bap-pptx-card")).toContainText("deck.pptx");
  await expect(page.locator(".bap-excel-card")).toContainText("report.xlsx");
  await expect(page.locator(".bap-docx-card")).toContainText("brief.docx");
});

test("adds code download buttons and opens the JavaScript runner", async ({ page }) => {
  await addCodeMessage(page, "python", 'print("hello")');
  await addCodeMessage(page, "javascript", 'console.log("runner");');

  await expect(page.getByRole("button", { name: "Run Python" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run JS" })).toBeVisible();
  await expect(page.locator(".bap-code-download")).toHaveCount(2);

  const codeDownload = page.waitForEvent("download");
  await page.locator(".md-code-block .bap-code-download").first().click();
  await expect(await codeDownload).toBeTruthy();

  await page.getByRole("button", { name: "Run JS" }).click();
  await expect(page.locator(".bap-code-runner-card")).toBeVisible();

  const runnerDownload = page.waitForEvent("download");
  await page.locator(".bap-code-runner-card .bap-btn-small").click();
  await expect(await runnerDownload).toBeTruthy();
});

test("imports a GitHub repository through the attach menu flow", async ({ page }) => {
  await page.locator(".bap-plus-btn").click();
  await page.locator(".bap-attach-dropdown .bap-attach-item").filter({ hasText: "GitHub Repo" }).click();
  await page.locator(".bap-github-input").fill("octocat/Hello-World");
  await page.locator(".bap-github-btn-import").click();

  await expect
    .poll(() => page.evaluate(() => window.__mockYandex Alice.getAttachedFiles()))
    .toEqual(["Hello-World_github.txt"]);
});

test("Upload File keeps multiple mode in the web flow", async ({ page }) => {
  await page.evaluate(() => {
    const input = document.querySelector("#native-file-input");
    window.__mockYandex Alice.uploadFileClickMultiple = null;
    input.addEventListener("click", (event) => {
      window.__mockYandex Alice.uploadFileClickMultiple = input.multiple;
      event.preventDefault();
    }, { once: true });
  });

  await page.locator(".bap-plus-btn").click();
  await page
    .locator(".bap-attach-dropdown .bap-attach-item")
    .filter({ hasText: "Upload File" })
    .click();

  await expect
    .poll(() => page.evaluate(() => window.__mockYandex Alice.uploadFileClickMultiple))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.querySelector("#native-file-input").multiple))
    .toBe(true);
});

test("drawer import inputs stay single-file in the web flow", async ({ page }) => {
  await openDrawer(page);
  await page.evaluate(() => {
    const modes = {};
    const accepts = {};
    window.__mockYandex Alice.drawerFilePickerModes = modes;
    window.__mockYandex Alice.drawerFilePickerAccepts = accepts;

    const jsonInputs = document.querySelectorAll('#bap-drawer input[type="file"][accept=".json"]');
    accepts.jsonInputCount = jsonInputs.length;
    const memoryImportInput = jsonInputs[0];
    accepts.memoryImport = memoryImportInput.accept;
    memoryImportInput.addEventListener("click", (event) => {
      modes.memoryImport = memoryImportInput.multiple;
      event.preventDefault();
    }, { once: true });

    for (const [key, selector] of [
      ["skillImport", "#bap-skill-upload"],
      ["characterImport", "#bap-char-upload"],
    ]) {
      const input = document.querySelector(selector);
      accepts[key] = input.accept;
      input.addEventListener("click", (event) => {
        modes[key] = input.multiple;
        event.preventDefault();
      }, { once: true });
    }
  });

  const importButtons = page.locator("#bap-drawer button").filter({ hasText: "Import" });
  await importButtons.nth(0).click();
  await importButtons.nth(1).click();
  await importButtons.nth(2).click();

  await expect
    .poll(() => page.evaluate(() => window.__mockYandex Alice.drawerFilePickerModes))
    .toEqual({
      skillImport: false,
      characterImport: false,
      memoryImport: false,
    });
  await expect
    .poll(() => page.evaluate(() => window.__mockYandex Alice.drawerFilePickerAccepts))
    .toEqual({
      jsonInputCount: 1,
      skillImport: ".md",
      characterImport: ".md",
      memoryImport: ".json",
    });
});

test("project Upload File keeps multiple mode in the web flow", async ({ page }) => {
  await openDrawer(page);
  await page.locator("#bap-drawer button").filter({ hasText: "Manage" }).click();
  await page.locator("#bap-drawer button").filter({ hasText: "New Project" }).click();
  await page.locator('#bap-drawer input[placeholder="Project name (required)"]').fill("Regression Project");
  await page.locator("#bap-drawer button").filter({ hasText: "Create" }).click();
  await page.locator("#bap-drawer .bap-skill-item").filter({ hasText: "Regression Project" }).click();

  await page.evaluate(() => {
    const input = document.querySelector('#bap-drawer input[type="file"][multiple]');
    window.__mockYandex Alice.projectUploadClickMultiple = null;
    input.addEventListener("click", (event) => {
      window.__mockYandex Alice.projectUploadClickMultiple = input.multiple;
      event.preventDefault();
    }, { once: true });
  });

  await page.locator("#bap-drawer button").filter({ hasText: "Upload File" }).click();

  await expect
    .poll(() => page.evaluate(() => window.__mockYandex Alice.projectUploadClickMultiple))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#bap-drawer input[type="file"][multiple]').multiple))
    .toBe(true);
});

test("imports GitHub commit history as a second attachment when enabled", async ({ page }) => {
  await page.locator(".bap-plus-btn").click();
  await page.locator(".bap-attach-dropdown .bap-attach-item").filter({ hasText: "GitHub Repo" }).click();
  await page.locator(".bap-github-input").fill("octocat/Hello-World");
  await page.locator(".bap-github-checkbox input").check();
  await expect(page.locator(".bap-github-number-input")).toHaveValue("");
  await expect(page.locator(".bap-github-number-input")).toHaveAttribute("placeholder", "100");
  await page.locator(".bap-github-btn-import").click();

  await expect
    .poll(() => page.evaluate(() => window.__mockYandex Alice.getAttachedFiles()))
    .toEqual(["Hello-World_github.txt", "Hello-World_commits.txt"]);
});

test("creates standalone download cards for create_file outputs", async ({ page }) => {
  await addAssistantMessage(
    page,
    '<BAL:create_file fileName="notes.txt">standalone body</BAL:create_file>',
  );

  await expect(page.locator(".bap-download-card")).toContainText("notes.txt");

  const download = page.waitForEvent("download");
  await page.locator(".bap-download-card .bap-btn").click();
  await expect(await download).toBeTruthy();
});

test("shows LONG_WORK progress and emits a ZIP download card after close", async ({ page }) => {
  await addAssistantMessage(
    page,
    [
      "Starting long work.",
      "<BAL:LONG_WORK>",
      '<BAL:create_file fileName="src/app.js">console.log("alpha");</BAL:create_file>',
    ].join("\n"),
  );

  await expect(page.locator(".bap-loading-indicator")).toBeVisible();

  await updateLastAssistantMessage(
    page,
    [
      "Starting long work.",
      "<BAL:LONG_WORK>",
      '<BAL:create_file fileName="src/app.js">console.log("alpha");</BAL:create_file>',
      '<BAL:create_file fileName="src/util.js">console.log("beta");</BAL:create_file>',
      "</BAL:LONG_WORK>",
    ].join("\n"),
  );

  await expect(page.locator(".bap-download-card")).toContainText("LONG_WORK project");
  await expect(page.locator(".bap-download-card")).toContainText("2 files packaged");
});

test("updates stored memory entries when memory_write tags are processed", async ({ page }) => {
  await addAssistantMessage(
    page,
    '<BAL:memory_write key_name="favorite_tool" value="Visualizer" importance="always" />',
  );

  await page.waitForTimeout(500);
  await openDrawer(page);

  await expect(page.locator("#bap-memory-list")).toContainText("favorite_tool");
  await expect(page.locator("#bap-memory-list")).toContainText("Visualizer");
});

test("renders the voice prompt control in the composer", async ({ page }) => {
  await expect(page.locator(".bap-mic-btn")).toBeVisible();
  await expect(page.locator(".bap-mic-btn")).toHaveAttribute("title", "Voice Prompt");
});

test("persists settings across reloads", async ({ page }) => {
  await openDrawer(page);
  await page.locator(".bap-add-prompt-btn").click();
  await page.locator(".bap-modal-body input").fill("E2E Rules");
  await page.locator(".bap-modal-body textarea").fill("System prompt from Playwright");
  await page.locator(".bap-modal-footer .bap-btn").click({ force: true });
  await page.waitForTimeout(200);

  await page.reload();
  await page.waitForSelector("#bap-toggle");
  await openDrawer(page);
  await expect(page.locator(".bap-prompt-name").nth(1)).toHaveText("E2E Rules");
});

test("filters sidebar history through the injected search box", async ({ page }) => {
  await expect(page.locator("#bap-sidebar-search-input")).toBeVisible();
  await page.locator("#bap-sidebar-search-input").fill("Alpha");
  await page.waitForTimeout(150);

  await expect
    .poll(() =>
      page.evaluate(() => ({
        alpha: document.querySelector('a[href="/chat/s/mock-chat-1"]').style.display,
        beta: document.querySelector('a[href="/chat/s/mock-chat-2"]').style.display,
      })),
    )
    .toEqual({ alpha: "", beta: "none" });
});

test("exports a chat as markdown from the sidebar menu", async ({ page }) => {
  await page.goto("https://alice.yandex.ru/chat/s/mock-chat-1");
  await page.waitForSelector("#bap-toggle");

  await addUserMessage(page, "How do exports work?");
  await addAssistantMessage(page, "Exports are generated from the visible session transcript.");

  // Hover and open chat menu
  const chatItem = page.locator('.mock-chat-item:has(a[data-session-id="mock-chat-1"])');
  await chatItem.hover();

  // Click the three-dots/menu button (sibling of the chat link, not a descendant)
  const menuBtn = chatItem.locator('div._2090548');
  await menuBtn.click({ force: true });

  // Small delay for the mock script and our injector to process
  await page.waitForTimeout(500);

  // Wait for the injected BDS option
  const exportOption = page.locator(".bap-export-option");
  await expect(exportOption).toBeVisible({ timeout: 10000 });
  await exportOption.click();

  // Wait for selection overlay
  await expect(page.locator(".bap-selection-bar")).toBeVisible();

  // Wait for checkboxes to be added by scanner
  await page.waitForSelector(".bap-selection-checkbox", { timeout: 5000 });

  // Select all messages
  await page.locator('button:has-text("Select All")').click();

  const download = page.waitForEvent("download");
  // Click MD button in the overlay
  await page.locator('.bap-export-btn[title="Markdown (.md)"]').click();
  const artifact = await download;

  expect(artifact.suggestedFilename()).toMatch(/\.md$/);
});

test("hides the Get App promotional button when the Android hide script runs", async ({ page }) => {
  const container = page.locator('[data-testid="get-app-container"]');
  await expect(container).toBeVisible();

  // Simulate MainActivity.injectBdsScripts() evaluating the hide-get-app snippet.
  await page.evaluate(() => {
    if (window.__bdsGetAppObserver) return;
    function hideButton() {
      const spans = document.querySelectorAll("span");
      for (const span of spans) {
        if (span.textContent.trim() !== "Get App") continue;
        let el = span.parentElement;
        while (el && el.tagName !== "BUTTON") {
          el = el.parentElement;
        }
        if (el && el.parentElement) {
          el.parentElement.style.display = "none";
        }
      }
    }
    hideButton();
    const observer = new MutationObserver(hideButton);
    observer.observe(document.body, { subtree: true, childList: true });
    window.__bdsGetAppObserver = observer;
  });

  await expect(container).not.toBeVisible();
});

test("re-hides Get App button after SPA re-render (observer stays alive)", async ({ page }) => {
  // Install the hide script.
  await page.evaluate(() => {
    if (window.__bdsGetAppObserver) return;
    function hideButton() {
      const spans = document.querySelectorAll("span");
      for (const span of spans) {
        if (span.textContent.trim() !== "Get App") continue;
        let el = span.parentElement;
        while (el && el.tagName !== "BUTTON") {
          el = el.parentElement;
        }
        if (el && el.parentElement) {
          el.parentElement.style.display = "none";
        }
      }
    }
    hideButton();
    const observer = new MutationObserver(hideButton);
    observer.observe(document.body, { subtree: true, childList: true });
    window.__bdsGetAppObserver = observer;
  });

  // Simulate SPA transition: remove original node and inject a fresh "Get App" button.
  await page.evaluate(() => {
    const old = document.querySelector('[data-testid="get-app-container"]');
    if (old) old.remove();

    const container = document.createElement("div");
    container.dataset.testid = "get-app-container-spa";
    const button = document.createElement("button");
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = "Get App";
    button.appendChild(label);
    container.appendChild(button);
    document.body.prepend(container);
  });

  // Observer must auto-hide the re-inserted button.
  await expect(page.locator('[data-testid="get-app-container-spa"]')).not.toBeVisible();
});

function installDrawerHideScript(page) {
  return page.evaluate(() => {
    if (window.__bdsDrawerItemObserver) return;
    const TARGET = "Download mobile App";
    function hideItem(menu) {
      const options = menu.querySelectorAll(".ds-dropdown-menu-option");
      for (const opt of options) {
        const label = opt.querySelector(".ds-dropdown-menu-option__label");
        if (label?.textContent.trim().includes(TARGET)) {
          opt.style.display = "none";
        }
      }
    }
    document.querySelectorAll(".ds-dropdown-menu").forEach(hideItem);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList.contains("ds-dropdown-menu")) {
            hideItem(node);
          } else {
            const menu = node.querySelector?.(".ds-dropdown-menu");
            if (menu) hideItem(menu);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__bdsDrawerItemObserver = observer;
  });
}

test("hides Download mobile App item in settings drawer when Android hide script runs", async ({ page }) => {
  await installDrawerHideScript(page);

  // Open the settings drawer (fixture builds a real .ds-dropdown-menu on click).
  await page.locator('[data-testid="settings-trigger"]').click();
  await expect(page.locator('[data-testid="settings-drawer"]')).toBeVisible();

  // Download item must be hidden; other items must remain visible.
  await expect(page.locator('[data-testid="drawer-item-download"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="drawer-item-settings"]')).toBeVisible();
  await expect(page.locator('[data-testid="drawer-item-logout"]')).toBeVisible();
});

test("re-hides drawer download item when settings menu is reopened (SPA nav)", async ({ page }) => {
  await installDrawerHideScript(page);

  // Open → verify hidden.
  await page.locator('[data-testid="settings-trigger"]').click();
  await expect(page.locator('[data-testid="drawer-item-download"]')).not.toBeVisible();

  // Close by clicking elsewhere, then reopen — fixture creates a fresh .ds-dropdown-menu.
  await page.locator("h1").click();
  await page.locator('[data-testid="settings-trigger"]').click();
  await expect(page.locator('[data-testid="drawer-item-download"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="drawer-item-settings"]')).toBeVisible();
});

test("creates the PDF export iframe from the sidebar menu", async ({ page }) => {
  await page.goto("https://alice.yandex.ru/chat/s/mock-chat-1");
  await page.waitForSelector("#bap-toggle");

  await addUserMessage(page, "Generate a PDF snapshot.");
  await addAssistantMessage(page, "This transcript should render into the PDF export iframe.");

  // Hover and open chat menu
  const chatItem = page.locator('.mock-chat-item:has(a[data-session-id="mock-chat-1"])');
  await chatItem.hover();
  const menuBtn = chatItem.locator('div._2090548');
  await menuBtn.click({ force: true });

  await page.waitForTimeout(500);

  // Wait for the injected BDS option
  const exportOption = page.locator(".bap-export-option");
  await expect(exportOption).toBeVisible({ timeout: 10000 });
  await exportOption.click();

  // Wait for selection overlay
  await expect(page.locator(".bap-selection-bar")).toBeVisible();

  // Wait for checkboxes
  await page.waitForSelector(".bap-selection-checkbox", { timeout: 5000 });

  // Select all messages
  await page.locator('button:has-text("Select All")').click();

  // Click PDF button in the overlay
  await page.locator('.bap-export-btn[title="PDF Document"]').click();

  await expect(page.locator("#bap-print-iframe")).toHaveCount(1);
});
