#!/usr/bin/env bash
set -euo pipefail

# Build the AsyncAPI Studio from the vendor/asyncapi-studio git submodule
# and copy the static export into static/asyncapi-studio/ for the asyncapi
# Forge variant to pick up (vite.config.mjs copies that directory into
# dist/ when PRODUCT_TYPE=asyncapi).
#
# This mirrors AsyncAPI-Conf-V2's setup: build fresh from source every
# time, do not commit the output. static/asyncapi-studio/ is gitignored.
#
# The submodule path is `vendor/asyncapi-studio`, pinned to
# `@asyncapi/studio@1.0.1` (the version AsyncAPI-Conf-V2 used). Newer
# upstream versions (1.1+, 1.3+) regressed in ways that break under
# Forge's nested iframe (`window` access during Next.js prerender, or
# dynamic-import chunking that stalls at runtime under the Forge CDN
# host). Re-evaluate the pin when upstream fixes those.
#
# Build-time patches applied to the submodule's working tree:
#  - next.config.js → output:'export', assetPrefix:'./' for static export
#    with relative asset paths (Forge serves the bundle from a per-app
#    subdirectory). Original is preserved as next.config.js.original.
#
# Skip cache: if .studio-commit stamp matches the current submodule SHA
# and OUT_DIR/index.html exists, skip the rebuild. Set FORCE_REBUILD=1
# to override.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUBMODULE_DIR="$REPO_ROOT/vendor/asyncapi-studio"
STUDIO_APP_DIR="$SUBMODULE_DIR/apps/studio"
OUT_DIR="$REPO_ROOT/static/asyncapi-studio"

echo "> Submodule: $SUBMODULE_DIR"
echo "> Output:    $OUT_DIR"

# 1. Initialise the submodule if the user did a plain clone.
if [ ! -d "$SUBMODULE_DIR/.git" ] && [ ! -f "$SUBMODULE_DIR/.git" ]; then
  echo "> vendor/asyncapi-studio not initialised — running git submodule update --init"
  ( cd "$REPO_ROOT" && git submodule update --init --depth 1 vendor/asyncapi-studio )
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
if [ "${FORCE_REBUILD:-0}" != "1" ] && [ -f "$STAMP_FILE" ] && [ -f "$OUT_DIR/index.html" ] && [ "$(cat "$STAMP_FILE")" = "$CURRENT_SHA" ]; then
  echo "> static/asyncapi-studio already built for $CURRENT_SHA — skipping (FORCE_REBUILD=1 to override)"
  exit 0
fi

rm -rf "$OUT_DIR"

# 3. Patch next.config.js for static export with relative asset paths so the
#    Studio loads under the Forge CDN's per-app subdirectory. Mirrors the
#    AsyncAPI-Conf-V2 scripts/build-studio.sh patch.
NEXT_CONFIG="$STUDIO_APP_DIR/next.config.js"
if [ -f "$NEXT_CONFIG" ] && [ ! -f "$NEXT_CONFIG.original" ]; then
  echo "> Patching $NEXT_CONFIG"
  cp "$NEXT_CONFIG" "$NEXT_CONFIG.original"
  cat > "$NEXT_CONFIG" <<'NEXT_CONF'
const originalConfig = (function(){ try{ return require('./next.config.js.original'); }catch(e){ return {} }})();
module.exports = { ...originalConfig, assetPrefix: './', output: 'export' };
NEXT_CONF
fi

# NOTE: deliberately NOT patching apps/studio/src/app/page.tsx. The upstream
# page.tsx at 1.0.1 already uses next/dynamic({ssr:false}) which prevents
# the prerender from touching window-dependent code. An earlier version of
# this script split page.tsx into a server+client delegate pair, which
# defeated the ssr:false guarantee and caused `ReferenceError: window is
# not defined` during static export.

# 4. Install deps + build. The Studio is a pnpm workspace; build from root so
#    @asyncapi/* sibling packages resolve correctly.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found in PATH — install pnpm and re-run."
  exit 1
fi

echo "> pnpm install in $SUBMODULE_DIR"
# CYPRESS_INSTALL_BINARY=0: the Studio monorepo's cypress devDependency tries
# to download its binary on postinstall; the Studio build never runs Cypress,
# and behind a restrictive proxy the download fails the whole install
# (observed 2026-08-22: corrupted-download checksum mismatch).
( cd "$SUBMODULE_DIR" && PUPPETEER_SKIP_DOWNLOAD=true CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile=false )

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
