/**
 * Lazy-loaded Mermaid singleton.
 *
 * Loads mermaid from a bundle-relative URL (`vendor/mermaid/mermaid.esm.min.mjs`)
 * so Vite/Rollup cannot statically resolve it and bundle it into the app graph.
 * The mermaid runtime is copied to `dist/vendor/mermaid/` at build time via
 * rollup-plugin-copy in vite.config.mjs.
 *
 * Resolve against `document.baseURI` (the document's URL or its <base> tag)
 * rather than the origin root. Forge Custom UI iframes are served from
 * `<app-id>.cdn.prod.atlassian-dev.net/<bundle-hash>/index.html`, so a leading
 * "/vendor/..." would resolve to `/vendor/...` at the origin (wrong path) —
 * the vendor assets actually live at `<bundle-hash>/vendor/...`. Using
 * `document.baseURI` as the resolution base keeps the URL inside the bundle.
 */

// Bundle-relative path; resolved at runtime against `document.baseURI`.
const MERMAID_PATH = 'vendor/mermaid/mermaid.esm.min.mjs';

let cached: any = null;
let loading: Promise<any> | null = null;

export async function loadMermaid(): Promise<any> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    const url = new URL(MERMAID_PATH, document.baseURI).href;
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
