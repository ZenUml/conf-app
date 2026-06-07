# Testing Paid Space Detection in Staging

## Deployment Information
- **Staging URL**: https://conf-stg-full.zenuml.com
- **Deployment URL**: https://3b04d157.conf-stg-full.pages.dev
- **Date**: February 22, 2026
- **Feature**: Paid space detection to bypass restrictions

## What Was Implemented

### Backend
- New API endpoint: `/api/space-status`
- Checks license status for both Connect and Forge apps
- Returns `isPaid: true` when space has active license

### Frontend
- Updated `useCustomerSuccessService` composable
- Bypasses all restrictions when space is paid
- Hides upgrade prompts for paid spaces

## Testing Instructions

### 1. Test Paid Space (Active License)

**For Connect Apps:**
1. Navigate to a Confluence space with an active ZenUML license
2. Open the browser DevTools Console (F12)
3. Look for console messages:
   - `🔍 Checking space paid status...`
   - `💳 Space paid status: { isPaid: true, ... }`
   - `✅ Space is paid - bypassing all restrictions`
4. Verify:
   - No upgrade button appears in the viewer header
   - Edit button works regardless of macro count
   - No restrictions are applied

**For Forge Apps:**
1. The system checks `accountType: 'licensed'` from Forge context
2. Same verification steps as above

### 2. Test Unpaid Space (Evaluation/Trial)

**Setup:**
1. Use a space with evaluation/trial license
2. Or use localStorage override: `localStorage.mockSpacePaid = 'false'`

**Verify:**
1. Console shows: `💳 Space paid status: { isPaid: false, ... }`
2. Normal restrictions apply:
   - At 50+ macros: Upgrade button appears
   - At 85+ macros: Warning notices appear
   - At 100+ macros: Actions are blocked (for Lite version)

### 3. Test with Mock Data

**In Browser Console:**

```javascript
// Simulate paid space
localStorage.mockSpacePaid = 'true'
location.reload()

// Simulate unpaid space with high macro count
localStorage.mockSpacePaid = 'false'
localStorage.mockMacroCount = '150'
localStorage.mockCSSEnabled = 'true'
location.reload()

// Clear all mocks
delete localStorage.mockSpacePaid
delete localStorage.mockMacroCount
delete localStorage.mockCSSEnabled
location.reload()
```

### 4. Verify API Endpoint

**Direct API Test:**
```javascript
// In the browser console on the staging site
fetch('/api/space-status?lic=active', {
  headers: {
    'Authorization': 'Bearer <your-jwt-token>'
  }
}).then(r => r.json()).then(console.log)
```

Expected response for paid space:
```json
{
  "isPaid": true,
  "licenseStatus": "active",
  "source": "lic_param"
}
```

## Expected Behavior

### When Space is Paid (Active License)
- ✅ No macro count restrictions
- ✅ No upgrade prompts or buttons
- ✅ All features fully accessible
- ✅ Console shows "Space is paid - bypassing all restrictions"

### When Space is Unpaid (Evaluation/Trial)
- ⚠️ Normal restrictions apply based on macro count
- ⚠️ Upgrade button shows at 50+ macros
- ⚠️ Warning notices at 85+ macros
- ⚠️ Actions blocked at 100+ macros (Lite version)

## Debugging Tips

1. **Check Network Tab**: Look for `/api/space-status` request
2. **Console Logs**: Filter by "paid" or "💳" to see status checks
3. **localStorage Overrides**: Use mock values for testing different scenarios
4. **Cache**: API responses are cached for 5 minutes

## Rollback Instructions

If issues are found:
```bash
# Revert to previous version
git revert 4e1ea451

# Rebuild and deploy
pnpm build:full
pnpm wrangler:publish:stg
```

## Success Criteria

- [ ] Paid spaces have no restrictions
- [ ] Unpaid spaces maintain normal restrictions
- [ ] API endpoint returns correct status
- [ ] No console errors
- [ ] Performance is not degraded

## Notes

- The `lic` parameter from Atlassian:
  - `active` = paid license
  - `evaluation` = trial period
  - Other values = invalid/expired

- Forge context `accountType`:
  - `licensed` = paid
  - Other values = unpaid/trial