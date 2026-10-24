import { response } from "../OkResponse";
import type { ForgeRequestData } from "../utils/authenticate";

export interface DiagramlyIdentity {
  accountId: string;
  cloudId: string;
}

/**
 * Resolve the caller's identity from the *verified* Forge invocation context
 * (populated by the auth middleware from the RS256-signed token), never from
 * the request body — a body value is client-controlled and would let a caller
 * attribute usage/billing to an arbitrary tenant.
 *
 * Returns a 400 Response when a required field is absent, so the failure
 * surfaces at the route boundary with a readable message instead of a generic
 * 500 thrown deep in the Diagramly service. Callers use:
 *
 *   const identity = resolveDiagramlyIdentity(data);
 *   if (identity instanceof Response) return identity;
 */
export function resolveDiagramlyIdentity(
  data: ForgeRequestData,
): DiagramlyIdentity | Response {
  const accountId = data.forgeContext?.accountId;
  const cloudId = data.forgeContext?.cloudId;

  if (!accountId) {
    return response(400, "Missing accountId in Forge context");
  }
  if (!cloudId) {
    return response(400, "Missing cloudId in Forge context");
  }

  return { accountId, cloudId };
}
