import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import corpus from '../sourcemap/__fixtures__/upstream-sequence-corpus.11.17.2.json';
import { getSourceMap } from '../sourcemap';
import { NAMED_ENTITIES } from './mermaidText';
import {
  analyseSourceText,
  checkRenderParity,
  decodeSourceText,
  encodeDisplayText,
  isUnchanged,
  readMessageLines,
  readParticipantLines,
  renderParity,
  type DecodeFailure,
} from './index';
import { renderDiagram, renderedMessageLines, renderedParticipantLines, stubLayout } from './testRender';

beforeAll(stubLayout);

const msg = (text: string) => `sequenceDiagram\nA->>B: ${text}`;

describe('decodeSourceText', () => {
  it.each([
    ['plain', 'Hello', 'Hello'],
    ['<br>', 'a<br>b', 'a\nb'],
    ['<br/>', 'a<br/>b', 'a\nb'],
    ['<br />', 'a<br />b', 'a\nb'],
    ['<BR/>', 'a<BR/>b', 'a\nb'],
    ['<br  /> (any whitespace)', 'a<br  />b', 'a\nb'],
    ['<br\\t>', 'a<br\t>b', 'a\nb'],
    ['<br/ > is NOT a break', 'a<br/ >b', 'a<br/ >b'],
    ['numeric entity', 'a#35;b', 'a#b'],
    ['numeric with zeros', '#0065;', 'A'],
    ['astral numeric', '#128512;', '😀'],
    ['heart', '#9829;', '♥'],
    ['quot', '#quot;x#quot;', '"x"'],
    ['nbsp', '#nbsp;x', ' x'],
    ['entity that spells a break stays text', '#lt;br#gt;', '<br>'],
    ['numeric that spells a break stays text', '#60;br/#62;', '<br/>'],
    ['angle brackets are literal', '<b>bold</b> a<b', '<b>bold</b> a<b'],
    ['ampersand is literal', 'a & b &amp c', 'a & b &amp c'],
    ['edge spaces trimmed like parseMessage', '  a  ', 'a'],
    ['interior line spaces kept', 'a <br/> b', 'a \n b'],
    ['empty', '', ''],
    ['empty lines', '<br/><br/>', '\n\n'],
    ['leading wrap-like text in a slice is plain text', 'wrap: x', 'wrap: x'],
  ])('%s', (_label, source, expected) => {
    expect(decodeSourceText(source)).toBe(expected);
  });

  it.each<[string, string, DecodeFailure]>([
    ['unknown named entity', '#foo;', 'unsupported_entity'],
    ['hex entity (drawn literally by Mermaid)', '#x41;', 'unsupported_entity'],
    ['signed entity (+ is not a word character: not an entity at all)', '#+35;', 'raw_hash_or_semicolon'],
    ['C1 numeric (windows-1252 remap)', '#128;', 'unsupported_entity'],
    ['CR numeric', '#13;', 'unsupported_entity'],
    ['NUL numeric', '#0;', 'unsupported_entity'],
    ['surrogate numeric', '#55357;', 'unsupported_entity'],
    ['out of range numeric', '#1114112;', 'unsupported_entity'],
    ['huge numeric', '#99999999999999999999;', 'unsupported_entity'],
    ['KaTeX', '$$x^2$$', 'katex'],
    ['directive', 'a %%{init: {}}%% b', 'directive'],
    ['tag attribute rewrite', '<b class="x">y</b>', 'tag_attribute_rewrite'],
    ['style hash', 'style:#35;x', 'hash_statement'],
    ['marker chars', 'ﬂ°x¶ß', 'marker_chars'],
    ['raw hash', 'a # b', 'raw_hash_or_semicolon'],
    ['raw semicolon', 'a ; b', 'raw_hash_or_semicolon'],
    ['newline', 'a\nb', 'multiline'],
  ])('null for %s', (_label, source, reason) => {
    expect(decodeSourceText(source)).toBeNull();
    expect(analyseSourceText(source)).toEqual({ ok: false, reason });
  });

  it('every named entity in the table is drawn as the table says (real render)', async () => {
    for (const [name, ch] of Object.entries(NAMED_ENTITIES)) {
      expect(await renderedMessageLines(msg(`x#${name};y`)), name).toEqual([`x${ch}y`]);
      expect(decodeSourceText(`x#${name};y`), name).toBe(`x${ch}y`);
    }
  });

  it('numeric rule matches real render at the boundaries', async () => {
    for (const cp of [9, 32, 35, 60, 126, 160, 169, 0x2028, 0xd7ff, 0xe000, 0xfffd, 0x1f600, 0x10fffd]) {
      const lines = await renderedMessageLines(msg(`x#${cp};y`));
      expect(decodeSourceText(`x#${cp};y`), String(cp)).toBe(`x${String.fromCodePoint(cp)}y`);
      expect(lines, String(cp)).toEqual([`x${String.fromCodePoint(cp)}y`]);
    }
    // not reproduced, and Mermaid indeed draws something else
    expect(decodeSourceText('x#1114111;y')).toBeNull(); // U+10FFFF is a noncharacter
    expect(await renderedMessageLines(msg('x#128;y'))).toEqual(['x€y']);
    expect(await renderedMessageLines(msg('x#0;y'))).toEqual(['x�y']);
    expect(await renderedMessageLines(msg('x#55357;y'))).toEqual(['x�y']);
  });
});

