---
name: pr-review-support-materials
description: Prepare or refresh the reviewer-facing evidence at the top of a PR. Use when creating/updating a PR, reporting validation, marking it ready, or when the user asks for PR Review Support Material, before/after evidence, or review screenshots. Complements validate-branch; does not replace its checks or authorize merging.
---

# PR review support materials

Make the change reviewable without access to the agent's machine or chat. Put a `## PR review support materials` section **first in the PR description**, above the implementation summary. A list of commands that passed or a local screenshot directory is not sufficient.

## 1. Pin the comparison and plan the evidence

Read the current PR body, base/head SHAs, diff, issue/design, and repository instructions. Preserve useful existing material and other authors' sections. Record the exact BEFORE baseline (normally merge-base with the PR base) and AFTER commit. For a stacked PR, use its actual base, not main by assumption. If there is no net diff, say so rather than inventing a comparison.

Before validation, identify the user-visible behavior and the same reproducible steps/input to exercise before and after. Keep fixture data, viewport, browser, and timing comparable. Use isolated worktrees; never overwrite a user's working files to obtain a baseline.

## 2. Gather evidence appropriate to the change

- **Visible UI change:** actual BEFORE and AFTER screenshots, inline side by side, for each materially changed screen or step. Name the screen, input, action, and expected difference. Show relevant empty/error/loading states and permission behavior when affected. Capture the full changed region, including the pager; inspect images for clipping and readability. A Figma mockup is design context, not implementation evidence.
- **Behavioral/backend change:** same request, payload, command, or regression test against both versions; show actual outputs or failures and link raw results. New tests failing on the baseline and passing on the candidate are useful when they demonstrate the claimed behavior. Do not demand that a cosmetic change make old tests fail.
- **Refactor/no visible change:** demonstrate the relevant behavior is preserved with a comparable probe or existing tests. Explain why screenshots add no evidence.
- **Docs/skill-only change:** quote the meaningful before/after instruction and perform appropriate structural/link checks. Label runtime tests N/A. If execution of the revised skill has not been observed, say so.

Run the applicable validation workflow; for Confluence UI the order remains Storybook → Forge Tunnel → CI-deployed Staging. This skill never bypasses a blocked stage. Distinguish unit/component tests, integration checks, Storybook browser interactions, CI E2E, and manual live UI verification. State the tested variant, data source (fixture or live), commands, outcomes/counts, and limitations. Separate your observed evidence from inherited claims.

## 3. Publish evidence reviewers can open

Use the repository's evidence convention: `pr-evidence/pr-<number>` branch (examples: #951 and #816), or an existing durable artifact destination. Reuse an existing evidence branch without force-pushing; keep screenshots/logs off the product branch unless this repository already requires otherwise. Pin links to the evidence commit SHA so later uploads do not silently replace proof.

Include a small README with baseline/candidate SHAs, capture steps, environment/viewport, fixtures, observed results, and limitations. Include reproducible capture/probe scripts and relevant logs where useful. Inspect all content before uploading to this public repository: use fictional fixture data; omit customer identifiers, private screenshots, credentials, tokens, and unrelated logs.

Use GitHub-renderable image URLs for inline screenshots and ordinary links for raw logs/README. Local paths, localhost URLs, and chat-only attachments may supplement evidence but cannot be the only reviewer access. Read back the PR and verify every evidence link resolves and images are actually viewable. If publication is unavailable, state that explicitly; do not call the materials complete.

## 4. Summarize checks and limits at the top of the PR

Use this compact outline, adapting detail to the change:

```markdown
## PR review support materials

BEFORE: <baseline SHA>. AFTER: <tested SHA>. <UI source, fixture/live, viewport or probe setup>.

| Screen / scenario | BEFORE | AFTER |
|---|---|---|
| <same steps> | <inline screenshot or observed result> | <inline screenshot or observed result> |

<What the comparison proves, and what it does not.>

| Validation | Result | Evidence |
|---|---|---|
| Unit/component | <counts, command, SHA> | <log> |
| Storybook / integration | <actual observed result or N/A> | <capture/probe> |
| CI E2E | <status and exact tested SHA> | <run/job link> |

Not verified / blocked: <specific stages, reason, what is needed to finish>.
Evidence bundle: <immutable README link>.

---
<existing implementation summary>
```

Fetch CI results for the current head; link the authoritative run and relevant jobs. Never promote an old green run to the new head, confuse cancelled duplicate runs with failures, or call CI E2E proof of a manual UI check. Do not label pending, blocked, or skipped work PASS.

## 5. Refresh on updates

When code changes, rerun affected checks and replace stale comparisons; retain explicit tested SHAs. For docs-only commits after tested code, state that runtime code is unchanged and preserve the original evidence SHA rather than pretending it was retested. Update the PR in place, avoiding duplicate support sections. Verify the published body, links, and current check status before reporting completion.

This is an evidence-packaging workflow, not a new approval gate. Continue authorized work without asking for permission again. Do not merge, deploy, or send customer messages merely to complete this section.

## Provenance

Existing repository examples: [#951](https://github.com/ZenUml/conf-app/pull/951) (UI screenshots/timing), [#816](https://github.com/ZenUml/conf-app/pull/816) (backend payload and tests), [#866](https://github.com/ZenUml/conf-app/pull/866) (unchanged behavior), [#1012](https://github.com/ZenUml/conf-app/pull/1012) (skill-only wording). These demonstrate the format; their validation results never apply to another PR.
