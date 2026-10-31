import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real npm mermaid, configured the way loadMermaid configures the vendored
// bundle, so the test sees the same global site config the renderer uses (#931).
vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const mermaid = (await import('mermaid')).default;
  return { loadMermaid: async () => mermaid };
});

import mermaid from 'mermaid';
import { validateMermaidSyntax } from './validate';
import { enqueueMermaid } from './mermaidQueue';

describe('validateMermaidSyntax leaves the renderer config alone (#931)', () => {
  beforeEach(() => {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  });

  it('keeps theme neutral and the default strict security level after validating', async () => {
    const result = await validateMermaidSyntax('graph TD; A-->B');

    expect(result.valid).toBe(true);
    const config = mermaid.mermaidAPI.getConfig();
    expect(config.theme).toBe('neutral');
    expect(config.securityLevel).toBe('strict');
  });

  it('still reports a syntax error', async () => {
    const result = await validateMermaidSyntax('graph TD; A-->');

    expect(result.valid).toBe(false);
  });

  it('waits for queued Mermaid work before parsing', async () => {
    const parse = vi.spyOn(mermaid, 'parse');
    let release!: () => void;
    const render = enqueueMermaid(() => new Promise<void>((resolve) => { release = resolve; }));

    const validation = validateMermaidSyntax('graph TD; A-->B');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(parse).not.toHaveBeenCalled();

    release();
    await render;
    await expect(validation).resolves.toMatchObject({ valid: true });
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });
});
