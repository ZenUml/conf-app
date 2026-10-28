#!/usr/bin/env node
// Creates cross-page-copy reproductions for multiple macro types:
//   For each macro type (sequence, mermaid, graph, openapi), creates
//     Page A — owns the custom content
//     Page B — references the same custom content via macro params
//   When Page B's macro is edited & saved on a buggy build, the page's
//   macroParams.customContentId is NOT updated to the new (copied) id.
//
// Usage:
//   node create-icopy-repros-all-types.mjs --site lite-stg --space SD [--types sequence,mermaid,graph,openapi]
// Output: a small JSON summary of created pages per macro type.

import { parseArgs } from "node:util";

const SITES = {
  "lite-dev": { host: "lite-dev.atlassian.net", appId: "8ad26115-211f-4216-971b-0540f606303d", envId: "26ad8f7e-aa24-4afe-83a3-e8216f9e5220", envName: "DEVELOPMENT", suffix: "-lite", ns: "lite" },
  "lite-stg": { host: "lite-stg.atlassian.net", appId: "8ad26115-211f-4216-971b-0540f606303d", envId: "5ea0d957-4b7d-47e5-b8cc-7d5fb4fc2338", envName: "STAGING", suffix: "-lite", ns: "lite" },
};

const { values: args } = parseArgs({
  options: {
    site:   { type: "string", default: "lite-stg" },
    space:  { type: "string", default: "SD" },
    parent: { type: "string" },
    types:  { type: "string", default: "sequence,mermaid,graph,openapi" },
  },
});

const site = SITES[args.site];
if (!site) fail(`Unknown --site '${args.site}'. Choices: ${Object.keys(SITES).join(", ")}`);

const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) fail("Missing FORGE_EMAIL / FORGE_API_TOKEN env vars");

const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
const base = `https://${site.host}/wiki`;
const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

// All macro types currently share the customContent key `zenuml-content-sequence`
// (verified in src/model/ApWrapper2.ts:93-95). The body's `diagramType` field
// is what distinguishes them inside the editor.
const fullCcType = `ac:com.zenuml.confluence-addon-${site.ns}:zenuml-content-sequence`;

const MACRO_CONFIGS = {
  sequence: {
    moduleKey: `zenuml-sequence-macro${site.suffix}`,
    extensionTitle: "Diagram (Mermaid, PlantUML & ZenUML) Lite",
    body: () => ({ diagramType: "sequence", code: "A.method() {\n  B.call()\n}\n", title: `seq-icopy-${ts}` }),
  },
  mermaid: {
    moduleKey: `zenuml-sequence-macro${site.suffix}`,
    extensionTitle: "Diagram (Mermaid, PlantUML & ZenUML) Lite",
    body: () => ({
      diagramType: "mermaid",
      code: "",
      mermaidCode: "graph TD\n  A[icopy-source] --> B[edited?]\n",
      title: `mmd-icopy-${ts}`,
    }),
  },
  graph: {
    moduleKey: `zenuml-graph-macro${site.suffix}`,
    extensionTitle: "Graph (DrawIO) Lite",
    body: () => ({
      diagramType: "graph",
      graphXml: `<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="icopy-source" vertex="1" parent="1"><mxGeometry x="40" y="40" width="160" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`,
      title: `graph-icopy-${ts}`,
    }),
  },
  openapi: {
    moduleKey: `zenuml-openapi-macro${site.suffix}`,
    extensionTitle: "OpenAPI / Swagger Lite",
    body: () => ({
      diagramType: "openapi",
      code: `openapi: 3.0.0\ninfo:\n  title: icopy-source\n  version: 1.0.0\npaths: {}\n`,
      title: `oas-icopy-${ts}`,
    }),
  },
};

const types = args.types.split(",").map((s) => s.trim()).filter(Boolean);
const unknown = types.filter((t) => !MACRO_CONFIGS[t]);
if (unknown.length) fail(`Unknown macro types: ${unknown.join(", ")}. Choices: ${Object.keys(MACRO_CONFIGS).join(", ")}`);

const summary = {};

for (const type of types) {
  const cfg = MACRO_CONFIGS[type];
  console.error(`\n=== ${type} ===`);

  // 1. Page A — source page that owns the custom content
  const pageA = await api("POST", "/rest/api/content", {
    type: "page",
    title: `[repro] icopy source · ${type} · ${ts}`,
    space: { key: args.space },
    ...(args.parent ? { ancestors: [{ id: args.parent }] } : {}),
    body: { storage: { value: `<p>Source page — owns the ${type} customContent.</p>`, representation: "storage" } },
  });
  console.error(`Page A: ${pageA.id}`);

  // 2. Custom content with Page A as container
  const cc = await api("POST", "/rest/api/content", {
    type: fullCcType,
    title: cfg.body().title,
    container: { id: pageA.id, type: "page" },
    space: { key: args.space },
    body: { raw: { value: JSON.stringify(cfg.body()), representation: "raw" } },
  });
  console.error(`Custom content: ${cc.id} (container = page A ${pageA.id})`);

  // 3. Update Page A's body with the macro pointing at the custom content
  await api("PUT", `/rest/api/content/${pageA.id}`, {
    type: "page",
    title: `[repro] icopy source · ${type} · ${ts}`,
    version: { number: 2 },
    body: { atlas_doc_format: { value: JSON.stringify(makeAdf(`source ${type} ${ts}`, cc.id, cfg)), representation: "atlas_doc_format" } },
  });

  // 4. Page B — the "copy" that references page A's custom content
  const pageB = await api("POST", "/rest/api/content", {
    type: "page",
    title: `[repro] icopy COPY · ${type} · ${ts}`,
    space: { key: args.space },
    ...(args.parent ? { ancestors: [{ id: args.parent }] } : {}),
    body: { storage: { value: `<p>Copy page — references ${type} customContent owned by page A. Edit & publish here to trigger the cross-page-copy save path.</p>`, representation: "storage" } },
  });
  console.error(`Page B: ${pageB.id}`);

  // 5. Update Page B's body with the SAME custom content id (cross-page → isCopy=true)
  await api("PUT", `/rest/api/content/${pageB.id}`, {
    type: "page",
    title: `[repro] icopy COPY · ${type} · ${ts}`,
    version: { number: 2 },
    body: { atlas_doc_format: { value: JSON.stringify(makeAdf(`copy ${type} ${ts}`, cc.id, cfg)), representation: "atlas_doc_format" } },
  });

  summary[type] = {
    pageA: { id: pageA.id, url: base + pageA._links.webui },
    pageB: { id: pageB.id, url: base + pageB._links.webui, editUrl: `${base}/spaces/${args.space}/pages/edit-v2/${pageB.id}` },
    customContent: { id: cc.id, type: fullCcType, ownedByPageId: pageA.id },
  };
  console.error(`✓ ${type} cross-page-copy repro ready: ${summary[type].pageB.editUrl}`);
}

console.log(JSON.stringify(summary, null, 2));

// ---

function makeAdf(title, ccId, cfg) {
  const key = `${site.appId}/${site.envId ?? ""}/static/${cfg.moduleKey}`;
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
            extensionTitle: cfg.extensionTitle,
            layout: "extension",
            "forge-environment": site.envName,
            guestParams: { "custom-content-id": ccId },
          },
          text: cfg.extensionTitle,
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
