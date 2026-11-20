import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import realSvg from './__fixtures__/sequence-11.17.2.svg?raw';
import { attachInlineEdit, __resetInlineEditSessionForTests, type InlineEditDeps } from './controller';
import { MESSAGE_TAG, FOOTER_TAG, tagRenderedSequence, resolveTarget } from './domMapping';
import { REJECTION_MESSAGES } from './copy';
import type { EditResult, SequenceSourceMap } from '../types';
import { sampleRateFor } from '@/utils/analytics/eventSampling';

// Real Mermaid 11.17.2 output (rendered in Chromium through mermaid.render,
// strict security level, so after DOMPurify) of __fixtures__/sequence-11.17.2.mmd:
//   participant A as Alice / actor B as Bob / participant D@{database}
//   i0 A->>B: Hello<br/>two lines   i1 A->>D: $$x^2$$ (KaTeX)
//   i2 Note   i3 B->>A: wrap:...long...   i4 A->>A: Same   i5 A->>A: Same
const CODE_A = 'sequenceDiagram\n  participant A as Alice\n  A->>B: Hello<br/>two lines\n';
const CODE_B = CODE_A + '  B->>A: more\n';

function fakeMap(code: string, overrides: Partial<SequenceSourceMap> = {}): SequenceSourceMap {
  return {
    code,
    participants: new Map([
      ['A', { labelRanges: [[0, 5]], idRanges: [[0, 1]], hasAlias: true }],
      ['B', { labelRanges: [[0, 1]], idRanges: [[0, 1]], hasAlias: false }],
    ]),
    messages: new Map([[0, { textRange: [0, 1] }], [3, { textRange: [0, 1] }], [4, { textRange: [0, 1] }], [5, { textRange: [0, 1] }]]),
    notes: new Map(),
    ...overrides,
  };
}

const SOURCE_TEXT: Record<string, string> = {
  'participantLabel:A': 'Alice',
  'participantLabel:B': 'B',
  'messageText:0': 'Hello<br/>two lines',
  'messageText:3': 'wrap-free source text',
  'messageText:4': 'Same',
  'messageText:5': 'Same',
};

interface Harness {
  container: HTMLElement;
  deps: InlineEditDeps & { [K in 'track' | 'toast' | 'writeCode' | 'renameParticipant' | 'editMessageText' | 'getSourceMap' | 'sourceTextOf' | 'isEnabled']: ReturnType<typeof vi.fn> };
  store: { code: string };
  controller: ReturnType<typeof attachInlineEdit>;
  flush: () => Promise<void>;
}

function setup(opts: { enabled?: boolean; map?: (code: string) => SequenceSourceMap | null | Promise<SequenceSourceMap | null>; code?: string } = {}): Harness {
  const store = { code: opts.code ?? CODE_A };
  const container = document.createElement('div');
  container.innerHTML = `<div class="diagram-viewport"><button><svg viewBox="0 0 1 1"></svg></button><div class="diagram-viewport-content">${realSvg}</div></div>`;
  document.body.appendChild(container);
  const deps = {
    getSourceMap: vi.fn(async (code: string) => (opts.map ? opts.map(code) : fakeMap(code))),
    renameParticipant: vi.fn((code: string, _map, id: string, name: string): EditResult => ({ ok: true, code: `${code}%rename ${id}=${name}` })),
    editMessageText: vi.fn((code: string, _map, i: number, text: string): EditResult => ({ ok: true, code: `${code}%msg ${i}=${text}` })),
    sourceTextOf: vi.fn((_map, kind: string, key: string | number) => SOURCE_TEXT[`${kind}:${key}`] ?? null),
    getCode: () => store.code,
    writeCode: vi.fn((code: string) => { store.code = code; }),
    isEnabled: vi.fn(async () => opts.enabled ?? true),
    track: vi.fn(),
    toast: vi.fn(),
    now: () => 1000,
  };
  const controller = attachInlineEdit(container, deps as unknown as InlineEditDeps);
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { container, deps: deps as any, store, controller, flush };
}

