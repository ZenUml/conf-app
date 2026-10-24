import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { isPlantUmlLocalRendererEnabled } from '@/apis/aiTitleFeatureFlag';
import { plantUmlRenderer, resetPlantUmlRendererForTests, PLANTUML_RENDERER_STORAGE_KEY } from './renderer';

vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isPlantUmlLocalRendererEnabled: vi.fn() }));

describe('plantUmlRenderer (ADR-0010)', () => {
  beforeEach(() => {
    vi.mocked(isPlantUmlLocalRendererEnabled).mockReset().mockResolvedValue(false);
    resetPlantUmlRendererForTests();
  });

  afterEach(() => {
    localStorage.removeItem(PLANTUML_RENDERER_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('follows the Forge flag', async () => {
    await expect(plantUmlRenderer()).resolves.toBe('server');
    resetPlantUmlRendererForTests();
    vi.mocked(isPlantUmlLocalRendererEnabled).mockResolvedValue(true);
    await expect(plantUmlRenderer()).resolves.toBe('local');
  });

  it('asks the flag once per iframe', async () => {
    await plantUmlRenderer();
    await plantUmlRenderer();
    expect(isPlantUmlLocalRendererEnabled).toHaveBeenCalledTimes(1);
  });

  it('keeps the server when the flag lookup rejects', async () => {
    vi.mocked(isPlantUmlLocalRendererEnabled).mockRejectedValue(new Error('down'));
    await expect(plantUmlRenderer()).resolves.toBe('server');
  });

  it('lets localStorage override the flag either way', async () => {
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'local');
    await expect(plantUmlRenderer()).resolves.toBe('local');
    vi.mocked(isPlantUmlLocalRendererEnabled).mockResolvedValue(true);
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'server');
    await expect(plantUmlRenderer()).resolves.toBe('server');
    expect(isPlantUmlLocalRendererEnabled).not.toHaveBeenCalled();
  });

  it('ignores an unknown override value', async () => {
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'yes');
    await expect(plantUmlRenderer()).resolves.toBe('server');
  });

  it('lets the flag decide when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.mocked(isPlantUmlLocalRendererEnabled).mockResolvedValue(true);
    await expect(plantUmlRenderer()).resolves.toBe('local');
  });
});
