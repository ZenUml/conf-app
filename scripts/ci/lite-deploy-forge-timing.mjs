#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function phaseForLine(line) {
  const text = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
  if (text === 'Running forge lint...') return 'lint';
  if (/^ℹ Packaging app files/.test(text)) return 'packaging';
  if (text === 'Packaging bundled files') return 'resource_archive';
  if (/^ℹ Uploading app/.test(text)) return 'upload';
  if (/^ℹ Validating manifest/.test(text)) return 'manifest_validation';
  if (/^ℹ Deploying to environment/.test(text)) return 'server_deployment';
  if (/^✔ Deployed$/.test(text)) return 'complete';
  return null;
}
async function main() {
  const variant = process.argv[2];
  if (variant !== 'lite') throw new Error('Timing wrapper is restricted to Lite staging');
  const started = Date.now();
  const phases = [{ phase: 'startup', offset_ms: 0 }];
  let partial = '';
  const child = spawn('pnpm', ['forge:deploy:lite:staging'], { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  const observe = chunk => {
    partial += chunk.toString();
    const lines = partial.split('\n');
    partial = lines.pop();
    for (const line of lines) {
      const phase = phaseForLine(line);
      if (phase && !phases.some(item => item.phase === phase)) phases.push({ phase, offset_ms: Date.now() - started });
    }
  };
  child.stdout.on('data', chunk => { process.stdout.write(chunk); observe(chunk); });
  child.stderr.on('data', chunk => { process.stderr.write(chunk); observe(chunk); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  let previous = [];
  try { previous = JSON.parse(await readFile('lite-deploy-forge.json', 'utf8')); } catch { /* First attempt. */ }
  previous.push({ attempt: previous.length + 1, duration_ms: Date.now() - started, exit_code: code, phases });
  await writeFile('lite-deploy-forge.json', JSON.stringify(previous, null, 2));
  process.exitCode = code ?? 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Forge timing wrapper failed'); process.exitCode = 1; });
