// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { patchAliceProFetch } from "../../src/injected/alicepro-fetch-patch.js";

// alicepro-fetch-patch.js is a documented NO-OP. AlicePro отказывается следовать
// system-prompt инжекции в тело сообщения — поэтому мы перешли на source-file
// workflow (см. docs/ALICE_VS_ALICEPRO.md). Тест просто фиксирует контракт что
// модуль не падает и идемпотентен.
describe("patchAliceProFetch (NO-OP)", () => {
  beforeEach(() => {
    delete window.__betterAliceProFetchPatched;
  });

  afterEach(() => {
    delete window.__betterAliceProFetchPatched;
  });

  it("does not throw and marks itself patched", () => {
    expect(() => patchAliceProFetch({})).not.toThrow();
    expect(window.__betterAliceProFetchPatched).toBe(true);
  });

  it("is idempotent — second call is a noop", () => {
    patchAliceProFetch({});
    expect(() => patchAliceProFetch({})).not.toThrow();
    expect(window.__betterAliceProFetchPatched).toBe(true);
  });
});
