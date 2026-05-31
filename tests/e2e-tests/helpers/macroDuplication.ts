// Helpers to manufacture the two "legitimate idChanged in a non-submittable
// surface" preconditions for ZenUml/conf-app#170, via the Confluence v2 API
// (the editor's clipboard copy/paste cannot be driven from Playwright — synthetic
// Cmd+C/V don't trigger ProseMirror's clipboard serialization).
//
// Both work by cloning a published macro's `extension` ADF node (the one that
// carries customContentId in attrs.parameters.guestParams.customContentId) with
// a FRESH localId:
//   - duplicateMacroSamePage: clone into the SAME page  → count>1 → save forks (same-page duplicate)
//   - copyMacroToNewPage:      clone into a NEW page     → cc lives elsewhere → samePage===false → save forks
//
// In both cases editing the macro in the in-viewer Edit Modal then forks at save,
// producing a new id (idChanged) in a surface that cannot view.submit — the #170 bug.

import { Page, expect } from '@playwright/test';
// Test-only helper: runs in the Playwright Node runtime (never on Forge /
// Cloudflare Workers), so node:crypto is available and the right choice.
import { randomUUID } from 'node:crypto';

interface Loaded {
  adf: any;
  versionNumber: number;
  title: string;
  spaceId: string;
  extensionNode: any;
}

function v2Base(domain: string, pageId: string): string {
  return `https://${domain}/wiki/api/v2/pages/${pageId}`;
}

async function loadPage(page: Page, domain: string, pageId: string): Promise<Loaded> {
  const res = await page.request.get(`${v2Base(domain, pageId)}?body-format=atlas_doc_format`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok()) throw new Error(`loadPage GET ${pageId} failed: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const adf = JSON.parse(json.body.atlas_doc_format.value);
  const extensionNode = adf.content.find((n: any) => n.type === 'extension');
  expect(extensionNode, `macro extension node present on page ${pageId}`).toBeTruthy();
  return { adf, versionNumber: json.version.number, title: json.title, spaceId: json.spaceId, extensionNode };
}

/** Deep-clone the extension node and assign it a fresh localId (both sites). */
function cloneNodeWithFreshLocalId(node: any): { clone: any; localId: string } {
  const clone = JSON.parse(JSON.stringify(node));
  const localId = randomUUID();
  clone.attrs.localId = localId;
  if (clone.attrs.parameters) clone.attrs.parameters.localId = localId;
  return { clone, localId };
}

export function customContentIdOf(node: any): string {
  return node.attrs?.parameters?.guestParams?.customContentId;
}

/**
 * Clone the macro into the SAME page so two macros share one customContentId
 * (count>1). Returns the shared customContentId.
 */
export async function duplicateMacroSamePage(page: Page, domain: string, pageId: string): Promise<string> {
  const { adf, versionNumber, title, extensionNode } = await loadPage(page, domain, pageId);
  const { clone } = cloneNodeWithFreshLocalId(extensionNode);
  adf.content.push(clone);
  const res = await page.request.put(v2Base(domain, pageId), {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    data: {
      id: pageId,
      status: 'current',
      title,
      version: { number: versionNumber + 1, message: '#170 e2e: duplicate macro node (count>1)' },
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
    },
  });
  if (!res.ok()) throw new Error(`duplicateMacroSamePage PUT failed: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return customContentIdOf(extensionNode);
}

/**
 * Create a NEW page (sibling under parentPageId) whose body contains a clone of
 * `sourcePageId`'s macro — so the cc lives on the source page and the copy sees
 * samePage===false at save. Returns the new page's id.
 */
export async function copyMacroToNewPage(
  page: Page,
  domain: string,
  parentPageId: string,
  sourcePageId: string,
): Promise<string> {
  const { spaceId, extensionNode } = await loadPage(page, domain, sourcePageId);
  const { clone } = cloneNodeWithFreshLocalId(extensionNode);
  const adf = { type: 'doc', content: [clone], version: 1 };
  const res = await page.request.post(`https://${domain}/wiki/api/v2/pages`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    data: {
      spaceId,
      status: 'current',
      title: `170 cross-page copy ${Date.now()}`,
      parentId: parentPageId,
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
    },
  });
  if (!res.ok()) throw new Error(`copyMacroToNewPage POST failed: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return String(json.id);
}
