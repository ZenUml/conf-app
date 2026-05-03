---
name: three-agent-harness
description: Autonomous feature development using a Planner-Generator-Evaluator architecture inspired by GANs. Use when the user says "harness", "three-agent", "build feature autonomously", "plan-build-test loop", or wants a complete feature implemented end-to-end with AI-driven QA. Takes a brief prompt and delivers a tested, working feature through iterative sprints.
---

# Three-Agent Harness

Autonomous feature development through three specialized agents with clean context handoffs.
Based on Anthropic's [harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps).

## Architecture

```
User prompt (1-4 sentences)
        |
   [Planner Agent]  ──→  .harness/spec.md
        |
   [Generator Agent]  ←──→  [Evaluator Agent]
        |                        |
   implements code          local tests → validate-branch
        |                   → submit-branch → babysit-pr
        └──── sprint loop ───────┘
                    |
              .harness/qa-report.md
                    |
               Done or retry (max 3 rounds)
```

### Why three agents, not one

1. **Context window deterioration** — long-running agents lose coherence. Context resets with structured handoffs fix this.
2. **Self-evaluation bias** — agents praise their own work. A separate evaluator with fresh context judges honestly.

## Prerequisites

- Dev server must be running (`pnpm start:local` or `pnpm start:sit`) OR skill will start it
- Playwright installed (`cd tests/e2e-tests && pnpm install`)

## Step 0: Initialize harness state

Create the `.harness/` directory in the project root for inter-agent communication:

```bash
mkdir -p .harness
```

Write `.harness/README.md`:
```markdown
# Harness State

Temporary working directory for three-agent harness runs.
Do NOT commit this directory — it is gitignored.
```

Add `.harness/` to `.gitignore` if not already there.

## Step 1: Planner Agent

Spawn a **background** Agent (subagent_type: `general-purpose`) with this mission:

> You are the **Planner Agent** in a three-agent harness for the conf-app project (ZenUML Confluence Cloud Add-on).
>
> **Your input**: The user's feature request (provided below).
>
> **Your job**: Expand this into a comprehensive product specification. Be ambitious about scope while staying focused on product context and high-level technical design — NOT detailed implementation.
>
> **Project context**: Vue 3 + TypeScript frontend, Cloudflare Workers + D1 backend, Confluence Cloud add-on. Supports sequence diagrams (ZenUML/Mermaid), graph diagrams (DrawIO), and OpenAPI specs. Read CLAUDE.md for architecture details.
>
> **Output**: Write the spec to `.harness/spec.md` with these sections:
> 1. **Goal** — what we're building and why (user value)
> 2. **User Stories** — 3-7 user stories with acceptance criteria
> 3. **Scope** — what's in, what's explicitly out
> 4. **Technical Approach** — high-level design (components, data flow, APIs), NOT line-by-line implementation
> 5. **Success Criteria** — observable, testable outcomes the Evaluator can verify
> 6. **Risks & Open Questions** — things that might go wrong or need clarification
>
> Study the existing codebase first. Read CLAUDE.md, look at similar features, understand the patterns. Your spec should feel like it belongs in this project.
>
> User's request: {USER_PROMPT}

Wait for the Planner to complete. Read `.harness/spec.md` and present a summary to the user. **Ask for approval before proceeding** — the user may want to adjust scope.

## Step 2: Sprint Contract Negotiation

Before the Generator starts coding, establish what "done" means for each sprint.

Write `.harness/contract.md` by analyzing the spec:

```markdown
# Sprint Contract

## Sprint 1: [Name]
### Deliverables
- [ ] [Specific, testable deliverable]
- [ ] [Another deliverable]

### Evaluation Criteria
| Criterion | Threshold | How to test |
|-----------|-----------|-------------|
| [e.g. Functionality] | All user stories pass | Playwright clicks through each flow |
| [e.g. Code Quality] | Lint + unit tests pass | `pnpm lint && pnpm test:unit` |
| [e.g. UI/UX] | Components render correctly | Visual verification in browser |
| [e.g. CI Pipeline] | GitHub Actions green | `/validate-branch` + `/submit-branch` + `/babysit-pr` |

### Hard Fail Conditions
- Any criterion below threshold fails the entire sprint
- Generator receives detailed feedback and retries
```

