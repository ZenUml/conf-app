# Daily new-install welcome workflow

## Purpose

At 09:00 Australia/Melbourne every day, identify genuinely new Marketplace
installations across the registered product portfolio, prepare a useful welcome
email **draft** when it is safe to do so, and leave an auditable Airtable trail.
The workflow never sends mail automatically.

It is an onboarding review, not a conversion, payment, or customer-health
workflow. Payment, entitlement, and communication state remain separate.

## Scope and product registry

Use `.claude/skills/customer-data/products.json` as the product source of
truth. It currently contains the four Forge products and Mini Sites. A product
whose Marketplace or Forge identity is unavailable must be reported as
unsupported; it must not silently disappear from the scan.

The process only evaluates active Marketplace-entitled installs. It excludes:

- renewals and extensions;
- migration or historical-backfill rows;
- a second product at a customer already known to the CRM;
- test/internal records;
- records already handled under the same install key.

An uncertain company match is a review candidate, never an automatic welcome
draft.

## Detection and evidence

Marketplace licence snapshots are the primary detector. The first successful
run establishes a private baseline and creates no historical emails. Later
runs compare the current source snapshot with the last successful baseline.

Forge-install snapshots are a supplementary signal. They can corroborate an
addition, but cannot replace Marketplace entitlement evidence. Existing
`new-customers`, `forge-installs`, and `customer-lifecycle` primitives provide
the underlying evidence; the new workflow orchestrates them and does not create
a competing classifier.

For each candidate, retain the source record identifier, product, observation
time, entitlement state, prior-history result, baseline age, and any known
Forge corroboration. Derive a stable install key from the Marketplace
site/product/entitlement identity so reruns are idempotent.

## Contact gate and draft policy

Before drafting, look up the Marketplace registered contact, relevant Gmail
history, and existing Airtable client/contact/activity records.

A welcome draft is eligible only when all of these are true:

1. the installation is newly observed and active;
2. no prior welcome has been recorded for the install key;
3. no prior customer conversation makes a first-install welcome misleading;
4. the recipient is a verified individual work email, rather than a free-mail
   address, shared alias, or unverified role contact.

All other candidates are stored with an explicit skip or review reason. A
template is selected by product, names the product accurately, and asks one
low-friction question or offers one help path. It creates a Gmail draft only;
there is no send operation in this workflow.

## Airtable record model

Use the existing CRM tables and upsert rather than duplicate records:

- **客户:** find the existing customer, or create a minimal customer record
  when no reliable match exists.
- **联系人:** attach a verified contact where available, preserving contact
  verification status and source.
- **活动:** create one immutable installation-review activity per install key,
  with the detection evidence, decision, Gmail draft identifier where created,
  or the precise skip/review reason.

The run must not overwrite payment, opportunity, or demand status. Airtable is
the operational audit trail; the full Marketplace source snapshot remains in
private local storage.

## Private state, failure handling, and notification

Keep baselines and execution checkpoints in the private operations store, not
in the public repository. Replace the baseline only after every required source
query and downstream write for the run succeeds.

Every external operation must be idempotent. Before creating a draft, check the
install key in Airtable and Gmail so that a partial prior run cannot create a
duplicate. Include the install key in the draft metadata or another durable
lookup field.

If Marketplace, Gmail, or Airtable authentication or an essential query fails:

- create no new draft;
- do not advance the baseline;
- write a failure checkpoint when that store is still available;
- report the failed system and the actionable authentication/error detail.

The daily automation stays quiet when there are no candidates. It reports only
created drafts, review candidates, or failures that need attention.

## Schedule and execution boundary

The intended scheduler is a Codex thread heartbeat at 09:00
Australia/Melbourne, including weekends. It executes the repository workflow
through CLI adapters first:

- Marketplace through the authenticated reporting CLI;
- Gmail through the authenticated Google Workspace CLI;
- Airtable through its configured API/CLI adapter.

The browser is limited to verification or a capability unavailable to those
adapters. Authentication errors must be reported, not bypassed through UI.

## Validation

Use fixture-based tests and a dry-run mode before enabling a heartbeat. Cover:

1. first successful run establishes a baseline without drafts;
2. a genuine first installation creates exactly one eligible draft and activity;
3. renewal, migration, backfill, second-product, and internal records are
   excluded with the correct reason;
4. a repeated run creates neither a duplicate draft nor a duplicate activity;
5. an uncertain/invalid contact becomes a review record without a draft;
6. Gmail or Airtable write failure leaves the baseline unchanged;
7. a later successful retry reconciles a partial run without duplication.

After a dry-run passes, use CLI read-back to verify the draft and Airtable
activity. A browser inspection may be used as an additional verification step.

## Explicit non-goals

This workflow does not auto-send email, infer purchase intent, modify licenses
or paywalls, classify trial-to-paid conversion, or replace the broader
customer-followup workflow.
