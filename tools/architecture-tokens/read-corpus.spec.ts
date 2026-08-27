import { describe, expect, it } from 'vitest';
import { corpusSql, readCorpus, tenantSpacesSql } from './read-corpus.mjs';

describe('tenantSpacesSql', () => {
  it('resolves cloudId from AtlassianInstance by <domain>.atlassian.net and spaces via DiagramAudience', () => {
    const sql = tenantSpacesSql('example-tenant');
    expect(sql).toMatch(/AtlassianInstance/);
    expect(sql).toContain("'example-tenant.atlassian.net'");
    expect(sql).toMatch(/DiagramAudience/);
    expect(sql).toMatch(/DISTINCT c\.spaceId/);
  });
  it('escapes single quotes', () => {
    expect(tenantSpacesSql("o'k")).toContain("'o''k.atlassian.net'");
  });
});

describe('corpusSql', () => {
  it('selects current mermaid rows for the given spaces with pageId and spaceId', () => {
    const sql = corpusSql({ spaceIds: ['1', '2'] });
    expect(sql).toContain("spaceId IN ('1','2')");
    expect(sql).toMatch(/status = 'current'/);
    expect(sql).toMatch(/diagramType'\) = 'mermaid'/);
    expect(sql).toMatch(/pageId/);
  });
});

describe('readCorpus (client-domain mode)', () => {
  it('keeps only sequence diagrams and records cloudId + spaces', async () => {
    const calls: string[] = [];
    const runWrangler = async (sql: string) => {
      calls.push(sql);
      if (sql.includes('AtlassianInstance')) return [{ results: [{ cloudId: 'cid', spaceId: '7' }, { cloudId: 'cid', spaceId: '8' }] }];
      return [{ results: [
        { sourceId: '10', sourceRevision: 2, spaceId: '7', pageId: '100', rawValue: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A' }) },
        { sourceId: '11', sourceRevision: 1, spaceId: '8', pageId: '101', rawValue: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'flowchart TD\n A-->B' }) },
      ] }];
    };
    const corpus = await readCorpus({ clientDomain: 'example-tenant', runWrangler });
    expect(corpus.cloudId).toBe('cid');
    expect(corpus.spaceIds).toEqual(['7', '8']);
    expect(corpus.sources.map((s) => s.sourceId)).toEqual(['10']);
    expect(corpus.sources[0]).toMatchObject({ spaceId: '7', pageId: '100', sourceRevision: 2 });
    expect(corpus.notSequence).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('keeps only the highest revision for each sourceId', async () => {
    const runWrangler = async (sql: string) => {
      if (sql.includes('AtlassianInstance')) return [{ results: [{ cloudId: 'cid', spaceId: '7' }] }];
      return [{ results: [
        { sourceId: '20', sourceRevision: 1, spaceId: '7', pageId: '200', rawValue: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant C' }) },
        { sourceId: '10', sourceRevision: 1, spaceId: '7', pageId: '100', rawValue: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A' }) },
        { sourceId: '10', sourceRevision: 2, spaceId: '7', pageId: '100', rawValue: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant B' }) },
      ] }];
    };

    const corpus = await readCorpus({ clientDomain: 'example-tenant', runWrangler });

    expect(corpus.mermaidRows).toBe(2);
    expect(corpus.sources.map((source) => source.sourceId)).toEqual(['10', '20']);
    expect(corpus.sources[0]).toMatchObject({ sourceId: '10', sourceRevision: 2, mermaidCode: 'sequenceDiagram\n participant B' });
  });
});
