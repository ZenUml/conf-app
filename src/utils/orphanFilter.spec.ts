import { describe, it, expect } from 'vitest';
import { keepLiveParentPageContent } from '@/utils/orphanFilter';

describe('keepLiveParentPageContent', () => {
  it('drops records whose parent page is not live (deleted-parent orphan)', () => {
    const items = [
      { id: '491523', pageId: '164004' }, // live parent
      { id: '327683', pageId: '524290' }, // deleted parent -> orphan
    ];
    const live = new Set(['164004']);
    expect(keepLiveParentPageContent(items, live)).toEqual([{ id: '491523', pageId: '164004' }]);
  });

  it('keeps records with no pageId (space/blog container — not a page orphan)', () => {
    const items = [
      { id: 'a', pageId: undefined },
      { id: 'b' } as { id: string; pageId?: string },
      { id: 'c', pageId: null },
    ];
    expect(keepLiveParentPageContent(items, new Set())).toHaveLength(3);
  });

  it('coerces numeric-vs-string pageIds so a live parent still matches', () => {
    const items = [{ id: 'x', pageId: '100' as any }];
    expect(keepLiveParentPageContent(items, new Set(['100']))).toHaveLength(1);
  });

  it('returns everything when all parents are live', () => {
    const items = [{ id: 'a', pageId: '1' }, { id: 'b', pageId: '2' }];
    expect(keepLiveParentPageContent(items, new Set(['1', '2']))).toHaveLength(2);
  });
});
