---
name: refactoring
description: Deletion-focused unification principles for consolidating duplicated code paths into one shared implementation — what to optimize for, how to slice delivery, and the countable acceptance ledger. Use when planning, designing, executing, or reviewing a consolidation/unification refactor, when decomposing one into slices or PRs, and when writing subagent prompts for any refactoring task (carry the Principles section verbatim into those prompts).
---

# Deletion-Focused Unification Refactoring

Not general refactoring advice. These are the standing rules for
consolidation/unification work in this repo, distilled from the
content-opening unification design (2026-07-31) and the rejection of PR #423.

## Principles

Carry this section **verbatim** into every subagent prompt for refactoring
work:

- Consistency and structural simplicity are the primary goals.
- When current code paths behave differently, choose one reasonable rule
  instead of preserving every historical variation with hooks and adapters.
- Small user-visible changes are acceptable if they result naturally from that
  simplification.
- Do not add states, fallbacks, telemetry, recovery UI, or other code merely
  to make behavior "better".
- Preserve only hard requirements such as data integrity,
  authorization/paywall enforcement, and essential content compatibility.
- Success means fewer concepts, fewer branches, and preferably less production
  code — not perfect behavioral equivalence.

## Delivery rules

- **Vertical slices only.** Every PR migrates a real production path AND
  deletes that path's old implementation in the same PR. No framework-only or
  foundation-first PRs. Encoding differences through lifecycle/adapter/hook
  infrastructure instead of eliminating them is the failure mode (PR #423:
  net +852 production LOC, closed for exactly this).
- **Evolve the existing shared module** into the unified one; do not found a
  new abstraction beside it. If a partial consolidation already exists, it is
  the successor's seed, not a competitor to delete around.
- **Differences may live in exactly three places:** a small policy enum
  (e.g. read vs write), a per-family declarative spec, or the presenter.
  A family/type branch inside the shared code means the design failed —
  fix the design, don't add an `if`.
- **Replace shared-mutable-state coupling with a typed hand-off value**
  (e.g. a load→save `origin` contract). If two "independent" slices
  communicate through module state, they are one slice.
- **Verify before designing.** Every factual claim about the current code gets
  file:line evidence against current `main` — not a stale branch checkout.
  Check for concurrent worktrees and already-adopted design docs touching the
  same files before committing to a direction.

## Acceptance: the countable ledger

Net production LOC may be modestly positive only when a before/after ledger of
countable structure shrinks — number of implementations of the concept,
number of variants of the same decision, copies of each rule, whole files
deleted. If no ledger row shrinks, the refactor didn't happen; LOC alone is
neither proof nor disproof.
