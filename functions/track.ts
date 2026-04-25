import { mixpanelTrack, MIXPANEL_TOKEN_FRONTEND } from "./service/mixpanelService";

export interface EventBody {
  addon_key: string;
  client_domain: string;
  user_account_id: string;
  action: string;
  version: string;
  [key: string]: string | number | boolean | undefined | null;
}

const ALLOWED_REFERER_DOMAINS = ['zenuml.com', 'confluence-plugin.pages.dev', 'peng-new-8080.diagramly.ai']

const validateReferer = (referer: string) => {
  const refererDomain = new URL(referer).hostname;
  return ALLOWED_REFERER_DOMAINS.find(d => refererDomain.endsWith(d));
}

export const onRequest = async (event: any) => {
  const referer = event.request.headers.get('referer') || '';
  if (!validateReferer(referer)) {
    console.log(`Referer ${referer} not allowed`);
    return new Response('Forbidden', { status: 403 });
  }

  console.log('Received request from referer', referer);
  const body = await event.request.json() as EventBody;
  if (!body.client_domain || !body.addon_key || !body.user_account_id) {
    const error = `Missing ${!body.client_domain ? 'client_domain' : (!body.addon_key ? 'addon_key' : 'user_account_id')}`;
    console.log(error);
    return new Response(error, { status: 400 });
  }

  event.waitUntil(mixpanelTrack(body, MIXPANEL_TOKEN_FRONTEND)); //async handling

  return new Response(null, { status: 204 });
}
