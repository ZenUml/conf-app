import { OkResponse, response } from '../../OkResponse';
import type { ForgeRequestData } from '../../utils/authenticate';
import {
  DiagramImpactRequestError,
  registerDiagramImpactView,
  type DiagramImpactEnv,
} from '../../diagram-impact/service';

const FORBIDDEN_IDENTITY_FIELDS = new Set([
  'cloudId', 'forgeAppId', 'accountId', 'tenant', 'clientDomain', 'pageId', 'spaceKey',
]);

function failure(error: unknown): Response {
  if (error instanceof DiagramImpactRequestError) return response(error.status, error.code);
  return response(500, 'impact_unavailable');
}

export const onRequest = async ({
  request,
  env,
  data,
}: {
  request: Request;
  env: DiagramImpactEnv;
  data: ForgeRequestData;
}): Promise<Response> => {
  if (request.method !== 'POST') return response(405, 'method_not_allowed');
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return response(400, 'invalid_request');
  }
  if (!body || typeof body !== 'object' || Object.keys(body).some((key) => FORBIDDEN_IDENTITY_FIELDS.has(key))) {
    return response(400, 'invalid_request');
  }
  try {
    return OkResponse(await registerDiagramImpactView({
      env,
      data,
      forgeOAuthUser: request.headers.get('x-forge-oauth-user'),
      customContentId: body.customContentId,
    }));
  } catch (error) {
    return failure(error);
  }
};
