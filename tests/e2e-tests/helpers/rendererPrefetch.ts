/**
 * Helpers for the idle renderer-prefetch preview spec.
 *
 * Pure functions over Page — no test-runner assertions. The spec imports the
 * REAL orchestrator module into the page via Vite's dev-server TS transform
 * (`import('/src/utils/prefetch/rendererPrefetch.ts')`), so what runs is the
 * production code path in a real Chromium against the real dev server — not a
 * jsdom approximation. (The full wiring — forgeIndex banner branch and the
 * trackRenderTime post-render hook — is unit-tested; this spec verifies the
 * browser-level mechanics: link injection, real fetches, settle tracking,
 * localStorage discipline.)
 *
 * Caveats the next person will hit:
 * - The flag check normally goes through callRemote → @forge/bridge, which
 *   cannot work outside a Forge iframe. Seed the localStorage flag MEMO
 *   (`zenuml:prefetch:flags`) instead — that short-circuits the network path
 *   and is itself a production code path (every load after the first).
 * - dist/prefetch-manifest.json is build-only; on the dev server the fetch
 *   gets the SPA HTML fallback, which the module treats as "no manifest" —
 *   so only DrawIO links + the Mermaid import-warm are observable here.
 * - The done-key embeds VITE_APP_COMMIT (current git hash), so compute the
 *   expected key inside the page via the module's own getBuildKey().
 */
import type { Page } from '@playwright/test';

export const FLAG_MEMO_KEY = 'zenuml:prefetch:flags';

export async function seedFlagMemo(
  page: Page,
  flags: { macroHost: boolean; bannerHost: boolean },
): Promise<void> {
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [FLAG_MEMO_KEY, JSON.stringify({ at: Date.now(), ...flags })],
  );
}

export async function clearPrefetchState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('zenuml:prefetch:')) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    document.head
      .querySelectorAll('link[rel="prefetch"]')
      .forEach((l) => l.remove());
  });
}

/** Run the real orchestrator in-page and return its observable side effects. */
export async function runPrefetchInPage(
  page: Page,
  host: 'macro' | 'banner',
): Promise<{
  links: { href: string; as: string }[];
  doneKeySet: boolean;
  mermaidWarmed: boolean;
}> {
  return page.evaluate(async (hostArg) => {
    // Paths are resolved by the Vite dev server inside the page, not by the
    // test's TS compiler — keep them as variables so tsc doesn't try.
    const orchestratorPath = '/src/utils/prefetch/rendererPrefetch.ts';
    const throttlePath = '/src/utils/prefetch/throttle.ts';
    const mod = await import(orchestratorPath);
    const throttle = await import(throttlePath);
    await mod.runRendererPrefetchIfDue({ host: hostArg, deadlineMs: 15_000 });
    const links = [...document.head.querySelectorAll('link[rel="prefetch"]')].map((l) => ({
      href: (l as HTMLLinkElement).href,
      as: (l as HTMLLinkElement).as,
    }));
    const mermaidEntry = performance
      .getEntriesByType('resource')
      .some((e) => e.name.includes('vendor/mermaid/mermaid.esm.min.mjs'));
    return {
      links,
      doneKeySet: !throttle.isPrefetchDue(),
      mermaidWarmed: mermaidEntry,
    };
  }, host);
}

/** Fetch statuses of the injected prefetch hrefs, from inside the page. */
export async function probeUrls(page: Page, hrefs: string[]): Promise<number[]> {
  return page.evaluate(
    (urls) => Promise.all(urls.map((u) => fetch(u).then((r) => r.status).catch(() => 0))),
    hrefs,
  );
}
