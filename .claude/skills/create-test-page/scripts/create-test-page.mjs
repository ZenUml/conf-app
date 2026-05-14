#!/usr/bin/env node
// Create a Confluence test page with one or more ZenUML macros via the REST API.
// No browser, no editor — three HTTPS calls and you have a rendered page.
//
// Usage:
//   node create-test-page.mjs --site lite-dev --space SD --title "..." \
//     --macro graph:./fixtures/graph-wide.xml
//
// Output: the page URL (and nothing else).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

// site → host + Forge extension key components
const SITES = {
  "lite-dev":   { host: "lite-dev.atlassian.net",   appId: "8ad26115-211f-4216-971b-0540f606303d", envId: "26ad8f7e-aa24-4afe-83a3-e8216f9e5220", envName: "DEVELOPMENT", suffix: "-lite", ns: "lite" },
  "lite-stg":   { host: "lite-stg.atlassian.net",   appId: "8ad26115-211f-4216-971b-0540f606303d", envName: "STAGING",     suffix: "-lite", ns: "lite" },
  "zenuml-stg": { host: "zenuml-stg.atlassian.net", appId: "8ad26115-211f-4216-971b-0540f606303d", envName: "STAGING",     suffix: "-lite", ns: "lite" },
  "zenuml":     { host: "zenuml.atlassian.net",     appId: "8ad26115-211f-4216-971b-0540f606303d", envId: "b28ee919-d73b-4f43-b7fd-45a3a881ec46", envName: "PRODUCTION", suffix: "-lite", ns: "lite" },
};

// macro type → Forge module key, ADF title, custom-content type suffix, body wrapper
const MACROS = {
  graph:    { module: "zenuml-graph-macro",    title: "Graph (DrawIO)",                       contentType: "zenuml-content-graph",    wrap: c => JSON.stringify({ diagramType: "graph",    graphXml: c }) },
  sequence: { module: "zenuml-sequence-macro", title: "Diagram (Mermaid, PlantUML & ZenUML)", contentType: "zenuml-content-sequence", wrap: c => JSON.stringify({ diagramType: "sequence", code:     c }) },
  openapi:  { module: "zenuml-openapi-macro",  title: "OpenAPI",                              contentType: "zenuml-content-openapi",  wrap: c => JSON.stringify({ diagramType: "openapi",  spec:     c }) },
};

const { values: args } = parseArgs({
  options: {
    site:   { type: "string" },
    space:  { type: "string" },
    title:  { type: "string" },
    parent: { type: "string" },
    macro:  { type: "string", multiple: true },
  },
});

const site = SITES[args.site];
if (!site) fail(`Unknown --site '${args.site}'. Choices: ${Object.keys(SITES).join(", ")}`);
if (!site.envId) fail(`Site '${args.site}' has no envId in SITES table — fill it in (find with: forge environments list).`);
if (!args.space) fail("Missing --space (e.g. SD, ZEN)");

const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) fail("Missing FORGE_EMAIL / FORGE_API_TOKEN. Create a token at https://id.atlassian.com/manage-profile/security/api-tokens");

const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
const base = `https://${site.host}/wiki`;
const title = args.title || `Test page ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

// 1. Create empty page
const pageReq = {
  type: "page",
  title,
  space: { key: args.space },
  body: { storage: { value: "<p>Auto-created test page.</p>", representation: "storage" } },
};
if (args.parent) pageReq.ancestors = [{ id: args.parent }];
const page = await api("POST", "/rest/api/content", pageReq);

// 2. Create custom content per macro and build ADF nodes
const adfNodes = [];
for (const spec of args.macro || []) {
  const idx = spec.indexOf(":");
  if (idx < 0) fail(`--macro must be 'type:file', got '${spec}'`);
  const type = spec.slice(0, idx);
  const file = spec.slice(idx + 1);
  const info = MACROS[type];
  if (!info) fail(`Unknown macro type '${type}'. Choices: ${Object.keys(MACROS).join(", ")}`);

  const wrapped = info.wrap(readFileSync(file, "utf8"));
  const fullType = `ac:com.zenuml.confluence-addon-${site.ns}:${info.contentType}`;
  const cc = await api("POST", "/rest/api/content", {
    type: fullType,
    title: `${type} test content`,
    container: { id: page.id, type: "page" },
    space: { key: args.space },
    body: { raw: { value: wrapped, representation: "raw" } },
  });
  adfNodes.push(makeExtension(type, cc.id));
}

// 3. Update page body with ADF containing the macros
const adf = {
  version: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: title }] },
    ...adfNodes,
  ],
};
await api("PUT", `/rest/api/content/${page.id}`, {
  type: "page",
  title,
  version: { number: 2 },
  body: { atlas_doc_format: { value: JSON.stringify(adf), representation: "atlas_doc_format" } },
});

console.log(base + page._links.webui);

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

function makeExtension(type, ccId) {
  const info = MACROS[type];
  const moduleKey = info.module + site.suffix;
  const key = `${site.appId}/${site.envId}/static/${moduleKey}`;
  return {
    type: "extension",
    attrs: {
      extensionKey: key,
      extensionType: "com.atlassian.ecosystem",
      parameters: {
        localId: crypto.randomUUID(),
        extensionId: `ari:cloud:ecosystem::extension/${key}`,
        extensionTitle: info.title + (site.suffix === "-lite" ? " Lite" : ""),
        layout: "extension",
        "forge-environment": site.envName,
        guestParams: { "custom-content-id": ccId },
      },
      text: info.title,
      layout: "default",
    },
  };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
