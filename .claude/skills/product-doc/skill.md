---
name: product-doc
description: Generate or update the user-facing product guide for the ZenUML Confluence Add-on. Reads source components, captures Playwright screenshots from staging, and writes/updates docs/product-guide.md. Use after new features are merged, for release updates, or when the user asks to "update product docs" or "document this feature".
---

## Step 1 — Discovery

Identify what has changed since the last doc update.

**Diff against last doc update:**
```bash
# Find last commit that touched docs/product-guide.md
git log --oneline docs/product-guide.md | head -5

# Diff all source changes since that commit
git diff <last-doc-commit>..HEAD -- src/ manifest.yml
```

**Key component directories to scan:**
- `src/components/Viewer/` — one viewer per diagram type (ZenUml, Mermaid, PlantUml, Graph, OpenApi, Embed)
- `src/components/Editor/` — editor behavior and toolbar
- `src/components/Header/` — navigation, action buttons (Save, Publish, Fullscreen)
- `src/components/Workspace.vue` — layout, split-pane, mode switching
- `src/components/Paywall/` — paywall modal and upgrade prompts
- `src/components/DiagramPortal.vue` — rendering portal

**Model files for diagram types:**
- `src/model/Diagram/Diagram.ts` — `DiagramType` enum (Sequence, Mermaid, PlantUml, Graph, OpenApi, Embed)
- `src/model/ContentProvider/` — storage behavior
- `src/utils/analytics/catalog.ts` — event names reveal user-facing actions

**Scan checklist:**
1. Read `DiagramType` enum to confirm current diagram types.
2. `git log --oneline -20 src/` to identify recently changed files.
3. Read each changed component file for UI-visible behavior changes.
4. Note new props, emits, or visible text strings as doc candidates.

---

## Step 2 — Screenshot Capture

Screenshots go in `docs/screenshots/` (committed) for doc illustrations, or `/tmp/` for ephemeral verification only.

### Option A — Use existing smoke test screenshots (fastest)

The E2E suite saves screenshots after every successful smoke test run:
```bash
ls tests/e2e-tests/smoke-*.png
```
These files are on-disk and ready to copy:
```bash
cp tests/e2e-tests/smoke-sequence-<timestamp>.png docs/screenshots/sequence-diagram.png
cp tests/e2e-tests/smoke-mermaid-<timestamp>.png docs/screenshots/plantuml-diagram.png
cp tests/e2e-tests/smoke-openapi-<timestamp>.png docs/screenshots/openapi-diagram.png
cp tests/e2e-tests/smoke-graph-<timestamp>.png docs/screenshots/graph-diagram.png
```
Pick the most recent timestamp for each type (sort by `ls -lt`). These are real, committed E2E artifacts — prefer this route over a live Playwright capture for documentation purposes.

### Option B — Fresh Playwright screenshots from a live site

**Critical:** `tests/e2e-tests/test-pages.json` contains *ephemeral* page IDs created by test runs — they rotate and are not stable. Do **not** hard-code them for screenshot scripts.

**Auth state files** (pre-authenticated Playwright sessions):
```
tests/e2e-tests/auth-state-<domain>.json
```
Domains and their profiles (from `tests/e2e-tests/config/apps.ts`):
- `zenuml.atlassian.net` — Lite prod + Full prod + Diagramly prod (space: `ZEN`)
- `lite-stg.atlassian.net` — Lite staging (space: `SD`)
- `lite-dev.atlassian.net` — Lite dev (space: `SD`)

**To find a stable page with macros**, use the Confluence REST API with the saved auth:
```bash
# List pages in the ZEN space that have a ZenUML macro
curl -s --cookie <cookies-from-auth-state> \
  "https://zenuml.atlassian.net/wiki/rest/api/content?spaceKey=ZEN&type=page&limit=20" \
  | python3 -m json.tool | grep title
```

