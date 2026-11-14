import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, main, BOT_LOGIN, REQUIRED_CHECKS } from "./auto-lane-merge.mjs";
import { withFakeGh } from "./fake-gh.mjs";

const pr = (over = {}) => ({
  number: 100,
  isDraft: false,
  author: BOT_LOGIN,
  authorIsBot: true,
  headRepoFullName: "ZenUml/conf-app",
  baseRepoFullName: "ZenUml/conf-app",
  baseRef: "main",
  headSha: "a".repeat(40),
  mergeable: "MERGEABLE",
  labels: [],
  ...over,
});
const NOW = "2026-11-13T12:00:00Z";
const ok = (name) => ({ name, status: "completed", conclusion: "success", completed_at: "2026-11-13T01:00:00Z" });
const goodChecks = () => [...REQUIRED_CHECKS.map(ok), ok("Unit tests (1/4)")];
const input = (over = {}) => ({
  enabled: "true",
  pr: pr(),
  classification: { level: "auto-merge", lane: "deps-dev-minor" },
  checks: goodChecks(),
  mergedToday: 0,
  now: NOW,
  ...over,
});

test("the happy path merges", () => {
  assert.deepEqual(decide(input()), { action: "merge", reason: "all-conditions-met" });
});

test("the bot identity is exactly what gh prints", () => {
  assert.equal(BOT_LOGIN, "app/dependabot");
});

// One row per skip rule, in specification order.
const rows = [
  ["disabled (undefined)", { enabled: undefined }, "disabled"],
  ["disabled ('True')", { enabled: "True" }, "disabled"],
  ["disabled (' true')", { enabled: " true" }, "disabled"],
  ["disabled ('false')", { enabled: "false" }, "disabled"],
  ["disabled (boolean true is not the string)", { enabled: true }, "disabled"],
  ["daily cap 2", { mergedToday: 2 }, "daily-cap"],
  ["daily cap above 2", { mergedToday: 5 }, "daily-cap"],
  ["draft", { pr: pr({ isDraft: true }) }, "draft"],
  ["author dependabot[bot]", { pr: pr({ author: "dependabot[bot]" }) }, "author"],
  ["author dependabot", { pr: pr({ author: "dependabot" }) }, "author"],
  ["author human", { pr: pr({ author: "MrCoder" }) }, "author"],
  ["author bot flag false", { pr: pr({ authorIsBot: false }) }, "author"],
  ["fork", { pr: pr({ headRepoFullName: "evil/conf-app" }) }, "fork"],
  ["missing head repo", { pr: pr({ headRepoFullName: undefined }) }, "fork"],
  ["base not main", { pr: pr({ baseRef: "release" }) }, "base"],
  ["hold label", { pr: pr({ labels: ["dependencies", "auto-lane:hold"] }) }, "hold"],
  ["not mergeable CONFLICTING", { pr: pr({ mergeable: "CONFLICTING" }) }, "not-mergeable"],
  ["mergeable UNKNOWN", { pr: pr({ mergeable: "UNKNOWN" }) }, "mergeable-unknown"],
  ["classifier failed", { classification: null }, "policy:error"],
  ["lane auto-pr", { classification: { level: "auto-pr", lane: "deps-prod-minor" } }, "policy:deps-prod-minor"],
  ["lane report-only", { classification: { level: "report-only", lane: "deps-major" } }, "policy:deps-major"],
  ["no checks", { checks: [] }, "no-checks"],
  ["check pending", { checks: [...goodChecks(), { name: "Slow", status: "in_progress", conclusion: null }] }, "checks-pending"],
  ["check queued", { checks: [...goodChecks(), { name: "Slow", status: "queued", conclusion: null }] }, "checks-pending"],
  ["check failed", { checks: [...goodChecks(), { name: "Lint", status: "completed", conclusion: "failure" }] }, "checks-failed:Lint"],
  ["check timed out", { checks: [...goodChecks(), { name: "Lint", status: "completed", conclusion: "timed_out" }] }, "checks-failed:Lint"],
  ["check action_required", { checks: [...goodChecks(), { name: "Lint", status: "completed", conclusion: "action_required" }] }, "checks-failed:Lint"],
  ["check conclusion missing", { checks: [...goodChecks(), { name: "Lint", status: "completed" }] }, "checks-failed:Lint"],
  ["required check missing", { checks: goodChecks().filter((c) => c.name !== "E2E validation") }, "required-check:E2E validation"],
  [
    "required check skipped",
    { checks: goodChecks().map((c) => (c.name === "Pipeline outcome" ? { ...c, conclusion: "skipped" } : c)) },
    "required-check:Pipeline outcome",
  ],
  [
    "required check neutral",
    { checks: goodChecks().map((c) => (c.name === "Build and Unit Test" ? { ...c, conclusion: "neutral" } : c)) },
    "required-check:Build and Unit Test",
  ],
];
for (const [name, over, reason] of rows) {
  test(`skip: ${name}`, () => assert.deepEqual(decide(input(over)), { action: "skip", reason }));
}

