#!/usr/bin/env node
// Audit all embed macros on a Confluence site and classify each one's
// custom-content body as "broken empty placeholder" or "has actual content".
//
// Triggered by the discovery that saveEmbedAndExit (src/forge-embed-editor.ts)
// POSTs `{diagramType:"embed",source:"custom-content"}` on every save and
// never persists the user's selected document id — so the viewer renders
// "Unknown diagram type: embed".
//
// Usage: node audit-embed-macros.mjs --site zenuml [--limit-pages 9999]

import { parseArgs } from "node:util";

const SITES = {
  zenuml: { host: "zenuml.atlassian.net" },
  "lite-stg": { host: "lite-stg.atlassian.net" },
  "lite-dev": { host: "lite-dev.atlassian.net" },
};

const { values: args } = parseArgs({
  options: {
    site: { type: "string", default: "zenuml" },
    "limit-pages": { type: "string", default: "9999" },
  },
});

const site = SITES[args.site];
if (!site) fail(`Unknown --site '${args.site}'. Choices: ${Object.keys(SITES).join(", ")}`);
const limitPages = Number(args["limit-pages"]);

const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) fail("Missing FORGE_EMAIL / FORGE_API_TOKEN");

const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
const base = `https://${site.host}/wiki`;

const MACRO_KEYS = ["zenuml-embed-macro", "zenuml-embed-macro-lite"];
const EMPTY_BODY = '{"diagramType":"embed","source":"custom-content"}';

const allEmbeds = []; // {pageId, pageTitle, ccId, source}
const pageCount = { total: 0, withEmbeds: 0 };

for (const key of MACRO_KEYS) {
  console.error(`\n=== macro=${key} ===`);
  let start = 0, fetched = 0;
  while (fetched < limitPages) {
    const limit = Math.min(50, limitPages - fetched);
    const r = await api(`/rest/api/search?cql=macro%3D%22${key}%22&limit=${limit}&start=${start}`);
    if (!r.results?.length) break;
    pageCount.total += r.results.length;

    // Fetch ADF per page (in parallel batches of 10)
    const ids = r.results.map(it => it.content.id);
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const adfs = await Promise.all(batch.map(id => api(`/api/v2/pages/${id}?body-format=atlas_doc_format`).catch(e => ({_err: String(e).slice(0,120)}))));
      for (let k = 0; k < batch.length; k++) {
        const adf = adfs[k];
        if (adf._err) { console.error(`  page ${batch[k]} ERR ${adf._err}`); continue; }
        const macros = extractEmbedMacros(adf, key);
        if (macros.length) pageCount.withEmbeds++;
        for (const m of macros) {
          allEmbeds.push({ pageId: batch[k], pageTitle: adf.title, ccId: m.ccId, macroKey: key, guestKeys: m.guestKeys });
        }
      }
    }

    fetched += r.results.length;
    start += r.results.length;
    if (r.results.length < limit) break;
    console.error(`  paginated: ${fetched} pages seen so far`);
  }
}

console.error(`\nEnumeration done. Pages scanned: ${pageCount.total}. Pages with embed macros: ${pageCount.withEmbeds}. Embed macro instances found: ${allEmbeds.length}.`);

// Dedup CC ids — multiple macros can point at the same CC
const ccIds = [...new Set(allEmbeds.map(e => e.ccId).filter(Boolean))];
console.error(`Unique customContent ids: ${ccIds.length}. Fetching bodies...`);

