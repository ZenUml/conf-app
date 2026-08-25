import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateMermaidSyntax } from '@/utils/mermaid/validate';
import { validateMermaidFlowchart } from './validateMermaidFlowchart';

vi.mock('@/utils/mermaid/validate', () => ({
  validateMermaidSyntax: vi.fn(),
}));

const validate = vi.mocked(validateMermaidSyntax);

describe('validateMermaidFlowchart', () => {
  beforeEach(() => validate.mockReset());

  it('uses Mermaid public syntax validation before accepting the owned Flowchart model', async () => {
    validate.mockResolvedValue({ valid: false, error: 'Parse error', location: null });

    await expect(validateMermaidFlowchart('flowchart LR\n  A -->')).resolves.toEqual({
      kind: 'invalid',
      error: 'Parse error',
    });
    expect(validate).toHaveBeenCalledWith('flowchart LR\n  A -->');
  });

  it('returns the node-only canonical model only after Mermaid accepts the source', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });

    await expect(validateMermaidFlowchart('flowchart LR\n  A --> B')).resolves.toEqual(expect.objectContaining({
      kind: 'ok',
      model: expect.objectContaining({ kind: 'flowchart' }),
    }));
  });
});
