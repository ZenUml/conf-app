import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";

// Guard: every workflow job that runs on a runner carries a literal, bounded `timeout-minutes`.
// GitHub's default is 360 minutes, so a missing cap lets a hung job burn six hours of runner time.
const WORKFLOWS_DIR = resolve(
  process.env.WORKFLOWS_DIR ??
    new URL("../../.github/workflows", import.meta.url).pathname,
);

const MAX_JOB_MINUTES = 60; // largest legitimate job cap today: staging-validation in build-test-deploy.yml
const MAX_CALL_MINUTES = 35; // largest `with: timeout-minutes` passed to a reusable workflow: staging-transaction.yml

// Jobs that may exceed MAX_JOB_MINUTES. Key: '<file>: <job>'. Empty: nothing legitimately does today.
const OVERRIDES = {};

// Jobs whose cap is an expression on purpose. The value comes from a workflow_call input, and every
// caller passes a literal that rule 3 bounds.
const EXPRESSION_ALLOWED = {
  "e2e-test.yml: test":
    "cap is the `timeout-minutes` workflow_call input (default 8); callers are checked by rule 3",
};

// Jobs that had NO cap on origin/main when this guard landed (found by running it). Each should get a
// cap; remove its entry in the same PR. A stale entry (the job now has a cap) fails the test, so the list only shrinks.
const UNCAPPED_TODAY = {};

const isPositiveInt = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

// Returns violation messages for one parsed workflow. `file` is the workflow file name.
export function checkWorkflow(file, doc, uncapped = UNCAPPED_TODAY) {
  const problems = [];
  for (const [job, def] of Object.entries(doc?.jobs ?? {})) {
    const id = `${file}: ${job}`;
    const cap = def["timeout-minutes"];
    if (def.uses !== undefined) {
      // Rule 1b: a reusable-workflow call must not set a job-level cap (GitHub rejects it).
      if (cap !== undefined)
        problems.push(
          `${id}: job-level timeout-minutes is not allowed on a uses: job (got ${JSON.stringify(cap)}); pass it through with: instead`,
        );
      // Rule 3: the value handed to the called workflow.
      const passed = def.with?.["timeout-minutes"];
      if (
        passed !== undefined &&
        !(isPositiveInt(passed) && passed <= MAX_CALL_MINUTES)
      ) {
        problems.push(
          `${id}: with.timeout-minutes must be an integer literal 1-${MAX_CALL_MINUTES} (got ${JSON.stringify(passed)})`,
        );
      }
      continue;
    }
    if (def["runs-on"] === undefined) continue;
    if (cap === undefined) {
      if (!(id in uncapped))
        problems.push(
          `${id}: missing timeout-minutes (GitHub default is 360); add one or an OVERRIDES entry`,
        );
      continue;
    }
    if (id in uncapped)
      problems.push(
        `${id}: now has timeout-minutes ${JSON.stringify(cap)}; remove it from UNCAPPED_TODAY`,
      );
    if (typeof cap === "string" && id in EXPRESSION_ALLOWED) continue;
    if (!isPositiveInt(cap)) {
      problems.push(
        `${id}: timeout-minutes must be an integer literal > 0 (got ${JSON.stringify(cap)})`,
      );
    } else if (cap > (OVERRIDES[id] ?? MAX_JOB_MINUTES)) {
      problems.push(
        `${id}: timeout-minutes ${cap} exceeds the ${OVERRIDES[id] ?? MAX_JOB_MINUTES}-minute cap`,
      );
    }
  }
  return problems;
}

const check = (yamlText, file = "x.yml", uncapped) =>
  checkWorkflow(file, yaml.load(yamlText), uncapped);

test("every workflow job has a bounded literal timeout-minutes", () => {
  const files = readdirSync(WORKFLOWS_DIR).filter((name) =>
    /\.ya?ml$/.test(name),
  );
  assert.ok(files.length > 0, `no workflow files in ${WORKFLOWS_DIR}`);
  const problems = files.flatMap((file) =>
    checkWorkflow(
      file,
      yaml.load(readFileSync(join(WORKFLOWS_DIR, file), "utf8")),
    ),
  );
  assert.deepEqual(problems, []);
});

test("self-check: a job with no timeout-minutes is reported by name", () => {
  assert.deepEqual(
    check("jobs:\n  build:\n    runs-on: ubuntu-latest\n", "ci.yml"),
    [
      "ci.yml: build: missing timeout-minutes (GitHub default is 360); add one or an OVERRIDES entry",
    ],
  );
});

test("self-check: a cap above 60 is reported with its value", () => {
  assert.deepEqual(
    check(
      "jobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 61\n",
      "ci.yml",
    ),
    ["ci.yml: build: timeout-minutes 61 exceeds the 60-minute cap"],
  );
  assert.deepEqual(
    check(
      "jobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 60\n",
    ),
    [],
  );
});

test("self-check: an expression or non-integer cap is rejected", () => {
  assert.match(
    check(
      "jobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: ${{ inputs.t }}\n",
      "ci.yml",
    )[0],
    /ci\.yml: build: .*integer literal.*"\$\{\{ inputs\.t \}\}"/,
  );
  assert.match(
    check(
      "jobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 1.5\n",
    )[0],
    /got 1\.5/,
  );
  assert.match(
    check(
      "jobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 0\n",
    )[0],
    /got 0/,
  );
});

test("self-check: a job-level cap on a uses: job is reported", () => {
  assert.deepEqual(
    check(
      "jobs:\n  call:\n    uses: ./.github/workflows/a.yml\n    timeout-minutes: 10\n",
      "ci.yml",
    ),
    [
      "ci.yml: call: job-level timeout-minutes is not allowed on a uses: job (got 10); pass it through with: instead",
    ],
  );
});

test("self-check: with.timeout-minutes on a uses: job must be an integer literal <= 35", () => {
  const call = (value) =>
    check(
      `jobs:\n  call:\n    uses: ./.github/workflows/a.yml\n    with:\n      timeout-minutes: ${value}\n`,
      "ci.yml",
    );
  assert.deepEqual(call(35), []);
  assert.deepEqual(call(36), [
    "ci.yml: call: with.timeout-minutes must be an integer literal 1-35 (got 36)",
  ]);
  assert.match(
    call("${{ inputs.t }}")[0],
    /ci\.yml: call: .*got "\$\{\{ inputs\.t \}\}"/,
  );
});

test("UNCAPPED_TODAY is empty: every runner job is capped", () => {
  assert.deepEqual(UNCAPPED_TODAY, {});
});

test("self-check: the UNCAPPED_TODAY ratchet allows a listed uncapped job and rejects a stale entry", () => {
  const listed = { "ci.yml: build": "no cap yet" };
  assert.deepEqual(
    check("jobs:\n  build:\n    runs-on: ubuntu-latest\n", "ci.yml", listed),
    [],
  );
  assert.deepEqual(
    check(
      "jobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n",
      "ci.yml",
      listed,
    ),
    [
      "ci.yml: build: now has timeout-minutes 10; remove it from UNCAPPED_TODAY",
    ],
  );
});
