#!/usr/bin/env node
// ZEN-1170 Defect 1 fixture: create a Confluence page with a graph macro
// in the LEGACY shape — macro XML has only `uuid` in guestParams (NO
// custom-content-id), and a matching page content property
// `zenuml-graph-macro-{uuid}-body` carries the actual diagram body.
//
// This reproduces the Connect-era legacy storage shape observed on
// affected production pages. Per-tenant reproduction notes (if needed)
// live in private/zen-1170/.
//
// Usage:
//   set -a; source .env.forge.local; set +a
//   node scripts/create-legacy-graph-fixture.mjs --site lite-dev --space SD
//
// Output: the page URL and the legacy uuid (the latter so you can hand-
// inspect or update the content property afterwards).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

const SITES = {
  "lite-dev": { host: "lite-dev.atlassian.net", appId: "8ad26115-211f-4216-971b-0540f606303d", envId: "26ad8f7e-aa24-4afe-83a3-e8216f9e5220", envName: "DEVELOPMENT", suffix: "-lite", ns: "lite" },
};

const { values: args } = parseArgs({
  options: {
    site: { type: "string", default: "lite-dev" },
    space: { type: "string" },
    title: { type: "string" },
    parent: { type: "string" },
    body: { type: "string" },
  },
});

const site = SITES[args.site];
if (!site) fail(`Unknown --site '${args.site}'`);
if (!args.space) fail("Missing --space");

const email = process.env.FORGE_EMAIL;
const token = process.env.FORGE_API_TOKEN;
if (!email || !token) fail("Missing FORGE_EMAIL / FORGE_API_TOKEN in .env.forge.local");

const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
const base = `https://${site.host}/wiki`;
const title = args.title || `Legacy graph fixture ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

// The fixture diagram body. Default: a tiny synthetic graph that's visibly
// non-empty so the test can distinguish "rendered from content property"
// from "rendered EMPTY_GRAPH".
const FALLBACK_GRAPH_XML = `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="legacy-box-1" value="LEGACY FIXTURE" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#FFD700;" vertex="1" parent="1">
      <mxGeometry x="320" y="240" width="240" height="80" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>`;

const graphXml = args.body ? readFileSync(args.body, "utf8") : FALLBACK_GRAPH_XML;

// 1. Generate the legacy uuid (this is the macro identity that keys the
//    content property; in Connect-era macros it came from guestParams.uuid).
const legacyUuid = randomUUID();
const propertyKey = `zenuml-graph-macro-${legacyUuid}-body`;

// 2. Create empty page
const pageReq = {
  type: "page",
  title,
  space: { key: args.space },
  body: { storage: { value: "<p>Auto-created legacy-macro fixture page.</p>", representation: "storage" } },
};
if (args.parent) pageReq.ancestors = [{ id: args.parent }];
const page = await api("POST", "/rest/api/content", pageReq);

// 3. Write the content property at the legacy key with the diagram body.
//    Shape mirrors what ContentPropertyStorageProvider expects: value is a
//    Diagram object containing graphXml.
const propertyValue = {
  diagramType: "graph",
  graphXml,
};
await api("POST", `/rest/api/content/${page.id}/property`, {
  key: propertyKey,
  value: propertyValue,
});

// 4. Update page body with ADF containing an extension node that has ONLY
//    uuid in guestParams — NO custom-content-id. This is the on-disk shape
//    of the legacy macro.
const moduleKey = "zenuml-graph-macro" + site.suffix;
const extensionKey = `${site.appId}/${site.envId}/static/${moduleKey}`;
const adf = {
  version: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: `Legacy graph macro fixture (uuid=${legacyUuid})` }] },
    {
      type: "extension",
      attrs: {
        extensionKey,
        extensionType: "com.atlassian.ecosystem",
        parameters: {
          localId: randomUUID(),
          extensionId: `ari:cloud:ecosystem::extension/${extensionKey}`,
          extensionTitle: "Graph (DrawIO) Lite",
          layout: "extension",
          "forge-environment": site.envName,
          guestParams: { uuid: legacyUuid }, // <-- LEGACY: uuid only, NO custom-content-id
        },
        text: "Graph (DrawIO)",
        layout: "default",
      },
    },
  ],
};
await api("PUT", `/rest/api/content/${page.id}`, {
  type: "page",
  title,
  version: { number: 2 },
  body: { atlas_doc_format: { value: JSON.stringify(adf), representation: "atlas_doc_format" } },
});

const url = base + page._links.webui;
console.log(JSON.stringify({ url, pageId: page.id, legacyUuid, propertyKey }, null, 2));

// ---

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

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
