// Per-page lookup of whether the currently-loaded macro lives on a Diagramly
// demo page. The backend tags the page on creation with a
// `diagramly-demo-page` page property (see createDemoPage.js → tagDemoPage).
// Frontend reads it once per page id and caches in-memory so the per-view
// network cost is paid at most once per session.
//
// Used by trackAnalyticsEvent to enrich macro_viewed / macro_save_succeeded /
// macro_edit_started payloads with `is_demo_page: true` so analysts can filter
// engagement signals to demo pages.

import forgeGlobal from "@/model/globals/forgeGlobal";
import { forgeRequest } from "@/utils/requestUtil";

const PAGE_PROPERTY_KEY = "diagramly-demo-page";

const cache = new Map<string, boolean | Promise<boolean>>();

function getCurrentPageId(): string | undefined {
  // Forge macro context carries the page id under extension.content.id.
  // forgeGlobal is typed `any` (see model/globals/forgeGlobal.ts), so this
  // chain never actually type-errors — no @ts-expect-error needed here.
  return forgeGlobal.forgeContext?.extension?.content?.id;
}

async function fetchDemoPageFlag(pageId: string): Promise<boolean> {
  try {
    const body = await forgeRequest(
      `/wiki/api/v2/pages/${pageId}/properties?key=${PAGE_PROPERTY_KEY}`,
    );
    const hit = body && body.results && body.results[0];
    return !!(hit && hit.value && hit.value.isDemoPage === true);
  } catch {
    return false;
  }
}

export function isCurrentPageDemoPage(): Promise<boolean> {
  const pageId = getCurrentPageId();
  if (!pageId) return Promise.resolve(false);
  const cached = cache.get(pageId);
  if (cached !== undefined) {
    return cached instanceof Promise ? cached : Promise.resolve(cached);
  }
  const p = fetchDemoPageFlag(pageId);
  cache.set(pageId, p);
  // fetchDemoPageFlag catches internally and resolves false — p never rejects.
  p.then((b) => cache.set(pageId, b));
  return p;
}

// Test helper.
export function _resetDemoPageStatusCache(): void {
  cache.clear();
}
