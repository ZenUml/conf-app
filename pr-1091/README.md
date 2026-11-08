# PR 1091 evidence: page banner space after SPA navigation

BEFORE build: main `bed9f1f6` on lite-stg, captured 2026-11-08 20:29 UTC.
AFTER candidate: `a06462d9` (PR merge build `e96b0a28`), lite-stg, captured 2026-11-08 20:45 UTC.

Account: robot test user. `mockCSSEnabled` was set in the macro iframe origin because lite-stg is paywall-exempt. `SD` has a real count of 48203. The personal space has a real count under the limit.

| Step | BEFORE | AFTER |
|---|---|---|
| Direct load, `SD` | banner 48203 | banner 48203 |
| Quick find, `SD` to personal | banner 48203 (wrong) | no banner |
| Direct load, personal | no banner | no banner |
| Quick find, personal to `SD` | no banner (wrong) | banner 48203 |

AFTER raw context, quick find personal to `SD`: `extension.space.key` is the personal key, `extension.location` is `/wiki/spaces/SD/...`, banner correct.

Mixpanel AFTER, lite-stg, mocked admin verdict because the robot is not a space admin:
`paywall_banner_shown` space_key SD, confluence_space SD, space_context_stale true.
`paywall_bundle_cta_clicked` client_reference_id lite-stg__SD, space_context_stale true.

Tunnel, lite-dev, candidate `a06462d9` plus one uncommitted seed line (reverted). The seed wrote an `SD` marker whose count encoded the raw context: 77777 when context said `SD`, 66666 otherwise. `tunnel-4` shows 66666 on `SD`, so the context was stale and the banner was still right.
