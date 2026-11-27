/** Test-only: renders real Mermaid in jsdom and reads the drawn lines back. */
import mermaid from 'mermaid';
import { tagRenderedSequence } from '../ui/domMapping';
import { readMessageLines, readParticipantLines } from './parity';

/**
 * jsdom has no layout. Text width is proportional to its length (8px a
 * character) so that `wrap:` text really wraps, like it does in a browser.
 */
export function stubLayout(): void {
  const proto = (globalThis as any).SVGElement.prototype;
  proto.getBBox = function () {
    const length = (this.textContent || '').length;
    return { x: 0, y: 0, width: 8 * length, height: 16 };
  };
  proto.getComputedTextLength = function () {
    return 8 * (this.textContent || '').length;
  };
}

let initialised = false;
let counter = 0;

/** Renders with the default strict security level, as the product does. */
export async function renderDiagram(code: string): Promise<{ svg: string; root: HTMLElement }> {
  if (!initialised) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    initialised = true;
  }
  const { svg } = await mermaid.render(`codec-${counter++}`, code);
  const root = document.createElement('div');
  root.innerHTML = svg; // the HTML parser, like the product's v-html
  const element = root.querySelector('svg');
  if (element) tagRenderedSequence(element);
  return { svg, root };
}

export async function renderedMessageLines(code: string, index = 0): Promise<string[]> {
  const { root } = await renderDiagram(code);
  return readMessageLines(root, index);
}

export async function renderedParticipantLines(code: string, id: string): Promise<string[]> {
  const { root } = await renderDiagram(code);
  return readParticipantLines(root, id);
}
