#!/usr/bin/env node
/**
 * Ephemeral spot check for the EMBED viewer load path on lite-dev via Forge
 * tunnel. Targets the #2 fix: forge-embed-viewer.ts migrated from
 * getCustomContentByIdV2 + bare `return doc` to the unified
 * loadCustomContentWithOrphanRecovery + { doc, loadError } shape.
 *
 * Cases:
 *   1. Healthy embed (extension points at a real sequence CC) → renders, no panel.
 *   2. Broken embed (extension points at a bogus CC id) → retryable load-failed
 *      panel (failed_with_source), proving the rewritten loadDiagram returns a
 *      loadError and classification still fires.
 *
 * Usage (from repo root, tunnel + pnpm start:local running):
 *   set -a; source .env.forge.local; set +a
 *   node scripts/spot-check-embed-load.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const AUTH_STATE =
  process.env.AUTH_STATE_PATH
  || '/Users/pengxiao/workspaces/zenuml/conf-app/tests/e2e-tests/auth-state-lite-dev.atlassian.net.json';
const OUT_DIR = new URL('../.spot-check-screenshots', import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

const SITE = {
  host: 'lite-dev.atlassian.net',
  space: 'SD',
  parent: '196866',
  appId: '8ad26115-211f-4216-971b-0540f606303d',
  envId: '26ad8f7e-aa24-4afe-83a3-e8216f9e5220',
  envName: 'DEVELOPMENT',
};

const email = process.env.FORGE_EMAIL;
const token = process.env.FORGE_API_TOKEN;
if (!email || !token) {
  console.error('Missing FORGE_EMAIL / FORGE_API_TOKEN');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
const base = `https://${SITE.host}/wiki`;

const results = [];

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${method} ${path}\n${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

function embedExtension(ccId) {
  const moduleKey = 'zenuml-embed-macro-lite';
  const key = `${SITE.appId}/${SITE.envId}/static/${moduleKey}`;
  const guestParams = ccId ? { 'custom-content-id': ccId } : {};
  return {
    type: 'extension',
    attrs: {
      extensionKey: key,
      extensionType: 'com.atlassian.ecosystem',
      parameters: {
        localId: randomUUID(),
        extensionId: `ari:cloud:ecosystem::extension/${key}`,
        extensionTitle: 'Embed a Diagram, Graph or API Spec Lite',
        layout: 'extension',
        'forge-environment': SITE.envName,
        guestParams,
      },
      text: 'Embed',
      layout: 'default',
    },
  };
}

async function createEmbedPage(title, { ccId, bodyValue } = {}) {
  const page = await api('POST', '/rest/api/content', {
    type: 'page',
    title,
    space: { key: SITE.space },
    ancestors: [{ id: SITE.parent }],
    body: { storage: { value: '<p>Embed spot check throwaway</p>', representation: 'storage' } },
  });

  let linkedCcId = ccId;
  if (bodyValue) {
    // Embed wraps any diagram type; a sequence-content CC is enough to prove
    // the embed viewer loads + renders a real doc through the unified path.
    const wrapped = JSON.stringify({ diagramType: 'sequence', code: bodyValue });
    const fullType = 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence';
    const cc = await api('POST', '/rest/api/content', {
      type: fullType,
      title: `${title} content`,
      container: { id: page.id, type: 'page' },
      space: { key: SITE.space },
      body: { raw: { value: wrapped, representation: 'raw' } },
    });
    linkedCcId = cc.id;
  }

  const adf = {
    version: 1,
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: title }] },
      embedExtension(linkedCcId),
    ],
  };
  await api('PUT', `/rest/api/content/${page.id}`, {
    type: 'page',
    title,
    version: { number: 2 },
    body: {
      atlas_doc_format: {
        value: JSON.stringify(adf),
        representation: 'atlas_doc_format',
      },
    },
  });
  return `${base}${page._links.webui}`;
}

async function inspectViewer(page, label, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(15000);
  const frame = page
    .frameLocator('[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]')
    .first();
  await frame.locator('body').waitFor({ state: 'visible', timeout: 45000 });
  const failed = await frame.getByTestId('load-failed-generic').isVisible({ timeout: 5000 }).catch(() => false);
  const retryable = failed
    ? await frame.getByRole('button', { name: 'Try again' }).isVisible({ timeout: 2000 }).catch(() => false)
    : false;
  const support = failed
    ? await frame.getByRole('button', { name: 'Contact support' }).isVisible({ timeout: 2000 }).catch(() => false)
    : false;
  const healthyText = !failed
    ? await frame.getByText(/participant|Alice|Bob|OrderService|order/i).first().isVisible({ timeout: 15000 }).catch(() => false)
    : false;
  const shot = `${OUT_DIR}/${label.replace(/\s+/g, '-')}.png`;
  await page.screenshot({ path: shot, fullPage: true });
  return { label, url, failed, retryable, support, healthyText, shot };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH_STATE });
  const page = await context.newPage();

  const ts = Date.now();

  const healthyUrl = await createEmbedPage(`Spot check embed healthy ${ts}`, {
    bodyValue: 'Alice -> Bob: hello from embed',
  });
  const healthy = await inspectViewer(page, 'embed-healthy', healthyUrl);
  results.push({
    assertion: 'Embed macro with a real CC renders a diagram (no load-failed panel)',
    pass: !healthy.failed && healthy.healthyText,
    ...healthy,
  });

  const brokenUrl = await createEmbedPage(`Spot check embed broken CC ${ts}`, {
    ccId: '00000000-0000-0000-0000-000000009999',
  });
  const broken = await inspectViewer(page, 'embed-broken-cc', brokenUrl);
  results.push({
    assertion: 'Embed macro with an invalid CC id shows retryable load-failed panel',
    pass: broken.failed && broken.retryable && broken.support,
    ...broken,
  });

  await browser.close();

  console.log(JSON.stringify(results, null, 2));
  const allPass = results.every(r => r.pass);
  process.exit(allPass ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
