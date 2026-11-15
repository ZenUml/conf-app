import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LEVELS,
  classifyChange,
  meetsLevel,
  parsePnpmLockKeys,
  parseLockKey,
  parseSemver,
} from "./auto-lane-policy.mjs";

// Spec table for the auto-lane change policy: one test per row, named after the row.
const f = (path, additions = 1, deletions = 0) => ({ path, additions, deletions });
const dep = (section, name, from, to, file = "package.json") => ({ file, section, name, from, to });
const lock = (added = [], removed = []) => ({ added, removed });
const v = (name, version) => ({ name, version });
const expectRow = (input, level, lane) => {
  const out = classifyChange({ packageJsonChanges: [], lockChanges: lock(), ...input });
  assert.equal(out.lane, lane, JSON.stringify(out));
  assert.equal(out.level, level, JSON.stringify(out));
  assert.ok(Array.isArray(out.reasons) && out.reasons.length > 0, "reasons must be present");
  return out;
};
const depInput = (changes, lockChanges = lock(), extra = []) => ({
  files: [f("package.json"), f("pnpm-lock.yaml", 4, 4), ...extra],
  packageJsonChanges: changes,
  lockChanges,
});

test("none -> report-only empty", () => {
  expectRow({ files: [] }, "report-only", "empty");
});

test("README.md +3 -1 -> auto-merge docs-only", () => {
  expectRow({ files: [f("README.md", 3, 1)] }, "auto-merge", "docs-only");
});

test("docs/a.md +60 -> auto-pr docs-large", () => {
  expectRow({ files: [f("docs/a.md", 60)] }, "auto-pr", "docs-large");
});

test("docs boundary: 50 lines is docs-only, 51 is docs-large", () => {
  expectRow({ files: [f("docs/a.md", 30, 20)] }, "auto-merge", "docs-only");
  expectRow({ files: [f("docs/a.md", 30, 21)] }, "auto-pr", "docs-large");
});

test("docs/policies/git-workflow.md +1 -> report-only denied-path", () => {
  expectRow({ files: [f("docs/policies/git-workflow.md")] }, "report-only", "denied-path");
});

test("CLAUDE.md and functions/CLAUDE.md -> report-only denied-path (all listed)", () => {
  const out = expectRow({ files: [f("CLAUDE.md"), f("functions/CLAUDE.md")] }, "report-only", "denied-path");
  const text = out.reasons.join("\n");
  assert.match(text, /CLAUDE\.md/);
  assert.match(text, /functions\/CLAUDE\.md/);
});

test(".claude/skills/x/SKILL.md +1 -> report-only denied-path", () => {
  expectRow({ files: [f(".claude/skills/x/SKILL.md")] }, "report-only", "denied-path");
});

test("manifest.yml +1 with README.md +1 -> report-only denied-path", () => {
  const out = expectRow({ files: [f("manifest.yml"), f("README.md")] }, "report-only", "denied-path");
  assert.match(out.reasons.join("\n"), /manifest\.yml/);
  assert.doesNotMatch(out.reasons.join("\n"), /README/);
});

test(".github/workflows/pr-checks.yml +1 -> report-only denied-path", () => {
  expectRow({ files: [f(".github/workflows/pr-checks.yml")] }, "report-only", "denied-path");
});

test("scripts/ci/auto-lane-policy.mjs +1 -> report-only denied-path (cannot edit itself)", () => {
  expectRow({ files: [f("scripts/ci/auto-lane-policy.mjs")] }, "report-only", "denied-path");
  expectRow({ files: [f("scripts/ci/auto-lane-policy.node-test.mjs")] }, "report-only", "denied-path");
});

test("src/components/PaywallBanner.tsx +2 with a spec -> report-only denied-path", () => {
  expectRow(
    { files: [f("src/components/PaywallBanner.tsx", 2), f("src/components/PaywallBanner.spec.tsx", 3)] },
    "report-only",
    "denied-path",
  );
});

test("functions/oauth/token.ts +2 with a spec -> report-only denied-path", () => {
  expectRow(
    { files: [f("functions/oauth/token.ts", 2), f("functions/oauth/token.spec.ts", 3)] },
    "report-only",
    "denied-path",
  );
});

