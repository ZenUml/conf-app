#!/usr/bin/env node
// Deterministic change-policy classifier for the "auto lane".
//
// Decides, from a diff alone, the highest autonomy level a change may get. No model is consulted:
// the same diff always yields the same answer, and every failure mode resolves to `report-only`.
//
//   node scripts/ci/auto-lane-policy.mjs --base <rev> --head <rev> [--json] [--require <level>]
//
// Levels, high to low autonomy: auto-merge, auto-pr, report-only.
// Exit codes: 0 ok; 1 classified level is lower than --require; 2 bad arguments or git failure.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

export const LEVELS = ["report-only", "auto-pr", "auto-merge"]; // ascending autonomy
const rank = (level) => {
  const i = LEVELS.indexOf(level);
  if (i < 0) throw new Error(`unknown level: ${level}`);
  return i;
};
export const meetsLevel = (actual, required) => rank(actual) >= rank(required);

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"]);
const MAX_DEV_PACKAGES = 10;
const MAX_DOC_LINES = 50;
const MAX_FIX_FILES = 3;
const MAX_FIX_LINES = 40;
const MAX_LISTED = 20;

// ---------------------------------------------------------------------------------------------
// Semver
// ---------------------------------------------------------------------------------------------

const SEMVER = /^([\^~]?)(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

// Plain semver with an optional ^ or ~ prefix; anything else is null. A peer suffix such as
// `1.2.3(react@18.2.0)` (pnpm lockfile) is stripped from the first `(`.
export function parseSemver(text) {
  if (typeof text !== "string") return null;
  const m = SEMVER.exec(text.split("(")[0].trim());
  if (!m) return null;
  return { prefix: m[1], major: +m[2], minor: +m[3], patch: +m[4], prerelease: m[5] ?? null };
}

const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

// Components that identify a "major line": 1.x -> major, 0.x -> minor too, 0.0.x -> patch too.
const majorKey = (s) => (s.major > 0 ? `${s.major}` : s.minor > 0 ? `0.${s.minor}` : `0.0.${s.patch}`);

// Direct bump classification: "downgrade" | "major" | "minor" (incl. patch and equal versions).
function bumpKind(from, to) {
  const c = cmp(to, from);
  if (c < 0) return "downgrade";
  if (c > 0 && majorKey(from) !== majorKey(to)) return "major";
  return "minor";
}

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

const base = (p) => p.slice(p.lastIndexOf("/") + 1);

// Case-insensitive on purpose: macOS checkouts are case-insensitive, so `Manifest.yml` is the same file.
function deniedBy(rawPath) {
  const norm = posix.normalize(rawPath.replace(/\\/g, "/"));
  if (norm.startsWith("../") || norm === ".." || norm.startsWith("/")) return "path escapes the repository";
  const p = norm.replace(/^\.\//, "").toLowerCase();
  const name = base(p);
  if (name === "manifest.yml") return "manifest.yml";
  if (/^wrangler.*\.toml$/.test(name)) return "wrangler config";
  if (p.includes("/migrations/") || p.startsWith("migrations/")) return "migrations";
  if (p === ".github" || p.startsWith(".github/")) return ".github";
  if (p.startsWith("scripts/ci/auto-lane-")) return "auto-lane policy files";
  if (p === "scripts/forge-wizard.mjs") return "forge-wizard";
  if (p === "private" || p.startsWith("private/")) return "private submodule";
  if (p.startsWith("vendor/")) return "vendor";
  if (p.startsWith("patches/")) return "patches";
  if (name === ".npmrc") return ".npmrc";
  if (name === "pnpm-workspace.yaml") return "pnpm-workspace.yaml";
  if (p === "public/_routes.json") return "public/_routes.json";
  if (p === "functions/_middleware.ts") return "functions middleware";
  if (p === "functions/utils/authenticate.ts") return "authentication";
  if (name === "claude.md") return "CLAUDE.md";
  if (p === ".claude" || p.startsWith(".claude/")) return ".claude";
  if (p === ".cursor" || p.startsWith(".cursor/")) return ".cursor";
  if (p.startsWith("docs/policies/")) return "docs/policies";
  if (/paywall|licen[cs]e|billing|oauth|auth/i.test(p)) return "paywall/licence/billing/auth path";
  return null;
}

const isDoc = (p) => /\.mdx?$/.test(p) || p.startsWith("docs/");
const TEST_RE = /\.(spec|test)\.[cm]?[jt]sx?$|\.node-test\.mjs$|__tests__\/|\.stories\.[jt]sx?$/;
const isTest = (p) => p.startsWith("tests/") || TEST_RE.test(p);
const isDepFile = (p) => base(p) === "package.json" || LOCKFILES.has(base(p));
const lines = (file) => file.additions + file.deletions;
const listed = (items) =>
  items.length > MAX_LISTED ? `${items.slice(0, MAX_LISTED).join(", ")} (+${items.length - MAX_LISTED} more)` : items.join(", ");

// ---------------------------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------------------------

const result = (lane, level, reasons) => ({ lane, level, reasons });

function validate(input) {
  if (!input || typeof input !== "object") throw new Error("input must be an object");
  const { files } = input;
  if (!Array.isArray(files)) throw new Error("files must be an array");
  for (const file of files) {
    if (!file || typeof file.path !== "string" || file.path === "") throw new Error("file entry needs a path");
    for (const k of ["additions", "deletions"]) {
      if (!Number.isFinite(file[k]) || file[k] < 0) throw new Error(`${file.path}: ${k} must be a number >= 0`);
    }
  }
  if (input.packageJsonChanges != null && !Array.isArray(input.packageJsonChanges)) {
    throw new Error("packageJsonChanges must be an array");
  }
}

function lockNames(lockChanges) {
  const added = lockChanges?.added ?? [];
  const removed = lockChanges?.removed ?? [];
  const removedNames = new Set(removed.map((e) => e.name));
  const addedNames = [...new Set(added.map((e) => e.name))].filter((n) => !removedNames.has(n));
  return { added, removed, addedNames };
}

function classifyDeps(files, pjc, lockChanges) {
  const { added, removed, addedNames } = lockNames(lockChanges);
  const manifestFiles = new Set(files.filter((f) => base(f.path) === "package.json").map((f) => f.path));
  const deps = pjc.filter((c) => c.section !== "other");
  const label = (c) => `${c.file ?? "package.json"}: ${c.section} ${c.name} ${c.from ?? "(none)"} -> ${c.to ?? "(none)"}`;

  const other = pjc.filter((c) => c.section === "other" || c.section === "peerDependencies" || c.section === "optionalDependencies");
  if (other.length) {
    return result("deps-manifest-other", "report-only", other.map((c) =>
      c.section === "other" ? `${c.file ?? "package.json"}: non-dependency key changed: ${c.name}` : label(c)));
  }
  for (const c of deps) if (!DEP_SECTIONS.includes(c.section)) {
    return result("deps-manifest-other", "report-only", [`unknown dependency section: ${label(c)}`]);
  }
  const addRemove = deps.filter((c) => c.from == null || c.to == null);
  if (addRemove.length) return result("deps-add-remove", "report-only", addRemove.map(label));

  const parsed = deps.map((c) => ({ c, from: parseSemver(c.from), to: parseSemver(c.to) }));
  const nonstandard = parsed.filter(({ from, to }) => !from || !to || to.prerelease !== null);
  if (nonstandard.length) {
    return result("deps-nonstandard-range", "report-only", nonstandard.map(({ c }) => label(c)));
  }
  // Same version, different prefix (e.g. ~ -> ^) widens the accepted range without a visible bump.
  const widened = parsed.filter(({ from, to }) => cmp(from, to) === 0 && from.prefix !== to.prefix);
  if (widened.length) {
    return result("deps-nonstandard-range", "report-only", widened.map(({ c }) => `range prefix change: ${label(c)}`));
  }
  const major = parsed.filter(({ from, to }) => bumpKind(from, to) !== "minor");
  if (major.length) {
    return result("deps-major", "report-only", major.map(({ c, from, to }) => `${bumpKind(from, to)}: ${label(c)}`));
  }

  // New names in the lockfile that no package.json entry accounts for are supply-chain surface.
  const direct = new Set(deps.map((c) => c.name));
  const sneaky = addedNames.filter((n) => !direct.has(n));
  const sneakyNote = sneaky.length ? [`new package(s) in lockfile: ${listed(sneaky)}`] : [];

  if (deps.some((c) => c.section === "dependencies")) {
    return result("deps-prod-minor", "auto-pr", [...deps.map(label), ...sneakyNote]);
  }
  if (deps.length > 0) {
    if (deps.length > MAX_DEV_PACKAGES) {
      return result("deps-dev-bulk", "auto-pr", [`${deps.length} devDependencies changed (max ${MAX_DEV_PACKAGES} for auto-merge)`, ...sneakyNote]);
    }
    if (sneaky.length) return result("deps-new-transitive", "auto-pr", [...sneakyNote, ...deps.map(label)]);
    return result("deps-dev-minor", "auto-merge", deps.map(label));
  }

  // Lockfile-only (no package.json dependency entry changed).
  if (addedNames.length) {
    return result("lock-new-package", "auto-pr", [`new package(s) in lockfile: ${listed(addedNames)}`]);
  }
  if (added.length === 0 && removed.length === 0) {
    return result("lock-unparsed", "auto-pr", [
      `no package changes extracted from ${listed([...files.map((f) => f.path)])}${manifestFiles.size ? " (package.json had no dependency change)" : ""}`,
    ]);
  }
  const unparseable = added.filter((e) => !parseSemver(e.version));
  if (unparseable.length) {
    return result("lock-nonstandard-version", "auto-pr", unparseable.map((e) => `${e.name}@${e.version}`));
  }
  const majorNames = [];
  for (const name of new Set(added.map((e) => e.name))) {
    const was = removed.filter((e) => e.name === name);
    if (!was.length) continue;
    const keys = new Set(was.map((e) => parseSemver(e.version)).filter(Boolean).map(majorKey));
    const adds = added.filter((e) => e.name === name);
    if (adds.every((e) => !keys.has(majorKey(parseSemver(e.version))))) majorNames.push(name);
  }
  if (majorNames.length) return result("lock-major", "auto-pr", [`major change of transitive package(s): ${listed(majorNames)}`]);
  return result("lock-transitive", "auto-merge", [`${added.length} added / ${removed.length} removed lockfile entries, no new names, no major changes`]);
}

export function classifyChange(input) {
  try {
    validate(input);
    const files = input.files;
    const pjc = input.packageJsonChanges ?? [];

    // 1. empty
    if (files.length === 0) return result("empty", "report-only", ["diff has no files"]);

    // 2. denied paths: list all of them
    const denied = files.map((f) => ({ path: f.path, why: deniedBy(f.path) })).filter((d) => d.why);
    if (denied.length) {
      return result("denied-path", "report-only", denied.map((d) => `${d.path} (${d.why})`));
    }

    // 3. dependency lanes
    if (files.every((f) => isDepFile(f.path))) return classifyDeps(files, pjc, input.lockChanges);

    // 4. docs-only (a binary file wearing a .md name never qualifies)
    if (files.every((f) => isDoc(f.path) && !f.binary)) {
      const total = files.reduce((n, f) => n + lines(f), 0);
      return total <= MAX_DOC_LINES
        ? result("docs-only", "auto-merge", [`${files.length} doc file(s), ${total} changed lines (max ${MAX_DOC_LINES})`])
        : result("docs-large", "auto-pr", [`${total} changed doc lines exceed ${MAX_DOC_LINES}`]);
    }

    // 5. tests-only
    if (files.every((f) => isTest(f.path))) {
      const add = files.reduce((n, f) => n + f.additions, 0);
      const del = files.reduce((n, f) => n + f.deletions, 0);
      return del > add
        ? result("tests-shrink", "report-only", [`tests lose lines: +${add} -${del}`])
        : result("tests-only", "auto-pr", [`${files.length} test file(s), +${add} -${del}; a human merges test-only changes`]);
    }

    // 6. small-fix
    const tests = files.filter((f) => isTest(f.path));
    const code = files.filter((f) => !isTest(f.path));
    const codeLines = code.reduce((n, f) => n + lines(f), 0);
    const inScope = code.every((f) => !f.binary && /^(src|functions|scripts)\//.test(f.path));
    if (inScope && code.length <= MAX_FIX_FILES && codeLines <= MAX_FIX_LINES && tests.some((f) => f.additions > 0)) {
      return result("small-fix", "auto-pr", [`${code.length} source file(s), ${codeLines} changed lines, with added tests`]);
    }

    // 7. unclassified
    return result("unclassified", "report-only", [`no rule matches: ${listed(files.map((f) => f.path))}`]);
  } catch (err) {
    return result("error", "report-only", [`classifier error (fail closed): ${err?.message ?? err}`]);
  }
}

// ---------------------------------------------------------------------------------------------
// Lockfile and manifest extraction
// ---------------------------------------------------------------------------------------------

// `'@scope/name@1.2.3(peer@1)'`, `name@1.2.3`, `/name@1.2.3`, `/@scope/name/1.2.3_peer@1` -> { name, version }
export function parseLockKey(raw) {
  let key = raw.trim().replace(/^['"]|['"]$/g, "");
  const old = /^\/((?:@[^/]+\/)?[^/@]+)\/(\d[^/]*)$/.exec(key); // pnpm v5: /name/version[_peers]
  if (old) return { name: old[1], version: old[2].split("_")[0].split("(")[0] };
  key = key.replace(/^\//, "").split("(")[0];
  const at = key.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

// Set of "name@version" keys from a pnpm-lock.yaml: two-space-indent keys inside the top-level
// `packages:` and `snapshots:` blocks. `importers:` and other blocks are ignored.
export function parsePnpmLockKeys(text) {
  const keys = new Set();
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inBlock = /^(packages|snapshots):\s*$/.test(line);
      continue;
    }
    if (!inBlock) continue;
    const m = /^ {2}('[^']+'|"[^"]+"|[^\s'"#][^:]*?):(?:\s.*)?$/.exec(line);
    if (!m) continue;
    const parsed = parseLockKey(m[1]);
    if (parsed) keys.add(`${parsed.name}@${parsed.version}`);
  }
  return keys;
}

export function parsePackageLockKeys(text) {
  const keys = new Set();
  const packages = JSON.parse(text).packages ?? {};
  for (const [path, meta] of Object.entries(packages)) {
    if (!path || typeof meta?.version !== "string") continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    keys.add(`${name}@${meta.version}`);
  }
  return keys;
}

const splitKey = (k) => ({ name: k.slice(0, k.lastIndexOf("@")), version: k.slice(k.lastIndexOf("@") + 1) });

export function diffKeySets(before, after) {
  return {
    added: [...after].filter((k) => !before.has(k)).sort().map(splitKey),
    removed: [...before].filter((k) => !after.has(k)).sort().map(splitKey),
  };
}

const stable = (value) =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);
const str = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));

// Dependency-entry diff of two package.json texts (null = file missing on that side).
export function diffPackageJson(file, beforeText, afterText) {
  if (beforeText == null || afterText == null) return [{ file, section: "other", name: "__file__" }];
  let before, after;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch {
    return [{ file, section: "other", name: "__unparseable__" }];
  }
  const out = [];
  for (const section of DEP_SECTIONS) {
    const a = before?.[section] ?? {};
    const b = after?.[section] ?? {};
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const from = str(a[name]);
      const to = str(b[name]);
      if (from !== to) out.push({ file, section, name, from, to });
    }
  }
  const others = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of others) {
    if (DEP_SECTIONS.includes(key)) continue;
    if (stable(before?.[key]) !== stable(after?.[key])) out.push({ file, section: "other", name: key });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Git input
// ---------------------------------------------------------------------------------------------

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

function showOrNull(rev, path) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${rev}:${path}`]);
  } catch {
    return null; // path does not exist at that revision (revisions are validated earlier)
  }
  return git(["show", `${rev}:${path}`]);
}

export function buildInputFromGit(baseRev, headRev) {
  for (const rev of [baseRev, headRev]) git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  // --no-renames: a rename shows as delete + add, so both the old and the new path are checked.
  const raw = git(["diff", "--numstat", "-z", "--no-renames", baseRev, headRev]);
  const files = [];
  for (const rec of raw.split("\0")) {
    if (!rec) continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(rec);
    if (!m) throw new Error(`unparseable numstat record: ${JSON.stringify(rec)}`);
    const binary = m[1] === "-" || m[2] === "-";
    files.push({ path: m[3], additions: binary ? 0 : +m[1], deletions: binary ? 0 : +m[2], ...(binary ? { binary: true } : {}) });
  }

  const packageJsonChanges = [];
  const lockChanges = { added: [], removed: [] };
  for (const { path } of files) {
    const name = base(path);
    if (name === "package.json") {
      packageJsonChanges.push(...diffPackageJson(path, showOrNull(baseRev, path), showOrNull(headRev, path)));
    } else if (name === "pnpm-lock.yaml" || name === "package-lock.json") {
      const parse = name === "pnpm-lock.yaml" ? parsePnpmLockKeys : parsePackageLockKeys;
      try {
        const a = showOrNull(baseRev, path);
        const b = showOrNull(headRev, path);
        const d = diffKeySets(a == null ? new Set() : parse(a), b == null ? new Set() : parse(b));
        lockChanges.added.push(...d.added);
        lockChanges.removed.push(...d.removed);
      } catch {
        // unparseable lockfile: contributes nothing, so the lane falls to lock-unparsed (auto-pr at most)
      }
    }
  }
  return { files, packageJsonChanges, lockChanges };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--base" || a === "--head" || a === "--require") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = value;
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.base || !opts.head) throw new Error("usage: auto-lane-policy.mjs --base <rev> --head <rev> [--json] [--require <level>]");
  if (opts.require !== undefined && !LEVELS.includes(opts.require)) {
    throw new Error(`--require must be one of ${LEVELS.join(", ")}`);
  }
  return opts;
}

export function main(argv, out = process.stdout, err = process.stderr) {
  let opts, verdict;
  try {
    opts = parseArgs(argv);
    verdict = classifyChange(buildInputFromGit(opts.base, opts.head));
  } catch (e) {
    err.write(`auto-lane-policy: ${e?.stderr?.toString().trim() || e?.message || e}\n`);
    return 2;
  }
  out.write(
    opts.json
      ? `${JSON.stringify(verdict, null, 2)}\n`
      : `${verdict.level} ${verdict.lane}\n${verdict.reasons.map((r) => `  - ${r}`).join("\n")}\n`,
  );
  return opts.require && !meetsLevel(verdict.level, opts.require) ? 1 : 0;
}

const isMain = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) process.exitCode = main(process.argv.slice(2));
