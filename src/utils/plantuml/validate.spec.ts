import { describe, it, expect, vi, afterEach } from 'vitest';
import { validatePlantUmlSyntax } from './validate';

describe('validatePlantUmlSyntax — carries SVG for viewer reuse', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns the fetched SVG on the valid path (lets the viewer skip a 2nd fetch)', async () => {
    const svg = '<svg id="ok"><text>diagram</text></svg>';
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(svg) }) as any;
    // unique code per run dodges the module-scoped 2s validation cache
    const code = `@startuml\nA -> B: hello ${Math.random()}\n@enduml`;
    const result = await validatePlantUmlSyntax(code);
    expect(result.valid).toBe(true);
    expect(result.svg).toBe(svg);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not carry an SVG when the server reports a syntax error', async () => {
    const errSvg = '<svg><text>Syntax Error? (unexpected)</text></svg>';
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve(errSvg) }) as any;
    const code = `@startuml\nBADTOKEN ${Math.random()}\n@enduml`;
    const result = await validatePlantUmlSyntax(code);
    expect(result.valid).toBe(false);
    expect(result.svg).toBeUndefined();
  });
});
