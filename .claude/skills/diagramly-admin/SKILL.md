---
name: diagramly-admin
description: >
  Navigate to the Diagramly admin panel on a Confluence site and interact with admin
  features (enroll space for demo page, etc.).
  Triggers on "diagramly admin", "enroll space", "create demo page admin".
---

# Diagramly Admin

Navigates to the Forge global settings page for the Diagramly admin module and performs admin actions.

## Admin panel URL pattern

```
https://<site>/wiki/admin/forge/apps/<appId>/<environmentId>/diagramly-admin-create-demo-page
```

The easiest way to reach it without knowing the IDs is through the Confluence UI:

1. Click **Confluence administration** (gear icon in top nav)
2. In the left sidebar, expand **Apps**
3. Click **Diagramly Admin — Create demo page (Staging|Production)**

## Environment → site mapping

| Environment | Site |
|---|---|
| Diagramly staging | `dia-stg.atlassian.net` |
| Diagramly production | `diagramly.atlassian.net` (confirm in `tests/e2e-tests/config/apps.ts`) |

## Enroll space for demo page

### Steps (Playwright)

```
1. Navigate to https://<site>/wiki/home
2. Click button "Confluence administration"
   → lands on /wiki/admin/configuration
3. In sidebar: click button "Apps" (expands region)
4. Click link "Diagramly Admin — Create demo page"
   → loads Forge iframe
5. Wait 3s for iframe to mount
6. Snapshot iframe: #iFrameResizer3 (the visible one; iFrameResizer2 is hidden)
7. Type space key into textbox "Space key"
8. Click button "Enroll space" (enabled once input is non-empty)
9. Wait 4s for resolver response
10. Snapshot iframe to read result paragraph
```

### Expected success response

```
paragraph: "Space <KEY> enrolled. The pipeline will create a demo page shortly."
```

### Known error codes

| Error | Meaning | Fix |
|---|---|---|
| `space_not_eligible` | Space type not in allowlist (`global`, `onboarding`) or status not `current` | Check space type via `/wiki/api/v2/spaces?keys=<KEY>` in browser console |
| `space_not_found` | Space key doesn't exist | Verify the key in Confluence |
| `caller_not_admin` | Logged-in user is not a site admin | Log in as a site admin account |
| `already_enrolled` | Space already enrolled | Idempotent — existing enrollment is returned |
| `already_exists` | Demo page already created for this space | Page exists; opt-out by deleting the page |

### Checking space type (browser console)

```js
const r = await fetch('/wiki/api/v2/spaces?keys=SD');
const b = await r.json();
console.log(b.results[0]); // check .type and .status
```

## Iframe selector notes

- The page renders **two iframes** (`iFrameResizer2` hidden, `iFrameResizer3` visible at 1410×626)
- Use `#iFrameResizer3` as the target for `browser_snapshot` and `browser_type`/`browser_click`
- Playwright crosses the cross-origin boundary; chrome-devtools-mcp and claude-in-chrome cannot

## Related skills

| Skill | When |
|---|---|
| **spot-check** | Verify the admin enroll flow end-to-end |
| **create-test-page** | Create a Confluence page via API (not the admin panel) |
