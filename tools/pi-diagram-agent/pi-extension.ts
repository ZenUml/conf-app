/** Pi's model, not the prior deterministic CLI, owns diagram creation and revision. */
import { randomUUID } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import * as piSdk from '@earendil-works/pi-coding-agent';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { prepareAgentTask, createAgentVisualInspector, buildSourceFacts, composePrompt } from './src/agent-led.mjs';
import { createV2Run, budgetsFromEnv } from './src/orchestrator.mjs';
import { gateModeFromEnv } from './src/relaxed.mjs';
import { createPiReviewerFactory, reviewerConfigFromEnv, resolveReviewerModel } from './src/reviewer.mjs';
import { safeRunDir } from './src/manifest.mjs';
import { judgeRunDir, acceptWithJudge } from './src/judge-run.mjs';
import { createPiJudgeFactory, resolveJudgeModel, judgeThinkingFromEnv } from './src/judge.mjs';
import { createThinkingSwitch, resolveFirstDraftThinking } from './src/thinking-switch.mjs';
import { createSpecRenderer, SPEC_TOOL_DESCRIPTION, specModeFromEnv } from './src/spec-tool.mjs';
import { createBuildStep } from './src/build-step.mjs';
import { createCallGuard, maxCallMsFromEnv } from './src/call-guard.mjs';

/** Quote-aware argument split shared by /magic and /magic-accept. */
const tokenize = (args: string) => args.trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map(value => value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_all, double, single) => double ?? single)) ?? [];

