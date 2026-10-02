# Magic Default and Layout Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fullscreen Mermaid opens validated Magic by default, remembers each user's view choice locally, and lets readers explicitly compare Magic and Original layouts.

**Architecture:** The Confluence body remains the authority for Mermaid source and prepared SVG. A client helper keys localStorage only when Forge accountId, cloudId, content ID, and exact source hash exist; absent identity retains choice only in the current component. Optional layout feedback is keyed by SVG digest and rules version; analytics carries only the finite choice, never diagram content. Each new Fullscreen mount shows feedback unselected, even if an earlier choice exists in storage.

**Tech Stack:** Vue 3 Options API, TypeScript, Vitest, Storybook, Forge context.

**Spec:** Authorized request in the active task, 2026-10-02; existing artifact contract in `src/model/Diagram/Diagram.ts` and `src/utils/magic/artifact.ts`.

## Global Constraints

- Fullscreen only; ordinary viewer does not query D1.
- Auto-display only after exact raw Mermaid hash and sanitized validated SVG pass.
- No source, SVG, hash, or comment text in Mixpanel.
- Local preference key includes accountId, cloudId, content ID, and source hash; without reliable identity, use component-session state.
- Feedback is `magic`, `original`, or `no_preference`, generation-bound, and is sent only on an explicit vote. The displayed view never counts as a vote.
- No remote storage or deploy in this slice; do not touch Pi package.

---

### Task 1: Analytics contract

**Files:** `src/utils/analytics/catalog.ts`, `src/utils/analytics/types.ts`.

**Interfaces:** Add bounded `magic_activation`, `magic_preference`, `magic_preference_storage`, and `magic_layout_preference` properties. Register layout feedback prompt/submission/update and preference-change events. Existing view events gain activation context without content.

- [ ] Define events and properties, inspect for content-bearing values, and commit these two files first.

### Task 2: Local identity and generation keys

**Files:** Create `src/utils/magic/localPreference.ts` and `src/utils/magic/localPreference.spec.ts`.

**Interfaces:** `magicPreferenceKey({accountId,cloudId,contentId,sourceHash})` returns a key only for complete identity. Read/write catches storage errors. `magicGenerationKey(artifact)` derives a digest from rules version, generatedAt if present, and exact SVG bytes; feedback read/write uses identity plus generation.

- [ ] Test distinct account/installation/content/source/generation, missing identity, storage failure, and finite feedback values.
- [ ] Implement helper and run focused tests.

### Task 3: Fullscreen behavior and feedback

**Files:** `src/components/Viewer/GenericViewer.vue`, `src/components/Viewer/GenericViewer.spec.ts`.

**Interfaces:** Wait for Forge identity resolution, validate current artifact, restore an explicit local Original choice or display Magic. A segmented Magic/Original control persists choice only with complete identity. Explain `Same diagram, cleaner layout.` while Magic displays. Keep the optional `Which layout do you prefer?` three-choice vote in both views, initially unselected and independent of the displayed view.

- [ ] Test valid/missing/stale artifact, user separation, source/type races, toggle persistence, generation-bound feedback, no automatic vote, and content-free events.
- [ ] Implement and run focused viewer tests.

### Task 4: Visible acceptance

**Files:** `src/components/Viewer/GenericViewer.stories.ts` and existing synthetic fixture only if needed.

- [ ] Update synthetic Storybook checks for auto Magic, segmented Original, and optional feedback.
- [ ] Run a local Storybook browser, inspect actual fullscreen UI, capture a screenshot, and record any UI verification blocker honestly.
- [ ] Run relevant typecheck/tests and commit UI/test/story changes. Update the existing draft PR only after local review; do not merge or release.