test("stale checks: a required check older than 7 days does not count", () => {
  const old = goodChecks().map((c) => (c.name === "E2E validation" ? { ...c, completed_at: "2026-10-28T15:44:16Z" } : c));
  assert.deepEqual(decide(input({ checks: old })), { action: "skip", reason: "checks-stale:E2E validation" });
  const edge = goodChecks().map((c) => ({ ...c, completed_at: "2026-11-06T12:00:00Z" }));
  assert.equal(decide(input({ checks: edge })).action, "merge");
  const noDate = goodChecks().map(({ completed_at, ...c }) => c);
  assert.equal(decide(input({ checks: noDate })).reason, "checks-stale:Build and Unit Test");
  assert.equal(decide(input({ now: undefined })).reason, "checks-stale:Build and Unit Test");
});

test("optional checks may be skipped or neutral", () => {
  const checks = [...goodChecks(), { name: "A", status: "completed", conclusion: "skipped" }, { name: "B", status: "completed", conclusion: "neutral" }];
  assert.equal(decide(input({ checks })).action, "merge");
});

test("rule order: disabled beats everything, cap beats draft, mergeable beats policy, policy beats checks", () => {
  const bad = input({ enabled: "no", mergedToday: 9, pr: pr({ isDraft: true }), classification: null, checks: [] });
  assert.equal(decide(bad).reason, "disabled");
  assert.equal(decide({ ...bad, enabled: "true" }).reason, "daily-cap");
  assert.equal(decide({ ...bad, enabled: "true", mergedToday: 0 }).reason, "draft");
  assert.equal(decide({ ...bad, enabled: "true", mergedToday: 0, pr: pr({ mergeable: "CONFLICTING" }) }).reason, "not-mergeable");
  assert.equal(decide({ ...bad, enabled: "true", mergedToday: 0, pr: pr() }).reason, "policy:error");
  assert.equal(decide({ ...bad, enabled: "true", mergedToday: 0, pr: pr(), classification: { level: "auto-merge", lane: "x" } }).reason, "no-checks");
});

test("duplicate runs: cancelled then success of the same name is ok", () => {
  const checks = goodChecks().flatMap((c) =>
    c.name === "Build and Unit Test"
      ? [{ ...c, conclusion: "cancelled", id: 1, completed_at: "2026-11-13T01:00:00Z" }, { ...c, id: 2, completed_at: "2026-11-13T01:05:00Z" }]
      : [c],
  );
  assert.equal(decide(input({ checks })).action, "merge");
});

test("duplicate runs: the order in the list does not matter, the latest completion wins", () => {
  const checks = goodChecks().flatMap((c) =>
    c.name === "Build and Unit Test"
      ? [{ ...c, id: 2, completed_at: "2026-11-13T01:05:00Z" }, { ...c, conclusion: "cancelled", id: 1, completed_at: "2026-11-13T01:00:00Z" }]
      : [c],
  );
  assert.equal(decide(input({ checks })).action, "merge");
});

