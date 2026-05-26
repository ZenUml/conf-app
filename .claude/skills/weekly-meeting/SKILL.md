---
name: weekly-meeting
description: Prepare weekly meeting data — fetches 30-day Marketplace revenue, new/large/lost customers, and updates the "Weekly Meeting Prep" panel at the top of the client profiles homepage (http://localhost:52401/). Use when the user says "weekly meeting", "prep for the meeting", "update the weekly meeting section", or "what's our revenue this week".
---

# Weekly Meeting Prep

Fetches Atlassian Marketplace transaction data for the past 30 days, processes it, and updates the "Weekly Meeting Prep" section in `private/client-profiles/index.html`.

## Prerequisites

A browser tab must be open and **logged into** `marketplace.atlassian.com` (as the vendor). The skill uses that session's cookies via `mcp__playwright__browser_evaluate` to call the REST API — no separate auth token is needed.

If the browser is not already on a Marketplace page, navigate there first:
- Target page: `https://marketplace.atlassian.com/manage/vendors/1215266/reporting/sales?period=past30Days`

## Step 1 — Fetch all transactions (past 30d)

Use `mcp__playwright__browser_evaluate` to call the REST API from the browser context (authenticated via cookies). Paginate until all transactions are collected.

```javascript
async () => {
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  const startDate = start.toISOString().split('T')[0];

  let allTx = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `https://marketplace.atlassian.com/rest/2/vendors/1215266/reporting/sales/transactions` +
      `?endDate=${endDate}&startDate=${startDate}&excludeZeroTransactions=true` +
      `&limit=${limit}&period=past30Days&offset=${offset}`;

    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return JSON.stringify({ error: resp.status });
    const data = await resp.json();
    const txs = data.transactions || [];
    allTx = allTx.concat(txs);
    if (txs.length < limit) break;
    offset += limit;
  }

  // Process
  const revenue = { total: 0, vendor: 0 };
  const byType = {};
  const byCompany = {};

  for (const tx of allTx) {
    const pd = tx.purchaseDetails;
    const cd = tx.customerDetails;
    revenue.total += pd.purchasePrice || 0;
    revenue.vendor += pd.vendorAmount || 0;
    byType[pd.saleType] = (byType[pd.saleType] || 0) + 1;

    const key = cd.company;
    if (!byCompany[key]) {
      byCompany[key] = { total: 0, vendor: 0, types: [], country: cd.country };
    }
    byCompany[key].total += pd.purchasePrice || 0;
    byCompany[key].vendor += pd.vendorAmount || 0;
    byCompany[key].types.push(pd.saleType);
  }

  const companies = Object.entries(byCompany);
  const r = v => Math.round(v * 100) / 100;

  return JSON.stringify({
    startDate, endDate,
    totalTransactions: allTx.length,
    totalRevenue: r(revenue.total),
    vendorRevenue: r(revenue.vendor),
    byType,
    newCustomers: companies
      .filter(([, v]) => v.types.includes('New'))
      .map(([k, v]) => ({ company: k, country: v.country, total: r(v.total) })),
    upgradedCustomers: companies
      .filter(([, v]) => v.types.includes('Upgrade'))
      .map(([k, v]) => ({ company: k, country: v.country, total: r(v.total) })),
    downgradedCustomers: companies
      .filter(([, v]) => v.types.includes('Downgrade'))
      .map(([k, v]) => ({ company: k, country: v.country, total: r(v.total) })),
    largestCustomers: companies
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([k, v]) => ({ company: k, country: v.country, total: r(v.total), types: v.types }))
  });
}
```

Parse the returned JSON to extract the data fields.

## Step 2 — Build the Weekly Meeting HTML section

Using the data from Step 1, build the replacement HTML block. The section is identified by the comment `<!-- Weekly Meeting Prep — updated by /weekly-meeting skill -->` in `index.html`.

**Revenue KPI strip:** 5 tiles — Revenue (30d), Vendor take (30d), Renewals count, New customers count, Largest deal.

**Three-column grid:**
- **New customers**: List companies with `saleType="New"`. If none, show "None this period" in muted text.
- **Largest customers (30d)**: Top 5 by total purchase price. Color downgraded companies red (`#c0392b`) and annotate `↓`, color upgraded green (`#16a34a`) and annotate `↑`.
- **Upgraded / Downgraded**: List `saleType="Upgrade"` entries in green, `saleType="Downgrade"` in red.

**Date range label:** `{startDate} → {endDate} · Updated {today}`.

## Step 3 — Update index.html

Find the block between:
```html
<!-- Weekly Meeting Prep — updated by /weekly-meeting skill -->
```
and the next:
```html
      <div class="hp-section">
        <h2>All profiled tenants</h2>
```

Replace the entire block (from the comment down to, but not including, the "All profiled tenants" section) with the newly generated HTML.

Edit `private/client-profiles/index.html` using the Edit tool.

## Step 4 — Commit and surface

```bash
cd ~/workspaces/zenuml/conf-app/private
git add client-profiles/index.html
git commit -m "chore(client-profiles): weekly meeting prep $(date +%Y-%m-%d)"
```

Then bump submodule pointer:
```bash
cd ~/workspaces/zenuml/conf-app
git add private
git commit -m "chore(private): bump submodule — weekly meeting $(date +%Y-%m-%d)"
```

Ensure server is running and print:
```
→ http://localhost:52401/#weekly-meeting
```

## Key facts

- **Vendor ID:** `1215266`
- **REST API base:** `https://marketplace.atlassian.com/rest/2/vendors/1215266/reporting/sales/transactions`
- **Auth:** browser cookies (no API key needed when fetched from `mcp__playwright__browser_evaluate` while logged in)
- **Sale types:** `New`, `Renewal`, `Upgrade`, `Downgrade`, `Refund`
- **"New customers"** = `saleType: "New"` — first-ever paid subscription
- **"Large customers"** = top 5 by `purchasePrice` in the 30d window
- **"Lost/at-risk"** = `saleType: "Downgrade"` or `changeInTier: "Decrease"` in Renewal transactions
- **Server port:** `52401`
- **Output file:** `private/client-profiles/index.html`
