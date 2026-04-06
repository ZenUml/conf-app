export function getAuthorizationHeader(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return null;
  }
  return authHeader.split(' ')[1] || null;
}
