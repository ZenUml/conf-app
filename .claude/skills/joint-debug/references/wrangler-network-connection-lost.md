# Wrangler `Network connection lost` during AI Repair

Read this reference only when the local joint-debug Worker reports
`Network connection lost` for `/diagramly/job-status`, or when an AI Repair job
finishes in Diagramly but the Confluence UI reports a polling/network failure.

## Recognize the local transport signature

Treat the problem as a likely Wrangler/Miniflare local-transport failure, not an
AI failure, when all of these are true:

1. `/diagramly/fix-diagram` returned `200` and several processing-state
   `/diagramly/job-status` requests returned `200`.
2. The failing Worker request logs both `[callDiagramly] Error: Network
   connection lost.` and `[job-status] Error: Network connection lost.` before
   returning `500`, commonly after several seconds.
3. Diagramly logs `AI modification completed` and marks the same job completed.
4. A direct, authenticated request to Diagramly on `localhost:3000` returns the
   job as `COMPLETED` quickly.

If the direct Diagramly request also fails, investigate Diagramly, its database,
or the model provider instead. Do not apply the Miniflare workaround on the
error string alone.

Validated on 2026-08-27 with `wrangler 4.60.0` and
`miniflare 4.20260120.0`: two Worker polls failed after about 6.9-7.4 seconds,
while the corresponding Diagramly jobs were already safely stored as
`COMPLETED`.

## Collect evidence without exposing credentials

- Read the five managed service logs or the background-task output files. If a
  task ID and output path were supplied, prefer those files when no terminal is
  attached to the current Codex task.
- Use ngrok's local inspector on port `4040` only for sanitized metadata:
  timestamp, method, path, HTTP status, and duration. Never print captured
  authorization headers, API keys, FITs, or request/response bodies containing
  diagram content.
- Do not replay captured ngrok requests. A replay resends stored authentication
  headers through ngrok and is unnecessary for this diagnosis.
- A direct Diagramly status check may load the existing local API key without
  echoing it. Print only the job status, output length, attempt count, timing,
  model, reasoning flag, and timeout flag; never print the repaired diagram.
- Distinguish an almost-immediate ngrok `502` during a Worker restart from the
  several-second `Network connection lost` signature. A restart-window `502`
  invalidates that test run; restore readiness and retry.

## Confirm the affected local runtime

Record the installed versions rather than trusting `package.json` ranges:

```bash
pnpm exec wrangler --version
pnpm why miniflare workerd
```

Inspect the installed Miniflare `#startLoopbackServer` implementation. Older
builds create the Node loopback server without setting
`server.keepAliveTimeout = 0`. Cloudflare traced the same error to a race between
Node's default five-second idle keep-alive close and workerd reusing the pooled
socket:

- Issue: https://github.com/cloudflare/workers-sdk/issues/14848
- Fix: https://github.com/cloudflare/workers-sdk/pull/14850
- First release containing that fix: Wrangler `4.116.0` / Miniflare
  `4.20260730.0`: https://github.com/cloudflare/workers-sdk/pull/14898

Do not change dependency versions merely because a newer version exists. Use a
focused A/B test or the temporary patch below first; newer Wrangler versions may
have separate regressions.

## Temporary local A/B patch

Use this only after the signature and installed code shape above are confirmed.
The patch is diagnostic and local-only.

In the installed Miniflare distribution, add the following line immediately
after construction of the loopback server and before its `upgrade` handler:

```javascript
const server = stoppable(/* existing server construction */);
server.keepAliveTimeout = 0;
server.on("upgrade", this.#handleLoopbackUpgrade);
```

Requirements:

1. Use `apply_patch` against the exact installed Miniflare file. Do not run a
   broad replacement across `node_modules`.
2. Confirm the inserted line with a narrow search.
3. Do not edit `package.json`, `pnpm-lock.yaml`, application code, or production
   configuration for this A/B test.
4. Record that reinstalling dependencies will overwrite the patch.

## Restart only the Worker

Restarting is state-changing. Use existing user authorization or ask before
stopping the service.

- Resolve the exact process listening on `8789` and its parent process group.
  Never kill every `node`, `wrangler`, or joint-debug process.
- Leave Diagramly, ngrok, Vite, and Forge tunnel running.
- For user-managed Terminal windows, have the user stop and relaunch Terminal 2.
- For Codex-managed services, stop only the retained Worker session and launch
  its replacement as a durable managed PTY/background task. Retain the new
  session/task ID and output path. Do not attach service lifetime to a disposable
  monitoring command.
- If launch reports `EPERM` or log-file permission errors, rerun it with the
  required permission. If it reports `Address already in use`, find the existing
  listener instead of starting a duplicate.
- Require `Ready on http://localhost:8789`, confirm ngrok still forwards to
  `8789`, then ask the user to retry.

## Pass criteria

The retry passes only when:

1. Diagramly marks the new job `COMPLETED`.
2. Every Worker/ngrok request for that run returns `200`; no `Network connection
   lost` occurs.
3. The UI receives the terminal `COMPLETED` response and shows the repaired
   result. Preserve visible UI evidence or a network intercept. User confirmation
   can corroborate but does not replace the required UI/network evidence.

A slow successful poll is especially useful evidence. In the validated run, one
status request took about 9.9 seconds and still returned `200`, followed by a
fast terminal poll that returned `200` and completed the UI flow.

## Deployment boundary

This patch does not ship and is not needed in the production runtime:

- It changes an ignored file under local `node_modules` and is overwritten by a
  dependency install.
- The release action runs `pnpm install --frozen-lockfile --ignore-scripts` in a
  clean CI environment before building and deploying.
- Production Cloudflare Pages runs the deployed Worker, not local Miniflare.

Therefore, not reinstalling local dependencies does not affect an online
release. Business-source fixes still must be committed and pushed normally.
If the requirement is production resilience against genuine transient network
failures, treat polling retry/backoff as a separate application change; do not
present the local Miniflare patch as that fix.

On explicit joint-debug cleanup, reverse only the inserted
`server.keepAliveTimeout = 0` line if this workflow added it and the surrounding
installed code still matches. Do not reinstall dependencies solely to remove
the patch unless the user asks.
