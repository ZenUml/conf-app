// Session-side merge readiness for one PR: the decision behind .claude/skills/auto-lane/scripts/classify-pr.sh.
// Pure and import-free, so the skill script can load it from `origin/main` into a temporary file.
//   node auto-lane-session-readiness.mjs <classification> <meta> <checks> <runs> <head> <files>
// Arguments are JSON, except <head> (a SHA) and <files> (newline-separated paths).
// Exit: 0 = preconditions met and no file needs the destructive reading, 1 = a blocker or such a file.

// The same list as REQUIRED_CHECKS in auto-lane-merge.mjs; the test keeps the two equal.
export const REQUIRED_CHECKS = ["Build and Unit Test", "E2E validation", "Pipeline outcome"];

const NEEDS_DESTRUCTIVE_READING = [/(^|\/)migrations\//, /(^|\/)manifest\.ya?ml$/, /^\.github\/workflows\/.*(release|deploy)/i, /^wrangler.*\.toml$/];

// checks: `gh pr checks --json name,bucket`. runs: `gh run list --commit <head> --json workflowName,status`.
export function sessionReadiness({ classification, meta, checks, runs, head, files }) {
  const readDiffFor = files.filter((f) => NEEDS_DESTRUCTIVE_READING.some((re) => re.test(f)));
  const bad = checks.filter((c) => !["pass", "skipping"].includes(c.bucket)).map((c) => `${c.name}:${c.bucket}`);
  const blockers = [];
  if (meta.state !== "OPEN") blockers.push(`state:${meta.state}`);
  if (meta.isDraft) blockers.push("draft");
  if (meta.baseRefName !== "main") blockers.push(`base:${meta.baseRefName}`);
  if (meta.mergeable !== "MERGEABLE") blockers.push(`mergeable:${meta.mergeable}`);
  if (meta.reviewDecision === "CHANGES_REQUESTED") blockers.push("changes-requested");
  if (meta.headRefOid !== head) blockers.push("head-moved");
  if (checks.length === 0) blockers.push("no-checks");
  if (bad.length) blockers.push(`checks:${bad.slice(0, 5).join(",")}`);
  // A run that waits for a concurrency group (the staging lock) has no jobs yet, so no check lists it.
  const waiting = [...new Set(runs.filter((r) => r.status !== "completed").map((r) => r.workflowName))];
  for (const name of waiting) blockers.push(`runs-pending:${name}`);
  // Green means the required checks passed on this head, not that nothing listed is red.
  for (const name of REQUIRED_CHECKS) {
    if (!checks.some((c) => c.name === name && c.bucket === "pass")) blockers.push(`required-check:${name}`);
  }
  return {
    jobLevel: classification?.level,
    lane: classification?.lane,
    head,
    files: files.length,
    preconditionsMet: blockers.length === 0,
    blockers,
    readDiffFor,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [classification, meta, checks, runs, head, files] = process.argv.slice(2);
  const result = sessionReadiness({
    classification: JSON.parse(classification),
    meta: JSON.parse(meta),
    checks: JSON.parse(checks),
    runs: JSON.parse(runs),
    head,
    files: files.split("\n").filter(Boolean),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.preconditionsMet && result.readDiffFor.length === 0 ? 0 : 1);
}
