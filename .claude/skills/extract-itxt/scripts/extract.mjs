#!/usr/bin/env node
// Extract iTXt chunks from a PNG file.
//
// Handles three input forms:
//   1. A plain PNG file path  (most common after download-attachment)
//   2. A session tool-result file containing a base64-encoded PNG string
//   3. A raw base64 string passed via --b64
//
// Usage:
//   node extract.mjs <file.png>
//   node extract.mjs --tool-result <path-to-tool-result.txt>
//   node extract.mjs --b64 <base64-string>
//
// Output: one JSON object per iTXt chunk, printed to stdout.
// Exit 0 = at least one chunk found. Exit 1 = no PNG / no iTXt chunk.

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { parseArgs } from "node:util";

const { values: args, positionals } = parseArgs({
  options: {
    "tool-result": { type: "string" },
    b64:           { type: "string" },
    keyword:       { type: "string", default: "" }, // filter to a specific keyword
    json:          { type: "boolean", default: false }, // output raw JSON array
  },
  allowPositionals: true,
  strict: false,
});

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function loadBuffer() {
  if (args.b64) {
    return Buffer.from(args.b64.replace(/\s/g, ""), "base64");
  }

  if (args["tool-result"]) {
    const raw = readFileSync(args["tool-result"], "utf8");
    // Tool result files wrap the base64 string in JSON-like quotes
    const match = raw.match(/"([A-Za-z0-9+/=\n]{100,})"/);
    if (!match) fail("No base64 string found in tool-result file");
    return Buffer.from(match[1].replace(/\s/g, ""), "base64");
  }

  if (positionals.length > 0) {
    return readFileSync(positionals[0]);
  }

  fail("Usage: extract.mjs <file.png>  |  --tool-result <path>  |  --b64 <string>");
}

const buf = loadBuffer();

// Validate PNG signature
if (!buf.slice(0, 8).equals(PNG_SIG)) {
  fail("Not a valid PNG (wrong signature)");
}

const chunks = [];
let offset = 8;

while (offset < buf.length) {
  if (offset + 8 > buf.length) break;
  const length = buf.readUInt32BE(offset);
  const type = buf.slice(offset + 4, offset + 8).toString("ascii");
  const data = buf.slice(offset + 8, offset + 8 + length);

  if (type === "iTXt") {
    const chunk = parseITXt(data);
    if (!args.keyword || chunk.keyword === args.keyword) {
      chunks.push(chunk);
    }
  }

  offset += 4 + 4 + length + 4; // length field + type + data + CRC
  if (type === "IEND") break;
}

if (chunks.length === 0) {
  const filter = args.keyword ? ` with keyword "${args.keyword}"` : "";
  fail(`No iTXt chunks found${filter}`);
}

if (args.json) {
  console.log(JSON.stringify(chunks, null, 2));
} else {
  for (const c of chunks) {
    console.log(`keyword: ${c.keyword}`);
    console.log(`compressed: ${c.compressed}`);
    if (c.language) console.log(`language: ${c.language}`);
    console.log(`text: ${c.text}`);
    // If text is JSON, pretty-print its fields
    try {
      const parsed = JSON.parse(c.text);
      for (const [k, v] of Object.entries(parsed)) {
        const display = typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v;
        console.log(`  ${k}: ${display}`);
      }
    } catch {}
    console.log();
  }
}

// ──────────────────────────────────────────────────────────────────────────────

function parseITXt(data) {
  // iTXt layout (PNG spec §11.3.3.3):
  //   keyword        \0
  //   compressionFlag  (1 byte: 0=uncompressed, 1=compressed)
  //   compressionMethod(1 byte: 0=zlib deflate)
  //   languageTag    \0
  //   translatedKeyword \0
  //   text           (rest — zlib-compressed if compressionFlag=1)

  let pos = data.indexOf(0);
  if (pos < 0) fail("Malformed iTXt chunk: no null after keyword");
  const keyword = data.slice(0, pos).toString("utf8");
  pos++;

  const compFlag = data[pos++];
  const compMethod = data[pos++]; // 0 = zlib deflate; only defined value

  const langEnd = data.indexOf(0, pos);
  const language = data.slice(pos, langEnd).toString("ascii");
  pos = langEnd + 1;

  const transEnd = data.indexOf(0, pos);
  pos = transEnd + 1;

  const payload = data.slice(pos);
  let text;
  if (compFlag === 0) {
    text = payload.toString("utf8");
  } else if (compMethod === 0) {
    text = inflateSync(payload).toString("utf8");
  } else {
    fail(`Unknown iTXt compression method ${compMethod}`);
  }

  return { keyword, compressed: compFlag === 1, language: language || undefined, text };
}

function fail(msg) { console.error(msg); process.exit(1); }