const svgOf = (h: Harness) => h.container.querySelector('svg[aria-roledescription]') as SVGSVGElement;
const participant = (h: Harness, id: string) =>
  Array.from(svgOf(h).querySelectorAll('[data-et="participant"]')).find((el) => el.getAttribute('data-id') === id)!;
const messageTexts = (h: Harness, i: number) =>
  Array.from(svgOf(h).querySelectorAll(`[${MESSAGE_TAG}]`)).filter((el) => el.getAttribute(MESSAGE_TAG) === `i${i}`);
const input = () => document.querySelector('[data-testid="mermaid-inline-edit-input"]') as HTMLInputElement | null;
const dblclick = (el: Element) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const events = (h: Harness, name: string) => h.deps.track.mock.calls.filter(([n]) => n === name).map(([, p]) => p);

async function rendered(h: Harness, code = h.store.code) {
  h.controller.onRendered(code);
  await h.flush();
}

beforeEach(() => {
  __resetInlineEditSessionForTests();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('DOM mapping on a real Mermaid 11.17.2 render', () => {
  it('keeps data-et/data-id through mermaid.render (DOMPurify)', () => {
    const doc = new DOMParser().parseFromString(realSvg, 'image/svg+xml');
    const ids = Array.from(doc.querySelectorAll('[data-et="participant"]')).map((e) => e.getAttribute('data-id')).sort();
    expect(ids).toEqual(['A', 'B', 'D']);
    expect(Array.from(doc.querySelectorAll('[data-et="message"]')).map((e) => e.getAttribute('data-id')))
      .toEqual(['i0', 'i1', 'i3', 'i4', 'i5']);
  });

  it('tags every line of a multi-line and a wrapped message, and never a KaTeX label', () => {
    const div = document.createElement('div');
    div.innerHTML = realSvg;
    const svg = div.querySelector('svg')!;
    tagRenderedSequence(svg);
    const tagged = (i: number) => Array.from(svg.querySelectorAll(`[${MESSAGE_TAG}="i${i}"]`)).map((e) => e.textContent);
    expect(tagged(0)).toEqual(['Hello', 'two lines']);
    expect(tagged(1)).toEqual([]); // $$x^2$$ is a foreignObject
    expect(tagged(3).length).toBe(3); // wrap: produced three text lines
    expect(tagged(4)).toEqual(['Same']);
    expect(tagged(5)).toEqual(['Same']);
    // Two identical messages: different elements, different tags.
    expect(svg.querySelector(`[${MESSAGE_TAG}="i4"]`)).not.toBe(svg.querySelector(`[${MESSAGE_TAG}="i5"]`));
  });

  it('maps footer copies by their exact name attribute; the typed database footer stays inert', () => {
    const div = document.createElement('div');
    div.innerHTML = realSvg;
    const svg = div.querySelector('svg')!;
    tagRenderedSequence(svg);
    const footers = Array.from(svg.querySelectorAll(`[${FOOTER_TAG}]`)).map((e) => e.getAttribute(FOOTER_TAG)).sort();
    expect(footers).toEqual(['A', 'B']);
    const footerA = svg.querySelector(`[${FOOTER_TAG}="A"] text`)!;
    expect(resolveTarget(footerA, svg)).toMatchObject({ kind: 'participantLabel', key: 'A' });
    const dbFooter = svg.querySelector('g.actor-bottom:not([name])')!;
    expect(resolveTarget(dbFooter, svg)).toBeNull();
  });

  it('tagging twice does not double-tag', () => {
    const div = document.createElement('div');
    div.innerHTML = realSvg;
    const svg = div.querySelector('svg')!;
    tagRenderedSequence(svg);
    tagRenderedSequence(svg);
    expect(svg.querySelectorAll(`[${MESSAGE_TAG}="i0"]`).length).toBe(2);
  });
});

describe('attachInlineEdit', () => {
  it('opens the box prefilled with the SOURCE text and selects it', async () => {
    const h = setup();
    await rendered(h);
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
    dblclick(messageTexts(h, 0)[1]);
    expect(input()!.value).toBe('Hello<br/>two lines');
    expect(input()!.selectionStart).toBe(0);
    expect(input()!.selectionEnd).toBe('Hello<br/>two lines'.length);
    expect(document.activeElement).toBe(input());
    expect(events(h, 'editor_inline_edit_started')).toEqual([
      { feature_area: 'macro', surface: 'editor', macro_type: 'mermaid', inline_edit_kind: 'message_text' },
    ]);
  });

  it('participant: prefill is the alias, Enter commits through renameParticipant and the store write', async () => {
    const h = setup();
    await rendered(h);
    dblclick(participant(h, 'A').querySelector('text')!);
    expect(input()!.value).toBe('Alice');
    input()!.value = 'Alicia';
    key(input()!, 'Enter');
    expect(input()).toBeNull();
    expect(h.deps.renameParticipant).toHaveBeenCalledWith(CODE_A, expect.objectContaining({ code: CODE_A }), 'A', 'Alicia');
    expect(h.deps.writeCode).toHaveBeenCalledWith(`${CODE_A}%rename A=Alicia`);
    expect(h.deps.toast).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_succeeded')).toEqual([{
      feature_area: 'macro', surface: 'editor', macro_type: 'mermaid',
      inline_edit_kind: 'participant_label', inline_edit_had_alias: true, inline_edit_ms_open: 0,
    }]);
  });

  it('double-click on the footer copy edits the same participant', async () => {
    const h = setup();
    await rendered(h);
    dblclick(svgOf(h).querySelector(`[${FOOTER_TAG}="B"]`)!);
    expect(input()!.value).toBe('B');
  });

  it('blur commits; the two identical messages edit by their own index', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 5)[0]);
    input()!.value = 'Second';
    input()!.blur();
    expect(h.deps.editMessageText).toHaveBeenCalledWith(CODE_A, expect.anything(), 5, 'Second');
    expect(input()).toBeNull();
  });

  it('Enter then the blur caused by closing commits once', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 4)[0]);
    input()!.value = 'Changed';
    key(input()!, 'Enter');
    expect(h.deps.writeCode).toHaveBeenCalledTimes(1);
  });

  it('Esc cancels without a write and without reaching an editor-level Escape handler', async () => {
    const h = setup();
    await rendered(h);
    const documentEsc = vi.fn();
    const bubbleEsc = vi.fn();
    document.addEventListener('keydown', documentEsc, true); // like GenericViewer.onEscapeKeydown
    h.container.addEventListener('keydown', bubbleEsc);
    try {
      dblclick(messageTexts(h, 0)[0]);
      input()!.value = 'typed but cancelled';
      key(input()!, 'Escape');
      expect(input()).toBeNull();
      expect(documentEsc).not.toHaveBeenCalled();
      expect(bubbleEsc).not.toHaveBeenCalled();
      expect(h.deps.writeCode).not.toHaveBeenCalled();
      expect(events(h, 'editor_inline_edit_cancelled')).toEqual([expect.objectContaining({
        inline_edit_kind: 'message_text', inline_edit_cancel_reason: 'escape', inline_edit_ms_open: 0,
      })]);
    } finally {
      document.removeEventListener('keydown', documentEsc, true);
    }
  });

  it('typing, keyup and paste in the box do not reach document listeners', async () => {
    const h = setup();
    await rendered(h);
    const seen = vi.fn();
    for (const t of ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut']) document.addEventListener(t, seen, true);
    dblclick(messageTexts(h, 0)[0]);
    const box = input()!;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    box.dispatchEvent(new Event('paste', { bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
    // Keys elsewhere are untouched.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(seen).toHaveBeenCalledTimes(1);
    for (const t of ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut']) document.removeEventListener(t, seen, true);
  });

  it('pointer and wheel events on the box do not reach the viewport', async () => {
    const h = setup();
    await rendered(h);
    const wheel = vi.fn();
    h.container.addEventListener('wheel', wheel);
    document.body.addEventListener('pointerdown', wheel);
    dblclick(messageTexts(h, 0)[0]);
    input()!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    input()!.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(wheel).not.toHaveBeenCalled();
  });

  it('unchanged text closes with no write, no toast, cancelled "unchanged"', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 0)[0]);
    key(input()!, 'Enter');
    expect(h.deps.editMessageText).not.toHaveBeenCalled();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.toast).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_cancelled')[0]).toMatchObject({ inline_edit_cancel_reason: 'unchanged' });
  });

  it('an edit that leaves the source unchanged (trimmed whitespace) writes nothing and is "unchanged"', async () => {
    const h = setup();
    await rendered(h);
    h.deps.editMessageText.mockImplementation((code: string): EditResult => ({ ok: true, code }));
    dblclick(messageTexts(h, 0)[0]);
    input()!.value += ' ';
    key(input()!, 'Enter');
    expect(h.deps.editMessageText).toHaveBeenCalled();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.toast).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_succeeded')).toHaveLength(0);
    expect(events(h, 'editor_inline_edit_cancelled')[0]).toMatchObject({ inline_edit_cancel_reason: 'unchanged' });
  });

  it.each(['name_exists', 'invalid_characters', 'empty', 'position_mismatch', 'stale_source'] as const)(
    'rejection %s closes the box and shows its toast',
    async (reason) => {
      const h = setup();
      await rendered(h);
      h.deps.renameParticipant.mockReturnValue({ ok: false, reason });
      dblclick(participant(h, 'B'));
      input()!.value = 'Other';
      key(input()!, 'Enter');
      expect(input()).toBeNull();
      expect(h.deps.writeCode).not.toHaveBeenCalled();
      expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES[reason]);
      expect(events(h, 'editor_inline_edit_rejected')).toEqual([{
        feature_area: 'macro', surface: 'editor', macro_type: 'mermaid',
        inline_edit_kind: 'participant_label', inline_edit_had_alias: false,
        inline_edit_rejection: reason, inline_edit_ms_open: 0,
      }]);
    },
  );

  it('a throwing edit function is reported as position_mismatch, never silently', async () => {
    const h = setup();
    await rendered(h);
    h.deps.editMessageText.mockImplementation(() => { throw new Error('boom'); });
    dblclick(messageTexts(h, 0)[0]);
    input()!.value = 'x';
    key(input()!, 'Enter');
    expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES.position_mismatch);
  });

  it('no source text for the target: toast, no box', async () => {
    const h = setup();
    await rendered(h);
    h.deps.sourceTextOf.mockReturnValue(null);
    dblclick(messageTexts(h, 0)[0]);
    expect(input()).toBeNull();
    expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES.position_mismatch);
  });

  it('code changing while the box is open closes it with the stale toast and no write', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 0)[0]);
    input()!.value = 'mine';
    h.store.code = CODE_B; // typed in CodeMirror / AI apply
    h.controller.onCodeChanged(CODE_B);
    expect(input()).toBeNull();
    expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES.stale_source);
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_rejected')[0]).toMatchObject({ inline_edit_rejection: 'stale_source' });
  });

  it('commit re-checks the store: code that moved on without a notification is stale', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 0)[0]);
    input()!.value = 'mine';
    h.store.code = CODE_B;
    key(input()!, 'Enter');
    expect(h.deps.editMessageText).not.toHaveBeenCalled();
    expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES.stale_source);
  });

  it('three-way check: a map for code B while the DOM still shows the render of code A stays inert', async () => {
    let resolveMap!: (m: SequenceSourceMap) => void;
    const h = setup({ map: () => new Promise((r) => { resolveMap = r; }) });
    h.controller.onRendered(CODE_A); // DOM shows A
    await h.flush();
    h.store.code = CODE_B; // store moved on, render of B not done yet
    h.controller.onCodeChanged(CODE_B);
    resolveMap(fakeMap(CODE_B));
    await h.flush();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    dblclick(messageTexts(h, 0)[0]);
    expect(input()).toBeNull();
  });

  it('three-way check: a slow map for A that resolves after the render of B is dropped', async () => {
    const resolvers: Array<(m: SequenceSourceMap) => void> = [];
    const h = setup({ map: () => new Promise((r) => { resolvers.push(r); }) });
    h.controller.onRendered(CODE_A);
    await h.flush();
    h.store.code = CODE_B;
    h.controller.onCodeChanged(CODE_B);
    h.controller.onRendered(CODE_B);
    await h.flush();
    resolvers[0](fakeMap(CODE_A));
    await h.flush();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    resolvers[1](fakeMap(CODE_B));
    await h.flush();
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
  });

  it('a map whose code differs from the rendered string is never used', async () => {
    const h = setup({ map: () => fakeMap('something else') });
    await rendered(h);
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    dblclick(messageTexts(h, 0)[0]);
    expect(input()).toBeNull();
    expect(events(h, 'editor_inline_edit_unavailable')).toEqual([]);
  });

  it('null map: inert, no toast on double-click, unavailable once per session', async () => {
    const h = setup({ map: () => null });
    await rendered(h);
    await rendered(h);
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    dblclick(participant(h, 'A'));
    expect(input()).toBeNull();
    expect(h.deps.toast).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_unavailable')).toEqual([{ feature_area: 'macro', surface: 'editor', macro_type: 'mermaid' }]);
    h.controller.destroy();
    const again = setup({ map: () => null });
    await rendered(again);
    expect(events(again, 'editor_inline_edit_unavailable')).toEqual([]);
  });

  it('flag off: no map request, no affordance, no box, no event', async () => {
    const h = setup({ enabled: false });
    await rendered(h);
    expect(h.deps.getSourceMap).not.toHaveBeenCalled();
    dblclick(participant(h, 'A'));
    expect(input()).toBeNull();
    expect(h.deps.track).not.toHaveBeenCalled();
    expect(svgOf(h).querySelector(`[${MESSAGE_TAG}]`)).toBeNull();
  });

  it('flag resolving after the first render still enables the diagram on screen', async () => {
    let resolveFlag!: (v: boolean) => void;
    const h = setup();
    h.deps.isEnabled.mockImplementation(() => new Promise((r) => { resolveFlag = r; }));
    // Re-attach with the slow flag.
    h.controller.destroy();
    const controller = attachInlineEdit(h.container, h.deps as unknown as InlineEditDeps);
    controller.onRendered(CODE_A);
    await h.flush();
    expect(h.deps.getSourceMap).not.toHaveBeenCalled();
    resolveFlag(true);
    await h.flush();
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
  });

  it('not a sequence diagram: no map request at all', async () => {
    const h = setup();
    svgOf(h).setAttribute('aria-roledescription', 'flowchart-v2');
    await rendered(h);
    expect(h.deps.getSourceMap).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_unavailable')).toEqual([]);
  });

  it('source with U+00A0 (renderer normalises it) is read-only, with no event', async () => {
    const nbsp = 'sequenceDiagram\n  A->>B: hi\n';
    const h = setup({ code: nbsp });
    await rendered(h, nbsp);
    expect(h.deps.getSourceMap).not.toHaveBeenCalled();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    expect(h.deps.track).not.toHaveBeenCalled();
  });

  it('only one box at a time', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 0)[0]);
    dblclick(participant(h, 'A'));
    expect(document.querySelectorAll('[data-testid="mermaid-inline-edit-input"]').length).toBe(1);
    expect(input()!.value).toBe('Hello<br/>two lines');
  });

  it('suspend (export capture) closes the box and removes the affordance', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 0)[0]);
    h.controller.setSuspended(true);
    expect(input()).toBeNull();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    h.controller.setSuspended(false);
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
  });

  it('a re-render of the same code closes an open box without a write or toast', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 0)[0]);
    input()!.value = 'x';
    await rendered(h);
    expect(input()).toBeNull();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.toast).not.toHaveBeenCalled();
  });

  it('positions the box over the target from getBoundingClientRect', async () => {
    const h = setup();
    await rendered(h);
    const target = participant(h, 'A');
    target.getBoundingClientRect = () => ({ left: 100, top: 50, right: 250, bottom: 80, width: 150, height: 30, x: 100, y: 50, toJSON() {} }) as DOMRect;
    dblclick(target);
    const box = input()!;
    expect(box.style.width).toBe('174px');
    expect(box.style.left).toBe(`${Math.round(175 - 87)}px`);
    expect(box.style.top).toBe(`${Math.round(65 - 14)}px`);
  });

  it('sizes the box to the source text when it is longer than the element, and grows while typing', async () => {
    const h = setup();
    await rendered(h);
    dblclick(messageTexts(h, 0)[0]); // jsdom rects are 0 wide
    expect(input()!.style.width).toBe(`${'Hello<br/>two lines'.length * 8 + 24}px`);
    input()!.value = 'x'.repeat(30);
    input()!.dispatchEvent(new Event('input'));
    expect(input()!.style.width).toBe(`${30 * 8 + 24}px`);
  });

  describe('highlight after a successful edit', () => {
    it('flashes the message with the same index after the re-render, then clears it', async () => {
      vi.useFakeTimers();
      const h = setup();
      h.controller.onRendered(CODE_A);
      await h.flush();
      dblclick(messageTexts(h, 4)[0]);
      input()!.value = 'Changed';
      key(input()!, 'Enter');
      h.controller.onCodeChanged(h.store.code);
      h.controller.onRendered(h.store.code); // the DOM fixture stands in for the new render
      expect(messageTexts(h, 4)[0].classList.contains('mie-flash')).toBe(true);
      expect(messageTexts(h, 5)[0].classList.contains('mie-flash')).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(messageTexts(h, 4)[0].classList.contains('mie-flash')).toBe(false);
    });

    it('participant without alias is found under its new id; nothing when the id is absent', async () => {
      const h = setup();
      await rendered(h);
      dblclick(participant(h, 'B'));
      input()!.value = 'Bob2';
      key(input()!, 'Enter');
      // Simulate the new render: header id B became Bob2.
      participant(h, 'B').setAttribute('data-id', 'Bob2');
      h.controller.onRendered(h.store.code);
      expect(participant(h, 'Bob2').classList.contains('mie-flash')).toBe(true);
    });

    it('participant with alias keeps its id', async () => {
      const h = setup();
      await rendered(h);
      dblclick(participant(h, 'A'));
      input()!.value = 'Alicia';
      key(input()!, 'Enter');
      h.controller.onRendered(h.store.code);
      expect(participant(h, 'A').classList.contains('mie-flash')).toBe(true);
    });

    it('no flash when the next render is of other code', async () => {
      const h = setup();
      await rendered(h);
      dblclick(participant(h, 'A'));
      input()!.value = 'Alicia';
      key(input()!, 'Enter');
      h.store.code = 'other';
      h.controller.onRendered('other');
      expect(svgOf(h).querySelector('.mie-flash')).toBeNull();
    });
  });

  it('destroy removes the listener and the affordance', async () => {
    const h = setup();
    await rendered(h);
    h.controller.destroy();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    dblclick(participant(h, 'A'));
    expect(input()).toBeNull();
  });
});

describe('analytics placement', () => {
  it('sends all five events at rate 1', () => {
    for (const name of [
      'editor_inline_edit_started', 'editor_inline_edit_succeeded', 'editor_inline_edit_rejected',
      'editor_inline_edit_cancelled', 'editor_inline_edit_unavailable',
    ]) {
      expect(sampleRateFor(name, Date.parse('2026-11-20T00:00:00Z'))).toBe(1);
    }
  });
});

describe('hover affordance', () => {
  it('marks every line of the hovered message, and nothing while inert', async () => {
    const h = setup();
    await rendered(h);
    messageTexts(h, 3)[1].dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(messageTexts(h, 3).every((el) => el.classList.contains('mie-hover'))).toBe(true);
    expect(messageTexts(h, 4)[0].classList.contains('mie-hover')).toBe(false);
    h.container.dispatchEvent(new Event('pointerleave'));
    expect(svgOf(h).querySelector('.mie-hover')).toBeNull();
    h.controller.setSuspended(true);
    messageTexts(h, 3)[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(svgOf(h).querySelector('.mie-hover')).toBeNull();
  });
});
