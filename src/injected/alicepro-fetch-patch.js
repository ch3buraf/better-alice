/**
 * Adapter for alicepro.yandex.ru — INTENTIONALLY A NO-OP.
 *
 * Why: Alice Pro pattern-matches system-prompt-like preambles in user
 * messages and refuses the task ("I'm Alice Pro for Yandex 360..."). The
 * user verified that loading the same prompt as a project source file
 * (Алиса Про → Создать проект → Загрузить файлы → system_prompt.txt)
 * works perfectly without confusing the model.
 *
 * So on Alice Pro we DO NOT mutate outgoing messages. Instead, the Drawer
 * exposes a "Скачать system_prompt.txt" button and instructions for the
 * user to attach the file as a project source. After that, every chat in
 * that project sees the prompt as authoritative context.
 *
 * This adapter still installs (so future hooks have a place to land) but
 * does nothing to outgoing requests or the textarea.
 */

export function patchAliceProFetch(_state) {
  if (window.__betterAliceProFetchPatched) return;
  window.__betterAliceProFetchPatched = true;
  // No-op: see design note above.
}
