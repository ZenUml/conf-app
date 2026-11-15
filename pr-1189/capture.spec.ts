import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { handleRenderRequest } from './renderMcp';
const CASES: Record<string, string> = {
  'silent-a: messages inside group': 'group "Backend" {\n  A->B: msg\n}\nB->C: z',
  'silent-b: one-line block after async message': 'A->B: POST /orders { B->C: save() }',
  'fail-c: group after first message': 'A->B: msg\ngroup "x" {\n  B\n}\nB->C: z',
  'fail-d: multi-line block after async message': 'A->B: POST /x {\n  B->C: y\n}',
};
it('capture', async () => {
  const out: Record<string, unknown> = {};
  for (const [k, src] of Object.entries(CASES)) {
    const res = await handleRenderRequest(new Request('https://x.test/mcp/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_diagram', arguments: { diagramType: 'sequence', source: src } } }) }), {});
    const b = (await res.json()) as any;
    const { source, ...rest } = b.result.structuredContent;
    out[k] = { source: src, text: b.result.content[0].text, structuredContent: rest };
  }
  writeFileSync(process.env.CAPTURE_OUT!, JSON.stringify(out, null, 2));
});
