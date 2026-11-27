// conf-ci-waker: starts the AWS runner pool instances when GitHub queues an `aws-conf` job.
// AWS Lambda (nodejs22.x), deployed by scripts/aws-runner/waker-deploy.sh. The AWS copy of
// scripts/gcp-runner/waker/index.js. Docs: docs/ops/aws-runner-pool.md
//
//   Function URL   GitHub `workflow_job` webhook (HMAC-verified). On `queued` with the
//                  runner label: start every stopped pool instance and tag it
//                  `gha-last-queued` = now.
//   {"sweep":true} EventBridge Scheduler, every 5 minutes (direct invoke, not the URL).
//                  Starts a stopped instance whose `gha-last-queued` is inside the window.
//                  Covers the race the webhook cannot: an instance powering off just after
//                  the webhook found it running.
//
// idle-stop.sh on each instance reads the same tag through IMDS and does not power off
// inside the window, so a queued job always finds the pool up or coming up.
import crypto from "node:crypto";
import {
	CreateTagsCommand,
	DescribeInstancesCommand,
	EC2Client,
	StartInstancesCommand,
} from "@aws-sdk/client-ec2";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const LABEL = process.env.RUNNER_LABEL ?? "aws-conf";
const POOL_TAG = process.env.POOL_TAG ?? "conf-ci-pool";
const REGIONS = (process.env.POOL_REGIONS ?? "").split(",").filter(Boolean);
const SECRET_PARAM = process.env.WEBHOOK_SECRET_PARAM;
const QUEUED_WINDOW_SECONDS = Number(process.env.QUEUED_WINDOW_SECONDS ?? 900);

const ec2 = new Map(REGIONS.map((r) => [r, new EC2Client({ region: r })]));
let secret;

async function webhookSecret() {
	secret ??= (
		await new SSMClient({}).send(
			new GetParameterCommand({ Name: SECRET_PARAM, WithDecryption: true }),
		)
	).Parameter.Value;
	return secret;
}

async function poolInstances(region) {
	const out = await ec2.get(region).send(
		new DescribeInstancesCommand({
			Filters: [
				{ Name: `tag:${POOL_TAG}`, Values: [LABEL] },
				{ Name: "instance-state-name", Values: ["pending", "running", "stopping", "stopped"] },
			],
		}),
	);
	return out.Reservations.flatMap((r) => r.Instances).map((i) => ({
		region,
		id: i.InstanceId,
		state: i.State.Name,
		lastQueued: Number(i.Tags?.find((t) => t.Key === "gha-last-queued")?.Value ?? 0),
	}));
}

async function allInstances() {
	return (await Promise.all(REGIONS.map(poolInstances))).flat();
}

// `stopping`: start is refused until the stop finishes; the next sweep starts it.
async function startIfStopped(vm) {
	if (vm.state !== "stopped") return `${vm.id} ${vm.state}`;
	try {
		await ec2.get(vm.region).send(new StartInstancesCommand({ InstanceIds: [vm.id] }));
		return `${vm.id} stopped -> start`;
	} catch (err) {
		// Spot capacity can be short in one zone; the sweep retries every 5 minutes.
		console.error(vm.id, err.name, err.message);
		return `${vm.id} start failed (${err.name})`;
	}
}

async function stamp(vm, now) {
	if (now - vm.lastQueued <= 60) return;
	await ec2.get(vm.region).send(
		new CreateTagsCommand({
			Resources: [vm.id],
			Tags: [{ Key: "gha-last-queued", Value: String(now) }],
		}),
	);
}

function header(headers, name) {
	const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name);
	return key ? headers[key] : undefined;
}

function validSignature(raw, sig, key) {
	const got = Buffer.from(sig ?? "");
	const want = Buffer.from(
		`sha256=${crypto.createHmac("sha256", key).update(raw).digest("hex")}`,
	);
	return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const reply = (statusCode, body) => ({ statusCode, body });

export async function handler(event) {
	const now = Math.floor(Date.now() / 1000);
	try {
		if (event?.sweep === true) {
			const vms = await allInstances();
			const res = await Promise.all(
				vms.map((vm) =>
					now - vm.lastQueued <= QUEUED_WINDOW_SECONDS
						? startIfStopped(vm)
						: `${vm.id} ${vm.state}, last queued ${now - vm.lastQueued}s ago`,
				),
			);
			console.log("sweep:", res.join("; "));
			return res;
		}

		if (event?.requestContext?.http?.method !== "POST") return reply(405, "POST only");
		const raw = Buffer.from(event.body ?? "", event.isBase64Encoded ? "base64" : "utf8");
		if (!validSignature(raw, header(event.headers, "x-hub-signature-256"), await webhookSecret()))
			return reply(401, "bad signature");
		const kind = header(event.headers, "x-github-event");
		if (kind === "ping") return reply(200, "pong");
		const body = JSON.parse(raw.toString("utf8"));
		const job = body.workflow_job;
		if (kind !== "workflow_job" || body.action !== "queued" || !job?.labels?.includes(LABEL))
			return reply(200, "ignored");

		// Start first: it is what the job waits for. The tag only guards idle power-off and
		// feeds the sweep, so it is best effort, inside GitHub's 10 s delivery timeout.
		const vms = await allInstances();
		const started = await Promise.all(vms.map(startIfStopped));
		const tagged = await Promise.allSettled(vms.map((vm) => stamp(vm, now)));
		const tagFailures = tagged.filter((t) => t.status === "rejected").length;
		for (const t of tagged) if (t.status === "rejected") console.error(t.reason);
		const msg = `job ${job.id} (${job.name}) queued; ${started.join("; ")}; tag failures ${tagFailures}`;
		console.log(msg);
		return reply(200, `${started.length} instances; tag failures ${tagFailures}`);
	} catch (err) {
		// Details go to CloudWatch only; the function URL is public.
		console.error(err);
		return reply(500, "internal error");
	}
}
