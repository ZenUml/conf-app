#!/usr/bin/env bash
# Classify one PR with the auto-lane policy and print its merge readiness.
# Usage: classify-pr.sh <PR number>     (run from a checkout of ZenUml/conf-app; reads only)
# Exit: 0 = preconditions met and no file on a path that needs the destructive reading,
#       1 = a blocker or such a file (read the diff, then decide or ask), 2 = error.
set -euo pipefail
pr="${1:?usage: classify-pr.sh <PR number>}"
root="$(git rev-parse --show-toplevel)"
cd "$root"
ref="refs/auto-lane-skill/pr-$pr"
trap 'git update-ref -d "$ref" 2>/dev/null || true' EXIT
git fetch -q origin main "+pull/$pr/head:$ref" || { echo "error: fetch failed" >&2; exit 2; }
head="$(git rev-parse "$ref")"
base="$(git merge-base origin/main "$head")"
# The classifier always comes from origin/main, never from the PR's own tree.
policy="$(mktemp -t auto-lane-policy.XXXXXX).mjs"
git show origin/main:scripts/ci/auto-lane-policy.mjs > "$policy"
class="$(node "$policy" --base "$base" --head "$head" --json)" || { rc=$?; [ "$rc" -eq 2 ] && { echo "error: classifier failed" >&2; rm -f "$policy"; exit 2; }; }
rm -f "$policy"
files="$(git diff --no-renames --name-only "$base" "$head")"
meta="$(gh pr view "$pr" --json headRefOid,isDraft,mergeable,reviewDecision,baseRefName,state)"
checks="$(gh pr checks "$pr" --json name,bucket 2>/dev/null || echo '[]')"
node -e '
const [cls, meta, checks, head] = [JSON.parse(process.argv[1]), JSON.parse(process.argv[2]), JSON.parse(process.argv[3]), process.argv[4]];
const files = process.argv[5].split("\n").filter(Boolean);
const review = files.filter(f => /(^|\/)migrations\//.test(f) || /(^|\/)manifest\.ya?ml$/.test(f) || /^\.github\/workflows\/.*(release|deploy)/i.test(f) || /^wrangler.*\.toml$/.test(f));
const bad = checks.filter(c => !["pass", "skipping"].includes(c.bucket)).map(c => `${c.name}:${c.bucket}`);
const blockers = [];
if (meta.state !== "OPEN") blockers.push(`state:${meta.state}`);
if (meta.isDraft) blockers.push("draft");
if (meta.baseRefName !== "main") blockers.push(`base:${meta.baseRefName}`);
if (meta.mergeable !== "MERGEABLE") blockers.push(`mergeable:${meta.mergeable}`);
if (meta.reviewDecision === "CHANGES_REQUESTED") blockers.push("changes-requested");
if (meta.headRefOid !== head) blockers.push("head-moved");
if (checks.length === 0) blockers.push("no-checks");
if (bad.length) blockers.push(`checks:${bad.slice(0, 5).join(",")}`);
console.log(JSON.stringify({ jobLevel: cls.level, lane: cls.lane, head, files: files.length, preconditionsMet: blockers.length === 0, blockers, readDiffFor: review }, null, 2));
process.exit(blockers.length === 0 && review.length === 0 ? 0 : 1);
' "$class" "$meta" "$checks" "$head" "$files"