test("functions/db/migrations/0042_x.sql -> report-only denied-path", () => {
  expectRow({ files: [f("functions/db/migrations/0042_x.sql")] }, "report-only", "denied-path");
  expectRow({ files: [f("migrations/0001.sql")] }, "report-only", "denied-path");
});

test("other denied paths: wrangler toml, vendor, patches, npmrc, routes, private, case variants", () => {
  for (const p of [
    "wrangler.toml",
    "functions/wrangler-dev.toml",
    "scripts/forge-wizard.mjs",
    "private",
    "private/x.md",
    "vendor/asyncapi-studio/a.js",
    "patches/x.patch",
    ".npmrc",
    "pnpm-workspace.yaml",
    "public/_routes.json",
    "functions/_middleware.ts",
    "functions/utils/authenticate.ts",
    ".cursor/rules/a.md",
    "docs/policies/x.md",
    "Manifest.YML",
    ".GitHub/workflows/a.yml",
    "../escape/README.md",
  ]) {
    expectRow({ files: [f(p)] }, "report-only", "denied-path");
  }
});

test("pnpm-lock.yaml only; minimatch 3.1.2 -> 3.1.4 -> auto-merge lock-transitive", () => {
  expectRow(
    { files: [f("pnpm-lock.yaml", 4, 4)], lockChanges: lock([v("minimatch", "3.1.4")], [v("minimatch", "3.1.2")]) },
    "auto-merge",
    "lock-transitive",
  );
});

test("pnpm-lock.yaml only; adds brand-new evil-pkg@1.0.0 -> auto-pr lock-new-package", () => {
  const out = expectRow(
    { files: [f("pnpm-lock.yaml", 4)], lockChanges: lock([v("evil-pkg", "1.0.0")]) },
    "auto-pr",
    "lock-new-package",
  );
  assert.match(out.reasons.join("\n"), /evil-pkg/);
});

test("pnpm-lock.yaml only; minimatch 3.1.2 -> 9.0.7 (no shared major) -> auto-pr lock-major", () => {
  expectRow(
    { files: [f("pnpm-lock.yaml", 4, 4)], lockChanges: lock([v("minimatch", "9.0.7")], [v("minimatch", "3.1.2")]) },
    "auto-pr",
    "lock-major",
  );
});

test("pnpm-lock.yaml only; lockChanges empty -> auto-pr lock-unparsed", () => {
  expectRow({ files: [f("pnpm-lock.yaml", 4, 4)], lockChanges: lock() }, "auto-pr", "lock-unparsed");
  expectRow({ files: [f("bun.lockb", 0, 0)], lockChanges: undefined }, "auto-pr", "lock-unparsed");
});

test("package.json+lock; devDependencies vitest ^3.2.4 -> ^3.2.6 -> auto-merge deps-dev-minor", () => {
  expectRow(depInput([dep("devDependencies", "vitest", "^3.2.4", "^3.2.6")], lock([v("vitest", "3.2.6")], [v("vitest", "3.2.4")])), "auto-merge", "deps-dev-minor");
});

test("11 dev packages -> auto-pr deps-dev-bulk (10 is still auto-merge)", () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => dep("devDependencies", `p${i}`, "^1.0.0", "^1.0.1"));
  expectRow(depInput(mk(10)), "auto-merge", "deps-dev-minor");
  expectRow(depInput(mk(11)), "auto-pr", "deps-dev-bulk");
});

test("devDependencies vitest ^2.1.9 -> ^4.1.6 -> report-only deps-major", () => {
  expectRow(depInput([dep("devDependencies", "vitest", "^2.1.9", "^4.1.6")]), "report-only", "deps-major");
});

test("devDependencies foo ^0.3.1 -> ^0.4.0 -> report-only deps-major", () => {
  expectRow(depInput([dep("devDependencies", "foo", "^0.3.1", "^0.4.0")]), "report-only", "deps-major");
});

test("devDependencies foo ^0.3.1 -> ^0.3.2 -> auto-merge deps-dev-minor", () => {
  expectRow(depInput([dep("devDependencies", "foo", "^0.3.1", "^0.3.2")]), "auto-merge", "deps-dev-minor");
});

test("0.0.x any bump is major", () => {
  expectRow(depInput([dep("devDependencies", "foo", "0.0.1", "0.0.2")]), "report-only", "deps-major");
});

