# Remove Diagram Audience HMAC Design

**Date:** 2026-08-13  
**Status:** Approved for implementation  
**Supersedes:** The HMAC-specific storage and deployment decisions in `2026-08-12-diagram-attribution-impact-design.md`

## Objective

Remove the HMAC-derived viewer identity from diagram audience counting. Store the trusted Atlassian account ID directly in D1 and keep the existing attribution and unique-colleague count behavior.

The change deliberately trades pseudonymisation for simpler software and infrastructure. Atlassian account IDs are personal data and remain subject to the product's privacy, access-control, retention, and deletion obligations.

## Scope

The behavior that remains unchanged is:

- Only a viewer whose diagram footer is at least 50% visible for three continuous seconds while the document is visible qualifies.
- Creators, last updaters, and historical contributors are excluded.
- The first qualified view returns `new_unique`; later views return `repeat`.
- Repeated views on later UTC days update `lastViewedAt` and increment `viewDays` without increasing the unique audience count.
- The UI displays only the aggregate colleague count. It does not expose viewer identities.
- Existing diagram-impact analytics events and their triggers remain unchanged.

The change removes:

- `DIAGRAM_IMPACT_HMAC_SECRET` as a runtime dependency.
- HMAC/Web Crypto viewer-key derivation.
- The `viewerKey` storage concept and related tests and documentation.

## Data model and migration

`DiagramAudience` will use this schema:

```sql
CREATE TABLE DiagramAudience (
  cloudId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  customContentId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  firstViewedAt TEXT NOT NULL,
  lastViewedAt TEXT NOT NULL,
  viewDays INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (cloudId, forgeAppId, customContentId, accountId)
) WITHOUT ROWID;

CREATE INDEX idx_diagram_audience_account
  ON DiagramAudience (cloudId, accountId);
```

Existing `viewerKey` values cannot be converted back to account IDs. The migration therefore rebuilds the table without copying existing rows. Existing colleague-viewed counts reset to zero once the migration is applied. It must not preserve HMAC strings in the `accountId` column or introduce a mixed-format compatibility layer.

This migration changes only the derived audience counter. It does not modify Confluence custom content or diagram bodies.

## Backend flow

The authenticated request continues to derive `cloudId`, `forgeAppId`, and `accountId` exclusively from verified Forge context. Identity fields supplied by the client remain forbidden.

After confirming that the custom content is readable and that the caller is not a contributor, the service passes the trusted `accountId` directly to the repository. The repository uses it in the composite primary key for insert, lookup, and daily repeat updates.

The missing-secret `503 impact_unavailable` path disappears. Other authentication, authorization, content-read, D1, and validation failures keep their existing behavior.

## Infrastructure and rollout

No audience-specific secret is required after this change. Code and documentation must stop listing `DIAGRAM_IMPACT_HMAC_SECRET` as a deployment prerequisite.

Do not delete a live Pages secret before the direct-account-ID backend has been deployed and validated. For each Pages project where the secret exists:

1. Deploy the migration and direct-account-ID backend.
2. Validate a non-contributor's first qualified view (`new_unique`), aggregate count, and repeat behavior.
3. Delete `DIAGRAM_IMPACT_HMAC_SECRET` from that Pages project.
4. Confirm registration still succeeds after the secret deletion.

Diagramly and Lite share the `conf-lite` production backend, so that secret is removed only after a compatible backend deployment is live there. This design does not authorize releasing any additional Forge variant.

## Privacy and security

- `accountId` must never be returned by the audience APIs, displayed in the UI, or added to analytics or application logs.
- D1 access remains restricted to backend and operational access paths.
- Privacy documentation must describe account ID storage accurately; it must not call the audience data anonymous or pseudonymous after this change.
- Existing data-subject access or deletion workflows can locate rows by `(cloudId, accountId)` without an HMAC secret.
- Retention-policy changes are outside this refactor; this change must not silently add new tracking fields or expand the purposes for which audience data is used.

## Analytics

No new event is required because this refactor does not introduce a new user lifecycle moment. The existing events remain the success and failure signals:

- `diagram_attribution_shown`
- `diagram_audience_registration_succeeded`
- `diagram_audience_registration_failed`

The implementation must not add `accountId` to their properties.

## Validation

Local validation must cover:

- Repository SQL uses `accountId` for lookup, insert, and update.
- First view, same-day repeat, later-day repeat, and concurrent insert semantics remain unchanged.
- Contributor exclusion does not write an audience row.
- Registration succeeds without any HMAC secret in the environment.
- HMAC derivation code and all `DIAGRAM_IMPACT_HMAC_SECRET` runtime references are absent.
- The migration creates the new schema and intentionally does not copy old audience rows.
- Existing API, attribution footer, and viewer tests remain green.
- Lite and Diagramly builds succeed because they share the affected backend and viewer surface.

Post-deployment validation must observe UI evidence, a successful view response, and the corresponding D1 row before declaring the change passed.