For smaller features, use a single sprint. For larger ones, break into 2-3 sprints max.

## Step 3: Generator Agent (per sprint)

Spawn an Agent (subagent_type: `general-purpose`) for each sprint:

> You are the **Generator Agent** in a three-agent harness for the conf-app project.
>
> **Your input**: Read `.harness/spec.md` for the full specification and `.harness/contract.md` for your sprint deliverables.
>
> {IF_RETRY: Also read `.harness/qa-report.md` for feedback from the previous QA round. Fix ALL issues identified — including any CI failures. Do NOT dismiss or minimize any finding.}
>
> **Your job**: Implement the sprint deliverables. Follow these rules:
> 1. Read CLAUDE.md and follow all project conventions
> 2. Study 3 similar features in the codebase before writing code
> 3. Write tests alongside implementation (unit tests with Vitest)
> 4. Commit working code incrementally with clear messages
> 5. Run `pnpm lint` and `pnpm test:unit` before declaring done
> 6. Self-evaluate: before finishing, honestly assess — does this actually work? Don't hand off known broken code.
>
> **Output**: When done, write `.harness/generator-status.md`:
> ```markdown
> # Generator Status — Sprint N
> ## What was built
> - [list of changes with file paths]
> ## Self-assessment
> - [honest evaluation of what works, what's rough]
> ## Known issues
> - [anything the evaluator should pay attention to]
> ## How to test
> - [steps to verify the feature manually]
> ```
>
> Sprint: {SPRINT_NUMBER}
> Spec: Read from .harness/spec.md
> Contract: Read from .harness/contract.md

Wait for the Generator to complete. Verify that lint and unit tests pass. If they don't, send the Generator a follow-up message to fix before proceeding to evaluation.

## Step 4: Evaluator Agent

Spawn an Agent (subagent_type: `general-purpose`) with fresh context:

> You are the **Evaluator Agent** in a three-agent harness for the conf-app project.
>
> **Your role**: You are QA. You are skeptical. You do NOT give the benefit of the doubt. If something is broken, say so clearly.
>
> **Your input**:
> - `.harness/spec.md` — the specification
> - `.harness/contract.md` — the evaluation criteria and thresholds
> - `.harness/generator-status.md` — what the generator claims to have built
>
> **Your job — two phases**:
>
> ### Phase 1: Local Validation + Code Review
>
> 1. **Code review**: Read the changed files (`git diff main...HEAD`). Check for:
>    - Security issues (XSS, injection, exposed secrets)
>    - Missing error handling at system boundaries
>    - Violations of project conventions (read CLAUDE.md)
>    - Dead code or unnecessary complexity
> 2. **Functional testing**: If a dev server is running, use browser automation to verify:
>    - Each user story from the spec can be completed
>    - Edge cases (empty states, error states, loading states)
>    - No console errors during normal flows
> 3. **Grade each criterion** from the contract against its threshold
>
> If Phase 1 finds critical issues, **write the QA report and STOP** — do not proceed to Phase 2. The generator needs to fix local issues before wasting CI time.
>
> ### Phase 2: CI Pipeline Verification
>
> Only proceed here if Phase 1 passes.
>
> 1. **Run `/validate-branch`** — local lint, unit tests, build. If it fails, add failures to the QA report.
> 2. **Run `/submit-branch`** — push and create/update PR. If it fails (dirty worktree, push conflict), add to report.
> 3. **Run `/babysit-pr`** — monitor GitHub Actions CI. This runs staging deploy + E2E tests against live Confluence instances.
>    - If CI passes: Phase 2 passes.
>    - If CI fails and the failure is **in our code** (lint, unit test, build, E2E test logic): attempt to fix it directly (up to 2 attempts). If fixed, re-push and re-run CI.
>    - If CI fails and the failure is **infrastructure/flaky** (timeout, network, Confluence instance down): note it in the report as `FLAKY — not our fault` and pass Phase 2 conditionally.
>    - If CI fails and you **cannot fix it** after 2 attempts: add the failure details to the QA report as a critical issue for the Generator to address in the next round.
>
> **Output**: Write `.harness/qa-report.md`:
> ```markdown
> # QA Report — Sprint N, Round R
>
> ## Verdict: PASS | FAIL
>
> ## Phase 1: Local Validation
> | Check | Result | Notes |
> |-------|--------|-------|
> | Code Review | PASS/FAIL | [details] |
> | Lint | PASS/FAIL | [details] |
> | Unit Tests | PASS/FAIL | [details] |
> | Build | PASS/FAIL | [details] |
> | Functional Test | PASS/FAIL | [details] |
>
> ## Phase 2: CI Pipeline
> | Check | Result | Notes |
> |-------|--------|-------|
> | /validate-branch | PASS/FAIL | [details] |
> | /submit-branch | PASS/FAIL | [PR URL] |
> | /babysit-pr | PASS/FAIL/FLAKY | [details] |
>
> ## Criteria Grades
> | Criterion | Grade | Threshold | Status |
> |-----------|-------|-----------|--------|
> | [name] | [score] | [threshold] | PASS/FAIL |
>
> ## Issues Found
> ### Critical (must fix)
> - [issue with file:line reference and clear description]
>
> ### CI Failures (for Generator)
> - [GitHub Actions failure details, logs, and what needs fixing]
>
> ### Important (should fix)
> - [issue]
>
> ### Minor (nice to have)
> - [issue]
>
> ## What Worked Well
> - [positive observations]
> ```
>
> **IMPORTANT**: Do NOT talk yourself into passing broken work. If you identify a legitimate issue, it IS a big deal. Grade honestly. The generator can handle criticism — that's how it improves.

