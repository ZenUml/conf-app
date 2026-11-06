import { describe, expect, it } from 'vitest';
import { validateSequenceSyntax } from './validate';

const portalRoots = () => document.body.querySelectorAll('#headlessui-portal-root').length;

describe('validateSequenceSyntax', () => {
  it('returns valid for empty code', async () => {
    expect(await validateSequenceSyntax('')).toEqual({ valid: true, error: null, location: null });
  });

  it('returns valid for well-formed DSL', async () => {
    expect(await validateSequenceSyntax('A->B: hello')).toEqual({ valid: true, error: null, location: null });
  });

  it('reports the first and last error location for malformed DSL', async () => {
    const result = await validateSequenceSyntax('A->B.method(');

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/^Sequence syntax error: at line \d+, column \d+: /);
    expect(result.location).toMatchObject({
      startLine: expect.any(Number),
      startCol: expect.any(Number),
      endLine: expect.any(Number),
      endCol: expect.any(Number),
      message: result.error,
    });
    expect(result.location!.endCol).toBeGreaterThanOrEqual(10);
  });

  // Each call used to construct a renderer (`new ZenUml(div)`), which mounts a
  // React root and appends a headlessui portal root to document.body that is
  // never removed — one leak per keystroke-driven validation.
  it('does not add DOM to document.body across repeated calls', async () => {
    const before = portalRoots();
    const childrenBefore = document.body.children.length;

    for (const code of ['A->B: hi', 'A->B.method(', 'A->B: again']) {
      await validateSequenceSyntax(code);
    }

    expect(portalRoots()).toBe(before);
    expect(document.body.children.length).toBe(childrenBefore);
  });
});
