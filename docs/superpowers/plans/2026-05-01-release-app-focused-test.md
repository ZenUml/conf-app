# Release App — Focused Feature Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Step 5.5 to the `release-app` skill that auto-detects changed features from git commit messages and invokes a matching feature-specific PVT sub-skill, starting with `pvt-paywall` for paywall changes.

**Architecture:** Two skill files are modified/created. `release-app` gains a keyword registry and Step 5.5 logic. A new `pvt-paywall` sub-skill contains the full browser automation test procedure for the paywall modal. No code changes — skills only.

**Tech Stack:** Skill markdown files, GitHub CLI (`gh`), Mixpanel MCP, claude-in-chrome browser automation (Playwright for Forge iframes per CLAUDE.md)

---

## Files

| File | Action | Responsibility |
|---|---|---|
| `.claude/skills/release-app/SKILL.md` | Modify | Add Step 5.5 keyword detection + invocation; update Step 6 report format; add focused-test error handling entry |
| `.claude/skills/pvt-paywall/SKILL.md` | Create | Full browser test procedure for the paywall modal: all elements, all dismissal paths, Mixpanel event verification |

---

### Task 1: Add Step 5.5 to release-app skill

**Files:**
- Modify: `.claude/skills/release-app/SKILL.md`

- [ ] **Step 1: Insert Step 5.5 between Step 5 (PVT) and Step 6 (Report)**

  In `.claude/skills/release-app/SKILL.md`, find the line `### Step 6: Report` and insert the following block immediately before it:

  ```markdown
  ### Step 5.5: Focused Feature Test

  **This step runs automatically after PVT. Do not skip it.**

  1. Find the previous release tag for the variant being released:
     ```bash
     gh release list --repo ZenUml/confluence-plugin-cloud --exclude-drafts \
       --limit 10 | grep <variant> | awk 'NR==2 {print $3}'
     ```
     Example result: `v2026.04.301216-lite`

  2. Scan commit messages between the previous tag and the new tag:
     ```bash
     git log <prev-tag>..<new-tag> --oneline
     ```
     Example result:
     ```
     1ee2f655 chore(paywall-skill): move paywall skill from user-level to project
     8fd921ee feat(paywall): add pre-edit gate with explicit Continue editing button
     20574271 fix(paywall): emit upgrade_modal_shown for all prompt variants
     ```

  3. Match commit messages (case-insensitive) against the keyword registry:

     | Keywords | Sub-skill |
     |---|---|
     | `paywall`, `upgrade`, `css`, `persona`, `modal` | `/pvt-paywall` |
     | `editor`, `editor-ui`, `codemirror` | `/pvt-editor` |
     | `swagger`, `openapi` | `/pvt-swagger` |
     | `graph`, `drawio` | `/pvt-drawio` |

  4. For each matched sub-skill: invoke it with the variant as argument (e.g., `/pvt-paywall lite`). Deduplicate — each sub-skill runs at most once per release. Run sequentially.

  5. If no keywords match, log "No focused test registered for this release" and proceed to Step 6 — this is not an error.

  6. Collect pass/fail from each sub-skill and carry results forward to the Step 6 report.
  ```

- [ ] **Step 2: Update Step 6 report format to include focused test results**

  Replace the existing Step 6 content with:

  ```markdown
  ### Step 6: Report

  Summarize the release:

  ```
  ## Release Report: v{version}-{variant}
  - Draft published: ✓
  - Release workflow: ✓
  - PVT (Mermaid smoke): PASS | FAIL
  - Focused tests:
    - pvt-paywall: PASS | FAIL — <failing step if FAIL>
    - pvt-editor: PASS | FAIL — <failing step if FAIL>
    (line omitted if sub-skill was not invoked)
    (or: "No focused test registered for this release")
  ```
  ```

- [ ] **Step 3: Add focused test failure to the Error Handling section**

  In the `## Error Handling` section, add after the PVT entry:

  ```markdown
  - **Focused test fails**: Report which sub-skill failed and which step — this is a post-deploy issue. Do NOT roll back or block future releases. The app is already live; investigation is the next action.
  ```

- [ ] **Step 4: Review the full modified file for consistency**

  Read `.claude/skills/release-app/SKILL.md` end-to-end and confirm:
  - Step numbers are sequential: 1, 2a, 2b, 3, 4, 5, 5.5, 6
  - Step 6 report template matches the spec
  - Error handling section has three entries: build failure, release failure, PVT failure, focused test failure

