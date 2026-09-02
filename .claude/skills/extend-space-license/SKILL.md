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
  price, and drafts the reply from the canonical template. Default handling is
  7 days now + 15 if they answer four questions (--feedback-offer), run without
  asking the owner first — repeat askers included. Triggers on
  "extend", "extension request", "temporary editing extension", "grant a space
  license", "re-open editing", "paywall lockout", "lift the limit for <space>",
  "request: temporary Lite editing extension", "ask for feedback in exchange",
  "longer extension if they give feedback". For the reply template + sent log see
  the handbook page paywall/extension-request-replies.md; for per-space macro
  counts use macro-count.
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

## First: count the prior grants (a "first request" is often not one)

**Before deciding anything, list the tenant's existing license keys.** The sent log
is hand-maintained and *has* been skipped (ZEN-1185 was granted 2026-07-15 and never
logged — found only in KV while handling ZEN-1191). An unlogged grant is how a 3rd
comp gets treated as a 1st.

```bash
NS=8969e8528105403bb2d9adca9fc16567
CLOUD=$(curl -s https://<tenant>.atlassian.net/_edge/tenant_info | python3 -c "import sys,json;print(json.load(sys.stdin)['cloudId'])")
npx wrangler kv key list --namespace-id=$NS --remote 2>/dev/null \
  | python3 -c "import sys,json;raw=sys.stdin.read();i=raw.find('[');print('\n'.join(k['name'] for k in json.loads(raw[i:]) if '$CLOUD' in k['name']))"
# then read each one for its expiresAt / activatedBy (which should name the ticket)
```

Also note **who** asked each time. Requests arrive per-person, so a per-tenant
"don't renew again" rule is structurally defeatable: three vin3s tickets came from
three different humans (`vinit.dir.it6@` → `v.luongtx2@` → `nangdv1990@gmail.com`),
and each one reads as a first request unless you check. Distinct-requester count is
also what decides scope (see above) — so you need it before you choose a key shape.

## The default is 7 + 15 — run it, do not ask (owner ruling 2026-08-16)

**Every extension request is handled as a 7-day user-scoped grant plus the 15-day
feedback offer, without asking the owner first.** Do not present "grant / escalate /
refuse" as a choice, and do not ask which window to use. Run the grant, post the
reply, log it, report what was done.

Two things still stop for an explicit decision, and only these two:

1. **Escalating to a space-level grant** (omit `--user`) — it removes the limit for
   the whole site and erases the distributed-pressure signal.
2. **Refusing a grant outright** (commercial-only reply).

Everything else in this skill is the standing procedure. (Before this ruling, a
routine 6th request from one space was written up as a three-option question; the
owner picked the default. The question was overhead — the answer is the default.)

## Repeat askers: trade the longer window for feedback (`--feedback-offer`)

When someone asks again and the tenant still hasn't converted, the choice is not
"renew or refuse". **Grant the standard window, then offer a longer one in exchange
for product feedback:**

```bash
python3 .claude/skills/extend-space-license/scripts/grant_extension.py \
  --domain <tenant> --space <SPACE> --user <accountId> --users <N> --feedback-offer
```

That writes the **normal 7-day** record and adds a block to the reply promising
**15 days** (`--feedback-offer N` for a different number; it must exceed `--days`),
matching the automatic grant the in-app pricing survey pays out on submit (see
below), so nobody is rewarded more for skipping the in-app form, if they answer
four questions:

1. **Role.** Which describes you: admin the space, create/edit diagrams there,
   admin Confluence apps for the whole site, or other. *(who we're talking to)*
2. **Price.** If unlocking `<SPACE>` for a year were priced in USD/year, what's too
   cheap to trust, a bargain, getting expensive, and too expensive to consider (four
   numbers, a Van Westendorp price-sensitivity battery). *(willingness to pay)*
3. **Billing model.** Which fits your team best and which fits worst: per space per
   year, per Confluence user per month, per active diagram author, per number of
   diagrams. *(packaging)*
4. **If your team wanted to lift the limit permanently, what's the hard part
   internally: budget, admin approval, procurement, nobody owns it, or other?**
   *(the commercial one)*

Q4 is the point of the exercise. After several free comps with no conversion we
still don't know *which* wall we're hitting, and that answer changes the next move
entirely (a procurement blocker wants the $299 self-serve Bundle; a "nobody owns it"
blocker wants a champion, not a price). Q1 to Q3 are new (2026-09-03): they feed the
same pricing decision the in-app survey is built to answer, so a customer who prefers
email over the in-app form still contributes the same data.

Rules that keep this honest:
- **The offer is time, never scope.** Extend the *duration* for the requester; don't
  quietly widen a user grant to the whole space as a sweetener, since that erases the
  distributed-pressure signal (§ Default scope).
- **Decouple it from buying.** The drafted reply ends with *"the 15 days is yours for
  the feedback — no strings attached to buying anything."* Keep that line; without it
  the trade reads as coercion.
- **Say how many comps there have been.** Naming the dates ("30 June, 15 July, and
  today") is what makes the commercial ask credible. Attribute the count to the
  **space/team**, not to the individual, when the requesters differ: telling a
  first-time asker "this is your third" is simply false.
- **Follow through when feedback lands:** re-run with `--days 15` on the same
  accountId (the upsert preserves `createdAt`), log the answers in the sent-log
  entry, and reply confirming the new date.
- **The default grant is deliberately short (7 days) so the trade is still worth
  taking.** A 7 → 15 day jump is a ~2.1× reward for four answers, smaller than the
  old 7 → 60 (~8.5×) on purpose: the offer is now pinned to the same 15 days the
  in-app pricing survey grants automatically on submit, so nobody is rewarded more
  for answering by email than for using the in-app form (owner ruling 2026-09-03).
  Pass `--days 14` explicitly for a one-off first-time asker where you're **not**
  soliciting feedback.
- The 15-day number is shared with the in-app survey grant (`REWARD_DAYS` in
  `functions/api/paywall-survey.ts`); changing one without the other reopens the
  reward gap this parity was meant to close. Coordinate both if it ever changes.

## In-app pricing survey (15-day grant)

Since 2026-09-03 the same four-question trade above also runs **in-app, with no
email round-trip.** The paywall modal offers a pricing survey next to "Request
extension"; a customer who answers it there gets 15 days automatically, the instant
they submit. No ticket, no waiting on a human reply. This is why the email offer
above was cut from 60 to 15: the two paths pay the same reward for the same four
answers, so nobody has a reason to prefer one over the other.

**What the customer sees.** In the paywall modal, next to "Request extension" and
before the JSM deep link, a 4-question form: role, a 4-number price-sensitivity
battery (too cheap / bargain / getting expensive / too expensive, USD/year to
unlock the space), preferred vs. least-preferred billing model, and the internal
blocker to a permanent upgrade. Same items as the email offer above, just collected
as form fields instead of prose. Each answer saves to D1 as it's given (not only on
final submit), so an abandoned survey is still visible to us, not lost.

**Mechanism** (`functions/api/paywall-survey.ts`, migration
`functions/migrations/0024_add_paywall_survey_response.sql`):
- Grant key: `license:<cloudId>:<spaceKey>:<accountId>` in `SPACE_LICENSE_KV`. Same
  user-scoped shape this skill writes, so `space-status.ts` enforcement and the KV
  read-back check in [After granting](#after-granting) apply unchanged.
- `activatedBy: survey:pricing-15d:<responseId>`. The `survey:` prefix is what the
  backend checks to decide `already_granted`; it also tells you at a glance, reading
  a KV record, that a grant came from the in-app form rather than from this skill's
  `support:temp-<days>d-extension:…` / `support:auto:…` labels.
- **One grant per user per space, ever.** Any existing record whose `activatedBy`
  starts with `survey:` blocks a second survey grant on that (user, space) pair.
  Unlike this skill's grants, resubmitting does not renew or restack it. A repeat
  asker who already holds a survey grant needs this skill instead.
- Answers land in D1 table `PaywallSurveyResponse`, columns `responseId, cloudId,
  clientDomain, spaceKey, userAccountId, macroCount, appVersion, role,
  priceTooCheap, priceBargain, priceExpensive, priceTooExpensive, unitMost,
  unitLeast, blocker, comment, submitted, grantStatus, grantExpiresAt, createdAt,
  updatedAt`. `submitted = 0` is an abandoned attempt, not a failure to clean up.
- **A `Survey ID: <uuid>` line in a JSM ticket's description (after `Macro type:`)**
  means the customer saw the in-app survey and did not submit it before falling
  through to "Request extension" instead. The uuid is that attempt's `responseId`;
  join it against `PaywallSurveyResponse` to see how far they got and whether their
  answers are still usable even though no grant was paid out for them.

**Read query for operators** (read-only, no separate go-ahead needed; it is not a
KV write):

```bash
wrangler d1 execute conf-zenuml-prod --remote --command "SELECT createdAt, clientDomain, spaceKey, role, priceTooCheap, priceBargain, priceExpensive, priceTooExpensive, unitMost, unitLeast, blocker, submitted, grantStatus FROM PaywallSurveyResponse ORDER BY createdAt DESC LIMIT 50"
```

## ⚠ This mutates production KV

The grant writes to the prod `SPACE_LICENSE_KV` namespace. The **7 + 15 default is
pre-authorised** (owner ruling 2026-08-16; offer amount aligned to 15 on 2026-09-03)
— a user-scoped grant at `--days 7` with `--feedback-offer` runs live without a
separate go-ahead. `--dry-run` first is still useful to read the record and the
drafted reply back before writing.

An explicit go-ahead is required only for the two exceptions named above: a
space-level grant, or refusing the grant. Any window other than 7 days also needs
one, since it changes the 7 → 15 ratio.

## Quick start

Run from the conf-app project root:

```bash
# Preview everything (no writes) — cloudId, space check, record, drafted reply:
python3 .claude/skills/extend-space-license/scripts/grant_extension.py \
  --domain <tenant> --space <SPACE_KEY> --user <accountId> --users <N> --dry-run

# Grant for real (7-day extension, user-scoped) + draft the reply:
python3 .claude/skills/extend-space-license/scripts/grant_extension.py \
  --domain <tenant> --space <SPACE_KEY> --user <accountId> --users <N>

# Escalate to the whole space (only after multiple independent requesters):
python3 .claude/skills/extend-space-license/scripts/grant_extension.py \
  --domain <tenant> --space <SPACE_KEY> --users <N>
```

Flags: `--user <accountId>` (scopes the grant to one user — **default choice**;
omit to grant the whole space) · `--days N` (default **7**; flows into the reply text
*and* the default `activatedBy`) · `--users N` (site tier → fills the Full-plan
price in the reply) · `--feedback-offer [N]` (repeat askers — promise N days,
default 15, for four answers; must exceed `--days`) · `--activated-by` (append the
ticket: `support:temp-7d-extension:ZEN-1191`) · `--no-reply` · `--dry-run`.

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
   `activatedBy:"support:temp-<days>d-extension"`, `expiresAt:"<+days>T23:59:59Z"`, plus
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

- **Full plan** (org-wide) — **read the live Marketplace prices, never compute an annual
  figure.** `--users N` makes the script call
  `/rest/2/addons/com.zenuml.confluence-addon/pricing/cloud/live` and quote both:
  **monthly** (cumulative per-user rates on the exact headcount) and **annual** (the flat
  price of the user *band* containing `n`). **The reply leads with the annual figure.**
  Monthly is the smaller number in isolation, but a reader costing out a purchase order
  multiplies it by 12 and lands *above* the annual price (902 users: $1,983 vs $1,760), so
  leading with monthly makes the app look more expensive to the one reader who does the
  arithmetic. What shrinks the number is the **per-user-per-month rate**, so keep that in the
  sentence — but derive it from the price the same sentence quotes. There are **two** rates:
  902 users is **$0.16** on annual ($1,760/902/12) and **$0.18** on monthly ($165.22/902).
  The public calculator shows 0.18 because its default view is Monthly; pairing that with the
  annual price overstates it. `full_plan_pricing()` returns both as
  `per_user_month_annual` / `per_user_month_monthly`. Monthly follows as an option
  with its extra annual cost named. No conversion data supports either ordering; this is the
  arithmetic, not a tested preference.
  - The retired `... * 10` formula was wrong between band boundaries: 902 users returned
    $1,652, while the published prices are **$165.22/month** and **$1,760/year** (band
    801-1000). It agreed only at a boundary (n=1000 → $1,760 both ways). Verified against
    the public calculator at 250 / 500 / 902 / 2954 users, 2026-08-27.
  - The payload carries a `unitCount: -1` "Unlimited users" sentinel in `perUnitItems`;
    skipping it matters, because sorted first it shifts every band by one user.
  - The script raises if the pricing API is unreachable. A wrong price in a customer
    reply is worse than a late reply — do not add a local fallback.
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

## Posting the reply into the JSM ticket

**Default path since 2026-08-16: curl with the local agent token.**
`.env.forge.local` carries `JSM_EMAIL` / `JSM_API_TOKEN` for `support@zenuml.com`
(agent-level, verified 200 on `/rest/api/3/issue/<KEY>` and
`/rest/servicedeskapi/request/<KEY>`). Post through the **servicedeskapi** endpoint,
never `/rest/api/3/issue/<KEY>/comment` — see § visibility in the `support-queue`
skill; the api/3 endpoint posts **publicly** regardless of what you omit.

```zsh
set -a && . ./.env.forge.local && set +a
curl -s -u "$JSM_EMAIL:$JSM_API_TOKEN" -H "Content-Type: application/json" \
  -X POST "https://zenuml.atlassian.net/rest/servicedeskapi/request/<KEY>/comment" \
  -d @/tmp/reply.json      # {"body": "<text, \n\n between paragraphs>", "public": true}
# then assert visibility on read-back:
curl -s -u "$JSM_EMAIL:$JSM_API_TOKEN" \
  "https://zenuml.atlassian.net/rest/api/3/issue/<KEY>/comment?maxResults=100" \
  | python3 -c "import sys,json;c=json.load(sys.stdin)['comments'][-1];print(c['jsdPublic'],c['created'])"
```

A public reply auto-transitions the ticket to *Waiting for customer* on this path
too — that behaviour is the desk's, not the UI's.

**Browser fallback (Playwright MCP)** — for anything the API refuses, and the only
route that gives ProseMirror-rendered structure control. Open the ticket, click
**Reply to customer**, paste, then click `[data-testid="comment-save-button"]`.
Don't type the reply (`browser_type` times out ~5s mid-word). Paste it in one call:
focus `#ak-editor-textarea`, build a `DataTransfer` with `setData('text/plain', …)`,
dispatch a synthetic `ClipboardEvent('paste', {clipboardData, bubbles:true,
cancelable:true})`.

Three ProseMirror traps, all of which shipped visible defects before being caught:

- **Separate paragraphs need `\n\n`.** A single `\n` becomes a *hard break inside one
  paragraph*, so the whole reply lands as one wall of text.
- **A numbered list swallows everything after it** if the following text is only one
  newline away — items 1–3 render fine and item 4 absorbs the pricing, sign-off and
  all. `\n\n` after the last question terminates the list.
- **Any `word.io` auto-linkifies** into a broken `http://Draw.io` smart link. Never
  name Draw.io in the reply text (the shipped question 2 says "Confluence's built-in
  diagramming tools" for exactly this reason).

**Verify before saving, not after** — read back `#ak-editor-textarea`: assert the
top-level block sequence (`P,P,…,OL,P,…`), 4 `li` items, and that every `a[href]` is
one of the two intended URLs. An element screenshot of the editor is unreliable
(the bounding box captures the wrong region).

Saving a **public** reply transitions the ticket to **Waiting for customer**
automatically — no manual transition, and none is offered in the action menu
(only Respond to support / Canceled / Resolved). Observed on ZEN-1199 and
ZEN-1200, 2026-08-12. That status is correct while a feedback answer is
outstanding; the ticket is still open work for us, because we owe the
follow-through grant when the answers land.

## After granting

1. **Log it** — append a dated entry to the handbook page
   `paywall/extension-request-replies.md` "Sent log" (tenant, space, site size,
   Full-plan price, whether it's a repeat request → conversion signal). Include the
   **KV key, the `activatedBy` (with ticket), and the distinct requester** — that
   entry is the only thing standing between the next handler and a miscounted
   "first request". If you discover an unlogged prior grant, backfill it in the same
   pass and say what you could and couldn't reconstruct.
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
   failure. Note this check needs the customer to come back and edit — right after a
   grant there is no post-grant data yet, so report the KV read-back as verified and
   the in-product check as **pending**, not as passed.
3. **If you made a `--feedback-offer`, the ticket is not done.** It's waiting on a
   reply. When the answers land: re-run with `--days <N>` on the same accountId,
   confirm the new date to the customer, and paste the answers into the sent-log
   entry — that intel is the whole return on the comp, and it's worthless if it
   only ever lives in a Jira comment.

## Outbound: raising the ticket FOR the customer (proactive champion-watch)

### Run `outbound_contact.py` — it does the whole flow, and only sends when told to

```bash
# PREVIEW — resolves the contact, pulls 90d usage, prices it, prints the letter. Sends nothing.
python3 .claude/skills/extend-space-license/scripts/outbound_contact.py \
    --domain <tenant> --space <SPACE> --ticket <ZEN-KEY> \
    --participant <inbound-requester-email> \
    --grants "23 June" "8 July" "7 August"

# SEND — only after the owner has approved contacting THIS tenant
… --send
```

**`--send` requires the owner's explicit go-ahead for that specific tenant, every time.**
It contacts a named person who has not written to us; the notification email cannot be
recalled, and it creates a portal account for them that **cannot be deleted** afterwards
(open access is on; customer removal returns 400). The default run stops after printing.
Everything else in this skill is standing procedure — this one is not.

What it assembles, so the letter argues from measurements rather than adjectives:

| Source | What it contributes |
|---|---|
| Marketplace snapshot (`marketplace` skill db) | technical contact, user tier, **reseller** |
| prod metrics KV | macros per space, which spaces are over 100, how many are `stale` |
| Mixpanel, `--days` window (default 90) | distinct viewers / creators / editors, and the paywall population: `paywall_triggered`, `paywall_blocked_create`, `paywall_attempts_exhausted`, `extension_request_clicked` |
| `full_plan_pricing()` | published annual + monthly price, per-user rate |

The argument the letter makes is **"N extensions do not cover M people"** — pass the prior
grant dates via `--grants` and it names them. On zeptonow that read: 6 extensions against
100 people who reached the limit in 90 days, of whom 25 clicked the request button and 5
filed a ticket.

Three behaviours worth knowing before reading its output:
- **Reseller rule is automatic.** If the licence carries `partnerDetails`, the letter names
  the partner as the invoicing route and the direct-Stripe Bundle link is **omitted** — a
  $299 card payment around a partner's invoice damages that relationship. With no partner,
  the Bundle is offered instead.
- **The CC needs a `qm:` desk accountId**, and the script resolves an email to one. Passing
  the `712020:…` id from the inbound ticket's description is rejected with an explanation:
  that id is the requester's Confluence account **on their own site** and 404s here.
- Counts exclude the `unknown_user_account_id` literal, and the macro total is reported as
  a floor because most spaces' KV entries are `stale`.

### Background and the trigger rule

Sometimes there is **no inbound request** — the trigger is our own champion-watch: a user is
about to exhaust (≤1 remaining) or has exhausted their continue-attempts, and the tenant has
**no live JSM thread**. Then we grant first (flow above) and open the conversation ourselves.
First done 2026-07-28: ZEN-1193 (tnexwm), ZEN-1194 (propertyguru), ZEN-1195 (xendit).

**Trigger rule (user ruling 2026-07-28 — do NOT blast):** outbound only when BOTH hold:
(a) a user exhausted or ≤1 `remaining_attempts_after` (7-14d window; the threshold was ≤5 when the default was 15 — with a default of 3 since 2026-08-16, ≤5 fires on the first click and is useless), (b) no live thread for the
tenant (JQL `project = ZEN AND text ~ "<domain>"` via `/rest/api/3/search/jql` — v2 search
silently returns empty). Tenants WITH a thread get an in-thread nudge instead; graduated-class
tenants are left alone. Blanket outbound to every over-limit tenant is support-costumed marketing
and exceeds JSM reply capacity — never do it.

**Who to address — the champion himself is unreachable.** This desk's `raiseOnBehalfOf` is
**email-only** (an accountId → 400 "not a valid email address"), and a foreign accountId (not a
member/customer of zenuml.atlassian.net) is untouchable: `/rest/api/3/user?accountId=` → 404,
JSM customer-add → 400 "users could not be found". The reachable, terms-sanctioned contact is
the **Marketplace license technical contact** — often a real customer-side person (tnexwm), often
the managing partner (propertyguru → Enreap, xendit → Padah). Extract from the marketplace-audit
snapshot (`sync` first if stale):

```bash
sqlite3 .claude/skills/marketplace/scripts/marketplace.db \
  "SELECT raw FROM licenses WHERE raw LIKE '%<domain>.atlassian%'" | python3 -c "
import sys,json
for l in sys.stdin:
    r=json.loads(l); cd=r.get('contactDetails',{})
    print(r.get('tier'), cd.get('technicalContact'), r.get('partnerDetails',{}).get('partnerName') if r.get('partnerDetails') else None)"
```

**Recipe — same-origin `servicedeskapi` fetch beats the ProseMirror UI dance.** From any
zenuml.atlassian.net page in the support@zenuml.com browser session (Playwright MCP
`browser_evaluate`); `customfield_10070` ("Plan you're interested in", `{id:"10037"}` = free
extension) is REQUIRED on request type 9 — omitting it 400s with the field name:

```js
// 1. create the ticket (201 → issueKey)
await fetch('/rest/servicedeskapi/request', { method:'POST', credentials:'include',
  headers:{'Content-Type':'application/json','X-Atlassian-Token':'no-check'},
  body: JSON.stringify({ serviceDeskId:'1', requestTypeId:'9',
    raiseOnBehalfOf:'<technical-contact-email>',
    requestFieldValues:{ summary:'ZenUML Lite limit reached in the <SPACE> space on <site> - temporary extension enabled',
      description:'Opened by ZenUML support on your behalf (you are the technical contact for ZenUML Diagrams on <site>) - details in the reply below.',
      customfield_10070:{id:'10037'} } }) });
// 2. post the real message as a public comment ('\n\n' between paragraphs)
await fetch('/rest/servicedeskapi/request/<KEY>/comment', { method:'POST', credentials:'include',
  headers:{'Content-Type':'application/json','X-Atlassian-Token':'no-check'},
  body: JSON.stringify({ body:'<adapted reply — proactive opening, NOT "thanks for reaching out">', public:true }) });
```

The reply is the standard template above with a proactive opening ("I'm reaching out because
you're listed as the technical contact for … — <N> people hit the limit last week; one editor
used up their continue-editing passes, we've already extended their account through <date>").
Remember the interaction: the grant hides the wall from that user for its duration, so their
in-product Request-extension path is dormant — the ticket is the only live channel. Log in the
sent-log as usual.

(Headless variant is now live: `JSM_EMAIL` / `JSM_API_TOKEN` in `.env.forge.local` since
2026-08-16. The two fetches above become two curl calls with `-u "$JSM_EMAIL:$JSM_API_TOKEN"`,
no browser session, cron-safe. The browser recipe stays as the fallback.)

## Related

- `tenant` skill — before granting, `whois <domain>` tells you the tenant's paid status / plan / any existing space-licenses / trial expiry, so you're not comping someone who already pays.
- `macro-count` skill — per-space macro counts (used here to verify the space key).
- `metrics` skill — single-space KV freshness diagnosis.
- Handbook: `paywall/extension-request-replies.md` (reply template + sent log),
  `paywall/runbook.md` (paywall rollout runbook).