test("duplicate runs: success then a later failure of the same name fails", () => {
  const checks = [
    ...goodChecks(),
    { name: "Unit tests (1/4)", status: "completed", conclusion: "failure", id: 99, completed_at: "2099-01-01T00:00:00Z" },
  ].map((c, i) => ({ id: c.id ?? i + 1, completed_at: c.completed_at ?? "2026-11-13T01:00:00Z", ...c }));
  assert.deepEqual(decide(input({ checks })), { action: "skip", reason: "checks-failed:Unit tests (1/4)" });
});

test("duplicate runs: cancelled only is checks-failed", () => {
  const checks = [...goodChecks(), { name: "Lint", status: "completed", conclusion: "cancelled" }];
  assert.deepEqual(decide(input({ checks })), { action: "skip", reason: "checks-failed:Lint" });
});

test("duplicate runs: a required check that is only cancelled fails the checks, not just the required list", () => {
  const checks = goodChecks().map((c) => (c.name === "E2E validation" ? { ...c, conclusion: "cancelled" } : c));
  assert.deepEqual(decide(input({ checks })), { action: "skip", reason: "checks-failed:E2E validation" });
});

test("duplicate runs: a pending sibling blocks even if an older one succeeded", () => {
  const checks = [...goodChecks(), { name: "Unit tests (1/4)", status: "in_progress", conclusion: null }];
  assert.equal(decide(input({ checks })).reason, "checks-pending");
});

test("decide never throws on garbage and fails closed", () => {
  assert.equal(decide(undefined).action, "skip");
  assert.equal(decide({ enabled: "true" }).action, "skip");
  assert.equal(decide(input({ checks: "nope" })).action, "skip");
});

// ---------------------------------------------------------------------------------------------
// CLI layer
// ---------------------------------------------------------------------------------------------

const sink = () => {
  let text = "";
  return { write: (s) => (text += s), get text() { return text; } };
};

test("main: disabled prints one line and makes no gh or git call", async () => {
  await withFakeGh({}, async () => {
    const out = sink();
    const code = await main([], { AUTO_LANE_ENABLED: "false" }, out);
    assert.equal(code, 0);
    assert.equal(out.text, "auto lane disabled\n");
  });
  const out = sink();
  assert.equal(await main([], {}, out), 0);
  assert.equal(out.text, "auto lane disabled\n");
});

const listRow = (over = {}) => ({
  number: 100,
  isDraft: false,
  author: { is_bot: true, login: "app/dependabot" },
  headRefOid: "a".repeat(40),
  baseRefName: "main",
  mergeable: "MERGEABLE",
  labels: [{ name: "dependencies" }],
  isCrossRepository: false,
  headRepository: { name: "conf-app" },
  headRepositoryOwner: { login: "ZenUml" },
  ...over,
});

function fakeDeps({ rows = [listRow()], merged = [], checks = goodChecks(), level = "auto-merge", fetchSha = "a".repeat(40) } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(["gh", ...args]);
    const line = args.join(" ");
    if (line.startsWith("repo view")) return "ZenUml/conf-app\n";
    if (line.startsWith("pr list") && args.includes("merged")) return JSON.stringify(merged);
    if (line.startsWith("pr list")) return JSON.stringify(rows);
    if (line.includes("/check-runs")) return checks.map((c) => JSON.stringify(c)).join("\n");
    return "";
  };
  const git = (args) => {
    calls.push(["git", ...args]);
    if (args[0] === "rev-parse") return `${fetchSha}\n`;
    if (args[0] === "merge-base") return `${"b".repeat(40)}\n`;
    return "";
  };
  const classify = (base, head) => {
    calls.push(["classify", base, head]);
    return { level, lane: level === "auto-merge" ? "deps-dev-minor" : "deps-major", reasons: [] };
  };
  return { calls, deps: { gh, git, classify } };
}
const writes = (calls) =>
  calls.filter(
    (c) =>
      c[0] === "gh" &&
      (c.includes("merge") && c[1] === "pr" || (c[1] === "workflow" && c[2] === "run") || c.includes("POST") || c.includes("-X") || c.includes("--method")),
  );

