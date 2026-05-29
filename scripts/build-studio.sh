#!/usr/bin/env bash
set -euo pipefail

# Build the AsyncAPI Studio from the vendor/asyncapi-studio git submodule
# and copy the static export into static/asyncapi-studio/ for the asyncapi
# Forge variant to pick up (vite.config.mjs copies that directory into
# dist/ when PRODUCT_TYPE=asyncapi).
#
# Default behaviour: if static/asyncapi-studio/ already exists and
# contains an index.html, the script exits without rebuilding. The
# vendored bundle in this repo is a known-working snapshot from the
# original AsyncAPI-Conf-V2 build, kept committed because rebuilding from
# the current asyncapi/studio HEAD produces a bundle that stalls during
# hydration inside Forge's nested iframe (the upstream dynamic-import
# chunking strategy doesn't survive being nested under the Forge CDN
# host). The submodule is still in vendor/ as a source reference and
# for the eventual switch back to live rebuilds once upstream is
# compatible.
#
# To force a rebuild from the submodule pin:
#   FORCE_REBUILD=1 scripts/build-studio.sh
#
# The submodule path is `vendor/asyncapi-studio`, currently pinned to
# `@asyncapi/studio@1.3.0`. Patches applied at build time (next.config.js
# and src/app/page.tsx / StudioPageClient.tsx) are documented inline
# below.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUBMODULE_DIR="$REPO_ROOT/vendor/asyncapi-studio"
STUDIO_APP_DIR="$SUBMODULE_DIR/apps/studio"
OUT_DIR="$REPO_ROOT/static/asyncapi-studio"

echo "> Submodule: $SUBMODULE_DIR"
echo "> Output:    $OUT_DIR"

# 0. Fast path: if the vendored bundle is already in static/, skip the
#    rebuild entirely. The committed bundle is the current source of
#    truth for deploys — see the top-of-file comment. Set FORCE_REBUILD=1
#    to override.
if [ "${FORCE_REBUILD:-0}" != "1" ] && [ -f "$OUT_DIR/index.html" ]; then
  echo "> $OUT_DIR/index.html already present — using vendored bundle"
  echo "> Set FORCE_REBUILD=1 to rebuild from $SUBMODULE_DIR"
  exit 0
fi

# 1. Initialise the submodule if the user did a plain clone.
if [ ! -d "$SUBMODULE_DIR/.git" ] && [ ! -f "$SUBMODULE_DIR/.git" ]; then
  echo "> vendor/asyncapi-studio not initialised — running git submodule update --init"
  ( cd "$REPO_ROOT" && git submodule update --init --recursive vendor/asyncapi-studio )
fi

if [ ! -d "$STUDIO_APP_DIR" ]; then
  echo "Expected $STUDIO_APP_DIR not found — submodule layout may have changed."
  ls -la "$SUBMODULE_DIR" || true
  exit 1
fi

# 2. Skip rebuild if the output already matches the current submodule commit
#    (cheap freshness check — re-running pnpm install + Next build is slow).
STAMP_FILE="$OUT_DIR/.studio-commit"
CURRENT_SHA="$(cd "$SUBMODULE_DIR" && git rev-parse HEAD)"
if [ "${FORCE_REBUILD:-0}" != "1" ] && [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$CURRENT_SHA" ]; then
  echo "> static/asyncapi-studio already built for $CURRENT_SHA — skipping (FORCE_REBUILD=1 to override)"
  exit 0
fi

rm -rf "$OUT_DIR"

# 3a. Patch next.config.js for static export with relative asset paths so the
#     Studio loads under the Forge CDN's per-app subdirectory.
NEXT_CONFIG="$STUDIO_APP_DIR/next.config.js"
if [ -f "$NEXT_CONFIG" ] && [ ! -f "$NEXT_CONFIG.original" ]; then
  echo "> Patching $NEXT_CONFIG"
  cp "$NEXT_CONFIG" "$NEXT_CONFIG.original"
  cat > "$NEXT_CONFIG" <<'NEXT_CONF'
const originalConfig = (function(){ try{ return require('./next.config.js.original'); }catch(e){ return {} }})();
module.exports = { ...originalConfig, assetPrefix: './', output: 'export' };
NEXT_CONF
fi

# 3b. Split page.tsx into the canonical Next 14 "server page + client
#     delegate" pattern so the App Router can statically prerender the
#     page while still using `next/dynamic({ssr:false})` to defer
#     StudioWrapper until the client takes over. A single-file
#     'use client' page hangs at the preloader in Forge's iframe — the
#     two-file pattern hydrates correctly.
#
#     page.tsx       → Server Component (exports metadata, renders the
#                      client delegate)
#     StudioPageClient.tsx → Client Component (does the dynamic import)
#
#     The original page.tsx exports `metadata`, which Confluence ignores
#     anyway but Next requires for the page to be a valid Server
#     Component; we keep a minimal version.
PAGE_TSX="$STUDIO_APP_DIR/src/app/page.tsx"
CLIENT_TSX="$STUDIO_APP_DIR/src/app/StudioPageClient.tsx"
if [ -f "$PAGE_TSX" ] && [ ! -f "$PAGE_TSX.original" ]; then
  echo "> Replacing $PAGE_TSX with a server entry + client delegate"
  cp "$PAGE_TSX" "$PAGE_TSX.original"
  cat > "$PAGE_TSX" <<'PAGE_TSX_PATCH'
import StudioPageClient from './StudioPageClient';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AsyncAPI Studio',
};

