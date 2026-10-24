#!/usr/bin/env node
// Create a Confluence test page with one or more ZenUML macros via the REST API.
// No browser, no editor — three HTTPS calls and you have a rendered page.
//
// Usage:
//   node create-test-page.mjs --app lite --environment development --site lite-dev --space SD --title "..." \
//     --macro graph:./fixtures/graph-wide.xml
//
// Output: the page URL, page ID, and custom-content IDs.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

// Internal registry: callers select app × environment × site; this resolves
// the Forge identity and content contract. Environment IDs verified 2026-08-21.
const APPS = {
  lite: { appId: "8ad26115-211f-4216-971b-0540f606303d", suffix: "-lite", connectKey: "com.zenuml.confluence-addon-lite", sequenceModule: "zenuml-sequence-macro", contentTypes: { sequence: "zenuml-content-sequence", graph: "zenuml-content-graph" }, environments: {
    development: { envId: "26ad8f7e-aa24-4afe-83a3-e8216f9e5220", envName: "DEVELOPMENT", sites: { "lite-dev": "lite-dev.atlassian.net" } },
    staging: { envId: "5ea0d957-4b7d-47e5-b8cc-7d5fb4fc2338", envName: "STAGING", sites: { "lite-stg": "lite-stg.atlassian.net", "zenuml-stg": "zenuml-stg.atlassian.net" } },
    production: { envId: "b28ee919-d73b-4f43-b7fd-45a3a881ec46", envName: "PRODUCTION", sites: { zenuml: "zenuml.atlassian.net" } },
  } },
  full: { appId: "d9e4002b-120b-426b-834b-402a4a5adce7", suffix: "", connectKey: "com.zenuml.confluence-addon", sequenceModule: "zenuml-sequence-macro", contentTypes: { sequence: "zenuml-content-sequence", graph: "zenuml-content-graph" }, environments: {
    staging: { envId: "095a5f48-0aa4-48b6-b546-0535bcee7c8e", envName: "STAGING", sites: { "full-stg": "full-stg.atlassian.net" } },
    production: { envId: "bd98a544-377a-4832-a72f-eb8d80b19dde", envName: "PRODUCTION", sites: { zenuml: "zenuml.atlassian.net" } },
  } },
  diagramly: { appId: "01ede8b1-4e88-451a-b9ef-89eeef93afaf", suffix: "", connectKey: "gptdock-confluence", sequenceModule: "gpt-diagram-macro", contentTypes: { sequence: "gpt-custom-content-key", graph: "gpt-custom-content-key" }, environments: {
    staging: { envId: "d9ad28ee-2933-45fc-8044-0002bc0609de", envName: "STAGING", sites: { "diagramly-stg": "dia-stg.atlassian.net" } },
    production: { envId: "ed175036-060c-4db6-bd4b-5de0d7281269", envName: "PRODUCTION", sites: { zenuml: "zenuml.atlassian.net" } },
  } },
  asyncapi: { appId: "49017727-af19-4ab6-8d5a-7d28108936b6", suffix: "", connectKey: "my-api", sequenceModule: "zenuml-asyncapi-macro", contentTypes: { sequence: "async-api-doc", graph: "async-api-doc" }, environments: {
    staging: { envId: "a75bfad8-d5f1-4487-8c75-704d0e0df3ab", envName: "STAGING", sites: { "asyncapi-stg": "asyncapi-stg.atlassian.net" } },
    production: { envId: "a58a4c8f-ea66-45db-804e-19021b1bf8d7", envName: "PRODUCTION", sites: { zenuml: "zenuml.atlassian.net" } },
  } },
};

