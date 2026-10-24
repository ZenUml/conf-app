#!/usr/bin/env node
// Creates two pages to exercise isCopy=true (cross-page copy scenario):
//   Page A — the "source" page that owns the custom content
//   Page B — the "copy" page that references the same custom content from page A
//             When Page B is viewed, isCopy=true, copyReason='cross-page'
//             → Edit button should be disabled with tooltip
//
// Usage:
//   node create-icopy-test-pages.mjs --site lite-dev --space SD
// Output: Page B URL (the one that shows isCopy=true)

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SITES = {
  "lite-dev":   { host: "lite-dev.atlassian.net",   appId: "8ad26115-211f-4216-971b-0540f606303d", envId: "26ad8f7e-aa24-4afe-83a3-e8216f9e5220", envName: "DEVELOPMENT", suffix: "-lite", ns: "lite" },
  "lite-stg":   { host: "lite-stg.atlassian.net",   appId: "8ad26115-211f-4216-971b-0540f606303d", envName: "STAGING",     suffix: "-lite", ns: "lite" },
  "zenuml-stg": { host: "zenuml-stg.atlassian.net", appId: "8ad26115-211f-4216-971b-0540f606303d", envName: "STAGING",     suffix: "-lite", ns: "lite" },
  "zenuml":     { host: "zenuml.atlassian.net",     appId: "8ad26115-211f-4216-971b-0540f606303d", envId: "b28ee919-d73b-4f43-b7fd-45a3a881ec46", envName: "PRODUCTION", suffix: "-lite", ns: "lite" },
};

const { values: args } = parseArgs({
  options: {
    site:   { type: "string", default: "lite-dev" },
    space:  { type: "string", default: "SD" },
    parent: { type: "string" },
  },
});

const site = SITES[args.site];
if (!site) fail(`Unknown --site '${args.site}'. Choices: ${Object.keys(SITES).join(", ")}`);
if (!site.envId) fail(`Site '${args.site}' has no envId — fill it in the SITES table.`);

const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) fail("Missing FORGE_EMAIL / FORGE_API_TOKEN");

const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
const base = `https://${site.host}/wiki`;
const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

const seqCode = readFileSync(join(__dirname, "../fixtures/simple-sequence.zenuml"), "utf8");
const fullType = `ac:com.zenuml.confluence-addon-${site.ns}:zenuml-content-sequence`;

// 1. Create Page A (source — owns the custom content)
const pageA = await api("POST", "/rest/api/content", {
  type: "page",
  title: `isCopy source ${ts}`,
  space: { key: args.space },
  ...(args.parent ? { ancestors: [{ id: args.parent }] } : {}),
  body: { storage: { value: "<p>Source page — owns the diagram.</p>", representation: "storage" } },
});
console.error(`Page A created: ${pageA.id}`);

// 2. Create custom content with Page A as container
const cc = await api("POST", "/rest/api/content", {
  type: fullType,
  title: "sequence test content",
  container: { id: pageA.id, type: "page" },
  space: { key: args.space },
  body: { raw: { value: JSON.stringify({ diagramType: "sequence", code: seqCode }), representation: "raw" } },
});
console.error(`Custom content created: ${cc.id} (container = page A ${pageA.id})`);

// 3. Update Page A's body with the macro pointing at the custom content
await api("PUT", `/rest/api/content/${pageA.id}`, {
  type: "page",
  title: `isCopy source ${ts}`,
  version: { number: 2 },
  body: { atlas_doc_format: { value: JSON.stringify(makeAdf(`isCopy source ${ts}`, cc.id)), representation: "atlas_doc_format" } },
});
console.error(`Page A updated with macro.`);

// 4. Create Page B (the "copy" — references Page A's custom content)
const pageB = await api("POST", "/rest/api/content", {
  type: "page",
  title: `isCopy copy ${ts}`,
  space: { key: args.space },
  ...(args.parent ? { ancestors: [{ id: args.parent }] } : {}),
  body: { storage: { value: "<p>Copy page — references diagram from another page.</p>", representation: "storage" } },
});
console.error(`Page B created: ${pageB.id}`);

// 5. Update Page B's body with the same custom content ID (cross-page → isCopy=true)
await api("PUT", `/rest/api/content/${pageB.id}`, {
  type: "page",
  title: `isCopy copy ${ts}`,
  version: { number: 2 },
  body: { atlas_doc_format: { value: JSON.stringify(makeAdf(`isCopy copy ${ts}`, cc.id)), representation: "atlas_doc_format" } },
});

const pageBUrl = base + pageB._links.webui;
console.error(`Page B updated with cross-page macro → isCopy=true when viewed`);
console.error(`Page A (source): ${base + pageA._links.webui}`);
console.log(pageBUrl);

// ---

function makeAdf(title, ccId) {
  const moduleKey = `zenuml-sequence-macro${site.suffix}`;
  const key = `${site.appId}/${site.envId}/static/${moduleKey}`;
  return {
    version: 1,
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: title }] },
      {
        type: "extension",
        attrs: {
          extensionKey: key,
          extensionType: "com.atlassian.ecosystem",
          parameters: {
            localId: crypto.randomUUID(),
            extensionId: `ari:cloud:ecosystem::extension/${key}`,
            extensionTitle: `Diagram (Mermaid, PlantUML & ZenUML) Lite`,
            layout: "extension",
            "forge-environment": site.envName,
            guestParams: { "custom-content-id": ccId },
          },
          text: "Diagram (Mermaid, PlantUML & ZenUML)",
          layout: "default",
        },
      },
    ],
  };
}

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) fail(`HTTP ${res.status} on ${method} ${path}\n${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function fail(msg) { console.error(msg); process.exit(1); }
