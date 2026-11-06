// src/lib/aiTitleGuard.js
//
// Decides whether a model reply is a title or a chat reply. The Pages function
// (functions/ai-generate-title.ts) and the editor (useAutoTitle.ts) share this
// check. The function runs it on the whole first line, because its 80-character
// cut removes the length and question-mark signals. The editor runs it again so
// a backend that has not been redeployed cannot commit refusal text.
//
// Every pattern is anchored or names model vocabulary, so a legitimate short
// title does not match. Add a pattern only with an observed reply in
// useAutoTitle.spec.ts, and keep the legitimate-title list in that spec passing.

export const NOT_TITLE_LIKE = 'not_title_like';

const MAX_TITLE_REPLY_LENGTH = 100;

const CHAT_REPLY_PATTERNS = [
  /^please (?:provide|share|give|send|paste|specify|describe|enter|let me|note)\b/i,
  /^i(?:'m|'ll|'d|'ve| am| will| would| have| need| can| cannot| can't| don't| do not| see)\b/i,
  /^(?:sorry|however|certainly|sure|of course)\s*[,!.:]/i,
  /^(?:unfortunately|apologies)\b/i,
  /^you (?:did|didn't|haven't|have not|need|must|should|can|will)\b/i,
  /^(?:could|can|would|will) you\b/i,
  /^to (?:create|generate|give|provide|write|help)\b.*\btitle\b/i,
  /^based on the (?:dsl|provided|given|information|description)\b/i,
  /^here(?:'s| is| are)\b/i,
  /\b(?:provide|provided|describing|describes)\b.*\bdsl\b/i,
  /\bdsl\b.*\b(?:provide|provided|describing|describes)\b/i,
];

// Words from the system prompt that the model sometimes returns as the answer.
const PROMPT_ECHOES = /^(?:dsl|title|example title|untitled)$/i;

/**
 * @param {string} reply model output, one candidate title
 * @returns {boolean} false when the reply is a chat reply and not a title
 */
export function looksLikeTitle(reply) {
  const text = String(reply ?? '').replace(/’/g, "'").trim();
  if (!text || text.length > MAX_TITLE_REPLY_LENGTH) return false;
  if (text.includes('\n') || text.endsWith('?')) return false;
  if (PROMPT_ECHOES.test(text)) return false;
  return !CHAT_REPLY_PATTERNS.some((pattern) => pattern.test(text));
}
