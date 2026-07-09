import { describe, it, expect } from 'vitest';
import {
  guardUpdateDiagram,
  DATA_LOSS_MIN_RATIO,
  DATA_LOSS_MIN_CURRENT_NONWS,
} from './updateDiagramGuard';

// A deliberately substantial current diagram: non-whitespace length is well
// over DATA_LOSS_MIN_CURRENT_NONWS so the data-loss guard is armed.
const BIG_CURRENT_DSL = [
  'Alice->Bob: request authentication token',
  'Bob->AuthService: validate the supplied credentials',
  'AuthService->Bob: token issued successfully',
  'Bob->Alice: here is your fresh session token',
  'Alice->Bob: fetch the current user profile',
  'Bob->Alice: profile payload has been returned',
].join('\n');

function nonWs(s: string): number {
  return s.replace(/\s+/g, '').length;
}

/**
 * Build a valid, parseable ZenUML diagram whose non-whitespace length is
 * EXACTLY `targetNonWs` — whole `Alice->Bob: ...` statement lines, topped up
 * with a harmless trailing `// xxxx` comment for the remainder. Lets the
 * ratio-boundary tests below assert exact percentages of the 0.80 threshold
 * instead of approximate ones.
 */
function buildZenumlOfLength(targetNonWs: number): string {
  const lines: string[] = [];
  let total = 0;
  let i = 0;
  for (;;) {
    i++;
    const line = `Alice->Bob: request number ${i} for authentication details`;
    const lineNonWs = nonWs(line);
    if (total + lineNonWs > targetNonWs) break;
    lines.push(line);
    total += lineNonWs;
  }
  const remaining = targetNonWs - total;
  if (remaining > 0) {
    // "//" contributes 2 non-ws chars; pad the rest with 'x'.
    lines.push(`// ${'x'.repeat(Math.max(0, remaining - 2))}`);
  }
  return lines.join('\n');
}

