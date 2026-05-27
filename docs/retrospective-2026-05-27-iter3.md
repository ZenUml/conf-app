# Retrospective Delta — 2026-05-27 (Iteration 3)
## Files processed: 39 (files 41–77 by recency, sessions 2026-04-26 to 2026-05-27)

---

## New Corrections Found

### 1. Block user actions before they invest effort, not at save time
**Session**: 406e65c6 | **Category**: correction + design_preference  
User caught a proposed change that moved the `shouldBlockActions` check from editor-mount into `Persistence.ts:saveToPlatform`. "If we were going to block, we should block BEFORE they start editing." Blocking at save means the user already wrote the diagram — then loses it. That's hostile UX.  
**Rule**: Paywall/permission gates must fire at the pre-edit gate (editor mount). Never gate at save.

### 2. Edit existing external comments; don't add new ones
**Session**: 9981e786 | **Category**: correction  
After posting to an Atlassian ecosystem ticket, AI deleted and re-added comments multiple times. User: "edit old comments, don't add new comment. that confuse other people." and "you are repeatedly deleting and readding comments! add it in the main thread/agent."  
**Rule**: When responding to an external ticket (Atlassian, GitHub, etc.), update/edit the existing comment — never accumulate multiple new ones.

### 3. Trust CLI tools; investigate your own mistake when output is unexpected
**Session**: f11c3f44 | **Category**: correction  
AI assumed a wrangler command returned wrong output. User: "wrangler cli does not lie. You need to find the mistake you made and improve the skill."  
**Rule**: When wrangler, forge, gh, or any CLI returns unexpected output, the tool is the ground truth. Re-read the command, trace the logic, find the bug in your own code or invocation.

### 4. When a fix goes wrong, revert and apply TDD from scratch
**Session**: f1cfa9e2, 4733c58b | **Category**: correction  
User said "revert and redo with TDD" twice across two different sessions. The trigger in both cases: fix attempted without a reproducing test first.  
**Rule**: If a bug fix fails review or was implemented without a test, revert completely. Reproduce the failure on lite-dev with careful data setup → write lower-level test → fix. Don't patch the patch.

### 5. Skills that trigger CI must wait for job completion
**Session**: 0866843f | **Category**: correction  
Release-app skill triggered a release workflow then immediately proceeded to post-release steps. User: "you didn't wait for the release to finish even! fix the /release-app skill."  
**Rule**: After triggering a GitHub Actions workflow, poll `gh run list`/`gh run watch` until the run completes. Don't proceed while the job is in progress.

### 6. Don't mix recovery work with refactoring in the same task
**Session**: f1cfa9e2 | **Category**: correction  
User: "I don't want to mix the recovery work with refactoring of config paths. Update the site with all the knowledge we learned and create a /handoff to refactor the config read/write and remove dead code."  
**Rule**: When working on a customer bug recovery, log refactoring as a separate handoff/ticket. Don't combine in the same PR.

---

## New Design Preferences Found

### 7. Customer communications: brief, focused on what customer cares about
**Session**: 1a6c2a44 | **Category**: design_preference  
Support reply draft was too long. User: "Too long. Customer only cares about: 1. recoverable; 2. timeline (release this weekend); 3. workaround (image)." Also: "problem 1 (guest viewers getting 'Error loading') is not a problem that sophie knows or cares about" — errors the customer never saw don't belong in a support reply.  
**Rule**: Customer-facing messages = recovery status + timeline + workaround. Strip all internal debug framing.

---

## Memory Entries Added: 7
1. Block before editing, not at save time
2. Edit existing external comments, don't add new ones
3. Trust CLI tools; investigate own mistake on unexpected output
4. TDD discipline: revert → reproduce → test → fix
5. Customer communications: brief, recovery/timeline/workaround only
6. Skills triggering CI must wait for job completion
7. Don't mix recovery work with refactoring

## Working-Principles Changes: 2 sections updated
- Execution Style: +5 rules (don't mix recovery/refactor, revert-TDD, trust CLI, CI-wait, edit-not-add comments)
- UX/Product Design Principles: +2 rules (block before editing, customer comm brief)
- Reference: +iteration 3 doc link

## Retrospective Complete
All 77 files processed (iterations 1–3). Next run: `/retrospective` (no `--limit`) after new sessions accumulate.
