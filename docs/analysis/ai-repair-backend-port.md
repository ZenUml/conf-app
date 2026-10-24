# AI Repair / AI Chat backend — should we port it off diagramly.ai?

**Date:** 2026-06-07
**Question:** AI repair (and AI chat) currently use diagramly.ai for AI capabilities. Should we port that to the Cloudflare Worker or the Forge backend directly? Architecture + cost.
**Verdict:** **Keep the status quo.** No port is justified today. First instrument the two call sites (they emit zero usage analytics), so a real cost denominator exists before any future decision.

---

## 1. Current architecture (verified)

```
AIRepair.vue / AiAide.jsx          (Forge Custom UI iframe — cannot hold secrets)
   │  startFixDiagram() / diagramlyChat()  →  callRemote()
   │      └─ src/utils/requestUtil.ts: callRemote → forgeCallRemote → @forge/bridge invokeRemote
   ▼                                          (⚠ crosses the Forge remote boundary: 25s UI-invocation ceiling)
conf-app CF Worker   functions/diagramly/{fix-diagram,job-status,chat}.ts
   │  functions/service/diagramlyService.js → callDiagramly()
   │      holds DIAGRAMLY_API_KEY; adds x-api-key, x-external-id (=accountId), x-team-id (=cloudId)
   ▼
diagramly.ai backend   (Next.js, long-lived Azure Web App container)   ← the LLM + prompts + "job queue" live HERE
   POST /api/chat/modify-async → {jobId}      (async repair)
   POST /api/chat/job-status                  (poll)
   POST /api/chat/messages                    (synchronous chat)
```

Client poll loop (`AIRepair.vue`): every 2s, 30 attempts, **errors at 60s**. The product expects repair within ~60s.

