import { describe, it, expect, afterEach, vi } from 'vitest';
import { plantUmlRenderer, PLANTUML_RENDERER_STORAGE_KEY } from './renderer';

describe('plantUmlRenderer (ADR-0010 spike gate)', () => {
  afterEach(() => {
    localStorage.removeItem(PLANTUML_RENDERER_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('defaults to the server', () => {
    expect(plantUmlRenderer()).toBe('server');
  });

  it('is local only for an explicit opt-in', () => {
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'local');
    expect(plantUmlRenderer()).toBe('local');
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'yes');
    expect(plantUmlRenderer()).toBe('server');
  });

  it('keeps the server when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(plantUmlRenderer()).toBe('server');
  });
});
