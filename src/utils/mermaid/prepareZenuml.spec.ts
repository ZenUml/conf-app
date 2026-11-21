import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPrepareZenumlForTests,
  IMPORT_CORE_TIMEOUT_MS,
  isZenumlMermaidSource,
  LOAD_ASSETS_TIMEOUT_MS,
  prepareZenumlForMermaid,
} from './prepareZenuml';

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

  it('stops waiting for fonts and icons LOAD_ASSETS_TIMEOUT_MS after core loads', async () => {
    vi.useFakeTimers();
    try {
      const core = fakeCore();
      core.ensureDiagramFontsLoaded.mockImplementation(() => new Promise<void>(() => {}));
      let settled = false;
      const done = prepareZenumlForMermaid('zenuml\n@VPC A', async () => core).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(LOAD_ASSETS_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the asset budget only once core has downloaded', async () => {
    vi.useFakeTimers();
    try {
      const core = fakeCore();
      core.ensureDiagramIconsLoaded.mockImplementation(() => new Promise<void>(() => {}));
      let settled = false;
      const slowImport = () => new Promise<typeof core>((resolve) => setTimeout(() => resolve(core), 5000));
      const done = prepareZenumlForMermaid('zenuml\n@VPC A', slowImport).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(5000 + LOAD_ASSETS_TIMEOUT_MS - 1);
      expect(core.ensureDiagramIconsLoaded).toHaveBeenCalled();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up IMPORT_CORE_TIMEOUT_MS into a stalled core download', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const done = prepareZenumlForMermaid('zenuml\nA->B', () => new Promise(() => {})).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(IMPORT_CORE_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never rejects when core fails to load', async () => {
    await expect(
      prepareZenumlForMermaid('zenuml\nA->B', async () => {
        throw new Error('chunk load failed');
      }),
    ).resolves.toBeUndefined();
  });
});
