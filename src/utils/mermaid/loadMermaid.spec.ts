import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadMermaid, __resetMermaidLoaderForTests } from './loadMermaid';

// Production evidence, 2026-08-10: tenant `onstage` logged three
// `The requested module '…'` failures plus one `r.initialize is not a function`
// inside four minutes, and tenant `zeptonow` logged
// `Failed to fetch dynamically imported module: …`. The second class is a
// transient CDN fetch; the first is not. Both were terminal for the whole
// iframe session because the in-flight promise was cached on the failure path
// as well as the success path, so every later macro on the page replayed the
// same rejection without ever re-attempting the import.

describe('loadMermaid', () => {
  beforeEach(() => {
    __resetMermaidLoaderForTests();
  });

  it('registers the lazy ZenUML extension once before exposing the shared renderer', async () => {
    const registerExternalDiagrams = vi.fn().mockResolvedValue(undefined);
    const instance = { initialize: vi.fn(), registerExternalDiagrams };
    const importer = vi.fn().mockResolvedValue({ default: instance });
    await Promise.all([loadMermaid({ importer }), loadMermaid({ importer })]);
    expect(registerExternalDiagrams).toHaveBeenCalledTimes(1);
    const [extensions, options] = registerExternalDiagrams.mock.calls[0];
    expect(options).toEqual({ lazyLoad: true });
    expect(extensions[0].id).toBe('zenuml');
    expect(extensions[0].detector('zenuml\nAlice->Bob: Hello')).toBe(true);
    expect(extensions[0].detector('flowchart LR\nA-->B')).toBe(false);
  });

  it('caches the instance across calls so the import runs once', async () => {
    const initialize = vi.fn();
    const registerExternalDiagrams = vi.fn().mockResolvedValue(undefined);
    const importer = vi.fn(() => Promise.resolve({ default: { initialize, registerExternalDiagrams } }));

    const first = await loadMermaid({ importer });
    const second = await loadMermaid({ importer });

    expect(first).toBe(second);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('does not cache an instance when extension registration fails', async () => {
    const registerExternalDiagrams = vi.fn()
      .mockRejectedValueOnce(new Error('extension registration failed'))
      .mockResolvedValueOnce(undefined);
    const instance = { initialize: vi.fn(), registerExternalDiagrams };
    const importer = vi.fn().mockResolvedValue({ default: instance });
    await expect(loadMermaid({ importer, retries: 0 })).rejects.toThrow('extension registration failed');
    await expect(loadMermaid({ importer, retries: 0 })).resolves.toBe(instance);
    expect(registerExternalDiagrams).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight import between concurrent callers', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: { initialize: vi.fn(), registerExternalDiagrams: vi.fn().mockResolvedValue(undefined) } }));

    const [a, b] = await Promise.all([loadMermaid({ importer }), loadMermaid({ importer })]);

    expect(a).toBe(b);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('retries a failed import on the next call instead of replaying the rejection', async () => {
    const initialize = vi.fn();
    const registerExternalDiagrams = vi.fn().mockResolvedValue(undefined);
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: { initialize, registerExternalDiagrams } });

    await expect(loadMermaid({ importer, retries: 0 })).rejects.toThrow('Failed to fetch');
    // The second macro on the same page must get a real attempt, not the
    // cached rejection from the first.
    await expect(loadMermaid({ importer, retries: 0 })).resolves.toEqual({ initialize, registerExternalDiagrams });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('retries within a single call before giving up', async () => {
    const initialize = vi.fn();
    const registerExternalDiagrams = vi.fn().mockResolvedValue(undefined);
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: { initialize, registerExternalDiagrams } });

    await expect(
      loadMermaid({ importer, retries: 1, retryDelayMs: 0 }),
    ).resolves.toEqual({ initialize, registerExternalDiagrams });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('rejects with a message naming the resolved URL when the module has no usable export', async () => {
    // Firefox 153 reported `r.initialize is not a function` — `mod.default`
    // resolved to something without the mermaid API. Name the URL so the next
    // occurrence is diagnosable from the event alone.
    const importer = vi.fn(() => Promise.resolve({ notMermaid: true }));

    await expect(loadMermaid({ importer, retries: 0 })).rejects.toThrow(/mermaid module/i);
    await expect(loadMermaid({ importer, retries: 0 })).rejects.toThrow(/vendor\/mermaid/);
  });
});
