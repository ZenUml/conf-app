# Forge-only policy

## Policy

All production variants (`lite`, `full`, and `diagramly`) run as Atlassian Forge apps. Do not add new Connect runtime code.

The only supported Connect references are migration artifacts that Atlassian requires for Forge-from-Connect upgrades:

- `manifest.yml` `app.connect`
- Connect keys and migrated custom-content keys in `manifest.yml`
- `connectModules` entries that keep lifecycle upgrade/uninstall paths working
- comments or compatibility code that explain how legacy Connect-era data is read after migration

## Banned in product code

Do not introduce:

- `AP.*` browser APIs
- `xdm_e` or other Connect URL parameters as production environment detection
- Connect host iframe resize or navigation bridges
- new Connect descriptor files or Connect module definitions outside the migration bridge in `manifest.yml`
- DrawIO URLs or code paths that assume the old Connect host integration

Use Forge APIs instead:

- `@forge/bridge` `view`, `router`, `requestConfluence`, `invoke`, and `invokeRemote`
- Forge manifest modules and remotes
- Forge environment variables and product-specific build configuration

## Allowed legacy handling

Legacy data still exists in customer sites. Code may preserve compatibility with Connect-era macro parameters, custom content IDs, titles, and storage shapes when reading or repairing migrated content.

When adding compatibility code, keep it narrow and label it as legacy/migration handling. Do not use legacy compatibility as a reason to add new Connect execution paths.

## When unsure

Before adding a platform integration, verify whether the code will execute in Forge Custom UI, a Forge function, or a Cloudflare remote invoked by Forge. If the answer requires Connect runtime behavior, stop and redesign around Forge.
