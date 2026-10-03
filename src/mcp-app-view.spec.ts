import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractDiagram, onHostMessage, start, UI_PROTOCOL_VERSION } from './mcp-app-view';

describe('extractDiagram', () => {
  // The host decides which of these shapes it hands us, and the answer has
  // differed per host in practice, so all three are supported deliberately
  // rather than by accident.
  it('reads structuredContent when the host provides it', () => {
    expect(extractDiagram({ structuredContent: { diagramType: 'mermaid', dsl: 'graph TD;A-->B;' } }))
      .toEqual({ diagramType: 'mermaid', dsl: 'graph TD;A-->B;', title: undefined });
  });

  it('reads a JSON text block when structuredContent is absent', () => {
    const payload = { diagramType: 'sequence', dsl: 'A->B: hi', title: 'Login' };
    expect(extractDiagram({ content: [{ type: 'text', text: JSON.stringify(payload) }] }))
      .toEqual(payload);
  });

  it('reads a bare payload passed straight through', () => {
    expect(extractDiagram({ diagramType: 'sequence', dsl: 'A->B: hi' }))
      .toEqual({ diagramType: 'sequence', dsl: 'A->B: hi', title: undefined });
  });

  it('accepts `code` as well as `dsl`, so stored custom content renders', () => {
    // `dsl` is what the tools return; `code` is the field Confluence stores.
    expect(extractDiagram({ structuredContent: { diagramType: 'sequence', code: 'A->B: hi' } }))
      .toEqual({ diagramType: 'sequence', dsl: 'A->B: hi', title: undefined });
  });

  it('prefers structuredContent over a text block that disagrees', () => {
    const result = {
      structuredContent: { diagramType: 'mermaid', dsl: 'from-structured' },
      content: [{ type: 'text', text: JSON.stringify({ diagramType: 'sequence', dsl: 'from-text' }) }],
    };
    expect(extractDiagram(result)?.dsl).toBe('from-structured');
  });

  it('skips a text block that is not JSON rather than giving up', () => {
    const result = {
      content: [
        { type: 'text', text: 'Updated the diagram.' },
        { type: 'text', text: JSON.stringify({ diagramType: 'mermaid', dsl: 'graph TD;A-->B;' }) },
      ],
    };
    expect(extractDiagram(result)?.dsl).toBe('graph TD;A-->B;');
  });

  it('returns null when there is no diagram, so the view can say so', () => {
    // A blank iframe is the worst outcome; null is what drives the message.
    for (const empty of [
      undefined,
      null,
      {},
      { content: [] },
      { content: [{ type: 'text', text: 'not json' }] },
      { structuredContent: { diagramType: 'mermaid' } },       // no dsl
      { structuredContent: { dsl: 'graph TD;A-->B;' } },        // no type
      { structuredContent: { diagramType: 42, dsl: 'x' } },
    ]) {
      expect(extractDiagram(empty)).toBeNull();
    }
  });

  it('ignores non-text content blocks', () => {
    expect(extractDiagram({ content: [{ type: 'image', data: 'base64' }] })).toBeNull();
  });
});

/**
 * The handshake, which is what actually decides whether anything renders.
 *
 * Claude Desktop fetched the view and drew nothing (2026-10-03) because the
 * View never answered the host's initialize response with
 * `ui/notifications/initialized`, and the host therefore never sent
 * tool-result. These tests exist so that cannot regress silently: the previous
 * spec covered only extractDiagram, so the whole transport was untested.
 */
describe('the host handshake', () => {
  let posted: Array<Record<string, unknown>>;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    posted = [];
    spy = vi.spyOn(window, 'postMessage').mockImplementation(((msg: unknown) => {
      posted.push(msg as Record<string, unknown>);
    }) as typeof window.postMessage);
  });

  afterEach(() => spy.mockRestore());

  function fire(data: unknown): void {
    onHostMessage({ data } as MessageEvent);
  }

  it('opens with a conformant ui/initialize request', () => {
    start();
    const init = posted.find((m) => m.method === 'ui/initialize');
    expect(init).toBeDefined();
    expect(typeof init!.id).toBe('number');
    const params = init!.params as Record<string, unknown>;
    // Empty params are what the first version sent; the host needs these.
    expect(params.protocolVersion).toBe(UI_PROTOCOL_VERSION);
    expect(params.clientInfo).toMatchObject({ name: expect.any(String) });
    expect(params.capabilities).toBeDefined();
  });

  it('answers the initialize response with ui/notifications/initialized', () => {
    start();
    const id = posted.find((m) => m.method === 'ui/initialize')!.id;
    posted.length = 0;
    fire({ jsonrpc: '2.0', id, result: { protocolVersion: UI_PROTOCOL_VERSION, hostInfo: {} } });
    expect(posted.map((m) => m.method)).toContain('ui/notifications/initialized');
  });

  it('does not acknowledge a response that is not ours', () => {
    start();
    posted.length = 0;
    fire({ jsonrpc: '2.0', id: 9999, result: {} });
    expect(posted.map((m) => m.method)).not.toContain('ui/notifications/initialized');
  });

  it('says so rather than hanging when the host refuses the view', () => {
    start();
    const id = posted.find((m) => m.method === 'ui/initialize')!.id;
    posted.length = 0;
    fire({ jsonrpc: '2.0', id, error: { code: -32000, message: 'nope' } });
    expect(posted.map((m) => m.method)).not.toContain('ui/notifications/initialized');
  });
});