test("dependencies axios ^1.15.0 -> ^1.16.0 -> auto-pr deps-prod-minor", () => {
  expectRow(depInput([dep("dependencies", "axios", "^1.15.0", "^1.16.0")]), "auto-pr", "deps-prod-minor");
});

test("dependencies axios ^1.16.0 -> ^1.15.0 (downgrade) -> report-only deps-major", () => {
  expectRow(depInput([dep("dependencies", "axios", "^1.16.0", "^1.15.0")]), "report-only", "deps-major");
});

test("devDependencies bump + scripts.test changed -> report-only deps-manifest-other", () => {
  expectRow(
    depInput([dep("devDependencies", "vitest", "^3.2.4", "^3.2.6"), { file: "package.json", section: "other", name: "scripts" }]),
    "report-only",
    "deps-manifest-other",
  );
});

test("peerDependencies / optionalDependencies change -> report-only deps-manifest-other", () => {
  expectRow(depInput([dep("peerDependencies", "react", "^18.0.0", "^18.1.0")]), "report-only", "deps-manifest-other");
  expectRow(depInput([dep("optionalDependencies", "fsevents", "^2.0.0", "^2.0.1")]), "report-only", "deps-manifest-other");
});

test("new devDependency added -> report-only deps-add-remove", () => {
  expectRow(depInput([dep("devDependencies", "newthing", null, "^1.0.0")]), "report-only", "deps-add-remove");
  expectRow(depInput([dep("devDependencies", "oldthing", "^1.0.0", null)]), "report-only", "deps-add-remove");
});

test("devDependencies foo github:x/y#abc -> report-only deps-nonstandard-range", () => {
  expectRow(depInput([dep("devDependencies", "foo", "^1.0.0", "github:x/y#abc")]), "report-only", "deps-nonstandard-range");
  for (const to of ["workspace:*", "npm:other@^1.0.0", "*", "latest", "next", ">=1.0.0", "1.x"]) {
    expectRow(depInput([dep("devDependencies", "foo", "^1.0.0", to)]), "report-only", "deps-nonstandard-range");
  }
});

test("devDependencies foo ^1.0.0 -> ^1.1.0-beta.1 -> report-only deps-nonstandard-range", () => {
  expectRow(depInput([dep("devDependencies", "foo", "^1.0.0", "^1.1.0-beta.1")]), "report-only", "deps-nonstandard-range");
});

test("dev bump + lock adds unrelated new name sneaky@2.0.0 -> auto-pr deps-new-transitive", () => {
  const out = expectRow(
    depInput(
      [dep("devDependencies", "vitest", "^3.2.4", "^3.2.6")],
      lock([v("vitest", "3.2.6"), v("sneaky", "2.0.0")], [v("vitest", "3.2.4")]),
    ),
    "auto-pr",
    "deps-new-transitive",
  );
  assert.match(out.reasons.join("\n"), /sneaky/);
});

test("package names in packageJsonChanges are not counted as new transitive", () => {
  expectRow(
    depInput([dep("devDependencies", "vitest", "^3.2.4", "^3.2.6")], lock([v("vitest", "3.2.6")], [v("vitest", "3.2.4")])),
    "auto-merge",
    "deps-dev-minor",
  );
});

test("forge-console/package.json + package-lock.json dev patch -> auto-merge deps-dev-minor", () => {
  expectRow(
    {
      files: [f("forge-console/package.json"), f("forge-console/package-lock.json", 6, 6)],
      packageJsonChanges: [dep("devDependencies", "vite", "^5.4.1", "^5.4.2", "forge-console/package.json")],
      lockChanges: lock([v("vite", "5.4.2")], [v("vite", "5.4.1")]),
    },
    "auto-merge",
    "deps-dev-minor",
  );
});

test("package.json dev bump + src/a.ts +1 -> not a dependency lane; report-only unclassified", () => {
  expectRow(
    {
      files: [f("package.json"), f("src/a.ts")],
      packageJsonChanges: [dep("devDependencies", "vitest", "^3.2.4", "^3.2.6")],
    },
    "report-only",
    "unclassified",
  );
});