describe('guardUpdateDiagram — parse gate (C0)', () => {
  it('rejects DSL that does not parse, with structured line/col errors and no forward', async () => {
    const r = await guardUpdateDiagram('A.method(', { diagramType: 'Sequence', dsl: 'A->B: hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('parse_error');
      expect(r.errors?.[0].line).toBe(1);
      expect(r.message).toMatch(/did not parse/i);
    }
  });

  it('accepts valid DSL', async () => {
    const r = await guardUpdateDiagram('A->B: hi', { diagramType: 'Sequence', dsl: 'A->B: hi' });
    expect(r.ok).toBe(true);
  });
});

describe('guardUpdateDiagram — data-loss hard reject (C2)', () => {
  it('rejects a catastrophic (~82%) truncation against a non-trivial current diagram', async () => {
    const tiny = 'A->B: hi'; // ~6 non-ws chars vs. >150 for BIG_CURRENT_DSL
    const r = await guardUpdateDiagram(tiny, { diagramType: 'Sequence', dsl: BIG_CURRENT_DSL });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('data_loss');
      expect(r.input_len).toBe(BIG_CURRENT_DSL.length);
      expect(r.output_len).toBe(tiny.length);
      expect(r.message).toMatch(/shorter/i);
    }
  });

  it('passes a mild shrink (well above the 40% floor)', async () => {
    // Drop only the last line -> still ~83% of the original content.
    const mild = BIG_CURRENT_DSL.split('\n').slice(0, 5).join('\n');
    const r = await guardUpdateDiagram(mild, { diagramType: 'Sequence', dsl: BIG_CURRENT_DSL });
    expect(r.ok).toBe(true);
  });

  it('does NOT fire on a tiny current diagram (below the non-trivial floor) — avoids false positives', async () => {
    const currentSmall = 'A->B: hi\nB->C: yo'; // non-ws well under the floor
    const r = await guardUpdateDiagram('A->B: x', { diagramType: 'Sequence', dsl: currentSmall });
    expect(r.ok).toBe(true);
  });

  it('threshold constants are the documented values', () => {
    expect(DATA_LOSS_MIN_RATIO).toBe(0.8);
    expect(DATA_LOSS_MIN_CURRENT_NONWS).toBe(120);
  });

  describe('0.80 ratio boundary (Track E1 corpus sweep, 2026-07-10)', () => {
    const CURRENT_1000 = buildZenumlOfLength(1000);

    it('rejects a shrink to exactly ratio 0.79 (just under the 0.80 floor)', async () => {
      const shrunk79 = buildZenumlOfLength(790); // 790/1000 = 0.79
      const r = await guardUpdateDiagram(shrunk79, { diagramType: 'Sequence', dsl: CURRENT_1000 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('data_loss');
    });

    it('passes a shrink to exactly ratio 0.81 (just over the 0.80 floor)', async () => {
      const shrunk81 = buildZenumlOfLength(810); // 810/1000 = 0.81
      const r = await guardUpdateDiagram(shrunk81, { diagramType: 'Sequence', dsl: CURRENT_1000 });
      expect(r.ok).toBe(true);
    });
  });
});

describe('guardUpdateDiagram — data-loss now covers non-DSL diagram types', () => {
  // Track E1 sweep, evidence/E1-dataloss-sweep.md Finding 1: 2 real OpenApi
  // truncations in the corpus were architecturally unreachable because the
  // guard used to pass non-DSL diagramTypes through BEFORE the length check.
  // The check runs first now, so it fires here regardless of dialect.
  const BIG_OPENAPI_DSL = [
    'openapi: 3.0.0',
    'info:',
    '  title: Example API',
    '  version: 1.0.0',
    'paths:',
    '  /widgets:',
    '    get:',
    '      summary: list all widgets in the catalog',
    '      responses:',
    '        "200":',
    '          description: a paginated list of widgets',
  ].join('\n');

  it('rejects a catastrophic truncation on a non-DSL type (OpenApi)', async () => {
    const truncated = '{"openapi": "3.0.0"'; // cut off mid-token, like the corpus rows
    const r = await guardUpdateDiagram(truncated, { diagramType: 'OpenApi', dsl: BIG_OPENAPI_DSL });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('data_loss');
      expect(r.input_len).toBe(BIG_OPENAPI_DSL.length);
      expect(r.output_len).toBe(truncated.length);
    }
  });

  it('still passes through unvalidated for a non-DSL type with no truncation', async () => {
    const revised = BIG_OPENAPI_DSL.replace('Example API', 'Example API v2');
    const r = await guardUpdateDiagram(revised, { diagramType: 'OpenApi', dsl: BIG_OPENAPI_DSL });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unvalidated).toBe(true);
  });
});

describe('guardUpdateDiagram — semantic diff (C3, info only)', () => {
  it('attaches before/after participant + message counts on success', async () => {
    const r = await guardUpdateDiagram('A->B: x\nB->C: y', { diagramType: 'Sequence', dsl: 'A->B: x' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.diff).toEqual({
        participants_before: 2,
        participants_after: 3,
        messages_before: 1,
        messages_after: 2,
      });
    }
  });

  it('omits the diff when there is no baseline snapshot dsl', async () => {
    const r = await guardUpdateDiagram('A->B: x', { diagramType: 'Sequence' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.diff).toBeUndefined();
  });
});

describe('guardUpdateDiagram — never blocks what it cannot parse', () => {
  it('passes through unvalidated when no snapshot at all (no dialect known)', async () => {
    const r = await guardUpdateDiagram('anything at all', undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unvalidated).toBe(true);
  });

  it('passes through unvalidated for an unparseable dialect (e.g. Graph)', async () => {
    const r = await guardUpdateDiagram('<mxGraphModel>...</mxGraphModel>', { diagramType: 'Graph', dsl: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unvalidated).toBe(true);
  });
});
