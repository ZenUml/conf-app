import type {APIRequestContext} from '@playwright/test';
export interface ParentFixtureConfig {
  domain: string; spaceKey: string; parentPageId: string; parentPageName: string;
  productType: string; isProd: boolean;
}
/** Provision one parent per worker for the parentless AsyncAPI staging profile. */
export async function provisionParentFixture(request: APIRequestContext, config: ParentFixtureConfig): Promise<void> {
  if (config.parentPageId) return;
  if (config.productType !== 'asyncapi' || config.isProd) throw new Error('Parent page must be configured outside AsyncAPI staging');
  const base = `https://${config.domain}/wiki/api/v2`;
  const response = await request.get(`${base}/spaces?keys=${encodeURIComponent(config.spaceKey)}&limit=1`);
  if (!response.ok()) throw new Error(`Test space discovery failed (${response.status()})`);
  let space = (await response.json()).results?.[0];
  // Match the existing AsyncAPI fixture's first-accessible-space fallback.
  if (!space) {
    const fallback = await request.get(`${base}/spaces?limit=1`);
    if (!fallback.ok()) throw new Error(`Test space discovery failed (${fallback.status()})`);
    space = (await fallback.json()).results?.[0];
  }
  if (!space?.id || !space?.key) throw new Error('No accessible AsyncAPI staging test space');
  const title = `Integration test parent ${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 'local'}-${process.pid}`;
  const created = await request.post(`${base}/pages`, {data:{spaceId:String(space.id),status:'current',title,body:{representation:'storage',value:'<p>Automated integration test fixtures.</p>'}}});
  if (!created.ok()) throw new Error(`Test parent creation failed (${created.status()})`);
  const parent = await created.json();
  if (!parent.id) throw new Error('Created test parent has no page ID');
  config.spaceKey = space.key;
  config.parentPageId = String(parent.id);
  config.parentPageName = title;
}