test("tests/e2e-tests/a.spec.ts +10 -2 -> auto-pr tests-only", () => {
  expectRow({ files: [f("tests/e2e-tests/a.spec.ts", 10, 2)] }, "auto-pr", "tests-only");
});

test("src/a.spec.ts +1 -20 -> report-only tests-shrink", () => {
  expectRow({ files: [f("src/a.spec.ts", 1, 20)] }, "report-only", "tests-shrink");
});

test("src/a.ts +10 -5 with src/a.spec.ts +12 -> auto-pr small-fix", () => {
  expectRow({ files: [f("src/a.ts", 10, 5), f("src/a.spec.ts", 12)] }, "auto-pr", "small-fix");
});

test("src/a.ts +10 -5, no test -> report-only unclassified", () => {
  expectRow({ files: [f("src/a.ts", 10, 5)] }, "report-only", "unclassified");
});

test("src/a.ts +50 with spec -> report-only unclassified", () => {
  expectRow({ files: [f("src/a.ts", 50), f("src/a.spec.ts", 5)] }, "report-only", "unclassified");
});

test("4 src files +2 each with spec -> report-only unclassified", () => {
  expectRow(
    { files: [f("src/a.ts", 2), f("src/b.ts", 2), f("src/c.ts", 2), f("src/d.ts", 2), f("src/a.spec.ts", 3)] },
    "report-only",
    "unclassified",
  );
});

test("small-fix needs a test with additions > 0", () => {
  expectRow({ files: [f("src/a.ts", 2), f("src/a.spec.ts", 0, 3)] }, "report-only", "unclassified");
});

test("some/new/thing.bin -> report-only unclassified", () => {
  expectRow({ files: [f("some/new/thing.bin")] }, "report-only", "unclassified");
});

test("malformed input fails closed", () => {
  const out = classifyChange({ files: "nope" });
  assert.equal(out.level, "report-only");
  const out2 = classifyChange(undefined);
  assert.equal(out2.level, "report-only");
});

test("level names order correctly for --require", () => {
  assert.deepEqual(LEVELS, ["report-only", "auto-pr", "auto-merge"]);
  assert.equal(meetsLevel("auto-merge", "auto-merge"), true);
  assert.equal(meetsLevel("auto-merge", "auto-pr"), true);
  assert.equal(meetsLevel("auto-pr", "auto-merge"), false);
  assert.equal(meetsLevel("report-only", "auto-pr"), false);
  assert.equal(meetsLevel("report-only", "report-only"), true);
  assert.throws(() => meetsLevel("bogus", "auto-pr"));
});

test("semver helper", () => {
  assert.deepEqual(parseSemver("^1.2.3"), { prefix: "^", major: 1, minor: 2, patch: 3, prerelease: null });
  assert.equal(parseSemver("~1.2.3").prefix, "~");
  assert.equal(parseSemver("1.2.3-beta.1").prerelease, "beta.1");
  assert.equal(parseSemver("1.2.3+build.5").patch, 3);
  assert.equal(parseSemver("1.2.3(react@18.2.0)").patch, 3);
  assert.equal(parseSemver(">=1.2.3"), null);
  assert.equal(parseSemver("latest"), null);
  assert.equal(parseSemver("workspace:*"), null);
});

// Excerpt copied from this repo's pnpm-lock.yaml (lockfile v9): importers entries sit at two-space
// indent too, so they must be ignored; packages/snapshots keys carry quotes, scopes and peer suffixes.
const LOCK_EXCERPT = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@asyncapi/react-component':
        specifier: 1.4.10
        version: 1.4.10(encoding@0.1.13)(react-dom@18.3.1(react@18.3.1))(react@18.3.1)

packages:

  '@adobe/css-tools@4.5.0':
    resolution: {integrity: sha512-6OzddxPio9UiWTCemp4N8cYLV2ZN1ncRnV1cVGtve7dhPOtRkleRyx32GQCYSwDYgaHU3USMm84tNsvKzRCa1Q==}

  minimatch@3.1.2:
    resolution: {integrity: sha512-abc}
    engines: {node: '*'}

snapshots:

  '@adobe/css-tools@4.5.0': {}

  '@asyncapi/avro-schema-parser@3.0.24(encoding@0.1.13)':
    dependencies:
      '@asyncapi/parser': 3.6.0(encoding@0.1.13)
    transitivePeerDependencies:
      - encoding
