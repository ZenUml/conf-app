# Retrospective Delta — 2026-05-27
## Files processed: 20 (newest 20 by recency, sessions 2026-05-25 to 2026-05-27)

---

## New Corrections Found

### 1. Mid-task approach pivot without reporting
**Session**: b0dbc0bd | **Category**: correction  
AI was building an attachment PNG-embedding feature. When encountering difficulty, it rewrote `attachmentRecovery.ts` to use content property instead of PNG binary — the opposite of the stated goal. User had to interrupt ("what are you doing?!") and explicitly revert.  
**Rule**: When an obstacle makes the original approach difficult, report it. Never silently switch approach.

### 2. DrawIO product disambiguation
**Session**: 852a3bfe | **Category**: correction  
AI confused "DrawIO for Confluence" (third-party plugin) with our own DrawIO Graph macro. Correction: "I am not talking about our drawio macro. I am talking about the drawio for confluence plugin."  
**Rule**: Always clarify which DrawIO product is being discussed.

### 3. CLI test ≠ app test
**Session**: b0dbc0bd | **Category**: correction  
AI claimed something was verified after testing with curl, without testing in the actual app context. User: "not just curl, after testing with curl, test in the app's context."  
Also: when claiming X doesn't happen, provide HTTP request inspection evidence + confirmation test.

### 4. Client docs location
**Session**: 852a3bfe | **Category**: correction  
AI put investigation/client docs in the main docs site. Correct location: `private/client-profiles/` in the private submodule. User: "that is not the dev site. I mean the site in the private submodule."

---

## New Design Preferences Found

### 5. Error states must be context-aware
**Session**: 852a3bfe, 3831433b, 9d2a7e1a | **Category**: design_preference  
- Don't show "Retry" when the cause is permissions — it misleads the user
- "Orphan" is alarming jargon for what is often just a permission issue — avoid it in UI copy
- When rendering fails, tell the user what happened in the Viewer; don't throw silently during upload
- Identify the failure tier (permissions / data loss / code bug) and surface different messages

### 6. Floating bars must not obscure action buttons
**Session**: 9d2a7e1a | **Category**: design_preference  
The floating bottom-pill toolbar was hiding the "Retry" button. Any floating UI element must be tested against action buttons in degraded/error states.

### 7. DrawIO has version history capability worth surfacing
**Session**: 852a3bfe | **Category**: design_preference (positive)  
DrawIO's attachment API supports versions. "We kind of get the version capability for free." Worth considering for a recovery UI.

---

## New Process Feedback Found

### 8. Test user's initial hypothesis first
**Session**: ffff50ce | **Category**: process_feedback  
User's final finding in a long investigation matched their opening hypothesis exactly. User: "你绕了这么大圈" ("You took such a roundabout path"). When user provides initial hypothesis, verify it before doing broader exploration.

### 9. Skills > memory rules for preventing mistakes
**Session**: ffff50ce, 87e5a4ac | **Category**: process_feedback  
When post-morteming a mistake, user asks "what skill would have prevented this?" not "what memory entry?" Skills encode executable workflows; memory encodes facts. Prefer the former for behavioral correction.  
Also: too many rules/memory entries can become confusing — periodic pruning is needed.

### 10. Skill creation: skip the plan
**Session**: 8a1f8271 | **Category**: process_feedback  
User: "just use /skill-creator:skill-creator to write the skill skip writing a plan!" The skill creator workflow is self-contained.

---

## Positive Confirmations

### 11. Rendering bugs don't need Confluence deploy
**Session**: 87e5a4ac | **Category**: positive_confirmation  
User confirmed: for rendering bugs (e.g., DrawIO version), reproducing locally or upgrading the library version is sufficient. "This is a rendering issue. So no need to deploy to confluence for reproduction and validation." No Confluence instance required.

---

## Memory Entries Added: 8
1. Test user's hypothesis first
2. Never pivot approach mid-task
3. Error states context-aware + never fail silently
4. DrawIO product disambiguation
5. CLI test ≠ app test
6. Client docs → private/client-profiles/
7. Skills > memory rules for behavioral correction; periodic pruning needed
8. Skill creation: use /skill-creator directly, skip planning

## Working-Principles Changes: 4 sections updated
- Investigation Rules: +2 rules (hypothesis first, CLI≠app)
- Execution Style: +2 rules (no mid-task pivot, skill-creator shortcut)
- UX Principles: +3 rules (error state awareness, floating bar obscuring, DrawIO disambiguation)
- Key Links: +client docs location, +this delta doc

## Next Iteration
Run `/retrospective --limit 20` to process files 21–40 (checkpoint will skip the 20 already processed).
