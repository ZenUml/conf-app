#!/usr/bin/env node
// Fetch a macro's stored body from any Confluence tenant the API token's
// account can read. For tenants where the token doesn't have access (most
// customer sites), use the browser snippet `fetch-source-snippet.js` instead.
//
// Usage:
//   node fetch.mjs --site <site> --id <customContentId> [--out <path>] [--field graphXml|code|spec]
//
// Default behaviour: writes the chosen field (auto-detected) to --out, or to
// stdout if --out is omitted. Always prints the parsed body's metadata (type,
// title, diagramType, length) to stderr.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const KNOWN = {
  "lite-dev":   "lite-dev.atlassian.net",
  "lite-stg":   "lite-stg.atlassian.net",
  "zenuml-stg": "zenuml-stg.atlassian.net",
  "zenuml":     "zenuml.atlassian.net",
};

const { values: args } = parseArgs({
  options: {
    site:  { type: "string" },
    id:    { type: "string" },
    out:   { type: "string" },
    field: { type: "string" },
    json:  { type: "boolean" },
  },
});

if (!args.site || !args.id) fail("Usage: --site <site> --id <customContentId> [--out <path>] [--field graphXml|code|spec] [--json]");

const host = KNOWN[args.site] || (args.site.includes(".") ? args.site : `${args.site}.atlassian.net`);
const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) fail("Missing FORGE_EMAIL / FORGE_API_TOKEN. See .env.forge.local.");

const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
const res = await fetch(`https://${host}/wiki/api/v2/custom-content/${args.id}?body-format=raw`, {
  headers: { Authorization: auth, Accept: "application/json" },
});
const text = await res.text();
if (!res.ok) fail(`HTTP ${res.status} on /custom-content/${args.id}\n${text.slice(0, 500)}`);
const j = JSON.parse(text);
const raw = j.body?.raw?.value;
const body = raw ? safeParse(raw) : null;

if (args.json) {
  // Emit the parsed body as JSON on stdout — useful for piping to jq.
  process.stdout.write(JSON.stringify({ type: j.type, title: j.title, body }, null, 2));
  process.exit(0);
}

// Pick which inner field to emit. Auto-detect based on diagramType when --field omitted.
const field = args.field || autoField(body);
if (!field) fail("Could not auto-detect body field; pass --field graphXml | code | spec | <other>");
const value = body?.[field];
if (typeof value !== "string") fail(`Field '${field}' missing or not a string on body. Keys: ${body ? Object.keys(body).join(", ") : "(none)"}`);

console.error(`# type=${(j.type || "").split(":").pop()} title=${JSON.stringify(j.title)} diagramType=${body?.diagramType} field=${field} bytes=${value.length}`);

if (args.out) {
  writeFileSync(args.out, value);
  console.error(`# wrote ${value.length} bytes -> ${args.out}`);
} else {
  process.stdout.write(value);
}

// ---

function autoField(body) {
  if (!body) return null;
  if (typeof body.graphXml === "string") return "graphXml"; // graph (DrawIO)
  if (typeof body.code === "string") return "code";         // sequence / mermaid / plantuml
  if (typeof body.spec === "string") return "spec";         // openapi
  return null;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function fail(msg) { console.error(msg); process.exit(1); }
