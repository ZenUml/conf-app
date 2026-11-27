#!/usr/bin/env bash
# Prepare or publish one production variant.
#
#   release.sh <variant>
#     Read-only. Prints the draft, gate, and a delta file. Exit 0 only when
#     the gate is OK and the source build succeeded.
#
#   release.sh <variant> --publish --notes-file <file>
#     Publish that draft, then block until its deploy and smoke finish.
#     Lite waits until Diagramly's smoke for the same commit succeeded.
#     Full waits until Lite's smoke succeeded, after the 8-hour soak and its error check.
#     Exit 0 smoke passed. Exit 2 deploy passed and no smoke jobs ran.
#     Any other non-zero exit means do not publish the next variant.
#     Lite and Full also refuse to publish until the prerequisite variant's
#     release carries a spot-check line (below).
#
#   release.sh <variant> --spot-check pass|na --note "<evidence or reason>"
#     Record the post-release spot check on the variant's latest published
#     release as "Spot check: PASS|N/A — <note>". PASS needs the evidence,
#     N/A the reason the variant cannot reach the change.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="${RELEASE_REPO:-ZenUml/conf-app}"

usage() {
  printf 'usage: release.sh <diagramly|lite|full|asyncapi> [--publish --notes-file FILE | --spot-check pass|na --note TEXT]\n' >&2
  exit 1
}

# Block until the release workflow for <tag> has a verdict.
# Prints deploy/smoke lines plus run id and url. Returns release-jobs.sh's status.
wait_for_release() {
  local wanted="$1" i run_id jobs verdict status url
  for ((i=0; i<60; i++)); do
    run_id="$(gh run list --repo "$repo" --workflow release.yml --limit 30 \
      --json databaseId,displayTitle,createdAt \
      | jq -r --arg tag "$wanted" 'map(select(.displayTitle==$tag)) | sort_by(.createdAt) | last | .databaseId // empty')"
    if [[ -z "$run_id" ]]; then
      sleep 10
      continue
    fi
    jobs="$(gh run view "$run_id" --repo "$repo" --json jobs --jq .jobs)"
    verdict="$(bash "$here/release-jobs.sh" <<<"$jobs")" && status=0 || status=$?
    if [[ "$status" -eq 3 ]]; then
      sleep 15
      continue
    fi
    url="$(gh run view "$run_id" --repo "$repo" --json url --jq .url)"
    printf '%s\nrun: %s\nurl: %s\n' "$verdict" "$run_id" "$url"
    return "$status"
  done
  printf 'BLOCK: timed out waiting for %s\n' "$wanted"
  return 1
}

variant=""
publish=0
notes_file=""
spot_check=""
spot_note=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) publish=1; shift ;;
    --spot-check)
      [[ $# -ge 2 ]] || usage
      spot_check="$2"
      shift 2
      ;;
    --note)
      [[ $# -ge 2 ]] || usage
      spot_note="$2"
      shift 2
      ;;
    --notes-file)
      [[ $# -ge 2 ]] || usage
      notes_file="$2"
      shift 2
      ;;
    -*) usage ;;
    *)
      [[ -z "$variant" ]] || usage
      variant="$1"
      shift
      ;;
  esac
done
[[ -n "$variant" ]] || usage

case "$variant" in
  diagramly|dia) variant=diagramly ;;
  lite) ;;
  full) ;;
  asyncapi|async|api) variant=asyncapi ;;
  *) printf 'BLOCK: unknown variant %s\n' "$variant"; exit 1 ;;
esac

