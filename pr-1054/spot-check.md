# Live check on lite-stg, 2026-11-05 (UTC)

Page: unpublished draft 382435338, space SD, robot test account. Real editor, real Publish, new macros.
`Math.random` was stubbed to 0 in the editor iframe, because `ai_title_*` events are sampled at 10%.
Signal: Mixpanel JQL on `client_domain = lite-stg`. `app_version` on each event names the build.
Build 98099f17 is the merge of 430514b6 into main. Build 8ad132bd is the merge of PR 1053, with the old logic.

| Build | Editor | Action | Saved title | `ai_title_modified` | `ai_title_accepted` |
|---|---|---|---|---|---|
| 8ad132bd | Sequence | Edited, Publish | Create New Order spotbefore1054 | 09:48:55 | 09:48:56, with the edited text |
| 8ad132bd | Sequence | Unchanged, Publish | Order Creation Flow | none | 09:52:13 |
| 98099f17 | Sequence | Edited, Publish | Create Order spotafter2 | 09:54:25 | none |
| 98099f17 | Sequence | Unchanged, Publish | Create Order | none | 09:54:49 |
| 98099f17 | OpenAPI | AI button, Publish | User API | none | 09:56:00 |

The no-event row is a real negative: `ai_title_modified` and `macro_create_succeeded` (09:54:27) from the same save reached Mixpanel.

One more run on 8ad132bd saved "Create Order spotafter1054" and fired accepted at 09:52:47. It was meant as an AFTER case, but the open tab still served the old build, so it counts as BEFORE. The page was reloaded before the 98099f17 rows.

Not run: Graph save path. It reads the same store title. Edit of an existing macro: auto-title does not run when a title exists.
