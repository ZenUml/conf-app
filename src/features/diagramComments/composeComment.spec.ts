import { describe, expect, it } from 'vitest';
import { buildCommentAdf, newNonce, plannedRecipients } from './composeComment';
import { markerFromAdf, splitCommentBody } from './commentLink';

const HREF = 'https://example.atlassian.net/wiki/spaces/SD/pages/123/Order+flow?zenumlDiagram=900&zenumlLocal=l1&dv=3&zn=k9';

describe('plannedRecipients', () => {
  it('mentions plus the last modifier, once each, never the writer', () => {
    expect(plannedRecipients({ mentionIds: ['m1', 'm2', 'm1'], lastModifierId: 'a1', currentAccountId: 'me' })).toEqual([
      'm1',
      'm2',
      'a1',
    ]);
    expect(plannedRecipients({ mentionIds: ['me'], lastModifierId: 'me', currentAccountId: 'me' })).toEqual([]);
    expect(plannedRecipients({ mentionIds: [], lastModifierId: undefined, currentAccountId: 'me' })).toEqual([]);
  });

  it('does not add the last modifier twice when they are already mentioned', () => {
    expect(plannedRecipients({ mentionIds: ['a1'], lastModifierId: 'a1', currentAccountId: 'me' })).toEqual(['a1']);
  });
});

describe('buildCommentAdf', () => {
  it('puts mentions first, then the text, then the line that links back to the diagram', () => {
    const body = buildCommentAdf({
      text: 'Should there be a failure branch?',
      mentions: [{ accountId: 'a1', name: 'Mia Lin' }],
      link: { href: HREF, label: 'Order flow · v3' },
    });
    expect(body.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id: 'a1', text: '@Mia Lin' } },
        { type: 'text', text: ' Should there be a failure branch?' },
      ],
    });
    expect(markerFromAdf(body)).toEqual({ diagramId: '900', localId: 'l1', diagramVersion: 3, nonce: 'k9' });
    expect(splitCommentBody(body).text).toBe('@Mia Lin Should there be a failure branch?');
  });

  it('keeps blank lines as separate paragraphs and works with no mention or no link', () => {
    const body = buildCommentAdf({ text: 'one\n\ntwo', mentions: [] });
    expect(body.content).toHaveLength(2);
    expect(splitCommentBody(body).text).toBe('one\ntwo');
    expect(markerFromAdf(body)).toBeNull();
  });
});

describe('newNonce', () => {
  it('is short, url safe and different each call', () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(/^[a-z0-9]{6,12}$/);
    expect(a).not.toBe(b);
  });
});
