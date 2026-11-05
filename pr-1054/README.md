# PR 1054 evidence: ai_title_accepted fires only for the generated title

BEFORE: fadc1009 (merge-base with main). AFTER code: 764d95ce. Head 430514b6 adds only a PR link in docs.
Test: `pnpm vitest --run src/composables/useAutoTitle.spec.ts`, fixtures only, no customer data.

- `red.txt`: the new tests on BEFORE code. 4 failed, 22 passed.
- `green.txt`: the same tests on AFTER code. 26 passed.

Mixpanel query, project 3373228, `ai_title_accepted`, 2026-09-08 to 2026-11-05, internal domains excluded by the JQL domain list, raw rows without sample_rate extrapolation:

| `accepted_title` length | Rows |
|---|---|
| 80 or less | 7,637 |
| Over 80 | 10 |
| Longest | 141 |

`functions/ai-generate-title.ts:27` caps the model title at 80, so the 10 rows over 80 cannot be model titles. Length finds only part of the edits.
