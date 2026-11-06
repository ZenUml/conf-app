import { response } from '../OkResponse';

const USER_TOKEN_HEADER = 'x-forge-oauth-user';

/**
 * Forge sends `x-forge-oauth-user` only for invocations that have a user in
 * session. A valid FIT without it is a guest or anonymous viewer, not an auth
 * failure (see "Guest and anonymous viewers get no Forge user token" in the
 * repo CLAUDE.md).
 */
export function hasForgeUserToken(request: Request): boolean {
  return Boolean(request.headers.get(USER_TOKEN_HEADER));
}

/**
 * Returns the viewer's Forge user token, or a `403 { error: 'no_user_credential' }`
 * Response. Never fall back to the app token to act for that viewer. Callers
 * check their own context (cloudId, apiBaseUrl, system token) separately, so
 * "no user token" is never merged with "missing Forge context".
 */
export function requireForgeUserToken(request: Request): string | Response {
  const token = request.headers.get(USER_TOKEN_HEADER);
  return token ? token : response(403, 'no_user_credential');
}
