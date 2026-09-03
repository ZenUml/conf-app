import { describe, expect, it } from 'vitest';
import { fetchSpaceContent, readConfluenceCorpus, resolveNext, toSources } from './read-corpus-confluence.mjs';

const AUTH = 'Basic dGVzdDp0ZXN0';
const TYPE = 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence';

function ok(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body };
}

function contentRow(id: string, raw: unknown, { version = 1, pageId = '900' } = {}) {
  return { id, version: { number: version }, container: { id: pageId }, body: { raw: { value: JSON.stringify(raw) } } };
}

describe('resolveNext', () => {
  it('keeps the /wiki context path that URL resolution would drop', () => {
    expect(resolveNext('lite-stg.atlassian.net', '/rest/api/content/search?cursor=abc'))
      .toBe('https://lite-stg.atlassian.net/wiki/rest/api/content/search?cursor=abc');
  });
  it('passes an absolute next link through unchanged', () => {
    expect(resolveNext('x.atlassian.net', 'https://other/next')).toBe('https://other/next');
  });
  it('returns null when there is no next page', () => {
    expect(resolveNext('x.atlassian.net', undefined)).toBeNull();
  });
});

describe('toSources', () => {
  it('keeps Mermaid and ZenUML sequence diagrams and drops everything else', () => {
    const rows = [
      contentRow('10', { diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A' }),
      contentRow('11', { diagramType: 'mermaid', mermaidCode: 'flowchart TD\n A-->B' }),
      contentRow('12', { diagramType: 'sequence', code: '@Actor User\nUser->Service: request' }),
      contentRow('13', { diagramType: 'graph', graphXml: '<mxfile/>' }),
    ];
    const { sources, notSequence } = toSources(rows, '248873062');
    expect(sources.map((s) => s.sourceId)).toEqual(['10', '12']);
    expect(notSequence).toBe(2);
    expect(sources[0].spaceId).toBe('248873062');
    expect(sources[0].pageId).toBe('900');
    expect(sources[0].sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('counts a body that is not parseable JSON as not-a-sequence rather than throwing', () => {
    const { sources, notSequence } = toSources([{ id: '1', body: { raw: { value: 'not json' } } }], '1');
    expect(sources).toEqual([]);
    expect(notSequence).toBe(1);
  });

  it('defaults a missing version to revision 1', () => {
    const row = { id: '20', container: { id: '901' }, body: { raw: { value: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A' }) } } };
    expect(toSources([row], '5').sources[0].sourceRevision).toBe(1);
  });
});

describe('fetchSpaceContent', () => {
  it('follows the cursor link instead of paging on start', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (urls.length === 1) {
        return ok({ results: [contentRow('1', { diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A' })], _links: { next: '/rest/api/content/search?cursor=p2' } });
      }
      return ok({ results: [contentRow('2', { diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant B' })], _links: {} });
    };
    const rows = await fetchSpaceContent({ site: 'lite-stg.atlassian.net', spaceKey: 'ATS01', type: TYPE, auth: AUTH, fetchImpl: fetchImpl as never });
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['1', '2']);
    expect(urls[1]).toBe('https://lite-stg.atlassian.net/wiki/rest/api/content/search?cursor=p2');
  });

  it('stops when a page repeats ids already held, so a server that ignores paging cannot loop forever', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return ok({ results: [contentRow('1', { diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A' })], _links: { next: '/rest/api/content/search?start=50' } });
    };
    const rows = await fetchSpaceContent({ site: 'x.atlassian.net', spaceKey: 'ATS01', type: TYPE, auth: AUTH, fetchImpl: fetchImpl as never });
    expect(rows).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('throws with the status text when the search call fails', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) });
    await expect(fetchSpaceContent({ site: 'x.atlassian.net', spaceKey: 'ATS01', type: TYPE, auth: AUTH, fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/404 Not Found/);
  });
});

describe('readConfluenceCorpus', () => {
  it('resolves space ids per key and stamps each source with its own space', async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes('/api/v2/spaces')) {
        return ok({ results: [{ key: 'ATS01', id: 111 }, { key: 'ATS02', id: 222 }] });
      }
      // The CQL is percent-encoded into the query string, so match on the key alone.
      if (url.includes('ATS01')) {
        return ok({ results: [contentRow('10', { diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A' })], _links: {} });
      }
      return ok({ results: [contentRow('20', { diagramType: 'sequence', code: '@Actor User\nUser->Service: request' })], _links: {} });
    };
    const corpus = await readConfluenceCorpus({ site: 'lite-stg.atlassian.net', spaceKeys: ['ATS01', 'ATS02'], cloudId: 'cid', type: TYPE, auth: AUTH, fetchImpl: fetchImpl as never });
    expect(corpus.cloudId).toBe('cid');
    expect(corpus.spaceIds).toEqual(['111', '222']);
    expect(corpus.sources.map((s: { sourceId: string, spaceId: string }) => [s.sourceId, s.spaceId])).toEqual([['10', '111'], ['20', '222']]);
    expect(corpus.perSpace.ATS02).toEqual({ spaceId: '222', fetched: 1, sources: 1 });
  });

  it('fails loudly when a requested space key does not exist', async () => {
    const fetchImpl = async () => ok({ results: [{ key: 'ATS01', id: 111 }] });
    await expect(readConfluenceCorpus({ site: 'x.atlassian.net', spaceKeys: ['ATS01', 'ATS99'], cloudId: 'cid', type: TYPE, auth: AUTH, fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/space keys not found: ATS99/);
  });
});
