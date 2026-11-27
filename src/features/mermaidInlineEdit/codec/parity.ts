import { analyseSourceText, decodeSourceText, type DecodeFailure, type DecodeKind } from './decode';
import { ZWSP } from './mermaidText';

/**
 * Attribute the interaction layer puts on the `text.messageText` elements of a
 * message (ui/domMapping.ts `MESSAGE_TAG`; a test keeps the two equal).
 */
export const MESSAGE_LINES_ATTRIBUTE = 'data-seq-for';

/**
 * Normalisation of a drawn line: only the ZWSP that drawText writes for an
 * empty line (`line || ZERO_WIDTH_SPACE`) becomes ''. Nothing else is touched:
 * NBSP, leading/trailing spaces and other ZWSPs stay as drawn, so a
 * difference there makes parity false instead of being hidden.
 */
export const normaliseRenderedLine = (line: string): string => (line === ZWSP ? '' : line);

/** The drawn lines of message `index` (db `messages` index): the run tagged `data-seq-for="i<index>"`, in drawing order. */
export function readMessageLines(root: Pick<Element, 'querySelectorAll'>, index: number): string[] {
  const tag = `i${index}`;
  return Array.from(root.querySelectorAll(`[${MESSAGE_LINES_ATTRIBUTE}]`))
    .filter((el) => el.getAttribute(MESSAGE_LINES_ATTRIBUTE) === tag)
    .map((el) => normaliseRenderedLine(el.textContent ?? ''));
}

/**
 * The drawn lines of a participant's header box: every `text` inside
 * `[data-et="participant"][data-id=<id>]`, in drawing order (one per line of
 * the label). Empty when the header is not found.
 */
export function readParticipantLines(root: Pick<Element, 'querySelectorAll'>, id: string): string[] {
  const header = Array.from(root.querySelectorAll('[data-et="participant"]')).find((el) => el.getAttribute('data-id') === id);
  if (!header) return [];
  return Array.from(header.querySelectorAll('text')).map((el) => normaliseRenderedLine(el.textContent ?? ''));
}

export type ParityResult = { ok: true } | { ok: false; reason: DecodeFailure | 'lines_differ' | 'no_rendered_lines' };

/** `renderParity` with the reason for false. */
export function checkRenderParity(source: string, renderedLines: readonly string[], kind: DecodeKind = 'messageText'): ParityResult {
  const decoded = analyseSourceText(source, kind);
  if (!decoded.ok) return decoded;
  if (renderedLines.length === 0) return { ok: false, reason: 'no_rendered_lines' };
  const expected = decoded.text.split('\n');
  const actual = renderedLines.map(normaliseRenderedLine);
  const same = expected.length === actual.length && expected.every((line, i) => line === actual[i]);
  return same ? { ok: true } : { ok: false, reason: 'lines_differ' };
}

/**
 * The safety gate: an element is editable WYSIWYG only when this is true.
 * True when what the source decodes to, split into lines, equals the drawn
 * lines exactly (after `normaliseRenderedLine`). False for everything else:
 * `wrap:` text that Mermaid wrapped, KaTeX (no `text.messageText` is drawn),
 * text Mermaid rewrites or deletes (tag attribute quotes, `%%{..}%%`), entities
 * the codec does not know, and any other difference between picture and source.
 */
export function renderParity(source: string, renderedLines: readonly string[], kind: DecodeKind = 'messageText'): boolean {
  return checkRenderParity(source, renderedLines, kind).ok;
}

/**
 * True when the user's display text is exactly what the original source
 * already shows. Then the caller must not write anything: no `<br>` ->
 * `<br/>` change, no entity re-encoding of untouched text.
 */
export function isUnchanged(originalSource: string, display: string, kind: DecodeKind = 'messageText'): boolean {
  const decoded = decodeSourceText(originalSource, kind);
  return decoded !== null && decoded === display.replace(/\r\n?/g, '\n');
}
