# ZenUML Confluence E2E Tests

This directory contains end-to-end tests for the ZenUML Confluence Cloud Add-on using Playwright.

## Architecture

The test suite uses Playwright's dependency project pattern for efficient authentication:

1. **Setup Project** (`tests/auth.setup.ts`): Authenticates once and saves state to `auth-state.json`
2. **Test Projects**: Load the saved authentication state to skip login for each test

### Key Features

- **One-Time Authentication**: Login with OTP happens once before all tests
- **Page Object Model**: Organized page interactions in `pages/MacroPage.ts`
- **Test Helpers**: Reusable test utilities in `utils/test-helpers.ts`
- **Automatic Cleanup**: Test pages are created and deleted automatically
- **Screenshot & Video**: Captured on test failures
- **Trace Viewer**: Step-by-step debugging for failed tests

## Setup

### Install Dependencies

```bash
npm install
```

### Install Playwright Browsers

```bash
npm run install:browsers
```

## Running Tests

### Environment Variables

Set the following environment variables:

```bash
export ZENUML_STAGE_USERNAME="your-username"
export ZENUML_STAGE_PASSWORD="your-password"
export ZENUML_DOMAIN="your-domain.atlassian.net"  # Optional, defaults to zenuml-stg.atlassian.net
export ZENUML_SPACE="YOUR_SPACE"                  # Optional, defaults to ZS
export PAGE_ID="123456"                           # Optional, for testing with existing page
export IS_LITE="true"                            # Optional, for testing lite version
```

### Test Commands

```bash
# Run all tests
npm test

# Run tests with browser UI visible
npm run test:headed

# Run tests in debug mode (step through each action)
npm run test:debug

# Run tests with Playwright UI mode
npm run test:ui

# Run tests with trace collection
npm run test:trace
```

### Tags and selection

Every top-level `test` / `test.describe` block carries tags from the closed
taxonomy in `config/tags.ts` — one or more **surfaces** (`@viewer`, `@editor`,
`@fullscreen`, `@modal`, `@byline`, `@page-banner`, `@dashboard`, `@route`),
**diagram types** (`@sequence`, `@mermaid`, `@plantuml`, `@graph`, `@openapi`,
`@asyncapi`, `@embed`) and **concerns** (`@smoke`, `@paywall`, `@deeplink`,
`@analytics`, `@export`, `@feedback`, `@csat`, `@ai`, `@conversion`). A new
block needs at least one surface and one type-or-concern tag;
`tests/unit/e2eTags.spec.ts` fails the unit suite otherwise, and an unknown
tag is rejected the same way.

```bash
# Only the paywall specs, on lite staging
CI=true APP=zenuml-lite@stg pnpm exec playwright test --grep @paywall
```

CI uses the same mechanism to run less on a pull request: `scripts/e2e-select.mjs`
keeps `@smoke` and any changed staged-project E2E spec as a deterministic floor, then Jev
uses the public diff and the closed behavior taxonomy to widen the `--grep`
expression. The Lite E2E jobs run that union and carry "(selected)" in their
names. Shared runtime and harness files (`src/forgeIndex.ts`, `src/model/**`,
`package.json`, fixtures, authentication, page objects, and Playwright
configuration) or an unmapped file make the run unselective. `main` always
runs the whole suite. Try it locally:

```bash
node scripts/e2e-select.mjs src/components/Mermaid.vue         # → @smoke; Jev adds behavior categories in CI
node scripts/e2e-select.mjs --base origin/main --head HEAD     # your branch's selection
```

When you add a source area, add its descriptive glob to `impact-map.mjs` so
Jev receives the relevant context. `tests/unit/e2eSelect.spec.ts` checks that
every glob still matches a tracked file and every tag exists.

## Test Structure

### Directory Layout