export default function Page() {
  return <StudioPageClient />;
}
PAGE_TSX_PATCH
  cat > "$CLIENT_TSX" <<'CLIENT_TSX_PATCH'
'use client';
import { useEffect, useState } from 'react';
import StudioWrapper from '@/components/StudioWrapper';

// Use a mount-deferred guard instead of `next/dynamic({ssr:false})` —
// dynamic() defers StudioWrapper to a runtime chunk fetch which works
// at studio.asyncapi.com but stalls when the Studio iframe runs nested
// inside Forge's per-app CDN host. Direct import bundles StudioWrapper
// (and its `window`-touching deps) into the page chunk; the `mounted`
// guard prevents the server prerender from executing that branch.
export default function StudioPageClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <StudioWrapper />;
}
CLIENT_TSX_PATCH
fi

# 4. Install deps + build. The Studio is a pnpm workspace; build from root so
#    @asyncapi/* sibling packages resolve correctly.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found in PATH — install pnpm and re-run."
  exit 1
fi

echo "> pnpm install in $SUBMODULE_DIR"
( cd "$SUBMODULE_DIR" && PUPPETEER_SKIP_DOWNLOAD=true pnpm install --frozen-lockfile=false )

BUILT=false
for cmd in \
  "(cd \"$SUBMODULE_DIR\" && pnpm --filter @asyncapi/studio... -w build)" \
  "(cd \"$SUBMODULE_DIR\" && pnpm --filter \"@asyncapi/studio*\" -w build)" \
  "(cd \"$SUBMODULE_DIR\" && pnpm run build:studio)" \
  "(cd \"$SUBMODULE_DIR\" && pnpm run build)"; do
  echo "> Trying: $cmd"
  if bash -c "$cmd"; then
    BUILT=true
    break
  fi
done

if [ "$BUILT" = false ]; then
  echo "All build attempts failed. Inspect $STUDIO_APP_DIR for build output."
  exit 1
fi

# 5. Locate the static export directory and copy it.
FOUND=""
for p in \
  "$STUDIO_APP_DIR/out" \
  "$STUDIO_APP_DIR/build" \
  "$SUBMODULE_DIR/out" \
  "$SUBMODULE_DIR/build"; do
  if [ -d "$p" ]; then
    FOUND="$p"
    break
  fi
done

if [ -z "$FOUND" ]; then
  echo "Could not find Studio build output. Listing $STUDIO_APP_DIR:"
  ls -la "$STUDIO_APP_DIR" || true
  exit 1
fi

mkdir -p "$OUT_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$FOUND/" "$OUT_DIR/"
else
  cp -a "$FOUND/." "$OUT_DIR/"
fi
echo "> Copied $FOUND → $OUT_DIR"

# 6. Rewrite root-absolute local asset URLs to relative paths in the emitted
#    HTML. Some Next 13+ builds still emit a few /-prefixed paths even with
#    assetPrefix='./'; this catches them so the Studio loads off the Forge
#    CDN's nested URL.
echo "> Rewriting HTML asset URLs to relative paths"
while IFS= read -r -d '' html_file; do
  perl -i -pe "s/\\b(src|href)=([\"'])\\/(?!\\/)([^\"']+)/\$1=\$2.\\/\$3/g" "$html_file"
done < <(find "$OUT_DIR" -type f -name "*.html" -print0)

# 7. Stamp the output so a re-run with the same submodule SHA is a no-op.
echo "$CURRENT_SHA" > "$STAMP_FILE"

echo "AsyncAPI Studio build complete: $OUT_DIR ($CURRENT_SHA)"