### What "AI capabilities" actually means in diagramly.ai
- **Model:** `anthropic/claude-sonnet-4`, temp 0.2, maxTokens 10k–20k. Served via **Databricks (primary) → OpenRouter (fallback)** through LangChain's OpenAI-compatible client.
- **Execution model: a single LLM call.** `modify-async`'s `processModifyJobAsync` is **in-process fire-and-forget** (`processModifyJobAsync(...).catch(...)`, no `await`); the route returns `{jobId}` instantly. There is **no queue worker, cron, or Inngest** — the Prisma `Job` row is just a poll mailbox (`externalJobId // For future Inngest integration` = planned, not built). The sibling chat endpoint is the *same single call*, just synchronous.
- **Why async at all:** a wall-clock/output-length dodge so the initiating HTTP request (which traverses conf-app's CF proxy + the Forge remote) returns fast instead of holding a connection open for the full Sonnet generation. It works only because diagramly runs on a **long-lived Azure container** that keeps executing after the response is sent. Not durable execution — if the container recycles mid-job, the job is silently lost.

### The system *around* the LLM call (this is the real porting cost)
All of these run today **for free** inside diagramly.ai and a port would orphan them:

| Capability | Porting impact |
|---|---|
| Credit/quota **gate** (team-scoped `canConsumeCredits`) | must-reimplement for parity¹ |
| Team / external-user provisioning (`accountId→User`, `cloudId→Team`) | must-reimplement¹ |
| Multi-provider fallback + 3 retries + 120s timeout | must-reimplement |
| Output validation (`JsonExtractor` + code-block fallback + per-language hook) | must-reimplement |
| Prompt-chunk corpus (large per-language/per-subtype specs, cache-control) | must-carry-verbatim |
| Job persistence / poll mailbox (Postgres) | must-reimplement (KV/D1/DO) if reproduced |
| Rate limiting / abuse protection | **none exists** — nothing to inherit |

¹ Possibly lighter than it looks: `MODIFY_DIAGRAM` charges **0** credits; the gate only needs a non-empty balance, and external Teams are auto-provisioned. If conf-app teams get a default/unlimited balance, repair effectively has *no live quota enforcement* to lose. Unverified from the conf-app repo — chat metering may differ and is the more likely real gate.

---

## 2. The three options

**diagramly.ai is our own product, not a third-party vendor.** So this is not "break vendor lock-in" — it's "which in-house backend hosts the LLM compute." That removes the usual strategic upside of bringing things in-house.

### Option 0 — Status quo (baseline)
Thin CF proxy → diagramly.ai. **~$0 incremental compute** (proxy is a thin fetch on infra already on Workers Paid) + Sonnet-4 token cost billed inside diagramly.ai. **~0 marginal maintenance** — the credits/team/provider-fallback/validation/prompt stack already runs for diagramly's own product; conf-app free-rides.

### Option A — Port LLM compute into the conf-app CF Worker
- CF precedent exists for *first-party* model calls (`functions/ai-generate-title.ts` uses the **Workers AI binding** `env.AI.run(...)`) — but that is on-platform inference, **not** a held-open external fetch to Anthropic/Databricks, so it is weaker precedent than it first appears.
- CF bills **CPU, not I/O-wait** — a long LLM fetch is essentially free CPU, and Workers have no wall-clock ceiling *while the client holds the connection*.
- **⚠ The decisive correction:** the client does **not** hold a direct connection to CF. It calls through `@forge/bridge invokeRemote` (verified: `requestUtil.ts:75,94`), which carries the **Forge remote 25s ceiling**. The 60s poll loop exists to straddle *that* boundary. So you **cannot** "make it synchronous and delete the poll loop" — a faithful CF port must keep a jobId/poll mailbox (KV/D1) anyway (invokeRemote returns a single response; no SSE/streaming).
- **Effort:** ~3–5 days to preserve the async mailbox + a thin call (and you still drop billing parity); **~10–20 days** ("build") to faithfully port the beyondLLM stack, which then must be kept in sync with diagramly.ai forever.
- **Compute savings: ~zero.** LLM tokens dominate and are identical; you'd just bill them to a conf-app key instead.

### Option B — Port LLM compute into a Forge Function
- Forge Function on the interactive path requires adding the LLM domain (e.g. `api.anthropic.com`) to `manifest.yml` `external.fetch.backend` → **MAJOR version → per-tenant admin re-consent**. Installs stall on the old version until each admin approves. (The manifest's "no approval needed" comment is the Connect-grandfather carve-out; it does **not** cover a net-new domain. Confirm with `forge deploy --verbose`.)
- **25s sync ceiling** — a worst-case 25s generation sits at zero margin. The 900s async path is fire-and-forget and can't return to a waiting user.
- **GB-seconds** bill by **duration** (free tier 100k/mo/app, 0.5GB/fn): 15s call = 7.5 GB-sec → ~13,333 repairs/mo free. Comfortably within free tier at today's (low) volume — so GB-seconds isn't the killer; **rollout is**.
- Same beyondLLM reimplementation as A, **plus** a new runtime, **plus** the egress/version tax. Strictly worse than A on every axis.
- **Escape hatch** (call the LLM from the CF backend via the already-declared `connect` remote → 0 GB-sec, no egress change) just routes back through CF — i.e. it's Option A, not B.

---

## 3. Cost comparison

| Dimension | Status quo | CF Worker (A) | Forge (B) |
|---|---|---|---|
| Incremental compute (excl. tokens) | ~$0 | ~$0 (I/O wait, not CPU) | ~free at current volume (GB-sec by duration) |
| **LLM token cost (dominant)** | Sonnet-4 | **identical** | **identical** |
| Async/durable machinery | none (lives in diagramly) | **still needed** — 25s Forge-remote ceiling forces a poll mailbox | sync caps at 25s; dodging it rebuilds a mailbox |
| Eng effort | 0 | 3–5 days (no parity) / 10–20 days (parity) | 12–22 days + multi-week consent rollout |
| Surrounding system (credits/team/validation/prompts) | reused free | must-reimplement all | must-reimplement all + new runtime |
| Version / admin consent | none | none | **MAJOR → per-tenant re-consent** |
| Interactive latency ceiling | ~10–40s typ.; 60s budget met | 25s Forge-remote ceiling (same as today) | 25s sync ceiling, zero margin |
| New secret | none | 1 LLM key per Pages project | egress URL (major trigger) + key |

---

## 4. Recommendation — keep the status quo

1. **No compute savings.** Sonnet-4 token cost dominates and is identical across all three. Neither CF I/O-wait nor Forge GB-seconds (both ~free at current volume) reduces the bill that matters.
2. **No volume or latency pressure.** Usage is **untracked** (repair emits zero events; chat has only a route-load proxy, on a 7-week-stale export). The 60s budget is met today.
3. **No lock-in upside.** diagramly.ai is our own product.
4. **Both ports trade real "build" effort + risk for ~zero benefit**, and orphan a working credits/billing/validation/fallback stack. Option B additionally pays the major-version re-consent tax and a 25s ceiling.

### Do this first (precondition for any future decision)
Add `trackAnalyticsEvent` at the **`diagramlyChat`** and **`startFixDiagram`** call sites (lifecycle: requested / succeeded / failed) — register names in `src/utils/analytics/catalog.ts` + `types.ts`. Today there is **no per-invocation denominator**, so any cost model is hand-waving.

### Flip conditions (none present today → revisit if one becomes true)
- A **measured, user-visible latency penalty** from the extra CF→diagramly.ai hop.
- An explicit strategic decision to **decouple conf-app from diagramly.ai**.
- Willingness to **drop credits/billing parity** *and* accept rebuilding the async/poll mailbox on CF (the 25s Forge-remote ceiling means even a "thin" port needs it).

If any becomes true, the target is **Option A (CF Worker), never B** — B's egress/major-version/25s costs are strictly worse and its GB-seconds escape hatch just routes back through CF anyway.

---

## 5. Non-cost risks of the status quo (don't flip the verdict, but worth noting)
- **Uptime coupling:** AI repair/chat availability now depends on diagramly.ai's Azure backend being up, with no fallback. (Diagram bodies are unaffected — Confluence remains system of record.)
- **Non-durable jobs:** diagramly's in-process fire-and-forget job is lost if the Azure container recycles mid-run; the client just times out at 60s.

Both ports would *inherit the same LLM dependency* and add their own risk, so neither fixes these.

---

*Method: multi-agent analysis (4 parallel investigators → synthesis → adversarial review). The review caught and this doc corrects a wrong claim that a CF port could drop the poll loop — the Forge-remote 25s ceiling (verified in `requestUtil.ts`) means it cannot.*
