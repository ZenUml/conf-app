---
name: macro-count
description: >
  Get the per-space macro count for ONE named client (Confluence tenant/domain),
  triangulated across three independent sources: Metrics KV (current inventory),
  Cloudflare D1 (lifetime rows), and Mixpanel (90-day distinct macros viewed). Use
  whenever a request names one specific tenant (e.g. acme-corp, "our biggest lite
  customer") and asks how many macros or diagrams it has per space, wants to size a
  tenant against the Lite 100-macro paywall, reconcile per-space counts that
  disagree between KV/D1/Mixpanel, spot spaces with many macros but few recent
  views, or count distinct macros viewed per space over the last N days — even when
  only one source is named. Prefer this over conf-app, mixpanel, duckdb, or growth
  whenever the subject is one named tenant and the answer is a per-space macro
  tally. Do NOT use for product-wide totals across all tenants (use conf-app),
  single-page macro counts (find-macros-on-page), render-time/duration metrics
  (rendering-perf), install/marketplace counts (forge-installs), or one-off KV
  freshness diagnosis (metrics). Triggers on "macro count", "count macros", "how
  many macros", "macros per space", "per-space breakdown", "tenant macro
  inventory", "size this client".
---

# macro-count

Counts macros per space for a single client from three sources that each answer a
**different question**. The whole point of this skill is that no one source is
"the" count — you read them together.

| Source | Question it answers | Keyed by | Main blind spot |
|---|---|---|---|
| **Metrics KV** | How many macros exist *right now* in each space | space **KEY** (`ENG`) | reported-on-save → only spaces saved-into since reporting began; can be stale >24h |
| **D1** | How many macro rows were *ever created* | numeric **spaceId** (`32987`) | Forge records can't be scoped to a client (shared UUID `appId`, no `clientDomain`) → Connect-only |
| **Mixpanel** | How many distinct macros were *viewed* in the last 90d | space **KEY** (`ENG`) | Forge **graph** viewer emits no view event; never-viewed macros absent; counts since-deleted placements |

## The one reconciliation trap — read this first

**KV and Mixpanel key by space KEY (`ENG`); D1 keys by the numeric space ID
(`32987`).** They do **not** line up without a key↔id map (a Confluence REST call
needing that tenant's auth, which we don't have for arbitrary clients). So:

- **KV ⟷ Mixpanel** reconcile cleanly per space — the script lines them up.
- **D1** is shown separately, by numeric `spaceId`, as a domain-total cross-check.
- For a **Forge** client (≈ all prod tenants now), D1 cannot scope to the client
  at all — KV + Mixpanel are your per-space backbone. D1 only adds value for
  clients with a **Connect** install (joinable via `AppInstance.clientDomain`).

Also: the **domain is the BARE subdomain** (`zenuml`), not the full hostname.
The KV key is built from `getClientDomain()` = bare subdomain, so
`zenuml.atlassian.net` silently returns `no_data`. The script normalizes either
form for you.

## Quick start

Run from the conf-app project root (so `.env.mixpanel` and wrangler config resolve):

```bash
python3 .claude/skills/macro-count/scripts/macro_count.py --domain zenuml
```

Flags: `--days N` (Mixpanel window, default 90) · `--no-d1` (skip the slow
source) · `--no-kv` · `--no-mixpanel` · `--json` (raw output). Each source is
independent — if one is unavailable or skipped, the others still print.

### Example output (internal `zenuml` tenant)

```
## Per-space (KV inventory + Mixpanel 90d distinct-viewed)
| Space KEY | KV total | KV variant | MP 90d distinct-viewed |
|---|---|---|---|
| Doc | 20   | full | -    |
| IN  | 4    | lite | 5    |
| ZEN | 1304 | lite | 1928 |
| ZS  | 14   | full | 11   |
| **TOTAL** | **1350** | | **1948** |
```

Here ZEN reads MP 1928 > KV 1304: `macro_uuid` is the Forge `localId` (per
*placement* — includes copied/since-deleted placements viewed in-window), so the
viewed-distinct can exceed the live inventory. That divergence is expected; see
"Interpreting divergence" below.

## Per-source commands (for one-offs, or when the script can't run)

### 1. Metrics KV — current inventory, per space KEY

```bash
# Domain-wide (all spaces). Pass the BARE subdomain. UA matters — Cloudflare
# WAF 403s the default python-urllib agent, so use curl.
curl -s -A curl/8.4.0 "https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<bare>&addonKey=com.zenuml.confluence-addon"
curl -s -A curl/8.4.0 "https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<bare>&addonKey=com.zenuml.confluence-addon-lite"
```

**The host does not choose the product — the `addonKey` param does.** Every Pages
project reads the same `confluence_plugin_features` namespace, so both URLs above
work from either host; only the param selects `metrics:<domain>:<productType>`.
(`&productType=` is clearer but is honoured only where PR #397 has deployed; older
handlers ignore it and fall back to Full, which is how you'd get a fossil count
while believing you asked for Lite. `addonKey` works against both.)

A tenant having data under **both** full and lite usually does **not** mean both
apps are installed — it is far more often residue from a past writer bug that
mis-stamped `productType`, frozen at the date it was fixed. 458 of 767 domains
carry more than one key. Check the tenant's actual Marketplace license (`tenant`
skill) before believing a second product, and prefer the **freshest** record, never
the largest: vin3s/VARW served a frozen April `full` count of 438 over the live
`lite` count of 188. Per-space counts are nested under `spaces.<KEY>.data`
(`.total`, `.sequence`, `.graph`, `.mermaid`, `.openapi`, `.plantuml`, `.unknown`).
The `/metrics` skill covers status/staleness diagnosis; **but its "use the full
hostname" instruction is wrong — use the bare subdomain.**

