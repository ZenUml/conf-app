import { describe, it, expect } from 'vitest';
import {
  PROTECTED_RESOURCE_METADATA_PATH,
  canonicalizeResource,
  buildProtectedResourceMetadata,
  buildWwwAuthenticate,
  metadataUrlFor,
  audienceMatches,
} from './protectedResource';

const RESOURCE = 'https://zenapi.zenuml.com/agent-link/mcp';

describe('canonicalizeResource', () => {
  it('leaves an already-canonical URI alone', () => {
    expect(canonicalizeResource(RESOURCE)).toBe(RESOURCE);
  });

  it('lowercases scheme and host, which the spec says to accept in any case', () => {
    expect(canonicalizeResource('HTTPS://ZenAPI.ZenUML.com/agent-link/mcp')).toBe(RESOURCE);
  });

  it('strips a fragment, which is invalid in a canonical URI', () => {
    expect(canonicalizeResource(`${RESOURCE}#frag`)).toBe(RESOURCE);
  });

  it('drops a bare trailing slash so one resource does not read as two', () => {
    expect(canonicalizeResource('https://zenapi.zenuml.com/')).toBe('https://zenapi.zenuml.com');
    expect(canonicalizeResource(`${RESOURCE}/`)).toBe(RESOURCE);
  });

  it('keeps a non-default port', () => {
    expect(canonicalizeResource('https://mcp.example.com:8443')).toBe('https://mcp.example.com:8443');
  });
});

describe('buildProtectedResourceMetadata', () => {
  it('always carries at least one authorization server', () => {
    // The MCP spec: the document MUST include authorization_servers with at
    // least one entry. A client with an empty list has nowhere to go.
    const doc = buildProtectedResourceMetadata({
      resource: RESOURCE,
      authorizationServers: ['https://zenapi.zenuml.com/agent-link/oauth'],
    });
    expect(doc.authorization_servers).toHaveLength(1);
    expect(doc.resource).toBe(RESOURCE);
  });

  it('advertises header-only bearer methods', () => {
    // "Access tokens MUST NOT be included in the URI query string."
    const doc = buildProtectedResourceMetadata({ resource: RESOURCE, authorizationServers: ['https://as'] });
    expect(doc.bearer_methods_supported).toEqual(['header']);
  });

  it('canonicalizes the resource it publishes', () => {
    const doc = buildProtectedResourceMetadata({
      resource: `${RESOURCE}/`,
      authorizationServers: ['https://as'],
    });
    expect(doc.resource).toBe(RESOURCE);
  });

  it('omits optional fields rather than emitting empty ones', () => {
    const doc = buildProtectedResourceMetadata({ resource: RESOURCE, authorizationServers: ['https://as'] });
    expect(doc).not.toHaveProperty('scopes_supported');
    expect(doc).not.toHaveProperty('resource_documentation');
  });

  it('includes scopes and documentation when given', () => {
    const doc = buildProtectedResourceMetadata({
      resource: RESOURCE,
      authorizationServers: ['https://as'],
      scopesSupported: ['diagram:read', 'diagram:write'],
      documentationUrl: 'https://docs.example.com',
    });
    expect(doc.scopes_supported).toEqual(['diagram:read', 'diagram:write']);
    expect(doc.resource_documentation).toBe('https://docs.example.com');
  });
});

describe('buildWwwAuthenticate', () => {
  it('names the metadata URL, which is the only way a new client finds the AS', () => {
    const header = buildWwwAuthenticate('https://zenapi.zenuml.com/.well-known/oauth-protected-resource');
    expect(header).toBe(
      'Bearer resource_metadata="https://zenapi.zenuml.com/.well-known/oauth-protected-resource"',
    );
  });

  it('carries an error and description when supplied', () => {
    const header = buildWwwAuthenticate('https://x/.well-known/oauth-protected-resource', {
      error: 'invalid_token',
      errorDescription: 'token expired',
    });
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain('error_description="token expired"');
  });

  it('strips quotes and backslashes that would break the header grammar', () => {
    const header = buildWwwAuthenticate('https://x/m', {
      error: 'invalid_token',
      errorDescription: 'bad "token" \\ here',
    });
    expect(header).toContain('error_description="bad token  here"');
    // Exactly three quoted values, so nothing escaped its own quoting.
    expect(header.split('"').length - 1).toBe(6);
  });

  it('metadataUrlFor builds the well-known path from an origin', () => {
    expect(metadataUrlFor('https://zenapi.zenuml.com')).toBe(
      `https://zenapi.zenuml.com${PROTECTED_RESOURCE_METADATA_PATH}`,
    );
  });
});

describe('audienceMatches', () => {
  it('accepts a token whose audience is this server', () => {
    expect(audienceMatches(RESOURCE, RESOURCE)).toBe(true);
  });

  it('accepts an array audience containing this server', () => {
    expect(audienceMatches(['https://other', RESOURCE], RESOURCE)).toBe(true);
  });

  it('rejects a token minted for somebody else', () => {
    // The spec's central rule: accepting a foreign-audience token is what
    // turns this server into a confused deputy.
    expect(audienceMatches('https://someone-else.example.com/mcp', RESOURCE)).toBe(false);
    expect(audienceMatches(['https://a', 'https://b'], RESOURCE)).toBe(false);
  });

  it('rejects a missing or non-string audience', () => {
    expect(audienceMatches(undefined, RESOURCE)).toBe(false);
    expect(audienceMatches(null, RESOURCE)).toBe(false);
    expect(audienceMatches(42, RESOURCE)).toBe(false);
    expect(audienceMatches([], RESOURCE)).toBe(false);
  });

  it('matches across trailing-slash and case differences', () => {
    expect(audienceMatches(`${RESOURCE}/`, RESOURCE)).toBe(true);
    expect(audienceMatches('HTTPS://ZENAPI.ZENUML.COM/agent-link/mcp', RESOURCE)).toBe(true);
  });

  it('rejects an unparseable audience rather than throwing', () => {
    expect(audienceMatches('not-a-uri', RESOURCE)).toBe(false);
  });
});
