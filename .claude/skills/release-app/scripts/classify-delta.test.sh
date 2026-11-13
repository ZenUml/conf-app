#!/usr/bin/env bash
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT
fail=0

check() {
  local name="$1" expected="$2"
  local out
  out="$(CLASSIFY_FIXTURE="$fixture" bash "$here/classify-delta.sh")"
  if [[ "$out" != "$expected" ]]; then
    printf 'FAIL %s\n got: %s\n want: %s\n' "$name" "$out" "$expected"
    fail=1
  else
    printf 'ok %s\n' "$name"
  fi
}

printf 'aaa\tsample an event\tsrc/features/titleDraft/offer.ts\n' >"$fixture"
check runtime $'behavioral\taaa\tsample an event\tsrc/features/titleDraft/offer.ts'

printf 'bbb\tci only\t.github/workflows/release.yml\n' >"$fixture"
check infra $'infra\tbbb\tci only\t.github/workflows/release.yml'

printf 'ccc\ttests\tsrc/features/titleDraft/offer.spec.ts\n' >"$fixture"
check tests $'infra\tccc\ttests\tsrc/features/titleDraft/offer.spec.ts'

printf 'ddd\tmixed\tdocs/ops/x.md,functions/api/handler.ts\n' >"$fixture"
check mixed $'behavioral\tddd\tmixed\tdocs/ops/x.md functions/api/handler.ts'

exit "$fail"
