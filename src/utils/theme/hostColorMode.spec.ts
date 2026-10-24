import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetHostColorModeForTests,
  enableHostTheming,
  isHostThemingEnabled,
  readHostColorMode,
  rendersDark,
  useHostColorMode,
} from './hostColorMode';

afterEach(() => {
  document.documentElement.removeAttribute('data-color-mode');
  __resetHostColorModeForTests();
});

describe('readHostColorMode', () => {
  it('is light when Forge theming has not set the attribute', () => {
    expect(readHostColorMode()).toBe('light');
  });

  it('follows data-color-mode=dark', () => {
    document.documentElement.setAttribute('data-color-mode', 'dark');
    expect(readHostColorMode()).toBe('dark');
  });

  it('resolves auto through prefers-color-scheme', () => {
    document.documentElement.setAttribute('data-color-mode', 'auto');
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    expect(readHostColorMode()).toBe('dark');
    vi.unstubAllGlobals();
  });
});

describe('useHostColorMode', () => {
  it('updates when the host switches theme', async () => {
    const mode = useHostColorMode();
    expect(mode.value).toBe('light');
    document.documentElement.setAttribute('data-color-mode', 'dark');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mode.value).toBe('dark');
  });
});

describe('enableHostTheming', () => {
  it('calls view.theme.enable once and records success', async () => {
    const enable = vi.fn().mockResolvedValue(undefined);
    expect(await enableHostTheming({ theme: { enable } })).toBe(true);
    expect(await enableHostTheming({ theme: { enable } })).toBe(true);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(isHostThemingEnabled()).toBe(true);
  });

  it('keeps the light design when the bridge refuses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const enable = vi.fn().mockRejectedValue(new Error('no bridge'));
    expect(await enableHostTheming({ theme: { enable } })).toBe(false);
    expect(isHostThemingEnabled()).toBe(false);
  });

  it('ignores a view without theming (standalone stub)', async () => {
    expect(await enableHostTheming(undefined)).toBe(false);
    expect(await enableHostTheming({})).toBe(false);
  });
});

describe('rendersDark', () => {
  it('is true only for Mermaid in dark mode', () => {
    expect(rendersDark('mermaid', 'dark')).toBe(true);
    expect(rendersDark('mermaid', 'light')).toBe(false);
    expect(rendersDark('sequence', 'dark')).toBe(false);
    expect(rendersDark('graph', 'dark')).toBe(false);
    expect(rendersDark(undefined, 'dark')).toBe(false);
  });
});
