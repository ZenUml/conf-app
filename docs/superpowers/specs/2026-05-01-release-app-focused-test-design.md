# Release App — Focused Feature Test

**Date:** 2026-05-01  
**Status:** Approved, ready for implementation

## Problem

The current release pipeline runs a generic PVT (Mermaid smoke check) after every production deploy. It confirms the app is alive but does not validate the specific feature shipped in the release. Feature regressions that don't affect Mermaid rendering go undetected until users report them.

## Design

Add a **Step 5.5: Focused Feature Test** to the `release-app` skill, positioned between the existing PVT (Step 5) and the Report (Step 6). The step auto-detects which features changed in the release and invokes the corresponding feature-specific PVT sub-skill.

## Architecture

### Feature Detection

After the release workflow succeeds, the skill:

1. Finds the previous release tag for the variant being released:
   ```bash
   gh release list --repo ZenUml/confluence-plugin-cloud --exclude-drafts \
     --limit 10 | grep <variant> | awk 'NR==2 {print $3}'
   ```
2. Scans commit messages between the previous tag and the new tag:
   ```bash
   git log <prev-tag>..<new-tag> --oneline
   ```
3. Matches commit messages (case-insensitive) against the keyword registry.

### Keyword → Sub-skill Registry

| Keywords | Sub-skill |
|---|---|
| `paywall`, `upgrade`, `css`, `persona`, `modal` | `/pvt-paywall` |
| `editor`, `editor-ui`, `codemirror` | `/pvt-editor` |
| `swagger`, `openapi` | `/pvt-swagger` |
| `graph`, `drawio` | `/pvt-drawio` |

- Multiple keywords in a single commit → one sub-skill match (deduplicated).
- Multiple distinct sub-skills matched → run sequentially.
- No match → log "No focused test registered for this release" and skip without blocking.

### Sub-skill Invocation

Each matched sub-skill is invoked with the variant as an argument (e.g., `/pvt-paywall lite`). Sub-skills return PASS or FAIL with a specific failing step.

### Failure Behavior

A focused test FAIL does **not** roll back or block the release (the app is already live). It surfaces in the final report as `FAIL` with the failing step, triggering immediate investigation. The report always includes focused test results even on failure.

## `pvt-paywall` Sub-skill

Located at `.claude/skills/pvt-paywall/SKILL.md`. Tests the paywall modal flow on production (`zenuml.atlassian.net`).

### What it validates

- Paywall modal appears when Edit is clicked in a saturated space (pre-edit gate)
- All modal elements are present and interactive
- Dismissal paths (×, Escape, backdrop, CTA clicks) do NOT grant edit access
- `Continue editing` grants edit access and fires `paywall_continued_editing`
- `upgrade_modal_shown` fires for each modal appearance

### Test Steps

1. Open `zenuml.atlassian.net`, navigate to a page with a ZenUML macro
2. Set localStorage mocks to simulate a saturated space:
   ```js
   localStorage.mockCSSEnabled = 'true'
   localStorage.mockMacroCount = '105'
   localStorage.mockSpacePaid = 'false'
   ```
3. Click Edit → verify paywall modal appears (not the editor)
4. Verify all modal elements present:
   - Editable message textarea (pre-filled pitch template, no `{placeholder}` tokens)
   - `Copy message` button
   - `Open in email` button
   - `Continue editing` button
   - × close button
   - Upgrade CTA links (marketplace, enterprise bundle)
5. Verify each dismissal path does NOT mount the editor:
   - Click × → modal closes, editor absent
   - Press Escape → modal closes, editor absent
   - Click backdrop → modal closes, editor absent
   - Click a CTA link → external URL opens, editor absent
6. Verify `Copy message` → clipboard receives rendered message (no remaining placeholders)
7. Verify `Open in email` → `mailto:` link has subject + body prefilled
8. Click Edit again → modal appears → click `Continue editing` → editor mounts
9. Verify Mixpanel events (last 1h, `client_domain = zenuml`):
   - `upgrade_modal_shown` count ≥ number of modal appearances
   - `paywall_continued_editing` count ≥ 1

### Pass/Fail Criteria

- **PASS**: All 9 steps complete without error
- **FAIL**: Report the specific step number and error; do not stop the release pipeline

## Updated Release Report Format

```
## Release Report: v{version}-{variant}
- Draft published: ✓
- Release workflow: ✓
- PVT (Mermaid smoke): PASS | FAIL
- Focused tests:
  - pvt-paywall: PASS | FAIL — <failing step if any>
  - pvt-editor: PASS | FAIL — <failing step if any>
  (omitted if no focused tests matched)
```

## Files to Create/Modify

| File | Action |
|---|---|
| `.claude/skills/release-app/SKILL.md` | Add Step 5.5 with keyword registry |
| `.claude/skills/pvt-paywall/SKILL.md` | New sub-skill with full test procedure |

## Extensibility

To add a new focused test for a future feature:
1. Create `.claude/skills/pvt-<feature>/SKILL.md` with the test procedure
2. Add a row to the keyword registry table in release-app's Step 5.5

No changes to the release pipeline itself are required.
