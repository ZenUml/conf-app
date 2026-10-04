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
maps the PR's changed files through `config/impact-map.mjs` to a `--grep`
expression (`@smoke` is always in it), and the Lite E2E jobs run only the
matching specs — their names carry "(selected)" when that happened. A shared
file (`src/forgeIndex.ts`, `src/model/**`, `package.json`, anything under
`tests/e2e-tests/` including the specs) or a file the map does not know makes
the run unselective. `main` always runs the whole suite. Try it locally:

```bash
node scripts/e2e-select.mjs src/components/Mermaid.vue         # → @editor|@mermaid|@smoke|@viewer
node scripts/e2e-select.mjs --base origin/main --head HEAD     # your branch's selection
```

When you add a source area, add its glob to `impact-map.mjs`;
`tests/unit/e2eSelect.spec.ts` checks that every glob still matches a tracked
file and every tag exists.

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