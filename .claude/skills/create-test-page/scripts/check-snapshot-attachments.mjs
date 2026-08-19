// Assert that every macro on a page wrote its `zenuml-<ccId>.png` snapshot
// attachment — the artifact PDF/Word export reads. Pairs with
// create-test-page.mjs --filler for the below-the-fold repro (PR #516).
//
//   set -a; source .env.forge.local; set +a
//   node .claude/skills/create-test-page/scripts/check-snapshot-attachments.mjs \
//     --site lite-stg --page 222593195
//
// Prints one line per macro, in page order, plus an attached=<ok>/<total>
// summary. Exit code 1 when any macro is missing its snapshot.
import { parseArgs } from "node:util";

const SITES = {
  "lite-dev": "lite-dev.atlassian.net",
  "lite-stg": "lite-stg.atlassian.net",
  "zenuml-stg": "zenuml-stg.atlassian.net",
  "zenuml": "zenuml.atlassian.net",
};

const { values: args } = parseArgs({
  options: { site: { type: "string" }, page: { type: "string" } },
});
const host = SITES[args.site];
if (!host) { console.error(`--site must be one of: ${Object.keys(SITES).join(", ")}`); process.exit(2); }
if (!args.page) { console.error("--page <pageId> is required"); process.exit(2); }

const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) { console.error("Missing FORGE_EMAIL / FORGE_API_TOKEN"); process.exit(2); }

const base = `https://${host}/wiki`;
const headers = {
  Authorization: "Basic " + Buffer.from(`${email}:${token}`).toString("base64"),
  Accept: "application/json",
};

// Expected macros come from the page's own ADF, in document order, so an
// OK/MISS row maps to a macro's position on the page (position is exactly what
// the offscreen-capture bug depends on).
const page = await (await fetch(`${base}/rest/api/content/${args.page}?expand=body.atlas_doc_format`, { headers })).json();
const adf = JSON.parse(page.body.atlas_doc_format.value);
const expected = adf.content
  .filter((n) => n.type === "extension")
  .map((n) => ({
    id: String(n.attrs?.parameters?.guestParams?.["custom-content-id"] ?? ""),
    type: String(n.attrs?.extensionKey ?? "").split("/").pop()
      .replace(/^zenuml-/, "").replace(/-macro(-lite)?$/, ""),
  }));

const atts = await (await fetch(`${base}/rest/api/content/${args.page}/child/attachment?limit=200`, { headers })).json();
const names = new Set((atts.results || []).map((a) => a.title));

let ok = 0;
expected.forEach((m, i) => {
  const has = m.id && names.has(`zenuml-${m.id}.png`);
  if (has) ok += 1;
  console.log(`${i + 1}. ${m.type} cc=${m.id || "?"} ${has ? "OK" : "MISS"}`);
});
console.log(`attached=${ok}/${expected.length} page=${args.page} site=${args.site}`);
process.exit(ok === expected.length ? 0 : 1);
