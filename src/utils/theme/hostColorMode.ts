import { readonly, ref, type Ref } from 'vue';
import type { ColorMode } from '@/utils/analytics/catalog';

// Confluence's light/dark choice reaches a Forge Custom UI iframe only after the
// app calls `view.theme.enable()`. Forge then writes `data-color-mode` (light,
// dark or auto) on <html>, loads the design-token CSS, and keeps both in step
// with the host when the user switches theme.
// https://developer.atlassian.com/platform/forge/design-tokens-and-theming/

const COLOR_MODE_ATTRIBUTE = 'data-color-mode';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function prefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** Reads the colour mode Forge applied to this iframe; light when theming is off. */
export function readHostColorMode(root: Element | null = typeof document === 'undefined' ? null : document.documentElement): ColorMode {
  const attribute = root?.getAttribute(COLOR_MODE_ATTRIBUTE);
  if (attribute === 'dark') return 'dark';
  if (attribute === 'auto') return prefersDark() ? 'dark' : 'light';
  return 'light';
}

const colorMode = ref<ColorMode>(readHostColorMode());
let themingEnabled = false;
let stopObserving: (() => void) | null = null;

function sync(): void {
  colorMode.value = readHostColorMode();
}

function observe(): void {
  if (stopObserving || typeof document === 'undefined') return;
  const cleanups: Array<() => void> = [];
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [COLOR_MODE_ATTRIBUTE] });
    cleanups.push(() => observer.disconnect());
  }
  try {
    const query = window.matchMedia?.(DARK_QUERY);
    if (query?.addEventListener) {
      query.addEventListener('change', sync);
      cleanups.push(() => query.removeEventListener('change', sync));
    }
  } catch {
    // No media query support: an `auto` page stays on its first reading.
  }
  stopObserving = () => cleanups.forEach((cleanup) => cleanup());
}

/** Live colour mode of the host page, updated when the user switches theme. */
export function useHostColorMode(): Readonly<Ref<ColorMode>> {
  observe();
  sync();
  return readonly(colorMode);
}

// Diagram types whose renderer has a dark theme. Everything else keeps its
// light card on a dark page: DrawIO, PlantUML and ZenUML sequence draw dark
// ink on transparent ground and have no dark rendering to switch to.
const DARK_CAPABLE_DIAGRAM_TYPES: ReadonlySet<string> = new Set(['mermaid']);

/** True when this diagram should render in dark colours under `mode`. */
export function rendersDark(diagramType: string | undefined | null, mode: ColorMode): boolean {
  return mode === 'dark' && !!diagramType && DARK_CAPABLE_DIAGRAM_TYPES.has(diagramType);
}

/** Whether `enableHostTheming` succeeded in this iframe. */
export function isHostThemingEnabled(): boolean {
  return themingEnabled;
}

type ThemeableView = { theme?: { enable?: () => Promise<unknown> } } | undefined | null;

/**
 * Opts this iframe into Confluence theming. Never throws: a host that refuses
 * (older bridge, standalone dev page) leaves the viewer in its light design.
 */
export async function enableHostTheming(view: ThemeableView): Promise<boolean> {
  if (themingEnabled) return true;
  const enable = view?.theme?.enable;
  if (typeof enable !== 'function') return false;
  try {
    await enable.call(view.theme);
    themingEnabled = true;
  } catch (error) {
    console.warn('[theme] view.theme.enable() failed; keeping light design', error);
    return false;
  }
  observe();
  sync();
  return true;
}

// Test seam.
export function __resetHostColorModeForTests(): void {
  stopObserving?.();
  stopObserving = null;
  themingEnabled = false;
  colorMode.value = readHostColorMode();
}
