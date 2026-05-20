// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  pushConfigToPage: vi.fn(),
}));

const projectManagerMocks = vi.hoisted(() => ({
  getActiveProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("../../../src/content/bridge.js", () => bridgeMocks);
vi.mock("../../../src/content/project-manager.js", () => projectManagerMocks);

import SettingsPanel from "../../../src/content/ui/SettingsPanel.svelte";
import state from "../../../src/content/state.js";
import { resetAppState } from "../../helpers/app-state.js";
import { renderSvelte, flushUi } from "../../helpers/svelte.js";

describe("SettingsPanel integration", () => {
  beforeEach(() => {
    resetAppState({
      ui: { showToast: vi.fn() },
    });
    state.settings.systemPrompt = "Initial prompt";
    state.settings.githubToken = "ghp_secret";
    bridgeMocks.pushConfigToPage.mockReset();
    projectManagerMocks.getActiveProject.mockReset();
    projectManagerMocks.updateProject.mockReset();
    projectManagerMocks.getActiveProject.mockReturnValue({
      id: "p1",
      name: "Project One",
      customInstructions: "Initial project instructions",
    });
    document.body.innerHTML = "";
  });

  it("adds a custom system prompt and saves settings to chrome storage", async () => {
    const { target, cleanup } = renderSvelte(SettingsPanel);

    target.querySelector(".bap-add-prompt-btn").click();
    await flushUi();

    const nameInput = target.querySelector(".bap-modal-body input");
    nameInput.value = "My Rules";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    const contentArea = target.querySelector(".bap-modal-body textarea");
    contentArea.value = "Be concise and helpful";
    contentArea.dispatchEvent(new Event("input", { bubbles: true }));

    target.querySelector(".bap-modal-footer .bap-btn").click();
    await flushUi();

    target.querySelector(".bap-advanced-toggle").click();
    await flushUi();
    target.querySelector("#bap-preferred-lang").value = "Turkish";
    target.querySelector("#bap-preferred-lang").dispatchEvent(
      new Event("input", { bubbles: true }),
    );

    target.querySelector("#bap-save-settings").click();
    await flushUi();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        bap_settings: expect.objectContaining({
          customSystemPrompts: expect.arrayContaining([
            expect.objectContaining({
              name: "My Rules",
              content: "Be concise and helpful",
            }),
          ]),
          activeSystemPromptId: expect.any(String),
          preferredLang: "Turkish",
        }),
      }),
    );
    expect(bridgeMocks.pushConfigToPage).toHaveBeenCalled();
    expect(state.ui.showToast).toHaveBeenCalledWith("Настройки сохранены.");
    cleanup();
  });

  it("toggles github token visibility and clears the token", async () => {
    const { target, cleanup } = renderSvelte(SettingsPanel);

    target.querySelector(".bap-advanced-toggle").click();
    await flushUi();

    const tokenInput = target.querySelector("#bap-github-token");
    const buttons = Array.from(target.querySelectorAll(".bap-token-btn"));

    expect(tokenInput.readOnly).toBe(true);
    buttons[0].click();
    await flushUi();
    expect(tokenInput.readOnly).toBe(false);

    buttons[1].click();
    await flushUi();
    expect(tokenInput.value).toBe("");
    cleanup();
  });

  it("auto-saves active project instructions", async () => {
    vi.useFakeTimers();
    const { target, cleanup } = renderSvelte(SettingsPanel);

    const projectInstructions = target.querySelector("#bap-project-instructions");
    projectInstructions.value = "Updated project rules";
    projectInstructions.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(700);

    expect(projectManagerMocks.updateProject).toHaveBeenCalledWith("p1", {
      customInstructions: "Updated project rules",
    });
    // Live Drawer + $effect debounce может вызвать pushConfigToPage несколько
    // раз (один раз когда мы записали $state переменную, второй — после save).
    expect(bridgeMocks.pushConfigToPage).toHaveBeenCalled();
    cleanup();
  });
});
