import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_PATH } from './config/auth-state.js';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  testIgnore: ['**/node_modules/**', '../../**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // On CI a shard's log otherwise shows only one summary line (e.g.
  // "6 passed (4.8m)") with no per-test names and no sign that a test was
  // retried — and retries is 2 on CI above, so flakes are invisible without
  // downloading the HTML artifact. `list` prints a line per test, `github`
  // annotates failures on the PR diff, and `blob` produces a per-shard report
  // that `playwright merge-reports` can combine into one browsable report
  // (see the merge-reports job in e2e-test.yml). Locally, keep the single
  // `html` report nobody has to configure or merge.
  reporter: process.env.CI ? [['list'], ['github'], ['blob']] : 'html',

  use: {
    storageState: AUTH_STATE_PATH,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 60000,
    navigationTimeout: 60000,
    serviceWorkers: 'allow',
    // Clipboard writes happen inside our Forge iframes (the byline's paste link,
    // the advocacy message, Copy source). Headless Chromium refuses them by
    // default, which is an artefact of the runner rather than of the product —
    // in real use the gesture-initiated write succeeds (Mixpanel
    // advocacy_message_copied, ui_component byline_created_link: 17 copied / 0
    // failed to 2026-08-15). Granting here lets those paths exercise the real
    // API. Note it may still be refused inside a cross-origin iframe, since the
    // top document has to delegate clipboard-write via Permissions-Policy and
    // that is Confluence's call, not ours — so tests must not REQUIRE success.
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },

  projects: [
    {
      name: 'auth',
      testMatch: 'setup/auth.setup.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
      timeout: 120000,
    },
    {
      name: 'pages',
      testMatch: 'render/pages.setup.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 180000,
    },
    {
      name: 'render',
      testMatch: 'render/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['pages'],
      fullyParallel: false,
    },
    {
      name: 'insert',
      testMatch: 'insert/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      // The in-product "Send feedback" flow (edge trigger + dialog) across
      // viewer/editor/fullscreen/export-modal surfaces. A dedicated project
      // (own directory, own timeout) rather than folding into `insert` or
      // `fullscreen`, but deliberately declared HERE — immediately after
      // `insert` — because e2e-test.yml's `insert)` case runs it as
      // `--project=auth --project=insert --project=feedback`: Playwright
      // orders the collected test list by project declaration order first,
      // so this project's one spec file sorts after every `insert/` file
      // rather than interleaving alphabetically (`feedback` < `insert`) and
      // reshuffling the shard boundaries documented in e2e-test.yml. `insert`
      // is the suite actually gated per PR (staging-lite-e2e) and by the
      // production release smoke, unlike `fullscreen`, which has no CI
      // caller that runs the whole project today (only a
      // graph-edit.spec.ts-restricted `graph-publish` run touches it).
      name: 'feedback',
      testMatch: 'feedback/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      name: 'syntax-validation',
      testMatch: 'syntax-validation/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      // Fullscreen bridge modal coverage — ports the manual test plan in
      // docs/fullscreen-test-plan.html (66 cases) into Playwright. Same
      // auth flow as `insert`, separate project so a partial run can target
      // just these specs (e.g. for branch deploy verification).
      name: 'fullscreen',
      testMatch: 'fullscreen/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      // Live Agent Link full loop (macro <-> local agent over the hosted MCP).
      // Gated on the unreleased agent-link build: the spec skips at runtime
      // when /agent-link/mcp isn't routed on conf-stg-lite, so it's safe in CI.
      name: 'agent-link',
      testMatch: 'agent-link/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      // AsyncAPI variant smoke. Single space-page-loads test against
      // asyncapi-stg.atlassian.net; see tests/asyncapi/ for rationale.
      name: 'asyncapi',
      testMatch: 'asyncapi/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 120000,
    },
    {
      // Standalone visual snapshots against local Vite dev server (pnpm start:local).
      // No Confluence/Forge auth required.
      name: 'preview',
      testMatch: ['viewer-preview*.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
      timeout: 60000,
    },
  ],
});
