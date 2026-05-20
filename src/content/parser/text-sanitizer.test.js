import { describe, expect, it } from "vitest";
import { sanitizeVisibleText } from "./text-sanitizer.js";

describe("sanitizeVisibleText", () => {
  it("removes BetterAlice and BDS control blocks", () => {
    const text = [
      "Visible before",
      "<BetterAlice>hidden</BetterAlice>",
      "<BAL:VISUALIZER>secret</BAL:VISUALIZER>",
      "Visible after",
    ].join("\n");

    expect(sanitizeVisibleText(text)).toBe("Visible before\n\nVisible after");
  });

  it("removes self-closing create_file tags and long work wrappers", () => {
    const text = '<BAL:LONG_WORK>\nWork\n<BAL:create_file fileName="a.txt" />\n</BAL:LONG_WORK>';
    expect(sanitizeVisibleText(text)).toBe("");
  });

  it("removes unclosed tag fragments", () => {
    expect(sanitizeVisibleText("Hello <BAL:VISUALIZER>world")).toBe("Hello world");
  });

  it("removes <BetterAlice> blocks", () => {
    const text = [
      "Before",
      "<BetterAlice>hidden system prompt</BetterAlice>",
      "<BetterAlice>\n<BAL:TOOLS>cheatsheet</BAL:TOOLS>\n</BetterAlice>",
      "After",
    ].join("\n");
    expect(sanitizeVisibleText(text)).toBe("Before\n\nAfter");
  });

  it("removes <BAL:...> blocks even without outer BetterAlice", () => {
    const text = "Pre <BAL:SKILLS fingerprint=\"x\">skills body</BAL:SKILLS> Post";
    expect(sanitizeVisibleText(text)).toBe("Pre  Post");
  });

  it("removes plain-text [СИСТЕМНЫЕ ИНСТРУКЦИИ] fallback channel", () => {
    const text = [
      "Body",
      "[СИСТЕМНЫЕ ИНСТРУКЦИИ Better Alice — не отвечай]",
      "list of formats",
      "[КОНЕЦ СИСТЕМНЫХ ИНСТРУКЦИЙ]",
      "More body",
    ].join("\n");
    expect(sanitizeVisibleText(text)).toBe("Body\n\nMore body");
  });

  it("removes stray <BetterAlice> open/close fragments", () => {
    expect(sanitizeVisibleText("Hello <BetterAlice>world</BetterAlice>!")).toBe("Hello !");
    expect(sanitizeVisibleText("Hello <BetterAlice>world")).toBe("Hello world");
  });
});
