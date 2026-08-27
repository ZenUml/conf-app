import { readFile } from 'node:fs/promises';

const base = `${process.env.ARCHTOK_DIR ?? process.cwd()}/`;
const FORBIDDEN = /\b(actor|client|ui|user|workflow|step|store|database|db|module)\b/i;
const TYPES = new Set(['service', 'api', 'external-service']);
const input = JSON.parse(await readFile(`${base}luna-input.json`, 'utf8'));
const result = JSON.parse(await readFile(`${base}luna-result.json`, 'utf8'));
const expected = new Set(input.sources.flatMap((source) => source.expectedCandidates.map((candidate) => `${source.sourceId}\u0000${candidate.type}\u0000${candidate.label.toLowerCase()}`)));
const byIdentity = new Map(input.sources.map((source) => [`${source.sourceId}\u0000${source.sourceRevision}`, source]));
const participantLabels = (code) => new Set(code.split(/\r?\n/).flatMap((line) => {
  const match = /^\s*participant\s+([^\s]+)(?:\s+as\s+(.+?))?\s*$/.exec(line);
  return match ? [match[1], match[2]].filter(Boolean).map((label) => label.trim().replace(/^['"]|['"]$/g, '').toLowerCase()) : [];
}));
const literalLine = (code, evidence, label) => code.split(/\r?\n/).some((line) => line.replace(/\s+/g, ' ').trim() === evidence.replace(/\s+/g, ' ').trim() && line.toLowerCase().includes(label.toLowerCase()));
const allowed = (candidate) => {
  const context = `${candidate.label} ${candidate.evidenceSnippet}`.toLowerCase();
  if (FORBIDDEN.test(context)) return false;
  if (candidate.type === 'service') return /\bservice\b/.test(context);
  if (candidate.type === 'api') return /\bapi\b/.test(context);
  return /\b(external|third[- ]party|vendor|partner)\b/.test(context) && /\b(service|api)\b/.test(context);
};
let forbiddenAccepted = 0; const actual = new Set(); const statuses = {}; const types = {};
for (const record of result.sources ?? []) {
  statuses[record.status] = (statuses[record.status] ?? 0) + 1;
  const source = byIdentity.get(`${record.sourceId}\u0000${record.sourceRevision}`);
  if (!source) continue;
  const labels = participantLabels(source.mermaidCode);
  for (const candidate of record.candidates ?? []) {
    if (candidate?.status !== 'accepted') continue;
    if (FORBIDDEN.test([candidate.label, candidate.type, candidate.observedRole, candidate.evidenceSnippet].filter((value) => typeof value === 'string').join(' '))) forbiddenAccepted += 1;
    if (!candidate || !TYPES.has(candidate.type) || typeof candidate.label !== 'string' || typeof candidate.evidenceSnippet !== 'string') continue;
    if (!labels.has(candidate.label.trim().toLowerCase()) || !literalLine(source.mermaidCode, candidate.evidenceSnippet, candidate.label) || !allowed(candidate)) continue;
    actual.add(`${source.sourceId}\u0000${candidate.type}\u0000${candidate.label.trim().toLowerCase()}`);
    types[candidate.type] = (types[candidate.type] ?? 0) + 1;
  }
}
const truePositiveCount = [...actual].filter((key) => expected.has(key)).length;
const falsePositiveCount = actual.size - truePositiveCount;
const falseNegativeCount = [...expected].filter((key) => !actual.has(key)).length;
const precision = actual.size ? truePositiveCount / actual.size : 0;
const recall = expected.size ? truePositiveCount / expected.size : 0;
const explicitFormRate = actual.size ? [...actual].filter((key) => TYPES.has(key.split('\u0000')[1])).length / actual.size : 0;
console.log(JSON.stringify({ model: result.model, sourceCount: input.sources.length, resultSourceCount: (result.sources ?? []).length, statuses, acceptedCandidateTypes: types, quality: { truePositiveCount, falsePositiveCount, falseNegativeCount, forbiddenFalsePositiveCount: forbiddenAccepted, precision, recall, explicitFormRate, passed: precision >= 0.9 && forbiddenAccepted === 0 && explicitFormRate >= 0.8 } }));