`;

test("lock key parser: scoped package, peer suffix, importers ignored", () => {
  const keys = [...parsePnpmLockKeys(LOCK_EXCERPT)].sort();
  assert.deepEqual(keys, [
    "@adobe/css-tools@4.5.0",
    "@asyncapi/avro-schema-parser@3.0.24",
    "minimatch@3.1.2",
  ]);
  assert.deepEqual(parseLockKey("'@adobe/css-tools@4.5.0'"), { name: "@adobe/css-tools", version: "4.5.0" });
  assert.deepEqual(parseLockKey("/react-dom@18.2.0(react@18.2.0)"), { name: "react-dom", version: "18.2.0" });
  assert.deepEqual(parseLockKey("/@babel/core/7.20.0"), { name: "@babel/core", version: "7.20.0" });
  assert.deepEqual(parseLockKey("/foo/1.2.3_react@18.0.0"), { name: "foo", version: "1.2.3" });
});

// ---- CLI end to end -------------------------------------------------------------------------
const CLI = new URL("./auto-lane-policy.mjs", import.meta.url).pathname;
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
const runCli = (cwd, ...args) => spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });

function makeRepo(change) {
  const dir = mkdtempSync(join(tmpdir(), "auto-lane-"));
  git(dir, "init", "-q");
  writeFileSync(join(dir, "README.md"), "hello\n");
  writeFileSync(join(dir, "manifest.yml"), "app: 1\n");
  mkdirSync(join(dir, "src"));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  const base = git(dir, "rev-parse", "HEAD").trim();
  change(dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "head");
  return { dir, base, head: git(dir, "rev-parse", "HEAD").trim() };
}

test("CLI: README change -> auto-merge; manifest.yml change -> report-only; --require exits 1", () => {
  const a = makeRepo((d) => writeFileSync(join(d, "README.md"), "hello\nworld\n"));
  const b = makeRepo((d) => writeFileSync(join(d, "manifest.yml"), "app: 2\n"));
  try {
    const ra = runCli(a.dir, "--base", a.base, "--head", a.head, "--json");
    assert.equal(ra.status, 0, ra.stderr);
    const ja = JSON.parse(ra.stdout);
    assert.equal(ja.level, "auto-merge");
    assert.equal(ja.lane, "docs-only");

    const rb = runCli(b.dir, "--base", b.base, "--head", b.head, "--json");
    assert.equal(rb.status, 0, rb.stderr);
    const jb = JSON.parse(rb.stdout);
    assert.equal(jb.level, "report-only");
    assert.equal(jb.lane, "denied-path");

    const req = runCli(b.dir, "--base", b.base, "--head", b.head, "--require", "auto-merge");
    assert.equal(req.status, 1);
    assert.match(req.stdout, /^report-only denied-path/);
    assert.equal(runCli(a.dir, "--base", a.base, "--head", a.head, "--require", "auto-merge").status, 0);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test("CLI: package.json dev bump + package-lock.json diff, and bad arguments exit 2", () => {
  const pkg = (ver) => JSON.stringify({ name: "x", devDependencies: { vitest: ver } }, null, 2) + "\n";
  const lockJson = (ver) =>
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/vitest": { version: ver } } }, null, 2) + "\n";
  const dir = mkdtempSync(join(tmpdir(), "auto-lane-"));
  try {
    git(dir, "init", "-q");
    writeFileSync(join(dir, "package.json"), pkg("^3.2.4"));
    writeFileSync(join(dir, "package-lock.json"), lockJson("3.2.4"));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    writeFileSync(join(dir, "package.json"), pkg("^3.2.6"));
    writeFileSync(join(dir, "package-lock.json"), lockJson("3.2.6"));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "head");
    const out = runCli(dir, "--base", "HEAD~1", "--head", "HEAD", "--json");
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).lane, "deps-dev-minor");

    assert.equal(runCli(dir, "--base", "HEAD~1").status, 2);
    assert.equal(runCli(dir, "--base", "nope", "--head", "HEAD").status, 2);
    assert.equal(runCli(dir, "--base", "HEAD~1", "--head", "HEAD", "--require", "bogus").status, 2);
    assert.equal(runCli(dir, "--frobnicate").status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
