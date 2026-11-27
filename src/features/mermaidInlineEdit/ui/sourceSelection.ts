import type { EditableKind, Range, SourceMap } from '../types';

import type { MermaidSourceRange } from './surface';

export interface SourceLabel {
  range: Range;
  kind: EditableKind;
  key: string | number;
  /** Exact rendered node key, as opposed to the vertex id used in the source. */
  domId?: string;
}

/** Match the smallest containing source range. Ties across targets are ambiguous. */
export function matchSourceLabel(map: SourceMap, { code, from, to }: MermaidSourceRange): SourceLabel | null {
  if (map.code !== code || !Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to > code.length || from > to
    || /[\r\n]/.test(code.slice(from, to))) return null;

  const caret = from === to;
  let match: SourceLabel | null = null;
  let shortest = Infinity;
  let ambiguous = false;
  const consider = (range: Range | null, label: Omit<SourceLabel, 'range'>) => {
    if (!range || range[0] >= range[1] || range[0] < 0 || range[1] > code.length
      || from < range[0] || to > range[1]) return;
    const text = code.slice(...range);
    if (!text.trim() || /[\r\n]/.test(text) || text.length > shortest) return;
    if (text.length < shortest || !match) {
      shortest = text.length;
      ambiguous = false;
      match = { ...label, range };
    } else if (match.kind !== label.kind || match.key !== label.key) {
      ambiguous = true;
    }
  };

  if (map.kind === 'flowchart') {
    for (const [key, node] of map.nodes) {
      if (node.readOnly) continue;
      const label = { kind: 'nodeLabel' as const, key, domId: node.domId };
      if (caret) {
        for (const range of node.idRanges) consider(range, label);
      }
      const end = node.insertAt;
      const bareIdRange: Range | null = end !== null && code.slice(end - key.length, end) === key
        ? [end - key.length, end] : null;
      consider(node.labelRange ?? bareIdRange, label);
    }
    for (const [key, edge] of map.edges) {
      if (!edge.readOnly) consider(edge.textRange, { kind: 'edgeLabel', key });
    }
  } else {
    for (const [key, participant] of map.participants) {
      for (const range of participant.labelRanges) consider(range, { kind: 'participantLabel', key });
      if (caret) {
        for (const range of participant.idRanges) consider(range, { kind: 'participantLabel', key });
      }
    }
    for (const [key, message] of map.messages) consider(message.textRange, { kind: 'messageText', key });
  }
  return ambiguous ? null : match;
}

/** Keep the old ring while rendering only when the exact source outside this label is unchanged. */
export function isTypingInSourceLabel(base: string, range: Range, selection: MermaidSourceRange): boolean {
  const { code, from, to, typing } = selection;
  const [start, end] = range;
  const nextEnd = end + code.length - base.length;
  return typing && start <= from && from <= to && to <= nextEnd && nextEnd > start
    && code.startsWith(base.slice(0, start)) && code.endsWith(base.slice(end))
    && !/[\r\n]/.test(code.slice(start, nextEnd));
}
