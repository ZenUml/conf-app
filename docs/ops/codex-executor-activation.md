# Codex executor: pending activation

This is a design and offline contract, not a running agent. The user chose Codex.
No OpenAI credential, federation rule, paid inference, or new subscription was
created for this step. The GitHub App private-key download blocker is unchanged.

## Smallest independent first run

Use a dedicated **OpenAI project service-account API key**, supplied only to the
Codex GitHub Action in the existing private controller repository. Store it as
`AUTOFIX_OPENAI_API_KEY` only after explicit credential-creation/storage approval.
Do not copy personal Codex `auth.json`, the existing Claude OAuth token, or the
user's GitHub CLI token. Do not request an OpenAI Admin API key for execution.

Before creating anything, identify the user's authorized OpenAI project, its model
access, current billing/credit availability, and the exact permitted workload-key
scopes. Restrict the workload to model inference and required model discovery;
no organization administration, project management, files, fine-tuning or other
unneeded APIs. Verify the action's actual endpoint needs with a safe small test
rather than silently expanding a rejected permission. Choose a finite expiration
and retain revocation metadata, never the secret in notes.

An initial synthetic patch-generation job needs no GitHub App private key: its
GitHub token is `contents:read` on the controller repo, while conf-app is public.
It has no ability to publish branches, issue comments, merge or deploy. This
proves only the independent executor, not the end-to-end publisher.

## Runtime separation

1. Trusted intake selects reviewed source locations and pinned conf-app SHA. Raw
   Sentry title/message/request/user fields never become prompt instructions.
2. Run on a fresh Linux runner. Pin official actions and Codex CLI version after
   verification. Checkout with `persist-credentials:false`. Prepare dependencies
   before the Codex step, without an OpenAI key in the step/job environment.
3. Pass the key to the official action's `openai-api-key` input. Keep its API proxy
   and `drop-sudo` protection; use workspace-write sandbox without general network
   access. Do not inherit Sentry, App private key, Cloudflare or Forge credentials.
4. Codex returns local changes only. A narrow trusted collector serializes the
   patch; do not execute arbitrary post-agent scripts in a credentialed job.
5. A fresh job checks base SHA, attempt/digest correlation, patch paths and modes,
   runs tests without production secrets, and invokes independent risk review.
   Only a separately credentialed publisher may create a draft PR. Agent output
   and a successful unit test never authorize merge or production.

`scripts/autofix/executor.mjs` validates this handoff and a trusted collector's
patch manifest. It is deliberately default-disabled. Its booleans are trusted
adapter inputs, not user confirmation or proof of runtime isolation. They must
never be accepted from an issue body, candidate branch, or model output. Attempt
reservation must be atomic in the durable ledger; this pure function alone cannot
prevent concurrent attempts. No workflow is enabled by this module.

## Authentication alternative

Official OpenAI docs also support GitHub OIDC to short-lived API access tokens;
this requires a service-account trust mapping limited to the exact private repo,
workflow and protected ref/environment. It avoids a long-lived API key but is a
new persistent trust grant requiring approval. Direct Codex workspace federation
is documented as beta and workspace enablement has not been verified here. Do not
claim the existing ChatGPT/Codex GitHub connector supplies CI credentials. The
API-key path is the smaller verified integration contract for the first run;
federation remains an alternative, not an activated fallback.

## Cost and limits

API inference is usage-based; exact cost depends on the selected available model,
input/cached/output tokens, retries and runtime. No model/price/account balance has
been selected or measured, so there is no supported dollar-per-fix estimate yet.
Private GitHub Actions runner/storage charges also depend on this organization's
plan and remaining included usage, which have not been checked.

Before a paid run, obtain an approved spending limit and verify billing access.
Use a dedicated project hard spend limit rather than changing a shared project's
limit. Official docs say hard enforcement can slightly overshoot while tracked
spend propagates; a spend alert alone is not a cap. A timeout or max-attempt count
is also not a dollar cap. The first run should have one attempt, one concurrent
job, a short timeout and no automatic retry. Missing/auth/billing errors pause;
never silently increase limits or buy credits. A strict per-run cap needs a
request-level reservation/proxy implementation, which is not yet supplied.

## Concrete next step

With the user's explicit action-time approval, select the authorized OpenAI
project, configure a dedicated restricted service-account credential in the
private controller secret, and agree the first-test spend limit. Then run one
clearly labeled synthetic regression-test-and-patch exercise, retaining the
pinned SHA/run ID and validating that it cannot publish. In parallel the user
must resolve the separately blocked GitHub App private-key download before the
publisher can authenticate. No real low-risk conf-app Sentry candidate is
currently verified, so neither test authorizes a demonstration production release.

## Verified official sources (2026-11-08)

- https://learn.chatgpt.com/docs/github-action
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://developers.openai.com/api/docs/guides/api-keys
- https://developers.openai.com/api/docs/guides/workload-identity-federation/github-actions
- https://developers.openai.com/api/docs/guides/workload-identity-federation
- https://developers.openai.com/api/docs/guides/spend-limits
