import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import { editMessageText, renameParticipant } from '../edit';
import { officialDb } from '../edit/testHelpers';
import { getSourceMap } from '../sourcemap';
import { MESSAGE_TAG } from '../ui/domMapping';
import { decodeSourceText, encodeDisplayText, MESSAGE_LINES_ATTRIBUTE, renderParity } from './index';
import { renderDiagram, renderedMessageLines, renderedParticipantLines, stubLayout } from './testRender';

beforeAll(stubLayout);

it('keeps the codec tag equal to the UI tag', () => {
  expect(MESSAGE_LINES_ATTRIBUTE).toBe(MESSAGE_TAG);
});

/** Display strings the user can type. `undefined` expected = must round trip. */
const DISPLAYS: Array<[label: string, display: string]> = [
  ['plain', 'Hello'],
  ['two lines', 'one\ntwo'],
  ['three lines', 'one\ntwo\nthree'],
  ['empty middle line', 'a\n\nb'],
  ['only a break', '\n'],
  ['hash', 'issue #12'],
  ['lone hash', '#'],
  ['semicolon', 'a; b'],
  ['ampersand', 'a & b'],
  ['html entity text', '&lt;'],
  ['less than', 'a < b'],
  ['greater than', 'a > b'],
  ['bare angle pair', 'a<b>c'],
  ['bold tag', '<b>bold</b>'],
  ['literal br', '<br>'],
  ['literal br in text', 'a<br>b'],
  ['literal BR slash', 'x<BR/>y'],
  ['literal br with space', 'x<br />y'],
  ['double quotes', 'say "hi" and \'bye\''],
  ['attribute quotes', '<b class="x">y</b>'],
  ['equals quote', 'a="b" c'],
  ['percent', '100%'],
  ['double percent', 'a %% b'],
  ['leading %%', '%% not a comment'],
  ['leading %%x', '%%x'],
  ['directive', 'a %%{init: {"theme":"dark"}}%% b'],
  ['leading directive', '%%{init: {"theme":"dark"}}%%'],
  ['leading wrap', 'wrap: not a directive'],
  ['leading nowrap', 'nowrap: not a directive'],
  ['leading colon wrap', ':wrap: not a directive'],
  ['leading Wrap capital', 'Wrap: x'],
  ['wrap inside', 'a wrap: b'],
  ['emoji', 'Done 😀 ok'],
  ['cjk', '你好，世界'],
  ['cjk two lines', '你好\n世界'],
  ['leading spaces', '   indented'],
  ['trailing spaces', 'trailing   '],
  ['both edges', '  both  '],
  ['space before break', 'a \nb'],
  ['space after break', 'a\n b'],
  ['whitespace first line', '  \nb'],
  ['tab inside', 'a\tb'],
  ['nbsp', 'a b'],
  ['nbsp leading', ' a'],
  ['line separator', 'a b'],
  ['paragraph separator', 'a b'],
  ['dollar', '$5 and $6'],
  ['katex-looking', '$$x^2$$'],
  ['katex across lines', '$$a\nb$$'],
  ['entity text', '#35;'],
  ['ampersand hash', '&#35;'],
  ['hash name semicolon', '#foo;'],
  ['marker chars', 'ﬂ°x¶ß'],
  ['lone fl', 'ﬂ'],
  ['pilcrow', '¶ß'],
  ['colon', 'a: b'],
  ['arrows and plus', '-> +x --x'],
  ['backslash n', 'a\\nb'],
  ['markdown', '**b** _i_ `c` [l](u)'],
  ['as keyword', 'Alice as Bob'],
  ['at brace', '@{ "type": "database" }'],
  ['style colon hash', 'color: #fff'],
  ['crlf', 'a\r\nb'],
];

/** Expected rendered lines: CRLF counts as one break. */
const linesOf = (display: string) => display.replace(/\r\n?/g, '\n').split('\n');

