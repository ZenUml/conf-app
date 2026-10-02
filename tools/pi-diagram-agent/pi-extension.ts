/** Pi's model, not the prior deterministic CLI, owns diagram creation and revision. */
import { randomUUID } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { prepareAgentTask, createAgentVisualInspector } from './src/agent-led.mjs';
import { createThinkingSwitch } from './src/thinking-switch.mjs';

export default function (pi: ExtensionAPI) {
  const jobs = new Map<string, { inspect: () => Promise<unknown> }>();

  pi.registerCommand('magic', {
    description: 'Start a Pi-led, quality-first Mermaid-to-SVG improvement session',
    handler: async (args, ctx) => {
      const parts = args.trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map(value => value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_all, double, single) => double ?? single)) ?? [];
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
        // PI_DIAGRAM_FIRST_DRAFT_THINKING (e.g. "medium"): first draft at that level, then "high" after the first successful inspection. This overrides the CLI --thinking flag for the first draft.
        const thinking = createThinkingSwitch({ firstDraftLevel: process.env.PI_DIAGRAM_FIRST_DRAFT_THINKING || undefined, setLevel: level => pi.setThinkingLevel(level as any) });
        if (!thinking.start()) pi.setThinkingLevel('high');
        const job = prepareAgentTask(input, { cwd: ctx.cwd, resumeRunDir: options['--resume'] as string | undefined, referenceSvgPath: options['--reference'] as string | undefined, feedbackPath: options['--feedback'] as string | undefined, upgradeRules: options['--upgrade-rules'] === true, adjudicationPath: options['--adjudication'] as string | undefined });
        const jobId = randomUUID();
        jobs.set(jobId, { inspect: thinking.wrap(createAgentVisualInspector(job)) });
        pi.sendUserMessage(`${job.prompt}\n\nVisual inspection job ID: ${jobId}. Call diagram_inspect with this ID after each candidate. The tool returns the original image, ${job.referenceSvgBytes ? 'accepted reference full and viewer-fit images, ' : ''}candidate full image, four candidate crops, and final-viewer contain-fit image as actual images. Your final answer must state the candidate path, exact SVG hash from the final inspection, defects that remain, and which rules lack independent proof.`, { deliverAs: 'followUp' });
        ctx.ui.notify(`Pi diagram agent started; private work directory: ${job.runDir}`, 'info');
      } catch (error) {
        ctx.ui.notify(`Diagram agent could not start: ${String((error as Error).message)}`, 'warning');
      }
    },
  });
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
}
