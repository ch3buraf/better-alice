import { describe, it, expect } from "vitest";
import { buildPrefixedText, stripInjectedBlocks } from "../../src/injected/prefix-builder.js";

function makeState(over = {}) {
  const injected = new Set();
  return {
    config: {
      systemPrompt: "You are Better Alice.",
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

describe("buildPrefixedText", () => {
  it("on first message, injects system prompt", () => {
    const state = makeState();
    const r = buildPrefixedText("привет", state, "dialog-1");
    expect(r.changed).toBe(true);
    expect(r.text).toContain("<BetterAlice>");
    expect(r.text).toContain("You are Better Alice.");
    expect(r.text).toContain("\nпривет");
  });

  it("on subsequent messages, does NOT re-inject system prompt", () => {
    const state = makeState();
    buildPrefixedText("first", state, "dialog-1");
    const r = buildPrefixedText("second", state, "dialog-1");
    expect(r.text).not.toContain("<BetterAlice>");
    expect(r.text).toBe("second");
    expect(r.changed).toBe(false);
  });

  it("respects 'always' injection frequency", () => {
    const state = makeState({ systemPromptInjectionFrequency: "always" });
    buildPrefixedText("first", state, "d");
    const r = buildPrefixedText("second", state, "d");
    expect(r.text).toContain("You are Better Alice.");
  });

  it("injects 'always' memories on every turn", () => {
    const state = makeState({
      memories: [
        { key: "name", value: "Alex", importance: "always" },
      ],
    });
    buildPrefixedText("привет", state, "d"); // first turn
    const r = buildPrefixedText("как дела", state, "d");
    expect(r.text).toContain("<BAL:memory_calls>");
    expect(r.text).toContain("name: Alex");
  });

  it("injects 'called' memories only when key word is in the prompt", () => {
    const state = makeState({
      memories: [
        { key: "project_x", value: "secret app", importance: "called" },
      ],
      systemPromptInjectionFrequency: "first",
    });
    buildPrefixedText("привет", state, "d");
    const r1 = buildPrefixedText("вопрос без триггера", state, "d");
    expect(r1.text).not.toContain("project_x");

    const r2 = buildPrefixedText("расскажи про project_x", state, "d");
    expect(r2.text).toContain("project_x: secret app");
  });

  it("respects disableSystemPrompt", () => {
    const state = makeState({ disableSystemPrompt: true });
    const r = buildPrefixedText("привет", state, "d");
    expect(r.text).not.toContain("You are Better Alice.");
    expect(r.text).toBe("привет");
  });

  it("respects disableMemory", () => {
    const state = makeState({
      disableMemory: true,
      memories: [{ key: "name", value: "Alex", importance: "always" }],
    });
    const r = buildPrefixedText("hi", state, "d");
    expect(r.text).not.toContain("name: Alex");
  });

  it("strips previously-injected blocks from the user prompt", () => {
    const state = makeState();
    const noisy =
      "<BetterAlice>\nleaked system prompt\n</BetterAlice>\n\nactual question";
    const r = buildPrefixedText(noisy, state, "d");
    // Strip happens BEFORE prefix injection, so noisy block is gone…
    expect(r.text).not.toContain("leaked system prompt");
    // …and the fresh system prompt is added because this is the first turn for "d"
    expect(r.text).toContain("You are Better Alice.");
    expect(r.text).toContain("actual question");
  });

  it("strips legacy <BetterAlice> blocks", () => {
    expect(
      stripInjectedBlocks("<BetterAlice>old</BetterAlice>\nhi")
    ).toBe("hi");
  });

  it("injects active skills on first turn", () => {
    const state = makeState({
      skills: [{ name: "Russian", content: "Reply in Russian." }],
    });
    const r = buildPrefixedText("hello", state, "d");
    expect(r.text).toContain("<BAL:SKILLS");
    expect(r.text).toContain("## Russian");
    expect(r.text).toContain("Reply in Russian.");
  });

  it("injects active character on first turn", () => {
    const state = makeState({
      activeCharacter: { name: "Edige", usage: "philosophy", content: "Wise old man." },
    });
    const r = buildPrefixedText("hi", state, "d");
    expect(r.text).toContain("<BAL:RP>");
    expect(r.text).toContain("Character Name: Edige");
    expect(r.text).toContain("Wise old man.");
  });

  it("each new dialog id triggers first-turn injection again", () => {
    const state = makeState();
    buildPrefixedText("hi", state, "dialog-A");
    const r = buildPrefixedText("hi", state, "dialog-B");
    expect(r.text).toContain("You are Better Alice.");
  });
});
