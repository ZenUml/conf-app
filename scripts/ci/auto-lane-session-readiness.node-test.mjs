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
