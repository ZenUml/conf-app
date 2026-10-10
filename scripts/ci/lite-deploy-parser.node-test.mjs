import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const cliPackage = require.resolve('@forge/cli/package.json');
// Each process gets its own parser caches and project, as real CI jobs do.
const inspectParser = String.raw`
const {createRequire} = require('node:module');
const {dirname, join} = require('node:path');
const {readFileSync} = require('node:fs');
const cliRequire = createRequire(process.argv[1]);
const lintRequire = createRequire(cliRequire.resolve('@forge/lint/package.json'));
const estreePath = lintRequire.resolve('@typescript-eslint/typescript-estree');
const {inferSingleRun} = require(join(dirname(estreePath), 'parseSettings/inferSingleRun.js'));
const {parseAndGenerateServices} = lintRequire('@typescript-eslint/typescript-estree');
const {createParseOptions, tsParser} = lintRequire('./out/parse/parser.js');
const {FileSystemReader} = cliRequire('@forge/cli-shared');
const options = file => createParseOptions(join(process.cwd(), file), new FileSystemReader());
(async () => {
  const singleRun = inferSingleRun(options('valid.ts'));
  const parsed = file => parseAndGenerateServices(readFileSync(file, 'utf8'), options(file));
  const valid = parsed('valid.ts');
  const mismatch = parsed('mismatch.ts');
  const errors = {};
  for (const file of ['syntax.ts', 'duplicate.ts', 'excluded.ts']) {
    try { await tsParser(readFileSync(file, 'utf8'), file); errors[file] = null; }
    catch (error) { errors[file] = error.message; }
  }
  process.stdout.write(JSON.stringify({
    singleRun,
    ast: valid.ast,
    validDiagnostics: valid.services.program.getSemanticDiagnostics(valid.services.program.getSourceFile(join(process.cwd(), 'valid.ts'))).map(item => item.code),
    mismatchDiagnostics: mismatch.services.program.getSemanticDiagnostics(mismatch.services.program.getSourceFile(join(process.cwd(), 'mismatch.ts'))).map(item => item.code),
    errors
  }));
  process.exit(0);
})().catch(error => { console.error(error.message); process.exit(1); });
`;

test('installed Forge typed parser changes program mode while preserving AST, diagnostics and rejections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-parser-test-'));
  try {
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2020' }, include: ['valid.ts', 'mismatch.ts', 'syntax.ts', 'duplicate.ts'] }));
    const files = {
      'valid.ts': 'export const count: number = 1;\n',
      'mismatch.ts': 'export const count: number = "wrong";\n',
      'syntax.ts': 'export const count = ;\n',
      'duplicate.ts': 'export const value = { same: 1, same: 2 };\n',
      'excluded.ts': 'export const other = 1;\n',
    };
    await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(join(directory, name), contents)));
    const run = singleRun => {
      const env = { ...process.env, CI: 'true' };
      delete env.TSESTREE_SINGLE_RUN;
      if (singleRun) env.TSESTREE_SINGLE_RUN = 'true';
      return JSON.parse(execFileSync(process.execPath, ['-e', inspectParser, cliPackage], { cwd: directory, env, encoding: 'utf8', timeout: 30000 }));
    };
    const baseline = run(false);
    const candidate = run(true);
    assert.equal(baseline.singleRun, false, 'Forge options do not automatically infer CI single-run mode');
    assert.equal(candidate.singleRun, true);
    assert.deepEqual(candidate.ast, baseline.ast);
    assert.deepEqual(baseline.validDiagnostics, []);
    assert.deepEqual(candidate.validDiagnostics, []);
    assert.deepEqual(baseline.mismatchDiagnostics, [2322], 'the TypeScript Program retains type mismatch diagnostics');
    assert.deepEqual(candidate.mismatchDiagnostics, baseline.mismatchDiagnostics);
    for (const name of ['syntax.ts', 'duplicate.ts']) {
      assert.ok(baseline.errors[name], `${name} must be rejected by the actual Forge parser`);
      assert.equal(candidate.errors[name], baseline.errors[name]);
    }
    // Watch-program and provided-program paths describe exclusion differently;
    // both must reject it rather than silently parsing without project types.
    assert.match(baseline.errors['excluded.ts'], /TSConfig does not include this file/);
    assert.match(candidate.errors['excluded.ts'], /file was not found in any of the provided program/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('single-run setting applies only to candidate Forge deployment after source preparation', async () => {
  const workflow = yaml.load(await readFile(new URL('../../.github/workflows/staging-deploy.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs.deploy.steps;
  const step = steps.find(item => item.name === 'Deploy to Forge Staging (Pages publish in parallel)');
  assert.ok(steps.indexOf(step) > steps.findIndex(item => item.name === 'Upload final manifest'));
  assert.equal(step.env.TSESTREE_SINGLE_RUN, undefined);
  assert.match(step.run, /deploy_forge\(\) \([\s\S]*if \[ "\$\{\{ needs.resolve.outputs.preparation-mode \}\}" = candidate \]; then\s+export TSESTREE_SINGLE_RUN=true\s+fi/);
  assert.match(step.run, /pnpm forge:deploy:\$\{\{ needs.resolve.outputs.variant \}\}:staging/);
  assert.equal(step.run.includes('--no-verify'), false);
  for (const item of steps.filter(item => item !== step)) assert.equal(JSON.stringify(item).includes('TSESTREE_SINGLE_RUN'), false);
  const action = await readFile(new URL('../../.github/actions/wrangler-publish/action.yml', import.meta.url), 'utf8');
  assert.equal(action.includes('TSESTREE_SINGLE_RUN'), false);
});
