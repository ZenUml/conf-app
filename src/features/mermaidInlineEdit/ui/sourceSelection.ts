import type { EditableKind, Range, SourceMap } from '../types';

import type { MermaidSourceSelection as SourceSelection } from './surface';

export interface SourceLabel {
  range: Range;
  kind: EditableKind;
  key: string | number;
  /** Exact rendered node key, as opposed to the vertex id used in the source. */
  domId?: string;
}

/** Match offsets, never text. An overlapping or repeated candidate is uncertain. */
export function matchSourceLabel(map: SourceMap, { code, from, to, typing }: SourceSelection): SourceLabel | null {
  if (map.code !== code || !Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to > code.length || from > to || (!typing && from === to)
    || /[\r\n]/.test(code.slice(from, to))) return null;

  let match: SourceLabel | null = null;
  let ambiguous = false;
  const consider = (range: Range | null, label: Omit<SourceLabel, 'range'>) => {
    if (!range || range[0] >= range[1] || range[0] < 0 || range[1] > code.length
      || from < range[0] || to > range[1]
      || !code.slice(...range).trim() || /[\r\n]/.test(code.slice(...range))) return;
    if (match && (match.kind !== label.kind || match.key !== label.key)) ambiguous = true;
    match = { ...label, range };
  };

  if (map.kind === 'flowchart') {
    for (const [key, node] of map.nodes) {
      if (node.readOnly) continue;
      const end = node.insertAt;
      const bareIdRange: Range | null = end !== null && code.slice(end - key.length, end) === key
        ? [end - key.length, end] : null;
      consider(node.labelRange ?? bareIdRange, { kind: 'nodeLabel', key, domId: node.domId });
    }
    for (const [key, edge] of map.edges) {
      if (!edge.readOnly) consider(edge.textRange, { kind: 'edgeLabel', key });
    }
  } else {
    for (const [key, participant] of map.participants) {
      for (const range of participant.labelRanges) consider(range, { kind: 'participantLabel', key });
    }
    for (const [key, message] of map.messages) consider(message.textRange, { kind: 'messageText', key });
  }
  return ambiguous ? null : match;
}

/** Keep the old ring while rendering only when the exact source outside this label is unchanged. */
export function isTypingInSourceLabel(base: string, range: Range, selection: SourceSelection): boolean {
  const { code, from, to, typing } = selection;
  const [start, end] = range;
  const nextEnd = end + code.length - base.length;
  return typing && start <= from && from <= to && to <= nextEnd && nextEnd >= start
    && code.startsWith(base.slice(0, start)) && code.endsWith(base.slice(end))
    && !/[\r\n]/.test(code.slice(start, nextEnd));
}
