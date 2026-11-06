import { describe, expect, it } from 'vitest';
import { currentRelease, WHATS_NEW_RELEASES } from './releases';

const BEFORE_ANONYMOUS_VIEWING = Date.parse('2026-10-05T12:00:00Z');
const ANONYMOUS_VIEWING_LIVE = Date.parse('2026-10-06T12:00:00Z');

describe('live release data', () => {
  it('selects anonymous viewing only for Lite and Diagramly', () => {
    expect(currentRelease('lite', ANONYMOUS_VIEWING_LIVE)?.id).toBe('2026-10-anonymous-viewing');
    expect(currentRelease('diagramly', ANONYMOUS_VIEWING_LIVE)?.id).toBe('2026-10-anonymous-viewing');
    expect(currentRelease('full', ANONYMOUS_VIEWING_LIVE)?.id).toBe('2026-10');
    expect(currentRelease('asyncapi', ANONYMOUS_VIEWING_LIVE)).toBeNull();
  });

  it('keeps the existing October release active before anonymous viewing is published', () => {
    expect(currentRelease('lite', BEFORE_ANONYMOUS_VIEWING)?.id).toBe('2026-10');
    expect(currentRelease('diagramly', BEFORE_ANONYMOUS_VIEWING)?.id).toBe('2026-10');
  });

  it('publishes the documented URL without variant names in display copy', () => {
    const release = WHATS_NEW_RELEASES.find((entry) => entry.id === '2026-10-anonymous-viewing');
    expect(release).toBeDefined();
    expect(release?.items).toEqual([
      {
        id: 'anonymous-viewing',
        title: 'View diagrams without signing in',
        body: 'Visitors can view diagrams on Confluence pages that allow anonymous access. This update does not change site, space, or page permissions.',
        url: 'https://zenuml.com/docs/products/zenuml-diagrams-for-confluence/anonymous-viewing/',
      },
    ]);

    const displayCopy = [release?.headline, ...(release?.items ?? []).flatMap((item) => [item.title, item.body])].join(' ');
    // Whole words: "fullscreen" is a viewer mode, not the Full variant.
    expect(displayCopy).not.toMatch(/\b(lite|diagramly|full|asyncapi)\b/i);
  });
});

describe('MCP server release', () => {
  const BEFORE_MCP = Date.parse('2026-10-12T12:00:00Z');
  const MCP_LIVE = Date.parse('2026-10-13T12:00:00Z');

  it('selects the MCP release for Lite only', () => {
    expect(currentRelease('lite', MCP_LIVE)?.id).toBe('2026-10-mcp-server');
    expect(currentRelease('diagramly', MCP_LIVE)?.id).toBe('2026-10-anonymous-viewing');
    expect(currentRelease('full', MCP_LIVE)?.id).toBe('2026-10');
    expect(currentRelease('asyncapi', MCP_LIVE)).toBeNull();
  });

  it('keeps anonymous viewing on Lite until the MCP release date', () => {
    expect(currentRelease('lite', BEFORE_MCP)?.id).toBe('2026-10-anonymous-viewing');
  });

  it('keeps variant names out of the display copy', () => {
    const release = WHATS_NEW_RELEASES.find((entry) => entry.id === '2026-10-mcp-server');
    expect(release?.items.map((item) => item.id)).toEqual(['connect-mcp', 'mcp-read-edit']);
    expect(release?.items[0].url).toBe('https://zenuml.com/docs/products/zenuml-diagrams-for-confluence/mcp-server/');
    const displayCopy = [release?.headline, ...(release?.items ?? []).flatMap((item) => [item.title, item.body])].join(' ');
    // Whole words: "fullscreen" is a viewer mode, not the Full variant.
    expect(displayCopy).not.toMatch(/\b(lite|diagramly|full|asyncapi)\b/i);
  });
});
