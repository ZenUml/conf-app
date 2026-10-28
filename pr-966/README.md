# PR #966 review evidence

Captured 2026-10-28. Public, fictional Storybook fixtures only.

- BEFORE: `5eacd6b7c89515bdc26a0edbf7b7ee03f013ff5e` (PR merge-base/main at capture).
- AFTER runtime: `598404385b54fe18c015f438443409c808b53567`.
- Subsequent PR commits `bdee06a3` and `b053eec6` add only the support-materials skill and workflow documentation. No runtime code changed; this does not imply CI was rerun on the earlier SHA.
- Source: locally served Storybook manager with Forge bridge fixtures, **not live Confluence**. Chromium, outer viewport 1580 × 1500; captured preview iframe 1280 × 1160, same for both versions.

## Comparable screenshots

| Steps | BEFORE | AFTER |
|---|---|---|
| Open Plan and usage, 131 reported diagrams / 1 over-limit space | [usage](before-usage.png) | [usage](after-usage.png) |
| Click Request Full on that same usage fixture | [request](before-request.png) | [request](after-request.png) |
| Open locations; wait for first page of 35 accessible fixtures; check restricted diagram absent | [locations](before-locations.png) | [locations](after-locations.png) |

The paired captures show the stats cards becoming a compact row, the shorter request flow and buttons, and the locations table dropping the Last updated column and page-size selector. Coverage and owning-page caveats remain visible in locations. Both versions show the same first ten records. This comparison proves the rendered presentation with fixtures, not live permissions or data freshness.

Supplemental AFTER-only captures from the same runtime commit: [Fullscreen contact](fullscreen-contact.png), [existing Fullscreen request upgrade guidance](fullscreen-existing-request.png). These were captured in the preceding validation at a smaller viewport; they are not BEFORE/AFTER pairs.

## Reproduction

Use separate worktrees at the two SHAs. Install the pinned pnpm 10.34.5 dependencies. From each root run `PRODUCT_TYPE=lite node_modules/.bin/storybook dev -p <port> --ci` (6007 BEFORE, 6006 AFTER). Run [capture.cjs](capture.cjs) with Playwright and Chromium available; update its absolute workspace/output/browser paths for your machine. It opens the Storybook manager, because these Forge bridge fixtures require a nested preview. The stories are `plan-and-usage-planusage--default` and `--locations`; Request Full is a real button click. [Capture output](capture.log): all six captures passed their assertions. Images were visually inspected, including the entire table and pager.

## Validation evidence

- [Component test raw output](component-tests.log): `vitest run src/components/PlanUsage --maxWorkers=2 --minWorkers=1`, 3 files / 22 tests passed (PlanUsage 10, DiagramLocations 10, fullscreenSource 2). The expected 500 response belongs to the error-state test.
- [Earlier local validation excerpts](validation-excerpts.txt): lint 0 errors / 138 warnings; Full build including MCP app passed. Full unit run initially 5,893 passed / 3 failed / 3 skipped because the discovery suite lacked its separate E2E dependencies. Its retry passed all 4 tests after installation, giving 5,896 distinct passing tests, 3 skipped. Excerpts are not the complete logs.
- Previously checked AFTER-only interactions: search/type/space filtering, paging to the last page, empty/error states, and Fullscreen contact/request guidance. These are browser fixture checks, not deployed E2E results.

## Limits

Forge Tunnel is blocked by absent Forge credentials/authenticated Confluence identity. Manual staging UI verification has not run because that stage follows Tunnel. CI status is linked separately in the PR body and must be read for its exact head SHA; green CI does not substitute for those manual stages. No claim is made that these screenshots show production or that this PR is ready to merge.

The new skill's frontmatter, references, and diff formatting were checked. This PR applies the new support-material format; its automatic adoption by a future independent agent session has not been observed.
