import { request } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { APP_PROFILES } from '../../config/apps.ts';
import { runRetention } from './run.mjs';
import { rateLimitedRequest } from './rate-limit.mjs';
import { resolveConfluenceBuckets } from './confluence-buckets.mjs';

const allowedProfiles = new Set(['zenuml-lite@stg', 'zenuml-full@stg', 'diagramly@stg', 'asyncapi@stg']);
const args = process.argv.slice(2);
if (args.some(arg => !['--execute', '--dry-run', '--provision'].includes(arg)) || (args.includes('--execute') && args.includes('--dry-run'))) throw new Error('Use --dry-run or --execute, optionally --provision');
const execute = args.includes('--execute');
const profileId = process.env.APP;
if (!allowedProfiles.has(profileId)) throw new Error('APP must identify a supported staging profile');
const profile = APP_PROFILES[profileId];
if (!profile?.parentPageId || !profile.domain.endsWith('-stg.atlassian.net')) throw new Error('A fixed staging root is required');
if (!process.env.FORGE_EMAIL || !process.env.FORGE_API_TOKEN) throw new Error('FORGE_EMAIL and FORGE_API_TOKEN are required');
const fixtures = JSON.parse(await readFile(new URL('../../config/render-fixtures.json', import.meta.url), 'utf8'));
const fixtureIds = new Set(Object.values(fixtures[profileId] ?? {}).filter(id => typeof id === 'string'));
const context = await request.newContext({ httpCredentials: { username: process.env.FORGE_EMAIL, password: process.env.FORGE_API_TOKEN }, timeout: 30000 });
const reportPath = process.env.E2E_RETENTION_REPORT ?? `retention-report-${profileId.replaceAll('@', '-')}.json`;
const events = [];
try {
  const limited = rateLimitedRequest(context);
  if (args.includes('--provision')) {
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    for (const date of [now, nextMonth]) {
      const bucket = await resolveConfluenceBuckets({ request: limited, domain: profile.domain, rootId: profile.parentPageId, now: date, allowCreate: true });
      console.log(JSON.stringify({ status: 'provisioned', month: bucket.month, monthId: bucket.monthId }));
    }
  }
  const result = await runRetention({ request: limited, domain: profile.domain, rootId: profile.parentPageId, fixtureIds, execute,
    onResult: event => { events.push(event); console.log(JSON.stringify(event)); },
  });
  await writeFile(reportPath, JSON.stringify({ profile: profileId, mode: execute ? 'execute' : 'dry-run', ...result }, null, 2));
  if (result.stopped) process.exitCode = 1;
} catch (error) {
  await writeFile(reportPath, JSON.stringify({ profile: profileId, mode: execute ? 'execute' : 'dry-run', stopped: true, error: String(error.message), events }, null, 2));
  console.error(`Retention stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.dispose();
}
