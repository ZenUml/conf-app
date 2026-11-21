import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPrepareZenumlForTests, isZenumlMermaidSource, prepareZenumlForMermaid } from './prepareZenuml';

function fakeCore() {
  return {
    default: { setDiagramFontUrl: vi.fn() },
    ensureDiagramFontsLoaded: vi.fn(async () => {}),
    ensureDiagramIconsLoaded: vi.fn(async (_code: string) => {}),
  };
}

describe('isZenumlMermaidSource', () => {
  it.each([
    ['zenuml\n@VPC A', true],
    ['  zenuml\nA->B', true],
    ['%%{init: {"theme":"dark"}}%%\nzenuml\nA->B', true],
    ['---\ntitle: T\n---\nzenuml\nA->B', true],
    ['flowchart LR\nA-->B', false],
    ['sequenceDiagram\nA->>B: zenuml', false],
    ['zenumlish', false],
  ])('%j -> %s', (source, expected) => {
    expect(isZenumlMermaidSource(source)).toBe(expected);
  });
});

describe('prepareZenumlForMermaid', () => {
  beforeEach(() => __resetPrepareZenumlForTests());

  it('does not load core for other Mermaid diagrams', async () => {
    const importCore = vi.fn();
    await prepareZenumlForMermaid('flowchart LR\nA-->B', importCore);
    expect(importCore).not.toHaveBeenCalled();
  });

  it('configures fonts once and loads fonts and the icons the source uses', async () => {
    const core = fakeCore();
    const source = 'zenuml\n@VPC A\n@RDS DB\nA->DB: q';
    await prepareZenumlForMermaid(source, async () => core);
    await prepareZenumlForMermaid(source, async () => core);
    expect(core.default.setDiagramFontUrl).toHaveBeenCalledTimes(2); // IBM Plex + MS Sans, first call only
    expect(core.ensureDiagramFontsLoaded).toHaveBeenCalledTimes(2);
    expect(core.ensureDiagramIconsLoaded).toHaveBeenCalledWith(source);
  });

  it('never rejects when core fails to load', async () => {
    await expect(
      prepareZenumlForMermaid('zenuml\nA->B', async () => {
        throw new Error('chunk load failed');
      }),
    ).resolves.toBeUndefined();
  });
});
