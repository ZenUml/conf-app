import { describe, expect, it } from 'vitest';
import { buildCommentLink, markerFromAdf, parseCommentLink, splitCommentBody } from './commentLink';

const PAGE = 'https://example.atlassian.net/wiki/spaces/SD/pages/123/Order+flow';

describe('buildCommentLink / parseCommentLink', () => {
  it('round-trips the diagram, the embed instance, the version and the nonce', () => {
    const href = buildCommentLink(PAGE, { diagramId: '900', localId: 'abc-1', diagramVersion: 3, nonce: 'k9x2' });
    expect(href).toBe(`${PAGE}?zenumlDiagram=900&zenumlLocal=abc-1&dv=3&zn=k9x2`);
    expect(parseCommentLink(href)).toEqual({ diagramId: '900', localId: 'abc-1', diagramVersion: 3, nonce: 'k9x2' });
  });

  it('drops any other query string and the hash from the page url', () => {
    const href = buildCommentLink(`${PAGE}?focusedCommentId=5&x=y#frag`, { diagramId: '900', localId: 'abc-1' });
    expect(href).toBe(`${PAGE}?zenumlDiagram=900&zenumlLocal=abc-1`);
  });

  it('parses only links that carry a diagram id', () => {
    expect(parseCommentLink(`${PAGE}?zenumlLocal=abc-1`)).toBeNull();
    expect(parseCommentLink(PAGE)).toBeNull();
    expect(parseCommentLink('not a url')).toBeNull();
    expect(parseCommentLink(`${PAGE}?zenumlDiagram=900`)).toEqual({ diagramId: '900' });
  });

  it('ignores a non-numeric version and an empty nonce', () => {
    expect(parseCommentLink(`${PAGE}?zenumlDiagram=900&dv=x&zn=`)).toEqual({ diagramId: '900' });
  });
});

const doc = (...content: unknown[]) => ({ version: 1, type: 'doc', content });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

describe('markerFromAdf / splitCommentBody', () => {
  const href = `${PAGE}?zenumlDiagram=900&zenumlLocal=abc-1&dv=3`;
  const body = doc(
    para({ type: 'mention', attrs: { id: 'u1', text: '@Mia' } }, text(' stock can fail here?')),
    para(text('Open the diagram', [{ type: 'link', attrs: { href } }])),
  );

  it('finds the marker in a link mark', () => {
    expect(markerFromAdf(body)).toEqual({ diagramId: '900', localId: 'abc-1', diagramVersion: 3 });
  });

  it('finds the marker in an inline card', () => {
    expect(markerFromAdf(doc(para({ type: 'inlineCard', attrs: { url: href } })))).toEqual({
      diagramId: '900',
      localId: 'abc-1',
      diagramVersion: 3,
    });
  });

  it('returns null when there is no marker, or the body is not an ADF document', () => {
    expect(markerFromAdf(doc(para(text('hello'))))).toBeNull();
    expect(markerFromAdf(null)).toBeNull();
    expect(markerFromAdf('plain')).toBeNull();
  });

  it('shows the written text without the link paragraph', () => {
    expect(splitCommentBody(body)).toEqual({
      text: '@Mia stock can fail here?',
      marker: { diagramId: '900', localId: 'abc-1', diagramVersion: 3 },
    });
  });

  it('keeps line breaks and ordinary links in the text', () => {
    const other = doc(
      para(text('first'), { type: 'hardBreak' }, text('second ')),
      para(text('docs', [{ type: 'link', attrs: { href: 'https://example.com/x' } }])),
    );
    expect(splitCommentBody(other)).toEqual({ text: 'first\nsecond\ndocs', marker: null });
  });
});
