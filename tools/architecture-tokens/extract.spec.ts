import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import { extractParticipants, extractZenUmlParticipants, isSequenceDiagram } from './extract';

describe('extractParticipants', () => {
  it('extracts a plain participant with id equal to label', () => {
    const out = extractParticipants('sequenceDiagram\n  participant A\n');
    expect(out).toEqual([
      { actorId: 'A', rawLabel: 'A', declKind: 'participant', created: false, boxName: null, lineNumber: 2 },
    ]);
  });

  it('splits `id as label` into actorId and rawLabel', () => {
    const out = extractParticipants('sequenceDiagram\n  participant PA as Partner App\n');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ actorId: 'PA', rawLabel: 'Partner App' });
  });

  it('keeps a bare multi-word label as both id and label', () => {
    const out = extractParticipants('sequenceDiagram\n  participant Payment Service\n');
    expect(out[0]).toMatchObject({ actorId: 'Payment Service', rawLabel: 'Payment Service' });
  });

  it('extracts `actor` declarations with declKind actor', () => {
    const out = extractParticipants('sequenceDiagram\n  actor U as User\n');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ actorId: 'U', rawLabel: 'User', declKind: 'actor' });
  });

  it('extracts `create participant` and `create actor` with created=true', () => {
    const out = extractParticipants('sequenceDiagram\n  create participant JSB as JS Bridge\n  create actor Bot\n');
    expect(out.map((o) => [o.actorId, o.declKind, o.created])).toEqual([
      ['JSB', 'participant', true],
      ['Bot', 'actor', true],
    ]);
  });

  it('records the enclosing box name and clears it after `end`', () => {
    const src = 'sequenceDiagram\n  box Payments\n    participant PAY\n  end\n  participant OUT\n';
    const out = extractParticipants(src);
    expect(out.map((o) => [o.actorId, o.boxName])).toEqual([['PAY', 'Payments'], ['OUT', null]]);
  });

  it('ignores comment lines and `destroy` statements', () => {
    const src = 'sequenceDiagram\n  %% participant Ghost\n  participant A\n  destroy A\n';
    expect(extractParticipants(src).map((o) => o.actorId)).toEqual(['A']);
  });

  it('does not report actors that appear only in messages', () => {
    const src = 'sequenceDiagram\n  participant A\n  Undeclared->>A: hi\n';
    expect(extractParticipants(src).map((o) => o.actorId)).toEqual(['A']);
  });

  it('treats `;` as a statement separator like Mermaid does', () => {
    const out = extractParticipants('sequenceDiagram\n  participant X; participant Y\n');
    expect(out.map((o) => [o.actorId, o.lineNumber])).toEqual([['X', 2], ['Y', 2]]);
  });

  it('matches mermaid getActors() for every declaration form', async () => {
    const src = [
      '%%{init: {"theme":"neutral"}}%%',
      'sequenceDiagram',
      '  participant A',
      '  participant PA as Partner App',
      '  participant Payment Service',
      '  participant "Quoted Id" as Q',
      '  participant BR as Line<br/>Break',
      '  actor U as User',
      '  create participant JSB as JS Bridge',
      '  PA->>JSB: init',
      '  box Aqua Payments',
      '    participant PAY',
      '  end',
      '  loop daily',
      '    participant L',
      '  end',
      '  Note over A: participant NotOne',
      '  A->>PAY: pay',
    ].join('\n');
    mermaid.initialize({ startOnLoad: false });
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(src);
    const oracle = [...(diagram.db as any).getActors().values()].map((a: any) => ({
      actorId: a.name, rawLabel: a.description, declKind: a.type, boxName: a.box?.name ?? null,
    }));
    const ours = extractParticipants(src).map(({ actorId, rawLabel, declKind, boxName }) => ({ actorId, rawLabel, declKind, boxName }));
    expect(ours).toEqual(oracle);
  });
});

describe('isSequenceDiagram', () => {
  it('accepts a leading %% directive before sequenceDiagram', () => {
    expect(isSequenceDiagram('%%{init: {"theme":"dark"}}%%\nsequenceDiagram\n  A->>B: x')).toBe(true);
  });
  it('accepts YAML frontmatter before sequenceDiagram', () => {
    expect(isSequenceDiagram('---\ntitle: Checkout\n---\nsequenceDiagram\n  A->>B: x')).toBe(true);
  });
  it('rejects other diagram kinds and near-miss keywords', () => {
    expect(isSequenceDiagram('flowchart TD\n  A-->B')).toBe(false);
    expect(isSequenceDiagram('sequenceDiagramX\n')).toBe(false);
  });
});

describe('extractZenUmlParticipants', () => {
  it('extracts only explicit AST declarations, preserving a declared alias as provenance', () => {
    const src = [
      '@Actor Customer',
      '@Boundary Gateway as "Public Gateway"',
      'group Storage {',
      '  @Database Ledger as "Ledger Store"',
      '}',
      'Customer->Undeclared: message-only lifeline',
    ].join('\n');

    expect(extractZenUmlParticipants(src)).toEqual([
      { actorId: 'Customer', rawLabel: 'Customer', declKind: 'participant', created: false, boxName: null, lineNumber: 1 },
      { actorId: 'Gateway', rawLabel: 'Public Gateway', declKind: 'participant', created: false, boxName: null, lineNumber: 2 },
      { actorId: 'Ledger', rawLabel: 'Ledger Store', declKind: 'participant', created: false, boxName: 'Storage', lineNumber: 4 },
    ]);
  });

  it('returns no rows for invalid DSL or messages without explicit declarations', () => {
    expect(extractZenUmlParticipants('@Actor\n')).toEqual([]);
    expect(extractZenUmlParticipants('Caller->Callee: message')).toEqual([]);
  });
});
