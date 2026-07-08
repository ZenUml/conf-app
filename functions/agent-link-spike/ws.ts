// WebSocket transport probe: echoes messages + server-pushes a tick every 2s.
// THROWAWAY spike endpoint — deleted in Task 5.
export const onRequestGet: PagesFunction = async ({ request }) => {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();
  server.send(JSON.stringify({ type: 'open', msg: 'ws-ready' }));
  server.addEventListener('message', (e) =>
    server.send(JSON.stringify({ type: 'echo', msg: String(e.data), t: Date.now() })),
  );
  const iv = setInterval(
    () => server.send(JSON.stringify({ type: 'tick', t: Date.now() })),
    2000,
  );
  server.addEventListener('close', () => clearInterval(iv));
  return new Response(null, { status: 101, webSocket: client });
};
