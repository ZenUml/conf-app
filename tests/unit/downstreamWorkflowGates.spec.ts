import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const { jobs } = load(readFileSync('.github/workflows/build-test-deploy.yml', 'utf8')) as any;
const downstream = ['staging-diagramly-e2e', 'staging-asyncapi', 'staging-asyncapi-e2e', 'draft-release-diagramly', 'draft-release-asyncapi'];

// Evaluate the actual workflow expressions, including GitHub's implicit success
// check. A skipped ancestor models main's intentionally skipped PR selector.
function eligible(id: string, overrides: Record<string, string> = {}, cancelled = false, ref = 'refs/heads/main') {
  const job = jobs[id];
  const needs = Object.fromEntries(job.needs.map((name: string) => [name, { result: overrides[name] ?? 'success', outputs: { run: 'true' } }]));
  const expression = job.if.slice(3, -2).replace(/needs\.([\w-]+)/g, 'needs["$1"]');
  const explicitStatus = /\b(?:cancelled|always|success|failure)\(/.test(expression);
  // The ancestor success status is false even when all direct needs succeeded.
  if (!explicitStatus) return false;
  const github = { ref, event_name: 'push', event: { repository: { default_branch: 'main' } } };
  return Function('needs', 'github', 'cancelled', 'format', `return (${expression})`)(needs, github, () => cancelled, (_: string, branch: string) => `refs/heads/${branch}`);
}

describe('main downstream staging gates', () => {
  for (const id of downstream) {
    it(`${id} runs after successful direct prerequisites despite a skipped PR-only ancestor`, () => {
      expect(eligible(id)).toBe(true);
    });
    it(`${id} rejects each unsuccessful direct prerequisite`, () => {
      for (const prerequisite of jobs[id].needs) {
        for (const result of ['failure', 'skipped', 'cancelled']) {
          expect(eligible(id, { [prerequisite]: result }), `${prerequisite}: ${result}`).toBe(false);
        }
      }
    });
    it(`${id} never runs on a cancelled workflow or feature branch`, () => {
      expect(eligible(id, {}, true)).toBe(false);
      expect(eligible(id, {}, false, 'refs/heads/feature')).toBe(false);
    });
  }
});
