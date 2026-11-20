/**
 * Sequence diagrams: participant labels and message texts, drawn as SVG
 * <text>. The layer copies the text's font through getComputedStyle and its
 * scale through the screen CTM; the anchor is the first line's centre.
 */
import type { AnalyticsProperties } from '@/utils/analytics/types';
import type { EditResult, EditableKind, GetSequenceSourceMap, SequenceSourceMap } from '../types';
import { EDITABLE_KINDS } from '../types';
import { decodeSourceText, encodeDisplayText, isUnchanged, readMessageLines, readParticipantLines, renderParity } from '../codec';
import { KIND_PROPERTY, baseProps, type BeginResult, type Candidate, type InlineEditAdapter, type Point } from './adapter';
import { REJECTION_MESSAGES } from './copy';
import { FOOTER_TAG, elementsOf, isSequenceSvg, resolveTarget, tagRenderedSequence } from './domMapping';

export interface SequenceAdapterDeps {
  getSourceMap: GetSequenceSourceMap;
  renameParticipant: (code: string, map: SequenceSourceMap, actorId: string, newName: string) => EditResult;
  editMessageText: (code: string, map: SequenceSourceMap, messageIndex: number, newText: string) => EditResult;
  sourceTextOf: (map: SequenceSourceMap, kind: EditableKind, key: string | number) => string | null;
}

type Target =
  | { kind: 'messageText'; key: number }
  | { kind: 'participantLabel'; baseId: string; hasAlias: boolean; copy: 'header' | 'footer' };

/**
 * The colour the glyphs of an SVG text are painted with. Read it from the
 * deepest element that paints them: the first <tspan> when there is one, else
 * the <text>. Mermaid's `.actor` rule fills the participant <text> with the box
 * colour (#eee) while its <tspan> is painted dark, so the <text> fill is wrong.
 */
export function glyphColour(text: Element, win: Window = window): string {
  const painter = text.querySelector('tspan') ?? text;
  const cs = win.getComputedStyle(painter);
  return cs.fill && cs.fill !== 'none' ? cs.fill : cs.color;
}

/** The text elements of one copy of a participant label (header: data-id; footer: our tag). */
function participantTexts(root: Element, id: string, copy: 'header' | 'footer'): SVGTextElement[] {
  const group = copy === 'header'
    ? Array.from(root.querySelectorAll('[data-et="participant"]')).find((el) => el.getAttribute('data-id') === id)
    : Array.from(root.querySelectorAll(`[${FOOTER_TAG}]`)).find((el) => el.getAttribute(FOOTER_TAG) === id);
  return group ? (Array.from(group.querySelectorAll('text')) as SVGTextElement[]) : [];
}

function textsOf(root: Element, target: Target, id: string): SVGTextElement[] {
  return target.kind === 'messageText'
    ? (elementsOf(root, { kind: 'messageText', key: target.key }) as SVGTextElement[])
    : participantTexts(root, id, target.copy);
}

