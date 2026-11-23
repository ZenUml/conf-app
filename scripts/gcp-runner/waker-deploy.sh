#!/usr/bin/env bash
# Deploy (or redeploy) conf-e2e-waker: a Cloud Run function that starts the runner VM when
# GitHub queues a `gcp-conf` job, plus a 5-minute sweep and the repo's workflow_job webhook.
# Idempotent; run from a laptop:  bash scripts/gcp-runner/waker-deploy.sh
# Reuses the e2e-waker service account and custom role that diagramly.ai's waker created
# (diagramly.ai scripts/gcp-e2e/waker-deploy.sh). Docs: docs/ops/gcp-runner-pool.md
set -euo pipefail

PROJECT=${GCP_PROJECT:-staging-zenuml-27954}
VM=${GCP_RUNNER_VM:-conf-ci-c4n48}
ZONE=${GCP_RUNNER_ZONE:-us-central1-a}
REGION=${GCP_WAKER_REGION:-australia-southeast1}
REPO=${GITHUB_REPO:-ZenUml/conf-app}
FN=${GCP_WAKER_NAME:-conf-e2e-waker}
LABEL=gcp-conf
SA="e2e-waker@$PROJECT.iam.gserviceaccount.com"
ROLE=e2eWaker
SECRET=conf-gha-webhook-secret
HERE=$(cd "$(dirname "$0")" && pwd)
gc() { gcloud --project="$PROJECT" --quiet "$@"; }

gc iam service-accounts describe "$SA" >/dev/null
gc iam roles describe "$ROLE" >/dev/null
gc compute instances add-iam-policy-binding "$VM" --zone="$ZONE" \
	--member="serviceAccount:$SA" --role="projects/$PROJECT/roles/$ROLE" >/dev/null
# start and setMetadata on a VM that runs as a service account need actAs on that account.
VM_SA=$(gc compute instances describe "$VM" --zone="$ZONE" --format='value(serviceAccounts[0].email)')
gc iam service-accounts add-iam-policy-binding "$VM_SA" \
	--member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser >/dev/null

if ! gc secrets describe "$SECRET" >/dev/null 2>&1; then
	openssl rand -hex 32 | tr -d '\n' | gc secrets create "$SECRET" --replication-policy=automatic --data-file=-
fi
gc secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:$SA" \
	--role=roles/secretmanager.secretAccessor >/dev/null

gc functions deploy "$FN" --gen2 --region="$REGION" --runtime=nodejs22 \
	--source="$HERE/waker" --entry-point=waker --trigger-http --allow-unauthenticated \
	--service-account="$SA" --memory=512Mi --cpu=1 --concurrency=40 --max-instances=3 --timeout=60s \
	--set-env-vars="GCP_PROJECT_ID=$PROJECT,VM_ZONE=$ZONE,VM_NAME=$VM,RUNNER_LABEL=$LABEL" \
	--set-secrets="WEBHOOK_SECRET=$SECRET:latest" >/dev/null
URL=$(gc functions describe "$FN" --gen2 --region="$REGION" --format='value(serviceConfig.uri)')

if gc scheduler jobs describe "$FN-sweep" --location="$REGION" >/dev/null 2>&1; then verb=update; else verb=create; fi
gc scheduler jobs "$verb" http "$FN-sweep" --location="$REGION" --schedule="*/5 * * * *" \
	--uri="$URL/sweep" --http-method=POST >/dev/null

HOOK_ID=$(gh api "repos/$REPO/hooks" --jq ".[] | select(.config.url == \"$URL\") | .id")
if [ -z "$HOOK_ID" ]; then
	# The secret goes to GitHub over stdin, never on a command line.
	gc secrets versions access latest --secret="$SECRET" |
		jq -Rn --arg url "$URL" 'input as $s | {name: "web", active: true, events: ["workflow_job"],
			config: {url: $url, content_type: "json", insecure_ssl: "0", secret: $s}}' |
		gh api -X POST "repos/$REPO/hooks" --input - --jq '"webhook \(.id) created"'
else
	echo "webhook $HOOK_ID already points at $URL"
fi
echo "$FN: $URL"
