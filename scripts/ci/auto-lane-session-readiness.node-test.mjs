import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIRED_CHECKS as JOB_REQUIRED_CHECKS } from "./auto-lane-merge.mjs";
import { REQUIRED_CHECKS, sessionReadiness } from "./auto-lane-session-readiness.mjs";

const head = "a".repeat(40);
const green = [
  { name: "Build and Unit Test", bucket: "pass" },
  { name: "E2E validation", bucket: "pass" },
  { name: "Pipeline outcome", bucket: "pass" },
  { name: "Deploy: Lite", bucket: "skipping" },
];
const base = {
  classification: { level: "low", lane: "auto-merge" },
  meta: { state: "OPEN", isDraft: false, baseRefName: "main", mergeable: "MERGEABLE", reviewDecision: "", headRefOid: head },
  checks: green,
  runs: [{ workflowName: "PR validation", status: "completed" }, { workflowName: "PR checks", status: "completed" }],
  head,
  files: ["src/a.spec.ts"],
};
const blockers = (over) => sessionReadiness({ ...base, ...over }).blockers;

test("green PR with every required check passed has no blocker", () => {
  const result = sessionReadiness(base);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.preconditionsMet, true);
});

// 2026-11-15: a PR merged while `PR validation` was still waiting for the staging lock.
// A waiting run has no jobs yet, so `gh pr checks` does not list it and every listed check was green.
test("a workflow run still waiting on the head blocks, although no listed check is pending", () => {
  const checks = green.filter((c) => c.name === "Build and Unit Test");
  for (const status of ["pending", "queued", "waiting", "requested", "in_progress"]) {
    assert.deepEqual(
      blockers({ checks, runs: [{ workflowName: "PR validation", status }, { workflowName: "PR checks", status: "completed" }] })
        .filter((b) => b.startsWith("runs-pending")),
      ["runs-pending:PR validation"],
      status,
    );
  }
});

test("a required check that never ran blocks", () => {
  const checks = green.filter((c) => c.name !== "E2E validation");
  assert.deepEqual(blockers({ checks }), ["required-check:E2E validation"]);
});

test("a required check that was only skipped blocks", () => {
  const checks = green.map((c) => (c.name === "Pipeline outcome" ? { ...c, bucket: "skipping" } : c));
  assert.deepEqual(blockers({ checks }), ["required-check:Pipeline outcome"]);
});

test("a skipped duplicate beside a passed required check does not block", () => {
  assert.deepEqual(blockers({ checks: [...green, { name: "E2E validation", bucket: "skipping" }] }), []);
});

test("existing blockers are kept", () => {
  assert.deepEqual(blockers({ meta: { ...base.meta, isDraft: true } }), ["draft"]);
  assert.deepEqual(blockers({ meta: { ...base.meta, headRefOid: "b".repeat(40) } }), ["head-moved"]);
  assert.ok(blockers({ checks: [...green, { name: "Unit tests (1/4)", bucket: "fail" }] }).includes("checks:Unit tests (1/4):fail"));
  assert.ok(blockers({ checks: [] }).includes("no-checks"));
});

test("files on destructive-reading paths are listed", () => {
  const result = sessionReadiness({ ...base, files: ["manifest.yml", "functions/migrations/0001.sql", "src/a.ts"] });
  assert.deepEqual(result.readDiffFor, ["manifest.yml", "functions/migrations/0001.sql"]);
});

test("the session requires the same checks as the daily job", () => {
  assert.deepEqual(REQUIRED_CHECKS, JOB_REQUIRED_CHECKS);
});

// classify-pr.sh copies this module to a temporary file and runs it. On macOS that path goes through a
// symlink (/var -> /private/var); a guard that compares import.meta.url with argv[1] then never matches,
// and the script printed nothing and exited 0, which reads as "merge".
test("the CLI prints its result and exits 1 on a blocker when started through a symlinked path", async () => {
  const { execFileSync } = await import("node:child_process");
  const { copyFileSync, mkdtempSync, realpathSync, symlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const real = mkdtempSync(join(realpathSync(tmpdir()), "readiness-real-"));
  const link = `${real}-link`;
  symlinkSync(real, link);
  copyFileSync(new URL("./auto-lane-session-readiness.mjs", import.meta.url), join(real, "copy.mjs"));
  const args = [join(link, "copy.mjs"), JSON.stringify(base.classification), JSON.stringify({ ...base.meta, isDraft: true }),
    JSON.stringify(base.checks), JSON.stringify(base.runs), head, "src/a.ts"];
  let status = 0;
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, args, { encoding: "utf8" });
  } catch (error) {
    status = error.status;
    stdout = error.stdout;
  }
  assert.equal(status, 1);
  assert.deepEqual(JSON.parse(stdout).blockers, ["draft"]);
});
