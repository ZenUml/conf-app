# PR #1079 backend title-model evidence

BEFORE: 00e06dc2b988bdcc4292217466fa556bde49010a. AFTER: 5495970a6df4f9d18127a24de513d88be6a28e50.

The same fictional `Customer->Shop: order` input is sent to both bundled endpoint versions. No live APIs or customer data are used in this evidence bundle.

Reproduce with Node 24: `node probe.mjs`. The probe imports `before.mjs` and `after.mjs`, bundled from the named versions using the repository's esbuild dependency. The title guard was unchanged between these versions.

Observed results in before-after.json:
- Gemma chat response: before HTTP 500, after HTTP 200 Order Processing with one primary call.
- Object response: before HTTP 200 [object Object], after HTTP 200 Fallback Title.
- Primary error: both versions recover through the independent Llama 3.3 model.

Local validation on the exact working-tree bytes committed as AFTER:
- Full src lint: exit 0, 0 errors, 140 existing warnings.
- Full Vitest suite: 6284 passed, 3 skipped; 455 files passed, 1 skipped.
- Strict targeted TypeScript: exit 0.
- pnpm build:diagramly, including MCP Apps build: exit 0.
- git diff --check: exit 0.

The production endpoint has no changed UI markup; Storybook and Forge Tunnel are N/A. CI/staging/E2E status is linked from the PR description and is not inferred from these local checks.

A separate, user-authorized live Gemma evaluation ran ten cases successfully without live fallback calls. That is a small quality sample; its private customer inputs/outputs are intentionally absent here. It does not prove population accuracy or old/new superiority. Five replay inputs were later saved bodies rather than exact historic requests.
