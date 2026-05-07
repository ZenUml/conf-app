/**
 * Lazy-loaded Mermaid singleton.
 *
 * Loads mermaid from a runtime URL (`/vendor/mermaid/mermaid.esm.min.mjs`) so
 * Vite/Rollup cannot statically resolve it and bundle it into the app graph.
 * The mermaid runtime is copied to `dist/vendor/mermaid/` at build time via
 * rollup-plugin-copy in vite.config.mjs.
 *
 * Initializes mermaid the first time it's loaded with sensible defaults.
 * Subsequent calls return the cached instance.
 */

// Use a non-literal expression so neither Vite nor Rollup attempt to statically
// resolve this URL — they only handle string literals in dynamic import().
const MERMAID_URL = '/vendor/mermaid/mermaid.esm.min.mjs';

let cached: any = null;
let loading: Promise<any> | null = null;

export async function loadMermaid(): Promise<any> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    const url = MERMAID_URL;
    const mod = await import(/* @vite-ignore */ url);
    const instance = mod.default ?? mod;
    instance.initialize({
      startOnLoad: true,
      theme: 'neutral',
    });
    cached = instance;
    return cached;
  })();

  return loading;
}
