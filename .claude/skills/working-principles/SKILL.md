# Working Principles — conf-app

A checklist of hard-learned rules for working in this codebase. Invoke this skill when starting a non-trivial task or before submitting a branch.

## Before You Start

- [ ] Confirm current branch is correct for this task (`git branch --show-current`)
- [ ] If `git status` shows uncommitted changes you didn't make → **do not** reset/checkout; create a worktree instead
- [ ] Check if a skill already covers the use case before writing ad-hoc code

## Investigation Rules

**Never theorize without evidence.** For every claim:
- Code behavior → cite file + line number (or read the file first)
- Metrics anomaly → query per-client breakdown, not just totals
- Visual bug → replicate in controlled env (lite-dev) before diagnosing

```
Correct investigation order for visual bugs:
1. Fetch original Custom Content from customer page
2. Recreate macro on lite-dev with exact same data
3. Reproduce the visual → THEN diagnose
```

**Test the user's hypothesis first.** When the user states an initial hypothesis, verify it before broader exploration. The user often has good signal — going broad first wastes time and reaches the same conclusion via a longer path.

**CLI test ≠ app test.** After verifying something with curl or CLI scripts, always also test in the actual app context. Forge token auth, CORS, and iframe context differ from raw HTTP calls.

## Metrics Rules

| Metric | Use for | Do NOT use for |
|--------|---------|----------------|
| Mixpanel `macro_viewed` | Macro engagement | — |
| D1 `page_viewed` | Confluence page traffic | Macro usage (fires on ANY Confluence page) |
| D1 CustomContent | Data storage | Per-tenant attribution (JOIN on spaceId after 2026-04-23) |

Mixpanel data only exists from 2026-04-18. Always check earliest event date before computing rates.

## Deployment Discipline

| Target | How |
|--------|-----|
| development | `pnpm forge:deploy:dev` locally ✓ |
| staging | CI/CD only — push branch, let pipeline run |
| production | `release-app` skill + explicit user go-ahead |

Never restore the removed local-staging-deploy skill.

## Execution Style

- Complete the obvious next step without asking. Stop only when a decision requires the user.
- After a plan is approved → execute. No "shall I proceed?"
- When investigation surfaces a clear anomaly → run the next diagnostic in parallel, don't ask permission
- Never declare a spot check partial when you know how to complete it
- **Never pivot approach mid-task.** If you hit an obstacle that makes the original approach unworkable, report it and ask for direction — don't silently switch to a different approach. The user gave you a goal, not a suggestion.
- **For skill creation**: invoke `/skill-creator:skill-creator` directly. Skip writing a plan first.
- **Don't over-plan clear tasks.** "Fix this bug" or "create a PR" = just do it. Reserve explicit planning for genuinely ambiguous or large multi-stage work.
- **Before re-adding removed code**: check `git log -S <symbol>` to understand WHY it was removed. Intentional deletions have reasons; re-adding blindly risks reintroducing the original problem.
- **Reproduce the EXACT symptom.** Match the customer/user's described behavior precisely — not a related but different failure mode.
- **Stay on the current unsolved problem.** Once sub-problems are fixed, move forward. Don't revisit resolved items.
- **Validate on the customer's actual site** when implementing a fix for a customer-reported issue, not just a test site.
- **Don't mix recovery work with refactoring** in the same task or PR. Log the refactor as a separate handoff.
- **When a fix attempt goes wrong, revert and use TDD**: reproduce the failure on lite-dev with careful data setup → write lower-level test (integration or unit) → fix. Don't patch over a patch.
- **Trust CLI tools.** When wrangler, forge, or gh return unexpected output, investigate your own command/code — don't assume the tool is wrong.
- **Skills that trigger CI must wait for job completion** before proceeding. After `gh workflow run` or a release tag push, poll `gh run list` until done.
- **When responding to external tickets**, edit the existing comment — never add new ones. Accumulating multiple agent comments on one ticket confuses stakeholders.

## Extract Repeated Patterns into Skills

After performing the same multi-step sequence 3 times, extract it into a skill. Triggers:
- "do it for the other macros too"
- "run this for every variant"
- "now repeat for X"

## Git & PR Rules

- Always verify current branch before implementing
- Squash merge is NOT the default — use repo default or ask
- Codex review always needs explicit scope: `--base main`

## UX / Product Design Principles

When reviewing or implementing UI changes, check:

1. **Modal dismissal**: ESC + X + overlay click + explicit button must ALL work
2. **UI isolation**: Editor UI ≠ Viewer UI — no bleeding across contexts
3. **Recovery paths**: Any degraded state (migration fail, orphan content) needs user-accessible recovery
4. **Paywall tone**: Never pair celebration + immediate payment gate (hostile UX)
5. **Naming**: Use developer vocabulary. "Diagram as Code" > "Diagram (ZenUML, PlantUML & Mermaid)"
6. **Test level vocabulary**: PVT (1 macro, prod) ≠ Smoke test (full, CI) ≠ E2E regression
7. **Error states are context-aware**: Don't show "Retry" when the cause is permissions. Identify the failure tier (permissions / data loss / code bug) and message accordingly. Never fail silently — surface errors in the Viewer.
8. **Floating bars must not obscure action buttons**: If a pill/toolbar floats over the content area, verify it doesn't hide Retry, Edit, or other primary actions.
9. **DrawIO disambiguation**: "DrawIO for Confluence" (third-party plugin by //SEIBERT/MEDIA) ≠ our DrawIO Graph macro. Always clarify which when discussing DrawIO behavior.
10. **Release read-only fix first**: When a fix spans both read (view/recovery) and write (save/edit) paths, consider releasing the safer read-only part as a separate PR first.
11. **Prefer unified code paths**: A single helper → single fetch beats branching code that does the same thing differently in each branch.
12. **Block before editing, not at save time**: Restrictions (paywall, permissions) must fire at the pre-edit gate — before the user invests effort. Blocking at save/persist loses the user's work (hostile UX).
13. **Customer communications: brief, scoped to what customer cares about.** Recovery status + timeline + workaround. No internal debug framing, no errors the user never saw.

## Tenant Classification

| Tenant | Notes |
|--------|-------|
| moonactive | Full App paid — exclude from Lite/CSS/PAP analysis |
| zenuml, zenuml-connect | Internal sites — low viewer counts are expected |
| CSS/PAP flags | Lite-only — verify `isLite` before recommending |

## Domain Facts

- **"dev site"** = documentation in `private/` submodule. **"dev server"** = local running app (`pnpm start:local`). Different things.
- **View mode**: CAN mutate Custom Content (via invokeRemote). CANNOT mutate macro config (macroParams / customContentId pointer) — requires page edit mode + macro editor `submit()`.
- **Archive repo**: `archive/conf-app-private-hidden-do-not-use/` contains V1/Connect-era source. Check here when verifying historical behavior.

## Reference

- Client investigation docs → `private/client-profiles/` (private submodule), NOT `docs/`
- Retrospective: `docs/retrospective-execution-2026-05.md`
- Retrospective delta (iteration 1): `docs/retrospective-2026-05-27.md`
- Retrospective delta (iteration 2): `docs/retrospective-2026-05-27-iter2.md`
- Retrospective delta (iteration 3): `docs/retrospective-2026-05-27-iter3.md`
- Design philosophy memory: `~/.claude/…/memory/user_design_philosophy.md`
- Analytics reference: `docs/analytics-reference.md`
- Pricing model: `docs/pricing-model.yml`