Read the QA report. If verdict is **FAIL**:

- If this is round 1 or 2: loop back to **Step 3** (Generator), passing the QA report as retry feedback
- If this is round 3: **STOP**. Present the QA report to the user and explain what's still broken. The user decides next steps.

If verdict is **PASS**: proceed to Step 5.

## Step 5: Wrap Up

After all sprints pass evaluation (including CI green):

1. Present a summary to the user:
   - What was built (features, files changed)
   - QA results (how many rounds, what was caught and fixed)
   - CI status and PR link
   - Any remaining caveats or manual testing needed

2. The PR is already created and CI is green from the Evaluator's work. Ask the user if they want to:
   - **Land it** — invoke `/land-pr` to merge
   - **Review first** — they review the PR themselves
   - **Iterate more** — add additional requirements (new harness run)

3. Clean up `.harness/` directory (or leave for reference if user prefers)

## Harness Configuration

Adapt the harness to the task size:

| Task Size | Sprints | Max QA Rounds | Planner Depth |
|-----------|---------|---------------|---------------|
| Small (bug fix, tweak) | 1 | 2 | Brief — 1 page spec |
| Medium (new feature) | 1-2 | 3 | Standard — full spec |
| Large (major feature) | 2-3 | 3 per sprint | Detailed — multi-page spec |

## Key Principles

1. **Context resets are features, not bugs** — each agent gets a clean context window with only the state files it needs. This prevents coherence degradation.
2. **File-based handoffs** — all communication between agents goes through `.harness/` files. This makes state inspectable and debuggable.
3. **Hard thresholds** — if any criterion falls below its threshold, the sprint fails. No negotiation.
4. **Evaluator independence** — the evaluator never sees the generator's reasoning, only its output. This prevents sympathy bias.
5. **CI is part of "done"** — local tests passing is necessary but not sufficient. The feature isn't done until GitHub Actions are green.
6. **Evaluator fixes or escalates** — when CI fails, the evaluator tries to fix infrastructure-level issues itself. Only code-level failures that require rethinking go back to the generator.
7. **Stress-test assumptions** — every harness component encodes an assumption about what the model can't do alone. Periodically question whether each component is still load-bearing.
