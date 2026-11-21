/**
 * Map rendered Mermaid sequence-diagram elements to source-map keys, by exact
 * attributes only. Never by text content: two messages "Hello" are two
 * different messages.
 *
 * Measured on Mermaid 11.17.2 (chunk sequenceDiagram-WJ2MYXX4.mjs, real render
 * in Chromium through mermaid.render with the default strict security level,
 * so the output has been through DOMPurify; fixture __fixtures__/sequence-11.17.2.svg):
 *
 * - Header participant: `g[data-et="participant"][data-id=<actor id>]`.
 * - Footer (mirror) participant: no data-et / data-id. Its box is
 *   `.actor-bottom[name=<actor id>]`: a `rect` inside an unclassed `g` for the
 *   plain participant, or the `g.actor-man` itself for `actor`. Typed boxes such
 *   as `@{ "type": "database" }` draw `g.actor-bottom` with no `name`, so they
 *   cannot be mapped and stay inert.
 * - Message: `line|path[data-et="message"][data-id="i<N>"]`. drawMessage first
 *   appends one `text.messageText` per line of the label (split on `<br>`,
 *   including the lines that `wrap:` produced) to the same parent, then the
 *   line. So the label is exactly the contiguous run of `text.messageText`
 *   previous siblings of the line. The elements before that run belong to the
 *   previous message (its line, sequence number or central connection) or to
 *   other drawing, never to a messageText of another message. An empty label
 *   is one `text.messageText` holding U+200B.
 * - KaTeX label (`$$...$$`): a `foreignObject` with no class, so the run is
 *   empty and the message is left untagged (inert).
 */

export const MESSAGE_TAG = 'data-seq-for';
export const FOOTER_TAG = 'data-seq-participant-for';

export type InlineEditTarget =
  | { kind: 'participantLabel'; key: string }
  | { kind: 'messageText'; key: number };

const MESSAGE_ID = /^i(\d+)$/;

export function isSequenceSvg(svg: Element | null | undefined): svg is SVGSVGElement {
  return !!svg && svg.getAttribute('aria-roledescription') === 'sequence';
}

function headerParticipants(svg: Element, id: string): Element[] {
  return Array.from(svg.querySelectorAll('[data-et="participant"]'))
    .filter((el) => el.getAttribute('data-id') === id);
}

/** Remove our tags (they live on the rendered DOM only) and tag again. */
export function tagRenderedSequence(svg: Element): void {
  for (const el of Array.from(svg.querySelectorAll(`[${MESSAGE_TAG}]`))) el.removeAttribute(MESSAGE_TAG);
  for (const el of Array.from(svg.querySelectorAll(`[${FOOTER_TAG}]`))) el.removeAttribute(FOOTER_TAG);

  for (const line of Array.from(svg.querySelectorAll('[data-et="message"]'))) {
    const match = MESSAGE_ID.exec(line.getAttribute('data-id') || '');
    if (!match) continue;
    const run: Element[] = [];
    let node = line.previousElementSibling;
    while (node && node.tagName.toLowerCase() === 'text' && node.classList.contains('messageText')) {
      run.push(node);
      node = node.previousElementSibling;
    }
    for (const text of run) text.setAttribute(MESSAGE_TAG, `i${match[1]}`);
  }

  for (const box of Array.from(svg.querySelectorAll('.actor-bottom[name]'))) {
    const name = box.getAttribute('name');
    if (!name || headerParticipants(svg, name).length !== 1) continue;
    const group = box.tagName.toLowerCase() === 'g' ? box : box.parentElement;
    if (!group || group === svg || group.tagName.toLowerCase() !== 'g') continue;
    // The group must hold this one footer box and nothing that is itself mapped.
    if (group.querySelectorAll('.actor-bottom[name]').length !== (group === box ? 0 : 1)) continue;
    if (group.closest('[data-et]')) continue;
    group.setAttribute(FOOTER_TAG, name);
  }
}

/** A target plus the element the pointer was on (header or footer copy). */
export type ResolvedTarget = InlineEditTarget & { anchor: Element };

/** The editable element a double-click landed on, or null. */
export function resolveTarget(eventTarget: EventTarget | null, svg: Element): ResolvedTarget | null {
  if (!(eventTarget instanceof Element) || !svg.contains(eventTarget)) return null;
  const message = eventTarget.closest(`[${MESSAGE_TAG}]`);
  if (message && svg.contains(message)) {
    const match = MESSAGE_ID.exec(message.getAttribute(MESSAGE_TAG) || '');
    return match ? { kind: 'messageText', key: Number(match[1]), anchor: message } : null;
  }
  const header = eventTarget.closest('[data-et="participant"]');
  if (header && svg.contains(header)) {
    const id = header.getAttribute('data-id');
    return id ? { kind: 'participantLabel', key: id, anchor: header } : null;
  }
  const footer = eventTarget.closest(`[${FOOTER_TAG}]`);
  if (footer && svg.contains(footer)) {
    const id = footer.getAttribute(FOOTER_TAG);
    return id ? { kind: 'participantLabel', key: id, anchor: footer } : null;
  }
  return null;
}

/** Every rendered element of a target, by exact attribute. */
export function elementsOf(svg: Element, target: InlineEditTarget): Element[] {
  if (target.kind === 'messageText') {
    const tag = `i${target.key}`;
    return Array.from(svg.querySelectorAll(`[${MESSAGE_TAG}]`)).filter((el) => el.getAttribute(MESSAGE_TAG) === tag);
  }
  const footers = Array.from(svg.querySelectorAll(`[${FOOTER_TAG}]`))
    .filter((el) => el.getAttribute(FOOTER_TAG) === target.key);
  return [...headerParticipants(svg, target.key), ...footers];
}
