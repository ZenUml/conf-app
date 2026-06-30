---
name: extend-space-license
description: >
  Fulfil a Lite paywall lockout / "temporary editing extension" request — grant a
  temporary space license that lifts the Lite per-space 100-macro limit for ONE
  space, then draft the customer reply. Use whenever a customer (via the JSM
  extension-request flow or direct email) asks to re-open editing on a space that
  hit the diagram limit, or when handed a request with a client domain + space key
  + macro count. It resolves the cloudId, verifies the exact space key, writes the
  SPACE_LICENSE_KV record, verifies it, computes the Full-plan upgrade price, and
  drafts the reply from the canonical template. Triggers on "extend", "extension
  request", "temporary editing extension", "grant a space license", "re-open
  editing", "paywall lockout", "lift the limit for <space>", "request: temporary
  Lite editing extension". For the reply template + sent log see the handbook page
  paywall/extension-request-replies.md; for per-space macro counts use macro-count.
---

# extend-space-license

Grants a **temporary space license** (`spacePaidStatus=true`) for one space and
drafts the customer reply. This is the operational counterpart to the handbook
runbook `paywall/extension-request-replies.md` (the customer-facing reply template + sent log) — keep that page the source of truth for the reply wording.

## ⚠ This mutates production KV

The grant writes to the prod `SPACE_LICENSE_KV` namespace. That's a
deploy-discipline action — **only run the live grant with an explicit go-ahead.**
Use `--dry-run` to preview the exact record and commands first. The customer-facing
reply, pricing, and verification are all safe to prepare anytime.

## Quick start

Run from the conf-app project root:

```bash
# Preview everything (no writes) — cloudId, space check, record, drafted reply:
python3 .claude/skills/extend-space-license/scripts/grant_extension.py \
  --domain <tenant> --space <SPACE_KEY> --users <N> --dry-run

# Grant for real (14-day extension) + draft the reply:
python3 .claude/skills/extend-space-license/scripts/grant_extension.py \
  --domain <tenant> --space <SPACE_KEY> --users <N>
```

Flags: `--days N` (default 14) · `--users N` (site tier → fills the Full-plan
price in the reply) · `--activated-by` · `--no-reply` · `--dry-run`.

## What it does (and why each step matters)

1. **Resolve cloudId** — `https://<tenant>.atlassian.net/_edge/tenant_info` →
   `cloudId`. This is the authoritative Forge-context cloudId that `space-status.ts`
   compares against. Never guess it.
2. **Verify the space key** — checks the key exists in metrics KV and reports its
   macro count. The space key is **case-sensitive and exact**; a typo, a wrong
   case, or a key truncated by a form field (a dropped trailing char) grants nothing.
   The script warns if the key isn't found (and lists the real keys) or if the
   space is under 100 macros (i.e. may not actually need an extension).
3. **Write the license record** — `license:<cloudId>:<spaceKey>` to
   `SPACE_LICENSE_KV` (prod ns `8969e8528105403bb2d9adca9fc16567`), upserting so an
   existing record keeps its `createdAt`. Shape mirrors `SpaceLicenseRecord`
   (`functions/api/space-license.ts`): `status:"active"`,
   `activatedBy:"support:temp-14d-extension"`, `expiresAt:"<+14d>T23:59:59Z"`.
4. **Update `license-index`** — read-modify-write append `{cloudId, spaceKey}`
   (index is only for the admin GET listing, not enforcement).
5. **Verify read-back** — confirms `status:active`.

**Enforcement** (`functions/api/space-status.ts`): returns `isPaid:true` iff
`status==='active'` AND `expiresAt` is in the future. Response is cached
`max-age=300`, so a grant applies client-side **within ~5 min** (and
`spacePaidStatus` is fetched once per session — an open editor needs a refresh).

## Pricing for the reply

- **Full plan** (org-wide) — ARR tier model (`docs/pricing-model.yml`), where
  `n` = the site user tier from the Marketplace license:
  `n<=10 ? 40 : (min(n,100)*.44 + (min(n,250)-100)*.33 + (min(n,1000)-250)*.11 + max(0,n-1000)*.05) * 10`.
  Pass `--users N` and the script fills it in.
- **Enterprise Space Bundle** (per-space) — flat **$299/space/year**.

Fetch the tier (needs Marketplace creds — explicit go-ahead) from the license
report:

```bash
# loads FORGE_EMAIL / FORGE_API_TOKEN from .env.forge.local
curl -s -u "$FORGE_EMAIL:$FORGE_API_TOKEN" \
  "https://marketplace.atlassian.com/rest/2/vendors/1215266/reporting/licenses?text=<tenant>" \
  | python3 -c "import sys,json; [print(i.get('tier')) for i in json.load(sys.stdin).get('licenses',[])]"
```

## Manual fallback (if the script can't run)

```bash
NS=8969e8528105403bb2d9adca9fc16567
CLOUD=$(curl -s https://<tenant>.atlassian.net/_edge/tenant_info | python3 -c "import sys,json;print(json.load(sys.stdin)['cloudId'])")
# write record to /tmp/rec.json mirroring SpaceLicenseRecord, then:
npx wrangler kv key put "license:$CLOUD:<SPACE>" --path /tmp/rec.json --namespace-id=$NS --remote
# read-modify-write "license-index" to append {cloudId, spaceKey}
npx wrangler kv key get "license:$CLOUD:<SPACE>" --namespace-id=$NS --remote   # verify
```

## After granting

1. **Log it** — append a dated entry to the handbook page
   `paywall/extension-request-replies.md` "Sent log" (tenant, space, site size,
   Full-plan price, whether it's a repeat request → conversion signal).
2. **Verify it's honored** (no customer UI access → use Mixpanel as the real
   outcome signal): split the space's events at the grant timestamp — **0 blocking
   events after** (`paywall_triggered` / `paywall_blocked_create` /
   `paywall_attempts_exhausted`) + `macro_save_succeeded`/`macro_create_succeeded`
   continuing = working. Filter `client_domain` + `confluence_space`. Gotcha:
   `paywall_banner_shown` (warning, ≥85 macros) can persist for days because
   `spacePaidStatus` is fetched once per session — a residual banner with 0
   blocking events is cosmetic, not a failure.

## Related

- `macro-count` skill — per-space macro counts (used here to verify the space key).
- `metrics` skill — single-space KV freshness diagnosis.
- Handbook: `paywall/extension-request-replies.md` (reply template + sent log),
  `paywall/runbook.md` (paywall rollout runbook).