const ccVerdicts = new Map(); // ccId → {verdict, body, title}
for (let i = 0; i < ccIds.length; i += 10) {
  const batch = ccIds.slice(i, i + 10);
  const ccs = await Promise.all(batch.map(id => api(`/api/v2/custom-content/${id}?body-format=raw`).catch(e => ({_err: String(e).slice(0,120)}))));
  for (let k = 0; k < batch.length; k++) {
    const cc = ccs[k];
    if (cc._err) { ccVerdicts.set(batch[k], { verdict: "fetch_error", err: cc._err }); continue; }
    const raw = cc.body?.raw?.value || "";
    const verdict = classifyBody(raw);
    ccVerdicts.set(batch[k], { verdict, title: cc.title, pageId: cc.pageId, type: cc.type, len: raw.length });
  }
  if ((i + 10) % 100 === 0) console.error(`  fetched ${Math.min(i+10, ccIds.length)}/${ccIds.length}`);
}

// Roll up per-instance verdicts
const summary = { broken: 0, valid: 0, missing_cc_id: 0, fetch_error: 0, other: 0 };
const brokenPages = new Set();
const validPages = new Set();
for (const e of allEmbeds) {
  if (!e.ccId) { summary.missing_cc_id++; continue; }
  const v = ccVerdicts.get(e.ccId)?.verdict;
  if (v === "broken_placeholder") { summary.broken++; brokenPages.add(e.pageId); }
  else if (v === "valid_content") { summary.valid++; validPages.add(e.pageId); }
  else if (v === "fetch_error") summary.fetch_error++;
  else summary.other++;
}

console.log(JSON.stringify({
  site: args.site,
  embedMacroKeys: MACRO_KEYS,
  pagesScanned: pageCount.total,
  pagesWithEmbedMacros: pageCount.withEmbeds,
  embedInstancesFound: allEmbeds.length,
  uniqueCustomContentIds: ccIds.length,
  instanceVerdicts: summary,
  brokenPagesCount: brokenPages.size,
  validPagesCount: validPages.size,
}, null, 2));

// Sample 5 of each verdict for the user
const samplesBroken = allEmbeds.filter(e => ccVerdicts.get(e.ccId)?.verdict === "broken_placeholder").slice(0, 5);
const samplesValid  = allEmbeds.filter(e => ccVerdicts.get(e.ccId)?.verdict === "valid_content").slice(0, 5);
console.log("\nSample broken instances:");
console.log(JSON.stringify(samplesBroken.map(e => ({pageId:e.pageId, macroKey:e.macroKey, ccId:e.ccId, ccTitle: ccVerdicts.get(e.ccId)?.title})), null, 2));
console.log("\nSample valid instances:");
console.log(JSON.stringify(samplesValid.map(e => ({pageId:e.pageId, macroKey:e.macroKey, ccId:e.ccId, ccTitle: ccVerdicts.get(e.ccId)?.title, bodyLen: ccVerdicts.get(e.ccId)?.len})), null, 2));

// ---

function extractEmbedMacros(adf, key) {
  if (!adf?.body?.atlas_doc_format?.value) return [];
  let body;
  try { body = JSON.parse(adf.body.atlas_doc_format.value); } catch { return []; }
  const out = [];
  function walk(n) {
    if (!n) return;
    if ((n.type === "extension" || n.type === "bodiedExtension") && (n.attrs?.extensionKey || "").includes(key)) {
      const params = n.attrs?.parameters || {};
      const ccId = params.macroParams?.customContentId?.value || params.guestParams?.customContentId || params.guestParams?.["custom-content-id"] || null;
      out.push({ ccId, guestKeys: Object.keys(params.guestParams || {}) });
    }
    (n.content || []).forEach(walk);
  }
  walk(body);
  return out;
}

function classifyBody(raw) {
  if (!raw) return "empty_raw";
  if (raw === EMPTY_BODY) return "broken_placeholder";
  try {
    const o = JSON.parse(raw);
    const otherKeys = Object.keys(o).filter(k => k !== "diagramType" && k !== "source");
    if (otherKeys.length === 0) return "broken_placeholder"; // any variant with only those two
    return "valid_content";
  } catch {
    return "unparseable";
  }
}

async function api(path) {
  const res = await fetch(base + path, { headers: { Authorization: auth, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

function fail(msg) { console.error(msg); process.exit(1); }
