// Shared, isomorphic parse-validate gate for the agent-link update_diagram
// guardrail (charter §4-C, "C0 parse-before-submit"). Runs in BOTH the
// Cloudflare Pages Function (workerd) forwarding path (mcp.ts -> mcpTools.ts)
// AND plain Node — the same module is Track E1's offline scorer, so it must
// carry NO workerd-only imports (no `cloudflare:*`, no DO globals). Everything
// heavy (the ZenUML parser, Mermaid core, the linkedom DOM shim) is loaded via
// dynamic `import()` inside the handler, never at module scope, so importing
// this file is cheap and the Workers 1s global-scope startup budget is never
// touched (see the C0 spike evidence, section 7).
//
// Feasibility was proven empirically before this was written — see
// /Users/.../evidence/C0-parser-spike.md. Verdicts reused here verbatim:
//   - ZenUML  -> `@zenuml/core@4.x/parser` `validate()` — native in workerd,
//               real ANTLR errors with line/col. (Pulled in via the
//               `@zenuml/core-parser` npm alias so the Vue app renderer can
//               stay on the 3.x line it's proven against; see package.json.)
//   - Mermaid -> `mermaid` core `.parse()` behind an idempotent linkedom DOM
//               shim (mermaid needs `document`/`DOMPurify`); covers every
//               mermaid diagram type (flowchart/sequence/class/pie/…).
//   - PlantUML-> structural lint only (envelope + brace balance). No
//               workerd-safe real PlantUML parser exists; this catches
//               truncation/paste/envelope breaks, NOT grammar mistakes.
//
// Uniform return shape:
//   { ok: true, stats?: { participants, messages }, unvalidated?: true }
//   { ok: false, errors: [{ line, col, message }] }
// `unvalidated: true` is returned ONLY for a dialect we deliberately do not
// parse (Graph/OpenApi/AsyncApi/Embed/unknown) — the guard must NEVER block a
// dialect it cannot understand (charter: "never block a dialect we can't
// parse"). `stats` is best-effort structural counts for drift detection
// (charter §4-C point 3, NOT a blocker); present for ZenUML + Mermaid, absent
// for PlantUML (skipped) and unvalidated dialects.

export interface DslError {
  /** 1-based line of the offending token (best-effort; 1 when unknown). */
  line: number;
  /** 0-based column (best-effort; 0 when unknown). */
  col: number;
  message: string;
}

export interface DslStats {
  participants: number;
  messages: number;
}

export type ParseDslResult =
  | { ok: true; stats?: DslStats; unvalidated?: true }
  | { ok: false; errors: DslError[] };

export type Dialect = 'zenuml' | 'mermaid' | 'plantuml' | 'unknown';

/**
 * Map the macro's `diagramType` (the DiagramType enum values it reports on
 * read_diagram — 'Sequence' | 'Mermaid' | 'PlantUml' | 'Graph' | 'OpenApi' |
 * 'AsyncApi' | 'Embed' | 'Unknown') OR a lowercase dialect name to the parser
 * family. Anything we don't have a parser for -> 'unknown' (pass-through).
 */
export function normalizeDialect(diagramType: string | undefined | null): Dialect {
  const t = (diagramType ?? '').trim().toLowerCase();
  if (t === 'sequence' || t === 'zenuml') return 'zenuml';
  if (t === 'mermaid') return 'mermaid';
  if (t === 'plantuml' || t === 'plant-uml' || t === 'plant_uml') return 'plantuml';
  return 'unknown';
}

// ---- Mermaid lazy singletons (per-isolate; idempotent) --------------------
let _mermaid: unknown = null;
let _shimInstalled = false;

async function installDomShim(): Promise<void> {
  if (_shimInstalled) return;
  // Reuse an existing DOM when one is present (jsdom under Vitest, or a real
  // browser) — only synthesize a linkedom document in a DOM-less runtime like
  // workerd or bare Node. Installing linkedom over a live jsdom would clobber
  // the test runtime's globals for no reason.
  const g = globalThis as unknown as { document?: { createElement?: unknown } };
  if (g.document && typeof g.document.createElement === 'function') {
    _shimInstalled = true;
    return;
  }
  const { parseHTML } = await import('linkedom');
  const { window, document } = parseHTML(
    '<!doctype html><html><head></head><body></body></html>',
  );
  const gt = globalThis as unknown as Record<string, unknown>;
  gt.window = window;
  gt.document = document;
  if (!('navigator' in globalThis)) gt.navigator = (window as { navigator: unknown }).navigator;
  gt.DOMParser = (window as { DOMParser: unknown }).DOMParser;
  _shimInstalled = true;
}