// macro type → Forge module key, ADF title, custom-content type suffix, body wrapper
const MACROS = {
  graph:    { module: "zenuml-graph-macro",    title: "Graph (DrawIO)",                       contentKey: "graph",    diagramType: "graph",    wrap: c => JSON.stringify({ diagramType: "graph",    graphXml: c }) },
  sequence: { module: "zenuml-sequence-macro", title: "Diagram (Mermaid, PlantUML & ZenUML)", contentKey: "sequence", diagramType: "sequence", wrap: c => JSON.stringify({ diagramType: "sequence", code:     c }) },
  mermaid:  { module: "zenuml-sequence-macro", title: "Diagram (Mermaid, PlantUML & ZenUML)", contentKey: "sequence", diagramType: "mermaid",  wrap: c => JSON.stringify({ diagramType: "mermaid",  mermaidCode:  c }) },
  plantuml: { module: "zenuml-sequence-macro", title: "Diagram (Mermaid, PlantUML & ZenUML)", contentKey: "sequence", diagramType: "plantuml", wrap: c => JSON.stringify({ diagramType: "plantuml", plantUmlCode: c }) },
  // manifest.yml declares only two customContent types (zenuml-content-sequence,
  // zenuml-content-graph). OpenAPI stores under the sequence type with
  // diagramType "OpenAPI" (exact casing, DiagramType.OpenApi) and field `code`.
  openapi:  { module: "zenuml-openapi-macro",  title: "OpenAPI",                              contentKey: "sequence", diagramType: "OpenAPI", wrap: c => JSON.stringify({ diagramType: "OpenAPI",  code:         c }) },
  asyncapi: { module: "zenuml-asyncapi-macro", title: "AsyncAPI",                             contentKey: "sequence", diagramType: "AsyncAPI", wrap: c => JSON.stringify({ diagramType: "AsyncAPI", code: c }) },
};

const { values: args } = parseArgs({
  options: {
    app:   { type: "string" },
    environment: { type: "string" },
    site:  { type: "string" },
    space:  { type: "string" },
    title:  { type: "string" },
    parent: { type: "string" },
    macro:  { type: "string", multiple: true },
    filler: { type: "string" },
  },
});

if (!args.app || !APPS[args.app]) fail(`Missing or unknown --app '${args.app || ""}'. Apps: ${Object.keys(APPS).join(", ")}`);
if (!args.environment || !APPS[args.app].environments[args.environment]) fail(`Missing or unsupported --environment '${args.environment || ""}' for ${args.app}`);
const app = APPS[args.app];
const environment = app.environments[args.environment];
if (!args.site || !environment.sites[args.site]) fail(`Missing or unsupported --site '${args.site || ""}'. Sites for ${args.app}@${args.environment}: ${Object.keys(environment.sites).join(", ")}`);
const site = { ...app, ...environment, host: environment.sites[args.site] };
if (!args.space) fail("Missing --space (e.g. SD, ZEN)");
if (!args.macro?.length) fail("Missing --macro (pass at least one type:file)");
const parsedMacros = args.macro.map((spec) => {
  const idx = spec.indexOf(":");
  if (idx < 0) fail(`--macro must be 'type:file', got '${spec}'`);
  const type = spec.slice(0, idx);
  const file = spec.slice(idx + 1);
  const info = MACROS[type];
  if (!info) fail(`Unknown macro type '${type}'. Choices: ${Object.keys(MACROS).join(", ")}`);
  if (!site.contentTypes?.[info.contentKey]) fail(`App '${args.app}' does not declare a content key for '${type}'`);
  const content = readFileSync(file, "utf8");
  if (!content.trim()) fail(`Macro file is empty: '${file}'`);
  return { type, info, content };
});

const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) fail("Missing FORGE_EMAIL / FORGE_API_TOKEN. Create a token at https://id.atlassian.com/manage-profile/security/api-tokens");

