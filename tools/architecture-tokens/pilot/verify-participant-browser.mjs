import { readFile } from 'node:fs/promises';

const artifactDirectory = process.env.ARCHTOK_DIR ?? process.cwd();
const browserPath = `${process.env.ARCHTOK_OUT ?? artifactDirectory + '/'}architecture-tokens-participant-browser.html`;
const artifact = JSON.parse(await readFile(`${artifactDirectory}/participant-normalization-analysis.json`, 'utf8'));
const html = await readFile(browserPath, 'utf8');
const match = html.match(/const data=(.*);const esc=/s);
if (!match) throw new Error('Browser payload marker missing');
const payload = JSON.parse(match[1]);
const forbidden = ['sequenceDiagram', 'mermaidCode', 'sourceId', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'observedInteractionEvidence'];
const forbiddenMatches = forbidden.filter((term) => html.includes(term));
const fields = payload.occurrences.every((item) =>
  typeof item.rawLabel === 'string'
  && typeof item.readableNormalizedDisplay === 'string'
  && typeof item.comparisonKey === 'string'
  && !('sourceId' in item)
  && !('sourceHash' in item)
);
console.log(JSON.stringify({
  normalizationSchemaVersion: artifact.schemaVersion,
  occurrenceCount: payload.occurrences.length,
  comparisonKeyGroupCount: payload.groups.length,
  cohortSourceCount: payload.cohortSourceCount,
  occurrenceFieldsValid: fields,
  browserExplicitlyNamesLexicalCandidateKey: html.includes('Lexical candidate key'),
  browserExplicitlyRejectsIdentityMerging: html.includes('Neither layer is an enterprise identity') && html.includes('basis for cross-diagram merging'),
  forbiddenMatches,
}, null, 2));
