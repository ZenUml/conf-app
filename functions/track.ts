import { mixpanelTrack, MIXPANEL_TOKEN_FRONTEND } from "./service/mixpanelService";
import { isCanonicalRequest, TrackRequest } from "./service/analyticsTypes";

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

  if (isCanonicalRequest(body)) {
    if (!body.event || !body.addon_key) {
      return new Response('Missing event or addon_key', { status: 400 });
    }
    const payload = {
      event: body.event,
      addon_key: body.addon_key,
      version: body.version,
      ...body.properties,
    };
    event.waitUntil(mixpanelTrack(payload, MIXPANEL_TOKEN_FRONTEND));
    return new Response(null, { status: 204 });
  }

  // Legacy path (transport_version: 1 or absent)
  const legacyBody = body as any;
  if (!legacyBody.client_domain || !legacyBody.addon_key || !legacyBody.user_account_id) {
    const error = `Missing ${!legacyBody.client_domain ? 'client_domain' : (!legacyBody.addon_key ? 'addon_key' : 'user_account_id')}`;
    console.log(error);
    return new Response(error, { status: 400 });
  }

  event.waitUntil(mixpanelTrack(legacyBody, MIXPANEL_TOKEN_FRONTEND));
  return new Response(null, { status: 204 });
};