**Playwright screenshot script template** (`/tmp/take-screenshots.mjs`):
```javascript
import { chromium } from 'playwright';
import fs from 'fs';

const AUTH_STATE = 'tests/e2e-tests/auth-state-zenuml.atlassian.net.json';
const SITE = 'https://zenuml.atlassian.net';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: JSON.parse(fs.readFileSync(AUTH_STATE, 'utf8'))
});
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

// Navigate to a known page with macros
await page.goto(`${SITE}/wiki/pages/viewpage.action?pageId=<PAGE_ID>`, {
  waitUntil: 'networkidle', timeout: 30000
});
await page.waitForTimeout(8000); // Forge iframes need extra time to load

await page.screenshot({ path: 'docs/screenshots/<type>-diagram.png', fullPage: false });
await browser.close();
```

Run from the repo root: `node /tmp/take-screenshots.mjs`

**Naming convention for screenshots:**
- `docs/screenshots/<diagram-type>-diagram.png` — rendered diagram in view mode
- `docs/screenshots/<diagram-type>-editor.png` — editor + preview split
- `docs/screenshots/paywall-modal.png` — paywall modal
- `docs/screenshots/fullscreen.png` — fullscreen viewer

---

## Step 3 — Documentation Update

Target file: `docs/product-guide.md`

If the file does not exist, create it with this skeleton:
```markdown
# ZenUML for Confluence — Product Guide

## Overview
## Getting Started
## Diagram Types
### Sequence Diagrams
### Mermaid Diagrams
### PlantUML Diagrams
### Graph Diagrams (DrawIO)
### OpenAPI Specifications
### Embed
## Editor
## Fullscreen Viewer
## Saving and Publishing
## Plans and Limits
## Release History
```

**For new features:** add to the relevant section. Keep prose concise; use numbered steps for workflows, bullet lists for options.

**For changed behavior:** find the affected steps, rewrite in place. Do not append duplicates.

**For new diagram types:** add a new `###` subsection under "Diagram Types" following the existing pattern:
```markdown
### <Type> Diagrams
Brief description of what this type renders and when to use it.
Insert diagram code in the editor, then click **Publish** to save.
![<type> diagram example](screenshots/<type>-viewer.png)
```

**For releases:** append to "Release History" using the format in Step 4.

---

## Step 4 — Changelog Format

Append new entries at the top of the "Release History" section, newest first:

```markdown
## v{version} — {YYYY-MM-DD}
- [Feature] Description of new feature (user-facing, present tense)
- [Fix] Description of bug fix
- [Change] Description of behavior change
```

Source the version from the most recent git tag: `git describe --tags --abbrev=0`
Source the date from today's date or the tag date: `git log -1 --format=%ai <tag>`

---

## Step 5 — Verification

Before finishing, run these checks:

1. **Section references match UI.** For each heading referencing a UI element (button name, menu item, modal title), confirm the string exists in `src/` via:
   ```bash
   grep -r "<UI string>" /Users/pengxiao/workspaces/zenuml/conf-app/src/ --include="*.vue" --include="*.ts" -l
   ```

2. **Screenshot files exist.** For every `![...](screenshots/...)` reference in the doc, verify the file is present:
   ```bash
   ls /Users/pengxiao/workspaces/zenuml/conf-app/docs/screenshots/
   ```
   If a screenshot is referenced but missing, either capture it (Step 2) or remove the reference.

3. **Diagram types are complete.** Confirm every value in the `DiagramType` enum (excluding `Unknown`) has a corresponding `###` subsection in "Diagram Types".

4. **No client names.** Run the privacy grep before committing:
   ```bash
   grep -rE '\b[a-z0-9-]+\.atlassian\.net\b' docs/product-guide.md
   ```
   Any hit that is not `example.atlassian.net` or `lite-stg.atlassian.net` must be replaced with a placeholder.

5. **Lint the markdown** (optional but recommended):
   ```bash
   npx markdownlint docs/product-guide.md
   ```

Once all checks pass, the doc is ready to commit on a feature branch (or directly to `main` for `.md`-only changes per the git workflow policy).
