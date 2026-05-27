# Retrospective Delta — 2026-05-27 (Iteration 2)
## Files processed: 20 (files 21–40 by recency, sessions 2026-05-20 to 2026-05-25)

---

## New Corrections Found

### 1. Don't over-plan clear, bounded tasks
**Session**: multiple | **Category**: correction  
AI kept proposing explicit implementation plans before acting on clear, bounded requests. User: "Why do you always insist on writing a plan? Didn't I ask you to create a PR?"  
**Rule**: "Fix this bug" or "create a PR" = just do it. Reserve explicit planning for genuinely ambiguous or large multi-stage work.

### 2. Check git history before re-adding removed code
**Session**: multiple | **Category**: correction  
AI re-added a removed fallback without investigating why it was removed. User: "The fallback is removed for a reason, you should not just add it back."  
**Rule**: Before re-adding removed code, run `git log -S <symbol>` to understand the removal reason. Intentional deletions have reasons; re-adding blindly risks reintroducing the original problem.

### 3. Reproduce the EXACT symptom described
**Session**: multiple | **Category**: correction  
AI reproduced a different failure mode than the one reported. User: "The issue I asked you to reproduce isn't that it can't update the macro config; it's that it can't load the graph macro."  
**Rule**: Match the customer/user's described behavior precisely — not a related but different failure mode.

---

## New Design Preferences Found

### 4. Release read-only fix first as a safer scope split
**Session**: multiple | **Category**: design_preference  
When a fix spans both read (view/recovery) and write (save/edit) paths, user prefers releasing the safer read-only part first in a separate PR.  
**Rule**: When a fix spans both read and write paths, consider releasing the safer read-only part separately first.

### 5. Prefer unified code paths over branching duplicates
**Session**: multiple | **Category**: design_preference  
User flagged a pattern where different branches did the same thing differently. Preference: a single helper / single fetch over branching code with identical behavior.  
**Rule**: A single helper → single fetch beats branching code that does the same thing differently in each branch.

---

## New Domain Facts Found

### 6. "Dev site" ≠ "dev server"
**Session**: multiple | **Category**: correction  
AI put documentation on the wrong target. "Dev site" = documentation in `private/` submodule. "Dev server" = local running app (`pnpm start:local`). These are completely different things.

### 7. View mode: can mutate Custom Content, cannot mutate macro config
**Session**: multiple | **Category**: correction  
AI attempted to mutate macro config from view mode. View mode CAN mutate Custom Content (via `invokeRemote`). It CANNOT mutate macro config (macroParams / customContentId pointer) — that requires page edit mode + macro editor `submit()`.

---

## Memory Entries Added: 6
1. Don't over-plan clear tasks (correction)
2. Check git history before re-adding removed code (correction)
3. Reproduce exact symptom described (correction)
4. Dev site vs dev server disambiguation (domain fact)
5. View mode CC / macro config mutation constraints (domain fact)
6. Release read-only fix first (design preference)

## Working-Principles Changes: 3 sections updated
- Execution Style: +3 rules (don't over-plan, check git history before re-adding, reproduce exact symptom, stay on problem)
- UX/Product Design Principles: +2 rules (release read-only fix first, prefer unified code paths)
- Domain Facts: new section added (+dev site/server, +view mode constraints, +archive repo)

## Next Iteration
Run `/retrospective` (no `--limit`) to process files 41–77 (checkpoint auto-skips already-processed files).
