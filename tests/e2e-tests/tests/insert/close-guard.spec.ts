// Close guard E2E — REWRITTEN
//
// The previous version asserted that `window.dispatchEvent(new
// Event('beforeunload'))` returned `defaultPrevented = true`. That
// approach is invalid: it proves the listener is registered, NOT that the
// user-facing browser dialog appears. In practice browsers SUPPRESS the
// "Leave site?" dialog when the parent page JS-destroys the iframe (which
// is exactly how the Atlassian header X closes a Forge bridge modal). The
// synthetic test passed while the real bug shipped — see issue / discussion
// for details.
//
// New strategy: don't try to warn before close (impossible on this platform
// per @forge/bridge research up to 5.16.0 — there's no preventClose API).
// Instead, autosave drafts to localStorage so X-close cannot lose data, and
// verify the persistence contract directly:
//
//   1. Dirty the editor → assert a localStorage draft is written.
//   2. Close the modal (real X click) → assert the draft is still there.
//   3. Reopen the editor → assert the RestoreDraftBanner is visible.
//   4. Click "Restore" → assert the editor content matches the draft.
//
// The previous suite is left as `test.skip()` for now because the new
// assertions require a deployed build of this branch on staging (the
// behaviour change is in src/, not in the E2E runner). Once the branch is
// on stg, port the steps below into a real spec.

import { test } from '@playwright/test';

test.describe('Forge bridge close guard (deferred)', () => {
  test.skip(true, 'Replaced by draft-persistence contract; see file header. Unit tests in src/utils/closeGuard.spec.ts + draftStore.spec.ts cover the contract until this branch lands on stg.');

  test('placeholder', () => { /* never runs */ });
});
