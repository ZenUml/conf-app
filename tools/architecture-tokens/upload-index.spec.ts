import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildUploadStatements, uploadIndex } from './upload-index.mjs';

const artifact = {
  cloudId: 'cid',
  sources: [
    { sourceId: '10', sourceRevision: 2, spaceId: '7', pageId: '100', participants: [
      { actorId: 'PA', rawLabel: "Partner's App", comparisonKey: 'partner.s.app', declKind: 'participant', lineNumber: 2 },
      { actorId: 'U', rawLabel: 'User', comparisonKey: 'user', declKind: 'actor', lineNumber: 3 },
    ] },
    { sourceId: '11', sourceRevision: 1, spaceId: '8', pageId: '101', participants: [
      { actorId: 'PA', rawLabel: 'PartnerApp', comparisonKey: 'partner.app', declKind: 'participant', lineNumber: 4 },
    ] },
  ],
};

describe('buildUploadStatements', () => {
  it('deletes the tenant first, then inserts every occurrence in chunks', () => {
    const stmts = buildUploadStatements(artifact, { cloudId: 'cid', runId: 'r1', indexedAt: '2026-08-27T05:00:00Z', chunkSize: 2 });
    expect(stmts[0]).toBe("DELETE FROM ArchitectureTokenOccurrence WHERE cloudId = 'cid'");
    expect(stmts).toHaveLength(3); // delete + 2 chunks (2 rows + 1 row)
    expect(stmts[1]).toMatch(/^INSERT INTO ArchitectureTokenOccurrence \(cloudId, spaceId, contentId, pageId, contentVersion, actorId, rawLabel, comparisonKey, declKind, lineNumber, runId, indexedAt\) VALUES/);
    expect(stmts[1]).toContain("('cid','7','10','100',2,'PA','Partner''s App','partner.s.app','participant',2,'r1','2026-08-27T05:00:00Z')");
    expect(stmts[2]).toContain("('cid','8','11','101',1,'PA','PartnerApp','partner.app','participant',4,'r1','2026-08-27T05:00:00Z')");
  });

  it('refuses an artifact whose cloudId differs from the requested one', () => {
    expect(() => buildUploadStatements(artifact, { cloudId: 'other', runId: 'r', indexedAt: 't' })).toThrow(/cloudId mismatch/);
  });

  it('refuses a source without pageId', () => {
    const bad = { ...artifact, sources: [{ ...artifact.sources[0], pageId: '' }] };
    expect(() => buildUploadStatements(bad, { cloudId: 'cid', runId: 'r', indexedAt: 't' })).toThrow(/pageId/);
  });

  it('writes every statement as a D1 batch without explicit transaction SQL', async () => {
    const options = { cloudId: 'cid', runId: 'r1', indexedAt: '2026-08-27T05:00:00Z' };
    const statements = buildUploadStatements(artifact, options);
    let sql = '';
    await uploadIndex({
      artifact,
      ...options,
      runWrangler: async (file) => { sql = await readFile(file, 'utf8'); },
    });

    expect(sql).not.toMatch(/^\s*BEGIN;\s*$/m);
    expect(sql).not.toMatch(/^\s*COMMIT;\s*$/m);
    for (const statement of statements) expect(sql).toContain(`${statement};`);
  });
});
