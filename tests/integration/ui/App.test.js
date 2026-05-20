// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  pushConfigToPage: vi.fn(),
}));

const projectManagerMocks = vi.hoisted(() => ({
  getActiveProject: vi.fn(() => null),
  updateProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  addProjectFilesBatch: vi.fn(),
  deleteProjectFile: vi.fn(),
  getFilesForProject: vi.fn(() => []),
  setActiveProject: vi.fn(),
  clearActiveProject: vi.fn(),
  tickFile: vi.fn(),
  untickFile: vi.fn(),
  clearActiveFiles: vi.fn(),
}));

const scannerMocks = vi.hoisted(() => ({
  scheduleScan: vi.fn(),
  collectMessageNodes: vi.fn(() => []),
  detectMessageRole: vi.fn(),
}));

const exporterMocks = vi.hoisted(() => ({
  exportSession: vi.fn(),
  collectMessages: vi.fn(() => []),
}));

const folderPickerMocks = vi.hoisted(() => ({
  pickFolderSelection: vi.fn(),
  pickFolderAndConcatenate: vi.fn(),
}));

vi.mock("../../../src/content/bridge.js", () => bridgeMocks);
vi.mock("../../../src/content/project-manager.js", () => projectManagerMocks);
vi.mock("../../../src/content/scanner.js", () => scannerMocks);
vi.mock("../../../src/content/tools/exporter.js", () => exporterMocks);
vi.mock("../../../src/lib/utils/folder-picker.js", () => folderPickerMocks);

import App from "../../../src/content/ui/App.svelte";
import { resetAppState } from "../../helpers/app-state.js";
import { renderSvelte, flushUi } from "../../helpers/svelte.js";

describe("App toggle button", () => {
  beforeEach(() => {
    resetAppState({ ui: { showToast: vi.fn() } });
    bridgeMocks.pushConfigToPage.mockReset();
    document.body.innerHTML = "";
  });

  it("renders #bap-toggle with aria-label", async () => {
    const { target, cleanup } = renderSvelte(App);
    await flushUi();

    const toggle = target.querySelector("#bap-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe("Better Alice");

    cleanup();
  });

  it("toggle contains .bap-toggle-full span with text BDS", async () => {
    const { target, cleanup } = renderSvelte(App);
    await flushUi();

    const fullSpan = target.querySelector("#bap-toggle .bap-toggle-full");
    expect(fullSpan).not.toBeNull();
    expect(fullSpan.textContent).toBe("BA");
    expect(fullSpan.getAttribute("aria-hidden")).toBe("true");

    cleanup();
  });

  it("toggle contains .bap-toggle-short span with text B", async () => {
    const { target, cleanup } = renderSvelte(App);
    await flushUi();

    const shortSpan = target.querySelector("#bap-toggle .bap-toggle-short");
    expect(shortSpan).not.toBeNull();
    expect(shortSpan.textContent).toBe("B");
    expect(shortSpan.getAttribute("aria-hidden")).toBe("true");

    cleanup();
  });

  it("clicking toggle opens the drawer", async () => {
    const { target, cleanup } = renderSvelte(App);
    await flushUi();

    const drawer = target.querySelector("#bap-drawer");
    expect(drawer.className).toContain("bap-closed");

    target.querySelector("#bap-toggle").click();
    await flushUi();

    expect(drawer.className).toContain("bap-open");
    expect(drawer.className).not.toContain("bap-closed");

    cleanup();
  });

  it("clicking toggle twice closes the drawer", async () => {
    const { target, cleanup } = renderSvelte(App);
    await flushUi();

    const toggle = target.querySelector("#bap-toggle");
    const drawer = target.querySelector("#bap-drawer");

    toggle.click();
    await flushUi();
    expect(drawer.className).toContain("bap-open");

    toggle.click();
    await flushUi();
    expect(drawer.className).toContain("bap-closed");

    cleanup();
  });

  it("close button inside drawer closes it", async () => {
    const { target, cleanup } = renderSvelte(App);
    await flushUi();

    target.querySelector("#bap-toggle").click();
    await flushUi();
    expect(target.querySelector("#bap-drawer").className).toContain("bap-open");

    target.querySelector("#bap-close").click();
    await flushUi();
    expect(target.querySelector("#bap-drawer").className).toContain("bap-closed");

    cleanup();
  });
});
