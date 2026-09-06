# D1 query results — Lite Forge seed spaces (conf-zenuml-prod, production, read-only)

Run via `npx wrangler d1 execute conf-zenuml-prod --env production --remote --json --command "<SQL>"`. No repo files modified.

## Lite Forge app UUID
`8ad26115-211f-4216-971b-0540f606303d` — from `.env.forge.lite:2` (`APP_ID=`), cross-checked against
`wrangler-prod.toml` `ALLOWED_FORGE_APP_IDS` comment ("ZenUML Lite, Full, Diagramly and AsyncAPI",
value listed first) and D1 `SELECT appId,name FROM ForgeApp` → `... | ZenUML Diagrams and Open API
Lite`. Also has the most `CustomContent` rows of the 4 appIds (39,482).

**Schema note:** `d1-schema.md` says `CustomContent/CustomContentVersion.appId` is `INTEGER`; live
`typeof(appId)` is `TEXT` (UUID) for Forge rows — the doc describes the Connect path only.

## Space key
`CustomContent.spaceId` (numeric Confluence space ID) — the only per-space key on Forge rows; no
`clientDomain` exists for Forge content.

## Q1 — spaces by macro-count bucket (Lite only)
```sql
WITH sc AS (SELECT spaceId, COUNT(DISTINCT contentId) n FROM CustomContent
  WHERE appId='8ad26115-211f-4216-971b-0540f606303d' GROUP BY spaceId)
SELECT COUNT(*) total_ge1, SUM(n>=100) spaces_ge_100, SUM(n>=50 AND n<100) spaces_50_99 FROM sc;
```
| total spaces >=1 macro | >=100 macros | 50-99 macros |
|---|---|---|
| 2282 | 55 | 98 |

## Q2 — distinct authorId per space, summary (Lite only)
```sql
WITH sc AS (SELECT spaceId, COUNT(DISTINCT contentId) n FROM CustomContent
  WHERE appId='<lite>' GROUP BY spaceId HAVING n>=100 /* or n>=50 AND n<100 for the other bucket */),
psa AS (SELECT sc.spaceId, COUNT(DISTINCT ccv.authorId) distinct_authors FROM sc
  JOIN CustomContent cc ON cc.spaceId=sc.spaceId AND cc.appId='<lite>'
  JOIN CustomContentVersion ccv ON ccv.contentId=cc.contentId AND ccv.appId='<lite>' GROUP BY sc.spaceId),
r AS (SELECT distinct_authors n, ROW_NUMBER() OVER (ORDER BY distinct_authors) rn, COUNT(*) OVER () cnt FROM psa)
SELECT (SELECT COUNT(*) FROM psa), (SELECT MIN(distinct_authors) FROM psa),
       (SELECT MAX(distinct_authors) FROM psa), (SELECT SUM(distinct_authors) FROM psa),
       (SELECT AVG(n) FROM r WHERE rn IN ((cnt+1)/2,(cnt+2)/2));
```
| bucket | n spaces | min | median | max | sum |
|---|---|---|---|---|---|
| >=100 macros | 55 | 1 | 9 | 120 | 894 |
| 50-99 macros | 98 | 1 | 5 | 16 | 530 |

## Q3 — distinct authorId, all appIds, all time
```sql
SELECT COUNT(DISTINCT authorId) FROM CustomContentVersion;                          -- 5888
WITH fs AS (SELECT authorId, MIN(createdAt) t FROM CustomContentVersion GROUP BY authorId)
SELECT COUNT(*) FROM fs WHERE t < '2026-04-18';                                     -- 3998
```
5888 distinct authorIds ever (all 4 appIds + Connect). 3998 (68%) have their earliest content
`createdAt` before 2026-04-18 (pre-Mixpanel-tracking creators).

## Q4 — "active" authorIds, last 30 days (Lite only)
No `updatedAt` column exists on either table (checked live `sqlite_master` DDL, not just the doc).
Falling back to `CustomContentVersion.createdAt` is unsound for "activity": verified live that for
500 sampled multi-version contentIds, every version row shares **one** `createdAt` (the known
content-creation-date bug), and separately for 2000 sampled multi-version contentIds, every version
row also shares **one** `authorId` — so this table carries no per-save timestamp or per-save editor
at all (only `CustomContent.latestVersionNumber` proves edits happened: max 103 for Lite, 10,999/
39,482 Lite rows have `latestVersionNumber > 1`). The number below is therefore "distinct authorIds
whose earliest content-creation date falls in the last 30 days" — new creators only, undercounting
true 30-day activity (excludes anyone who only edited existing content). No D1 column can give a
correct per-save 30-day active-author count.
```sql
SELECT COUNT(DISTINCT authorId) FROM CustomContentVersion
WHERE appId='8ad26115-211f-4216-971b-0540f606303d' AND createdAt >= date('now','-30 days');
```
**923** distinct authorIds (Lite) by this creation-date proxy.

## Privacy
No space keys, contentIds, or authorIds listed — counts and summary stats only.
