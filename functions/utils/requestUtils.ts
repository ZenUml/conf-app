export function getAuthorizationHeader(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return null;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authHeader);
  return match?.[1] || null;
}
