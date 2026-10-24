---
name: zenuml-upgrade-email
description: Write or revise a specific ZenUML Lite-to-paid-upgrade email, with ready-to-adapt templates for site-wide Full, a technical contact, an existing conversation, or a verified single-space need. Not for general email or other products.
---

# ZenUML Lite upgrade email

Use this skill to write the **actual customer email and Gmail draft**, not to rank customers. `customer-followup` chooses whom to contact and the commercial direction; [customer-tracker](../customer-tracker/SKILL.md) records the verified draft/send state. Read the [customer evidence rules](../customer-data/evidence.md) and [contact policy](../customer-followup/references/contact-policy.md). Keep real customer names, addresses and telemetry out of this public skill.

## 1. Fill the brief before writing

Record these fields from current original sources. A missing field is **unknown**, not zero or permission to guess.

| Field | Where to check | Use in the email |
|---|---|---|
| Recipient, verified first name, role, reseller | Existing thread, Marketplace/tenant record, referral | A technical contact is not automatically a site admin. |
| Last exchange and unresolved issue | Gmail draft/thread or support ticket | Acknowledge what they asked, declined or were promised. |
| One customer-specific reason | Mixpanel engagement, macro-count inventory, or their request/feedback | Use one or two facts, with product, complete window and snapshot date. |
| License, seats and offer | Marketplace/tenant, current pricing implementation | Full for site admin/licensing owner; single-space only for verified space user and need. |
| Current allowance/access | Product rule; tenant paywall/exemption evidence if claiming a block | Over 100 reported macros does **not** by itself mean editing is blocked. |
| Links | Verified tenant Plan and usage URL and current Full Marketplace listing | Explain what each link does; never invent a tenant deep link. |

If there is no verified customer-specific reason, recommend against an unsolicited upgrade pitch. Do not pitch over an unresolved support issue; address it first. If the user still asks for a draft, write a low-pressure version without invented numbers or urgency. For a missing material claim, query only the relevant `marketplace`/`tenant`, `mixpanel`, `macro-count`, Gmail or support-ticket source. Do not redo customer ranking.

Distinguish **unique known accounts**, **diagram views**, **creates/updates**, and **reported macro stock**. Mixpanel creates are not current inventory. Pick a fair complete 7-, 30- or 90-day window and state its dates and product scope. For growth, compare equal-length windows with the same event and account definitions; give a percentage only when the baseline is meaningful. A Marketplace click, trial end, free licence or technical-contact label is not buying intent or decision authority.

## 2. Choose one starting template

Replace every placeholder, delete unsupported optional sentences, then edit for the real thread. If a template's required metric is unavailable, substitute another verified customer-specific fact or choose a different template. These are **starting copy**, not permission to assert example facts. Keep one primary reply request. For a reply, preserve the thread's natural greeting and context.

### A. First Full approach to a verified site administrator or licensing owner

Do **not** mention the $299 single-space option.

> **Subject:** ZenUML Full for [ORGANISATION]'s Confluence site
>
> Hi [FIRST NAME],
>
> I'm [SENDER NAME] from ZenUML, the diagramming app your team uses in Confluence. During [COMPLETE WINDOW], [VERIFIED ACCOUNTS] accounts viewed ZenUML diagrams across your site. [OPTIONAL SECOND FACT: dated space inventory or customer request.]
>
> ZenUML Full is the site-wide option for teams using ZenUML across Confluence. [IF THE 100-MACRO ALLOWANCE IS RELEVANT, REPLACE THIS SENTENCE WITH THE ALLOWANCE BLOCK BELOW.]
>
> [INSERT THE VERIFIED PRICE/RESELLER BLOCK IF USEFUL.] [INSERT THE TWO-LINK BLOCK IF BOTH URLS ARE VERIFIED.]
>
> Would it help if I sent you a Full quote?
>
> Best regards,<br>[SENDER NAME]

### B. Full approach to a requester or technical contact whose authority is unknown

Use a known request or relationship; ask for a hand-off without calling this person the admin. If the customer buys through a reseller, use the reseller price block below.

> **Subject:** ZenUML Full for [ORGANISATION]'s Confluence site
>
> Hi [FIRST NAME],
>
> I'm [SENDER NAME] from ZenUML. [KNOWN COLLEAGUE/YOU] previously contacted us about [SPECIFIC SPACE OR REQUEST], so I wanted to share why ZenUML Full may now be relevant to your Confluence site.
>
> During [COMPLETE WINDOW], [VERIFIED ACCOUNTS] accounts viewed ZenUML diagrams across the site. The latest report for **[SPACE]** shows [VERIFIED MACRO STOCK] diagram macros, reported on [DATE]. ZenUML Full would cover the whole Confluence site. [IF THE 100-MACRO ALLOWANCE IS RELEVANT, REPLACE THIS SENTENCE WITH THE ALLOWANCE BLOCK BELOW.]
>
> [INSERT THE VERIFIED PRICE/RESELLER BLOCK IF USEFUL.] [INSERT THE TWO-LINK BLOCK IF BOTH URLS ARE VERIFIED.]
>
> If another colleague handles Confluence app licensing, could you please forward this note to them or introduce us? We can coordinate through your existing reseller if that is easier.
>
> Best regards,<br>[SENDER NAME]

### C. Follow-up in an existing conversation

Check the latest reply and earlier promise. Prefer the **change since the last exchange** to a second generic pitch. Omit the growth sentence if the comparison is invalid.

