import { readFile, writeFile } from 'node:fs/promises';
import { lexicalComparisonKey, lexicalGroupingToken, readableNormalizedDisplay } from './participant-normalization.mjs';

const base = `${process.env.ARCHTOK_DIR ?? process.cwd()}/`;
const source = JSON.parse(await readFile(`${base}all-explicit-participants-reanalysis.json`, 'utf8'));
const previous = JSON.parse(await readFile(`${base}participant-normalization-analysis.json`, 'utf8'));
function groupedKeys(sources, field) {
  const groups = new Map();
  for (const sourceItem of sources) for (const participant of sourceItem.participants) {
    const key = participant[field] ?? participant.normalizedKey;
    const values = groups.get(key) ?? new Set();
    values.add(participant.displayLabel); groups.set(key, values);
  }
  return groups;
}

const previousByOccurrence = new Map(previous.sources.flatMap((item) => item.participants.map((participant) => [
  `${item.sourceId}\u0000${item.sourceRevision}\u0000${participant.alias}\u0000${participant.lineNumber}`, participant.comparisonKey ?? participant.normalizedKey,
])));
let emojiAffectedOccurrences = 0; let lineBreakAffectedOccurrences = 0;
const sourceDrafts = source.sources.map((sourceItem) => ({
  sourceId: sourceItem.sourceId,
  sourceRevision: sourceItem.sourceRevision,
  sourceHash: sourceItem.sourceHash,
  participants: sourceItem.participants.map((participant) => {
    const raw = participant.displayLabel;
    const emojiAffected = /\p{Extended_Pictographic}/u.test(raw);
    const lineBreakAffected = /[\r\n]/.test(raw);
    if (emojiAffected) emojiAffectedOccurrences += 1;
    if (lineBreakAffected) lineBreakAffectedOccurrences += 1;
    const readableForm = readableNormalizedDisplay(raw);
    const comparisonKey = lexicalComparisonKey(raw);
    return { ...participant, readableNormalizedDisplay: readableForm, comparisonKey, comparisonGroupingToken: lexicalGroupingToken(raw) };
  }),
}));
const preferredDottedKeyByGroupingToken = new Map();
for (const sourceItem of sourceDrafts) for (const participant of sourceItem.participants) {
  const existing = preferredDottedKeyByGroupingToken.get(participant.comparisonGroupingToken);
  const candidate = participant.comparisonKey;
  if (!existing || candidate.split('.').length > existing.split('.').length || (candidate.split('.').length === existing.split('.').length && candidate.localeCompare(existing) < 0)) {
    preferredDottedKeyByGroupingToken.set(participant.comparisonGroupingToken, candidate);
  }
}
let comparisonKeyChangedOccurrences = 0;
const sources = sourceDrafts.map((sourceItem) => ({
  ...sourceItem,
  participants: sourceItem.participants.map(({ comparisonGroupingToken, ...participant }) => {
    const comparisonKey = preferredDottedKeyByGroupingToken.get(comparisonGroupingToken);
    const prior = previousByOccurrence.get(`${sourceItem.sourceId}\u0000${sourceItem.sourceRevision}\u0000${participant.alias}\u0000${participant.lineNumber}`);
    if (prior !== comparisonKey) comparisonKeyChangedOccurrences += 1;
    return { ...participant, comparisonKey };
  }),
}));
const oldGroups = groupedKeys(previous.sources, 'comparisonKey');
const readableGroups = groupedKeys(sources, 'readableNormalizedDisplay');
const comparisonGroups = groupedKeys(sources, 'comparisonKey');
const artifact = {
  schemaVersion: 3,
  method: 'Two deterministic layers: (1) readable normalized display form applies NFKC, removes Unicode emoji/pictographic grapheme clusters, collapses CR/LF and all whitespace to one ordinary space, canonicalizes dash and quote variants, and case-folds; (2) lexical comparison key is @sindresorhus/slugify 3.0.0 with separator dot, lowercase/camel-case normalization enabled, and transliteration disabled. For stable candidate grouping, dot-key variants with the same separator-insensitive lexical token share the most segmented dotted presentation. It is only a lexical grouping aid and does not classify services or infer identities.',
  sourceArtifactSchemaVersion: source.schemaVersion,
  cohortSourceCount: source.cohortSourceCount,
  sources,
};
await writeFile(`${base}participant-normalization-analysis.json`, JSON.stringify(artifact), { mode: 0o600 });
const distinctRaw = new Set(source.sources.flatMap((item) => item.participants.map((participant) => participant.displayLabel)));
console.log(JSON.stringify({
  distinctRawLabels: distinctRaw.size,
  readableNormalizedDisplays: readableGroups.size,
  lexicalComparisonKeysBefore: oldGroups.size,
  lexicalComparisonKeysAfter: comparisonGroups.size,
  rawLabelsCollapsedToReadable: distinctRaw.size - readableGroups.size,
  readableFormsCollapsedToComparison: readableGroups.size - comparisonGroups.size,
  emojiAffectedOccurrences,
  lineBreakAffectedOccurrences,
  comparisonKeyChangedOccurrences,
  formattingGroupsBefore: [...oldGroups.values()].filter((values) => values.size > 1).length,
  formattingGroupsAfter: [...comparisonGroups.values()].filter((values) => values.size > 1).length,
}));
