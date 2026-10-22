import { OkResponse, response } from '../../OkResponse';
import type { ForgeRequestData } from '../../utils/authenticate';
import { requireForgeUserToken } from '../../utils/forgeUserToken';
import {
  diagramImpactFailure,
  registerDiagramImpactView,
  type DiagramImpactEnv,
} from '../../diagram-impact/service';

const FORBIDDEN_IDENTITY_FIELDS = new Set([
  'cloudId', 'forgeAppId', 'accountId', 'tenant', 'clientDomain', 'pageId', 'spaceKey',
]);

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
  const forgeOAuthUser = requireForgeUserToken(request);
  if (forgeOAuthUser instanceof Response) return forgeOAuthUser;
  try {
    return OkResponse(await registerDiagramImpactView({
      env,
      data,
      forgeOAuthUser,
      customContentId: body.customContentId,
    }));
  } catch (error) {
    return diagramImpactFailure(error);
  }
};
