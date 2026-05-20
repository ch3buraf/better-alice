/**
 * Sanitize visible text by removing all BDS control tags.
 */
export function sanitizeVisibleText(text) {
  let output = String(text || "");

  // Better Alice injection blocks (user messages on Alice Pro carry these
  // because the prefix is written into textarea.value before submit).
  output = output.replace(
    /<BetterAlice>[\s\S]*?<\/BetterAlice>/gi,
    ""
  );
  output = output.replace(
    /<BetterAlice>[\s\S]*?<\/BetterAlice>/gi,
    ""
  );
  output = output.replace(/<BAL:[A-Za-z0-9_:]+[^>]*>[\s\S]*?<\/BAL:[A-Za-z0-9_:]+>/gi, "");
  output = output.replace(/<\/?BAL:[A-Za-z0-9_:]+[^>]*>/gi, "");

  output = output.replace(/<BAL:SKILLS>[\s\S]*?<\/BAL:SKILLS>/gi, "");
  output = output.replace(
    /<BAL:memory_calls>[\s\S]*?<\/BAL:memory_calls>/gi,
    ""
  );
  output = output.replace(
    /<BAL:[A-Za-z0-9_:]+[^>]*>[\s\S]*?<\/BAL:[A-Za-z0-9_:]+>/gi,
    ""
  );
  // Clean up any stray or unclosed tags
  output = output.replace(/<BAL:[A-Za-z0-9_:]+[^>]*>/gi, "");
  output = output.replace(/<\/BAL:[A-Za-z0-9_:]+>/gi, "");
  output = output.replace(/<BetterAlice>|<\/BetterAlice>/gi, "");
  output = output.replace(/<BetterAlice>|<\/BetterAlice>/gi, "");

  // Plain-text fallback channel (used on Alice Pro in case XML is stripped
  // server-side). Matches `[СИСТЕМНЫЕ ИНСТРУКЦИИ ...]\n...\n[КОНЕЦ ...]`.
  output = output.replace(
    /\[СИСТЕМНЫЕ ИНСТРУКЦИИ Better Alice[\s\S]*?\[КОНЕЦ СИСТЕМНЫХ ИНСТРУКЦИЙ\]/gi,
    ""
  );

  output = output.replace(/<BAL:create_file[^>]*\/>/gi, "");
  output = output.replace(/<\/?BDS:LONG_WORK>/gi, "");
  output = output.replace(/Bal create file>[^\n]*/gi, "");

  return output.replace(/\n{3,}/g, "\n\n").trim();
}
