---
name: test-pdf-export
description: >
  Test PDF and Word export of ZenUML diagrams on a live Confluence site.
  Logs into the target site, triggers export, downloads the file, and verifies
  diagram images are embedded. Also checks Forge logs for errors.
  Use when the user says "test pdf export", "verify pdf", "check export",
  "test export", "does pdf work", "export test", or after deploying export
  function changes. Triggers on any PDF/Word export verification request.
---

# Test PDF Export

Verify that PDF and Word export of ZenUML diagrams works correctly on a live Confluence site. This skill automates the full export flow: login → navigate → export → download → verify content.

## Arguments

Usage: `test pdf export [site] [--word] [--pdf] [--both]`

- If no site specified, default to **whimet4** (yanhui's test site)
- `--word` — test Word export only
- `--pdf` — test PDF export only
- `--both` or no flag — test both Word and PDF (default)

## Site Configuration

| Site | URL | Space | Test Page ID | Forge Env | Credentials Key |
|------|-----|-------|-------------|-----------|----------------|
| whimet4 | `https://whimet4.atlassian.net` | WHIMET4 | 347635717 | yanhui | `https://whimet4.atlassian.net` |
| zenuml-stg | `https://zenuml-stg.atlassian.net` | — | — | staging | `https://zenuml-stg.atlassian.net` |

For sites not listed, ask the user for space key, page ID, and Forge environment.

## Prerequisites

- **Credentials**: `~/.atlassian/credentials.json` must exist with the target site entry:
  ```json
  {
    "hosts": {
      "https://<site>.atlassian.net": {
        "username": "...",
        "password": "...",
        "atlassian_otp": "..."
      }
    }
  }
  ```
- **Playwright**: Must be available in `tests/e2e-tests/node_modules/`
- **otpauth**: Must be available in `tests/e2e-tests/node_modules/`

Check prerequisites before running. If credentials are missing, tell the user to set up `~/.atlassian/credentials.json`.

## Execution Steps

### Step 1: Validate Prerequisites

```bash
# Check credentials exist
cat ~/.atlassian/credentials.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
site = d.get('hosts', {}).get('https://whimet4.atlassian.net')
if not site: print('MISSING: whimet4 credentials'); sys.exit(1)
for k in ['username', 'password', 'atlassian_otp']:
    if not site.get(k): print(f'MISSING: {k}'); sys.exit(1)
print('Credentials OK')
"

# Check Playwright
ls tests/e2e-tests/node_modules/@playwright/test/package.json
ls tests/e2e-tests/node_modules/otpauth/package.json
```

### Step 2: Write and Run Test Script

Create a temporary script at `tests/e2e-tests/_test-export.js`. The script must:

1. **Read credentials** from `~/.atlassian/credentials.json` using the site URL as key
2. **Launch Chromium** via Playwright (headless: false for Confluence compatibility)
3. **Login** to the Confluence site:
   - Fill `input[name=username]`, click `#login-submit`
   - Fill `input[name=password]`, click `#login-submit`
   - Generate OTP via `otpauth.TOTP`, fill `#two-step-verification-otp-code-input`
   - Click the "Log in" button
   - Wait for navigation to complete (10s)
4. **Navigate** to the test page
5. **For Word export**:
   - Click "More actions" button → "Export" menuitem → "Word" menuitem
   - Capture the download event, save to `/tmp/test-export.doc`
   - Report file size
6. **For PDF export**:
   - Navigate to the test page (fresh navigation)
   - Click "More actions" button → "Export" menuitem → "PDF" menuitem
   - Wait for "Download PDF" link (up to 120s — PDF generation is slow)
   - Click the download link, save to `/tmp/test-export.pdf`
   - Report file size and embedded image count
7. **Close browser**

#### Key Playwright Selectors

```javascript
// Login
await page.fill('input[name=username]', username, { timeout: 10000 });
await page.click('#login-submit');
await page.fill('input[name=password]', password, { timeout: 10000 });
await page.click('#login-submit');
await page.fill('#two-step-verification-otp-code-input', otp, { timeout: 10000 });
await page.getByRole('button', { name: 'Log in' }).click();

// Export menu
await page.getByRole('button', { name: 'More actions' }).click({ timeout: 10000 });
await page.getByRole('menuitem', { name: /export/i }).click({ timeout: 5000 });
await page.getByRole('menuitem', { name: /pdf/i }).click({ timeout: 5000 });
// or for Word:
await page.getByRole('menuitem', { name: /word/i }).click({ timeout: 5000 });

// PDF download link
const dl = page.getByRole('link', { name: 'Download PDF' });
await dl.waitFor({ timeout: 120000 });
```

#### PDF Verification

After downloading, check the PDF binary for:

```javascript
const fs = require('fs');
const raw = fs.readFileSync('/tmp/test-export.pdf').toString('latin1');

// Count embedded images
const images = (raw.match(/\/Subtype\s*\/Image/g) || []).length;

// Check for error strings
const errors = [];
for (const str of ['Failed to fetch', 'Diagram attachment not found', 'Diagram content not available', 'Error generating export']) {
  if (raw.includes(str)) errors.push(str);
}
```

#### Word Verification

For Word (.doc), check file size — a healthy export with diagrams should be >100KB. A file <10KB likely has no images.

### Step 3: Check Forge Logs

After the export test completes, check Forge logs for errors:

```bash
cd /path/to/confluence-plugin
npx forge logs --environment <env> 2>&1 | grep "Export:" | tail -20
```

Look for:
- `Export: found ...` → ✅ attachment resolved successfully
- `Export: attachments API 400 ... page undefined` → ❌ pageId resolution failed
- `Export: no customContentId` → ❌ config not passed to export function
- `Export: ... not found on page` → ⚠️ attachment PNG doesn't exist for this macro

### Step 4: Clean Up

```bash
rm -f tests/e2e-tests/_test-export.js
```

## Interpreting Results

### Success Criteria

| Export | Criterion | What it means |
|--------|-----------|---------------|
| PDF | File > 50KB | Has meaningful content |
| PDF | Images > 0 | Diagram PNGs embedded |
| PDF | No error strings | Export function worked |
| Word | File > 100KB | Has embedded diagram images |
| Forge logs | All `Export: found` | Attachment API calls succeeded |

### Common Failures

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| PDF 31KB, 0 images, "Failed to fetch attachments: 400" | `pageId` is `undefined` — PDF export payload uses `context.extension.content.id` | Add `context.extension?.content?.id` to pageId resolution in `src/export.js` |
| Word works but PDF fails | Different payload formats between Word and PDF export contexts | Check all pageId paths: `context.content?.id`, `context.contentId`, `context.extension?.content?.id` |
| "Diagram attachment not found" | PNG hasn't been uploaded for this macro | User needs to edit and save the macro to generate the PNG |
| "Error loading the extension!" in PDF (but images present) | Normal — Confluence's Custom UI can't render in PDF context | Not a bug; the adfExport fallback is what provides the image |
| "Diagram content not available for export" | `customContentId` missing from config | Macro needs to be re-saved with current app version |
| Forge logs show old `appVersion` | Deploy succeeded but installation not upgraded | Run `forge install --upgrade --environment <env> --site <site> --product confluence --non-interactive` |

### Payload Format Reference

The Forge `adfExport` function receives different payload shapes depending on the export type:

**Word export** — pageId available at top level:
```
context.contentId = "123456"
context.content.id = "123456"
context.config.customContentId = "789"
```

**PDF export** — pageId nested under `extension`:
```
context.extension.content.id = "123456"
extensionPayload.config.customContentId = "789"
```

Both formats must be handled. See `src/export.js` for the full resolution chain.

## Output Format

```
## Export Test — {site} ({date/time})

### Word Export
- Status: ✅ PASS / ❌ FAIL
- File size: {N} bytes
- Notes: {any issues}

### PDF Export
- Status: ✅ PASS / ❌ FAIL
- File size: {N} bytes
- Embedded images: {N}
- Error strings found: {none / list}

### Forge Logs
- Last {N} export entries: {all success / N errors}
- Errors: {list if any}

### Verdict
✅ All exports working / ❌ Issues found: {summary}
```
