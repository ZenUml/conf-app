# Reviewed Magic writeback

An operator can stage a reviewed SVG for one Confluence Mermaid custom-content record. Fullscreen checks for staged work only when its Confluence artifact is missing or source-stale. It never generates an SVG. Original remains usable while delivery runs, and a miss or failure is silent.

Acceptance contract:

- The operator CLI uses Cloudflare's authenticated D1 API directly. There is no public staging endpoint. Dry run makes no network request. The operator explicitly supplies target cloud, Forge app, environment, installation, and content identifiers.
- `/magic-writeback` requires a verified Forge invocation token, user and system OAuth tokens, and a user principal. Tenant, app, environment, and installation come exclusively from verified claims. The request supplies only the numeric content ID.
- A queue miss makes no Confluence calls. A pending row requires a fresh user-authenticated read before any SVG is disclosed or any app write occurs. This prepared enrichment deliberately supports readers without editing rights, as the existing attachment enrichment does.
- The exact current custom-content type must belong to the authenticated variant. Trashed records and non-Mermaid bodies are refused.
- Exact UTF-8 `mermaidCode` hashing must match the staged artifact. Every conflict retry reads current content and permission again, rechecks the hash, and merges only `magic` into that fresh raw JSON. Unknown fields, title, and container are preserved. Three attempts bound conflicts.
- A valid existing same-source Magic artifact wins over queued work. Automatic delivery never replaces it. The browser's existing SVG sanitizer remains mandatory before display. An invalid or unsafe same-source artifact requires a separate authorized content repair; automatic delivery does not replace it.
- Queue rows use an atomic conditional claim with a 60-second lease and a random completion fence. Completion deletes only the claimed row after a successful Confluence PUT. Failures release the claim; interrupted requests recover when the lease expires. Source bodies are never queued. No source, SVG, or hashes appear in analytics or diagnostic logs.
- The browser applies a returned artifact only to the same content, source, and artifact snapshot. It preserves browser-local Original preference. After delivery, Confluence is the sole required storage for rendering and editing.

The default TTL is 24 hours (maximum 7 days). Expired rows are inaccessible immediately. Backend requests purge expired rows; the CLI also supports explicit purge for an idle queue. There is no automatic cleanup scheduler. Operators must run purge after the staging window when no customer view occurs.

Deploy the migration with the normal candidate-branch pipeline before staging artifacts. No new Forge scopes, remotes, model provider, generation service, or scheduler are required. Local tests can exercise the full backend transaction using synthetic Confluence responses; no production tenant or queue is needed.

Operator usage (keep real body/SVG snapshots in git-ignored `private/local-data/` or a private temporary directory):

```bash
# Dry run: no network request or credentials needed.
python3 tools/magic-writeback/stage.py --database-id <d1-database-uuid> stage \
  --cloud-id <cloud-id> --app-id <forge-app-uuid> --environment-id <forge-environment-uuid> \
  --installation-id <forge-installation-ari> --content-id <numeric-custom-content-id> \
  --body /private/tmp/body.json --svg /private/tmp/reviewed.svg --reviewed

# Stage exactly the reviewed dry-run target using existing Cloudflare account access.
# Provide CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the environment.
# Add --execute before the stage command when execution is authorized.

# Purge expired payloads after the window, even when nobody opened Fullscreen.
python3 tools/magic-writeback/stage.py --database-id <d1-database-uuid> --execute purge
```

Choose the database for the deployed backend, and obtain environment and installation identity from the verified installation context. An app or environment mismatch is a miss; customer-provided IDs never broaden the authenticated viewer's scope. Changing source (including whitespace) makes delivery fail closed. To replace an already valid Magic rendering, use a separate explicitly authorized editing workflow; this automatic path will preserve it.

A failed response/acknowledgement after a successful PUT may leave the staged payload until expiry. A subsequent request returns the existing Confluence artifact and does not replace it or delete a different queued generation. Purge removes this retained transport data. A lost success response can report `unavailable` even when Confluence persisted it; reopen Fullscreen to load Confluence as the authority.

Validation commands:

```bash
pnpm test:unit functions/magic-writeback.spec.ts src/components/Viewer/GenericViewer.spec.ts
python3 -m unittest discover -s tools/magic-writeback -p 'test_*.py'
```
