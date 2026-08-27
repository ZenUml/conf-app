import { OkResponse, response } from '../../OkResponse';
import {
  confluencePageResolver,
  relatedDiagrams,
} from '../../architecture-tokens/service';
import type { ForgeRequestData } from '../../utils/authenticate';

interface Env {
  DB: D1Database;
}

// Lookup failures stay 2xx so the viewer can remain silent while recording
// the failure as an analytics event.
const EMPTY_RESPONSE = {
  indexedAt: null,
  contentVersion: null,
  participants: [],
  error_kind: 'lookup_failed',
};

export const onRequest = async ({
  request,
  env,
  data,
}: {
  request: Request;
  env: Env;
  data: ForgeRequestData;
}): Promise<Response> => {
  if (request.method !== 'GET') return response(405, 'method_not_allowed');

  const cloudId = data.forgeContext?.cloudId;
  const apiBaseUrl = data.forgeContext?.apiBaseUrl;
  const user = request.headers.get('x-forge-oauth-user');
  if (!cloudId || !apiBaseUrl || !user) return response(401, 'forge_context_missing');

  const id = new URL(request.url).searchParams.get('customContentId') ?? '';
  if (!/^\d{1,20}$/.test(id)) return response(400, 'invalid_custom_content_id');

  try {
    return OkResponse(await relatedDiagrams(
      env.DB,
      cloudId,
      id,
      confluencePageResolver(apiBaseUrl, user),
    ));
  } catch (error) {
    console.error('architecture-tokens related lookup failed', error);
    return OkResponse(EMPTY_RESPONSE);
  }
};
