# Lite Forge App — Operations

## Identity

| Field | Value |
|-------|-------|
| **APP_ID** | `8ad26115-211f-4216-971b-0540f606303d` |
| **CONNECT_KEY** | `com.zenuml.confluence-addon-lite` |
| **Production URL** | `https://conf-lite.zenuml.com` |
| **Env File** | `.env.forge.lite` |
| **Product Type** | `lite` |

## Staged Migration

Tracked at [ECOHELP-96539](https://ecosystem.atlassian.net/servicedesk/customer/portal/34/ECOHELP-96539) — **re-opened**

Re-opened (15 Feb): Restriction was lifted on 4 Feb, but 11 days later 200+ clients have not migrated (66 active in past 30 days). Asked Atlassian to investigate.

Active clients not yet migrated (past 7 days):
- taskplatform.atlassian.net
- syscobt.atlassian.net
- aucklandcouncil.atlassian.net
- medline-confluence.atlassian.net
- fireblocks.atlassian.net
- uxtechnology.atlassian.net
- readytech.atlassian.net
- nexigroup-italy.atlassian.net
- boomii.atlassian.net
- originenergy.atlassian.net

**Verified 20 Feb 2026:** None of the above 10 clients appear in `forge install list -e production`. They have not migrated to Forge.
