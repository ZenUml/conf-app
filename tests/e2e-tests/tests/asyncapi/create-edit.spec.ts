import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';

/**
 * AsyncAPI create + edit coverage, layered on top of the dashboard-loads
 * smoke. Both flows bottom out in the same Forge fullscreen editor modal
 * (forge-asyncapi-editor → AsyncApiStudioEditor → nested Studio iframe);
 * the difference is only whether a customContentId is passed:
 *
 *   - Create ("+ Create New API"): no id → editor opens on the DEFAULT spec
 *     (DEFAULT_ASYNCAPI_SPEC, info.title "Example AsyncAPI"). Publishing
 *     persists a brand-new async-api-doc custom content.
 *   - Edit (a card's "Edit"): id passed via modal.customContentId → editor
 *     loads the stored spec and Publish pins the save to that id (in-place
 *     update, no fork — see buildAsyncApiSaveDiagram / isDashboardEdit).
 *
 * Success signal for both: the editor calls view.close()/view.submit() ONLY
 * after saveToPlatform resolves, so the fullscreen modal dismissing is proof
 * the save round-tripped. A failed save instead shows the in-iframe
 * "Error Loading AsyncAPI Studio" overlay and the modal stays open — which
 * would trip the toBeHidden assertion.
 *
 * NOTE: the create flow persists a real "Example AsyncAPI" doc on
 * asyncapi-stg each run (no cleanup — DELETE 401s on legacy-authored content;
 * archive is a soft-delete the dashboard hides). This mirrors how the render
 * suite leaves its test pages behind.
 *
 * Skips when the profile isn't asyncapi so this project coexists with the
 * lite/full/diagramly runs.
 */

const APP_ID = '49017727-af19-4ab6-8d5a-7d28108936b6';
// Stable per-environment Forge env id (same source as dashboard-loads.spec.ts):
// `APP_ID=49017727-… PRODUCT_TYPE=asyncapi pnpm exec forge environments list`.
const STAGING_ENV_ID = 'a75bfad8-d5f1-4487-8c75-704d0e0df3ab';
const ROUTE = 'zenuml-asyncapi-dashboard';

// Forge fullscreen modal (openModal size:'fullscreen') — same testid the macro
// editor uses (see pages/MacroPage.getEditorDialogFrame). The Publish button is
// the React wrapper's floating action inside this iframe, not the nested Studio.
const MODAL = '[data-testid="custom-ui-fullscreen-modal-dialog"]';
const MODAL_IFRAME = `${MODAL} [data-testid="hosted-resources-iframe"]`;

const skip = testConfig.productType !== 'asyncapi';

/**
 * Navigate to the "My API Documents" space-page dashboard and return its
 * (content-body-scoped) iframe once "+ Create New API" has painted — i.e. the
 * Vue tree hydrated and the v2/custom-content search resolved.
 */
async function openDashboard(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  let spaceKey = testConfig.spaceKey;
  try {
    const resp = await request.get(`https://${testConfig.domain}/wiki/api/v2/spaces?limit=1`);
    if (resp.ok()) {
      const first = (await resp.json())?.results?.[0]?.key;
      if (typeof first === 'string' && first.length > 0) spaceKey = first;
    }
  } catch {
    // fall back to the profile default; a wrong URL surfaces below.
  }

  const url =
    `https://${testConfig.domain}/wiki/spaces/${spaceKey}` +
    `/apps/${APP_ID}/${STAGING_ENV_ID}/${ROUTE}`;
  console.log(`▶ AsyncAPI dashboard: ${url}`);
  await page.goto(url);

  // Scope to the dashboard iframe (the pageBanner module mounts a second
  // 0x0 iframe with the same APP_ID outside #content-body).
  const frame = page.frameLocator(`#content-body iframe[src*="${APP_ID}"]`);
  await expect(frame.getByRole('button', { name: /create new api/i }))
    .toBeVisible({ timeout: 60_000 });
  return frame;
}

/**
 * The editor modal is open. Click Publish and assert the modal dismisses,
 * which only happens after the save round-trips server-side.
 */
async function publishAndExpectClose(page: import('@playwright/test').Page) {
  await expect(page.locator(MODAL)).toBeVisible({ timeout: 60_000 });
  const editor = page.frameLocator(MODAL_IFRAME);
  const publish = editor.getByRole('button', { name: 'Publish' });
  await expect(publish).toBeVisible({ timeout: 90_000 });
  // Let the nested Studio iframe finish loading so its document is in
  // localStorage before saveSpec() reads it (it also flushes via Ctrl+S +
  // a 750ms backstop, but settling first avoids racing the very first paint).
  await page.waitForTimeout(3_000);
  await publish.click();
  await expect(page.locator(MODAL)).toBeHidden({ timeout: 60_000 });
}

test.describe('AsyncAPI create + edit', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(skip, `Profile ${testConfig.domain} is not the asyncapi variant`);

  test('create: "+ Create New API" → Publish persists a new document', async ({ page, request }) => {
    test.slow(); // dashboard load + studio load + publish exceed the project's 120s default
    const dashboard = await openDashboard(page, request);
    await dashboard.getByRole('button', { name: /create new api/i }).click();
    // "Create New API" is now a split-button that opens a format menu (dual-format
    // dashboard). Pick "AsyncAPI spec" → the AsyncAPI editor opens on
    // DEFAULT_ASYNCAPI_SPEC; no customContentId → Publish creates a new
    // async-api-doc. Modal closing == save succeeded.
    await dashboard.getByRole('menuitem', { name: /asyncapi spec/i }).click();
    await publishAndExpectClose(page);
  });

  test('edit: a card\'s "Edit" → Publish updates it in place', async ({ page, request }) => {
    test.slow();
    const dashboard = await openDashboard(page, request);
    // Cards render View / Edit / Archive; the create test above (serial) and
    // the existing seed data both guarantee at least one editable card.
    const editButton = dashboard.getByRole('button', { name: 'Edit' }).first();
    await expect(editButton).toBeVisible({ timeout: 60_000 });
    await editButton.click();
    // modal.customContentId passed → editor loads the stored spec; Publish
    // pins the save to that id (in-place update, no fork).
    await publishAndExpectClose(page);
  });

  test('create: "OpenAPI (Swagger) spec" → Publish persists a new OpenAPI document', async ({ page, request }) => {
    test.slow();
    const dashboard = await openDashboard(page, request);
    await dashboard.getByRole('button', { name: /create new api/i }).click();
    // Dual-format: the OpenAPI menu item opens the swagger editor on the default
    // OpenApiExample; no customContentId → Publish creates a new async-api-doc
    // stored with diagramType 'OpenAPI'. Same fullscreen-modal + Publish contract
    // as the AsyncAPI editor, so publishAndExpectClose covers it unchanged.
    await dashboard.getByRole('menuitem', { name: /openapi .*spec/i }).click();
    await publishAndExpectClose(page);
  });
});
