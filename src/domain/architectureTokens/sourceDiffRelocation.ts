import { diffArrays } from 'diff';
import { sliceUtf8ByteSpan, type Utf8ByteSpan } from './utf8Locator';

export type SourceDiffHunk = Readonly<{
  kind: 'unchanged' | 'insert' | 'delete' | 'replace';
  oldSpan: Utf8ByteSpan;
  newSpan: Utf8ByteSpan;
}>;

export type SourceDiffLocator = Readonly<{
  locatorId: string;
  span: Utf8ByteSpan;
}>;

export type ExactSourceRelocation = Readonly<{
  locatorId: string;
  oldSpan: Utf8ByteSpan;
  newSpan: Utf8ByteSpan;
  confidence: 1;
  provenance: 'source_diff_unchanged';
}>;

export type UnresolvedSourceDiffLocator = Readonly<{
  locatorId: string;
  reason: 'duplicate_locator_id' | 'invalid_old_locator_span' | 'empty_old_locator_span' | 'locator_intersects_change' | 'relocated_text_mismatch';
}>;

export interface SourceDiffRelocationPreparation {
  readonly hunks: readonly SourceDiffHunk[];
  /** Source-address evidence only; it does not identify a logical element. */
  readonly relocations: readonly ExactSourceRelocation[];
  readonly unresolved: readonly UnresolvedSourceDiffLocator[];
}

/**
 * Stage 1 of the Source Binding Engine: prepares exact source-address
 * relocation evidence from unchanged UTF-8 text. This module intentionally
 * knows nothing about Mermaid IDs, fingerprints, bindings, or identity.
 */
export function prepareSourceDiffRelocation(input: Readonly<{
  oldSource: string;
  newSource: string;
  oldLocators: readonly SourceDiffLocator[];
}>): SourceDiffRelocationPreparation {
  const hunks = diffSourceByCodePoint(input.oldSource, input.newSource);
  const duplicateIds = findDuplicateIds(input.oldLocators);
  const relocations: ExactSourceRelocation[] = [];
  const unresolved: UnresolvedSourceDiffLocator[] = [];

  for (const locator of input.oldLocators) {
    if (duplicateIds.has(locator.locatorId)) {
      unresolved.push({ locatorId: locator.locatorId, reason: 'duplicate_locator_id' });
      continue;
    }

    let oldFragment: string;
    try {
      oldFragment = sliceUtf8ByteSpan(input.oldSource, locator.span);
    } catch {
      unresolved.push({ locatorId: locator.locatorId, reason: 'invalid_old_locator_span' });
      continue;
    }
    if (!oldFragment) {
      unresolved.push({ locatorId: locator.locatorId, reason: 'empty_old_locator_span' });
      continue;
    }

    const unchanged = hunks.find((hunk) => hunk.kind === 'unchanged' && spanIsWithin(locator.span, hunk.oldSpan));
    if (!unchanged) {
      unresolved.push({ locatorId: locator.locatorId, reason: 'locator_intersects_change' });
      continue;
    }

    const newSpan = {
      startByte: unchanged.newSpan.startByte + locator.span.startByte - unchanged.oldSpan.startByte,
      endByte: unchanged.newSpan.startByte + locator.span.endByte - unchanged.oldSpan.startByte,
    };
    try {
      if (sliceUtf8ByteSpan(input.newSource, newSpan) !== oldFragment) {
        unresolved.push({ locatorId: locator.locatorId, reason: 'relocated_text_mismatch' });
        continue;
      }
    } catch {
      unresolved.push({ locatorId: locator.locatorId, reason: 'relocated_text_mismatch' });
      continue;
    }
    relocations.push({
      locatorId: locator.locatorId,
      oldSpan: locator.span,
      newSpan,
      confidence: 1,
      provenance: 'source_diff_unchanged',
    });
  }

  return { hunks, relocations, unresolved };
}

function diffSourceByCodePoint(oldSource: string, newSource: string): readonly SourceDiffHunk[] {
  const oldUnits = sourceUnits(oldSource);
  const newUnits = sourceUnits(newSource);
  const changes = diffArrays(oldUnits.map((unit) => unit.text), newUnits.map((unit) => unit.text));
  const hunks: SourceDiffHunk[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const count = change.value.length;
    if (!change.added && !change.removed) {
      hunks.push({
        kind: 'unchanged',
        oldSpan: byteSpanForUnitRange(oldUnits, oldIndex, oldIndex + count, oldSource),
        newSpan: byteSpanForUnitRange(newUnits, newIndex, newIndex + count, newSource),
      });
      oldIndex += count;
      newIndex += count;
      continue;
    }

    const next = changes[index + 1];
    if (change.removed && next?.added) {
      hunks.push({
        kind: 'replace',
        oldSpan: byteSpanForUnitRange(oldUnits, oldIndex, oldIndex + count, oldSource),
        newSpan: byteSpanForUnitRange(newUnits, newIndex, newIndex + next.value.length, newSource),
      });
      oldIndex += count;
      newIndex += next.value.length;
      index += 1;
      continue;
    }
    if (change.added && next?.removed) {
      hunks.push({
        kind: 'replace',
        oldSpan: byteSpanForUnitRange(oldUnits, oldIndex, oldIndex + next.value.length, oldSource),
        newSpan: byteSpanForUnitRange(newUnits, newIndex, newIndex + count, newSource),
      });
      oldIndex += next.value.length;
      newIndex += count;
      index += 1;
      continue;
    }

    if (change.added) {
      hunks.push({
        kind: 'insert',
        oldSpan: byteSpanForUnitRange(oldUnits, oldIndex, oldIndex, oldSource),
        newSpan: byteSpanForUnitRange(newUnits, newIndex, newIndex + count, newSource),
      });
      newIndex += count;
      continue;
    }
    hunks.push({
      kind: 'delete',
      oldSpan: byteSpanForUnitRange(oldUnits, oldIndex, oldIndex + count, oldSource),
      newSpan: byteSpanForUnitRange(newUnits, newIndex, newIndex, newSource),
    });
    oldIndex += count;
  }

  return hunks;
}

function sourceUnits(source: string): readonly Readonly<{ text: string; startByte: number; endByte: number }>[] {
  const encoder = new TextEncoder();
  let byteOffset = 0;
  return Array.from(source, (text) => {
    const startByte = byteOffset;
    byteOffset += encoder.encode(text).byteLength;
    return { text, startByte, endByte: byteOffset };
  });
}

function byteSpanForUnitRange(
  units: readonly Readonly<{ startByte: number; endByte: number }>[],
  start: number,
  end: number,
  source: string,
): Utf8ByteSpan {
  const sourceLength = new TextEncoder().encode(source).byteLength;
  const startByte = units[start]?.startByte ?? sourceLength;
  const endByte = end === start ? startByte : (units[end - 1]?.endByte ?? sourceLength);
  return { startByte, endByte };
}

function findDuplicateIds(locators: readonly SourceDiffLocator[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const locator of locators) {
    if (seen.has(locator.locatorId)) duplicates.add(locator.locatorId);
    seen.add(locator.locatorId);
  }
  return duplicates;
}

function spanIsWithin(span: Utf8ByteSpan, container: Utf8ByteSpan): boolean {
  return span.startByte >= container.startByte && span.endByte <= container.endByte;
}
