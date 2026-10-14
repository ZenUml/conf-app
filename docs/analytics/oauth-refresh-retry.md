# Agent Link MCP token refresh analytics

`agent_link_oauth_token_refresh_completed` describes the terminal result of one inbound refresh request to ZenUML's MCP OAuth token endpoint. It is separate from `agent_link_oauth_refresh_failed`, which describes refreshing the upstream Atlassian grant used to call Confluence.

Emit one event when the MCP refresh request reaches a terminal response:

- `rotated`: the request completed a token rotation successfully.
- `retried`: a server-side retry was needed and the request then completed successfully. This remains one event for the inbound request, not one event per attempt.
- `rejected`: the request was refused as an authorization or refresh-token failure.
- `unavailable`: the server could not complete or classify the refresh because a transient dependency or service failure remained after any retry.

Properties: `feature_area: agent_link`, `surface: backend`, and `user_account_id` when the authenticated identity is known; `oauth_refresh_outcome` is required; `reason` carries only an existing closed failure code when applicable; `refresh_reuse_age_ms` is optional and is present only when the server can calculate the age of a reused refresh token; `duration_ms` is the elapsed time from receipt of the inbound request to its terminal result; and `oauth_request_id` is a server-generated UUID stable across attempts for that request.

Do not send access tokens, refresh tokens, authorization codes, token hashes, request bodies, or provider error text to analytics. Backend `mixpanelTrack` emits directly and bypasses browser event sampling; do not add this event to the browser sampling table.
