import { OkResponse, response } from '../../OkResponse';
import type { ForgeRequestData } from '../../utils/authenticate';
import {
  DiagramImpactRequestError,
  getDiagramImpactSummary,
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
  if (request.method !== 'GET') return response(405, 'method_not_allowed');
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => FORBIDDEN_IDENTITY_FIELDS.has(key))) {
    return response(400, 'invalid_request');
  }
  try {
    return OkResponse(await getDiagramImpactSummary({
      env,
      data,
      forgeOAuthUser: request.headers.get('x-forge-oauth-user'),
      customContentId: url.searchParams.get('customContentId'),
    }));
  } catch (error) {
    return failure(error);
  }
};
