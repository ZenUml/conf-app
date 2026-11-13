#!/usr/bin/env node
// Scan Graph (DrawIO) macro content from the D1 CustomContent mirror.
// Read-only. See ../SKILL.md.
//
//   node scan.mjs --content-ids 111,222
//   node scan.mjs --macro-uuids <uuid>,<uuid>
//   node scan.mjs --file d1.json            # saved `wrangler d1 execute --json` output
//   options: --json (machine output)  --list-images out.json  --save-d1 out.json
//
// Always ends with process.exit(): lzutf8 leaves timers that keep node alive.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(name);

function fail(msg) {
  console.error(`scan: ${msg}`);
  process.exit(2);
}

function mainCheckout() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
    cwd: path.dirname(fileURLToPath(import.meta.url)),
  }).trim();
  return path.dirname(common);
}

function loadLzutf8(root) {
  try {
    return createRequire(path.join(root, 'package.json'))('lzutf8');
  } catch {
    const pnpm = path.join(root, 'node_modules', '.pnpm');
    const dir = fs.existsSync(pnpm) && fs.readdirSync(pnpm).find((d) => d.startsWith('lzutf8@'));
    if (!dir) fail(`lzutf8 not found under ${root}/node_modules; run pnpm install there`);
    return createRequire(path.join(pnpm, dir, 'node_modules', 'lzutf8', 'package.json'))('lzutf8');
  }
}

function readEnvKey(file, key) {
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
}

function queryD1(root, where) {
  const sql = `SELECT contentId, macroUuid, status, latestVersionNumber, body FROM CustomContent WHERE ${where}`;
  const env = { ...process.env };
  if (!env.CLOUDFLARE_ACCOUNT_ID) env.CLOUDFLARE_ACCOUNT_ID = readEnvKey(path.join(root, '.env'), 'CLOUDFLARE_ACCOUNT_ID');
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'conf-zenuml-prod', '--remote', '--env', 'production', '--json', '--command', sql],
    { cwd: root, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out;
}

function rowsFromD1Json(text) {
  const parsed = JSON.parse(text.slice(text.indexOf('[')));
  return parsed.flatMap((r) => r.results || []);
}

const unescapeXml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#xa;/g, '\n').replace(/&amp;/g, '&');

// DrawIO's own page compression: <diagram>base64(deflateRaw(encodeURIComponent(xml)))</diagram>
function expandDiagramPages(xml) {
  return xml.replace(/(<diagram\b[^>]*>)([\s\S]*?)(<\/diagram>)/g, (all, open, body, close) => {
    const t = body.trim();
    if (!t || t.startsWith('<')) return all;
    try {
      const raw = zlib.inflateRawSync(Buffer.from(t, 'base64')).toString('utf8');
      return open + decodeURIComponent(raw) + close;
    } catch {
      return all;
    }
  });
}

