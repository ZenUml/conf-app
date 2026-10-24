import { readFile } from 'node:fs/promises';

const base = `${process.env.ARCHTOK_DIR ?? process.cwd()}/`;
const FORBIDDEN = /\b(actor|client|ui|user|workflow|step|store|database|db|module)\b/i;
const TYPES = new Set(['service', 'api', 'external-service']);
const input = JSON.parse(await readFile(`${base}luna-full-input.json`, 'utf8'));
const result = JSON.parse(await readFile(`${base}luna-full-result.json`, 'utf8'));
const byIdentity = new Map(input.sources.map((source) => [`${source.sourceId}\u0000${source.sourceRevision}`, source]));
const labels = (code) => new Set(code.split(/\r?\n/).flatMap((line) => {
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
const statuses = {}; const types = {}; const recurrence = new Map(); const occurrenceKeys = new Set(); let rawAccepted = 0; let forbiddenAccepted = 0; let invalidAccepted = 0; let versionMismatch = 0;
for (const record of result.sources ?? []) {
  statuses[record.status] = (statuses[record.status] ?? 0) + 1;
  const source = byIdentity.get(`${record.sourceId}\u0000${record.sourceRevision}`);
  if (!source || record.sourceHash !== source.sourceHash) { versionMismatch += 1; continue; }
  const declared = labels(source.mermaidCode);
  for (const candidate of record.candidates ?? []) {
    if (candidate?.status !== 'accepted') continue;
    rawAccepted += 1;
    if (FORBIDDEN.test([candidate.label, candidate.type, candidate.observedRole, candidate.evidenceSnippet].filter((value) => typeof value === 'string').join(' '))) forbiddenAccepted += 1;
    if (!candidate || !TYPES.has(candidate.type) || typeof candidate.label !== 'string' || typeof candidate.evidenceSnippet !== 'string' || !declared.has(candidate.label.trim().toLowerCase()) || !literalLine(source.mermaidCode, candidate.evidenceSnippet, candidate.label) || !allowed(candidate)) { invalidAccepted += 1; continue; }
    const occurrenceKey = `${source.sourceId}\u0000${candidate.type}\u0000${candidate.label.trim().toLowerCase()}`;
    if (occurrenceKeys.has(occurrenceKey)) continue;
    occurrenceKeys.add(occurrenceKey);
    types[candidate.type] = (types[candidate.type] ?? 0) + 1;
    const label = candidate.label.trim();
    const sourceSet = recurrence.get(label) ?? new Set(); sourceSet.add(source.sourceId); recurrence.set(label, sourceSet);
  }
}
const topRepeatedExactLabels = [...recurrence.entries()].map(([label, sourceIds]) => ({ label, distinctDiagramSourceCount: sourceIds.size })).filter((item) => item.distinctDiagramSourceCount > 1).sort((a, b) => b.distinctDiagramSourceCount - a.distinctDiagramSourceCount || a.label.localeCompare(b.label)).slice(0, 12);
console.log(JSON.stringify({ model: result.model, cohortSourceCount: input.cohortSourceCount, resultSourceCount: (result.sources ?? []).length, statuses, versionMismatch, rawAcceptedCandidateCount: rawAccepted, validatedAcceptedCandidateCount: occurrenceKeys.size, invalidAcceptedCandidateCount: invalidAccepted, forbiddenAcceptedCandidateCount: forbiddenAccepted, acceptedCandidateOccurrencesByType: types, topRepeatedExactLabels }));