### 2. D1 — lifetime rows, per numeric spaceId (Connect-scopable only)

```bash
npx wrangler d1 execute conf-zenuml-prod --env production --remote --json --command "
  SELECT cc.spaceId, COUNT(*) AS macros, COUNT(DISTINCT cc.macroUuid) AS distinct_uuids,
         MAX(cc.createdAt) AS last_created
  FROM CustomContent cc JOIN AppInstance ai ON cc.appId = ai.appId
  WHERE ai.clientDomain = '<bare>'
  GROUP BY cc.spaceId ORDER BY macros DESC"
```

Zero rows + an `AppInstance` row exists → Connect client with no macros. Zero
rows + **no** `AppInstance` row → Forge client; D1 can't scope to it (use KV +
Mixpanel). `CustomContent` is one row per macro but is **cumulative** — it keeps
rows for macros since deleted in Confluence, so D1 ≥ live count.
Full schema: conf-app skill `references/d1-schema.md`.

### 3. Mixpanel — 90d distinct macro_uuid, per space KEY

Distinct `macro_uuid` grouped by `confluence_space`, filtered to the client,
over the window (clamp the start to the **2026-04-18** tracking start). Both the
current (`macro_viewed`) and legacy (`view_macro`) event names cover any window
reaching into April 2026. Drop the `unknown_macro_uuid` / `unknown_space`
buckets. Run via the mixpanel skill's runner:

```bash
python3 .claude/skills/mixpanel/scripts/mp_query.py --file <jql.js>
```

The exact JQL is in `scripts/macro_count.py:build_jql` — reuse it rather than
re-deriving. Mixpanel mechanics (project `3373228`, auth, the rename, the dead
`isForge`/`isLite`) live in the **mixpanel** skill.

## Interpreting divergence

The three counts measuring different things is the feature, not a bug:

- **KV ≈ live count.** Best answer to "how many macros exist now". If a space is
  missing from KV but present in Mixpanel, no save has happened there since
  reporting began (or the report is stale) — not necessarily empty.
- **Mixpanel = usage, not inventory.** It can run *above* KV (per-placement
  `localId`, deleted/duplicated placements) or *below* it (graph viewer is
  silent; macros nobody viewed in-window are absent; client-side-blocked tenants
  undercount). Treat it as "macros actively in use", not a census.
- **D1 ≥ KV** when joinable (cumulative, includes deleted). For Forge clients D1
  contributes only a global cross-check, not a per-client number.

A large KV-vs-Mixpanel gap in a space is signal: high KV + low MP = lots of
macros, little recent readership (candidate for churn/cleanup); low KV + high MP
= heavy reuse of a few diagrams. Report the gap, don't average it away.

## Caveats checklist

- Bare subdomain, not full hostname (KV key + Mixpanel `client_domain`).
- `curl/8.4.0` UA on KV requests (WAF blocks python-urllib).
- D1 `spaceId` is numeric, not the space KEY — never join it directly to KV/MP.
- D1 per-client works for Connect only; Forge needs KV + Mixpanel.
- Mixpanel window clamps to 2026-04-18; graph views are missing; exclude unknown buckets.
- This skill reads three live prod sources; never write to them.
