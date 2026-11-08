# PR 1089, CI-deployed Lite staging, head c1765254

Deployed as PR merge commit `ecf51a5c`. Pages project `conf-stg-lite`, source `ecf51a5`; macro dev bar shows `ecf51a5c8a31...@ecf51a5`.
Site: lite-stg. Identity: robot test account (non-admin). Viewport 1280x577. All page titles are invented.

| Assertion | Result | Signal |
|---|---|---|
| Build is the candidate | PASS | Pages source, macro dev bar |
| First view queues, no flag | PASS | D1 `pending`, no flag after reload |
| Entry flag copy | PASS | Snapshot, v5-1-entry-flag.png |
| Preview copy and note beside Add | PASS | Snapshot, v5-2-panel.png |
| Add inserts first node, property `added` | PASS | REST `['extension','paragraph']`, version 2, v5-3-added.png |
| Edit diagram opens the same diagram | PASS | edit-diagram.png |
| Undo removes macro and property | PASS | REST `['paragraph']`, version 3, no property, undo.png |
| Not now copy | PASS | Snapshot, v5-4-not-now.png |
| Not now flag auto-dismisses | PASS | Pointer away: present at t+8 s, gone at t+9 s |
| Not now, no re-offer | PASS | `notNow` kept, cap and lookup keys cleared, two reloads, no flag |
| Page with macro and `added` offers nothing | PASS | Three loads, no flag; the next page offered, so the cap was free. macro-page-no-flag.png |
| Arrival by quick find from SD to a personal space | PASS | Flag and preview for the new page, spa-arrival-flag.png |

Test-only step: local `titleDraft:*` keys were removed between cases. So the live 24 h cap was not exercised.
With the pointer resting on the Not now flag, the flag was still present at 11.5 s. Moving the pointer away was the only change before the 9 s result.
