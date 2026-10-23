import { describe, expect, it } from 'vitest';
import {
  ATLASSIAN_SITE_HOST_RE,
  toAtlassianClientDomain,
  toClientDomain,
  toSiteHost,
} from '../../src/lib/clientDomain.js';

describe('toClientDomain', () => {
  it.each([
    ['bare domain', 'example-tenant', 'example-tenant'],
    ['bare domain with underscore', 'example_tenant', 'example_tenant'],
    ['site host', 'example-tenant.atlassian.net', 'example-tenant'],
    ['https URL', 'https://example-tenant.atlassian.net', 'example-tenant'],
    ['URL with path and query', 'https://example-tenant.atlassian.net/wiki/spaces/ZS/pages/1?x=1', 'example-tenant'],
    ['host with path, no scheme', 'example-tenant.atlassian.net/wiki', 'example-tenant'],
    ['URL with port', 'https://example-tenant.atlassian.net:443/wiki', 'example-tenant'],
    ['upper case bare', 'Example-Tenant', 'example-tenant'],
    ['upper case URL', 'HTTPS://Example-Tenant.Atlassian.NET/Wiki', 'example-tenant'],
    ['surrounding whitespace', '  example-tenant.atlassian.net  ', 'example-tenant'],
    ['custom domain host', 'wiki.example.com', 'wiki.example.com'],
    ['custom domain URL', 'https://Wiki.Example.com/wiki/home', 'wiki.example.com'],
    ['lookalike suffix is a custom host', 'https://example-tenant.atlassian.net.evil.example/', 'example-tenant.atlassian.net.evil.example'],
    ['lookalike with other separator', 'example-tenant.atlassianXnet', 'example-tenant.atlassianxnet'],
    // getSubdomain's old unanchored regex returned "x" for this input.
    ['unanchored false positive', 'https://evil.example/?u=https://x.atlassianXnet', 'evil.example'],
    ['unanchored false positive (real suffix in query)', 'https://evil.example/?u=https://x.atlassian.net', 'evil.example'],
  ])('%s', (_name, input, expected) => {
    expect(toClientDomain(input)).toBe(expected);
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
    ['invalid host', 'https://exa mple.atlassian.net'],
    ['scheme only', 'https://'],
    ['non-string', 42 as unknown as string],
  ])('returns null for %s', (_name, input) => {
    expect(toClientDomain(input)).toBeNull();
  });
});

describe('toAtlassianClientDomain', () => {
  it.each([
    ['https://example-tenant.atlassian.net/wiki', 'example-tenant'],
    ['example-tenant.atlassian.net', 'example-tenant'],
    ['https://Example-Tenant.atlassian.net', 'example-tenant'],
    ['wiki.example.com', null],
    ['example-tenant', null],
    ['https://evil.example/?u=https://x.atlassianXnet', null],
    ['https://example-tenant.atlassian.net.evil.example/', null],
    ['', null],
    [undefined, null],
  ])('%s', (input, expected) => {
    expect(toAtlassianClientDomain(input)).toBe(expected);
  });
});

describe('toSiteHost', () => {
  it.each([
    ['example-tenant', 'example-tenant.atlassian.net'],
    ['Example-Tenant', 'example-tenant.atlassian.net'],
    ['example-tenant.atlassian.net', 'example-tenant.atlassian.net'],
    ['wiki.example.com', 'wiki.example.com'],
    ['', ''],
  ])('%s', (input, expected) => {
    expect(toSiteHost(input)).toBe(expected);
  });

  it('round-trips an atlassian tenant', () => {
    expect(toClientDomain(toSiteHost('example-tenant'))).toBe('example-tenant');
  });

  it('round-trips a custom domain', () => {
    expect(toSiteHost(toClientDomain('https://wiki.example.com/x') as string)).toBe('wiki.example.com');
  });
});

describe('ATLASSIAN_SITE_HOST_RE', () => {
  it('is anchored and escapes the dots', () => {
    expect(ATLASSIAN_SITE_HOST_RE.test('example-tenant.atlassian.net')).toBe(true);
    expect(ATLASSIAN_SITE_HOST_RE.test('example-tenant.atlassianXnet')).toBe(false);
    expect(ATLASSIAN_SITE_HOST_RE.test('example-tenant.atlassian.net.evil.example')).toBe(false);
    expect(ATLASSIAN_SITE_HOST_RE.test('https://example-tenant.atlassian.net')).toBe(false);
    expect(ATLASSIAN_SITE_HOST_RE.test('.atlassian.net')).toBe(false);
  });

  it('is stateless across calls (no g flag)', () => {
    expect(ATLASSIAN_SITE_HOST_RE.test('a.atlassian.net')).toBe(true);
    expect(ATLASSIAN_SITE_HOST_RE.test('a.atlassian.net')).toBe(true);
  });
});
