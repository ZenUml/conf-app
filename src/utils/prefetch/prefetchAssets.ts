/**
 * Low-level helpers for the idle renderer prefetch: <link rel="prefetch">
 * injection with settle tracking, and the build-emitted hashed-chunk manifest.
 *
 * `<link rel="prefetch">` (not preload) is deliberate: prefetch is low
 * priority and browser-discretionary — it backs off on constrained
 * connections and never competes with the page's own critical resources.
 */

export interface PrefetchResult {
  requested: number;
  failed: number;
  timedOut: boolean;
}

function asTypeFor(url: string): string {
  return /\.css(\?|$)/.test(url) ? 'style' : 'script';
}

/**
 * Inject prefetch links for `urls` (relative paths resolved against
 * `document.baseURI`, mirroring how the real loaders resolve them) and resolve
 * once every link settled (load or error) or `timeoutMs` elapsed. Never rejects.
 * Links left in flight at timeout keep downloading as long as the document
 * lives — `timedOut` only means we stopped waiting.
 */
export function prefetchUrls(
  paths: readonly string[],
  opts?: { timeoutMs?: number; doc?: Document },
): Promise<PrefetchResult> {
  const doc = opts?.doc ?? document;
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const result: PrefetchResult = { requested: 0, failed: 0, timedOut: false };
  if (paths.length === 0) return Promise.resolve(result);

  return new Promise((resolve) => {
    let pending = 0;
    let done = false;
    const finish = (timedOut: boolean) => {
      if (done) return;
      done = true;
      result.timedOut = timedOut;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);

    for (const path of paths) {
      let href: string;
      try {
        href = new URL(path, doc.baseURI).href;
      } catch {
        result.failed++;
        continue;
      }
      // Already requested in this document (e.g. a renderer the iframe loaded
      // for real) — skip rather than double-inject.
      if (doc.querySelector(`link[rel="prefetch"][href="${href}"]`)) continue;
      result.requested++;
      pending++;
      const link = doc.createElement('link');
      link.rel = 'prefetch';
      link.as = asTypeFor(href);
      link.href = href;
      const settle = (failed: boolean) => {
        link.onload = link.onerror = null;
        if (failed) result.failed++;
        if (--pending === 0) finish(false);
      };
      link.onload = () => settle(false);
      link.onerror = () => settle(true);
      doc.head.appendChild(link);
    }

    if (pending === 0) finish(false);
  });
}

/**
 * Hashed-chunk lists emitted at build time by the `prefetch-manifest` plugin
 * in vite.config.mjs (dist/prefetch-manifest.json). Maps renderer family →
 * output asset paths (entry chunk + its static import closure + CSS).
 * Dev server / missing file / malformed JSON → empty manifest (those
 * renderers simply aren't warmed).
 */
export interface PrefetchManifest {
  version: number;
  renderers: Partial<Record<'sequence' | 'openapi', string[]>>;
}

export async function fetchPrefetchManifest(deps?: {
  fetchFn?: typeof fetch;
  baseUri?: string;
}): Promise<PrefetchManifest> {
  const empty: PrefetchManifest = { version: 1, renderers: {} };
  try {
    const fetchFn = deps?.fetchFn ?? fetch;
    const url = new URL('prefetch-manifest.json', deps?.baseUri ?? document.baseURI).href;
    const res = await fetchFn(url);
    if (!res.ok) return empty;
    const contentType = res.headers.get('content-type') ?? '';
    // The dev server (and a stale CDN path) serves an SPA HTML fallback with
    // 200 — treat anything that isn't JSON as absent.
    if (!contentType.includes('json')) return empty;
    const body = (await res.json()) as Partial<PrefetchManifest> | null;
    if (body?.version !== 1 || typeof body.renderers !== 'object' || body.renderers === null) return empty;
    return body as PrefetchManifest;
  } catch {
    return empty;
  }
}
