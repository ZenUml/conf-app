# PR 1089 evidence: title-first diagram offer

- BEFORE: `c2ac76e2` (merge-base with `main`). The offer does not exist there.
- AFTER: `efd07db1`, deployed as PR merge commit `11726866` by CI run 42474145678.
- Site: Lite staging, robot test account, viewport 1280x577. Fixture pages have invented titles.

| Step | File | Observed |
|---|---|---|
| Entry flag | `01-entry-flag.png` | Title, description, `See diagram`, `Not now` |
| Preview panel | `02-preview.png` | Forge xlarge modal, `Based on the page title`, note left of `Add to page` |
| Added | `03-added.png` | Macro at top, success flag, viewer Edit visible |
| Edit diagram | `04-editor.png` | Editor opens on the Mermaid tab with the drafted source |
| Undo | `06-after-undo.png` | Macro removed, page back to its paragraph |
| Not now | `07-not-now.png` | `Diagrams Lite` copy, no Undo |
| Storybook | `storybook-*-efd07db1.jpg` | Panel states at 968x681 |

Page body and property were read back over REST after Add and Undo. Queue state was read from staging D1.

Forge Tunnel screenshots are not included: they show a Confluence sidebar that names a customer.
