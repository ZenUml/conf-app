// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleViewEvent, parseViewEvent, VIEW_EVENT_LIMIT } from './viewEvent';
import { checkRenderRate, RENDER_LIMIT } from './renderRateLimit';
import { mixpanelTrack } from '../service/mixpanelService';

vi.mock('../service/mixpanelService', () => ({ mixpanelTrack: vi.fn(async () => undefined) }));

function post(body: unknown, headers: HeadersInit = {}) {
  return new Request('https://zenuml.com/mcp/view-event', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Enough of D1 to count per bucket, as the real upsert does. */
function countingDb() {
  const counts = new Map<string, number>();
  return {
    buckets: counts,
    prepare: () => ({
      bind: (bucket: string, windowStart: number) => ({
        first: async () => {
          const key = `${bucket}:${windowStart}`;
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          return { count };
        },
        run: async () => undefined,
      }),
    }),
  };
}

afterEach(() => vi.mocked(mixpanelTrack).mockClear());

describe('parseViewEvent', () => {
  it('keeps the enums and drops anything else, so no free text can reach Mixpanel', () => {
    expect(parseViewEvent(JSON.stringify({
      macro_type: 'plantuml',
      render_outcome: 'failed',
      plantuml_renderer: 'failed',
      plantuml_failure_reason: 'include',
      dsl: '@startuml\nsecret\n@enduml',
      title: 'Customer title',
    }))).toEqual({
      event: 'agent_link_app_view_rendered',
      macro_type: 'plantuml',
      render_outcome: 'failed',
      plantuml_renderer: 'failed',
      plantuml_failure_reason: 'include',
    });
  });

  it.each([
    ['not JSON', 'nope'],
    ['JSON that is no object', 'null'],
    ['an unknown type', '{"macro_type":"embed","render_outcome":"rendered"}'],
    ['an unknown outcome', '{"macro_type":"mermaid","render_outcome":"timeout"}'],
    ['a server renderer the view never uses', '{"macro_type":"plantuml","render_outcome":"rendered","plantuml_renderer":"server"}'],
    ['free text as a reason', '{"macro_type":"plantuml","render_outcome":"failed","plantuml_failure_reason":"@startuml"}'],
    ['a fullscreen report with no outcome', '{"kind":"fullscreen","macro_type":"mermaid"}'],
    ['a fullscreen report with free text', '{"kind":"fullscreen","macro_type":"mermaid","fullscreen_outcome":"graph TD"}'],
    ['an unknown kind', '{"kind":"zoom","macro_type":"mermaid","render_outcome":"rendered"}'],
    ['a non-boolean fullscreen_available', '{"macro_type":"mermaid","render_outcome":"rendered","fullscreen_available":"yes"}'],
    ['an oversized body', JSON.stringify({ macro_type: 'mermaid', render_outcome: 'rendered', pad: 'x'.repeat(600) })],
  ])('refuses %s', (_label, text) => {
    expect(parseViewEvent(text)).toBeNull();
  });
});

describe('parseViewEvent — fullscreen', () => {
  it('keeps whether the host offered fullscreen on a render report', () => {
    expect(parseViewEvent('{"macro_type":"sequence","render_outcome":"rendered","fullscreen_available":true}')).toEqual({
      event: 'agent_link_app_view_rendered', macro_type: 'sequence', render_outcome: 'rendered', fullscreen_available: true,
    });
  });

  it('reads a fullscreen report as its own event, dropping anything else', () => {
    expect(parseViewEvent('{"kind":"fullscreen","macro_type":"graph","fullscreen_outcome":"entered","render_outcome":"rendered","title":"x"}')).toEqual({
      event: 'agent_link_app_view_fullscreen_requested', macro_type: 'graph', fullscreen_outcome: 'entered',
    });
  });
});

describe('parseViewEvent — zoom', () => {
  it('reads a zoom report as its own event, dropping anything else', () => {
    expect(parseViewEvent('{"kind":"zoom","macro_type":"mermaid","viewport_action":"zoom_in","viewport_input":"wheel","fullscreen_active":true,"title":"x"}')).toEqual({
      event: 'agent_link_app_view_zoomed', macro_type: 'mermaid', viewport_action: 'zoom_in', viewport_input: 'wheel', fullscreen_active: true,
    });
  });

  it.each([
    ['an unknown action', '{"kind":"zoom","macro_type":"mermaid","viewport_action":"zoom_to_400","viewport_input":"toolbar","fullscreen_active":false}'],
    ['an unknown input', '{"kind":"zoom","macro_type":"mermaid","viewport_action":"fit","viewport_input":"voice","fullscreen_active":false}'],
    ['no fullscreen_active', '{"kind":"zoom","macro_type":"mermaid","viewport_action":"fit","viewport_input":"toolbar"}'],
  ])('refuses %s', (_label, text) => {
    expect(parseViewEvent(text)).toBeNull();
  });
});

describe('handleViewEvent', () => {
  it('records one event and answers 204 without waiting for Mixpanel', async () => {
    const waitUntil = vi.fn();
    const response = await handleViewEvent(
      post({ macro_type: 'plantuml', render_outcome: 'rendered', plantuml_renderer: 'local' }),
      { MIXPANEL_TOKEN: 't' },
      { waitUntil },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(mixpanelTrack).toHaveBeenCalledWith(
      {
        event: 'agent_link_app_view_rendered',
        feature_area: 'agent_link',
        surface: 'mcp_app_view',
        macro_type: 'plantuml',
        render_outcome: 'rendered',
        plantuml_renderer: 'local',
      },
      't',
      expect.anything(),
    );
  });

  it('answers 400 and records nothing for a body it does not recognise', async () => {
    const response = await handleViewEvent(post({ macro_type: 'mermaid' }), { MIXPANEL_TOKEN: 't' });
    expect(response.status).toBe(400);
    expect(mixpanelTrack).not.toHaveBeenCalled();
  });

  it('still answers 204 when Mixpanel fails', async () => {
    vi.mocked(mixpanelTrack).mockRejectedValueOnce(new Error('down'));
    const response = await handleViewEvent(post({ macro_type: 'graph', render_outcome: 'failed' }), { MIXPANEL_TOKEN: 't' });
    expect(response.status).toBe(204);
  });

  it('refuses an address past its limit, and records nothing', async () => {
    const DB = countingDb();
    const env = { DB, MIXPANEL_TOKEN: 't' };
    const send = () => handleViewEvent(
      post({ macro_type: 'mermaid', render_outcome: 'rendered' }, { 'CF-Connecting-IP': '203.0.113.9' }),
      env,
      { nowMs: () => 1_000_000 },
    );
    for (let i = 0; i < VIEW_EVENT_LIMIT; i++) expect((await send()).status).toBe(204);
    vi.mocked(mixpanelTrack).mockClear();
    expect((await send()).status).toBe(429);
    expect(mixpanelTrack).not.toHaveBeenCalled();
  });

  it('counts apart from render calls, so reports never spend an agent\'s render limit', async () => {
    const DB = countingDb();
    const env = { DB };
    const ip = '203.0.113.9';
    for (let i = 0; i < VIEW_EVENT_LIMIT; i++) {
      await handleViewEvent(post({ macro_type: 'mermaid', render_outcome: 'rendered' }, { 'CF-Connecting-IP': ip }), env, { nowMs: () => 1_000_000 });
    }
    const render = await checkRenderRate(env, ip, 1_000_000);
    expect(render).toEqual({ allowed: true, count: 1 });
    expect(RENDER_LIMIT).toBeLessThan(VIEW_EVENT_LIMIT);
    expect(DB.buckets.size).toBe(2);
  });
});
