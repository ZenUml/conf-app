#!/usr/bin/env node
// Download a Confluence attachment to a local path.
//
// Strategy: open the download URL in the user's default browser (which has
// the live Atlassian session), then watch the Downloads folder for the new
// file and move it to --out. Works on any tenant the user can view in their
// browser, including customer sites — no API token required.
//
// Usage:
//   node download.mjs --site <site> --page <pageId> --filename <name> [--out <path>] [--timeout-sec <n>]
//
// --site accepts short names (lite-dev, lite-stg, zenuml-stg, zenuml) or any
// hostname. --out defaults to the current working directory.

import { existsSync, statSync, renameSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const KNOWN = {
  "lite-dev":   "lite-dev.atlassian.net",
  "lite-stg":   "lite-stg.atlassian.net",
  "zenuml-stg": "zenuml-stg.atlassian.net",
  "zenuml":     "zenuml.atlassian.net",
};

const { values: args } = parseArgs({
  options: {
    site:       { type: "string" },
    page:       { type: "string" },
    filename:   { type: "string" },
    out:        { type: "string" },
    "timeout-sec": { type: "string" },
  },
});

if (!args.site || !args.page || !args.filename) {
  fail("Usage: --site <site> --page <pageId> --filename <name> [--out <path>] [--timeout-sec 30]");
}

const host = KNOWN[args.site] || (args.site.includes(".") ? args.site : `${args.site}.atlassian.net`);
const url = `https://${host}/wiki/download/attachments/${args.page}/${encodeURIComponent(args.filename)}?version=1`;
const downloads = join(homedir(), "Downloads");
const targetDir = args.out ? (args.out.endsWith("/") ? args.out : args.out.includes(".") ? dirname(args.out) : args.out) : process.cwd();
const targetName = args.out && args.out.includes(".") ? basename(args.out) : args.filename;
const targetPath = resolve(targetDir, targetName);
const timeoutMs = Math.max(5, Number(args["timeout-sec"] || 30)) * 1000;

if (!existsSync(downloads)) fail(`Downloads folder not found at ${downloads}`);
mkdirSync(targetDir, { recursive: true });

// Snapshot files in Downloads before opening URL, so we can spot the new one.
const before = new Set(readdirSync(downloads));
const startMtime = Date.now();

console.error(`# opening ${url}`);
console.error(`# watching ${downloads} for ${args.filename} (timeout ${timeoutMs / 1000}s)`);

// macOS: `open`. Linux: `xdg-open`. Windows: `start`.
const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
const cmdArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();

// Poll for a new file matching args.filename (or any new file if not present).
const deadline = Date.now() + timeoutMs;
let found = null;
while (Date.now() < deadline) {
  await sleep(500);
  const after = readdirSync(downloads);
  // Prefer the exact filename if it appeared post-snapshot.
  const exact = after.find(f => f === args.filename && !before.has(f));
  const exactMtimeOk = exact && statSync(join(downloads, exact)).mtimeMs >= startMtime;
  if (exact && exactMtimeOk) { found = exact; break; }
  // Otherwise any new file appearing during the watch window
  const candidates = after.filter(f => !before.has(f) && !f.endsWith(".crdownload") && !f.endsWith(".download"))
    .map(f => ({ f, m: statSync(join(downloads, f)).mtimeMs }))
    .filter(x => x.m >= startMtime)
    .sort((a, b) => b.m - a.m);
  if (candidates.length === 1) { found = candidates[0].f; break; }
  if (candidates.length > 1) {
    // Multiple new files appeared — prefer one whose name matches args.filename loosely
    const match = candidates.find(c => c.f.toLowerCase().includes(args.filename.toLowerCase().split(".")[0]));
    if (match) { found = match.f; break; }
  }
}

if (!found) fail(`Timed out after ${timeoutMs / 1000}s. Did the download complete? Check ${downloads}.`);

const src = join(downloads, found);
renameSync(src, targetPath);
console.error(`# downloaded -> ${targetPath}`);
console.log(targetPath);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fail(msg) { console.error(msg); process.exit(1); }
