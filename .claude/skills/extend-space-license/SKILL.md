---
name: extend-space-license
description: Execute an authorised temporary Lite editing grant for an exact customer site, space and optionally user, verify the remote KV result, and provide grant facts for a reply. Use for temporary editing extension or space-license requests; customer communication policy belongs to customer-followup.
---

# Temporary license execution

Use the user's current or standing authorisation for the exact scope and duration. A request to investigate usage is not permission to grant access. Do not re-confirm an already authorised grant. Default scope is the requesting user; do not expand to a whole space merely because several people use it.

Before writing, verify cloudId, exact case-sensitive space key, requester account ID, current grant and prior promises. List remote keys and inspect values; failed reads are unknown, not no previous grant. Historical grant counts must refer to the actual scope/team, not be attributed to a first-time requester.

```bash
python3 .claude/skills/extend-space-license/scripts/grant_extension.py --domain example-tenant --space ENG --user example-account --days 7 --dry-run --no-reply
```

For an authorised execution use the same verified arguments without `--dry-run`. `--days` defaults to seven in the script, but honour the actual authorised duration. Space-wide grants omit `--user` only when authorised. `--activated-by` identifies the authorised actor. Verify the returned scope, status and expiry, not only command success. Read back after an ambiguous response before retrying.

This writes access, not a payment. KV `spacePaidStatus` can represent a manual comp. Record grant scope/expiry separately from Marketplace license and transaction status, and preserve any existing paid entitlement.

Use `--no-reply` with `customer-followup`, which drafts a concise role-appropriate response and performs only already authorised communication. The legacy script reply is a technical preview, not automatically approved customer text. A feedback offer or future extension is a separate commitment; honour promises actually made, do not silently create one from a default template.

Full pricing delegates to the Marketplace shared live implementation. `scripts/outbound_contact.py` is retired: it previously created support tickets on behalf of technical contacts and selected pricing by reseller presence. Use `customer-followup` to choose recipient, offer and authorised channel. No automatic contact follows a grant.

Record verified operations in the customer activity log and any relevant private Handbook runbook. Include source links and dates; a save failure in the tracker is not a reason to repeat the grant.
