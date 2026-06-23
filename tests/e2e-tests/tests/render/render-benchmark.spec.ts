import { test, expect } from '@playwright/test';
import { testConfig, type MacroType } from '../../config/test-config.js';
import { getPageId } from '../../utils/page-registry.js';
import { MacroPage } from '../../pages/MacroPage.js';
import fs from 'fs';
import path from 'path';

/**
 * Controlled baseline of "total controllable user-perceived load" per macro.
 *
 * The goal metric (2026-06-22): cut by 50% everything the END USER experiences that
 * WE control — render_ms + resource_load_ms (our renderer bundles) + the controllable
 * parts of fetch_ms + our bundle eval — i.e. duration_ms minus only the parts we can't
 * touch (Forge iframe host boot, irreducible single-fetch server latency).
 *
 * Mechanism: a CONTEXT-level request listener (context, not page — so it crosses the
 * cross-origin Forge hosted-resources OOPIF where the macro Vue app + mixpanel-browser
 * actually run) intercepts the macro_viewed POST to api-js.mixpanel.com/track (the live host;
 * also api.mixpanel.com) and reads its
 * properties. macro_viewed is unsampled, so every foregrounded load yields exactly one.
 *
 * HONESTY CONTRACT (do not game): we record whatever phase fields the deployed build
 * actually emits. The stale lite-stg build (827ccd0) emits duration_ms ONLY — render_ms
 * and the other phase timers are absent there and are reported as 'not-emitted', NEVER 0.
 * Phase attribution comes from the instrumented build (prod, or a future lite-stg deploy).
 *
 *   # tests/e2e-tests:
 *   APP=zenuml-lite@stg PERF_RUNS=6 npx playwright test --project=render --grep "render benchmark"
 *   # scope a quick validation run:
 *   APP=zenuml-lite@stg PERF_RUNS=2 PERF_MACROS=sequence npx playwright test --project=render --grep "render benchmark"
 */

