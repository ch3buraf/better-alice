import { describe, it, expect } from "vitest";
import { buildPrefixedText } from "../../src/injected/prefix-builder.js";

function makeState(over = {}) {
  const injected = new Set();
  return {
    config: {
      systemPrompt: "SYS",
      systemPromptInjectionFrequency: "first",
      skills: [],
      memories: [],
      activeCharacter: null,
      activeProject: null,
      disableSystemPrompt: false,
      disableMemory: false,
      ...over,
    },
    hasInjected: (id) => injected.has(id),
    markInjected: (id) => injected.add(id),
    sessionUserMsgCounts: {},
  };
}

describe("frequency=every_x", () => {
  it("interval=3 → injects on messages 1, 4, 7", () => {
    const state = makeState({
      systemPromptInjectionFrequency: "every_x",
      systemPromptInjectionInterval: 3,
    });
    const results = [];
    for (let i = 0; i < 8; i++) {
      const r = buildPrefixedText("msg" + i, state, "dialog-1");
      results.push(r.text.includes("SYS"));
    }
    expect(results).toEqual([true, false, false, true, false, false, true, false]);
  });

  it("interval=1 → injects every message (like always)", () => {
    const state = makeState({
      systemPromptInjectionFrequency: "every_x",
      systemPromptInjectionInterval: 1,
    });
    for (let i = 0; i < 4; i++) {
      const r = buildPrefixedText("msg" + i, state, "d");
      expect(r.text).toContain("SYS");
    }
  });

  it("interval=0 clamps to 1 (no division-by-zero)", () => {
    const state = makeState({
      systemPromptInjectionFrequency: "every_x",
      systemPromptInjectionInterval: 0,
    });
    const r = buildPrefixedText("first", state, "d");
    expect(r.text).toContain("SYS");
  });

  it("different dialogs have independent counters", () => {
    const state = makeState({
      systemPromptInjectionFrequency: "every_x",
      systemPromptInjectionInterval: 2,
    });
    // dialog A messages 1, 2, 3
    expect(buildPrefixedText("a1", state, "A").text).toContain("SYS"); // count=1, inject
    expect(buildPrefixedText("a2", state, "A").text).not.toContain("SYS"); // count=2, skip
    // dialog B message 1 — fresh counter
    expect(buildPrefixedText("b1", state, "B").text).toContain("SYS"); // count=1, inject
  });
});
