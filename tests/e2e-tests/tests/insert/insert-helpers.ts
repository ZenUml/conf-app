import { Page, APIRequestContext, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';

/**
 * Creates a child page in Confluence and types a smoke-test title.
 * Returns the EditorPage instance for further macro insertion.
 */
export async function createPageAndSetup(page: Page, variantLabel: string): Promise<ConfluenceEditorPage> {
  const editorPage = new ConfluenceEditorPage(page);

  await editorPage.navigateToParentPage();
  console.log(`  ✓ Parent page loaded`);

  await editorPage.createChildPage();
  const rand = Math.random().toString(36).slice(2, 7);
  const pageTitle = ConfluenceEditorPage.generatePageTitle(variantLabel) + ` ${rand}`;
  await editorPage.typePageTitle(pageTitle);
  console.log(`  ✓ Editor ready: "${pageTitle}"`);

  return editorPage;
}

/**
 * Publishes the current page, dismisses any spotlight modal,
 * verifies the expected number of macro iframes render, and takes a screenshot.
 * Returns the published page ID extracted from the URL.
 */
export async function publishAndVerifyMacros(page: Page, editorPage: ConfluenceEditorPage, macroCount: number, screenshotName: string): Promise<string> {
  await editorPage.publishPage();
  console.log(`  ✓ Page published`);

  const macroPage = new MacroPage(page);
  await macroPage.dismissSpotlightModal();

  await expect(page.locator('#title-text')).toContainText('Smoke Test');

  if (testConfig.isForge || testConfig.isLite) {
    const forgeIframes = page.locator('[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]');
    await expect(forgeIframes.first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(forgeIframes).toHaveCount(macroCount, { timeout: TIMEOUTS.FRAME_LOAD });
  } else {
    // Connect macro iframes have IDs like "{addonKey}__{macroKey}__{hash}".
    // Avoid using iframe.ap-iframe (class added by AC.js asynchronously)
    // or iframe[src*=domain] (src is the Cloudflare URL, not the Confluence domain).
    const connectIframes = page.locator(`iframe[id*="${testConfig.addonKey}"]`);
    await expect(connectIframes.first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(connectIframes).toHaveCount(macroCount, { timeout: TIMEOUTS.FRAME_LOAD });
  }

  console.log(`  ✓ ${macroCount} macro iframe(s) visible on published page`);

  await page.screenshot({
    path: `${screenshotName}-${Date.now()}.png`,
    fullPage: true,
  });

  const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1] ?? '';
  if (!pageId) console.warn(`  ⚠ Could not extract page ID from URL: ${page.url()}`);
  return pageId;
}

/**
 * Moves a page into the PVT/{year}/{year-month} folder hierarchy under parentPageId.
 * Creates intermediate folders as needed. Only called on prod profiles.
 */
export async function moveToPvt(request: APIRequestContext, pageId: string): Promise<void> {
  const { domain, spaceKey, parentPageId } = testConfig;
  const baseUrl = `https://${domain}/wiki`;

  async function getJson(path: string) {
    const r = await request.get(`${baseUrl}${path}`, { headers: { Accept: 'application/json' } });
    return r.json();
  }

  async function findChildByTitle(pid: string, title: string): Promise<string | null> {
    const data = await getJson(`/rest/api/content/${pid}/child/page?title=${encodeURIComponent(title)}&limit=25`);
    return data.results?.find((p: { title: string }) => p.title === title)?.id ?? null;
  }

  async function createFolder(spaceId: string, pid: string, title: string): Promise<string> {
    const r = await request.post(`${baseUrl}/api/v2/pages`, {
      headers: { 'Content-Type': 'application/json' },
      data: { spaceId, status: 'current', title, parentId: pid, body: { representation: 'storage', value: '' } },
    });
    const data = await r.json();
    return data.id;
  }

  async function movePage(pid: string, newParentId: string): Promise<void> {
    const pageData = await getJson(`/rest/api/content/${pid}?expand=version,body.storage,space`);
    await request.put(`${baseUrl}/rest/api/content/${pid}`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        type: 'page',
        title: pageData.title,
        ancestors: [{ id: parseInt(newParentId) }],
        version: { number: pageData.version.number + 1 },
        body: { storage: { value: pageData.body.storage.value, representation: 'storage' } },
      },
    });
  }

  // Get space ID from parent page
  const parentData = await getJson(`/rest/api/content/${parentPageId}?expand=space`);
  const spaceId = parentData.space?.id;
  if (!spaceId) throw new Error(`Could not get space ID for space ${spaceKey}`);

  const now = new Date();
  const year = now.getFullYear().toString();
  const month = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let pvtId = await findChildByTitle(parentPageId, 'PVT');
  if (!pvtId) pvtId = await createFolder(spaceId, parentPageId, 'PVT');

  let yearId = await findChildByTitle(pvtId, year);
  if (!yearId) yearId = await createFolder(spaceId, pvtId, year);

  let monthId = await findChildByTitle(yearId, month);
  if (!monthId) monthId = await createFolder(spaceId, yearId, month);

  await movePage(pageId, monthId);
  console.log(`  ✓ Page ${pageId} moved to PVT/${year}/${month}`);
}