if [[ -n "$spot_check" ]]; then
  [[ "$publish" -eq 0 ]] || usage
  line="$(bash "$here/spot-check.sh" format "$spot_check" "$spot_note")" || exit 1
  latest="$(gh release list --repo "$repo" --exclude-drafts --limit 40 --json tagName \
    --jq "[.[] | select(.tagName | endswith(\"-${variant}\"))][0].tagName // empty")"
  [[ -n "$latest" ]] || { printf 'BLOCK: no published %s release\n' "$variant"; exit 1; }
  body="$(mktemp)"; updated="$(mktemp)"
  trap 'rm -f "$body" "$updated"' EXIT
  gh release view "$latest" --repo "$repo" --json body --jq .body >"$body"
  bash "$here/spot-check.sh" apply "$body" "$line" >"$updated"
  gh release edit "$latest" --repo "$repo" --notes-file "$updated" >/dev/null
  printf 'RECORDED %s\n%s\n' "$latest" "$line"
  exit 0
fi

if [[ "$publish" -eq 1 && ! -f "${notes_file:-}" ]]; then
  printf 'BLOCK: --publish needs --notes-file\n'
  exit 1
fi

select_out="$(bash "$here/select-draft.sh" "$variant")" || {
  printf '%s\n' "$select_out"
  exit 1
}
tag="$(awk '/^SELECT:/{print $2; exit}' <<<"$select_out")"
sha="$(awk '/^SELECT:/{print $3; exit}' <<<"$select_out")"
[[ -n "$tag" && -n "$sha" ]] || { printf 'BLOCK: select-draft returned no tag\n%s\n' "$select_out"; exit 1; }
skips="$(grep '^SKIP:' <<<"$select_out" || true)"

gate="$(bash "$here/check-prerequisite.sh" "$variant" "$tag" 2>&1)" && gate_status=0 || gate_status=$?

previous="$(gh release list --repo "$repo" --exclude-drafts --limit 40 --json tagName \
  --jq "[.[] | select(.tagName | endswith(\"-${variant}\"))][0].tagName // empty")"

delta_file="${RELEASE_DELTA_DIR:-${TMPDIR:-/tmp}}/release-${variant}-${tag}.delta"
{
  printf 'variant: %s\n' "$variant"
  printf 'draft: %s\n' "$tag"
  printf 'sha: %s\n' "$sha"
  printf 'previous: %s\n' "${previous:-none}"
  printf 'gate: %s\n' "$gate"
  printf '\n'
  if [[ -n "$previous" ]]; then
    git fetch --tags --quiet origin
    bash "$here/classify-delta.sh" "$previous" "$sha"
  else
    printf 'infra\t%s\tno previous published tag\t\n' "$sha"
  fi
} >"$delta_file"

source_json="$(gh run list --repo "$repo" --commit "$sha" --workflow "Build, Test and Draft Release" --limit 5 \
  --json databaseId,status,conclusion,url,createdAt)"
source_line="$(jq -r '
  (map(select(.conclusion=="success")) | .[0]) as $ok
  | if $ok then "success \($ok.url)"
    elif length == 0 then "missing"
    else "\(.[0].status) \(.[0].url)"
    end
' <<<"$source_json")"

source_jobs_ok=0
if [[ "$source_line" == success\ * ]]; then
  source_id="$(jq -r 'map(select(.conclusion=="success")) | .[0].databaseId' <<<"$source_json")"
  source_jobs="$(gh run view "$source_id" --repo "$repo" --json jobs --jq .jobs)"
  if jq -e '
    [.[] | select(.name=="Staging validation")][0].conclusion == "success"
    and [.[] | select(.name=="Draft preparation")][0].conclusion == "success"
  ' <<<"$source_jobs" >/dev/null; then
    source_jobs_ok=1
  else
    source_line="BLOCK: source run $source_id is green but Staging validation or Draft preparation is not"
  fi
fi

behavioral_count="$(awk -F'\t' '$1=="behavioral"{n++} END{print n+0}' "$delta_file")"
infra_count="$(awk -F'\t' '$1=="infra"{n++} END{print n+0}' "$delta_file")"

report_prepare() {
  printf 'variant: %s\n' "$variant"
  printf 'draft: %s\n' "$tag"
  printf 'sha: %s\n' "$sha"
  printf 'previous: %s\n' "${previous:-none}"
  printf 'gate: %s\n' "$gate"
  printf 'source: %s\n' "$source_line"
  printf 'delta: %s\n' "$delta_file"
  printf 'behavioral: %s\ninfra: %s\n' "$behavioral_count" "$infra_count"
  if [[ -n "$skips" ]]; then
    printf '%s\n' "$skips"
  fi
}

if [[ "$publish" -eq 0 ]]; then
  if [[ "$gate_status" -ne 0 || "$source_jobs_ok" -ne 1 ]]; then
    printf 'BLOCK\n'
    report_prepare
    exit 1
  fi
  printf 'READY\n'
  report_prepare
  exit 0
fi

if [[ "$gate_status" -ne 0 || "$source_jobs_ok" -ne 1 ]]; then
  printf 'BLOCK\n'
  report_prepare
  exit 1
fi

# Lite and Full do not publish until the prerequisite variant's smoke is green.
if [[ "$variant" == lite || "$variant" == full ]]; then
  prereq_tag="$(sed -n 's/^OK: [^ ]* and \([^ ]*\) target.*/\1/p' <<<"$gate")"
  [[ -n "$prereq_tag" ]] || { printf 'BLOCK: could not read the prerequisite tag from the gate line\n%s\n' "$gate"; exit 1; }
  printf 'waiting for %s smoke\n' "$prereq_tag" >&2
  prereq_status=0
  wait_for_release "$prereq_tag" || prereq_status=$?
  if [[ "$prereq_status" -ne 0 ]]; then
    printf 'BLOCK: %s smoke is not green\n' "$prereq_tag"
    exit 1
  fi
  prereq_body="$(mktemp)"
  gh release view "$prereq_tag" --repo "$repo" --json body --jq .body >"$prereq_body"
  if ! spot_line="$(bash "$here/spot-check.sh" check "$prereq_body")"; then
    rm -f "$prereq_body"
    printf '%s\nBLOCK: %s has no spot check; record it with release.sh %s --spot-check pass|na --note "..."\n' \
      "$spot_line" "$prereq_tag" "${prereq_tag##*-}"
    exit 1
  fi
  rm -f "$prereq_body"
  printf '%s: %s\n' "$prereq_tag" "$spot_line" >&2
fi

draft_body="$(mktemp)"
combined="$(mktemp)"
trap 'rm -f "$draft_body" "$combined"' EXIT
gh release view "$tag" --repo "$repo" --json body --jq .body >"$draft_body"
bash "$here/notes-body.sh" "$notes_file" "$draft_body" >"$combined"

gh release edit "$tag" --repo "$repo" --notes-file "$combined" --draft=false
printf 'PUBLISHED %s\n' "$tag"
own_status=0
wait_for_release "$tag" || own_status=$?
exit "$own_status"
