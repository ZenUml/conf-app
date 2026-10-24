import { describe, it, expect } from 'vitest';
import { findIgnoredInitDirective } from '@/utils/mermaid/initDirective';

const body = '\nflowchart TB\n  A --> B';

// Ground truth, measured against the real mermaid runtime in a browser
// (2026-09-07, vendor/mermaid/mermaid.esm.min.mjs): `mermaid.parse` returns OK
// for ALL FOUR of these, but only the single-quoted one actually takes effect.
// The other three are silently discarded and the diagram renders with defaults.
describe('findIgnoredInitDirective', () => {
  it('flags the shape that cost a customer their layout — a missing value', () => {
    const code = '%%{init: {"flowchart": {"nodeSpacing": , "rankSpacing": 70}}}%%' + body;

    const found = findIgnoredInitDirective(code);

    expect(found).not.toBeNull();
    expect(found!.line).toBe(1);
    expect(found!.from).toBe(0);
    expect(found!.to).toBe(code.indexOf('%%\n') + 2);
  });

  it('flags an unquoted key', () => {
    expect(findIgnoredInitDirective('%%{init: {theme: "forest"}}%%' + body)).not.toBeNull();
  });

  it('flags a trailing comma', () => {
    expect(findIgnoredInitDirective('%%{init: {"theme": "forest",}}%%' + body)).not.toBeNull();
  });

  it('does NOT flag single quotes — mermaid accepts them and applies the directive', () => {
    expect(findIgnoredInitDirective("%%{init: {'theme': 'forest'}}%%" + body)).toBeNull();
  });

  it('does NOT flag a well-formed directive', () => {
    const code =
      '%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "nodeSpacing": 80}}}%%' + body;

    expect(findIgnoredInitDirective(code)).toBeNull();
  });

  it('accepts the `initialize` spelling and surrounding whitespace', () => {
    expect(findIgnoredInitDirective('%%{ initialize : {"theme": "base"} }%%' + body)).toBeNull();
    expect(findIgnoredInitDirective('%%{ initialize : {"theme": } }%%' + body)).not.toBeNull();
  });

  it('finds a directive that is not on the first line', () => {
    const code = 'flowchart TB\n%%{init: {"theme": }}%%\n  A --> B';

    const found = findIgnoredInitDirective(code);

    expect(found).not.toBeNull();
    expect(found!.line).toBe(2);
  });

  it('returns null when there is no directive at all', () => {
    expect(findIgnoredInitDirective('flowchart TB\n  A --> B')).toBeNull();
    expect(findIgnoredInitDirective('')).toBeNull();
  });

  it('reports the offending text so the message can quote it', () => {
    const found = findIgnoredInitDirective('%%{init: {"theme": }}%%' + body);

    expect(found!.raw).toBe('{"theme": }');
  });
});
