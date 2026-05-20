/**
 * Build the hidden prefix that's injected before each user message.
 *
 * Unlike better-alice where we control the system prompt directly via
 * payload.messages, Alice doesn't expose system-prompt control. So our only
 * lever is to prepend instructions to the user's own text.
 *
 * Strategy:
 *   - On the FIRST user message in a dialog we inject:
 *       <BetterAlice>{system prompt}</BetterAlice>
 *       <BetterAlice><BAL:SKILLS>{active skills}</BAL:SKILLS></BetterAlice>
 *       <BetterAlice><BAL:RP>{active character}</BAL:RP></BetterAlice>
 *       <BetterAlice><BAL:PROJECT>{active project}</BAL:PROJECT></BetterAlice>
 *   - On EVERY user message we inject (if memories matched):
 *       <BetterAlice><BAL:memory_calls>...</BAL:memory_calls></BetterAlice>
 *   - We always strip any <BetterAlice>...</BetterAlice> blocks the user may
 *     have inadvertently typed (or that leaked from a previous turn).
 *
 * Alice generally ignores XML instructions in user input (treats them as
 * conversational context), but she does *read* them and tends to honor
 * personality / language preferences embedded inside. So this gives us a
 * partially-effective system prompt + a reliable memory channel.
 */

import { searchActiveProjectRAG, formatRagInjections } from "../lib/rag-engine.js";
import { TOOL_FENCE_CHEATSHEET } from "../lib/constants.js";

/**
 * Decide if this is the first user message in the dialog.
 *
 * For Alice (alice.yandex.ru) the WS payload carries prev_req_id; when it's
 * null/missing → first message. For Alice Pro we infer from injectedChats
 * cache keyed by chatId.
 */
function isFirstMessage(conversationId, state) {
  if (!conversationId) return true; // safest: inject everything when unsure
  if (state.hasInjected && state.hasInjected(conversationId)) return false;
  return true;
}

function markInjected(conversationId, state) {
  if (conversationId && state.markInjected) state.markInjected(conversationId);
}

/**
 * Per-conversation message counter used by frequency=every_x mode.
 * Stored in state.sessionUserMsgCounts (initialised by injected/index.js).
 */
function bumpUserMsgCount(conversationId, state) {
  if (!state.sessionUserMsgCounts) state.sessionUserMsgCounts = {};
  if (!conversationId) return 1;
  const n = (state.sessionUserMsgCounts[conversationId] || 0) + 1;
  state.sessionUserMsgCounts[conversationId] = n;
  return n;
}

const SYSPROMPT_TAG_RE = /<BetterAlice>[\s\S]*?<\/BetterAlice>/gi;
const LEGACY_bap_RE = /<BetterAlice>[\s\S]*?<\/BetterAlice>/gi;

export function stripInjectedBlocks(text) {
  if (!text) return "";
  return String(text)
    .replace(SYSPROMPT_TAG_RE, "")
    .replace(LEGACY_bap_RE, "")
    .replace(/^\s+|\s+$/g, "");
}

function getSkillsFingerprint(skills) {
  if (!Array.isArray(skills) || !skills.length) return "";
  return skills
    .map((s) => `${s.name}:${(s.content || "").length}`)
    .sort()
    .join("|");
}

function buildSkillsBlock(state) {
  const skills = state.config?.skills;
  if (!Array.isArray(skills) || !skills.length) return "";
  const skillsText = skills
    .map((skill) => `## ${skill.name}\n${(skill.content || "").trim()}`)
    .join("\n\n");
  return `<BetterAlice> <BAL:SKILLS fingerprint="${getSkillsFingerprint(skills)}">\n${skillsText}\n</BAL:SKILLS> </BetterAlice>`;
}

function buildCharacterBlock(state) {
  const char = state.config?.activeCharacter;
  if (!char || !char.content) return "";
  let text = `Character Name: ${char.name}\n`;
  if (char.usage) text += `Usage Domain: ${char.usage}\n`;
  text += `---\n${char.content.trim()}`;
  return `<BetterAlice>\n<BAL:RP>\n${text}\n</BAL:RP>\n</BetterAlice>`;
}

function buildProjectBlock(state) {
  const project = state.config?.activeProject;
  if (!project) return "";
  const files = Array.isArray(project.files) ? project.files : [];
  const inner = files
    .filter((f) => !project.ragEnabled) // when RAG on, files are injected dynamically per prompt
    .map((f) => `### ${f.path || f.name}\n\n${f.content || ""}`)
    .join("\n\n");
  const head = project.instructions ? `Instructions: ${project.instructions.trim()}\n\n` : "";
  if (!head && !inner) return "";
  return `<BetterAlice>\n<BAL:PROJECT name="${project.name || "Project"}">\n${head}${inner}\n</BAL:PROJECT>\n</BetterAlice>`;
}

