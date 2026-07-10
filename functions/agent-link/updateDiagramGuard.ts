// The update_diagram pre-forward guardrail (charter §4-C). Composed from the
// isomorphic `parseDsl` module; called by mcpTools.ts's dispatch path BEFORE
// anything is forwarded to the macro, so a bad edit never round-trips and
// nothing is persisted.
//
// Three responsibilities (run in this order — see the C2-before-C0 comment
// inline below for why):
//   1. Data-loss hard reject (C2) — reject a catastrophically shorter
//      replacement (truncation) relative to the CURRENT diagram content. Pure
//      length comparison; runs for EVERY diagramType, dialect-known or not.
//   2. Parse-before-submit (C0) — reject DSL that doesn't parse in the real
//      dialect parser, with structured line/col errors. Dialect-scoped
//      (zenuml/mermaid/plantuml only — everything else passes through
//      unvalidated).
//   3. Semantic diff (info, NOT a blocker) — attach before/after
//      participant+message counts on success so the agent can spot unintended
//      drift (rendered:true != correct).
//
// WHERE "CURRENT content" COMES FROM (the design choice the charter asked to
// make + document): the relay is stateless per HTTP request, so this module is
// handed a `DiagramSnapshot` — the last-known {diagramType, dsl} the
// AgentLinkSession Durable Object cached from the agent's own read_diagram (and
// refreshed after each applied update_diagram). mcp.ts already round-trips
// `GET /session` to the DO to authenticate EVERY request; the snapshot rides
// back on that same response, so the gate stays synchronous and adds zero extra
// network hops (charter option (c), "compare vs the input the agent read via
// read_diagram, session-cached", realised via DO storage so it also survives a
// hibernation wake). Tradeoff: if the agent calls update_diagram WITHOUT ever
// reading the diagram, there's no baseline — the diagramType is unknown (parse
// pass-through) and the data-loss check is skipped. That's an accepted, honest
// gap (the tool description nudges the agent to read first); the alternative
// (force a macro round-trip just to fetch current content) would defeat C0's
// "gate before forwarding" purpose.

import { computeStats, normalizeDialect, parseDsl } from './parseDsl';
import type { DslError } from './parseDsl';

/**
 * Reject any replacement whose non-whitespace length drops below this
 * fraction of the current's. Corpus-validated 2026-07-10 (Track E1 sweep,
 * evidence/E1-dataloss-sweep.md): swept 0.40-0.95 against the labeled corpus
 * (10 data-loss rows, 91 legitimately-scored rows) — 0.80 gives 100% recall
 * (5/5) on the confirmed true truncations reachable by a length check, 0%
 * false positives (0/77) on legitimately-scored in-scope rows, and sits in
 * the middle of a 0%-FP plateau (0.75-0.85 all identical), leaving margin on
 * both sides. Corpus-labeled data-loss rows topped out around ratio ~0.75, so
 * 0.80 also clears the observed true-truncation ceiling. Was 0.4 (untuned
 * placeholder) before this sweep.
 */
export const DATA_LOSS_MIN_RATIO = 0.8;
/**
 * ...but only when the current diagram is non-trivial (>= this many
 * non-whitespace chars). Below it, a big proportional shrink is a small
 * absolute loss and plausibly a legitimate rewrite, so we don't fire — erring
 * toward catching only catastrophic truncation, per the charter ("err toward
 * only-catch-catastrophic to avoid false positives on legitimate
 * simplifications"). ~120 non-ws chars is roughly a 4-6 message sequence
 * diagram. Corpus-validated 2026-07-10: this floor is a no-op across
 * 80/120/200 on the available corpus — every data-loss and score>=4 row has
 * current-content well above 200 non-ws chars, so no swept value changes any
 * outcome. Left at 120 on priors; untested by this corpus for diagrams under
 * ~200 non-ws chars (no small-diagram case exists in it either direction).
 */
export const DATA_LOSS_MIN_CURRENT_NONWS = 120;

export interface DiagramSnapshot {
  /** The DiagramType the macro reported (e.g. 'Sequence' | 'Mermaid' | 'PlantUml'). */
  diagramType?: string;
  /** The current diagram DSL, as last read/applied. Absent -> no data-loss baseline. */
  dsl?: string;
}