```
tests/e2e-tests/
├── config/
│   └── test-config.ts       # Centralized test configuration
├── pages/
│   └── MacroPage.ts          # Page Object Model for macro interactions
├── tests/
│   ├── auth.setup.ts         # Authentication setup project
│   └── e2e.view-macros.spec.ts  # Main macro functionality tests
├── utils/
│   ├── ConfluenceLogin.ts    # Login and OTP handling
│   ├── page-creator.ts       # Test page creation/deletion
│   └── test-helpers.ts       # Reusable test utilities
└── playwright.config.js      # Playwright configuration

```

### Test Cases

**tests/e2e.view-macros.spec.ts**:

1. **Display All Macro Types**: Verifies rendering of sequence, graph, OpenAPI, and embed macros
2. **Display Mermaid Diagrams**: Tests Mermaid diagram rendering
3. **Handle Body-Only Sequence Macros**: Tests sequence macros without custom content
4. **Edit Sequence Macro**: Tests editing and saving sequence diagrams
5. **Edit Embed Macro**: Tests editing and saving embedded diagrams

## Troubleshooting

### Common Issues

1. **Authentication Fails**:
   - Verify `ZENUML_STAGE_USERNAME` and `ZENUML_STAGE_PASSWORD` are set
   - Check that MFA secret is correctly configured for OTP generation
   - Delete `auth-state.json` to force re-authentication

2. **Space Not Found**:
   - Ensure `ZENUML_SPACE` environment variable matches an existing space
   - Default is "ZS" - update if your space has a different key

3. **Timeout Issues**:
   - Increase timeouts in `playwright.config.js` if needed
   - Check network connectivity to Confluence instance

4. **Frame Loading Failures**:
   - Verify macro is properly installed in Confluence
   - Check for JavaScript errors in browser console
   - Use `--headed` mode to visually debug

### Debug Tools

When tests fail:
- **Screenshots**: Check `test-results/` directory
- **Videos**: Retained on failure in `test-results/`
- **Traces**: Run with `npm run test:trace`, then view with `npx playwright show-trace trace.zip`
- **Console Logs**: Enable with `DEBUG=pw:api npm test`

## Configuration

Key `playwright.config.js` settings:
- **Setup Project**: Runs once before all tests to authenticate
- **Dependency Pattern**: Main tests depend on setup completion
- **Storage State**: Saved to `auth-state.json` and reused
- **Timeouts**: 60s action/navigation, 120s for OTP entry
- **Retries**: 2 retries on CI, 0 locally

## Staging test-page retention

The Lite, Full, Diagramly and AsyncAPI staging profiles provision UTC year/month buckets under their configured test roots. `e2e-page-retention.yml` serializes provisioning and prepares the current and following month; test workers only look buckets up and fail if one is missing or duplicated. This avoids creating buckets concurrently across CI jobs. Run provisioning only through that workflow's serialized job. An explicit `PARENT_PAGE_ID` override and production PVT paths retain their original behavior. Persistent render fixtures are not enrolled in this policy.

A successfully published test page is marked with `zenuml-e2e-origin-v1` only after its identity and parent are verified. A page becomes eligible after 60 days only when its marker, parent, creation time and page version still match. A changed or moved page, any unmarked page, an entry in `config/render-fixtures.json`, and a page with the `e2e-preserve` label are preserved. Add the label to a page under investigation. Missing or unreadable evidence stops the run or leaves the page untouched; existing pages outside the new buckets are not backfilled or archived.

The daily workflow provisions buckets and archives at most 20 eligible pages per profile. A manually dispatched run defaults to dry run; its execute option performs the same bounded operation. It uses the configured Forge email and API token, requires the account to have archive permission on each staging space, and records per-page outcomes in a 90-day workflow artifact. A 202 archive response is not success until the page's archived status is read back. A rejected or ambiguous request stops that profile's run; the next scheduled run re-enumerates the pages. The process runs separately from the E2E pipeline.

Each report contains counts for each monthly bucket and `bucketPageTotal` across those buckets. These do not include the old parent or unbucketed test pages: their inventory and cleanup remain a separate operation. Watch monthly and total counts in the artifacts; split buckets further if a month approaches the problematic sibling count.