interface MermaidLike {
  initialize(cfg: Record<string, unknown>): void;
  parse(text: string, opts?: { suppressErrors?: boolean }): Promise<unknown>;
}

async function getMermaid(): Promise<MermaidLike> {
  if (_mermaid) return _mermaid as MermaidLike;
  await installDomShim();
  const mermaid = ((await import('mermaid')) as { default: MermaidLike }).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  _mermaid = mermaid;
  return mermaid;
}

// ---- ZenUML ---------------------------------------------------------------
interface ZenumlErrorDetail {
  line: number;
  column: number;
  msg: string;
}
interface ZenumlParseResult {
  pass: boolean;
  errorDetails: ZenumlErrorDetail[];
}

async function parseZenuml(dsl: string): Promise<ParseDslResult> {
  // Aliased to keep the app renderer on @zenuml/core@3.x (see package.json).
  const { validate } = (await import('@zenuml/core-parser/parser')) as {
    validate(code: string): ZenumlParseResult;
  };
  const r = validate(dsl);
  if (!r.pass) {
    return {
      ok: false,
      errors: r.errorDetails.map((e) => ({ line: e.line, col: e.column, message: e.msg })),
    };
  }
  return { ok: true, stats: zenumlStats(dsl) };
}

// ---- Mermaid --------------------------------------------------------------
async function parseMermaid(dsl: string): Promise<ParseDslResult> {
  const mermaid = await getMermaid();
  try {
    await mermaid.parse(dsl, { suppressErrors: false });
    return { ok: true, stats: mermaidStats(dsl) };
  } catch (e) {
    // jison errors (flowchart/sequence/class) carry `.hash.loc`; langium/newer
    // grammars put "line N, column M" in the message text.
    const err = e as { hash?: { loc?: { first_line: number; first_column: number } }; message?: string };
    const loc = err?.hash?.loc;
    const firstLine = String(err?.message ?? 'Parse error').split('\n')[0];
    if (loc) {
      return { ok: false, errors: [{ line: loc.first_line, col: loc.first_column, message: firstLine }] };
    }
    const m = /line (\d+),? column (\d+)/i.exec(String(err?.message ?? ''));
    return {
      ok: false,
      errors: [{ line: m ? Number(m[1]) : 1, col: m ? Number(m[2]) : 0, message: firstLine }],
    };
  }
}

// ---- PlantUML (structural lint — honest partial coverage) -----------------
const PUML_OPENERS = new Set([
  'startuml', 'startmindmap', 'startgantt', 'startsalt', 'startjson',
  'startyaml', 'startwbs', 'startdot', 'startditaa', 'startlatex',
  'startchronology', 'startchen',
]);

function parsePlantuml(dsl: string): ParseDslResult {
  const errors: DslError[] = [];
  const lines = dsl.split(/\r?\n/);
  const opener = lines.findIndex((l) => /^\s*@start/i.test(l));
  const closer = lines.findIndex((l) => /^\s*@end/i.test(l));
  if (opener === -1) {
    errors.push({ line: 1, col: 0, message: 'Missing @start... opening directive' });
  } else {
    const tag = lines[opener].trim().slice(1).toLowerCase().split(/\s/)[0];
    if (!PUML_OPENERS.has(tag)) {
      errors.push({ line: opener + 1, col: 0, message: `Unknown PlantUML opener @${tag}` });
    }
  }
  if (closer === -1) {
    errors.push({ line: lines.length, col: 0, message: 'Missing @end... closing directive' });
  } else if (opener !== -1 && closer < opener) {
    errors.push({ line: closer + 1, col: 0, message: '@end appears before @start' });
  }
  // brace / paren / bracket balance
  const pairs: Record<string, string> = { '}': '{', ')': '(', ']': '[' };
  const stack: { ch: string; line: number; col: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let c = 0; c < lines[i].length; c++) {
      const ch = lines[i][c];
      if (ch === '{' || ch === '(' || ch === '[') stack.push({ ch, line: i + 1, col: c });
      else if (pairs[ch]) {
        const top = stack.pop();
        if (!top || top.ch !== pairs[ch]) errors.push({ line: i + 1, col: c, message: `Unbalanced '${ch}'` });
      }
    }
  }
  for (const s of stack) errors.push({ line: s.line, col: s.col, message: `Unclosed '${s.ch}'` });
  return errors.length ? { ok: false, errors } : { ok: true };
  // NOTE: no stats for PlantUML (charter §4-C: "plantuml skip").
}