describe('message text: encode -> official parser -> real render -> decode', () => {
  for (const spacing of [': ', ':']) {
    describe(`written as "A->>B${spacing}<text>"`, () => {
      it.each(DISPLAYS)('%s', async (_label, display) => {
        const encoded = encodeDisplayText(display, 'messageText', { lineBefore: `A->>B${spacing}` });
        expect(encoded, JSON.stringify(display)).toMatchObject({ ok: true });
        if (!encoded.ok) return;
        const code = `sequenceDiagram\nA->>B${spacing}${encoded.source}`;

        // official parser accepts it and the render shows exactly what was typed
        await officialDb(code);
        expect(await renderedMessageLines(code)).toEqual(linesOf(display));
        // the decoder agrees, and so does the gate
        expect(decodeSourceText(encoded.source)).toBe(display.replace(/\r\n?/g, '\n'));
        expect(renderParity(encoded.source, await renderedMessageLines(code))).toBe(true);

        // the position parser finds exactly this slice, and edit/ writes it back unchanged
        const map = await getSourceMap(code);
        expect(map).not.toBeNull();
        const range = map!.messages.get(0)!.textRange!;
        expect(code.slice(...range)).toBe(encoded.source);
        const edited = editMessageText(code, map!, 0, encoded.source);
        expect(edited).toEqual({ ok: true, code });
      });
    });
  }

  it('renders valid XML too (numeric entities only; Mermaid itself serialises a raw NBSP as &nbsp;, so NBSP cases are left out)', async () => {
    for (const [, display] of DISPLAYS) {
      if (display.includes('\u00A0')) continue;
      const encoded = encodeDisplayText(display, 'messageText');
      if (!encoded.ok) continue;
      const { svg } = await renderDiagram(`sequenceDiagram\nA->>B: ${encoded.source}`);
      const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(xml.querySelector('parsererror'), JSON.stringify(display)).toBeNull();
      const lines = [...xml.querySelectorAll('text.messageText')].map((e) => (e.textContent === '​' ? '' : e.textContent));
      expect(lines, JSON.stringify(display)).toEqual(linesOf(display));
    }
  });
});

