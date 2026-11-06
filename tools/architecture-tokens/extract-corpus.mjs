#!/usr/bin/env node
/**
 * Corpus file -> participant occurrence artifact.
 *
 *   node --experimental-strip-types tools/architecture-tokens/extract-corpus.mjs \
 *     --corpus <corpus.json> --out <occurrences.json>
 *
 * Three layers per occurrence, kept distinct on purpose:
 *   rawLabel                  what the author wrote as the declaration label
 *   readableNormalizedDisplay case-folded, whitespace-collapsed display form
 *   comparisonKey             lexical grouping key (`partner.app`) — a non-binding
 *                             aid for finding possible repeats, never an identity
 *
 * `actorId` (the declaration name) is the anchor for durable decisions; it is
 * stored but never used as a grouping key. Legacy field names `alias` and
 * `displayLabel` are kept so the pilot/ scripts keep working.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { extractParticipants, extractZenUmlParticipants } from './extract.ts';
import { lexicalComparisonKey, lexicalGroupingToken, readableNormalizedDisplay } from './pilot/participant-normalization.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Dot-key variants with the same separator-insensitive token share the most
 * segmented dotted presentation (`miniappcli` -> `mini.app.cli`). Corpus
 * dependent by design: the key is derived, decisions anchor on actorId.
 */
function preferredDottedKeys(occurrences) {
  const preferred = new Map();
  for (const o of occurrences) {
    const existing = preferred.get(o.groupingToken);
    const segments = (k) => k.split('.').length;
    if (!existing || segments(o.comparisonKey) > segments(existing)
      || (segments(o.comparisonKey) === segments(existing) && o.comparisonKey.localeCompare(existing) < 0)) {
      preferred.set(o.groupingToken, o.comparisonKey);
    }
  }
  return preferred;
}

function deduplicateAnchors(source) {
  const byAnchor = new Map();
  for (const participant of source.participants) {
    const anchor = JSON.stringify([source.sourceId, participant.actorId, participant.lineNumber]);
    byAnchor.set(anchor, participant);
  }
  return { ...source, participants: [...byAnchor.values()] };
}

export function buildArtifact(corpus) {
  const drafts = corpus.sources.map((source) => ({
    sourceId: source.sourceId,
    sourceRevision: source.sourceRevision,
    sourceHash: source.sourceHash,
    spaceId: source.spaceId,
    pageId: source.pageId,
    participants: (source.diagramType === 'sequence'
      ? extractZenUmlParticipants(source.code ?? '')
      : extractParticipants(source.mermaidCode ?? '')).map((o) => ({
      alias: o.actorId,
      displayLabel: o.rawLabel,
      actorId: o.actorId,
      rawLabel: o.rawLabel,
      declKind: o.declKind,
      created: o.created,
      boxName: o.boxName,
      lineNumber: o.lineNumber,
      readableNormalizedDisplay: readableNormalizedDisplay(o.rawLabel),
      comparisonKey: lexicalComparisonKey(o.rawLabel),
      groupingToken: lexicalGroupingToken(o.rawLabel),
    })),
  })).map(deduplicateAnchors).filter((source) => source.participants.length > 0);
  const preferred = preferredDottedKeys(drafts.flatMap((s) => s.participants));
  const sources = drafts.map((s) => ({
    ...s,
    participants: s.participants.map(({ groupingToken, ...p }) => ({ ...p, comparisonKey: preferred.get(groupingToken) })),
  }));
  const all = sources.flatMap((s) => s.participants);
  const keys = new Set(all.map((p) => p.comparisonKey));
  return {
    schemaVersion: 4,
    cloudId: corpus.cloudId ?? null,
    method: 'Deterministic extraction of explicit Mermaid participant/actor declarations and ZenUML parser-AST participant declarations (tools/architecture-tokens/extract.ts); repeated (sourceId, actorId, lineNumber) anchors use the last declaration to match Mermaid actor-map semantics and the occurrence table primary key; readable form + slugify dot-key per pilot/participant-normalization.mjs; corpus-wide preferred dotted key. Lexical grouping aid only — no classification, no identity.',
    cohortSourceCount: sources.length,
    occurrenceCount: all.length,
    rawLabelCount: new Set(all.map((p) => p.rawLabel)).size,
    comparisonKeyCount: keys.size,
    declKinds: all.reduce((acc, p) => { const k = p.declKind + (p.created ? '+create' : ''); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
    sources,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const corpusPath = arg('corpus');
  const out = arg('out');
  if (!corpusPath || !out) {
    console.error('usage: extract-corpus.mjs --corpus <corpus.json> --out <occurrences.json>');
    process.exit(2);
  }
  const artifact = buildArtifact(JSON.parse(await readFile(corpusPath, 'utf8')));
  await writeFile(out, JSON.stringify(artifact), { mode: 0o600 });
  const summary = Object.fromEntries(Object.entries(artifact).filter(([k]) => k !== 'sources'));
  console.log(JSON.stringify(summary));
}
