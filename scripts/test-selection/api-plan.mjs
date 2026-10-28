import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_LANES } from '../../tests/e2e-tests/config/api-lanes.mjs';
import { scenarioKey, validScenarios } from '../../tests/e2e-tests/config/product-impact.mjs';

const OAUTH_FILES = ['tests/integration/oauth-token/scenarios.json', 'tests/integration/oauth-token/oauth.test.ts', 'vitest.oauth-integration.config.ts'];
const OAUTH_COMMAND = 'vitest run --config vitest.oauth-integration.config.ts';
function checkManifest(lane, manifest) {
  if (!validScenarios(manifest?.scenarios) || JSON.stringify(manifest.scenarios.map(scenarioKey).sort()) !== JSON.stringify(lane.scenarios.map(scenarioKey).sort())) throw new Error('API integration blocked: candidate manifest differs from trusted registry');
}
// Read-only immutable tree and blob APIs; errors and truncated inventories fail closed.
export function githubCandidateFiles(repo, sha, api) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('API integration blocked: invalid candidate identity');
  const commit = api(`repos/${repo}/git/commits/${sha}`);
  if (!/^[a-f0-9]{40}$/.test(commit?.tree?.sha ?? '')) throw new Error('API integration blocked: invalid candidate tree');
  const tree = api(`repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree?.truncated !== false || !Array.isArray(tree.tree)) throw new Error('API integration blocked: incomplete candidate inventory');
  const entries = new Map(tree.tree.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.sha]));
  const get = path => {
    if (!entries.has(path)) return null;
    const blob = api(`repos/${repo}/git/blobs/${entries.get(path)}`);
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('API integration blocked: invalid candidate blob');
    return Buffer.from(blob.content, 'base64').toString('utf8');
  };
  return Object.fromEntries([...OAUTH_FILES, 'package.json'].map(path => [path, get(path)]));
}
// Caller must supply files from the already authorized, immutable candidate.
export function planApiLanes(selection, files) {
  if (selection?.decision_source !== 'agent' || !['all', 'selected'].includes(selection.mode)
      || !validScenarios(selection.scenarios)) throw new Error('API integration blocked: invalid authorization');
  if (!files || typeof files !== 'object') throw new Error('API integration blocked: candidate inventory required');
  const lane = API_LANES.find(item => item.id === 'oauth-token');
  const selected = selection.mode === 'selected' && lane.scenarios.some(pair => selection.scenarios.some(p => scenarioKey(p) === scenarioKey(pair)));
  if (!selected && selection.mode !== 'all') return [];
  let pkg;
  try { pkg = JSON.parse(files['package.json']); } catch { throw new Error('API integration blocked: invalid candidate package'); }
  const command = pkg?.scripts?.['test:oauth-integration'];
  const present = OAUTH_FILES.filter(path => typeof files[path] === 'string');
  if (!present.length && command === undefined) {
    if (selected) throw new Error('API integration blocked: selected lane unavailable in candidate');
    return [];
  }
  if (present.length !== OAUTH_FILES.length || command !== OAUTH_COMMAND) throw new Error('API integration blocked: incomplete candidate OAuth lane');
  let manifest;
  try { manifest = JSON.parse(files[lane.manifest]); } catch { throw new Error('API integration blocked: invalid candidate manifest'); }
  checkManifest(lane, manifest);
  return [lane.id];
}
export function verifyApiManifest(laneId, candidateRoot) {
  const lane = API_LANES.find(item => item.id === laneId);
  if (!lane) throw new Error('API integration blocked: unknown lane');
  const manifest = JSON.parse(readFileSync(resolve(candidateRoot, lane.manifest), 'utf8'));
  checkManifest(lane, manifest);
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'plan') {
      const sha = process.argv[4];
      const api = path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }));
      const lanes = planApiLanes(JSON.parse(readFileSync(process.argv[3], 'utf8')), githubCandidateFiles(process.env.GITHUB_REPOSITORY, sha, api));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `oauth-token=${lanes.includes('oauth-token')}\n`);
      console.log(JSON.stringify(lanes));
    } else if (process.argv[2] === 'verify') verifyApiManifest(process.argv[3], process.argv[4]);
    else throw new Error('Usage: api-plan.mjs plan SELECTION CANDIDATE_SHA | verify LANE CANDIDATE_ROOT');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