- [ ] **Step 5: Commit**

  ```bash
  git add .claude/skills/release-app/SKILL.md
  git commit -m "feat(release-app): add Step 5.5 focused feature test with keyword registry"
  ```

---

### Task 2: Create pvt-paywall sub-skill

**Files:**
- Create: `.claude/skills/pvt-paywall/SKILL.md`

- [ ] **Step 1: Create the skill directory and file**

  Create `.claude/skills/pvt-paywall/SKILL.md` with the full content below. This skill tests the paywall modal on production using browser automation. Forge iframes require Playwright (per CLAUDE.md) — the steps use `mcp__playwright__*` tools or claude-in-chrome with the understanding that Forge iframe content may not be accessible from chrome tooling alone.

  ```markdown
  ---
  name: pvt-paywall
  description: >
    Focused production validation for the paywall modal. Tests all interactive elements,
    all dismissal paths, and Mixpanel event firing (upgrade_modal_shown, paywall_continued_editing).
    Invoked automatically by release-app Step 5.5 when paywall-related commits are detected.
    Triggers on "pvt-paywall", "test paywall", "validate paywall".
  ---

  # PVT — Paywall Modal

  Focused post-release validation for the paywall feature on `zenuml.atlassian.net` (production).

  ## Arguments

  Usage: `/pvt-paywall [lite] [full] [diagramly]`

  - If no variant specified, test lite (paywall is Lite-only).
  - Site: always production (`zenuml.atlassian.net`).

  ## Prerequisites

  - You must be logged into `zenuml.atlassian.net` in the browser.
  - A Confluence page with a ZenUML sequence diagram macro must exist on that site.
    Use the existing smoke-test page if one is available.
  - localStorage mocks simulate a saturated space — no real CSS flag change needed.

  ## Steps

  ### 1. Open production and navigate to a macro page

  Open `https://zenuml.atlassian.net` in the browser. Navigate to a Confluence page
  that contains a ZenUML sequence macro (the smoke test page works).

  ### 2. Set localStorage mocks to simulate a saturated space

  In the browser console (F12 → Console), run:

  ```js
  localStorage.setItem('mockCSSEnabled', 'true');
  localStorage.setItem('mockMacroCount', '105');
  localStorage.setItem('mockSpacePaid', 'false');
  ```

  Reload the page for the mocks to take effect.

  ### 3. Trigger the paywall — click Edit

  Click the Edit button on the ZenUML macro in the rendered Confluence page.

  **Expected:** The paywall modal appears. The ZenUML editor does NOT mount.

  **Fail if:** The editor mounts directly, or no modal appears.

  ### 4. Verify all modal elements are present

  Inspect the modal and confirm all of the following are visible:

  - Editable message textarea — pre-filled with the pitch template
  - The textarea contains NO unreplaced `{placeholder}` tokens (e.g., `{spaceName}`, `{n}`, `{stripeUrl}` must all be substituted)
  - `Copy message` button
  - `Open in email` button
  - `Continue editing` button
  - × (close) button
  - At least one upgrade CTA link (marketplace or enterprise bundle)

  **Fail if:** Any element is missing, or the textarea still contains `{placeholder}` tokens.

  ### 5. Verify each dismissal path does NOT grant edit access

  Test each of the following. After each, confirm the editor is not mounted (the Edit button is still visible, the editor iframe is absent). Reopen the modal between tests by clicking Edit again.

  | Action | Expected result |
  |---|---|
  | Click × button | Modal closes. Editor absent. |
  | Press Escape | Modal closes. Editor absent. |
  | Click modal backdrop | Modal closes. Editor absent. |
  | Click a CTA upgrade link | External URL opens (new tab). Editor absent on original page. |

  **Fail if:** Editor mounts after any of these dismissal actions.

  ### 6. Verify Copy message button

  Click `Copy message`. Then open the browser console and run:

  ```js
  navigator.clipboard.readText().then(t => console.log('CLIPBOARD:', t));
  ```

  **Expected:** The clipboard contains the full rendered pitch message with no `{placeholder}` tokens remaining.

  **Fail if:** Clipboard is empty, or message contains unreplaced tokens.

  ### 7. Verify Open in email button

  Inspect the `Open in email` button's href attribute (right-click → Inspect). It should be a `mailto:` link.

  **Expected:** `href` starts with `mailto:` and the URL-decoded body contains the pitch message text and a Stripe URL.

  **Fail if:** href is absent, not a mailto link, or body is empty.

  ### 8. Verify Continue editing grants access

  Click Edit again to reopen the modal. Click `Continue editing`.

  **Expected:** Modal closes. ZenUML editor mounts inside the Forge iframe.

  **Fail if:** Modal stays open, or editor does not appear within 10 seconds.

  ### 9. Verify Mixpanel events

  After completing steps 3–8, query Mixpanel for the last 1 hour filtered to `client_domain = zenuml`:

  Use `mcp__mixpanel__Run-Query` with project_id=3373228, last 1 hour, chartType=bar:

  **Query A — upgrade_modal_shown count:**
  ```
  event: upgrade_modal_shown
  filter: client_domain equals "zenuml"
  measurement: total
  ```
  **Expected:** count ≥ number of times modal was opened in steps 3–8 (minimum 5 appearances).

  **Query B — paywall_continued_editing count:**
  ```
  event: paywall_continued_editing
  filter: client_domain equals "zenuml"
  measurement: total
  ```
  **Expected:** count ≥ 1 (from step 8).

  **Fail if:** Either event count is 0.

  ### 10. Clean up localStorage mocks

  In the browser console, remove the test mocks:

  ```js
  localStorage.removeItem('mockCSSEnabled');
  localStorage.removeItem('mockMacroCount');
  localStorage.removeItem('mockSpacePaid');
  ```

  Reload the page to confirm the paywall no longer appears.

  ## Pass/Fail Report

  ```
  ## pvt-paywall: PASS | FAIL
  - Step 3 (modal appears on edit): PASS | FAIL
  - Step 4 (all elements present): PASS | FAIL
  - Step 5 (dismissals don't grant access): PASS | FAIL — <which action failed>
  - Step 6 (copy message): PASS | FAIL
  - Step 7 (open in email): PASS | FAIL
  - Step 8 (continue editing mounts editor): PASS | FAIL
  - Step 9 (Mixpanel events): PASS | FAIL — upgrade_modal_shown={n}, paywall_continued_editing={n}
  ```
  ```

- [ ] **Step 2: Verify the file is well-formed**

  Read `.claude/skills/pvt-paywall/SKILL.md` and confirm:
  - Frontmatter is valid YAML (name, description fields present)
  - All 10 steps are present with clear pass/fail criteria
  - No `{placeholder}` tokens in the skill text itself (those are in the user-facing message template example)
  - Mixpanel query uses project_id=3373228 and `client_domain = zenuml` filter
  - Step 10 cleanup is present (mocks removed after test)

- [ ] **Step 3: Commit**

  ```bash
  git add .claude/skills/pvt-paywall/SKILL.md
  git commit -m "feat(pvt-paywall): add paywall modal focused PVT sub-skill"
  ```

---

### Task 3: Smoke-run the integrated flow

This task verifies that the two skills work together correctly without running a full release.

- [ ] **Step 1: Simulate Step 5.5 keyword detection manually**

  Run the git log command for the most recent lite release to confirm keywords are detected:

  ```bash
  # Get the two most recent lite release tags
  gh release list --repo ZenUml/confluence-plugin-cloud --exclude-drafts \
    --limit 10 | grep lite | awk '{print $3}' | head -2

  # Expected output (example):
  # v2026.05.010231-lite
  # v2026.04.301216-lite

  # Then scan commit messages between them
  git log v2026.04.301216-lite..v2026.05.010231-lite --oneline
  ```

  Confirm the output contains commits with `paywall` in the message → `/pvt-paywall` should be matched.

- [ ] **Step 2: Verify pvt-paywall is discoverable as a skill**

  Confirm the skill file exists at the correct path and has valid frontmatter:

  ```bash
  head -8 .claude/skills/pvt-paywall/SKILL.md
  ```

  Expected output:
  ```
  ---
  name: pvt-paywall
  description: >
    Focused production validation for the paywall modal. Tests all interactive elements,
  ...
  ```

- [ ] **Step 3: Confirm release-app Step 5.5 is present in the skill**

  ```bash
  grep -n "Step 5.5" .claude/skills/release-app/SKILL.md
  grep -n "pvt-paywall" .claude/skills/release-app/SKILL.md
  ```

  Expected: at least 2 lines each — one for the step header and one in the keyword registry.

- [ ] **Step 4: Commit smoke-run notes (if any issues were found and fixed)**

  Only commit if changes were made during the smoke-run. Otherwise skip.

  ```bash
  git add .claude/skills/
  git commit -m "fix(pvt-paywall): smoke-run corrections"
  ```
