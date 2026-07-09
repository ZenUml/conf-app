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
    expect(DATA_LOSS_MIN_RATIO).toBe(0.4);
    expect(DATA_LOSS_MIN_CURRENT_NONWS).toBe(120);
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