function classify(src) {
  if (src.startsWith('data:')) return 'data:';
  if (/^(https?:)?\/\/icons\.diagrams\.net\//.test(src)) return 'icons.diagrams.net';
  if (/(^|\/)img\/lib\//.test(src)) return 'img/lib';
  const m = src.match(/^(?:https?:)?\/\/([^/]+)/);
  if (m) return `external:${m[1]}`;
  return 'relative-other';
}

function scanRow(row, lz) {
  const out = { contentId: row.contentId, macroUuid: row.macroUuid, status: row.status, version: row.latestVersionNumber };
  let diagram;
  try {
    const wrapper = JSON.parse(row.body);
    diagram = JSON.parse(wrapper?.raw?.value ?? row.body); // D1 stores Confluence's {raw:{value}} wrapper
  } catch (e) {
    return { ...out, error: `body parse: ${e.message}` };
  }
  out.diagramType = diagram.diagramType;
  if (!diagram.graphXml && diagram.diagramType !== 'graph') return { ...out, skipped: `not a graph body (diagramType=${diagram.diagramType})` };
  let xml = String(diagram.graphXml || '');
  out.compressed = Boolean(diagram.compressed);
  if (diagram.compressed && !xml.startsWith('<')) {
    try {
      xml = lz.decompress(xml, { inputEncoding: 'Base64' });
    } catch (e) {
      return { ...out, error: `lzutf8: ${e.message}` };
    }
  }
  if (!xml) return { ...out, error: 'no graphXml' };
  xml = expandDiagramPages(xml);
  out.pages = (xml.match(/<diagram\b/g) || []).length || 1;
  out.cells = (xml.match(/<mxCell\b/g) || []).length;
  const styles = unescapeXml(xml);
  const images = (styles.match(/image=[^;"]+/g) || []).map((s) => s.slice(6)).filter((s) => s && s !== 'html=1');
  out.images = images.length;
  out.imagesBySource = {};
  const external = new Set();
  for (const src of images) {
    const k = classify(src);
    out.imagesBySource[k] = (out.imagesBySource[k] || 0) + 1;
    if (k !== 'data:') external.add(src);
  }
  out.externalImagePaths = [...external].sort();
  out.stencilFamilies = {};
  for (const m of styles.matchAll(/shape=mxgraph\.([a-z0-9_]+)/gi)) {
    out.stencilFamilies[m[1]] = (out.stencilFamilies[m[1]] || 0) + 1;
  }
  out.imgLibFamilies = {};
  for (const src of images) {
    const m = src.match(/img\/lib\/([^/]+)\//);
    if (m) out.imgLibFamilies[m[1]] = (out.imgLibFamilies[m[1]] || 0) + 1;
  }
  out.hasMath = /\bmath="1"/.test(xml);
  return out;
}

const root = mainCheckout();
let text;
if (arg('--file')) {
  text = fs.readFileSync(arg('--file'), 'utf8');
} else if (arg('--content-ids')) {
  const ids = arg('--content-ids').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.every((s) => /^\d+$/.test(s))) fail('--content-ids must be numeric');
  text = queryD1(root, `contentId IN (${ids.map((s) => `'${s}'`).join(',')})`);
} else if (arg('--macro-uuids')) {
  const ids = arg('--macro-uuids').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.every((s) => /^[0-9a-f-]{8,64}$/i.test(s))) fail('--macro-uuids must be UUIDs');
  text = queryD1(root, `macroUuid IN (${ids.map((s) => `'${s}'`).join(',')})`);
} else {
  fail('give --content-ids, --macro-uuids or --file');
}
if (arg('--save-d1')) fs.writeFileSync(arg('--save-d1'), text);

const lz = loadLzutf8(root);
const rows = rowsFromD1Json(text);
const results = rows.map((r) => scanRow(r, lz));

if (has('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`rows: ${rows.length}`);
  for (const r of results) {
    if (r.error || r.skipped) {
      console.log(`${r.contentId} macro=${r.macroUuid} ${r.error ? `ERROR ${r.error}` : `SKIPPED ${r.skipped}`}`);
      continue;
    }
    console.log(
      `${r.contentId} macro=${r.macroUuid} v${r.version} ${r.status} type=${r.diagramType} compressed=${r.compressed} ` +
        `pages=${r.pages} cells=${r.cells} images=${r.images} ${JSON.stringify(r.imagesBySource)} math=${r.hasMath}`,
    );
    if (Object.keys(r.stencilFamilies).length) console.log(`  stencils ${JSON.stringify(r.stencilFamilies)}`);
    if (Object.keys(r.imgLibFamilies).length) console.log(`  img/lib ${JSON.stringify(r.imgLibFamilies)}`);
  }
}
if (arg('--list-images')) {
  const all = {};
  for (const r of results) if (r.externalImagePaths) all[r.contentId] = r.externalImagePaths;
  fs.writeFileSync(arg('--list-images'), JSON.stringify(all, null, 2));
  console.error(`wrote ${arg('--list-images')}`);
}
process.exit(0);
