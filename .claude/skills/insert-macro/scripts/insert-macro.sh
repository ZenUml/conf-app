#!/usr/bin/env bash
# Insert a Confluence macro via the slash menu, fast, in one agent-browser process.
# See ../SKILL.md for the why. Requires: agent-browser, jq.
set -euo pipefail

SESSION="conf-app"
RESTORE="stg"
PROFILE=""
URL=""
NEW_SPACE=""
NEW_PARENT=""
SITE=""
MACRO="zenuml"
LABEL=""
MATCH=""
EXCLUDE=""
TAB=""
DISMISS_PAYWALL=0
SCREENSHOT=""

usage() {
  cat <<'USAGE'
Usage: insert-macro.sh [options]

  --session <name>      agent-browser session (default: conf-app)
  --restore <key>        agent-browser --restore key (default: stg)
  --profile <name>       Chrome profile to reuse instead of --restore. REQUIRED for
                          forge-tunnel testing (tunnel serves only the FORGE_EMAIL
                          identity); e.g. --profile "Profile 8"
  --url <edit-url>       existing page in edit mode to insert into (required, or use --new)
  --new <site>:<space>:<parentPageId>
                          create a fresh page under this space/parent first, then insert
  --macro <term>         slash-menu search term (default: zenuml). Also: graph, openapi, database...
  --label <substring>    substring required in the Browse-dialog option text (default: same as --macro)
  --match <substring>    extra required substring, for variant disambiguation (e.g. "ZenUML for Confluence")
  --exclude <substring>  substring that must NOT appear (e.g. "Lite" to pick Full/Diagramly)
  --tab <name>           after insert, click this diagram-type tab inside the iframe (Sequence|Mermaid|PlantUML)
  --dismiss-paywall       best-effort dismiss Lite paywall / draft-recovery banner inside the iframe
  --screenshot <path>    save a screenshot after completion
  -h, --help              show this help

Examples:
  # Insert the Lite ZenUML diagram macro into an existing draft, default Sequence tab
  insert-macro.sh --url "https://lite-dev.atlassian.net/wiki/spaces/SD/pages/edit-v2/123" \
    --macro zenuml --match Lite

  # Create a fresh page on lite-dev under space SD / parent 67371062, insert Full's diagram macro
  insert-macro.sh --new lite-dev.atlassian.net:SD:67371062 \
    --macro zenuml --match "ZenUML for Confluence" --exclude Lite --tab Mermaid
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --restore) RESTORE="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --new) IFS=':' read -r SITE NEW_SPACE NEW_PARENT <<< "$2"; shift 2 ;;
    --macro) MACRO="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --match) MATCH="$2"; shift 2 ;;
    --exclude) EXCLUDE="$2"; shift 2 ;;
    --tab) TAB="$2"; shift 2 ;;
    --dismiss-paywall) DISMISS_PAYWALL=1; shift ;;
    --screenshot) SCREENSHOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$URL" && -z "$SITE" ]]; then
  echo "error: pass --url <edit-url> or --new <site>:<space>:<parentPageId>" >&2
  exit 1
fi
if [[ -z "$LABEL" ]]; then LABEL="$MACRO"; fi

# --profile wins over --restore. Required for forge-tunnel testing: the tunnel
# serves frontend resources ONLY to the FORGE_EMAIL identity, and --restore=stg
# is the robot test account, which silently gets the deployed bundle instead.
# See .claude/skills/forge-tunnel/skill.md § Key constraints.
if [[ -n "$PROFILE" ]]; then
  A() { agent-browser --session "$SESSION" --profile "$PROFILE" "$@"; }
else
  A() { agent-browser --session "$SESSION" --restore="$RESTORE" "$@"; }
fi

# Build one batch step as a JSON array — jq's --args handles all escaping,
# so callers never have to worry about quotes inside the eval JS blob.
step() { jq -cn --args '$ARGS.positional' -- "$@"; }

# --- Resolve the page to edit ---------------------------------------------
if [[ -n "$SITE" ]]; then
  URL="https://${SITE}/wiki/create-content/page?spaceKey=${NEW_SPACE}&parentPageId=${NEW_PARENT}"
fi

steps=()
steps+=("$(step open "$URL")")
steps+=("$(step wait --load networkidle)")
steps+=("$(step wait 500)")

# --- Focus the editor and open the slash menu (real keystrokes only —
# `fill`/`type` on a selector does not dispatch the keydown ProseMirror
# needs; `keyboard type` does) ---------------------------------------------
steps+=("$(step click '[data-testid="ak-editor-fp-content-area"]')")
steps+=("$(step keyboard type /)")
# Wait for the menu itself, not a fixed sleep — the "New page" AI-compose
# box briefly steals focus/timing on a cold page load, making a fixed
# ms-wait here flaky (verified: 1500ms failed intermittently, waiting for
# the menu's own "View more" text did not).
steps+=("$(step wait --text 'View more')")
steps+=("$(step find text 'View more' click)")
steps+=("$(step wait --text 'Browse')")
steps+=("$(step click '[role=dialog][aria-label="Browse"] input')")
steps+=("$(step keyboard type "$MACRO")")
steps+=("$(step wait 1200)")

