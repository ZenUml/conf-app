import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicScope, ignoredPath } from './pr-basic-scope.mjs';
const decide = files => basicScope(async () => ({ changed_files: files.length, head: { sha: 'head' }, base: { sha: 'base' } }), async () => files);
const file = filename => ({ filename, status: 'modified' });
test('docs and ignored tooling skip basic checks', async () => {
  const paths = ['README.md', 'src/README.md', 'docs/example.json', '.claude/foo.js', '.cursor/x', 'packages/pr-agent-panel/a.ts', 'workers/render-mcp/index.js', '.github/workflows/render-mcp-deploy.yml', 'scripts/ci/check-render-mcp.mjs', 'scripts/ci/wait-for-render-mcp.node-test.mjs'];
  assert.ok(paths.every(ignoredPath));
  assert.equal((await decide(paths.map(file))).run, false);
});
test('mixed documentation and code runs basic checks', async () => {
  assert.equal((await decide([file('docs/readme.md'), file('src/app.ts')])).run, true);
});
test('renames check both paths', async () => {
  assert.equal((await decide([{ filename: 'docs/old.md', previous_filename: 'src/old.ts', status: 'renamed' }])).run, true);
  assert.equal((await decide([{ filename: 'src/new.ts', previous_filename: 'docs/old.md', status: 'renamed' }])).run, true);
  assert.equal((await decide([{ filename: 'docs/new.md', previous_filename: 'docs/old.md', status: 'renamed' }])).run, false);
});
test('failed, incomplete, or changed discovery runs basic checks', async () => {
  assert.equal((await basicScope(async () => { throw new Error('API unavailable'); }, async () => [])).run, true);
  assert.equal((await basicScope(async () => ({ changed_files: 2, head: { sha: 'h' }, base: { sha: 'b' } }), async () => [file('docs/a.md')])).run, true);
  let count = 0;
  assert.equal((await basicScope(async () => ({ changed_files: 1, head: { sha: ++count === 1 ? 'h' : 'new' }, base: { sha: 'b' } }), async () => [file('docs/a.md')])).run, true);
});
