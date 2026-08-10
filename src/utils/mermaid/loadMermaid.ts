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
 *
 * Failure handling (2026-08-10 production evidence):
 * - `zeptonow` logged `Failed to fetch dynamically imported module: …` — a
 *   transient CDN fetch, worth one retry.
 * - `onstage` (Firefox 153) logged three `The requested module '…'` errors and
 *   one `r.initialize is not a function` inside four minutes. The repeat is the
 *   tell: the in-flight promise used to be cached on the rejection path too, so
 *   the first failure was terminal for every macro in that iframe session. A
 *   failed load now clears the cache and the next macro gets a real attempt.
 *   The root cause of the Firefox export failure itself is NOT established;
 *   the thrown message now carries the resolved URL so the next occurrence is
 *   diagnosable from the event alone.
 */

// Bundle-relative path; resolved at runtime against `document.baseURI`.
const MERMAID_PATH = 'vendor/mermaid/mermaid.esm.min.mjs';

export interface LoadMermaidDeps {
  importer?: (url: string) => Promise<any>;
  retries?: number;
  retryDelayMs?: number;
}

let cached: any = null;
let loading: Promise<any> | null = null;

// Test seam: the module-level singleton would otherwise leak between cases.
export function __resetMermaidLoaderForTests(): void {
  cached = null;
  loading = null;
}

function resolveMermaidUrl(): string {
  return new URL(MERMAID_PATH, document.baseURI).href;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadMermaid(deps: LoadMermaidDeps = {}): Promise<any> {
  const {
    importer = (url: string) => import(/* @vite-ignore */ url),
    retries = 1,
    retryDelayMs = 300,
  } = deps;

  if (cached) return cached;
  if (loading) return loading;

  const url = resolveMermaidUrl();

  loading = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0 && retryDelayMs > 0) await delay(retryDelayMs);
      try {
        const mod = await importer(url);
        const instance = mod?.default ?? mod;
        if (typeof instance?.initialize !== 'function') {
          // `r.initialize is not a function` in the wild carried no clue about
          // which URL produced the unusable module. This one does.
          throw new Error(`mermaid module at ${url} has no initialize()`);
        }
        instance.initialize({
          startOnLoad: true,
          theme: 'neutral',
        });
        cached = instance;
        return cached;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  })();

  try {
    return await loading;
  } catch (error) {
    // Drop the rejected promise so the next macro on this page re-attempts the
    // import instead of replaying this failure for the rest of the session.
    loading = null;
    throw error;
  }
}