function firstLineCentre(texts: Element[]): Point {
  const r = texts[0].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const kindProps = (t: Target): AnalyticsProperties => t.kind === 'messageText'
  ? { ...baseProps('sequence'), inline_edit_kind: KIND_PROPERTY.messageText }
  : { ...baseProps('sequence'), inline_edit_kind: KIND_PROPERTY.participantLabel, inline_edit_had_alias: t.hasAlias };

export function createSequenceAdapter(deps: SequenceAdapterDeps, win: Window): InlineEditAdapter<SequenceSourceMap> {
  const doc = win.document;

  /**
   * Blink lays an HTML line out with integer ascent/descent, so the glyph box
   * sits up to ~1px off the centre of a fractional line box (measured: dy
   * -0.3..-0.9px at zoom 0.875..2). Measure the first line's Range against the
   * SVG text's box and shift by the difference.
   */
  function calibrate(layer: HTMLDivElement, svgRect: DOMRect): void {
    const node = layer.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const data = (node as Text).data;
    const end = data.indexOf('\n') === -1 ? data.length : data.indexOf('\n');
    if (end === 0) return;
    const range = doc.createRange();
    if (typeof range.getBoundingClientRect !== 'function') return;
    range.setStart(node, 0);
    range.setEnd(node, end);
    const r = range.getBoundingClientRect();
    if (!(r.height > 0)) return;
    const dy = svgRect.top + svgRect.height / 2 - (r.top + r.height / 2);
    if (Math.abs(dy) > 0.01 && Math.abs(dy) < 4) layer.style.top = `${parseFloat(layer.style.top) + dy}px`;
  }

  return {
    diagram: 'sequence',
    messages: REJECTION_MESSAGES,
    // Shipped behaviour: every coalesced frame renders.
    slowRenderMs: null,
    unavailableOn: 'render',
    accepts: isSequenceSvg,
    getSourceMap: (code) => deps.getSourceMap(code),
    prepareSvg: tagRenderedSequence,

    hit(eventTarget, svg) {
      const resolved = resolveTarget(eventTarget, svg);
      if (!resolved || !EDITABLE_KINDS.sequence.includes(resolved.kind)) return null;
      return resolved;
    },

    hoverElements(svg, hit) {
      // A message: all its lines. A participant: the copy under the pointer.
      return hit.kind === 'messageText'
        ? elementsOf(svg, { kind: 'messageText', key: hit.key as number })
        : Array.from(hit.anchor.querySelectorAll('text'));
    },

    anchor: firstLineCentre,

    /** Copy font and position from the SVG text lines onto the layer. Styles only, never text. */
    place(layer, elements, host) {
      const texts = elements as SVGTextElement[];
      const first = texts[0];
      const ctm = typeof first.getScreenCTM === 'function' ? first.getScreenCTM() : null;
      const scale = ctm ? Math.hypot(ctm.a, ctm.b) || 1 : 1;
      const cs = win.getComputedStyle(first);
      const ink = glyphColour(first, win);
      const fontSize = parseFloat(cs.fontSize) || 16;
      const rects = texts.map((t) => t.getBoundingClientRect());
      // Line pitch in SVG units: from the drawn lines when there are two, else
      // the single line's box height (Mermaid's own line height is that box, rounded).
      const pitch = rects.length > 1
        ? (rects[1].top + rects[1].height / 2 - (rects[0].top + rects[0].height / 2)) / scale
        : Math.round(rects[0].height / scale) || Math.round(fontSize * 1.2);
      const hostRect = host.getBoundingClientRect();
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const cx = (left + right) / 2 - hostRect.left;
      const cy0 = rects[0].top + rects[0].height / 2 - hostRect.top;
      const st = layer.style;
      st.fontFamily = cs.fontFamily;
      st.fontWeight = cs.fontWeight;
      st.fontStyle = cs.fontStyle;
      st.letterSpacing = cs.letterSpacing;
      st.color = ink;
      st.caretColor = ink;
      st.left = `${cx}px`;
      st.fontSize = `${fontSize * scale}px`;
      st.lineHeight = `${pitch * scale}px`;
      st.top = `${cy0 - (pitch * scale) / 2}px`;
      st.transform = 'translateX(-50%)';
      calibrate(layer, rects[0]);
    },

    begin(hit, map, root, code): BeginResult {
      let target: Target;
      if (hit.kind === 'messageText') {
        target = { kind: 'messageText', key: hit.key as number };
      } else {
        const loc = map.participants.get(hit.key as string);
        if (!loc) return null;
        target = {
          kind: 'participantLabel', baseId: hit.key as string, hasAlias: loc.hasAlias,
          copy: hit.anchor.hasAttribute('data-et') ? 'header' : 'footer',
        };
      }
      const isMessage = target.kind === 'messageText';
      const baseKey = target.kind === 'messageText' ? String(target.key) : target.baseId;
      if (!textsOf(root, target, baseKey).length) return null;
      let source: string | null;
      try {
        source = deps.sourceTextOf(map, target.kind, target.kind === 'messageText' ? target.key : target.baseId);
      } catch {
        source = null;
      }
      const range = target.kind === 'messageText'
        ? map.messages.get(target.key)?.textRange
        : (() => { const loc = map.participants.get(target.baseId); return loc ? (loc.hasAlias ? loc.labelRanges[0] : loc.idRanges[0]) : undefined; })();
      if (source === null || !range) return { reject: 'position_mismatch', props: kindProps(target) };
      const decodeKind = isMessage ? 'messageText' : 'participantLabel';
      // The picture must be exactly what the source decodes to (header copy for
      // participants). Otherwise the element is inert: no layer, no event.
      const drawn = target.kind === 'messageText' ? readMessageLines(root, target.key) : readParticipantLines(root, target.baseId);
      if (!renderParity(source, drawn, decodeKind)) return null;
      const prefill = decodeSourceText(source, decodeKind);
      if (prefill === null) return null;
      const lineStart = code.lastIndexOf('\n', range[0] - 1) + 1;
      const lineBefore = code.slice(lineStart, range[0]);
      const original = source;
      const t = target;

      const evaluate = (text: string): Candidate => {
        if (isUnchanged(original, text, decodeKind)) return { ok: true, code, key: baseKey };
        // The codec reports an empty actor id as invalid_characters; the user's problem is "empty".
        if (t.kind === 'participantLabel' && text.trim() === '') return { ok: false, reason: 'empty' };
        const enc = encodeDisplayText(text, t.kind === 'messageText' ? 'messageText' : t.hasAlias ? 'aliasText' : 'actorId', {
          original, lineBefore, allowEmpty: t.kind === 'messageText',
        });
        if (!enc.ok) return { ok: false, reason: enc.reason };
        let result: EditResult;
        try {
          result = t.kind === 'messageText'
            ? deps.editMessageText(code, map, t.key, enc.source)
            : deps.renameParticipant(code, map, t.baseId, enc.source);
        } catch {
          result = { ok: false, reason: 'position_mismatch' };
        }
        if (!result.ok) return result;
        const key = t.kind === 'participantLabel' && !t.hasAlias ? enc.source.trim() : baseKey;
        return { ok: true, code: result.code, key };
      };

      return {
        open: {
          props: kindProps(target),
          ariaLabel: isMessage ? 'Edit message text' : 'Edit participant name',
          multiline: target.kind === 'messageText' || target.hasAlias,
          prefill,
          baseKey,
          locate: (svg, key) => textsOf(svg, t, key),
          evaluate,
          // The plan is the final source: no gate, synchronous.
          commit: (_text, planned) => ({ ok: true, code: planned }),
        },
      };
    },
  };
}
