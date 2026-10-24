import { APIRequestContext, Page, expect } from '@playwright/test';

// Helpers for the byline activation nudge (spec v5). The "View as diagram"
// contentBylineItem only appears on a page carrying the content property
// `zenuml-prepared-diagram` (server-side entityPropertyExists gate); the
// property means a curated AI diagram is ready. These helpers seed/remove that
// property via v2 REST — the same path that verified the gate both
// directions (spec §4) — and drive the byline dialog inside its Forge iframe.
//
// The property write is an ordinary authenticated REST call against the live
// site (Basic auth FORGE_EMAIL:FORGE_API_TOKEN or the test storageState
// session); it does NOT go through the Forge app, so it works with no deploy —
// exactly how the pilot hand-seeds curated pages.

export const PREPARED_PROPERTY_KEY = 'zenuml-prepared-diagram';

// Seed (or overwrite) the prepared-diagram property on a page. Returns the
// property id (needed to update/remove — v2 requires the id + a version bump).
export async function seedPreparedProperty(
  request: APIRequestContext,
  baseUrl: string,
  pageId: string,
): Promise<string> {
  const existing = await request.get(
    `${baseUrl}/wiki/api/v2/pages/${pageId}/properties?key=${PREPARED_PROPERTY_KEY}`,
  );
  const body = await existing.json();
  const current = body?.results?.[0];
  const value = { v: 1 };

  if (current?.id) {
    const res = await request.put(
      `${baseUrl}/wiki/api/v2/pages/${pageId}/properties/${current.id}`,
      { data: { key: PREPARED_PROPERTY_KEY, value, version: { number: (current.version?.number ?? 1) + 1 } } },
    );
    expect(res.ok(), `update property: ${res.status()}`).toBeTruthy();
    return current.id;
  }
  const res = await request.post(
    `${baseUrl}/wiki/api/v2/pages/${pageId}/properties`,
    { data: { key: PREPARED_PROPERTY_KEY, value } },
  );
  expect(res.ok(), `create property: ${res.status()}`).toBeTruthy();
  return String((await res.json()).id);
}

// Remove the property (restores the page to "no byline"). Idempotent.
export async function removePreparedProperty(
  request: APIRequestContext,
  baseUrl: string,
  pageId: string,
): Promise<void> {
  const existing = await request.get(
    `${baseUrl}/wiki/api/v2/pages/${pageId}/properties?key=${PREPARED_PROPERTY_KEY}`,
  );
  const id = (await existing.json())?.results?.[0]?.id;
  if (id) {
    await request.delete(`${baseUrl}/wiki/api/v2/pages/${pageId}/properties/${id}`);
  }
}

// Locate the "View as diagram" byline chip on a rendered Confluence page. The
// byline items render in the page's byline row (top frame, not inside a macro
// iframe), so a plain top-frame locator reaches it.
export function bylineChip(page: Page) {
  return page.getByRole('button', { name: /view as diagram/i })
    .or(page.getByText(/view as diagram/i));
}