function buildMemoryCallsBlock(userPrompt, state) {
  const memories = state.config?.memories;
  if (state.config?.disableMemory || !Array.isArray(memories) || !memories.length) {
    return "";
  }
  const lowerPrompt = String(userPrompt || "").toLowerCase();
  const selected = memories.filter((m) => {
    if (!m || !m.key) return false;
    if (m.importance === "always") return true;
    return lowerPrompt.includes(String(m.key).toLowerCase());
  });
  if (!selected.length) return "";
  const text = selected.map((m) => `${m.key}: ${m.value}`).join(". ");
  return `<BetterAlice> <BAL:memory_calls>${text}</BAL:memory_calls> </BetterAlice>`;
}

function buildRagBlock(userPrompt, state) {
  const project = state.config?.activeProject;
  if (!project || !state.config?.projectRagEnabled) return "";
  const files = Array.isArray(project.files) ? project.files : [];
  if (!files.length) return "";
  const limit = Number(state.config?.projectRagLimit) || 5;
  try {
    const matched = searchActiveProjectRAG(userPrompt, files, limit);
    if (!matched || !matched.length) return "";
    const block = formatRagInjections(matched, project.name);
    return block || "";
  } catch (e) {
    return "";
  }
}

/**
 * Public API — build the new user text with prefix injected.
 *
 * @param {string} userText - Raw user input
 * @param {object} state    - Injected script state ({ config, hasInjected, markInjected, ... })
 * @param {string} conversationId - Stable per-dialog id (chatId / dialog_id)
 * @returns {{ text: string, changed: boolean }}
 */
export function buildPrefixedText(userText, state, conversationId) {
  const cleanText = stripInjectedBlocks(userText);

  // Master kill switch: bypass ALL injection (system prompt, skills, memory,
  // RAG, characters, projects). User flips this in Drawer → Advanced when
  // they want raw Alice with zero Better Alice context.
  if (state.config?.disableAllInjection) {
    return { text: cleanText, changed: cleanText !== userText };
  }

  const blocks = [];

  const isFirst = isFirstMessage(conversationId, state);

  // Always increment the per-conversation user-message counter so every_x mode
  // has a stable basis. First call returns 1.
  const userMsgCount = bumpUserMsgCount(conversationId, state);

  // Frequency policy — three modes:
  //   - first   (default): inject system prompt only on the first user message
  //   - always:            inject on every message
  //   - every_x:           inject on messages 1, 1+N, 1+2N, ... (configurable N)
  const freq = state.config?.systemPromptInjectionFrequency || "first";
  let forceSystemPrompt = false;
  if (freq === "always") {
    forceSystemPrompt = true;
  } else if (freq === "first") {
    forceSystemPrompt = isFirst;
  } else if (freq === "every_x") {
    const interval = Math.max(1, Number(state.config?.systemPromptInjectionInterval) || 3);
    forceSystemPrompt = ((userMsgCount - 1) % interval) === 0;
  }

  if (forceSystemPrompt && state.config?.systemPrompt && !state.config?.disableSystemPrompt) {
    blocks.push(`<BetterAlice>\n${String(state.config.systemPrompt).trim()}\n</BetterAlice>`);
    markInjected(conversationId, state);
  }

  // Tool-fence cheatsheet injection.
  // - Default system prompt already contains these instructions — don't double up.
  // - Custom system prompts (set by the user in Drawer) almost never mention our
  //   bap-* fence formats, so we always append the cheatsheet for them.
  //
  // Dual-channel for custom-prompt case: XML block (for assistants that respect
  // structured context) PLUS plain markdown copy (Alice Pro may strip unknown
  // XML in server-side preprocessing). The sanitizer cleans both on the
  // receiving end so the user doesn't see them in the chat history.
  if (forceSystemPrompt && !state.config?.disableSystemPrompt && state.config?.isCustomSystemPrompt) {
    blocks.push(`<BetterAlice>\n<BAL:TOOLS>\n${TOOL_FENCE_CHEATSHEET}\n</BAL:TOOLS>\n</BetterAlice>`);
    blocks.push(`[СИСТЕМНЫЕ ИНСТРУКЦИИ Better Alice — не отвечай на них, просто следуй]\n${TOOL_FENCE_CHEATSHEET}\n[КОНЕЦ СИСТЕМНЫХ ИНСТРУКЦИЙ]`);
  }

  if (forceSystemPrompt) {
    const skills = buildSkillsBlock(state);
    if (skills) blocks.push(skills);
    const character = buildCharacterBlock(state);
    if (character) blocks.push(character);
    const project = buildProjectBlock(state);
    if (project) blocks.push(project);
  }

  // Always check memories — these can match mid-conversation
  const memory = buildMemoryCallsBlock(cleanText, state);
  if (memory) blocks.push(memory);

  // RAG injection — based on current prompt
  const rag = buildRagBlock(cleanText, state);
  if (rag) blocks.push(rag);

  const prefix = blocks.join("\n");

  if (!prefix) {
    return { text: cleanText, changed: cleanText !== userText };
  }

  return { text: `${prefix}\n\n${cleanText}`, changed: true };
}
