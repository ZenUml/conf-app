import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPlantUmlStdlibLoader, plantumlStdlibLoader } from './stdlib';

type Globals = Record<string, Record<string, unknown> | undefined>;
const g = globalThis as unknown as Globals;

describe('PlantUML stdlib loader (ADR-0010)', () => {
  beforeEach(() => {
    delete g.PLANTUML_STDLIB;
    delete g.PLANTUML_STDLIB_JSON;
    delete g.PLANTUML_STDLIB_INFO;
  });

  it('serves the hosted C4 library as data and reports success', async () => {
    const ok = vi.fn();
    const err = vi.fn();
    plantumlStdlibLoader('c4.min.js', ok, err);
    await vi.waitFor(() => expect(ok).toHaveBeenCalledOnce());
    expect(err).not.toHaveBeenCalled();
    const files = g.PLANTUML_STDLIB!.c4 as Record<string, string[]>;
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['c4_context', 'c4_container', 'c4_component']));
    expect(files.c4_context.length).toBeGreaterThan(10);
    expect(g.PLANTUML_STDLIB_INFO!.c4).toMatchObject({ name: 'C4', license: 'MIT', version: '2.14.0' });
  });

  it('accepts the bundle name with whatever prefix the engine puts in front', async () => {
    const ok = vi.fn();
    plantumlStdlibLoader('https://example.invalid/some/base/c4.min.js', ok, vi.fn());
    await vi.waitFor(() => expect(ok).toHaveBeenCalledOnce());
  });

  it('declines a library that is not hosted, without loading anything', () => {
    const ok = vi.fn();
    const err = vi.fn();
    plantumlStdlibLoader('azure.min.js', ok, err);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('not hosted'));
    expect(ok).not.toHaveBeenCalled();
    expect(g.PLANTUML_STDLIB).toBeUndefined();
  });

  it('declines anything that is not a library bundle', () => {
    const err = vi.fn();
    plantumlStdlibLoader('themes.js', vi.fn(), err);
    expect(err).toHaveBeenCalled();
  });

  it('installs itself as the engine global', () => {
    installPlantUmlStdlibLoader();
    expect((globalThis as Record<string, unknown>).PLANTUML_STDLIB_LOADER).toBe(plantumlStdlibLoader);
  });
});
