---
name: test-space-license
description: Test the space license admin API and verify it lifts macro restrictions on a live Confluence instance. Use when the user says "test space license", "test licensing", "verify space license", or wants to validate the Enterprise Bundle licensing flow end-to-end. Runs API CRUD tests + Confluence E2E verification.
---

# Test Space License

End-to-end integration test for the space license feature. Tests the admin API via curl AND verifies restrictions are lifted/restored on a live Confluence staging instance.

## Configuration

Resolve these values before running tests. Ask the user for any missing values.

| Variable | Default | How to get it |
|----------|---------|--------------|
| `PAGES_URL` | `https://conf-stg-lite.pages.dev` | The Cloudflare Pages deployment URL |
| `ADMIN_SECRET` | (ask user) | The `ADMIN_API_SECRET` set on the target |
| `CONFLUENCE_SITE` | `lite-stg.atlassian.net` | Staging Confluence instance |
| `SPACE_KEY` | `SD` | Space key on the staging instance |
| `CLOUD_ID` | (fetch) | `curl -s https://CONFLUENCE_SITE/_edge/tenant_info \| jq -r .cloudId` |

If the user provides arguments:
- `/test-space-license` — use defaults (staging lite)
- `/test-space-license prod` — use production URLs (ask for confirmation first!)

## Phase 1: API Tests (curl)

Run these sequentially. Report each result.

### Test 1.1: Auth rejection (no token)

```bash
curl -s PAGES_URL/api/space-license
```

**Expected**: HTTP 401, `"error":"unauthorized"`.

### Test 1.2: Auth rejection (wrong token)

```bash
curl -s -H "Authorization: Bearer wrong-token" PAGES_URL/api/space-license
```

**Expected**: HTTP 401.

### Test 1.3: Activate license

```bash
curl -s -X POST PAGES_URL/api/space-license \
  -H "Authorization: Bearer ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"cloudId":"CLOUD_ID","spaceKey":"SPACE_KEY","expiresAt":"2027-12-31T23:59:59Z","activatedBy":"skill-test"}'
```

**Expected**: HTTP 201, `"status":"active"`.

### Test 1.4: List licenses

```bash
curl -s -H "Authorization: Bearer ADMIN_SECRET" PAGES_URL/api/space-license
```

**Expected**: `licenses` array contains the Test 1.3 record.

### Test 1.5: Upsert (same key)

```bash
curl -s -X POST PAGES_URL/api/space-license \
  -H "Authorization: Bearer ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"cloudId":"CLOUD_ID","spaceKey":"SPACE_KEY","expiresAt":"2028-06-30T23:59:59Z","activatedBy":"skill-test-upsert","paymentReference":"pi_test_skill"}'
```

**Expected**: HTTP 200, `expiresAt` updated, `paymentReference` added, `createdAt` unchanged.

### Test 1.6: Filter by cloudId

```bash
curl -s -H "Authorization: Bearer ADMIN_SECRET" "PAGES_URL/api/space-license?cloudId=CLOUD_ID"
```

**Expected**: Only licenses for that cloudId.

### Test 1.7: Filter by status

```bash
curl -s -H "Authorization: Bearer ADMIN_SECRET" "PAGES_URL/api/space-license?status=active"
```

**Expected**: Only active licenses.

### Test 1.8: Deactivate

```bash
curl -s -X DELETE "PAGES_URL/api/space-license?cloudId=CLOUD_ID&spaceKey=SPACE_KEY" \
  -H "Authorization: Bearer ADMIN_SECRET"
```

**Expected**: `"status":"inactive"`, record preserved.

### Test 1.9: Expired license

```bash
curl -s -X POST PAGES_URL/api/space-license \
  -H "Authorization: Bearer ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"cloudId":"CLOUD_ID","spaceKey":"EXPIRED-TEST","expiresAt":"2020-01-01T00:00:00Z","activatedBy":"skill-test-expired"}'
```

**Expected**: Record created (expiry enforced at read time, not write time).

### Test 1.10: Validation errors

```bash
curl -s -X POST PAGES_URL/api/space-license \
  -H "Authorization: Bearer ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"cloudId":"test"}'
```

**Expected**: HTTP 400, `"error":"missing_fields"`.

## Phase 2: Confluence E2E Verification

This phase verifies that activating/deactivating a license actually lifts/restores macro restrictions on a live Confluence instance. Requires Playwright.

### Prerequisites
- Confluence staging credentials: `ZENUML_STAGE_USERNAME` and `ZENUML_STAGE_PASSWORD` env vars
- The staging space must have enough macros to trigger the upgrade prompt (>= 85 macros for warning, >= 100 for block)
- If the space does NOT have enough macros, use `localStorage.mockSpacePaid` override instead (see Test 2.1b)

### Test 2.1: Verify upgrade prompt appears when unlicensed

