import { mixpanelTrack } from "./service/mixpanelService";
import { archiveAnalyticsEvent, insertAnalyticsEventFact, normalizeFrontendAnalyticsEvent } from "./utils/analytics";
import { TrackRequest } from "./service/analyticsTypes";

const ALLOWED_REFERER_DOMAINS = ['zenuml.com', 'confluence-plugin.pages.dev', 'peng-new-8080.diagramly.ai'];

const validateReferer = (referer: string): boolean => {
  if (!referer) return false;
  try {
    const refererDomain = new URL(referer).hostname;
    return !!ALLOWED_REFERER_DOMAINS.find(d => refererDomain.endsWith(d));
  } catch {
    return false;
  }
};

export const onRequest = async (event: any) => {
  const referer = event.request.headers.get('referer') || '';
  if (!validateReferer(referer)) {
    console.log(`Referer ${referer} not allowed`);
    return new Response('Forbidden', { status: 403 });
  }

  console.log('Received request from referer', referer);
  const body = await event.request.json() as TrackRequest;

  if (!body.client_domain || !body.addon_key || !body.user_account_id) {
    const error = `Missing ${!body.client_domain ? 'client_domain' : (!body.addon_key ? 'addon_key' : 'user_account_id')}`;
    console.log(error);
    return new Response(error, { status: 400 });
  }

  const analyticsEvent = normalizeFrontendAnalyticsEvent(body as unknown as Record<string, unknown>, event.request);
  event.waitUntil((async () => {
    const r2Key = await archiveAnalyticsEvent(event.env.EVENT_BUCKET, analyticsEvent, body as unknown as Record<string, unknown>);
    await insertAnalyticsEventFact(event.env.DB, analyticsEvent, r2Key);
  })());
  event.waitUntil(mixpanelTrack(body, event.env.MIXPANEL_TOKEN)); //async handling

  return new Response(null, { status: 204 });
};
