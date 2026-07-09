import { describe, it, expect } from 'vitest';
import { parseDsl, normalizeDialect, computeStats, zenumlStats, mermaidStats } from './parseDsl';

describe('normalizeDialect', () => {
  it('maps DiagramType enum values (macro-reported) to parser families', () => {
    expect(normalizeDialect('Sequence')).toBe('zenuml');
    expect(normalizeDialect('Mermaid')).toBe('mermaid');
    expect(normalizeDialect('PlantUml')).toBe('plantuml');
  });
  it('accepts lowercase dialect names too', () => {
    expect(normalizeDialect('zenuml')).toBe('zenuml');
    expect(normalizeDialect('mermaid')).toBe('mermaid');
    expect(normalizeDialect('plantuml')).toBe('plantuml');
  });
  it('maps anything we cannot parse to "unknown"', () => {
    expect(normalizeDialect('Graph')).toBe('unknown');
    expect(normalizeDialect('OpenApi')).toBe('unknown');
    expect(normalizeDialect('AsyncApi')).toBe('unknown');
    expect(normalizeDialect('Embed')).toBe('unknown');
    expect(normalizeDialect(undefined)).toBe('unknown');
    expect(normalizeDialect('')).toBe('unknown');
  });
});

describe('parseDsl — ZenUML (Sequence)', () => {
  it('accepts valid DSL and returns structural stats', async () => {
    const r = await parseDsl('Sequence', 'A->B: hi\nB->C: yo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stats).toEqual({ participants: 3, messages: 2 });
      expect(r.unvalidated).toBeUndefined();
    }
  });

  it('rejects a hard syntax error with a structured line/col error', async () => {
    const r = await parseDsl('Sequence', 'if x { A->B: y'); // missing '(' around condition
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
      expect(r.errors[0].line).toBe(1);
      expect(typeof r.errors[0].col).toBe('number');
      expect(typeof r.errors[0].message).toBe('string');
      expect(r.errors[0].message.length).toBeGreaterThan(0);
    }
  });

  it('rejects an unterminated method call with a line/col error', async () => {
    const r = await parseDsl('Sequence', 'A.method(');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].line).toBe(1);
  });
});

describe('parseDsl — Mermaid', () => {
  it('accepts a valid flowchart and returns stats', async () => {
    const r = await parseDsl('Mermaid', 'flowchart TD\n  A-->B\n  B-->C');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stats).toBeDefined();
      expect(r.stats!.messages).toBe(2);
      expect(r.stats!.participants).toBeGreaterThanOrEqual(3);
    }
  });

  it('accepts a valid sequenceDiagram', async () => {
    const r = await parseDsl('Mermaid', 'sequenceDiagram\n  Alice->>Bob: hi\n  Bob-->>Alice: ok');
    expect(r.ok).toBe(true);
  });

  it('rejects an invalid sequenceDiagram with a line number', async () => {
    const r = await parseDsl('Mermaid', 'sequenceDiagram\n  Alice-->Bob hi');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].line).toBe(2);
      expect(typeof r.errors[0].message).toBe('string');
    }
  });
});

describe('parseDsl — PlantUML (structural lint, no stats)', () => {
  it('accepts a balanced @startuml/@enduml envelope', async () => {
    const r = await parseDsl('PlantUml', '@startuml\nA -> B: hi\n@enduml');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats).toBeUndefined(); // charter: plantuml stats skipped
  });

  it('rejects a missing envelope', async () => {
    const r = await parseDsl('PlantUml', 'A -> B: hi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /@start|@end/.test(e.message))).toBe(true);
  });

  it('rejects an unbalanced brace with a line/col', async () => {
    const r = await parseDsl('PlantUml', '@startuml\nclass Foo {\n@enduml');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /Unclosed|Unbalanced/.test(e.message))).toBe(true);
  });
});

describe('parseDsl — unknown/unparseable dialects pass through', () => {
  it('never blocks a dialect we cannot parse (returns ok + unvalidated)', async () => {
    for (const t of ['Graph', 'OpenApi', 'AsyncApi', 'Embed', 'somethingNew']) {
      const r = await parseDsl(t, 'literally anything <xml/>');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.unvalidated).toBe(true);
        expect(r.stats).toBeUndefined();
      }
    }
  });
});

describe('computeStats / structural counters', () => {
  it('zenumlStats ignores comments and control-flow lines', () => {
    const dsl = `// header comment
A.method() {
  B->C: hello
  if (cond) {
    C->D: world
  }
}`;
    const s = zenumlStats(dsl);
    // messages: A.method(), B->C, C->D  = 3; participants: A,B,C,D = 4
    expect(s.messages).toBe(3);
    expect(s.participants).toBe(4);
  });

  it('mermaidStats counts arrows as messages and endpoints as participants', () => {
    const s = mermaidStats('flowchart LR\n  A-->B\n  B-->C\n  C-->A');
    expect(s.messages).toBe(3);
    expect(s.participants).toBe(3);
  });

  it('computeStats returns undefined for skipped/unknown dialects', () => {
    expect(computeStats('PlantUml', '@startuml\nA->B\n@enduml')).toBeUndefined();
    expect(computeStats('Graph', 'x')).toBeUndefined();
  });
});
