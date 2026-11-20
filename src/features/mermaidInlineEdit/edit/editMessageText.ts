import type { EditResult, SequenceSourceMap } from '../types';
import { applyReplacements } from './applyReplacements';
import { guardLeadingText, isValidLineText } from './validate';

const fail = (reason: Exclude<EditResult, { ok: true }>['reason']): EditResult => ({ ok: false, reason });

/**
 * Replaces the text of one message (db `messages` index). The new text is
 * trimmed, because the parser trims it too; it may be empty.
 */
export function editMessageText(
  currentCode: string,
  map: SequenceSourceMap,
  messageIndex: number,
  newText: string,
): EditResult {
  if (currentCode !== map.code) return fail('stale_source');

  const range = map.messages.get(messageIndex)?.textRange;
  if (!range) return fail('position_mismatch');
  const [start, end] = range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > currentCode.length) {
    return fail('position_mismatch');
  }
  if (/[\r\n]/.test(currentCode.slice(start, end))) return fail('position_mismatch');
  // The text always follows a ":" (optionally followed by spaces and a wrap directive).
  if (!/:[ \t]*(?:(?:no)?wrap:[ \t]*)?$/i.test(currentCode.slice(Math.max(0, start - 64), start))) {
    return fail('position_mismatch');
  }

  const text = newText.trim();
  if (!isValidLineText(text)) return fail('invalid_characters');

  return { ok: true, code: applyReplacements(currentCode, [{ range, text: guardLeadingText(currentCode, start, text) }]) };
}
