import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearPlantUmlSvgCache, fetchPlantUmlSvg } from './server';
import { svgUrl, pngUrl, PLANTUML_BASE } from './serverUrl';

const CODE = '@startuml\nAlice -> Bob\n@enduml';

describe('fetchPlantUmlSvg (#929)', () => {
  beforeEach(() => {
    clearPlantUmlSvgCache();
    window.fetch = vi.fn(() => Promise.resolve(new Response('<svg/>', { status: 200 }))) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('joins concurrent requests for the same code', async () => {
    const [a, b] = await Promise.all([fetchPlantUmlSvg(CODE), fetchPlantUmlSvg(`  ${CODE}\n`)]);
    expect(a).toEqual({ ok: true, status: 200, svgText: '<svg/>' });
    expect(b).toEqual(a);
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.fetch).mock.calls[0][0]).toMatch(/^https:\/\/www\.plantuml\.com\/plantuml\/svg\//);
  });

  it('reuses a completed response within the TTL and refetches after it', async () => {
    vi.useFakeTimers();
    await fetchPlantUmlSvg(CODE);
    vi.advanceTimersByTime(4000);
    await fetchPlantUmlSvg(CODE);
    expect(window.fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    await fetchPlantUmlSvg(CODE);
    expect(window.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns the body of a 400 so syntax errors can be read', async () => {
    window.fetch = vi.fn(() => Promise.resolve(new Response('Syntax Error?', { status: 400 }))) as typeof fetch;
    await expect(fetchPlantUmlSvg(CODE)).resolves.toEqual({ ok: false, status: 400, svgText: 'Syntax Error?' });
  });

  it('does not cache a network failure', async () => {
    window.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('<svg/>', { status: 200 })) as typeof fetch;
    await expect(fetchPlantUmlSvg(CODE)).rejects.toThrow('Failed to fetch');
    await expect(fetchPlantUmlSvg(CODE)).resolves.toMatchObject({ ok: true });
    expect(window.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('PlantUML server URLs', () => {
  it('keeps one base for svg and png', () => {
    expect(PLANTUML_BASE).toBe('https://www.plantuml.com/plantuml');
    expect(svgUrl('abc')).toBe('https://www.plantuml.com/plantuml/svg/abc');
    expect(pngUrl('abc')).toBe('https://www.plantuml.com/plantuml/png/abc');
  });
});
