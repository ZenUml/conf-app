import { describe, expect, it } from 'vitest';
import { isValidActorId, isValidLineText } from './validate';
import { officialDb } from './testHelpers';

/** One diagram that uses `id` at every position the rename rewrites. */
function actorProbe(id: string): string {
  return [
    'sequenceDiagram',
    `participant ${id}`,
    'participant Z',
    `${id}->>Z: hi`,
    `Z-->>${id}: yo`,
    `activate ${id}`,
    `Note over ${id},Z: n`,
    `Z->>+${id}: a`,
    `${id}-->>-Z: b`,
    `deactivate ${id}`,
    `create participant N${'x'}`,
    `${id}->>Nx: c`,
    `destroy Nx`,
    `box Aqua G`,
    `participant ${id}2`,
    'end',
    '',
  ].join('\n');
}

async function actorRoundTrips(id: string): Promise<boolean> {
  try {
    const db = await officialDb(actorProbe(id));
    const keys = db.actors.map(([k]) => k);
    if (!keys.includes(id) || !keys.includes('Z')) return false;
    const m = db.messages.filter((x) => x.message === 'hi' || x.message === 'yo');
    return m[0]?.from === id && m[0]?.to === 'Z' && m[1]?.from === 'Z' && m[1]?.to === id;
  } catch {
    return false;
  }
}

const PUNCT = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'];
const LETTERS = ['a', 'Z', '1', ' '];

describe('isValidActorId: accepted names round-trip through official mermaid 11.17.2', () => {
  const accepted = [
    'Alice', 'Bob Smith', 'Order Service', 'my-service', 'Svc (v2)', 'a/b', 'a.b', 'a_b', 'é中文', 'A&B',
    "O'Brien", 'a"b', 'a|b', 'a}b', 'a{b', 'a%b', 'a\\b', 'a b  c', 'Auth/Service', 'ending', 'notes', 'boxes',
    'asset', 'as2', '2fa', 'v1.2', 'x=y', 'a$b', 'a!b', 'a?b', 'a*b', 'a^b', 'a~b', 'a`b', 'a[0]', 'API (beta)',
  ];
  it.each(accepted)('%s', async (name) => {
    expect(isValidActorId(name)).toBe(true);
    expect(await actorRoundTrips(name)).toBe(true);
  });

  it('exhaustive soundness over every punctuation char at start, middle, end and every pair', async () => {
    const candidates: string[] = [];
    for (const c of PUNCT) {
      candidates.push(`${c}x`, `x${c}`, `x${c}y`, `x${c} y`, `x ${c}y`);
      for (const d of PUNCT) candidates.push(`x${c}${d}y`, `x${c}${d}`);
      for (const l of LETTERS) candidates.push(`${l}${c}`, `${c}${l}`);
    }
    candidates.push(...['x-x', 'x-X', 'x--y', 'x-)', 'x-|\\y', 'x//-y', 'x/|-y', 'x\\|-y', 'x ()', 'x()y']);
    const unsound: string[] = [];
    let accepted = 0;
    for (const name of new Set(candidates)) {
      if (!isValidActorId(name)) continue;
      accepted++;
      if (!(await actorRoundTrips(name))) unsound.push(name);
    }
    expect(unsound).toEqual([]);
    expect(accepted).toBeGreaterThan(500);
  }, 120_000);

  it('rejected names that official mermaid also fails on (the rejections are needed, not cosmetic)', async () => {
    const needed = [
      'a;b', 'a,b', 'a:b', 'a<b', 'a>b', 'a@b', 'a+b', 'x-xy', 'x--y', 'end', 'end-point', 'note taker',
      'Loop', 'Box Office', '1 Svc', 'Foo as Bar', 'a%%b', '%x', '-x', '(x', '/x', 'x ()',
    ];
    for (const name of needed) {
      expect(isValidActorId(name), name).toBe(false);
      expect(await actorRoundTrips(name), `official mermaid accepts ${name}`).toBe(false);
    }
  });

  it('rejects empty, padded and multi-line names', () => {
    for (const n of ['', ' a', 'a ', 'a\nb', 'a\r', 'a\tb', 'a\u2028b', 'a\u0000b', 'a\u00a0b', 'a\u3000b']) expect(isValidActorId(n)).toBe(false);
  });
});

describe('isValidLineText: aliases and message text', () => {
  const ok = [
    '', 'hello', 'Hello, world: a -> b', 'a (b) [c] {d}', 'a/b\\c', 'quote "x" \'y\'', 'é中文 😀', 'wrapper', 'nowrapped',
    'x#35;y', 'say #quot;hi#quot;', 'a #35; b #amp;', 'a - b -> c', '->> arrow', '<b>html</b>', 'as AS as',
  ];
  it.each(ok)('accepts %j and official mermaid reads it back (message and alias)', async (text) => {
    expect(isValidLineText(text)).toBe(true);
    const code = `sequenceDiagram\nparticipant A as ${text}\nparticipant B\nA->>B: ${text}\nB->>A:${text}\n`;
    const db = await officialDb(code);
    const trimmed = text.trim();
    expect(db.actors[0][0]).toBe('A');
    expect(db.actors[0][1].length > 0 || trimmed === '').toBe(true);
    if (!/#\w+;/.test(text)) {
      expect(db.actors[0][1]).toBe(trimmed);
      expect(db.messages[0].message).toBe(trimmed);
      expect(db.messages[1].message).toBe(trimmed);
    }
  });

  const bad = ['a\nb', 'a\rb', 'a;b', 'a#b', '#', 'a # c', 'x#35', 'wrap:hi', 'nowrap: hi', ':wrap:hi', 'a\u2028b', '#35;;'];
  it.each(bad)('rejects %j', (text) => {
    expect(isValidLineText(text)).toBe(false);
  });

  it('every rejected case that is single-line really changes the meaning in official mermaid', async () => {
    for (const text of ['a;b', 'a#b', 'wrap:hi', 'nowrap: hi']) {
      let changed = false;
      try {
        const db = await officialDb(`sequenceDiagram\nA->>B: ${text}\n`);
        changed = db.messages[0].message !== text.trim();
      } catch {
        changed = true;
      }
      expect(changed, text).toBe(true);
    }
  });
});
