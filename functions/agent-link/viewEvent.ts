// POST /mcp/view-event: how the MCP Apps view (src/mcp-app-view.ts) says what it
// did with a tool result. Only the host's frame knows whether a diagram drew,
// and /track cannot take it: that endpoint wants a zenuml.com referer and
// Confluence ids, and this frame has neither.
//
// Public and sign-in-free, like the render endpoint, so anyone can post here.
// What they can do is bounded: only the enums below reach Mixpanel, so nothing
// free-form is stored, and each address has its own limit.

import { CORS, RENDER_TYPES, type RenderEnv } from './renderMcp';
import { withTimeout } from './mcpProtocol';
import { checkRenderRate } from './renderRateLimit';
import { mixpanelTrack } from '../service/mixpanelService';

/** One browser, several views on a page, and NAT: more than a render call's limit. */
export const VIEW_EVENT_LIMIT = 120;
const VIEW_EVENT_RATE_SCOPE = 'mcp-view-event';
/** Every valid body is well under this; the enums below have a fixed length. */
const MAX_BODY_CHARS = 512;

const RENDER_OUTCOMES = ['rendered', 'failed'];
const PLANTUML_RENDERERS = ['local', 'failed'];
const PLANTUML_FAILURE_REASONS = ['load_failed', 'include', 'engine_error'];
const FULLSCREEN_OUTCOMES = ['entered', 'exited', 'declined', 'failed'];
const ZOOM_ACTIONS = ['zoom_in', 'zoom_out', 'fit'];
const ZOOM_INPUTS = ['toolbar', 'wheel', 'keyboard'];

/** A render report (agent_link_app_view_rendered). */
interface RenderViewEvent {
  event: 'agent_link_app_view_rendered';
  macro_type: string;
  render_outcome: string;
  fullscreen_available?: boolean;
  plantuml_renderer?: string;
  plantuml_failure_reason?: string;
}

/** A press of the fullscreen button (agent_link_app_view_fullscreen_requested), sent with `kind: 'fullscreen'`. */
interface FullscreenViewEvent {
  event: 'agent_link_app_view_fullscreen_requested';
  macro_type: string;
  fullscreen_outcome: string;
}

/** A deliberate zoom (agent_link_app_view_zoomed), sent with `kind: 'zoom'`. */
interface ZoomViewEvent {
  event: 'agent_link_app_view_zoomed';
  macro_type: string;
  viewport_action: string;
  viewport_input: string;
  fullscreen_active: boolean;
}

type ViewEvent = RenderViewEvent | FullscreenViewEvent | ZoomViewEvent;

function isOneOf(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

/** The event to record, or null. Properties we did not ask for are dropped, not passed on. */
export function parseViewEvent(text: string): ViewEvent | null {
  if (text.length > MAX_BODY_CHARS) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  if (!isOneOf(body.macro_type, RENDER_TYPES)) return null;
  if (body.kind === 'fullscreen') {
    if (!isOneOf(body.fullscreen_outcome, FULLSCREEN_OUTCOMES)) return null;
    return { event: 'agent_link_app_view_fullscreen_requested', macro_type: body.macro_type, fullscreen_outcome: body.fullscreen_outcome };
  }
  if (body.kind === 'zoom') {
    if (!isOneOf(body.viewport_action, ZOOM_ACTIONS) || !isOneOf(body.viewport_input, ZOOM_INPUTS)) return null;
    if (typeof body.fullscreen_active !== 'boolean') return null;
    return {
      event: 'agent_link_app_view_zoomed',
      macro_type: body.macro_type,
      viewport_action: body.viewport_action,
      viewport_input: body.viewport_input,
      fullscreen_active: body.fullscreen_active,
    };
  }
  if (body.kind !== undefined || !isOneOf(body.render_outcome, RENDER_OUTCOMES)) return null;
  const event: RenderViewEvent = { event: 'agent_link_app_view_rendered', macro_type: body.macro_type, render_outcome: body.render_outcome };
  if (body.fullscreen_available !== undefined) {
    if (typeof body.fullscreen_available !== 'boolean') return null;
    event.fullscreen_available = body.fullscreen_available;
  }
  if (body.plantuml_renderer !== undefined) {
    if (!isOneOf(body.plantuml_renderer, PLANTUML_RENDERERS)) return null;
    event.plantuml_renderer = body.plantuml_renderer;
  }
  if (body.plantuml_failure_reason !== undefined) {
    if (!isOneOf(body.plantuml_failure_reason, PLANTUML_FAILURE_REASONS)) return null;
    event.plantuml_failure_reason = body.plantuml_failure_reason;
  }
  return event;
}

export async function handleViewEvent(
  request: Request,
  env: RenderEnv,
  deps: { waitUntil?: (work: Promise<void>) => void; nowMs?: () => number } = {},
): Promise<Response> {
  const event = parseViewEvent(await request.text());
  if (!event) return new Response(null, { status: 400, headers: CORS });

  const rate = await checkRenderRate(env, request.headers.get('CF-Connecting-IP'), (deps.nowMs ?? Date.now)(), Math.random, {
    scope: VIEW_EVENT_RATE_SCOPE,
    limit: VIEW_EVENT_LIMIT,
  });
  if (!rate.allowed) return new Response(null, { status: 429, headers: CORS });

  if (env.MIXPANEL_TOKEN) {
    const work = withTimeout(
      mixpanelTrack(
        { feature_area: 'agent_link', surface: 'mcp_app_view', ...event },
        env.MIXPANEL_TOKEN,
        env,
      ),
    ).then(() => undefined, () => undefined); // analytics never fails a response
    if (deps.waitUntil) deps.waitUntil(work);
    else await work;
  }
  return new Response(null, { status: 204, headers: CORS });
}
