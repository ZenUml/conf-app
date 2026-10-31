import { it } from 'vitest';
import { writeFileSync } from 'fs';
import { HEADLESS_TOOLS } from './oauth/headlessTools';
import { RENDER_TOOL } from './renderMcp';
it('probe', () => {
  const names = [...HEADLESS_TOOLS.map((t) => t.name), RENDER_TOOL.name];
  const out: Record<string, { description: string; mentions: string[] }> = {};
  for (const t of [...HEADLESS_TOOLS, RENDER_TOOL]) {
    const text = `${t.description} ${JSON.stringify(t.inputSchema)}`;
    const mentions = names.filter((n) => n !== t.name && text.includes(n));
    if (/dsl-guide/.test(t.description)) mentions.push('dsl-guide resource');
    out[t.name] = { description: t.description, mentions };
  }
  writeFileSync(process.env.PROBE_OUT!, JSON.stringify(out, null, 2));
});
