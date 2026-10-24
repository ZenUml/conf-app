import { describe, it, expect } from 'vitest';
import { docMatchesSearch } from '@/components/AsyncApiDashboard/docMatchesSearch';

// Regression: the AsyncAPI dashboard search box "didn't work" because the
// predicate also searched the raw spec body (d.code). Every AsyncAPI spec
// shares the same YAML vocabulary (channels, operations, info, payload, …),
// so a search for any such term matched nearly every document — observed live
// as "channels" → 39 of 41 docs. The fix restricts matching to the
// user-facing title + description. These tests pin that contract.

describe('docMatchesSearch (AsyncAPI dashboard search)', () => {
  it('matches on title, case-insensitively', () => {
    expect(docMatchesSearch({ displayTitle: 'Streetlights Kafka API' }, 'streetlights')).toBe(true);
    expect(docMatchesSearch({ displayTitle: 'Streetlights Kafka API' }, 'KAFKA')).toBe(true);
  });

  it('matches on description', () => {
    expect(
      docMatchesSearch({ displayTitle: 'X', description: 'Manage city street lights' }, 'city'),
    ).toBe(true);
  });

  it('does NOT match a term that appears only in the raw spec body (the bug)', () => {
    const doc = {
      displayTitle: 'Example AsyncAPI93',
      description: 'Replace this with your own AsyncAPI specification.',
      code: 'asyncapi: 3.0.0\ninfo:\n  title: Example\nchannels:\n  foo:\n    address: bar',
    };
    // `channels` / `address` exist only in the YAML body — must NOT match,
    // otherwise the search returns nearly every document.
    expect(docMatchesSearch(doc, 'channels')).toBe(false);
    expect(docMatchesSearch(doc, 'address')).toBe(false);
    // ...while title and description still match.
    expect(docMatchesSearch(doc, 'asyncapi93')).toBe(true);
    expect(docMatchesSearch(doc, 'replace')).toBe(true);
  });

  it('returns true for an empty / whitespace term (no filtering)', () => {
    expect(docMatchesSearch({ displayTitle: 'Anything' }, '')).toBe(true);
    expect(docMatchesSearch({ displayTitle: 'Anything' }, '   ')).toBe(true);
  });

  it('returns false when the term is absent from title and description', () => {
    expect(
      docMatchesSearch({ displayTitle: 'Orders API', description: 'Order events' }, 'payments'),
    ).toBe(false);
  });

  it('handles missing title/description fields', () => {
    expect(docMatchesSearch({}, 'anything')).toBe(false);
    expect(docMatchesSearch({ description: 'has desc' }, 'desc')).toBe(true);
  });
});
