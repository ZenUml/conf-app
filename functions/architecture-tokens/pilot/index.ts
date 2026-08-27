import { HttpError, errorResponse, jsonResponse, type SnapshotEnv } from '../../metrics-cache/snapshot/common';
import { timingSafeEqual } from '../../utils/deeplink';
import { runOpenRouterPilot } from '../openrouter-pilot';
import type { ArchitectureTokenEnv } from '../calibration';

interface InternalPilotEnv extends ArchitectureTokenEnv, SnapshotEnv {
  ARCHITECTURE_TOKEN_INTERNAL_EXECUTOR_TOKEN?: string;
}

/**
 * A deliberately narrow trusted-executor endpoint. It has no customer input:
 * scope, sample manifest, keys, and gates are bound as protected runtime
 * configuration. Its bearer credential is separate from every model key.
 */
export const onRequestPost: PagesFunction<InternalPilotEnv> = async ({ request, env }) => {
  try {
    const expected = env.ARCHITECTURE_TOKEN_INTERNAL_EXECUTOR_TOKEN;
    const authorization = request.headers.get('Authorization');
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!expected || !supplied || !timingSafeEqual(supplied, expected)) {
      throw new HttpError(403, 'Architecture Token pilot is not enabled');
    }
    return jsonResponse(await runOpenRouterPilot(env));
  } catch (error) {
    return errorResponse(error);
  }
};