const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
const base = `https://${site.host}/wiki`;
const title = args.title || `Test page ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
const createdRecords = [];
let page;

try {
  // 1. Create empty page
  const pageReq = {
    type: "page", title, space: { key: args.space },
    body: { storage: { value: "<p>Auto-created test page.</p>", representation: "storage" } },
  };
  if (args.parent) pageReq.ancestors = [{ id: args.parent }];
  page = await api("POST", "/rest/api/content", pageReq);

  // 2. Create custom content per macro and build ADF nodes
  const adfNodes = [];
  for (const { type, info, content } of parsedMacros) {
    const wrapped = info.wrap(content);
    const fullType = `ac:${site.connectKey}:${site.contentTypes[info.contentKey]}`;
    const cc = await api("POST", "/rest/api/content", {
    type: fullType,
    title: `${type} test content`,
    container: { id: page.id, type: "page" },
    space: { key: args.space },
    body: { raw: { value: wrapped, representation: "raw" } },
    });
    createdRecords.push({ id: String(cc.id), contentType: fullType, diagramType: info.diagramType });
    adfNodes.push(makeExtension(type, cc.id));
  }

// 3. Update page body with ADF containing the macros
const adf = {
  version: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: title }] },
    // --filler N pushes the macros below the fold: N paragraphs of text before
    // the first macro. Needed to reproduce viewport-position-dependent bugs —
    // a Forge macro iframe that is offscreen at load has its rendering
    // throttled by Chrome (no requestAnimationFrame), which broke the PNG
    // snapshot capture (PR #516).
    ...Array.from({ length: Number(args.filler || 0) }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: `filler line ${i + 1} ` + "x".repeat(60) }],
    })),
    ...adfNodes,
  ],
};
  await api("PUT", `/rest/api/content/${page.id}`, {
  type: "page",
  title,
  version: { number: 2 },
  body: { atlas_doc_format: { value: JSON.stringify(adf), representation: "atlas_doc_format" } },
  });

  await verifyPage(page.id, adfNodes, createdRecords);
  console.log(base + page._links.webui);
  console.log(`pageId=${page.id} customContentIds=${createdRecords.map(({ id }) => id).join(",")}`);
} catch (error) {
  await cleanup(page?.id, createdRecords);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// ---

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${method} ${path}\n${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function makeExtension(type, ccId) {
  const info = MACROS[type];
  const moduleKey = (info.module === "zenuml-sequence-macro" ? site.sequenceModule : info.module) + site.suffix;
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

async function verifyPage(pageId, nodes, contentIds) {
  const result = await api("GET", `/rest/api/content/${pageId}?expand=body.atlas_doc_format`);
  const raw = result.body?.atlas_doc_format?.value;
  if (!raw) throw new Error(`Verification failed: page ${pageId} has no atlas_doc_format body`);
  const adf = typeof raw === "string" ? JSON.parse(raw) : raw;
  const actual = (adf.content || []).filter((node) => node.type === "extension");
  if (actual.length !== nodes.length) throw new Error(`Verification failed: expected ${nodes.length} extensions, found ${actual.length}`);
  for (let i = 0; i < nodes.length; i += 1) {
    const expectedId = String(contentIds[i].id);
    const actualId = String(actual[i].attrs?.parameters?.guestParams?.customContentId
      ?? actual[i].attrs?.parameters?.guestParams?.["custom-content-id"] ?? "");
    if (actualId !== expectedId) throw new Error(`Verification failed: extension ${i + 1} points to ${actualId || "no custom content"}, expected ${expectedId}`);
    if (actual[i].attrs?.extensionKey !== nodes[i].attrs?.extensionKey) throw new Error(`Verification failed: extension ${i + 1} key mismatch`);
    const cc = await api("GET", `/rest/api/content/${expectedId}?expand=body.raw`);
    if (cc.type !== contentIds[i].contentType) throw new Error(`Verification failed: custom content ${expectedId} type mismatch`);
    const body = cc.body?.raw?.value;
    if (!body) throw new Error(`Verification failed: custom content ${expectedId} has no raw body`);
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    if (parsed.diagramType !== contentIds[i].diagramType) throw new Error(`Verification failed: custom content ${expectedId} diagramType mismatch`);
  }
}

async function cleanup(pageId, records) {
  for (const { id } of records.slice().reverse()) {
    try { await api("DELETE", `/rest/api/content/${id}`); } catch { /* best effort */ }
  }
  if (pageId) {
    try { await api("DELETE", `/rest/api/content/${pageId}`); } catch { /* best effort */ }
  }
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