# --- mark-then-click: agent-browser has no locator-filter chain and
# role/name matching is unreliable in this app, so select in JS, tag the
# element, then issue a real CDP click against the tag (see smoke-test
# skill's "mark-then-click pattern" for the full rationale) ----------------
MARK_JS=$(cat <<EOF
(() => {
  const dlg = document.querySelector('[role=dialog][aria-label="Browse"]');
  if (!dlg) return 'NO DIALOG';
  const opts = [...dlg.querySelectorAll('[role=option], [role=gridcell] button')];
  const m = opts.find(o => {
    const t = o.textContent.toLowerCase();
    if (!t.includes('${LABEL}'.toLowerCase())) return false;
    if ('${MATCH}' && !t.includes('${MATCH}'.toLowerCase())) return false;
    if ('${EXCLUDE}' && t.includes('${EXCLUDE}'.toLowerCase())) return false;
    return true;
  });
  if (!m) return 'NO MATCH — options: ' + opts.map(o => o.textContent.trim()).join(' | ');
  document.querySelectorAll('[data-ab-pick]').forEach(e => e.removeAttribute('data-ab-pick'));
  m.setAttribute('data-ab-pick', '1');
  return 'marked: ' + m.textContent.trim();
})()
EOF
)
steps+=("$(step eval "$MARK_JS")")
steps+=("$(step click '[data-ab-pick]')")
# Clicking the option card only selects/highlights it in this dialog layout
# (shows the description tooltip) — it does not insert. The dialog's own
# "Insert" button does. `find text "Insert" click` / `click "text=Insert"`
# both fail-not-found on this button's markup, so mark-then-click again.
INSERT_BTN_JS='(() => {
  const dlg = document.querySelector("[role=dialog][aria-label=\"Browse\"]");
  if (!dlg) return "NO DIALOG";
  const btn = [...dlg.querySelectorAll("button")].find(b => b.textContent.trim() === "Insert");
  if (!btn) return "NO INSERT BUTTON";
  document.querySelectorAll("[data-ab-pick]").forEach(e => e.removeAttribute("data-ab-pick"));
  btn.setAttribute("data-ab-pick", "1");
  return "marked insert button";
})()'
steps+=("$(step wait 300)")
steps+=("$(step eval "$INSERT_BTN_JS")")
steps+=("$(step click '[data-ab-pick]')")
steps+=("$(step wait 3000)")

BATCH_JSON=$(printf '%s\n' "${steps[@]}" | jq -cs '.')
set +e
INSERT_RESULT=$(echo "$BATCH_JSON" | A batch --bail --json)
BATCH_EXIT=$?
set -e
if [[ $BATCH_EXIT -ne 0 ]]; then
  echo "insert-macro batch failed (exit $BATCH_EXIT):" >&2
  echo "$INSERT_RESULT" | jq -c '.[] | select(.success == false)' >&2
  exit "$BATCH_EXIT"
fi

# --- Optional: enter the Forge modal OOPIF for paywall dismissal / tab pick
if [[ "$DISMISS_PAYWALL" == "1" || -n "$TAB" ]]; then
  FRAME_SEL='[data-testid="custom-ui-fullscreen-modal-dialog"] [data-testid="hosted-resources-iframe"]'
  # Cold-mount of the Custom UI modal can outlast the wait above — retry
  # frame entry rather than treating one miss as final.
  for _attempt in 1 2 3 4; do
    if A frame "$FRAME_SEL" >/dev/null 2>&1; then break; fi
    A wait 1500 || true
  done

  if [[ "$DISMISS_PAYWALL" == "1" ]]; then
    PAYWALL_JS=$(cat <<'EOF'
(() => {
  const banner = document.querySelector('[data-zenuml-draft-banner]');
  if (banner) {
    const d = [...banner.querySelectorAll('button')].find(b => b.textContent.includes('Discard'));
    if (d) { d.setAttribute('data-ab-pick', '1'); return 'draft-banner'; }
  }
  const p = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Continue editing'));
  if (p) { p.setAttribute('data-ab-pick', '1'); return 'paywall'; }
  return 'none';
})()
EOF
)
    RESULT=$(A eval "$PAYWALL_JS" || echo '"none"')
    if [[ "$RESULT" != '"none"' ]]; then
      A click "[data-ab-pick]" || true
      A wait 500 || true
    fi
  fi

  if [[ -n "$TAB" ]]; then
    # A real CDP mouse click here often lands on a child <span> (the dot or
    # label inside the tab button) and agent-browser refuses to click an
    # occluded point — dispatch the click in-page instead. `.click()` still
    # fires a genuine bubbling click event, so Vue's @click handler runs.
    TAB_JS=$(cat <<EOF
(() => {
  const btn = [...document.querySelectorAll('button, [role=tab]')].find(b => b.textContent.trim() === '${TAB}');
  if (!btn) return 'NO TAB MATCH: ${TAB}';
  btn.click();
  return 'clicked tab: ' + btn.textContent.trim();
})()
EOF
)
    A eval "$TAB_JS" || true
  fi

  A frame main || true
fi

if [[ -n "$SCREENSHOT" ]]; then
  A screenshot "$SCREENSHOT"
  echo "screenshot: $SCREENSHOT"
fi

echo "$INSERT_RESULT" | jq -c '.[-4:]'