export interface DiffSummary {
  participants_before: number;
  participants_after: number;
  messages_before: number;
  messages_after: number;
}

export type GuardResult =
  | {
      ok: false;
      reason: 'parse_error' | 'data_loss';
      message: string;
      /** Parse errors (reason === 'parse_error' only). */
      errors?: DslError[];
      /** Full DSL string lengths, in (current) / out (new) — mirrors the analytics event fields. */
      input_len?: number;
      output_len?: number;
    }
  | {
      ok: true;
      /** Present only where the dialect's parser makes it feasible (ZenUML, Mermaid). */
      diff?: DiffSummary;
      /** True when the dialect isn't one we parse — the op was passed through unchecked. */
      unvalidated?: true;
    };

function nonWhitespaceLength(s: string): number {
  return s.replace(/\s+/g, '').length;
}

/**
 * Run the guardrail on a proposed `newDsl` given the `snapshot` of current
 * diagram state. Never throws — mcpTools.ts turns an `ok:false` into a
 * structured ToolError.
 */
export async function guardUpdateDiagram(
  newDsl: string,
  snapshot: DiagramSnapshot | undefined,
): Promise<GuardResult> {
  const diagramType = snapshot?.diagramType;
  const currentDsl = snapshot?.dsl;

  // ---- C2: data-loss hard reject ----
  // Runs FIRST, for every diagramType, whenever a baseline snapshot exists.
  // This is a pure length comparison — it needs no parser, so it must not be
  // gated behind the dialect check below. (Track E1 sweep, 2026-07-10: the
  // guard previously ran this after the dialect pass-through, which made 2
  // real non-DSL (OpenApi) truncations in the corpus architecturally
  // unreachable — see evidence/E1-dataloss-sweep.md Finding 1. The parse gate
  // (C0) stays dialect-scoped since only zenuml/mermaid/plantuml have a
  // parser; this check does not.)
  if (typeof currentDsl === 'string') {
    const currentNonWs = nonWhitespaceLength(currentDsl);
    const newNonWs = nonWhitespaceLength(newDsl);
    if (currentNonWs >= DATA_LOSS_MIN_CURRENT_NONWS && newNonWs < DATA_LOSS_MIN_RATIO * currentNonWs) {
      const pct = Math.round((1 - newNonWs / currentNonWs) * 100);
      return {
        ok: false,
        reason: 'data_loss',
        message:
          `Rejected: the replacement is ${pct}% shorter than the current diagram ` +
          `(${currentDsl.length} -> ${newDsl.length} chars; ${currentNonWs} -> ${newNonWs} non-whitespace). ` +
          `This looks like accidental truncation, not an edit. Nothing was saved. ` +
          `If you truly mean to replace the whole diagram, send the complete new DSL.`,
        input_len: currentDsl.length,
        output_len: newDsl.length,
      };
    }
  }

  // Without a known dialect we cannot parse — pass through unvalidated rather
  // than block. (Charter: never block a dialect we can't parse.) The
  // data-loss check above already ran against this DSL, so this only gates
  // C0/C3, which genuinely need a parser.
  if (!diagramType || normalizeDialect(diagramType) === 'unknown') {
    return { ok: true, unvalidated: true };
  }

  // ---- C0: parse-before-submit ----
  const parsed = await parseDsl(diagramType, newDsl);
  if (!parsed.ok) {
    const first = parsed.errors[0];
    const where = first ? ` (line ${first.line}, col ${first.col})` : '';
    return {
      ok: false,
      reason: 'parse_error',
      message: `Rejected: the diagram DSL did not parse${where}: ${first?.message ?? 'syntax error'}. Nothing was saved.`,
      errors: parsed.errors,
      output_len: newDsl.length,
    };
  }
  if (parsed.unvalidated) {
    return { ok: true, unvalidated: true };
  }

  // ---- C3: semantic diff (info only) ----
  const statsAfter = parsed.stats;
  const statsBefore = typeof currentDsl === 'string' ? computeStats(diagramType, currentDsl) : undefined;
  if (statsBefore && statsAfter) {
    return {
      ok: true,
      diff: {
        participants_before: statsBefore.participants,
        participants_after: statsAfter.participants,
        messages_before: statsBefore.messages,
        messages_after: statsAfter.messages,
      },
    };
  }

  return { ok: true };
}
