# ZEN-1170 — `--no-verify` workaround status

Tracking whether the `--no-verify` workaround (added PR #116, 2026-05-22) can be reverted.

The workaround added `--no-verify` to staging Forge deploy scripts because `@forge/lint`
unconditionally fetches Atlassian OpenAPI spec URLs at startup — all of which were returning
HTTP 404 with an empty body, causing `Unexpected end of JSON input` and aborting the deploy.

---

## 2026-05-22 — Workaround added (PR #116)

Affected URLs (all returned HTTP 404, size 0):
- https://developer.atlassian.com/cloud/bitbucket/swagger.json
- https://developer.atlassian.com/cloud/confluence/openapi-v2.v3.json
- https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json
- https://developer.atlassian.com/cloud/jira/service-desk/swagger.v3.json
- https://developer.atlassian.com/cloud/jira/software/swagger.v3.json

---

## 2026-05-22 — Recheck (automated)

Polled all 5 URLs from the CI container environment. Results:

| URL | HTTP status | Size | Body |
|-----|-------------|------|------|
| `.../bitbucket/swagger.json` | **403** | 21 | `Host not in allowlist` |
| `.../confluence/openapi-v2.v3.json` | **403** | 21 | `Host not in allowlist` |
| `.../jira/platform/swagger-v3.v3.json` | **403** | 21 | `Host not in allowlist` |
| `.../jira/service-desk/swagger.v3.json` | **403** | 21 | `Host not in allowlist` |
| `.../jira/software/swagger.v3.json` | **403** | 21 | `Host not in allowlist` |

**Interpretation:** All 5 URLs return HTTP 403 "Host not in allowlist" rather than the original
404. This is ambiguous — the 403 body suggests Atlassian's CDN/WAF is blocking requests from
the container's egress IP rather than the endpoint being gone. The URLs may be accessible from
non-containerized environments (e.g., a developer workstation), but they are not confirmed 200
with valid JSON from this environment.

**`forge lint` test:** Could not complete. `forge lint` requires `FORGE_EMAIL` and
`FORGE_API_TOKEN` environment variables which are not present in this cloud execution
environment. The analytics consent prompt was bypassed via `FORGE_DISABLE_ANALYTICS=true`,
but the subsequent authentication check failed with:
> `Error: Not logged in. If a local keychain is available, run forge login...`

**Decision:** Do NOT revert. Conditions for revert (all 5 URLs return HTTP 200 with valid JSON
AND `forge lint` succeeds) are not met. The 403 responses are ambiguous and could mask a
continued outage from a different network.

**Recommended manual recheck:** From a developer workstation (not a container), run:
```bash
for url in \
  https://developer.atlassian.com/cloud/bitbucket/swagger.json \
  https://developer.atlassian.com/cloud/confluence/openapi-v2.v3.json \
  https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json \
  https://developer.atlassian.com/cloud/jira/service-desk/swagger.v3.json \
  https://developer.atlassian.com/cloud/jira/software/swagger.v3.json; do
  echo "=== $url"
  curl -s -o /tmp/spec.json -w 'HTTP %{http_code}  size %{size_download}\n' --max-time 15 "$url"
  head -c 200 /tmp/spec.json && echo
done
```
Then run `FORGE_DISABLE_ANALYTICS=true FORGE_EMAIL=<you> FORGE_API_TOKEN=<token> pnpm exec forge lint`.
If all URLs are 200 and lint passes, revert per the steps in PR #116 description.

---

## 2026-05-23 — Recheck (developer workstation) — REVERTED

Polled all 5 URLs from a developer workstation. Results:

| URL | HTTP status | Size | Body |
|-----|-------------|------|------|
| `.../bitbucket/swagger.json` | **200** | 949538 | valid `{"swagger": "2.0", ...}` |
| `.../confluence/openapi-v2.v3.json` | **200** | 597164 | valid `{"openapi":"3.0.3", ...}` |
| `.../jira/platform/swagger-v3.v3.json` | **200** | 2446932 | valid JSON |
| `.../jira/service-desk/swagger.v3.json` | **200** | 359722 | valid JSON |
| `.../jira/software/swagger.v3.json` | **200** | 658032 | valid JSON |

**`forge lint`:** Completed successfully — `0 errors, 4 warnings`. The 4 warnings are
pre-existing deprecated egress permission entries in `manifest.yml`, unrelated to the
ZEN-1170 OpenAPI fetch crash.

**Decision:** Revert. Both revert conditions met (all 5 URLs return HTTP 200 with valid
JSON AND `forge lint` succeeds).

**Action taken:** Removed `--no-verify` from all 6 deploy scripts in `package.json`
(`forge:deploy:{lite,full,diagramly}:{staging,prod}`) and removed the corresponding
TODO block in `.github/workflows/staging-deploy.yml`.
