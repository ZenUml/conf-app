#!/usr/bin/env node
/**
 * Local-only Architecture Tokens pilot executor.
 *
 * It is deliberately opt-in: no source is read or sent until both --execute
 * and ARCHITECTURE_TOKEN_LOCAL_EXECUTE_ENABLED=true are present. Raw Mermaid is
 * is held in memory while processed. The artifact is written only to a
 * protected local directory and intentionally retains source references and
 * raw model responses for the operator's audit; it must never be committed,
 * logged, uploaded, or shared. Secrets are never written to the artifact.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const PRIMARY = 'z-ai/glm-5.2:free';
const ULTRA_PRIMARY = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const FALLBACK = 'nvidia/nemotron-3-super-120b-a12b:free';
const PROMPT_VERSION = 'architecture-token-openrouter-v1';
const EXPECTED_COUNT = 117;
const REQUEST_TIMEOUT_MS = 45_000;
const FORBIDDEN = /\b(actor|client|ui|user|workflow|step|store|database|db|module)\b/i;
const TYPE = new Set(['service', 'api', 'external-service']);

function usage() {
  console.log('Usage: ARCHITECTURE_TOKEN_LOCAL_EXECUTE_ENABLED=true node scripts/architecture-tokens-local-pilot.mjs --execute --credential-env <path> --space-file <path> --app-file <path> --manifest-file <path> --output-dir <path> [--full]');
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function parseEnv(text, name) {
  for (const line of text.split(/\r?\n/)) {
    const match = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line);
    if (!match) continue;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (value) return value;
  }
  return null;
}

function guardedSequence(rawValue) {
  try {
    const raw = JSON.parse(rawValue);
    if (raw?.diagramType?.toLowerCase() !== 'mermaid' || typeof raw?.mermaidCode !== 'string') return null;
    let code = raw.mermaidCode.trimStart();
    while (code.startsWith('%%')) {
      const newline = code.indexOf('\n');
      if (newline < 0) return null;
      code = code.slice(newline + 1).trimStart();
    }
    return /^sequenceDiagram(?:\s|$)/.test(code) ? code : null;
  } catch { return null; }
}

function labels(code) {
  const result = new Set();
  for (const line of code.split(/\r?\n/)) {
    const match = /^\s*participant\s+([^\s]+)(?:\s+as\s+(.+?))?\s*$/.exec(line);
    if (!match) continue;
    result.add(match[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase());
    if (match[2]) result.add(match[2].trim().replace(/^['"]|['"]$/g, '').toLowerCase());
  }
  return result;
}

function literalEvidence(code, evidence, label) {
  return code.split(/\r?\n/).some((line) => line.replace(/\s+/g, ' ').trim() === evidence.replace(/\s+/g, ' ').trim()
    && line.toLowerCase().includes(label.toLowerCase()));
}

function parseModelOutput(raw) {
  if (raw && typeof raw === 'object') return { payload: raw, format: 'native-json' };
  if (typeof raw !== 'string') return { payload: null, format: 'invalid' };
  const parse = (text, format) => { try { return { payload: JSON.parse(text), format }; } catch { return null; } };
  const direct = parse(raw.trim(), 'native-json');
  if (direct) return direct;
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(raw);
  if (fenced) {
    const repaired = parse(fenced[1], 'repaired-json');
    if (repaired) return repaired;
  }
  const first = raw.indexOf('{'); const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const repaired = parse(raw.slice(first, last + 1), 'repaired-json');
    if (repaired) return repaired;
  }
  return { payload: null, format: 'invalid' };
}

function allowed(candidate) {
  const context = `${candidate.label} ${candidate.evidenceSnippet}`.toLowerCase();
  if (FORBIDDEN.test(context)) return false;
  if (candidate.type === 'service') return /\bservice\b/.test(context);
  if (candidate.type === 'api') return /\bapi\b/.test(context);
  return /\b(external|third[- ]party|vendor|partner)\b/.test(context) && /\b(service|api)\b/.test(context);
}

function validate(raw, source) {
  const { payload } = parseModelOutput(raw);
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates)) return [];
  const participants = labels(source.code);
  const valid = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || !TYPE.has(candidate.type) || typeof candidate.label !== 'string'
      || typeof candidate.evidenceSnippet !== 'string' || typeof candidate.status !== 'string') continue;
    if (!participants.has(candidate.label.trim().toLowerCase()) || !literalEvidence(source.code, candidate.evidenceSnippet, candidate.label) || !allowed(candidate)) continue;
    const key = `${candidate.type}\u0000${candidate.label.trim().toLowerCase()}`;
    valid.set(key, {
      label: candidate.label.trim(), type: candidate.type, confidence: ['high', 'medium', 'low'].includes(candidate.confidence) ? candidate.confidence : 'low',
      status: ['accepted', 'rejected', 'abstained'].includes(candidate.status) ? candidate.status : 'abstained',
      observedRole: candidate.type === 'api' ? 'Explicit API participant' : candidate.type === 'service' ? 'Explicit service participant' : 'Explicit external service participant',
      evidence: 'Explicit participant declaration and allowed role verified',
    });
  }
  return [...valid.values()];
}

function forbiddenAccepted(raw) {
  const { payload } = parseModelOutput(raw);
  return Array.isArray(payload?.candidates) ? payload.candidates.filter((item) => item?.status === 'accepted'
    && FORBIDDEN.test([item.label, item.type, item.observedRole, item.evidenceSnippet].filter((v) => typeof v === 'string').join(' '))).length : 0;
}

async function withRetry(request, init) {
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(request, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.ok) return response.json();
      if (response.status !== 429 && response.status < 500) throw new Error('provider rejected request');
      last = new Error('provider request did not complete');
      const seconds = Number(response.headers.get('retry-after'));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(seconds) ? Math.min(seconds * 1000, 30_000) : Math.min(500 * 2 ** attempt, 30_000)));
    } catch (error) {
      if (error.message === 'provider rejected request') throw error;
      last = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 30_000)));
    }
  }
  throw last ?? new Error('provider request did not complete');
}

async function d1Rows(spaceId, appId) {
  const sql = `SELECT contentId AS sourceId, latestVersionNumber AS sourceRevision, json_extract(body, '$.raw.value') AS rawValue FROM CustomContent WHERE spaceId = '${spaceId.replaceAll("'", "''")}' AND appId = '${appId.replaceAll("'", "''")}' AND status = 'current' AND json_extract(json_extract(body, '$.raw.value'), '$.diagramType') = 'mermaid'`;
  const child = spawn('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'conf-zenuml-prod', '--config', 'wrangler-prod.toml', '--env', 'production', '--remote', '--json', '--command', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`D1 read failed (${String(code)})`);
  let response;
  try { response = JSON.parse(stdout); } catch { throw new Error('D1 read failed'); }
  return (response[0]?.results ?? []).map((row) => {
    const source = guardedSequence(row.rawValue);
    return source ? { sourceId: String(row.sourceId), sourceRevision: Number(row.sourceRevision), code: source, sourceHash: createHash('sha256').update(row.rawValue).digest('hex') } : null;
  }).filter(Boolean);
}

async function extract(key, model, source) {
  const body = await withRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'Extract conservative candidates only for explicitly declared Mermaid sequence participants represented as Service, API, or external service. Exclude actors, clients, UIs, workflows, stores, databases, and generic modules. Return JSON only: {"candidates":[{"label":"","type":"service|api|external-service","observedRole":"","evidenceSnippet":"literal source line","confidence":"high|medium|low","status":"accepted|rejected|abstained"}]}. If uncertain return an empty list.' },
      { role: 'user', content: source.code },
    ] }),
  });
  if (body?.model !== model) throw new Error('provider model identity was not confirmed');
  return body?.choices?.[0]?.message?.content ?? null;
}

function quality(expected, actual, forbidden) {
  const key = (sourceId, candidate) => `${sourceId}\u0000${candidate.type}\u0000${candidate.label.toLowerCase()}`;
  const wanted = new Set(expected.flatMap((source) => source.candidates.map((candidate) => key(source.sourceId, candidate))));
  const seen = new Set(actual.flatMap((source) => source.candidates.map((candidate) => key(source.sourceId, candidate))));
  const tp = [...seen].filter((item) => wanted.has(item)).length;
  const fp = seen.size - tp; const fn = [...wanted].filter((item) => !seen.has(item)).length;
  const precision = seen.size ? tp / seen.size : 0;
  const explicit = seen.size ? [...seen].filter((item) => TYPE.has(item.split('\u0000')[1])).length / seen.size : 0;
  return { truePositiveCount: tp, falsePositiveCount: fp, falseNegativeCount: fn, forbiddenFalsePositiveCount: forbidden, precision, recall: wanted.size ? tp / wanted.size : 0, explicitFormRate: explicit, passed: precision >= .9 && forbidden === 0 && explicit >= .8 };
}

async function runModel(key, model, sources, manifest) {
  const records = []; let forbidden = 0;
  for (const source of sources) {
    try {
      const raw = await extract(key, model, source);
      const parsed = parseModelOutput(raw);
      forbidden += forbiddenAccepted(parsed.payload);
      records.push({ source, status: 'succeeded', format: parsed.format, modelOutput: raw, candidates: validate(parsed.payload, source) });
    }
    catch { records.push({ source, status: 'failed', format: 'request-failed', candidates: [] }); }
  }
  const actual = records.map((record) => ({ sourceId: record.source.sourceId, candidates: record.candidates.filter((candidate) => candidate.status === 'accepted').map(({ label, type }) => ({ label, type })) }));
  const format = records.reduce((counts, record) => (counts[record.format] = (counts[record.format] ?? 0) + 1, counts), {});
  const outputCount = records.filter((record) => record.status === 'succeeded').length;
  return { model, status: records.some((record) => record.status === 'failed') ? 'failed' : 'succeeded', records, formatAdherence: { nativeJsonCount: format['native-json'] ?? 0, repairedJsonCount: format['repaired-json'] ?? 0, invalidCount: format.invalid ?? 0, requestFailureCount: format['request-failed'] ?? 0, nativeJsonRate: outputCount ? (format['native-json'] ?? 0) / outputCount : 0, usableJsonRate: outputCount ? ((format['native-json'] ?? 0) + (format['repaired-json'] ?? 0)) / outputCount : 0 }, quality: quality(manifest.sources, actual, forbidden) };
}

function freeTextModels(catalogue) {
  return new Set((catalogue?.data ?? [])
    .filter((model) => model?.pricing?.prompt === '0' && model?.pricing?.completion === '0'
      && model?.architecture?.input_modalities?.includes('text')
      && model.id !== 'openrouter/free')
    .map((model) => model.id));
}

function panelFromCatalogue(catalogue) {
  const supported = freeTextModels(catalogue);
  return { supported, panel: [ULTRA_PRIMARY, FALLBACK].filter((model) => supported.has(model)) };
}

function localRecord(record) {
  return {
    sourceId: record.source.sourceId,
    sourceRevision: record.source.sourceRevision,
    sourceHash: record.source.sourceHash,
    status: record.status,
    format: record.format,
    modelOutput: record.modelOutput ?? null,
    candidates: record.candidates,
  };
}

function bestPassingAttempt(attempts) {
  return attempts.filter((attempt) => attempt.status === 'succeeded' && attempt.quality.passed)
    .sort((left, right) => right.quality.precision - left.quality.precision
      || right.quality.recall - left.quality.recall
      || right.quality.truePositiveCount - left.quality.truePositiveCount
      || left.model.localeCompare(right.model))[0];
}

async function main() {
  const args = process.argv.slice(2); if (args.includes('--help')) return usage();
  if (!args.includes('--execute') || process.env.ARCHITECTURE_TOKEN_LOCAL_EXECUTE_ENABLED !== 'true') throw new Error('local execution is disabled');
  const credentialEnv = option(args, '--credential-env'); const spaceFile = option(args, '--space-file'); const appFile = option(args, '--app-file'); const manifestFile = option(args, '--manifest-file'); const outputDir = option(args, '--output-dir');
  if (![credentialEnv, spaceFile, appFile, manifestFile, outputDir].every(Boolean)) throw new Error('local pilot configuration is incomplete');
  const envText = await readFile(credentialEnv, 'utf8'); const key = parseEnv(envText, 'OPENAI_API_KEY'); const base = parseEnv(envText, 'OPENAI_BASEURL');
  if (!key || !base || !/^https:\/\/openrouter\.ai\/api\/v1\/?$/.test(base)) throw new Error('approved local OpenRouter-compatible credential is unavailable');
  const [spaceId, appId, manifestText] = await Promise.all([readFile(spaceFile, 'utf8'), readFile(appFile, 'utf8'), readFile(manifestFile, 'utf8')]);
  const manifest = JSON.parse(manifestText); if (!Array.isArray(manifest?.sources) || manifest.sources.length !== 10) throw new Error('calibration manifest is invalid');
  const sources = await d1Rows(spaceId.trim(), appId.trim()); if (sources.length !== EXPECTED_COUNT) throw new Error('approved corpus does not match 117 current sources');
  const byIdentity = new Map(sources.map((source) => [`${source.sourceId}\u0000${source.sourceRevision}`, source]));
  const calibrationSources = manifest.sources.map((sample) => byIdentity.get(`${sample.sourceId}\u0000${sample.sourceRevision}`)); if (calibrationSources.some((source) => !source)) throw new Error('calibration manifest is no longer current');
  const catalogue = await withRetry('https://openrouter.ai/api/v1/models', { headers: { Accept: 'application/json' } });
  const { supported, panel } = panelFromCatalogue(catalogue);
  if (!supported.has(ULTRA_PRIMARY) || !supported.has(FALLBACK) || !panel.includes(ULTRA_PRIMARY) || !panel.includes(FALLBACK)) throw new Error('approved Nemotron local model panel is unavailable');
  const attempts = [await runModel(key, ULTRA_PRIMARY, calibrationSources, manifest)];
  if (attempts[0].status !== 'succeeded' || !attempts[0].quality.passed) attempts.push(await runModel(key, FALLBACK, calibrationSources, manifest));
  const selected = bestPassingAttempt(attempts);
  const artifact = { schemaVersion: 4, promptVersion: PROMPT_VERSION, requestTimeoutMs: REQUEST_TIMEOUT_MS, corpusSourceCount: sources.length, catalogueAssessment: { originalPrimary: { model: PRIMARY, available: supported.has(PRIMARY), calibrationAttempted: false, reason: 'known unavailable from a prior 429 probe' }, primary: { model: ULTRA_PRIMARY, available: supported.has(ULTRA_PRIMARY), calibrationAttempted: true, formatExpectation: 'strict JSON' }, fallback: { model: FALLBACK, available: supported.has(FALLBACK), calibrationAttempted: attempts.length > 1, formatExpectation: 'local repair may be required' }, requestedAlternatives: { lagunaAvailable: supported.has('poolside/laguna-s-2.1:free'), lagunaCalibrationAttempted: false, lagunaReason: 'known rate limited from a prior probe' } }, calibrationModelPanel: panel, calibration: attempts.map((attempt) => ({ model: attempt.model, status: attempt.status, formatAdherence: attempt.formatAdherence, quality: attempt.quality, sources: attempt.records.map(localRecord) })), selectedModel: selected?.model ?? null, fullRun: null };
  if (args.includes('--full') && selected) { const full = await runModel(key, selected.model, sources, { sources: [] }); artifact.fullRun = { model: full.model, status: full.status, sources: full.records.map(localRecord) }; }
  await mkdir(outputDir, { recursive: true, mode: 0o700 }); await writeFile(join(outputDir, 'architecture-tokens-pilot-result.json'), JSON.stringify(artifact), { mode: 0o600 });
  console.log(JSON.stringify({ corpusSourceCount: sources.length, calibrationModels: attempts.map((attempt) => attempt.model), selectedModel: artifact.selectedModel, fullRunRequested: args.includes('--full'), artifactWritten: true }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'local pilot failed'); process.exitCode = 1; });
