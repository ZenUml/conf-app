#!/usr/bin/env bash
# Apply the shared staging D1 migrations with the wrangler version the lockfile
# pins, without installing the repository's dependency tree: the job needs only
# wrangler, and a full install took 19 s of a 33 s job on the deploy path.
set -euo pipefail

VERSION=$(sed -nE 's/^  wrangler@([0-9]+\.[0-9]+\.[0-9]+):$/\1/p' pnpm-lock.yaml | head -1)
if [ -z "$VERSION" ]; then
  echo "wrangler version not found in pnpm-lock.yaml" >&2
  exit 1
fi
if [ "${1:-}" = "--print-version" ]; then
  echo "$VERSION"
  exit 0
fi

cp wrangler-stg.toml wrangler.toml
npx --yes "wrangler@$VERSION" d1 migrations apply DB --remote --env production
