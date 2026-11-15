import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { handleRenderRequest } from './renderMcp';
async function call(args: Record<string, unknown>) {
  const res = await handleRenderRequest(new Request('https://x.test/mcp/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_diagram', arguments: args } }) }), {});
  const b = (await res.json()) as any;
  const { source, ...rest } = b.result.structuredContent;
  return { args, text: b.result.content[0].text, structuredContent: rest };
}
it('chain', async () => {
  const src = 'A->B: msg\ngroup "Backend" {\n  B->C: save()\n}';
  const first = await call({ diagramType: 'sequence', source: src });
  const repeat = await call({ diagramType: 'sequence', source: src + '\n', revision: first.structuredContent.revision });
  const applied = await call({ diagramType: 'sequence', source: first.structuredContent.suggestedSource, revision: repeat.structuredContent.revision });
  writeFileSync(process.env.CAPTURE_OUT!, JSON.stringify({ first, repeat, applied }, null, 2));
});