// ---- Best-effort structural stats (drift detection, NOT a gate) -----------
// These are text-derived, deliberately approximate counts. Their VALUE is that
// the identical function runs on the before-DSL and the after-DSL, so a
// participant/message count that collapses across an edit is a reliable
// "unintended semantic drift" signal even if the absolute count is imperfect.
// They never throw and never block.

function stripZenumlNoise(dsl: string): string {
  return dsl
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' '); // line comments
}

const ZENUML_BLOCK_KEYWORDS =
  /^(if|else|while|for|par|opt|loop|alt|group|frame|try|catch|finally|critical|section|ref|return|end)\b/i;

export function zenumlStats(dsl: string): DslStats {
  const clean = stripZenumlNoise(dsl);
  const participants = new Set<string>();

  // Endpoints around message arrows: `A->B`, `A -> B.method()`.
  for (const m of clean.matchAll(/([A-Za-z_][\w]*)\s*->\s*([A-Za-z_][\w]*)?/g)) {
    if (m[1]) participants.add(m[1]);
    if (m[2]) participants.add(m[2]);
  }
  // Method-call receivers: `A.method()`.
  for (const m of clean.matchAll(/([A-Za-z_][\w]*)\s*\.\s*[A-Za-z_]\w*\s*\(/g)) {
    participants.add(m[1]);
  }
  // Explicit declarations.
  for (const m of clean.matchAll(/(?:participant|actor|boundary|control|entity|database)\s+"?([A-Za-z_][\w]*)"?/gi)) {
    participants.add(m[1]);
  }

  // One message per interaction-bearing statement line (an arrow, or a bare
  // method call), skipping pure control-flow / block-delimiter lines.
  let messages = 0;
  for (const raw of clean.split(/\n/)) {
    const t = raw.trim();
    if (!t || t === '{' || t === '}' || ZENUML_BLOCK_KEYWORDS.test(t)) continue;
    if (/->/.test(t) || /[A-Za-z_]\w*\s*\.\s*[A-Za-z_]\w*\s*\(/.test(t)) messages++;
  }

  return { participants: participants.size, messages };
}

// Generic across mermaid diagram families (sequence + flowchart cover the
// agent-link common case); best-effort per charter ("mermaid best-effort").
const MERMAID_ARROW = /--?>>?|-->|---|-\.->|==>|<-->|-\)|--\)/;
const MERMAID_ARROW_G = /\s*(?:--?>>?|-->|---|-\.->|==>|<-->|-\)|--\)|:)\s*/;

export function mermaidStats(dsl: string): DslStats {
  const lines = dsl.split(/\r?\n/).map((l) => l.trim());
  const participants = new Set<string>();
  let messages = 0;

  for (const line of lines) {
    if (!line || line.startsWith('%%')) continue;
    // Explicit sequence-diagram declarations.
    const decl = /^(?:participant|actor)\s+([A-Za-z0-9_]+)/i.exec(line);
    if (decl) {
      participants.add(decl[1]);
      continue;
    }
    if (MERMAID_ARROW.test(line)) {
      messages++;
      // Endpoints: split on the arrow/label separators, take the leading token
      // of each side as the node/participant id.
      const parts = line.split(MERMAID_ARROW_G);
      for (const p of parts.slice(0, 2)) {
        const id = /^([A-Za-z0-9_]+)/.exec(p.trim());
        if (id) participants.add(id[1]);
      }
    }
  }
  return { participants: participants.size, messages };
}

/** Structural stats for the diff summary; undefined when the dialect is skipped/unknown. */
export function computeStats(diagramType: string, dsl: string): DslStats | undefined {
  switch (normalizeDialect(diagramType)) {
    case 'zenuml':
      return zenumlStats(dsl);
    case 'mermaid':
      return mermaidStats(dsl);
    default:
      return undefined;
  }
}

/**
 * Parse-validate `dsl` for `diagramType`. The single entry point used by the
 * forwarding gate (mcpTools.ts) and the offline eval (Track E1).
 */
export async function parseDsl(diagramType: string, dsl: string): Promise<ParseDslResult> {
  switch (normalizeDialect(diagramType)) {
    case 'zenuml':
      return parseZenuml(dsl);
    case 'mermaid':
      return parseMermaid(dsl);
    case 'plantuml':
      return parsePlantuml(dsl);
    default:
      // A dialect we deliberately don't parse (Graph/OpenApi/AsyncApi/Embed/…)
      // — pass through so the guard never blocks something it can't understand.
      return { ok: true, unvalidated: true };
  }
}
