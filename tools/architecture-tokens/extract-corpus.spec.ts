import { describe, expect, it } from 'vitest';
import { buildArtifact } from './extract-corpus.mjs';

describe('buildArtifact', () => {
  it('keeps the last declaration for a repeated same-line actor anchor', () => {
    const artifact = buildArtifact({
      cloudId: 'cid',
      sources: [{
        sourceId: '10',
        sourceRevision: 1,
        sourceHash: 'hash',
        spaceId: '7',
        pageId: '100',
        mermaidCode: 'sequenceDiagram\n  participant PA as First; participant PA as Second\n  PA->>PA: use',
      }],
    });

    expect(artifact.occurrenceCount).toBe(1);
    expect(artifact.sources[0].participants).toHaveLength(1);
    expect(artifact.sources[0].participants[0]).toMatchObject({
      actorId: 'PA',
      rawLabel: 'Second',
      lineNumber: 2,
    });
  });

  it('omits sources with no extracted participants from the occurrence artifact', () => {
    const artifact = buildArtifact({
      cloudId: 'cid',
      sources: [
        {
          sourceId: 'empty',
          sourceRevision: 1,
          sourceHash: 'empty-hash',
          spaceId: '7',
          pageId: '100',
          mermaidCode: 'sequenceDiagram\n  A->>B: message-only',
        },
        {
          sourceId: 'declared',
          sourceRevision: 1,
          sourceHash: 'declared-hash',
          spaceId: '7',
          pageId: '101',
          mermaidCode: 'sequenceDiagram\n  participant A\n  A->>A: use',
        },
      ],
    });

    expect(artifact.sources.map((source) => source.sourceId)).toEqual(['declared']);
    expect(artifact.cohortSourceCount).toBe(1);
    expect(artifact.cohortSourceCount).toBe(new Set(artifact.sources.map((source) => source.sourceId)).size);
  });
});
