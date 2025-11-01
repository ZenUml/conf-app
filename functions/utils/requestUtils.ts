import {decode} from "./atlassian";

export function getAuthorizationHeader(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return null;
  }
  return authHeader.split(' ')[1] || null;
}

export function getClientKeyFromRequest(request: Request): string | null {
  const jwt = getAuthorizationHeader(request);
  if (!jwt) {
    return null;
  }

  try {
    const decodedToken = decode(jwt);
    return decodedToken.iss || null; //TODO: use .aud in forge app, e.g. "aud": "ari:cloud:ecosystem::app/d9e4002b-120b-426b-834b-402a4a5adce7"
  } catch (e) {
    console.error('Error decoding JWT:', e);
    return null;
  }
}