test("main: merges once, labels first, merge commit pinned to the head SHA, then dispatches the pipeline", async () => {
  const { calls, deps } = fakeDeps({ rows: [listRow({ number: 100 }), listRow({ number: 101 })] });
  const out = sink();
  const code = await main([], { AUTO_LANE_ENABLED: "true" }, out, deps);
  assert.equal(code, 0);
  const w = calls.filter((c) => c[0] === "gh").map((c) => c.slice(1).join(" "));
  const label = w.findIndex((l) => l.includes("issues/100/labels") && l.includes("labels[]=auto-lane"));
  const merge = w.findIndex((l) => l === `pr merge 100 --repo ZenUml/conf-app --merge --match-head-commit ${"a".repeat(40)}`);
  const dispatch = w.findIndex((l) => l.startsWith("workflow run build-test-deploy.yml") && l.includes("--ref main"));
  assert.ok(label >= 0 && merge > label && dispatch > merge, w.join("\n"));
  assert.ok(!w.some((l) => l.includes("--squash") || l.includes("--auto")));
  assert.ok(!w.some((l) => l.includes("101")), "stops after one merge");
  assert.match(out.text, /^#100 merge all-conditions-met deps-dev-minor$/m);
});

test("main: classifier runs against the merge base and the exact head SHA", async () => {
  const { calls, deps } = fakeDeps();
  await main([], { AUTO_LANE_ENABLED: "true" }, sink(), deps);
  assert.deepEqual(calls.find((c) => c[0] === "classify"), ["classify", "b".repeat(40), "a".repeat(40)]);
  assert.ok(calls.some((c) => c[0] === "git" && c.slice(1).join(" ") === "fetch origin pull/100/head"));
  assert.ok(calls.some((c) => c[0] === "git" && c[1] === "merge-base" && c[2] === "origin/main"));
});

test("main: dry run bypasses the switch for reading, labels nothing, merges nothing, dispatches nothing", async () => {
  for (const [argv, env] of [[["--dry-run"], {}], [[], { AUTO_LANE_DRY_RUN: "true" }]]) {
    const { calls, deps } = fakeDeps();
    const out = sink();
    const code = await main(argv, env, out, deps);
    assert.equal(code, 0);
    assert.deepEqual(writes(calls), []);
    assert.match(out.text, /DRY RUN/);
    assert.match(out.text, /^#100 merge all-conditions-met deps-dev-minor$/m);
  }
});

test("main: dry run lists every PR but only the first qualifying one says merge", async () => {
  const { calls, deps } = fakeDeps({ rows: [listRow({ number: 100 }), listRow({ number: 101 })] });
  const out = sink();
  await main(["--dry-run"], {}, out, deps);
  assert.deepEqual(writes(calls), []);
  assert.match(out.text, /^#100 merge all-conditions-met /m);
  assert.match(out.text, /^#101 skip one-merge-per-run \(would qualify\) /m);
});

test("main: policy lane other than auto-merge is skipped and nothing is written", async () => {
  const { calls, deps } = fakeDeps({ level: "report-only" });
  const out = sink();
  assert.equal(await main([], { AUTO_LANE_ENABLED: "true" }, out, deps), 0);
  assert.deepEqual(writes(calls), []);
  assert.match(out.text, /^#100 skip policy:deps-major deps-major$/m);
});

test("main: a head that moved after listing is skipped", async () => {
  const { calls, deps } = fakeDeps({ fetchSha: "c".repeat(40) });
  const out = sink();
  await main([], { AUTO_LANE_ENABLED: "true" }, out, deps);
  assert.deepEqual(writes(calls), []);
  assert.match(out.text, /^#100 skip error:head-moved /m);
});

test("main: the daily cap counts merged auto-lane PRs", async () => {
  const { calls, deps } = fakeDeps({ merged: [{ number: 1 }, { number: 2 }] });
  const out = sink();
  await main([], { AUTO_LANE_ENABLED: "true" }, out, deps);
  assert.deepEqual(writes(calls), []);
  assert.match(out.text, /^#100 skip daily-cap /m);
});

test("main: an exception for one PR skips it and the loop continues", async () => {
  const { calls, deps } = fakeDeps({ rows: [listRow({ number: 7 }), listRow({ number: 8 })] });
  let n = 0;
  const git = deps.git;
  deps.git = (args) => {
    if (args[0] === "fetch" && args[2]?.startsWith("pull/") && ++n === 1) throw new Error("boom");
    return git(args);
  };
  const out = sink();
  assert.equal(await main([], { AUTO_LANE_ENABLED: "true" }, out, deps), 0);
  assert.match(out.text, /^#7 skip error:boom /m);
  assert.match(out.text, /^#8 merge /m);
  assert.ok(calls.some((c) => c.join(" ").startsWith("gh pr merge 8 ")));
});

test("main: an exception outside the loop exits 1", async () => {
  const { deps } = fakeDeps();
  deps.gh = () => {
    throw new Error("no network");
  };
  const out = sink();
  const err = sink();
  assert.equal(await main([], { AUTO_LANE_ENABLED: "true" }, out, deps, err), 1);
  assert.match(err.text, /no network/);
});

test("main: output never contains the token", async () => {
  const { deps } = fakeDeps();
  const out = sink();
  await main([], { AUTO_LANE_ENABLED: "true", GH_TOKEN: "ghp_SECRET123" }, out, deps);
  assert.ok(!out.text.includes("ghp_SECRET123"));
});

// GitHub computes mergeability lazily: the first read after `main` moves answers UNKNOWN (seen 2026-11-13 and
// 2026-11-14: every PR in the list read UNKNOWN, then MERGEABLE seconds later).
function withMergeableAnswers(answers) {
  const { calls, deps } = fakeDeps({ rows: [listRow({ mergeable: "UNKNOWN" })] });
  const sleeps = [];
  const gh = (args) => {
    if (args[0] === "pr" && args[1] === "view") {
      calls.push(["gh", ...args]);
      return JSON.stringify({ mergeable: answers.shift() ?? "UNKNOWN" });
    }
    return deps.gh(args);
  };
  return { calls, sleeps, deps: { ...deps, gh, sleep: (ms) => sleeps.push(ms) } };
}

test("main: UNKNOWN mergeability is asked again and merges once GitHub answers MERGEABLE", async () => {
  const { calls, sleeps, deps } = withMergeableAnswers(["UNKNOWN", "MERGEABLE"]);
  const out = sink();
  assert.equal(await main([], { AUTO_LANE_ENABLED: "true", GITHUB_REPOSITORY: "ZenUml/conf-app" }, out, deps), 0);
  assert.match(out.text, /#100 merge all-conditions-met/);
  assert.equal(calls.filter((c) => c[1] === "pr" && c[2] === "view").length, 2);
  assert.equal(sleeps.length, 2);
});

test("main: mergeability that stays UNKNOWN is skipped under its own reason after a bounded number of reads", async () => {
  const { calls, deps } = withMergeableAnswers([]);
  const out = sink();
  assert.equal(await main([], { AUTO_LANE_ENABLED: "true", GITHUB_REPOSITORY: "ZenUml/conf-app" }, out, deps), 0);
  assert.match(out.text, /#100 skip mergeable-unknown/);
  assert.equal(calls.filter((c) => c[1] === "pr" && c[2] === "view").length, 3);
  assert.equal(calls.some((c) => c[1] === "pr" && c[2] === "merge"), false);
});

test("main: a re-read that answers CONFLICTING is skipped as not-mergeable; MERGEABLE rows are never re-read", async () => {
  const { deps } = withMergeableAnswers(["CONFLICTING"]);
  const out = sink();
  await main([], { AUTO_LANE_ENABLED: "true", GITHUB_REPOSITORY: "ZenUml/conf-app" }, out, deps);
  assert.match(out.text, /#100 skip not-mergeable/);
  const plain = fakeDeps();
  await main([], { AUTO_LANE_ENABLED: "true", GITHUB_REPOSITORY: "ZenUml/conf-app" }, sink(), plain.deps);
  assert.equal(plain.calls.some((c) => c[1] === "pr" && c[2] === "view"), false);
});
