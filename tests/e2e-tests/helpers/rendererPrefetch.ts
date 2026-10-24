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
 * - Flags are Forge feature flags evaluated via the @forge/bridge client SDK,
 *   which needs a real Forge iframe (installContext) — impossible on the
 *   plain dev server. The run helper injects a `getFlags` override into the
 *   orchestrator instead; flag plumbing itself is covered by flags.spec.ts.
 *   Omitting the override exercises the production fail-closed path (no
 *   installContext → flags off).
 * - dist/prefetch-manifest.json is build-only; on the dev server the fetch
 *   gets the SPA HTML fallback, which the module treats as "no manifest" —
 *   so only DrawIO links + the Mermaid import-warm are observable here.
 * - The done-key embeds VITE_APP_COMMIT (current git hash), so compute the
 *   expected key inside the page via the module's own throttle helpers.
 */
import type { Page } from '@playwright/test';

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

/**
 * Run the real orchestrator in-page and return its observable side effects.
 * `flagOverride` injects the getFlags result (Forge flags can't evaluate
 * outside a Forge iframe); omit it to exercise the fail-closed default path.
 */
export async function runPrefetchInPage(
  page: Page,
  host: 'macro' | 'banner',
  flagOverride?: boolean,
): Promise<{
  links: { href: string; as: string }[];
  doneKeySet: boolean;
  mermaidWarmed: boolean;
}> {
  return page.evaluate(async ({ hostArg, flag }) => {
    // Paths are resolved by the Vite dev server inside the page, not by the
    // test's TS compiler — keep them as variables so tsc doesn't try.
    const orchestratorPath = '/src/utils/prefetch/rendererPrefetch.ts';
    const throttlePath = '/src/utils/prefetch/throttle.ts';
    const mod = await import(orchestratorPath);
    const throttle = await import(throttlePath);
    await mod.runRendererPrefetchIfDue({
      host: hostArg,
      deadlineMs: 15_000,
      ...(flag === undefined ? {} : { getFlags: async () => flag }),
    });
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
  }, { hostArg: host, flag: flagOverride });
}

/** Fetch statuses of the injected prefetch hrefs, from inside the page. */
export async function probeUrls(page: Page, hrefs: string[]): Promise<number[]> {
  return page.evaluate(
    (urls) => Promise.all(urls.map((u) => fetch(u).then((r) => r.status).catch(() => 0))),
    hrefs,
  );
}
