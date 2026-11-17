import type { PasteFenceLanguage } from '@/utils/analytics/catalog';

export interface FenceStripResult { text: string; fenced: boolean; language: PasteFenceLanguage }

// Backtick fences only. `~~~` is left alone: it is rare in pasted chat output
// and a tilde line is plausible content in other dialects.
const FENCE_LINE = /^\s*(`{3,})\s*([^`]*)$/;
const CLOSING_FENCE = /^\s*(`{3,})\s*$/;

function languageOf(info: string): PasteFenceLanguage {
  const word = info.trim().split(/\s+/)[0] ?? '';
  const name = word.replace(/^\{(.*)\}$/, '$1').replace(/^\./, '').toLowerCase();
  if (name === '') return 'none';
  if (name === 'mermaid') return 'mermaid';
  if (name === 'plantuml' || name === 'puml') return 'plantuml';
  return 'other';
}

export function stripMarkdownFence(text: string): FenceStripResult {
  const unchanged: FenceStripResult = { text, fenced: false, language: 'none' };
  const lines = text.split(/\r\n|\r|\n/);

  const fenceIndexes: number[] = [];
  lines.forEach((line, i) => {
    if (FENCE_LINE.test(line)) fenceIndexes.push(i);
  });
  if (fenceIndexes.length === 0) return unchanged;

  for (const open of fenceIndexes) {
    const [, ticks, info] = FENCE_LINE.exec(lines[open])!;
    for (let close = open + 1; close < lines.length; close++) {
      const closing = CLOSING_FENCE.exec(lines[close]);
      if (closing && closing[1].length >= ticks.length) {
        return {
          text: lines.slice(open + 1, close).join('\n'),
          fenced: true,
          language: languageOf(info),
        };
      }
    }
  }

  const firstNonBlank = lines.findIndex((l) => l.trim() !== '');
  const lastNonBlank = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim() !== '');
  if (fenceIndexes[0] === firstNonBlank) {
    const [, , info] = FENCE_LINE.exec(lines[firstNonBlank])!;
    return { text: lines.slice(firstNonBlank + 1).join('\n'), fenced: true, language: languageOf(info) };
  }
  if (fenceIndexes.length === 1 && fenceIndexes[0] === lastNonBlank && CLOSING_FENCE.test(lines[lastNonBlank])) {
    return { text: lines.slice(0, lastNonBlank).join('\n'), fenced: true, language: 'none' };
  }
  return unchanged;
}
