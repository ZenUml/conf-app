import { describe, expect, it } from 'vitest';
import { guardrailErrorKindOf, keptPct, mermaidDslKindOf } from './guardTelemetry';
import { guardrailDetailOf } from './oauth/headlessMcp';
import { HeadlessToolError } from './oauth/headlessTools';

describe('guardrailErrorKindOf', () => {
  it('names Mermaid refusing a diagram type it does not know', () => {
    expect(guardrailErrorKindOf('No diagram type detected matching given configuration for text: zenuml')).toBe(
      'unknown_diagram',
    );
  });

  it('names an error at the end of the source', () => {
    expect(guardrailErrorKindOf("Parse error on line 4: Expecting 'SPACE', got 'EOF'")).toBe('unexpected_end');
    expect(guardrailErrorKindOf('Missing @end... closing directive')).toBe('unexpected_end');
    expect(guardrailErrorKindOf("Unclosed '{'")).toBe('unexpected_end');
  });

  it('calls every other parser error a syntax error', () => {
    expect(guardrailErrorKindOf("Parse error on line 2: Expecting 'NEWLINE', got 'NODE_STRING'")).toBe('syntax');
  });

  it('says nothing without a message', () => {
    expect(guardrailErrorKindOf(undefined)).toBeUndefined();
  });
});

describe('mermaidDslKindOf', () => {
  it('reads the keyword past front matter, directives and comments', () => {
    const dsl = '---\ntitle: x\n---\n%%{init: {"theme": "dark"}}%%\n%% note\nflowchart TD\n  A --> B';
    expect(mermaidDslKindOf(dsl)).toBe('flowchart');
  });

  it('knows zenuml blocks and hyphenated keywords', () => {
    expect(mermaidDslKindOf('zenuml\n  A.b()')).toBe('zenuml');
    expect(mermaidDslKindOf('stateDiagram-v2\n  [*] --> A')).toBe('stateDiagram-v2');
  });

  it('never reports a word that is not a Mermaid keyword', () => {
    expect(mermaidDslKindOf('AcmeSecretProject --> B')).toBe('other');
    expect(mermaidDslKindOf('   \n')).toBe('empty');
  });
});

describe('keptPct', () => {
  it('rounds the share kept, and has no answer without a baseline', () => {
    expect(keptPct(200, 150)).toBe(75);
    expect(keptPct(0, 10)).toBeUndefined();
  });
});

describe('guardrailDetailOf', () => {
  it('describes a Mermaid parse refusal without quoting the source', () => {
    const failure = new HeadlessToolError('Rejected', 'guardrail_rejected', {
      reason: 'parse_error',
      errors: [{ line: 1, col: 0, message: 'No diagram type detected matching given configuration for text: zenuml' }],
      output_len: 12,
      diagramType: 'Mermaid',
    });
    const detail = guardrailDetailOf(failure, { dsl: 'zenuml\n  A.b()' });
    expect(detail).toEqual({
      inputLen: undefined,
      outputLen: 12,
      keptPct: undefined,
      errorKind: 'unknown_diagram',
      dslKind: 'zenuml',
    });
  });

  it('gives no Mermaid keyword for other diagram types', () => {
    const failure = new HeadlessToolError('Rejected', 'guardrail_rejected', {
      reason: 'data_loss',
      input_len: 400,
      output_len: 100,
      kept_pct: 25,
      diagramType: 'Sequence',
    });
    expect(guardrailDetailOf(failure, { dsl: 'A.b()' })).toEqual({
      inputLen: 400,
      outputLen: 100,
      keptPct: 25,
      errorKind: undefined,
      dslKind: undefined,
    });
  });

  it('is empty for a refusal the guard did not make', () => {
    expect(guardrailDetailOf(new HeadlessToolError('x', 'bad_params'), { dsl: 'flowchart' })).toEqual({});
  });
});
