/**
 * Deterministic extraction of explicit participant declarations from a
 * Mermaid `sequenceDiagram`. Lexical only: no identity, no classification.
 */
export type DeclKind = 'participant' | 'actor';

export interface ParticipantOccurrence {
  /** Mermaid `Actor.name` — the id used in messages. */
  actorId: string;
  /** Mermaid `Actor.description` — what the author wrote as the label. */
  rawLabel: string;
  declKind: DeclKind;
  /** Declared with `create participant|actor`. */
  created: boolean;
  /** Enclosing `box … end` text, or null. */
  boxName: string | null;
  /** 1-based line of the declaration. */
  lineNumber: number;
}

const DECLARATION = /^\s*(create\s+)?(participant|actor)\s+(.+?)\s*$/;
const BOX_OPEN = /^\s*box\b\s*(.*?)\s*$/;
// Every construct closed by `end`; tracked so an `end` inside a box does not
// close the box.
const BLOCK_OPEN = /^\s*(loop|alt|opt|par|rect|critical|break)\b/;
const BLOCK_END = /^\s*end\s*$/;

export function extractParticipants(mermaidCode: string): ParticipantOccurrence[] {
  const out: ParticipantOccurrence[] = [];
  const blocks: Array<{ box: string | null }> = [];
  const currentBox = (): string | null => {
    for (let i = blocks.length - 1; i >= 0; i -= 1) if (blocks[i].box !== null) return blocks[i].box;
    return null;
  };
  mermaidCode.split('\n').forEach((line, index) => {
    // Mermaid comments are whole lines; `;` separates statements like a newline.
    if (/^\s*%%/.test(line)) return;
    for (const statement of line.split(';')) {
      const box = BOX_OPEN.exec(statement);
      if (box) { blocks.push({ box: box[1] }); continue; }
      if (BLOCK_OPEN.test(statement)) { blocks.push({ box: null }); continue; }
      if (BLOCK_END.test(statement)) { blocks.pop(); continue; }
      const m = DECLARATION.exec(statement);
      if (!m) continue;
      const created = Boolean(m[1]);
      const declKind = m[2] as DeclKind;
      const body = m[3];
      const alias = /^(.+?)\s+as\s+(.+)$/.exec(body);
      const actorId = alias ? alias[1].trim() : body;
      const rawLabel = alias ? alias[2].trim() : body;
      out.push({ actorId, rawLabel, declKind, created, boxName: currentBox(), lineNumber: index + 1 });
    }
  });
  return out;
}

/**
 * True when the first directive is `sequenceDiagram`, after an optional YAML
 * frontmatter block and any `%%` comment / init lines.
 */
export function isSequenceDiagram(mermaidCode: string): boolean {
  let rest = mermaidCode.replace(/^\uFEFF/, '').trimStart();
  if (rest.startsWith('---')) {
    const close = rest.indexOf('\n---', 3);
    if (close < 0) return false;
    rest = rest.slice(close + 4).trimStart();
  }
  while (rest.startsWith('%%')) {
    const newline = rest.indexOf('\n');
    if (newline < 0) return false;
    rest = rest.slice(newline + 1).trimStart();
  }
  return /^sequenceDiagram(?:\s|$)/.test(rest);
}
