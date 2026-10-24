#!/usr/bin/env node
// List ZenUML macros on a Confluence page in render order, joined with their
// custom-content metadata. Two REST calls, no browser, no proxy filter, works
// against any tenant the user's Atlassian API token can read (including
// customer sites the user is a guest on).
//
// Usage:
//   node list.mjs --site <site> --page <pageId> [--json]
//
// --site accepts either a known short name (lite-dev, lite-stg, zenuml-stg,
// zenuml) or a raw hostname ('gip-onshore' → gip-onshore.atlassian.net,
// 'foo.atlassian.net' passed through).

import { parseArgs } from "node:util";

const KNOWN = {
  "lite-dev":   "lite-dev.atlassian.net",
  "lite-stg":   "lite-stg.atlassian.net",
  "zenuml-stg": "zenuml-stg.atlassian.net",
  "zenuml":     "zenuml.atlassian.net",
};

const { values: args } = parseArgs({
  options: {
    site: { type: "string" },
    page: { type: "string" },
    json: { type: "boolean" },
    "include-orphans": { type: "boolean" },
  },
});

if (!args.site || !args.page) fail("Usage: --site <site> --page <pageId> [--json] [--include-orphans]");

const host = KNOWN[args.site] || (args.site.includes(".") ? args.site : `${args.site}.atlassian.net`);
const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) fail("Missing FORGE_EMAIL / FORGE_API_TOKEN. See .env.forge.local or create one at https://id.atlassian.com/manage-profile/security/api-tokens");

const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
const base = `https://${host}/wiki`;

const [pageRes, ccRes] = await Promise.all([
  api(`/api/v2/pages/${args.page}?body-format=atlas_doc_format`),
  api(`/api/v2/pages/${args.page}/custom-content?limit=250`),
]);

const adf = JSON.parse(pageRes.body.atlas_doc_format.value);
const customContents = ccRes.results || [];
const ccById = new Map(customContents.map(c => [c.id, c]));

// Walk ADF and collect extension nodes in document order
const extensions = [];
walkExtensions(adf, extensions);

// Join: each rendered extension → matching custom content (if any)
const rendered = extensions.map((ext, i) => {
  const ccId = ext.attrs?.parameters?.guestParams?.["custom-content-id"]
            || ext.attrs?.parameters?.guestParams?.customContentId;
  const cc = ccId ? ccById.get(String(ccId)) : null;
  return {
    pos: i + 1,
    extensionKey: ext.attrs?.extensionKey || "",
    moduleKey: deriveModuleKey(ext.attrs?.extensionKey),
    localId: ext.attrs?.parameters?.localId || "",
    customContentId: ccId || null,
    title: cc?.title ?? null,
    contentType: cc?.type ?? null,
  };
});

const renderedIds = new Set(rendered.map(r => String(r.customContentId)).filter(Boolean));
const orphans = customContents
  .filter(c => !renderedIds.has(String(c.id)))
  .map(c => ({ id: c.id, type: c.type, title: c.title }));

if (args.json) {
  console.log(JSON.stringify({ host, page: args.page, rendered, orphans }, null, 2));
} else {
  console.log(`# Page ${args.page} on ${host}`);
  console.log(`# ${rendered.length} macro(s) in body, ${orphans.length} other custom content`);
  console.log();
  if (rendered.length === 0) {
    console.log("(no Forge macro extensions in page body)");
  } else {
    console.log("pos  module                       customContentId  title                                              localId");
    console.log("---  ---------------------------  ---------------  -------------------------------------------------  ------------------------------------");
    for (const r of rendered) {
      console.log(
        `${pad(String(r.pos), 3)}  ${pad(r.moduleKey, 27)}  ${pad(r.customContentId || "(none)", 15)}  ${pad(trunc(r.title ?? "(no cc)", 49), 49)}  ${r.localId}`
      );
    }
  }
  if (args["include-orphans"] && orphans.length > 0) {
    console.log();
    console.log("# Other custom content owned by this page (not in body):");
    console.log("id               type                                                              title");
    console.log("---------------  ----------------------------------------------------------------  -----");
    for (const o of orphans) {
      console.log(`${pad(o.id, 15)}  ${pad(o.type, 64)}  ${trunc(o.title || "", 60)}`);
    }
  }
}

// ---

function walkExtensions(node, out) {
  if (!node || typeof node !== "object") return;
  if (node.type === "extension" || node.type === "bodiedExtension" || node.type === "inlineExtension") {
    out.push(node);
  }
  if (Array.isArray(node.content)) for (const c of node.content) walkExtensions(c, out);
}

function deriveModuleKey(extensionKey) {
  // e.g. '8ad26115-.../26ad8f7e-.../static/zenuml-graph-macro-lite' → 'zenuml-graph-macro-lite'
  if (!extensionKey) return "";
  const idx = extensionKey.lastIndexOf("/");
  return idx >= 0 ? extensionKey.slice(idx + 1) : extensionKey;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function trunc(s, n) { s = String(s); return s.length <= n ? s : s.slice(0, n - 1) + "…"; }

async function api(path) {
  const res = await fetch(base + path, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) fail(`HTTP ${res.status} on GET ${path}\n${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function fail(msg) { console.error(msg); process.exit(1); }
