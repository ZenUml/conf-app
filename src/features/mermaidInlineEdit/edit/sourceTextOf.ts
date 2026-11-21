import type { Range, SequenceSourceMap } from '../types';
import type { EditableKind } from '../types';

/**
 * Raw source text of an editable target, for prefilling the input.
 * - participantLabel: key is the actor id; returns the alias, or the id.
 * - messageText: key is the message index; returns the text (may be '').
 * Returns null when the map has no usable range.
 */
export function sourceTextOf(map: SequenceSourceMap, kind: EditableKind, key: string | number): string | null {
  let range: Range | null | undefined;
  if (kind === 'participantLabel') {
    const loc = map.participants.get(String(key));
    range = loc ? (loc.hasAlias ? loc.labelRanges[0] : loc.idRanges[0]) : undefined;
  } else {
    const index = typeof key === 'number' ? key : Number(key);
    range = Number.isInteger(index) ? map.messages.get(index)?.textRange : undefined;
  }
  if (!range) return null;
  const [start, end] = range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > map.code.length) {
    return null;
  }
  return map.code.slice(start, end);
}
