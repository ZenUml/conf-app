# ZenUML Confluence E2E Tests

This directory contains end-to-end tests for the ZenUML Confluence Cloud Add-on using Playwright.

## Migration from Puppeteer to Playwright

The tests have been migrated from Puppeteer to Playwright for better reliability, debugging capabilities, and modern testing features.

### Key Changes:

1. **Test Framework**: Moved from custom Puppeteer scripts to Playwright Test
2. **Configuration**: Added `playwright.config.js` for test configuration
3. **Selectors**: Updated XPath selectors to use Playwright's `xpath=` prefix
4. **Frame Handling**: Improved iframe handling with `contentFrame()` method
5. **Error Handling**: Better error handling and debugging capabilities
6. **Screenshots**: Automatic screenshots on failure
7. **Trace Viewer**: Added trace collection for debugging failed tests

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

# Run with specific environment (examples)
npm run test:prod
npm run test:peng
npm run test:yanhui
npm run test:yanhui:existing

# Run legacy Puppeteer tests (backup)
npm run test:legacy
```

## Test Structure

The main test file is `tests/e2e.spec.js` which contains:

### Test Cases

1. **View Macros Test**: Tests viewing different macro types
   - Sequence diagrams (ZenUML & Mermaid)
   - Graph diagrams (DrawIO)
   - OpenAPI specifications
   - Embed macros

2. **Edit Sequence Macro Test**: Tests editing sequence diagrams
   - Opens sequence macro viewer
   - Clicks edit button
   - Waits for editor dialog
   - Saves changes
   - Verifies updated content

3. **Embed Macros Test**: Tests embedded diagram functionality

### Key Features

- **Automatic Login**: Handles Atlassian login with 2FA support
- **Page Management**: Creates and cleans up test pages automatically
- **Frame Handling**: Properly handles nested iframes for macro content
- **Error Handling**: Comprehensive error handling with debugging info
- **Screenshots**: Automatic screenshot capture on failures
- **Flexible Selectors**: Updated selectors to handle dynamic content

## Troubleshooting

### Common Issues

1. **Iframe Not Found**: The test now uses more flexible selectors for iframe detection
2. **Timeout Issues**: Increased timeouts for CI environments
3. **Login Problems**: Added support for 2FA and MFA dismissal
4. **Frame Loading**: Better handling of iframe content loading

### Debug Information

When tests fail, check:
- `screenshots/` directory for failure screenshots
- `test-results/` directory for detailed test reports
- Console logs for detailed error information
- Playwright trace viewer for step-by-step debugging

### Selector Updates

The most important fix for the failing iframe selector:

```javascript
// Old (Puppeteer):
const macroEditorFrame = '//iframe[contains(@src, "sequence-editor-dialog.html")]';

// New (Playwright):
const macroEditorFrame = 'xpath=//iframe[contains(@src, "sequence-editor-dialog")]';
```

This change makes the selector more flexible to handle query parameters and different URL structures in the Atlassian Connect environment.

## Configuration

The `playwright.config.js` file includes:
- Multi-browser testing (Chromium, Firefox, WebKit)
- Automatic screenshots on failure
- Video recording on failure
- Trace collection for debugging
- Configurable timeouts and retries
- HTML reporting

## Legacy Support

The original Puppeteer test (`e2ePage.js`) is preserved and can be run with:

```bash
npm run test:legacy
```

This provides a fallback option during the migration period.