1. Ensure no active license exists for CLOUD_ID + SPACE_KEY (deactivate if one exists)
2. Navigate to a page with a ZenUML Lite macro in the staging space
   - Use the existing E2E test infrastructure: `APP=zenuml-lite@stg` profile
   - Site: `https://lite-stg.atlassian.net/wiki/spaces/SD`
   - Find a page with a sequence diagram macro
3. Wait for the Forge iframe to load (`[data-testid="hosted-resources-iframe"]`)
4. Inside the iframe, check for the upgrade prompt:
   - The `UpgradePrompt` component renders a `div` with class `fixed inset-0 z-50` when `visible=true`
   - Look for text "Pick the upgrade that fits your team" inside the iframe
   - **Note**: The prompt only shows when `macrosCreated >= WARNING_THRESHOLD (85)` AND `customerSuccessServiceEnabled` feature flag is on. If the staging space has fewer macros, the prompt won't appear regardless of license status.

**If the space has enough macros**: Assert the upgrade prompt modal is visible.
**If the space doesn't have enough macros**: Skip to Test 2.1b.

### Test 2.1b: Alternative — use mock override

If the staging space doesn't have enough macros to trigger the prompt naturally:

1. Navigate to the macro page
2. In the Forge iframe's console, set `localStorage.mockSpacePaid = 'false'`
3. Reload — the composable reads `mockSpacePaid` before calling the API
4. Verify the mock is working by checking console for `🧪 Using mock space paid status: false`

### Test 2.2: Activate license, verify restrictions lifted

1. Activate a license via the admin API:
   ```bash
   curl -s -X POST PAGES_URL/api/space-license \
     -H "Authorization: Bearer ADMIN_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"cloudId":"CLOUD_ID","spaceKey":"SPACE_KEY","expiresAt":"2027-12-31T23:59:59Z","activatedBy":"e2e-test"}'
   ```

2. Wait ~60 seconds for KV eventual consistency (or wait for next page load — the cache is 5 min but a fresh load will pick it up)

3. Reload the Confluence page with the macro

4. Inside the Forge iframe:
   - The upgrade prompt should NOT be visible
   - Look in the console for `💳 Space paid status: { isPaid: true, source: 'space_license' }`
   - If using mock: set `localStorage.mockSpacePaid = 'true'` and reload

### Test 2.3: Deactivate license, verify restrictions return

1. Deactivate the license:
   ```bash
   curl -s -X DELETE "PAGES_URL/api/space-license?cloudId=CLOUD_ID&spaceKey=SPACE_KEY" \
     -H "Authorization: Bearer ADMIN_SECRET"
   ```

2. Wait ~60 seconds for KV propagation

3. Reload the Confluence page

4. Inside the Forge iframe:
   - The upgrade prompt should reappear (if macros >= threshold)
   - Console should show `💳 Space paid status: { isPaid: false }`

### Test 2.4: Admin portal UI (manual or browser automation)

Open `PAGES_URL/admin/` in a browser (or via Playwright on a new page — this is NOT inside a Forge iframe, so any browser tool works):

1. Enter the admin secret, click Test → should show "Authenticated"
2. Verify the license table shows records from earlier tests
3. Activate a new license via the form → should appear in table
4. Click Deactivate → status should change to Inactive
5. Click Reactivate → status should change back to Active

## Cleanup

After all tests:

```bash
# Deactivate all test licenses
curl -s -X DELETE "PAGES_URL/api/space-license?cloudId=CLOUD_ID&spaceKey=SPACE_KEY" -H "Authorization: Bearer ADMIN_SECRET"
curl -s -X DELETE "PAGES_URL/api/space-license?cloudId=CLOUD_ID&spaceKey=EXPIRED-TEST" -H "Authorization: Bearer ADMIN_SECRET"
```

## Output

```markdown
## Space License Test Report
- Target: PAGES_URL
- Confluence: CONFLUENCE_SITE
- Cloud ID: CLOUD_ID
- Space: SPACE_KEY

### Phase 1: API Tests
| # | Test | Result |
|---|------|--------|
| 1.1 | Auth rejection (no token) | PASS/FAIL |
| 1.2 | Auth rejection (wrong token) | PASS/FAIL |
| 1.3 | Activate | PASS/FAIL |
| 1.4 | List | PASS/FAIL |
| 1.5 | Upsert | PASS/FAIL |
| 1.6 | Filter by cloudId | PASS/FAIL |
| 1.7 | Filter by status | PASS/FAIL |
| 1.8 | Deactivate | PASS/FAIL |
| 1.9 | Expired license | PASS/FAIL |
| 1.10 | Validation errors | PASS/FAIL |

### Phase 2: Confluence E2E
| # | Test | Result |
|---|------|--------|
| 2.1 | Upgrade prompt visible when unlicensed | PASS/FAIL/SKIPPED |
| 2.2 | Restrictions lifted after activation | PASS/FAIL |
| 2.3 | Restrictions return after deactivation | PASS/FAIL |
| 2.4 | Admin portal UI | PASS/FAIL |

### Cleanup
- Test data removed: YES/NO
```