> **Subject:** [EXISTING SUBJECT]
>
> Hi [FIRST NAME],
>
> Following up on [SPECIFIC PRIOR QUESTION OR REQUEST]. Since our last exchange on [DATE], [METRIC] changed from [BASELINE] to [LATEST] over comparable [WINDOW]-day periods ([PERCENT]% increase). [OPTIONAL: one dated space-inventory fact.]
>
> Full would be the site-wide upgrade. [IF THE 100-MACRO ALLOWANCE IS RELEVANT, REPLACE THIS SENTENCE WITH THE ALLOWANCE BLOCK BELOW.] [INSERT THE TWO-LINK BLOCK IF THE LINKS HELP THIS DECISION.]
>
> Would it help if I [ONE SPECIFIC NEXT STEP: sent a Full quote / clarified the upgrade path / answered a product question]?
>
> Best regards,<br>[SENDER NAME]

### D. Verified space user with a verified single-space need

Use only when this person actually uses or owns the named space and the current single-space scope and price have been checked. This is **not** for a site administrator or site-wide procurement owner.

> **Subject:** ZenUML options for [SPACE] in Confluence
>
> Hi [FIRST NAME],
>
> Following up on your [SPECIFIC REQUEST] for **[SPACE]**. The latest report for that space shows [VERIFIED MACRO STOCK] diagram macros as of [DATE], so I wanted to check what would work best for your team.
>
> A single-space plan would cover **[SPACE]** at [VERIFIED CURRENT PRICE AND PERIOD]. If your team also needs other spaces covered, ZenUML Full is the site-wide option. [ADD A PLAN-AND-USAGE LINK ONLY IF VERIFIED AND HELPFUL.]
>
> Would a quote for **[SPACE]** help you decide?
>
> Best regards,<br>[SENDER NAME]

## 3. Insert only supported blocks

**Allowance block — only when a verified space is at/near 100 macros or expansion makes the limit relevant:**

> ZenUML Lite has a standard allowance of 100 diagram macros per Confluence space. The latest report for **[SPACE]** shows [COUNT] as of [DATE]. This may not affect your team today, but we may enforce the allowance in the future. Full removes this per-space limit across the site.

Check the current product rule before using it. To say the customer **is blocked**, also check this tenant's actual paywall and exemption state using [paywall](../paywall/SKILL.md). Never invent an enforcement date or use a threat. Avoid repeating “Full removes the per-space limit” if the template already says it.

**Two-link block — Full upgrade where both destinations are verified:**

> Your licensing team can review the current allowance on your site's [Plan and usage]([VERIFIED_TENANT_PLAN_URL]) page. If they prefer to install Full directly, they can do so from the [ZenUML Full listing on Atlassian Marketplace](https://marketplace.atlassian.com/apps/1218380/zenuml-diagrams-for-confluence).

The first URL must belong to the customer's Confluence site and Lite production app; verify the app/environment/route. The Marketplace link is a **direct Full installation entry**, not merely a page to read. Verify the listing still resolves before use. If the first URL cannot be established, omit that half rather than fabricating it. Do not make installing directly the only path when an existing reseller handles procurement.

**Price/reseller block — only with current verified seats and price:**

> At your current [SEATS] seats, the public annual list price for ZenUML Full is [CURRENCY/AMOUNT]; your existing reseller can confirm the final quote.

Use current Marketplace pricing implementation and distinguish public list price from the partner's final quote. Never promise a discount, hardcode a break-even seat threshold, or calculate annual price as ten monthly payments. For a direct customer without a reseller, remove the reseller clause. The single-space price is an internal reference until its current checkout/quote is verified.

## 4. Save and verify the actual draft

1. Check the latest original thread, current draft, actual To/Cc, subject and any scheduled version. Do not create a duplicate draft. A send/schedule request is separate from a draft request.
2. Read as a recipient with no CRM context. Identify ZenUML **for Confluence**, why this customer is being contacted, the proposed offer, and **one** easy way to reply. Remove internal shorthand, unsupported rankings, stale facts and duplicate asks.
3. Check every number's source, product/version, complete window and source timestamp. Check role, price, limit claim, reseller wording and link destinations. After a long gap or on first contact, include the verified Confluence app name and Marketplace listing link. Use a verified first name; otherwise use a neutral greeting. Match the sender name and sign-off to the sending account.
4. Make one HTML `<p>` per paragraph, with **no hard line break inside a paragraph**. Create a plain-text alternative. Render space keys in **UPPERCASE AND BOLD** in HTML (`<strong>SPACE</strong>`), uppercase in plain text; do not change case-sensitive keys inside URLs or source records.
5. When asked to write or modify, update the existing Gmail draft using authenticated `gws` CLI for supported actions. When asked only for an opinion or review, give the review without silently changing the draft. Close an open compose window before a CLI edit so browser autosave cannot overwrite it. Preserve recipients and thread, then read back the saved MIME; use UI to verify rendering if useful. If CLI auth/scopes fail, report the specific error and stop this write rather than silently switching to UI.
6. Send or schedule only within the user's actual authorisation. Before either, recheck final draft, latest reply, recipients and existing scheduled messages; for scheduling verify the recipient's timezone and date. Verify the resulting Gmail state. Pass verified state, evidence dates and message link to [customer-tracker](../customer-tracker/SKILL.md) for any requested or workflow-required record update. Report **draft / scheduled / sent** accurately.
7. After creating or revising a draft, proactively recommend when to send it. Base the recommendation on the recipient's verified timezone and local weekday/time. State the exact recipient-local date and time and the corresponding exact date and time in Australia/Melbourne. If the recipient's location or timezone is uncertain, label the assumption explicitly and treat the conversion as provisional. A recommendation is advisory only; it does not authorise sending or scheduling.