describe('observed drawing of <, > and & (securityLevel strict, text as typed)', () => {
  it('draws them literally; only <br> variants break lines', async () => {
    const cases: Array<[string, string[]]> = [
      ['a<b', ['a<b']],
      ['a>b', ['a>b']],
      ['<b>bold</b>', ['<b>bold</b>']],
      ['x<i>y</i>z', ['x<i>y</i>z']],
      ['a & b', ['a & b']],
      ['a &amp b', ['a &amp b']],
      ['a<br>b', ['a', 'b']],
      ['a<br/>b', ['a', 'b']],
      ['a<BR />b', ['a', 'b']],
      ['a<br/ >b', ['a<br/ >b']],
      ['#lt;b#gt;bold#lt;/b#gt;', ['<b>bold</b>']],
      ['#amp;lt#59;', ['&lt;']],
    ];
    for (const [source, lines] of cases) {
      expect(await renderedMessageLines(msg(source)), source).toEqual(lines);
      expect(decodeSourceText(source), source).toBe(lines.join('\n'));
      expect(renderParity(source, lines), source).toBe(true);
    }
  });

  it('rewrites attribute quotes inside tag-like text, so such text is not reproduced', async () => {
    expect(await renderedMessageLines(msg('<b class="x">y</b>'))).toEqual(["<b class='x'>y</b>"]);
    expect(decodeSourceText('<b class="x">y</b>')).toBeNull();
    expect(renderParity('<b class="x">y</b>', ["<b class='x'>y</b>"])).toBe(false);
  });
});

describe('renderParity on real renders', () => {
  const LONG = 'this is a very long message text that must wrap over many lines for sure yes';

  it('true for plain, <br/> and aliases', async () => {
    expect(renderParity('Hello', await renderedMessageLines(msg('Hello')))).toBe(true);
    expect(renderParity('a<br/>b<br/>c', await renderedMessageLines(msg('a<br/>b<br/>c')))).toBe(true);
    const alias = 'sequenceDiagram\nparticipant A as Al<br/>ice\nA->>B: x';
    expect(renderParity('Al<br/>ice', await renderedParticipantLines(alias, 'A'), 'participantLabel')).toBe(true);
    const actor = 'sequenceDiagram\nactor A as Bob\nA->>B: x';
    expect(renderParity('Bob', await renderedParticipantLines(actor, 'A'), 'participantLabel')).toBe(true);
  });

  it('false when Mermaid auto-wrapped (wrap: prefix and the autowrap directive)', async () => {
    const prefixed = await renderedMessageLines(`sequenceDiagram\nA->>B: wrap: ${LONG}`);
    expect(prefixed.length).toBeGreaterThan(1);
    expect(renderParity(LONG, prefixed)).toBe(false);
    expect(checkRenderParity(LONG, prefixed)).toEqual({ ok: false, reason: 'lines_differ' });

    const auto = await renderedMessageLines(`sequenceDiagram\n%%{init: {"sequence": {"wrap": true}}}%%\nA->>B: ${LONG}`);
    expect(renderParity(LONG, auto)).toBe(false);

    const alias = await renderedParticipantLines(`sequenceDiagram\nparticipant A as wrap: ${LONG}\nA->>B: x`, 'A');
    expect(alias.length).toBeGreaterThan(1);
    expect(renderParity(LONG, alias, 'participantLabel')).toBe(false);
  });

  it('true for short wrap: text that Mermaid did not wrap', async () => {
    expect(renderParity('short', await renderedMessageLines('sequenceDiagram\nA->>B: wrap: short'))).toBe(true);
  });

  it('false for KaTeX (message draws no messageText; alias is not decoded)', async () => {
    const lines = await renderedMessageLines(msg('$$x^2$$'));
    expect(lines).toEqual([]);
    expect(checkRenderParity('$$x^2$$', lines)).toEqual({ ok: false, reason: 'katex' });
    expect(checkRenderParity('x', [])).toEqual({ ok: false, reason: 'no_rendered_lines' });
    expect(renderParity('$$x^2$$', ['$$x^2$$'], 'participantLabel')).toBe(false);
  });

  it('false for text Mermaid rewrites or deletes', async () => {
    const directive = 'a %%{init: {"theme":"dark"}}%% b';
    const lines = await renderedMessageLines(msg(directive));
    expect(lines).toEqual(['a  b']);
    expect(renderParity(directive, lines)).toBe(false);
    expect(renderParity('style:#35;x', await renderedMessageLines(msg('style:#35;x')))).toBe(false);
    expect(renderParity('#foo;', await renderedMessageLines(msg('#foo;')))).toBe(false);
  });

  it('is exact: NBSP, edge spaces and non-empty ZWSP are never normalised away', () => {
    expect(renderParity('a', ['a '])).toBe(false);
    expect(renderParity('a b', ['a b'])).toBe(false);
    expect(renderParity('a', ['a​'])).toBe(false);
    expect(renderParity('​', ['​'])).toBe(false);
    expect(renderParity('', ['​'])).toBe(true); // the ZWSP drawText writes for an empty line
    expect(renderParity('a<br/>', ['a', '​'])).toBe(true);
    expect(renderParity('a', ['a', 'a'])).toBe(false);
  });

  it('reads the lines of the right message and participant from the tagged DOM', async () => {
    const { root } = await renderDiagram(
      'sequenceDiagram\nparticipant A as Al<br/>ice\nA->>B: first<br/>line\nB-->>A: second\nA->>B:',
    );
    expect(readMessageLines(root, 0)).toEqual(['first', 'line']);
    expect(readMessageLines(root, 1)).toEqual(['second']);
    expect(readMessageLines(root, 2)).toEqual(['']);
    expect(readMessageLines(root, 9)).toEqual([]);
    expect(readParticipantLines(root, 'A')).toEqual(['Al', 'ice']);
    expect(readParticipantLines(root, 'B')).toEqual(['B']);
    expect(readParticipantLines(root, 'nope')).toEqual([]);
  });
});