describe('alias text: same rules after "participant A as"', () => {
  it.each(DISPLAYS.filter(([, d]) => d.trim() !== ''))('%s', async (_label, display) => {
    const encoded = encodeDisplayText(display, 'aliasText', { lineBefore: 'participant A as ' });
    expect(encoded, JSON.stringify(display)).toMatchObject({ ok: true });
    if (!encoded.ok) return;
    const code = `sequenceDiagram\nparticipant A as ${encoded.source}\nA->>B: x`;
    await officialDb(code);
    expect(await renderedParticipantLines(code, 'A')).toEqual(linesOf(display));
    expect(decodeSourceText(encoded.source, 'participantLabel')).toBe(display.replace(/\r\n?/g, '\n'));
    expect(renderParity(encoded.source, await renderedParticipantLines(code, 'A'), 'participantLabel')).toBe(true);

    const map = await getSourceMap(code);
    expect(map).not.toBeNull();
    const ranges = map!.participants.get('A')!.labelRanges;
    expect(ranges).toHaveLength(1);
    expect(code.slice(...ranges[0])).toBe(encoded.source);
  });

  it('rejects empty alias text', () => {
    expect(encodeDisplayText('', 'aliasText')).toEqual({ ok: false, reason: 'empty' });
    expect(encodeDisplayText('   ', 'aliasText')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('empty and unencodable text', () => {
  it('empty message text is rejected unless allowed', async () => {
    expect(encodeDisplayText('', 'messageText')).toEqual({ ok: false, reason: 'empty' });
    expect(encodeDisplayText('  ', 'messageText')).toEqual({ ok: false, reason: 'empty' });
    expect(encodeDisplayText('', 'messageText', { allowEmpty: true })).toEqual({ ok: true, source: '' });
    expect(await renderedMessageLines('sequenceDiagram\nA->>B:')).toEqual(['']);
    expect(renderParity('', [''])).toBe(true);
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['vertical tab', 'a\u000Bb'],
    ['escape', 'a\u001Bb'],
    ['DEL', 'a\u007Fb'],
    ['C1 control', 'a\u0085b'],
    ['lone high surrogate', 'a\uD800b'],
    ['noncharacter', 'a￿b'],
  ])('%s has no safe encoding', (_label, display) => {
    expect(encodeDisplayText(display, 'messageText')).toEqual({ ok: false, reason: 'invalid_characters' });
    expect(encodeDisplayText(display, 'aliasText')).toEqual({ ok: false, reason: 'invalid_characters' });
  });

  it('a line made only of ZWSP draws like an empty line, so it is not reproducible', async () => {
    const encoded = encodeDisplayText('​', 'messageText');
    expect(encoded).toMatchObject({ ok: true });
    if (!encoded.ok) return;
    const lines = await renderedMessageLines(`sequenceDiagram\nA->>B: ${encoded.source}`);
    expect(renderParity(encoded.source, lines)).toBe(false);
  });
});

describe('the style/classDef rewrite depends on the whole line', () => {
  it('an entity after "style:" loses its semicolon in Mermaid, so encode rejects it', async () => {
    expect(await renderedMessageLines('sequenceDiagram\nA->>B: style:#35;x')).toEqual(['style:']);
    expect(encodeDisplayText('style:#x', 'messageText')).toEqual({ ok: false, reason: 'invalid_characters' });
    expect(encodeDisplayText('classDef:#x', 'messageText')).toEqual({ ok: false, reason: 'invalid_characters' });
    expect(encodeDisplayText('style: #x', 'messageText')).toMatchObject({ ok: true }); // the space protects it
  });

  it('the same happens when the actor name before the colon holds "style"', async () => {
    const code = 'sequenceDiagram\nmystyle->>B: a:b#35;';
    expect((await renderedMessageLines(code)).join('')).not.toContain('#');
    expect(encodeDisplayText('a:b#', 'messageText', { lineBefore: 'mystyle->>B: ' })).toEqual({ ok: false, reason: 'invalid_characters' });
    expect(encodeDisplayText('a:b#', 'messageText', { lineBefore: 'A->>B: ' })).toMatchObject({ ok: true });
  });
});

describe('actor id (no alias): no entities, no line breaks', () => {
  const accepted = ['Alice', 'a-b', 'x1', 'a_b', 'a.b', 'a&b', '日本', 'Order Service', 'a$b', 'a%b', '"Alice"', 'a!b'];
  const rejected = ['', ' ', ' a', 'a ', 'a;b', 'a#b', 'a:b', 'a,b', 'a<b', 'a>b', 'a@b', 'a+b', 'a\nb', 'end', 'note x', 'loop', 'a as b', '-x', 'a--b', '1 a', '$$x$$', '%%x', 'ﬂ°x'];

  it.each(accepted)('%s round trips through the real renderer', async (id) => {
    const encoded = encodeDisplayText(id, 'actorId');
    expect(encoded).toEqual({ ok: true, source: id });
    const code = `sequenceDiagram\nparticipant ${id}\n${id}->>B: x`;
    await officialDb(code);
    expect(await renderedParticipantLines(code, id)).toEqual([id]);
    expect(renderParity(id, [id], 'participantLabel')).toBe(true);
    const map = await getSourceMap(code);
    const loc = map!.participants.get(id)!;
    expect(loc.hasAlias).toBe(false);
    expect(loc.labelRanges.every((r) => code.slice(...r) === id)).toBe(true);
    expect(renameParticipant(code, map!, id, id)).toMatchObject({ ok: true });
  });

  it.each(rejected)('%j is rejected', (id) => {
    const result = encodeDisplayText(id, 'actorId');
    expect(result.ok).toBe(false);
  });

  it('reports empty for blank ids', () => {
    expect(encodeDisplayText('', 'actorId')).toEqual({ ok: false, reason: 'empty' });
    expect(encodeDisplayText('  ', 'actorId')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('break token style', () => {
  it('reuses the original spelling when it is consistent', () => {
    expect(encodeDisplayText('a\nb\nc', 'messageText', { original: 'x<br>y<br>z' })).toEqual({ ok: true, source: 'a<br>b<br>c' });
    expect(encodeDisplayText('a\nb', 'messageText', { original: 'x<BR />y' })).toEqual({ ok: true, source: 'a<BR />b' });
  });
  it('falls back to <br/> when the original mixes spellings or has none', () => {
    expect(encodeDisplayText('a\nb', 'messageText', { original: 'x<br>y<br/>z' })).toEqual({ ok: true, source: 'a<br/>b' });
    expect(encodeDisplayText('a\nb', 'messageText', { original: 'plain' })).toEqual({ ok: true, source: 'a<br/>b' });
    expect(encodeDisplayText('a\nb', 'messageText')).toEqual({ ok: true, source: 'a<br/>b' });
  });
  it('a reused token still renders as a break', async () => {
    const lines = await renderedMessageLines('sequenceDiagram\nA->>B: a<br  >b<BR>c');
    expect(lines).toEqual(['a', 'b', 'c']);
    expect(decodeSourceText('a<br  >b<BR>c')).toBe('a\nb\nc');
  });
});
