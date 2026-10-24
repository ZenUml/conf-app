import { describe, it, expect } from 'vitest';
import { isUsablePageId } from './pageId';

describe('isUsablePageId', () => {
  it.each(['0', 0, '', '  ', null, undefined])('rejects %j', (v) => {
    expect(isUsablePageId(v)).toBe(false);
  });

  it.each(['456', 456, '53696004924'])('accepts %j', (v) => {
    expect(isUsablePageId(v)).toBe(true);
  });
});
