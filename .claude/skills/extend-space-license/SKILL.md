---
name: extend-space-license
description: >
  Fulfil a Lite paywall lockout / "temporary editing extension" request — grant a
  temporary license that lifts the Lite per-space 100-macro limit, by default for
  ONLY the requesting user, then draft the customer reply. Use whenever a customer
  (via the JSM extension-request flow or direct email) asks to re-open editing on a
  space that hit the diagram limit, or when handed a request with a client domain +
  space key + macro count. It resolves the cloudId, verifies the exact space key,
  writes the SPACE_LICENSE_KV record, verifies it, computes the Full-plan upgrade
  price, and drafts the reply from the canonical template. Triggers on "extend",
  "extension request", "temporary editing extension", "grant a space license",
  "re-open editing", "paywall lockout", "lift the limit for <space>", "request:
  temporary Lite editing extension". For the reply template + sent log see the
  handbook page paywall/extension-request-replies.md; for per-space macro counts
  use macro-count.
---

# extend-space-license

Grants a **temporary license** (`spacePaidStatus=true`) and drafts the customer
reply. This is the operational counterpart to the handbook runbook
`paywall/extension-request-replies.md` (the customer-facing reply template + sent
log) — keep that page the source of truth for the reply wording.

## Default scope: per-user, not per-space

**Grant to the requesting user (`--user <accountId>`) by default.** A whole-space
grant fully defuses paywall pressure for every user in that space — the team stops
feeling the limit, which kills the conversion signal a space-level grant is
supposed to be a bridge toward. A user-scoped grant unlocks only the person who
asked, so the rest of the space still feels the pressure.

**Escalate to space-level (omit `--user`) only when multiple independent users in
the same space have separately requested an extension.** That pattern is itself
the signal the whole team needs it — just re-run the script without `--user`; the
existing space-key fallback in `space-status.ts` already covers any user-scoped
grants already in place for that space. There is no separate "escalation" command
or auto-counting — it's a manual judgment call based on how many distinct people
have asked.

The requester's `accountId` (e.g. `712020:...`) is on the JSM ticket's
Description field ("User account ID: ...") and in the `extension_request_clicked`
Mixpanel event's `distinct_id`.

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
  --domain <tenant> --space <SPACE_KEY> --user <accountId> --users <N> --dry-run

# Grant for real (14-day extension, user-scoped) + draft the reply:
python3 .claude/skills/extend-space-license/scripts/grant_extension.py \
  --domain <tenant> --space <SPACE_KEY> --user <accountId> --users <N>

# Escalate to the whole space (only after multiple independent requesters):
python3 .claude/skills/extend-space-license/scripts/grant_extension.py \
  --domain <tenant> --space <SPACE_KEY> --users <N>
```

Flags: `--user <accountId>` (scopes the grant to one user — **default choice**;
omit to grant the whole space) · `--days N` (default 14) · `--users N` (site tier
→ fills the Full-plan price in the reply) · `--activated-by` · `--no-reply` ·
`--dry-run`.

## What it does (and why each step matters)

1. **Resolve cloudId** — `https://<tenant>.atlassian.net/_edge/tenant_info` →
   `cloudId`. This is the authoritative Forge-context cloudId that `space-status.ts`
   compares against. Never guess it.
2. **Verify the space key** — checks the key exists in metrics KV and reports its
   macro count. The space key is **case-sensitive and exact**; a typo, a wrong
   case, or a key truncated by a form field (a dropped trailing char) grants nothing.
   The script warns if the key isn't found (and lists the real keys) or if the
   space is under 100 macros (i.e. may not actually need an extension).
3. **Write the license record** — `license:<cloudId>:<spaceKey>:<accountId>` when
   `--user` is given, else `license:<cloudId>:<spaceKey>` (whole-space), to
   `SPACE_LICENSE_KV` (prod ns `8969e8528105403bb2d9adca9fc16567`), upserting so an
   existing record keeps its `createdAt`. Shape mirrors `SpaceLicenseRecord`
   (`functions/api/space-license.ts`): `status:"active"`,
   `activatedBy:"support:temp-14d-extension"`, `expiresAt:"<+14d>T23:59:59Z"`, plus
   `userAccountId` when scoped to a user.
4. **Update `license-index`** — read-modify-write append `{cloudId, spaceKey}` (+
   `userAccountId` when scoped) — index is only for the admin GET listing, not
   enforcement. A user-scoped and a space-level entry for the same space coexist
   as separate index entries.
5. **Verify read-back** — confirms `status:active`.

**Enforcement** (`functions/api/space-status.ts`): checks the user-scoped key
first (derived server-side from the caller's Forge-validated accountId, never a
client-supplied param), falling back to the space-level key — returns
`isPaid:true` iff the matched record has `status==='active'` AND `expiresAt` is in
the future. Response is cached `max-age=300`, so a grant applies client-side
**within ~5 min** (and `spacePaidStatus` is fetched once per session — an open
editor needs a refresh).

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
# write record to /tmp/rec.json mirroring SpaceLicenseRecord (include "userAccountId"
# in the JSON for a user-scoped grant), then:
npx wrangler kv key put "license:$CLOUD:<SPACE>:<ACCOUNT_ID>" --path /tmp/rec.json --namespace-id=$NS --remote   # user-scoped (default)
npx wrangler kv key put "license:$CLOUD:<SPACE>" --path /tmp/rec.json --namespace-id=$NS --remote                # space-level (escalation)
# read-modify-write "license-index" to append {cloudId, spaceKey[, userAccountId]}
npx wrangler kv key get "license:$CLOUD:<SPACE>:<ACCOUNT_ID>" --namespace-id=$NS --remote   # verify
```

## After granting

1. **Log it** — append a dated entry to the handbook page
   `paywall/extension-request-replies.md` "Sent log" (tenant, space, site size,
   Full-plan price, whether it's a repeat request → conversion signal).
2. **Verify it's honored** (no customer UI access → use Mixpanel as the real
   outcome signal): split the space's events at the grant timestamp — **0 blocking
   events after** (`paywall_triggered` / `paywall_blocked_create` /
   `paywall_attempts_exhausted`) + `macro_save_succeeded`/`macro_create_succeeded`
   continuing = working. Filter `client_domain` + `confluence_space`, and for a
   user-scoped grant also filter by `distinct_id`/accountId — a different user in
   the same space is expected to keep seeing the paywall. `paywall_gate_evaluated`
   carries `space_paid_scope` (`user_license` vs `space_license`) so you can
   confirm which grant actually satisfied the gate. Gotcha: `paywall_banner_shown`
   (warning, ≥85 macros) can persist for days because `spacePaidStatus` is fetched
   once per session — a residual banner with 0 blocking events is cosmetic, not a
   failure.

## Related

- `tenant` skill — before granting, `whois <domain>` tells you the tenant's paid status / plan / any existing space-licenses / trial expiry, so you're not comping someone who already pays.
- `macro-count` skill — per-space macro counts (used here to verify the space key).
- `metrics` skill — single-space KV freshness diagnosis.
- Handbook: `paywall/extension-request-replies.md` (reply template + sent log),
  `paywall/runbook.md` (paywall rollout runbook).
