#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const STATUSES = new Set(['success', 'failure', 'skipped', 'cancelled']);
const clean = (value) => String(value).replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char]).slice(0, 500);
const link = (url, label) => {
  try { const parsed = new URL(url); if (parsed.protocol === 'https:') return `<${parsed.href.replace(/[<>|]/g, '')}|${clean(label)}>`; } catch { /* omit invalid links */ }
  return clean(label);
};

function validate(results) {
  if (!results || !results.run_id || !results.sha || !results.url || !Number.isInteger(Number(results.attempt)) || Number(results.attempt) < 1) throw new Error('Invalid regression run metadata');
  if (!Array.isArray(results.variants) || !results.variants.length) throw new Error('Regression variants must be nonempty');
  const seen = new Set();
  for (const item of results.variants) {
    if (!item.variant || seen.has(item.variant) || !['deployment', 'version', 'tests'].every((field) => STATUSES.has(item[field])) || !Array.isArray(item.failures)) throw new Error('Invalid regression variant results');
    seen.add(item.variant);
  }
}

export async function notifyRegression(results, { token, channel, previous, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  validate(results);
  if (previous?.ts && String(previous.run_id) !== String(results.run_id)) throw new Error('Previous Slack message belongs to another run');
  if (previous?.ts && previous.sha && previous.sha !== results.sha) throw new Error('Previous Slack message belongs to another SHA');
  const failed = results.variants.some((item) => ['deployment', 'version', 'tests'].some((field) => item[field] !== 'success') || item.failures.length);
  const metadata = { schema_version: 1, run_id: String(results.run_id), attempt: Number(results.attempt), sha: results.sha, status: failed ? 'failure' : previous?.ts ? 'recovered' : 'silent' };
  if (metadata.status === 'silent') return metadata;
  if (!token) throw new Error('SLACK_BOT_TOKEN is required for regression alerts');
  if (!channel) throw new Error('SLACK_CHANNEL_ID is required for regression alerts');
  if (previous?.ts && previous.channel && previous.channel !== channel) throw new Error('Previous Slack message channel differs from configured channel');
  const lines = [failed ? '*Daily staging regression needs attention*' : '*Daily staging regression recovered*', `SHA: ${clean(results.sha)} · attempt ${Number(results.attempt)} · ${link(results.url, 'Workflow run')}`];
  for (const item of results.variants) {
    lines.push(`${clean(item.variant)}: deployment ${item.deployment}, version ${item.version}, tests ${item.tests}`);
    for (const failure of item.failures) lines.push(`• ${typeof failure === 'string' ? clean(failure) : failure?.url ? link(failure.url, failure.name || 'Failure report') : clean(failure?.name || 'Unspecified failure')}`);
    if (item.report_url) lines.push(`  ${link(item.report_url, 'Test report')}`);
  }
  const method = previous?.ts ? 'chat.update' : 'chat.postMessage';
  const body = { channel, text: lines.join('\n').slice(0, 35000), unfurl_links: false, unfurl_media: false, ...(previous?.ts ? { ts: previous.ts } : {}) };
  let response;
  let data;
  try {
    response = await fetchImpl(`https://slack.com/api/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error('http');
    data = await response.json();
  } catch {
    throw new Error(response && !response.ok ? `Slack HTTP request rejected (${Number(response.status) || 'unknown'})` : 'Slack request failed (transport, timeout, or invalid response)');
  }
  if (!data?.ok || typeof data.ts !== 'string' || !data.ts) throw new Error('Slack API rejected notification or returned invalid message metadata');
  return { ...metadata, channel, ts: data.ts };
}

async function main() {
  const args = process.argv.slice(2);
  const paths = {};
  while (args.length) {
    const key = args.shift();
    if (!['--results', '--metadata', '--previous'].includes(key) || !args.length || args[0].startsWith('--')) throw new Error('Usage: notify.mjs --results <file> --metadata <file> [--previous <file>]');
    paths[key] = args.shift();
  }
  if (!paths['--results'] || !paths['--metadata']) throw new Error('--results and --metadata are required');
  const results = JSON.parse(await readFile(paths['--results'], 'utf8'));
  const previous = paths['--previous'] ? JSON.parse(await readFile(paths['--previous'], 'utf8')) : undefined;
  const metadata = await notifyRegression(results, { token: process.env.SLACK_BOT_TOKEN, channel: process.env.SLACK_CHANNEL_ID, previous });
  await writeFile(paths['--metadata'], `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Regression notification: ${metadata.status}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Regression notification failed; check result metadata and Slack configuration.'); process.exitCode = 1; });
