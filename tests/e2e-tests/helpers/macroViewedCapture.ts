import type { BrowserContext } from '@playwright/test';

/**
 * Capture `macro_viewed` (and any other) Mixpanel events as the browser sends
 * them, so a test can assert on the exact payload a real render produced.
 *
 * Two things here are load-bearing and cost real debugging time to learn:
 *
 * 1. **Listen on the CONTEXT, not the page.** The macro renders inside a Forge
 *    out-of-process iframe (`*.cdn.prod.atlassian-dev.net`); `page.on('request')`
 *    never sees its requests. `context.on('request')` does.
 * 2. **The endpoint is `api-js.mixpanel.com`, not `api.mixpanel.com`.** Matching
 *    the wrong host silently captures nothing and reads as "the event never
 *    fired" — that mistake cost a whole benchmark run once.
 *
 * The `data` payload is base64-encoded JSON in the default configuration and
 * plain JSON when verbose mode is on, so both are attempted.
 */
export interface CapturedEvent {
  event: string;
  properties: Record<string, any>;
}

export interface MacroViewedCapture {
  /** Every Mixpanel event seen so far, in arrival order. */
  all: CapturedEvent[];
  /** `macro_viewed` events only. */
  macroViewed(): CapturedEvent[];
  /** `macro_viewed` for one macro type. */
  forMacro(macroType: string): CapturedEvent[];
}

function decodePayload(raw: string): CapturedEvent[] {
  const attempts = [
    () => JSON.parse(raw),
    () => JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')),
  ];
  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // try the next encoding
    }
  }
  return [];
}

function extractData(request: { postData(): string | null; url(): string }): string | null {
  const body = request.postData();
  if (body) {
    // `data=<payload>` (form-encoded) or a bare JSON/base64 body.
    const params = new URLSearchParams(body);
    const fromForm = params.get('data');
    if (fromForm) return fromForm;
    return body;
  }
  // Some transports fall back to a GET with the payload on the query string.
  return new URL(request.url()).searchParams.get('data');
}

export function captureMixpanelEvents(context: BrowserContext): MacroViewedCapture {
  const all: CapturedEvent[] = [];

  context.on('request', (request) => {
    const url = request.url();
    if (!url.includes('api-js.mixpanel.com') || !url.includes('/track')) return;
    const raw = extractData(request);
    if (!raw) return;
    for (const event of decodePayload(raw)) {
      if (event && typeof event.event === 'string') {
        all.push({ event: event.event, properties: event.properties ?? {} });
      }
    }
  });

  return {
    all,
    macroViewed: () => all.filter((e) => e.event === 'macro_viewed'),
    forMacro: (macroType: string) =>
      all.filter((e) => e.event === 'macro_viewed' && e.properties.macro_type === macroType),
  };
}
