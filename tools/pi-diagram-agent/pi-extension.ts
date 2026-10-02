/** Pi's model, not the prior deterministic CLI, owns diagram creation and revision. */
import { randomUUID } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import * as piSdk from '@earendil-works/pi-coding-agent';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { prepareAgentTask, createAgentVisualInspector, buildSourceFacts, composePrompt } from './src/agent-led.mjs';
import { createV2Run, budgetsFromEnv } from './src/orchestrator.mjs';
import { createPiReviewerFactory, reviewerConfigFromEnv } from './src/reviewer.mjs';
import { acceptRun, safeRunDir } from './src/manifest.mjs';
import { createThinkingSwitch, resolveFirstDraftThinking } from './src/thinking-switch.mjs';
import { createSpecRenderer, SPEC_TOOL_DESCRIPTION } from './src/spec-tool.mjs';

/** Quote-aware argument split shared by /magic and /magic-accept. */
const tokenize = (args: string) => args.trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map(value => value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_all, double, single) => double ?? single)) ?? [];

export default function (pi: ExtensionAPI) {
  const jobs = new Map<string, { inspect: () => Promise<unknown>; renderSpec: () => Promise<unknown>; submit?: () => Promise<unknown> }>();
  // v2 (independent reviewer + deterministic gate) is the default; PI_DIAGRAM_V2=0 restores the single-session loop for benchmark comparability.
  const v2On = process.env.PI_DIAGRAM_V2 !== '0';
  const runsByDir = new Map<string, any>();
  const acceptedManifests = new Map<string, any>();
  let activeRun: any = null;
  let activeStarted = false;
  // Opt-in experiments; both default off and leave the script-mode prompt and tool list unchanged.
  const specMode = process.env.PI_DIAGRAM_SPEC_MODE === '1';

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
        const codexModels = ctx.modelRegistry.getAvailable().filter(model => model.provider === 'openai-codex' && model.input?.includes('image'));
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
          inspector = createAgentVisualInspector(job, { maxInspections: v2Budgets.maxInspectionsPerRound, perRound: true, earlyChecks: true });
          run = createV2Run(job, {
            reviewerFactory: createPiReviewerFactory(piSdk, { provider: selected.provider, modelId: selected.id, thinkingLevel: reviewerCfg.thinking }),
            budgets: v2Budgets,
            reviewer: reviewerCfg,
            onRoundEnd: () => inspector.resetRound(),
          });
          activeRun = run;
          activeStarted = false;
          runsByDir.set(safeRunDir(job.runDir), run);
          // Watchdog: a hung or endless author turn emits no submit, so the budget cannot rely on diagram_submit alone.
          const watchedRun = run;
          const timer = setTimeout(() => { void expireRun(watchedRun, ctx); }, v2Budgets.maxWallMs + 50);
          (timer as any).unref?.();
        } else inspector = createAgentVisualInspector(job);
        jobs.set(jobId, { inspect: thinking.wrap(inspector), renderSpec: createSpecRenderer(job), ...(run ? { submit: () => run.submit() } : {}) });
        let factsText: string | null = null;
        if (process.env.PI_DIAGRAM_SOURCE_FACTS === '1') {
          try {
            factsText = await buildSourceFacts(job);
            ctx.ui.notify('Source facts included in the prompt (original render positions, reference only)', 'info');
          } catch (error) {
            ctx.ui.notify(`Source facts unavailable, continuing without them: ${String((error as Error).message)}`, 'warning');
          }
        }
        if (specMode) ctx.ui.notify('Layout spec mode on: layout.json + diagram_render_spec offered', 'info');
        pi.sendUserMessage(composePrompt(job, { jobId, specMode, factsText, v2: v2Budgets ? { maxRounds: v2Budgets.maxRounds, maxInspectionsPerRound: v2Budgets.maxInspectionsPerRound } : null }), { deliverAs: 'followUp' });
        ctx.ui.notify(`Pi diagram agent started; private work directory: ${job.runDir}`, 'info');
      } catch (error) {
        ctx.ui.notify(`Diagram agent could not start: ${String((error as Error).message)}`, 'warning');
      }
    },
  });
  pi.registerCommand('magic-accept', {
    description: 'Human only: validate a REVIEWED /magic run for exactly one SVG hash. Usage: /magic-accept <runDir> <svgSha256>',
    handler: async (args, ctx) => {
      const [dir, rawSha, ...rest] = tokenize(args);
      const sha = rawSha?.toLowerCase();
      if (!dir || !sha || rest.length) {
        ctx.ui.notify('Usage: /magic-accept /absolute/run-dir <svg-sha256>', 'warning');
        return;
      }
      try {
        const real = safeRunDir(dir, { cwd: ctx.cwd });
        const live = runsByDir.get(real);
        // The in-memory manifest of a run this process orchestrated (or accepted) is the strongest reference; the author cannot reach it.
        const expected = acceptedManifests.get(real) ?? live?.manifest?.() ?? null;
        const result = acceptRun(real, sha, { expected, cwd: ctx.cwd });
        acceptedManifests.set(real, result.manifest);
        ctx.ui.notify(`VALIDATED ${result.svgSha256} (recorded in ${result.manifestPath}, mirrored to ${real}/run.json, by ${result.acceptance.authorisedBy}).${expected ? '' : ' This process did not orchestrate the run, so the manifest was checked against its authoritative copy outside the run directory, not an in-memory record.'}`, 'info');
      } catch (error) {
        ctx.ui.notify(`Not validated: ${String((error as Error).message)}`, 'warning');
      }
    },
  });
  async function expireRun(run: any, ctx: any) {
    if (!run || run.isFinal()) return;
    try { ctx?.abort?.(); } catch { /* the session may already be idle */ }
    try { await run.expireWallClock(); } catch { /* best effort: the manifest stays RUNNING if even the audit fails */ }
  }
  if (v2On) {
    pi.on?.('message_end', async (event: any, ctx: any) => {
      const message = event?.message;
      if (message?.role === 'assistant' && activeRun && !activeRun.isFinal()) {
        activeStarted = true;
        if (message.usage) activeRun.addAuthorUsage(message.usage);
        if (activeRun.wallExceeded()) await expireRun(activeRun, ctx);
      }
    });
    pi.on?.('agent_end', async () => {
      // The author stopped without a final status from diagram_submit: audit its final bytes and record a CANDIDATE manifest.
      if (activeRun && activeStarted && !activeRun.isFinal()) {
        try { await activeRun.finalizeWithoutSubmit(); } catch { /* the manifest is best effort here; the author already ended */ }
      }
    });
    pi.registerTool(defineTool({
      name: 'diagram_submit',
      label: 'Submit the candidate for audit and independent review',
      description: 'Signal that candidate.svg is ready. The orchestrator re-renders the exact final bytes, runs the deterministic auditor and an independent reviewer, then returns either structured findings to fix (call again after fixing) or a final status (REVIEWED or CANDIDATE). You cannot certify your own work.',
      parameters: Type.Object({ jobId: Type.String() }),
      async execute(_id, params) {
        const job = jobs.get(params.jobId);
        if (!job?.submit) throw Error('UNKNOWN_DIAGRAM_JOB');
        return await job.submit();
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
