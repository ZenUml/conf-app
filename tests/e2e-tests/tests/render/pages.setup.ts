import { test as setup, type APIRequestContext } from '@playwright/test';
import { PageCreator } from '../../utils/page-creator.js';
import { testConfig } from '../../config/test-config.js';
import type { RenderMacroType } from '../../config/apps.js';
import path from 'path';
import fs from 'fs';

/**
 * Page creation setup for E2E tests.
 *
 * This project used to unconditionally create 5 brand-new Confluence pages
 * (one per render macro) on every single run. That was fine while `render`
 * was never gated in CI, but this project's standing rule is that E2E test
 * pages are NEVER deleted — so gating `render` naively would mean 5 permanent
 * pages per push, forever (sharded, 5 per SHARD, since this setup project runs
 * once per shard).
 *
 * Fix: reuse known-good fixtures committed in config/render-fixtures.json,
 * validated live before reuse, and create a page only when a fixture is
 * genuinely missing or has gone stale. A stale/deleted committed id must
 * self-heal (fall through to creation), never fail the run — the fixture
 * file is a cache, not a promise.
 */

interface TestPages {
  sequence?: string;
  graph?: string;
  openapi?: string;
  embed?: string;
  mermaid?: string;
}

/** The only macro types the render suite creates pages for — see RenderMacroType. */
const RENDER_MACRO_TYPES: RenderMacroType[] = ['sequence', 'graph', 'openapi', 'embed', 'mermaid'];

const TEST_PAGES_FILE = path.join(__dirname, '..', '..', 'test-pages.json');
const RENDER_FIXTURES_FILE = path.join(__dirname, '..', '..', 'config', 'render-fixtures.json');

type RenderFixtureMap = Record<string, Partial<Record<RenderMacroType, string>>>;

/**
 * Loaded with fs.readFileSync + JSON.parse rather than a static `import ... .json`:
 * this package has no tsconfig.json, and Playwright's own esbuild-based transform
 * for .ts setup files isn't a case worth trusting with JSON module resolution when
 * a two-line readFileSync does the same job with zero tooling risk.
 */
function loadCommittedFixtures(): RenderFixtureMap {
  try {
    const raw = JSON.parse(fs.readFileSync(RENDER_FIXTURES_FILE, 'utf-8'));
    return raw as RenderFixtureMap;
  } catch (error) {
    // Missing or malformed fixtures file is not fatal — it just means every
    // macro type falls through to creating a fresh page below.
    console.warn(`⚠️  Could not read ${RENDER_FIXTURES_FILE}, ignoring committed fixtures:`, error);
    return {};
  }
}

/**
 * A committed id is only a hint. Confirm it still resolves to a live, current
 * (non-trashed, non-deleted) page before trusting it — a fixture that quietly
 * rotted would otherwise fail every render spec that depends on it, on every
 * run, for every future contributor.
 */
async function isPageStillCurrent(request: APIRequestContext, pageId: string): Promise<boolean> {
  try {
    const response = await request.get(`https://${testConfig.domain}/wiki/api/v2/pages/${pageId}`);
    if (!response.ok()) return false;
    const body = await response.json();
    return body.status === 'current';
  } catch {
    // Network hiccup, malformed response, anything — treat as "can't confirm
    // it's alive" and let the caller fall through to creating a new page
    // rather than gambling the whole run on a fixture we couldn't verify.
    return false;
  }
}

/** Builds the single-macro options object PageCreator expects, keyed by the render macro type. */
function optionsFor(macroType: RenderMacroType) {
  switch (macroType) {
    case 'sequence':
      return { sequence: true };
    case 'graph':
      return { graph: true };
    case 'openapi':
      return { openapi: true };
    case 'embed':
      return { embed: true };
    case 'mermaid':
      return { mermaid: true };
  }
}

setup('create diagram test pages', async ({ page }) => {
  console.log('🚀 Resolving diagram test pages (reusing committed fixtures where possible)...');

  testConfig.validate();

  const pageCreator = new PageCreator(page);

  // `process.env.APP` is the same profile key used as config/apps.ts's
  // APP_PROFILES lookup (testConfig itself doesn't re-expose the id it was
  // resolved from). It's undefined only under the legacy individual-env-var
  // fallback in config/test-config.ts, in which case there's no profile key
  // to look fixtures up under and every macro type creates a fresh page —
  // exactly today's behavior for that path.
  const profileId = process.env.APP;
  const committedFixtures = loadCommittedFixtures();
  const fixturesForProfile = profileId ? committedFixtures[profileId] : undefined;

  // No per-macro env override exists for render fixtures today (the only
  // related env var, PAGE_ID / testConfig.existingPageId, is a single generic
  // page used by unrelated specs, not a per-macro-type render fixture slot) —
  // so that source is skipped rather than invented here.

  const testPages: TestPages = {};

  try {
    // Navigate to Confluence to ensure authenticated session (page.request
    // below inherits this same authenticated context — no separate
    // credential needed for the liveness GET).
    await page.goto(testConfig.baseUrl);

    for (const macroType of RENDER_MACRO_TYPES) {
      if (!testConfig.renderMacros.includes(macroType)) continue;

      const committedId = fixturesForProfile?.[macroType];
      if (committedId && (await isPageStillCurrent(page.request, committedId))) {
        console.log(`♻️  Reusing committed ${macroType} fixture: ${committedId}`);
        testPages[macroType] = committedId;
        continue;
      }

      if (committedId) {
        console.log(
          `⚠️  Committed ${macroType} fixture ${committedId} failed its liveness check ` +
            `(missing, trashed, or errored) — creating a replacement.`,
        );
      }

      console.log(`Creating ${macroType} diagram page...`);
      const newPageId = await pageCreator.createTestPage(optionsFor(macroType));
      testPages[macroType] = newPageId;

      // This is the WHOLE mechanism that keeps render-fixtures.json current:
      // there is no other job or script that writes it. Make it impossible to
      // miss in CI logs.
      console.log(
        [
          '',
          '🆕============================================================🆕',
          `🆕  NEW PERMANENT CONFLUENCE PAGE CREATED — macro: "${macroType}"`,
          `🆕  Page ID: ${newPageId}`,
          '🆕',
          '🆕  This page will NEVER be deleted (project policy: E2E test',
          '🆕  pages are never deleted). To stop the NEXT run from creating',
          '🆕  yet another one, add this id to:',
          '🆕    tests/e2e-tests/config/render-fixtures.json',
          profileId
            ? `🆕  under "${profileId}" -> "${macroType}".`
            : '🆕  (no APP profile id was set for this run — there is no ' +
                'profile key to add it under; this run is using the legacy ' +
                'env-var fallback, which always creates fresh pages.)',
          '🆕============================================================🆕',
          '',
        ].join('\n'),
      );
    }

    // Save page IDs to file — unchanged shape, so getPageId() and every
    // render spec keep working exactly as before.
    fs.writeFileSync(TEST_PAGES_FILE, JSON.stringify(testPages, null, 2));
    console.log(`💾 Saved all page IDs to: ${TEST_PAGES_FILE}`);
  } catch (error) {
    console.error('❌ Failed to resolve test pages:', error);
    throw error;
  }
});

// Note: Cleanup of test pages is handled manually or via separate script
// Pages persist after test run for easier debugging
// To clean up, delete test-pages.json and manually delete pages from Confluence
