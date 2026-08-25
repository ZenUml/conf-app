import { describe, expect, it } from 'vitest';
import { prepareSourceDiffRelocation } from './sourceDiffRelocation';
import { utf8ByteSpanFor } from './utf8Locator';

describe('prepareSourceDiffRelocation', () => {
  it('maps an unchanged UTF-8 locator after an insertion before it', () => {
    const oldSource = 'flowchart TD\nA[服务🙂] --> B';
    const newSource = '%% title\nflowchart TD\nA[服务🙂] --> B';
    const start = oldSource.indexOf('A[');
    const result = prepareSourceDiffRelocation({
      oldSource,
      newSource,
      oldLocators: [{ locatorId: 'node-a-occurrence-0', span: utf8ByteSpanFor(oldSource, start, start + 'A[服务🙂]'.length) }],
    });

    expect(result.hunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'insert' }),
      expect.objectContaining({ kind: 'unchanged' }),
    ]));
    expect(result.relocations).toEqual([
      expect.objectContaining({
        locatorId: 'node-a-occurrence-0',
        confidence: 1,
        provenance: 'source_diff_unchanged',
        newSpan: utf8ByteSpanFor(newSource, newSource.indexOf('A['), newSource.indexOf('A[') + 'A[服务🙂]'.length),
      }),
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('fails closed when a locator intersects a replacement hunk', () => {
    const oldSource = 'flowchart TD\nA[Orders API] --> B';
    const newSource = 'flowchart TD\nA[Payments API] --> B';
    const start = oldSource.indexOf('A[');
    const result = prepareSourceDiffRelocation({
      oldSource,
      newSource,
      oldLocators: [{ locatorId: 'node-a-occurrence-0', span: utf8ByteSpanFor(oldSource, start, start + 'A[Orders API]'.length) }],
    });

    expect(result.hunks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'replace' })]));
    expect(result.relocations).toEqual([]);
    expect(result.unresolved).toEqual([{ locatorId: 'node-a-occurrence-0', reason: 'locator_intersects_change' }]);
  });
});