export default function (pi: ExtensionAPI) {
  const jobs = new Map<string, { runDir: string; inspect: () => Promise<unknown>; renderSpec: () => Promise<unknown>; submit?: (opts?: { svgHash?: string | null }) => Promise<unknown>; buildCheck?: (ctx: any) => Promise<unknown> }>();
  // v2 (independent reviewer + deterministic gate) is the default; PI_DIAGRAM_V2=0 restores the single-session loop for benchmark comparability.
  const v2On = process.env.PI_DIAGRAM_V2 !== '0';
  const runsByDir = new Map<string, any>();
  const acceptedManifests = new Map<string, any>();
  let activeRun: any = null;
  let activeStarted = false;
  let activeJobId = '';
  // Per-call limit for the author model (PI_DIAGRAM_MAX_CALL_S, default 480 s). The timer lives here, not in the bench driver, so interactive /magic and the bench both get it.
  let callCtx: any = null;
  const callGuard = createCallGuard({
    limitMs: maxCallMsFromEnv(),
    onTimeout: () => { try { callCtx?.abort?.(); } catch { /* the session may already be idle */ } },
  });
  // Opt-in experiments; both default off and leave the script-mode prompt and tool list unchanged.
  // PI_DIAGRAM_SPEC_MODE: 1 offers layout.json next to make.py; required makes layout.json the only authoring path.
  const specModeKind = specModeFromEnv();
  const specMode = specModeKind !== 'off';
  const specRequired = specModeKind === 'required';
  const v2Budgets0 = budgetsFromEnv(); // tool descriptions and registration follow the same env the run budgets use

  pi.registerCommand('magic', {
    description: 'Start a Pi-led, quality-first Mermaid-to-SVG improvement session',
    handler: async (args, ctx) => {
      const parts = tokenize(args);
      const input = parts.shift();
      const options: Record<string, string | boolean> = {};
      const usage = 'Usage: /magic /absolute/source.mmd [--resume /absolute/run-dir] [--reference /absolute/accepted.svg] [--feedback /absolute/review.txt] [--adjudication /absolute/adjudication.json] [--upgrade-rules]';
      for (let i = 0; i < parts.length;) {
        const key = parts[i];
        if (key === '--upgrade-rules' && !options[key]) { options[key] = true; i++; continue; }
        if (!['--resume', '--reference', '--feedback', '--adjudication'].includes(key) || !parts[i + 1] || parts[i + 1].startsWith('--') || options[key]) {
          ctx.ui.notify(usage, 'warning');
          return;
        }
        options[key] = parts[i + 1];
        i += 2;
      }
      if (!input || input.startsWith('--')) {
        ctx.ui.notify(usage, 'warning');
        return;
      }
      try {
        const allModels = ctx.modelRegistry.getAvailable();
        const codexModels = allModels.filter(model => model.provider === 'openai-codex' && model.input?.includes('image'));
        const requestedId = process.env.PI_DIAGRAM_CODEX_MODEL;
        const selected = requestedId ? codexModels.find(model => model.id === requestedId) :
          ctx.model?.provider === 'openai-codex' && ctx.model.input?.includes('image') ? ctx.model : codexModels[0];
        if (!selected || !(await pi.setModel(selected))) {
          ctx.ui.notify('A native openai-codex vision model is unavailable. Connect the Codex subscription with Pi /login; no router model was called.', 'warning');
          return;
        }
        // Default: first draft at "medium", then "high" after the first successful inspection (overrides CLI --thinking for the first draft). PI_DIAGRAM_FIRST_DRAFT_THINKING=high disables the switch.
        const thinking = createThinkingSwitch({ firstDraftLevel: resolveFirstDraftThinking(), setLevel: level => pi.setThinkingLevel(level as any) });
        if (!thinking.start()) pi.setThinkingLevel('high');
        const job = prepareAgentTask(input, { cwd: ctx.cwd, resumeRunDir: options['--resume'] as string | undefined, referenceSvgPath: options['--reference'] as string | undefined, feedbackPath: options['--feedback'] as string | undefined, upgradeRules: options['--upgrade-rules'] === true, adjudicationPath: options['--adjudication'] as string | undefined });
        const jobId = randomUUID();
        let inspector: any;
        let run: any = null;
        let v2Budgets: any = null;
        if (v2On) {
          v2Budgets = budgetsFromEnv();
          const reviewerCfg = reviewerConfigFromEnv();
          const reviewerModel = resolveReviewerModel({ available: allModels, authorModel: selected });
          const reviewerCfgWithModel = { ...reviewerCfg, model: reviewerModel };
          inspector = createAgentVisualInspector(job, { maxInspections: v2Budgets.maxInspectionsPerRound, perRound: true, earlyChecks: true });
          // Relaxed gate (default): the Judge accepts inside the loop, so it needs a native openai-codex model; strict needs none.
          const gate = gateModeFromEnv();
          let judgeOpts: Record<string, unknown> = { gate };
          if (gate === 'relaxed') {
            const judgeModel = resolveJudgeModel({ available: allModels, authorModel: selected });
            if (judgeModel.provider !== 'openai-codex') throw Error('JUDGE_PROVIDER_NOT_NATIVE: customer diagrams go only to the native openai-codex provider');
            const judgeThinking = judgeThinkingFromEnv();
            judgeOpts = { gate, judgeFactory: createPiJudgeFactory(piSdk, { provider: judgeModel.provider, modelId: judgeModel.id, thinkingLevel: judgeThinking }), judgeModel: { provider: judgeModel.provider, id: judgeModel.id, thinking: judgeThinking, requested: judgeModel.requested, fallback: judgeModel.fallback } };
          }
          run = createV2Run(job, {
            ...judgeOpts,
            reviewerFactory: createPiReviewerFactory(piSdk, { provider: reviewerModel.provider, modelId: reviewerModel.id, thinkingLevel: reviewerCfg.thinking }),
            budgets: v2Budgets,
            reviewer: reviewerCfgWithModel,
            onRoundEnd: () => inspector.resetRound(),
          });
          activeRun = run;
          activeStarted = false;
          activeJobId = jobId;
          callGuard.cancel();
          runsByDir.set(safeRunDir(job.runDir), run);
          // Watchdog: a hung or endless author turn emits no submit, so the budget cannot rely on diagram_submit alone.
          const watchedRun = run;
          const timer = setTimeout(() => { void expireRun(watchedRun, ctx); }, v2Budgets.maxWallMs + 50);
          (timer as any).unref?.();
        } else inspector = createAgentVisualInspector(job);
        const renderSpec = createSpecRenderer(job);
        const buildStep = createBuildStep(job, { specMode: specRequired ? 'required' : specMode, renderSpec });
        jobs.set(jobId, { runDir: job.runDir, inspect: thinking.wrap(inspector), renderSpec, ...(run ? { submit: (opts?: { svgHash?: string | null }) => run.submit(opts), ...(v2Budgets.twoPhase ? { buildCheck: (ctx: any) => run.buildCheck({ build: () => buildStep(ctx) }) } : {}) } : {}) });
        let factsText: string | null = null;
        if (process.env.PI_DIAGRAM_SOURCE_FACTS === '1') {
          try {
            factsText = await buildSourceFacts(job);
            ctx.ui.notify('Source facts included in the prompt (original render positions, reference only)', 'info');
          } catch (error) {
            ctx.ui.notify(`Source facts unavailable, continuing without them: ${String((error as Error).message)}`, 'warning');
          }
        }
        if (specMode) ctx.ui.notify(specRequired ? 'Layout spec mode on (required): layout.json is the only authoring path; make.py is ignored' : 'Layout spec mode on: layout.json + diagram_render_spec offered', 'info');
        pi.sendUserMessage(composePrompt(job, { jobId, specMode: specRequired ? 'required' : specMode, factsText, v2: v2Budgets ? { maxRounds: v2Budgets.maxRounds, maxInspectionsPerRound: v2Budgets.maxInspectionsPerRound, twoPhase: v2Budgets.twoPhase, maxChecksPerRound: v2Budgets.maxChecksPerRound, maxChecksPerRun: v2Budgets.maxChecksPerRun, maxGeneratorErrorsPerRound: v2Budgets.maxGeneratorErrorsPerRound, runDir: job.runDir, relaxed: gateModeFromEnv() === 'relaxed' } : null }), { deliverAs: 'followUp' });
        ctx.ui.notify(`Pi diagram agent started; private work directory: ${job.runDir}`, 'info');
      } catch (error) {
        ctx.ui.notify(`Diagram agent could not start: ${String((error as Error).message)}`, 'warning');
      }
    },
  });
  pi.registerCommand('magic-judge', {
    description: 'Human only: judge whether a finished /magic run\'s final SVG is visibly better than the original Mermaid render (two blind passes, order swapped). Writes judgement.json, which /magic-accept requires. Usage: /magic-judge <runDir> [--vs-old <runDir>]',
    handler: async (args, ctx) => {
      const [dir, ...rest] = tokenize(args);
      const usage = 'Usage: /magic-judge /absolute/run-dir [--vs-old /absolute/older-run-dir]';
      let vsOld: string | undefined;
      if (rest[0] === '--vs-old' && rest[1] && !rest[1].startsWith('--') && rest.length === 2) vsOld = rest[1];
      else if (rest.length) { ctx.ui.notify(usage, 'warning'); return; }
      if (!dir || dir.startsWith('--')) { ctx.ui.notify(usage, 'warning'); return; }
      try {
        const judgeModel = resolveJudgeModel({ available: ctx.modelRegistry.getAvailable(), authorModel: ctx.model });
        if (judgeModel.provider !== 'openai-codex') throw Error('JUDGE_PROVIDER_NOT_NATIVE: customer diagrams go only to the native openai-codex provider');
        const thinking = judgeThinkingFromEnv();
        ctx.ui.notify(`Judging ${dir} with ${judgeModel.provider}/${judgeModel.id} (${thinking}); two passes, this takes a few minutes.`, 'info');
        const j = await judgeRunDir(dir, {
          vsOld, cwd: ctx.cwd,
          factory: createPiJudgeFactory(piSdk, { provider: judgeModel.provider, modelId: judgeModel.id, thinkingLevel: thinking }),
          model: { provider: judgeModel.provider, id: judgeModel.id, thinking, requested: judgeModel.requested, fallback: judgeModel.fallback },
        });
        const dims = Object.entries(j.merged.dims ?? {}).filter(([, v]: any) => v).map(([d, v]: any) => `${d} ${v.score.toFixed(2)}${v.uncertain ? '?' : ''}`).join(', ');
        ctx.ui.notify(`${j.verdict}: ${j.verdictReason}. mean ${j.mean.toFixed(2)} (${dims}). Candidate ${j.candidateSha256}. Written to judgement.json in the run directory.`, j.verdict === 'IMPROVED' ? 'info' : 'warning');
      } catch (error) {
        ctx.ui.notify(`Not judged: ${String((error as Error).message)}`, 'warning');
      }
    },
  });
  pi.registerCommand('magic-accept', {
    description: 'Human only: validate a REVIEWED /magic run for exactly one SVG hash. Needs a fresh IMPROVED judgement from /magic-judge, or --override-judge "<reason>". A REVIEWED_WITH_EXCEPTIONS run needs every waived check named. Usage: /magic-accept <runDir> <svgSha256> [--waive check1,check2] [--override-judge "<reason>"]',
    handler: async (args, ctx) => {
      const [dir, rawSha, ...rest] = tokenize(args);
      const sha = rawSha?.toLowerCase();
      const usage = 'Usage: /magic-accept /absolute/run-dir <svg-sha256> [--waive check1,check2] [--override-judge "<reason>"]';
      let waived: string[] = [];
      let overrideJudge: string | null = null;
      let seenWaive = false;
      for (let i = 0; i < rest.length; i += 2) {
        const key = rest[i], value = rest[i + 1];
        if (key === '--waive' && !seenWaive && value && !value.startsWith('--')) { seenWaive = true; waived = value.split(',').map(x => x.trim()).filter(Boolean); }
        else if (key === '--override-judge' && overrideJudge === null && value !== undefined && !value.startsWith('--')) overrideJudge = value;
        else { ctx.ui.notify(usage, 'warning'); return; }
      }
      if (!dir || !sha) {
        ctx.ui.notify(usage, 'warning');
        return;
      }
      try {
        const real = safeRunDir(dir, { cwd: ctx.cwd });
        const live = runsByDir.get(real);
        // The in-memory manifest of a run this process orchestrated (or accepted) is the strongest reference; the author cannot reach it.
        const expected = acceptedManifests.get(real) ?? live?.manifest?.() ?? null;
        const result = acceptWithJudge(real, sha, { expected, cwd: ctx.cwd, waived, overrideJudge });
        acceptedManifests.set(real, result.manifest);
        const override = result.acceptance.judgeOverride;
        ctx.ui.notify(`VALIDATED ${result.svgSha256}${result.acceptance.waivedChecks?.length ? ` with waived ${result.acceptance.waivedChecks.join(', ')} accepted by ${result.acceptance.authorisedBy}` : ''}${override ? `; judge verdict (${override.judgementState}) overridden by ${result.acceptance.authorisedBy}: ${override.reason}` : ''} (recorded in ${result.manifestPath}, mirrored to ${real}/run.json, by ${result.acceptance.authorisedBy}).${expected ? '' : ' This process did not orchestrate the run, so the manifest was checked against its authoritative copy outside the run directory, not an in-memory record.'}`, 'info');
      } catch (error) {
        ctx.ui.notify(`Not validated: ${String((error as Error).message)}`, 'warning');
      }
    },
  });
  async function expireRun(run: any, ctx: any) {
    if (!run || run.isFinal()) return;
    callGuard.cancel();
    try { ctx?.abort?.(); } catch { /* the session may already be idle */ }
    try { await run.expireWallClock(); } catch { /* best effort: the manifest stays RUNNING if even the audit fails */ }
  }
  if (v2On) {
    // The timer covers one model call only: provider request -> end of the assistant message. Tools, the reviewer and the Judge are outside it.
    const startCallTimer = (ctx: any) => { if (activeRun && !activeRun.isFinal()) { callCtx = ctx; callGuard.start(); } };
    pi.on?.('before_provider_request', async (_event: any, ctx: any) => { startCallTimer(ctx); });
    pi.on?.('message_start', async (event: any, ctx: any) => { if (event?.message?.role === 'assistant') startCallTimer(ctx); });
    pi.on?.('message_end', async (event: any, ctx: any) => {
      const message = event?.message;
      if (message?.role === 'assistant') callGuard.end(message.stopReason);
      if (message?.role === 'assistant' && activeRun && !activeRun.isFinal()) {
        activeStarted = true;
        activeRun.noteAuthorCall?.();
        if (message.usage) activeRun.addAuthorUsage(message.usage);
        if (activeRun.wallExceeded()) await expireRun(activeRun, ctx);
      }
    });
    pi.on?.('agent_end', async () => {
      // A model call outlasted its limit and was aborted: re-prompt the same session once; a second consecutive timeout ends the run.
      const timeout = callGuard.takeTimeout();
      if (timeout && activeRun && !activeRun.isFinal()) {
        try {
          activeRun.noteModelCallTimeout({ elapsedMs: timeout.elapsedMs, limitMs: timeout.limitMs, action: timeout.retry ? 'retry' : 'end' });
          if (timeout.retry) pi.sendUserMessage(`Your previous model call was aborted after ${Math.round(timeout.elapsedMs / 1000)} s with no result (per-call limit ${Math.round(timeout.limitMs / 1000)} s). This session and its history are intact, and the files in the run directory are as you left them. Continue from your current state: run diagram_build_check (job ID: ${activeJobId}) on what you have, then diagram_submit with the hash it returns. Keep each step small; a second call that outlasts the limit ends the run.`, { deliverAs: 'followUp' });
          else await activeRun.finalizeModelCallTimeout();
        } catch { /* the manifest is best effort here */ }
        return;
      }
      // The author stopped without a final status from diagram_submit: audit its final bytes and record a CANDIDATE manifest.
      if (activeRun && activeStarted && !activeRun.isFinal()) {
        try { await activeRun.finalizeWithoutSubmit(); } catch { /* the manifest is best effort here; the author already ended */ }
      }
    });
    pi.registerTool(defineTool({
      name: 'diagram_submit',
      label: 'Submit the candidate for audit and independent review',
      description: v2Budgets0.twoPhase
        ? 'Signal that candidate.svg is ready. Only bytes whose latest diagram_build_check has no FAIL are accepted (name that hash as svgHash); anything else is REFUSED and is not a round. The orchestrator then renders the exact bytes, runs an independent visual reviewer, and returns structured findings to fix or a final status (REVIEWED, REVIEWED_WITH_EXCEPTIONS or CANDIDATE). You cannot certify your own work.'
        : 'Signal that candidate.svg is ready. The orchestrator re-renders the exact final bytes, runs the deterministic auditor and an independent reviewer, then returns either structured findings to fix (call again after fixing) or a final status (REVIEWED or CANDIDATE). You cannot certify your own work.',
      parameters: Type.Object({ jobId: Type.String(), svgHash: Type.Optional(Type.String({ description: 'SHA-256 of the candidate.svg bytes returned by your latest diagram_build_check' })) }),
      async execute(_id, params) {
        const job = jobs.get(params.jobId);
        if (!job?.submit) throw Error('UNKNOWN_DIAGRAM_JOB');
        return await job.submit({ svgHash: params.svgHash ?? null });
      },
    }));
    if (v2Budgets0.twoPhase) pi.registerTool(defineTool({
      name: 'diagram_build_check',
      label: 'Build the candidate and run the binding script check',
      description: 'The normal edit loop. In one call: (1) runs your generator (python3 make.py in the run directory, 60 s limit; or renders layout.json in spec mode, where PI_DIAGRAM_SPEC_MODE=required ignores make.py and candidate.svg; or uses candidate.svg as written), (2) hashes the resulting candidate.svg bytes, (3) runs the full deterministic auditor plus measured geometry and early checks, (4) returns TEXT ONLY: the sha256, PASS/FAIL per check, and actionable findings (including repairHint/moveHint evidence) and the check budget left. Identical bytes are served from a cache (still counted). diagram_submit accepts only a hash whose latest check has no FAIL. Not visual evidence: call diagram_inspect for images.',
      parameters: Type.Object({ jobId: Type.String() }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const job = jobs.get(params.jobId);
        if (!job?.buildCheck) throw Error('UNKNOWN_DIAGRAM_JOB');
        return await job.buildCheck(ctx);
      },
    }));
  }
  pi.registerTool(defineTool({
    name: 'diagram_inspect',
    label: 'Inspect original and improved diagram',
    description: 'Render exact source and current authored SVG at 2×, then return original, full candidate, four candidate crops, and viewer-fit image as real image content. This is visual evidence, not certification.',
    parameters: Type.Object({ jobId: Type.String() }),
    async execute(_id, params) {
      const job = jobs.get(params.jobId);
      if (!job) throw Error('UNKNOWN_DIAGRAM_JOB');
      return await job.inspect();
    },
  }));
  if (specMode) {
    pi.registerTool(defineTool({
      name: 'diagram_render_spec',
      label: 'Render layout.json to candidate.svg',
      description: SPEC_TOOL_DESCRIPTION,
      parameters: Type.Object({ jobId: Type.String() }),
      async execute(_id, params) {
        const job = jobs.get(params.jobId);
        if (!job) throw Error('UNKNOWN_DIAGRAM_JOB');
        return await job.renderSpec();
      },
    }));
  }
}
