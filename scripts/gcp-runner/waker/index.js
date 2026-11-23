// e2e-waker: starts the E2E VM when GitHub queues a job for its self-hosted runners.
// Deployed as a Cloud Run function by scripts/gcp-e2e/waker-deploy.sh.
// Docs: docs/testing/self-hosted-runner.md
//
//   POST /        GitHub `workflow_job` webhook (HMAC-verified). On `queued` with the
//                 runner label: stamp the VM's `gha-last-queued` metadata, start it if stopped.
//   POST /sweep   Cloud Scheduler, every 5 minutes. Starts the VM if a job was queued in the
//                 last QUEUED_WINDOW_SECONDS and the VM is not running. Covers the one race the
//                 webhook cannot: the VM powering off just after the webhook found it RUNNING.
//
// idle-stop.sh on the VM reads `gha-last-queued` too and does not power off inside the
// same window, so a queued job always finds the VM up or coming up.
import crypto from "node:crypto";
import functions from "@google-cloud/functions-framework";

const PROJECT = process.env.GCP_PROJECT_ID;
const ZONE = process.env.VM_ZONE;
const VM = process.env.VM_NAME;
const LABEL = process.env.RUNNER_LABEL ?? "gcp-e2e";
const SECRET = process.env.WEBHOOK_SECRET;
const QUEUED_WINDOW_SECONDS = Number(process.env.QUEUED_WINDOW_SECONDS ?? 900);
const API = `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/${VM}`;

async function token() {
	const res = await fetch(
		"http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
		{ headers: { "Metadata-Flavor": "Google" } },
	);
	return (await res.json()).access_token;
}

async function compute(path, init = {}) {
	const res = await fetch(
		path.startsWith("https://") ? path : `${API}${path}`,
		{
			...init,
			headers: {
				Authorization: `Bearer ${await token()}`,
				"Content-Type": "application/json",
			},
		},
	);
	const body = await res.json();
	if (!res.ok) {
		const err = new Error(
			`${init.method ?? "GET"} ${path}: ${res.status} ${body.error?.message}`,
		);
		err.status = res.status;
		throw err;
	}
	return body;
}

// Mutations return a zone operation, and most failures (such as a missing actAs on the VM's
// service account) only show up in it. Poll it for up to `ms`; an operation still running
// then (a VM start) is reported as such, not waited for, to answer GitHub inside its 10s.
async function mutate(path, body, ms = 3000) {
	let op = await compute(path, { method: "POST", body: JSON.stringify(body) });
	const deadline = Date.now() + ms;
	while (op.status !== "DONE" && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 500));
		op = await compute(op.selfLink);
	}
	if (op.error) {
		const err = new Error(
			`${path}: ${op.error.errors?.map((e) => e.message).join("; ")}`,
		);
		err.code = op.error.errors?.[0]?.code;
		throw err;
	}
	return op.status;
}

async function startIfStopped({ status }) {
	// STOPPING: start is refused until the stop finishes; the next sweep starts it.
	if (
		status === "TERMINATED" ||
		status === "STOPPED" ||
		status === "SUSPENDED"
	) {
		const op = await mutate(status === "SUSPENDED" ? "/resume" : "/start", {});
		return `${status} -> start ${op}`;
	}
	return status;
}

// setMetadata replaces the whole item list and needs the current fingerprint; several
// jobs are queued at once, so retry on a stale fingerprint, until `deadline`. A retry that
// finds a stamp another request just wrote stops there.
async function stampQueued(now, deadline) {
	while (Date.now() < deadline) {
		const vm = await compute("");
		if (now - lastQueued(vm) <= 60) return;
		const { metadata } = vm;
		const items = (metadata.items ?? []).filter(
			(i) => i.key !== "gha-last-queued",
		);
		items.push({ key: "gha-last-queued", value: String(now) });
		try {
			await mutate("/setMetadata", {
				fingerprint: metadata.fingerprint,
				items,
			});
			return;
		} catch (err) {
			if (err.status !== 412 && err.code !== "CONDITION_NOT_MET") throw err;
		}
	}
	throw new Error("setMetadata: fingerprint kept changing");
}

function lastQueued({ metadata }) {
	const item = (metadata.items ?? []).find((i) => i.key === "gha-last-queued");
	return Number(item?.value ?? 0);
}

function validSignature(req) {
	const sig = Buffer.from(req.get("X-Hub-Signature-256") ?? "");
	const want = Buffer.from(
		`sha256=${crypto.createHmac("sha256", SECRET).update(req.rawBody).digest("hex")}`,
	);
	// timingSafeEqual throws on buffers of different length (a non-ASCII header).
	return sig.length === want.length && crypto.timingSafeEqual(sig, want);
}

functions.http("waker", async (req, res) => {
	try {
		if (req.method !== "POST") return res.status(405).send("POST only");
		const started = Date.now();
		const now = Math.floor(started / 1000);

		if (req.path === "/sweep") {
			const vm = await compute("");
			const age = now - lastQueued(vm);
			if (age > QUEUED_WINDOW_SECONDS)
				return res.send(`no job queued in the window (last ${age}s ago)`);
			return res.send(`job queued ${age}s ago; VM ${await startIfStopped(vm)}`);
		}

		if (!SECRET || !validSignature(req))
			return res.status(401).send("bad signature");
		const event = req.get("X-GitHub-Event");
		if (event === "ping") return res.send("pong");
		const job = req.body?.workflow_job;
		if (
			event !== "workflow_job" ||
			req.body.action !== "queued" ||
			!job?.labels?.includes(LABEL)
		) {
			return res.send("ignored");
		}
		// Start first: it is what the job waits for. The stamp only guards the idle power-off
		// and feeds the sweep, so it is best effort, inside GitHub's 10 s delivery timeout.
		// One run queues 7 jobs at once; a stamp under a minute old already covers them.
		const vm = await compute("");
		const state = await startIfStopped(vm);
		let stamp = "stamp fresh";
		if (now - lastQueued(vm) > 60) {
			try {
				await stampQueued(now, started + 5000);
				stamp = "stamped";
			} catch (err) {
				console.error(err);
				stamp = "stamp failed";
			}
		}
		console.log(`job ${job.id} (${job.name}) queued; VM ${state}; ${stamp}`);
		return res.send(`VM ${state}; ${stamp}`);
	} catch (err) {
		// Details go to the Cloud Run log only; /sweep is unauthenticated.
		console.error(err);
		return res.status(500).send("internal error");
	}
});
