import { describe, it, expect, afterEach, vi } from 'vitest';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { plantUmlRenderer, PLANTUML_RENDERER_STORAGE_KEY } from './renderer';

// ADR-0010. The Forge flag `plantuml-local-renderer-enabled` was retired after
// it served 100% on Lite and Diagramly (2026-10-31 onward). The engine choice is
// now fixed per variant: Lite and Diagramly draw locally; Full and AsyncAPI,
// which never had the flag (so always read it as off), keep the server.
describe('plantUmlRenderer (ADR-0010)', () => {
  afterEach(() => {
    localStorage.removeItem(PLANTUML_RENDERER_STORAGE_KEY);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    forgeGlobal.isForge = true;
  });

  it.each([
    ['lite', 'local'],
    ['diagramly', 'local'],
    ['full', 'server'],
    ['asyncapi', 'server'],
  ])('uses the %s default: %s', async (productType, expected) => {
    vi.stubEnv('PRODUCT_TYPE', productType);
    await expect(plantUmlRenderer()).resolves.toBe(expected);
  });

  it('keeps the server outside Forge (standalone dev), as the flag did', async () => {
    vi.stubEnv('PRODUCT_TYPE', 'lite');
    forgeGlobal.isForge = false;
    await expect(plantUmlRenderer()).resolves.toBe('server');
  });

  it('lets localStorage override the default either way', async () => {
    vi.stubEnv('PRODUCT_TYPE', 'full');
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'local');
    await expect(plantUmlRenderer()).resolves.toBe('local');
    vi.stubEnv('PRODUCT_TYPE', 'lite');
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'server');
    await expect(plantUmlRenderer()).resolves.toBe('server');
  });

  it('ignores an unknown override value', async () => {
    vi.stubEnv('PRODUCT_TYPE', 'lite');
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'yes');
    await expect(plantUmlRenderer()).resolves.toBe('local');
  });

  it('uses the default when storage throws', async () => {
    vi.stubEnv('PRODUCT_TYPE', 'diagramly');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    await expect(plantUmlRenderer()).resolves.toBe('local');
  });
});
