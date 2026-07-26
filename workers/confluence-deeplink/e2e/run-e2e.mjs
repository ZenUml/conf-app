#!/usr/bin/env node
// E2E for the deeplink Worker against the REAL workerd runtime (wrangler dev
// --local + miniflare KV). Covers what unit tests can't: module-shape
// acceptance (workerd rejects non-handler exports), header passthrough, and
// the wrangler binding wiring. No network, no cloud state, no AI — CI-safe.
//
//   pnpm --filter confluence-deeplink test:e2e
//
// Exit 0 = all assertions pass.

import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const dir = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // worker root
const PORT = Number(process.env.E2E_PORT || 8794);
const BASE = `http://127.0.0.1:${PORT}`;
const UUID = "bc8bb5b3-09d2-4932-b68c-9b56fab8e34a";
const FRESH = "e2eFreshToken1234567";
const STALE = "e2eStaleToken1234567";
// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// Isolated miniflare state so runs never see each other's keys.
const statePath = fs.mkdtempSync(path.join(os.tmpdir(), "deeplink-e2e-"));

const wrangler = (args, input) =>
  execFileSync("npx", ["wrangler", ...args], {
    cwd: dir,
    input,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });

function seed(key, value) {
  // --preview false: the binding declares both id and preview_id; local seeds
  // must land in the store `wrangler dev --local` reads (the non-preview one).
  // NOTE: --expiration-ttl is rejected in --local mode; physical-expiry
  // behavior is covered by the unit/contract suites instead.
  const args = ["kv", "key", "put", key, "--binding", "DEEPLINK_KV", "--local",
    "--preview", "false", "--persist-to", statePath];
  if (Buffer.isBuffer(value)) {
    const f = path.join(statePath, "seed.bin");
    fs.writeFileSync(f, value);
    wrangler([...args, "--path", f]);
  } else {
    wrangler([...args.slice(0, 4), value, ...args.slice(4)]);
  }
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// --- seed ---
const now = new Date().toISOString();
seed(`ticket:${FRESH}`,
  JSON.stringify({ v: 1, d: "example.atlassian.net", p: "123456", c: "425987", t: "E2E flow", m: now }));
seed(`img:${FRESH}`, PNG);
seed(`ticket:${STALE}`,
  JSON.stringify({ v: 1, d: "example.atlassian.net", p: "777", c: "888", m: "2026-01-01T00:00:00Z" }));

// --- start workerd ---
const dev = spawn("npx",
  ["wrangler", "dev", "--local", "--port", String(PORT), "--persist-to", statePath],
  { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));

try {
  const deadline = Date.now() + 60_000;
  while (!/Ready on/i.test(devLog)) {
    if (Date.now() > deadline) throw new Error(`wrangler dev never became ready:\n${devLog}`);
    if (dev.exitCode !== null) throw new Error(`wrangler dev exited early:\n${devLog}`);
    await sleep(500);
  }

  await check("fresh ticket → preview page with title, og:image, button", async () => {
    const res = await fetch(`${BASE}/d/${UUID}/425987?t=${FRESH}`);
    const html = await res.text();
    expect(res.status === 200, `status ${res.status}`);
    expect(html.includes("<h1>E2E flow</h1>"), "title missing");
    expect(html.includes(`/i/${FRESH}`), "og:image missing");
    expect(html.includes("viewpage.action?pageId=123456"), "button target missing");
    expect(res.headers.get("cache-control") === "no-store", "ticketed page must be no-store");
  });

  await check("image route serves the seeded PNG", async () => {
    const res = await fetch(`${BASE}/i/${FRESH}`);
    expect(res.status === 200, `status ${res.status}`);
    expect(res.headers.get("content-type") === "image/png", "content-type");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(PNG), "bytes differ from seed");
  });

  await check("stale ticket → expired page with permanent button", async () => {
    const html = await (await fetch(`${BASE}/d/${UUID}/888?t=${STALE}`)).text();
    expect(html.includes("This preview has expired"), "expired copy missing");
    expect(html.includes("viewpage.action?pageId=777"), "permanent button missing");
  });

  await check("token/path mismatch and bare path → instruction page", async () => {
    for (const p of [`/d/${UUID}/999?t=${FRESH}`, `/d/${UUID}/425987`]) {
      const html = await (await fetch(`${BASE}${p}`)).text();
      expect(html.includes("This link becomes a diagram in Confluence"), `not instruction: ${p}`);
    }
  });

  await check("unknown image → 404; root → 302; POST → 405", async () => {
    expect((await fetch(`${BASE}/i/unknownToken12345678`)).status === 404, "img 404");
    const root = await fetch(`${BASE}/`, { redirect: "manual" });
    expect(root.status === 302, "root 302");
    expect((await fetch(`${BASE}/d/x`, { method: "POST" })).status === 405, "405");
  });

  await check("noindex on every page variant", async () => {
    for (const p of [`/d/${UUID}/425987?t=${FRESH}`, `/d/${UUID}/425987`, `/nope`]) {
      const res = await fetch(`${BASE}${p}`);
      expect(res.headers.get("x-robots-tag") === "noindex", `noindex missing: ${p}`);
    }
  });
} finally {
  dev.kill("SIGTERM");
  fs.rmSync(statePath, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
