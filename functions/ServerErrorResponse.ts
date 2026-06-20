export function ServerErrorResponse() {
  // JSON + explicit Content-Type so this remote-facing 500 is parseable by the
  // Forge bridge instead of being rejected as `text/plain` (see OkResponse.ts).
  return new Response(JSON.stringify({ error: 'Something went wrong' }), {
    status: 500,
    statusText: 'Internal Server Error',
    headers: {
      'Content-Type': 'application/json',
    },
  });
}