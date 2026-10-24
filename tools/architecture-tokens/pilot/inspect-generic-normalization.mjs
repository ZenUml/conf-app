import { readFile } from 'node:fs/promises';
import { lexicalComparisonKey, readableNormalizedDisplay } from './participant-normalization.mjs';

const artifactDirectory = process.env.ARCHTOK_DIR ?? process.cwd();
const input = JSON.parse(await readFile(`${artifactDirectory}/all-explicit-participants-reanalysis.json`, 'utf8'));
const labels = input.sources.flatMap((source) => source.participants.map((participant) => participant.displayLabel));
const groups = new Map();
for (const rawLabel of labels) {
  const readableForm = readableNormalizedDisplay(rawLabel);
  const comparisonKey = lexicalComparisonKey(rawLabel);
  const group = groups.get(comparisonKey) ?? { rawLabels: new Set(), readableForms: new Set(), occurrences: 0 };
  group.rawLabels.add(rawLabel);
  group.readableForms.add(readableForm);
  group.occurrences += 1;
  groups.set(comparisonKey, group);
}

const comparisonCollisionGroups = [...groups.entries()]
  .filter(([, group]) => group.rawLabels.size > 1)
  .map(([comparisonKey, group]) => ({
    comparisonKey,
    rawLabels: [...group.rawLabels].sort(),
    readableForms: [...group.readableForms].sort(),
    occurrences: group.occurrences,
    createdBySeparatorRule: group.readableForms.size > 1,
  }))
  .sort((a, b) => b.occurrences - a.occurrences || a.comparisonKey.localeCompare(b.comparisonKey));

console.log(JSON.stringify({
  distinctRawLabels: new Set(labels).size,
  distinctReadableForms: new Set(labels.map(readableNormalizedDisplay)).size,
  distinctComparisonKeys: groups.size,
  comparisonCollisionGroups,
  newCollisionGroupsCreatedBySeparatorRule: comparisonCollisionGroups.filter((group) => group.createdBySeparatorRule),
}, null, 2));
