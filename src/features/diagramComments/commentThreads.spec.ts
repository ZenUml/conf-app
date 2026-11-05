import { describe, expect, it } from 'vitest';
import { findPostedByNonce, repliesOldestFirst, rootsForDiagram, toDiagramComment, type RawComment } from './commentThreads';

const PAGE = 'https://example.atlassian.net/wiki/spaces/SD/pages/123/Order+flow';
const adf = (text: string, href?: string) =>
  JSON.stringify({
    version: 1,
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
      ...(href
        ? [{ type: 'paragraph', content: [{ type: 'text', text: 'Open the diagram', marks: [{ type: 'link', attrs: { href } }] }] }]
        : []),
    ],
  });
const raw = (id: string, text: string, href: string | undefined, createdAt: string, authorId = 'u1'): RawComment => ({
  id,
  body: { atlas_doc_format: { value: adf(text, href) } },
  version: { authorId, createdAt, number: 1 },
});
const link = (diagram: string, extra = '') => `${PAGE}?zenumlDiagram=${diagram}&zenumlLocal=l1&dv=3${extra}`;

describe('toDiagramComment', () => {
  it('reads author, time, text and the diagram version it was posted on', () => {
    expect(toDiagramComment(raw('c1', 'Add a failure branch?', link('900'), '2026-11-04T10:00:00Z'))).toEqual({
      id: 'c1',
      authorId: 'u1',
      createdAt: '2026-11-04T10:00:00Z',
      text: 'Add a failure branch?',
      diagramVersion: 3,
      marker: { diagramId: '900', localId: 'l1', diagramVersion: 3 },
    });
  });

  it('returns null for a body that is not parsable', () => {
    expect(toDiagramComment({ id: 'c2', body: { atlas_doc_format: { value: '{not json' } } })).toBeNull();
    expect(toDiagramComment({ id: 'c3' })).toBeNull();
  });
});

describe('rootsForDiagram', () => {
  const comments = [
    raw('old', 'older', link('900'), '2026-11-03T09:00:00Z'),
    raw('other', 'about another diagram', link('901'), '2026-11-04T09:00:00Z'),
    raw('plain', 'a page comment nobody linked', undefined, '2026-11-04T08:00:00Z'),
    raw('new', 'newer', link('900'), '2026-11-04T10:00:00Z'),
  ];

  it('keeps only comments that point at this diagram, newest first', () => {
    expect(rootsForDiagram(comments, '900').map(c => c.id)).toEqual(['new', 'old']);
  });

  it('is empty when nothing points at the diagram', () => {
    expect(rootsForDiagram(comments, '999')).toEqual([]);
  });
});

describe('repliesOldestFirst', () => {
  it('orders a thread by time and keeps replies that carry no link', () => {
    const replies = [
      raw('r2', 'second', undefined, '2026-11-04T12:00:00Z'),
      raw('r1', 'first', undefined, '2026-11-04T11:00:00Z'),
    ];
    expect(repliesOldestFirst(replies).map(c => c.id)).toEqual(['r1', 'r2']);
  });
});

describe('findPostedByNonce', () => {
  it('finds the root comment just posted, so an uncertain save is never sent twice', () => {
    const list = [raw('a', 'x', link('900', '&zn=aaa'), '2026-11-04T10:00:00Z'), raw('b', 'y', link('900', '&zn=bbb'), '2026-11-04T10:01:00Z')];
    expect(findPostedByNonce(list, 'bbb')?.id).toBe('b');
    expect(findPostedByNonce(list, 'zzz')).toBeUndefined();
  });
});
