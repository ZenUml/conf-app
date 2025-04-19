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
    return decodedToken.iss || null;
  } catch (e) {
    console.error('Error decoding JWT:', e);
    return null;
  }
}