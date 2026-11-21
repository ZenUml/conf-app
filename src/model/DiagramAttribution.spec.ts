import { describe, expect, it } from 'vitest';
import { attributionFromCustomContent } from './DiagramAttribution';

describe('attributionFromCustomContent', () => {
  it('extracts immutable creator and current updater IDs without changing diagram content', () => {
    expect(attributionFromCustomContent({
      id: 123,
      authorId: ' creator-a ',
      version: { authorId: ' updater-a ' },
    })).toEqual({
      customContentId: '123',
      createdByAccountId: 'creator-a',
      lastUpdatedByAccountId: 'updater-a',
    });
  });

  it('keeps same creator/updater IDs for the view layer to collapse', () => {
    expect(attributionFromCustomContent({
      id: 'cc-1', authorId: 'person-a', version: { authorId: 'person-a' },
    })).toEqual({ customContentId: 'cc-1', createdByAccountId: 'person-a', lastUpdatedByAccountId: 'person-a' });
  });

  it('carries the stored version number, which a diagram comment records as "posted on vN"', () => {
    expect(attributionFromCustomContent({ id: 'cc-1', authorId: 'p', version: { authorId: 'p', number: 7 } })).toEqual({
      customContentId: 'cc-1',
      createdByAccountId: 'p',
      lastUpdatedByAccountId: 'p',
      version: 7,
    });
    expect(attributionFromCustomContent({ id: 'cc-1', version: { number: 0 } })).toEqual({ customContentId: 'cc-1' });
    expect(attributionFromCustomContent({ id: 'cc-1', version: { number: 'x' as unknown as number } })).toEqual({ customContentId: 'cc-1' });
  });

  it('omits missing people and refuses an empty content identity', () => {
    expect(attributionFromCustomContent({ id: 'cc-1', authorId: '', version: {} })).toEqual({ customContentId: 'cc-1' });
    expect(attributionFromCustomContent({ id: '', authorId: 'person-a', version: {} })).toBeNull();
  });
});