describe('isUnchanged', () => {
  it('is true when the display equals what the source shows, whatever its spelling', () => {
    expect(isUnchanged('a<br>b', 'a\nb')).toBe(true);
    expect(isUnchanged('a<BR />b', 'a\nb')).toBe(true);
    expect(isUnchanged('a#35;b', 'a#b')).toBe(true);
    expect(isUnchanged('#quot;x#quot;', '"x"')).toBe(true);
    expect(isUnchanged('a<br/>b', 'a\r\nb')).toBe(true);
  });
  it('is false for any change, and when the source cannot be decoded', () => {
    expect(isUnchanged('a<br>b', 'a\nc')).toBe(false);
    expect(isUnchanged('a', 'a ')).toBe(false);
    expect(isUnchanged('$$x$$', '$$x$$')).toBe(false);
    expect(isUnchanged('#foo;', '&foo;')).toBe(false);
  });
});

/** Every message text and participant label of the upstream corpus, with real renders. */
describe('upstream corpus', () => {
  it('parity share, reasons and idempotence', async () => {
    const reasons = new Map<string, number>();
    const tally = (kind: string, ok: boolean, reason?: string) => {
      const key = `${kind} ${ok ? 'true' : `false:${reason}`}`;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    };
    const falses: string[] = [];
    let sources = 0;
    let messages = 0;
    let labels = 0;
    let idempotent = 0;
    for (const source of corpus.sources) {
      let rendered;
      try {
        rendered = await renderDiagram(source);
      } catch {
        continue; // does not parse, or needs layout jsdom lacks
      }
      const map = await getSourceMap(source);
      if (!map) continue;
      sources++;
      for (const [index, { textRange }] of map.messages) {
        if (!textRange) continue;
        messages++;
        const slice = source.slice(...textRange);
        const decoded = decodeSourceText(slice);
        if (decoded !== null) {
          expect(isUnchanged(slice, decoded), slice).toBe(true);
          idempotent++;
        }
        const result = checkRenderParity(slice, readMessageLines(rendered.root, index));
        tally('message', result.ok, result.ok ? undefined : result.reason);
        if (!result.ok) falses.push(`${result.reason}: ${JSON.stringify(slice)} drawn ${JSON.stringify(readMessageLines(rendered.root, index))}`);
      }
      for (const [id, loc] of map.participants) {
        if (loc.labelRanges.length === 0) continue;
        labels++;
        const slice = source.slice(...loc.labelRanges[0]);
        const result = checkRenderParity(slice, readParticipantLines(rendered.root, id), 'participantLabel');
        tally(loc.hasAlias ? 'alias' : 'actor-id', result.ok, result.ok ? undefined : result.reason);
      }
    }
    console.log(
      `corpus: ${sources} rendered sources, ${messages} message texts, ${labels} participant labels, ${idempotent} idempotent\n` +
        [...reasons.entries()].sort().map(([k, v]) => `  ${k}: ${v}`).join('\n') +
        '\n' + falses.join('\n'),
    );
    expect(sources).toBeGreaterThan(80);
    expect(messages).toBeGreaterThan(100);
    expect(idempotent).toBeGreaterThan(100);
  });

  it('encoding a decoded corpus text and writing it back is a no-op through edit/ semantics', async () => {
    for (const source of corpus.sources) {
      let map;
      try {
        await renderDiagram(source);
        map = await getSourceMap(source);
      } catch {
        continue;
      }
      if (!map) continue;
      for (const { textRange } of map.messages.values()) {
        if (!textRange) continue;
        const slice = source.slice(...textRange);
        const decoded = decodeSourceText(slice);
        if (decoded === null || decoded.trim() === '') continue;
        const again = encodeDisplayText(decoded, 'messageText', { original: slice });
        // Re-encoding may spell things differently (that is why isUnchanged exists),
        // but it must always decode back to the same text.
        if (again.ok) expect(decodeSourceText(again.source)).toBe(decoded);
      }
    }
  });
});