const RUNS = Number(process.env.PERF_RUNS || 6);
const ONLY = (process.env.PERF_MACROS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

interface Sample {
  macro_type: string;
  run: number;
  missed?: boolean;
  wrapped_type?: string;
  duration_ms?: number;
  render_ms?: number;
  resource_load_ms?: number;
  fetch_ms?: number;
  context_ms?: number;
  bootstrap_ms?: number;
  measured_sum_ms?: number;
  cache_state?: string;
  render_mode?: string;
  cache_source?: string;
  tab_hidden?: boolean;
  app_commit?: string;
}

/** Mixpanel /track POST carries `data=<encoded>` — verbose URL-encoded JSON on this
 *  instance, base64 JSON otherwise. Try both; return the event array. */
function decodeTrack(postData: string | null): Array<{ event?: string; properties?: Record<string, unknown> }> {
  if (!postData) return [];
  let data: string | null = null;
  try {
    data = new URLSearchParams(postData).get('data');
  } catch {
    /* not form-encoded */
  }
  if (!data) return [];
  const candidates: Array<() => unknown> = [
    () => JSON.parse(decodeURIComponent(data!)),
    () => JSON.parse(data!),
    () => JSON.parse(Buffer.from(decodeURIComponent(data!), 'base64').toString('utf8')),
  ];
  for (const parse of candidates) {
    try {
      const j = parse();
      return Array.isArray(j) ? j : [j as { event?: string }];
    } catch {
      /* try next decoder */
    }
  }
  return [];
}

const nums = (a: Array<number | undefined>): number[] => a.filter((n): n is number => typeof n === 'number');
const median = (a: number[]): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (a: number[], p: number): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

test.describe('render benchmark', () => {
  test.describe.configure({ mode: 'serial', timeout: 0 });

  const macros = (ONLY.length ? (ONLY as MacroType[]) : testConfig.renderMacros).filter((m) =>
    testConfig.renderMacros.includes(m as MacroType),
  );

  test(`controlled baseline: ${macros.join(',')} x ${RUNS}`, async ({ page, context }) => {
    const samples: Sample[] = [];
    let captured: Record<string, unknown>[] = [];

    context.on('request', (req) => {
      const u = req.url();
      if (req.method() === 'POST' && u.includes('mixpanel.com') && u.includes('/track')) {
        for (const e of decodeTrack(req.postData())) {
          if (e && e.event === 'macro_viewed' && e.properties) captured.push(e.properties);
        }
      }
    });

    const macroPage = new MacroPage(page);
    // embed never emits macro_type='embed' — it delegates to the wrapped viewer,
    // which emits macro_viewed under ITS own type. So for embed accept ANY
    // macro_viewed on the page and record the wrapped type; for all others match
    // the exact macro_type.
    const matches = (macro: string, p: Record<string, unknown>) =>
      macro === 'embed' ? true : p.macro_type === macro;

    for (const macro of macros) {
      const pageId = getPageId(macro as MacroType);
      for (let run = 0; run < RUNS; run++) {
        captured = [];
        await page.goto(testConfig.pageUrl(pageId), { waitUntil: 'load' });
        await expect(page.locator('#title-text')).toBeVisible();
        await macroPage.dismissSpotlightModal();

        try {
          await expect.poll(() => captured.some((p) => matches(macro, p)), { timeout: 45_000 }).toBeTruthy();
        } catch {
          // Record the gap honestly and keep going — one macro's miss must not
          // abort the batch or lose the other macros' data / the artifact.
          samples.push({ macro_type: macro, run, missed: true });
          // eslint-disable-next-line no-console
          console.log(`[bench] ${macro} run ${run}: MISSED (no macro_viewed in 45s)`);
          continue;
        }

        const p = [...captured].reverse().find((pp) => matches(macro, pp))!;
        samples.push({
          macro_type: macro,
          run,
          duration_ms: p.duration_ms as number | undefined,
          render_ms: p.render_ms as number | undefined,
          resource_load_ms: p.resource_load_ms as number | undefined,
          fetch_ms: p.fetch_ms as number | undefined,
          context_ms: p.context_ms as number | undefined,
          bootstrap_ms: p.bootstrap_ms as number | undefined,
          measured_sum_ms: p.measured_sum_ms as number | undefined,
          cache_state: p.cache_state as string | undefined,
          render_mode: p.render_mode as string | undefined,
          cache_source: p.cache_source as string | undefined,
          wrapped_type: p.wrapped_type as string | undefined,
          tab_hidden: p.tab_hidden as boolean | undefined,
          app_commit: p.app_commit as string | undefined,
        });
        // eslint-disable-next-line no-console
        console.log(`[bench] ${macro}${macro === 'embed' ? `(wrapped:${p.macro_type})` : ''} run ${run}: duration=${p.duration_ms} render=${p.render_ms ?? 'n/a'} cache=${p.cache_state ?? '?'} hidden=${p.tab_hidden}`);
      }
    }

    // Foreground only (backgrounded loads inflate timers — the p99 artifact).
    const fg = samples.filter((s) => s.tab_hidden !== true);
    const summary: Record<string, unknown> = {};
    for (const macro of macros) {
      const rows = fg.filter((s) => s.macro_type === macro);
      const ok = rows.filter((r) => !r.missed);
      const dur = nums(ok.map((r) => r.duration_ms));
      const ren = nums(ok.map((r) => r.render_ms));
      summary[macro] = {
        n: ok.length,
        missed: rows.length - ok.length,
        ...(macro === 'embed' ? { wrapped_type: ok.find((r) => r.wrapped_type)?.wrapped_type ?? 'none' } : {}),
        cache_states: ok.reduce<Record<string, number>>((acc, r) => {
          const k = r.cache_state ?? 'unknown';
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
        render_modes: ok.reduce<Record<string, number>>((acc, r) => {
          const k = r.render_mode ?? '?';
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
        cache_sources: ok.reduce<Record<string, number>>((acc, r) => {
          const k = r.cache_source ?? '?';
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
        duration_ms: { median: median(dur), p90: pct(dur, 90) },
        render_ms: ren.length ? { median: median(ren), p90: pct(ren, 90) } : 'not-emitted (stale build / uninstrumented macro)',
      };
    }

    const appCommit = samples.find((s) => s.app_commit)?.app_commit ?? 'unknown';
    const out = { app: process.env.APP, app_commit: appCommit, runs: RUNS, capturedAt: new Date().toISOString(), summary, samples };
    const dir = path.join(process.cwd(), 'test-results');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `render-benchmark-${appCommit}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    // eslint-disable-next-line no-console
    console.log('\n=== render benchmark summary ===\n' + JSON.stringify(summary, null, 2) + `\napp_commit: ${appCommit}\nartifact: ${file}\n`);

    expect(samples.length, 'captured at least one macro_viewed sample').toBeGreaterThan(0);
  });
});
