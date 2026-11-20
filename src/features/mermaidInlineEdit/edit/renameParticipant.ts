import type { EditResult, Range, SequenceSourceMap } from '../types';
import { applyReplacements, type Replacement } from './applyReplacements';
import { guardLeadingText, isValidActorId, isValidLineText } from './validate';

const fail = (reason: Exclude<EditResult, { ok: true }>['reason']): EditResult => ({ ok: false, reason });

function inBounds(code: string, [start, end]: Range): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end <= code.length;
}

/**
 * Renames a participant in the source.
 * - No alias: every occurrence of the id is replaced (declaration, message
 *   ends, activate, note, box member, ...).
 * - Alias: only the alias text is replaced; the id stays.
 */
export function renameParticipant(
  currentCode: string,
  map: SequenceSourceMap,
  actorId: string,
  newName: string,
): EditResult {
  if (currentCode !== map.code) return fail('stale_source');

  const loc = map.participants.get(actorId);
  if (!loc) return fail('position_mismatch');

  const ranges = loc.hasAlias ? loc.labelRanges : loc.idRanges;
  if (ranges.length === 0) return fail('position_mismatch');
  for (const r of loc.idRanges) {
    if (!inBounds(currentCode, r) || currentCode.slice(r[0], r[1]) !== actorId) return fail('position_mismatch');
  }
  for (const r of ranges) {
    if (!inBounds(currentCode, r) || r[0] === r[1] || /[\r\n]/.test(currentCode.slice(r[0], r[1]))) {
      return fail('position_mismatch');
    }
  }

  const name = newName.trim();
  if (name === '') return fail('empty');

  if (loc.hasAlias) {
    if (!isValidLineText(name)) return fail('invalid_characters');
  } else {
    if (!isValidActorId(name)) return fail('invalid_characters');
    if (name !== actorId) {
      for (const otherId of map.participants.keys()) {
        if (otherId !== actorId && otherId === name) return fail('name_exists');
      }
    }
  }

  const replacements: Replacement[] = ranges.map((range) => ({
    range,
    text: loc.hasAlias ? guardLeadingText(currentCode, range[0], name) : name,
  }));
  try {
    return { ok: true, code: applyReplacements(currentCode, replacements) };
  } catch {
    return fail('position_mismatch');
  }
}
