// Long-poll transport probe: holds the request up to 25s, returns as soon as
// a message with seq > `since` exists. THROWAWAY spike endpoint — deleted in Task 5.
import { room, CORS } from './_room';

export const onRequestGet: PagesFunction = async ({ request }) => {
  const u = new URL(request.url);
  const id = u.searchParams.get('room') || 'default';
  const since = Number(u.searchParams.get('since') || '0');
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const fresh = room(id).msgs.filter((m) => m.seq > since);
    if (fresh.length) {
      return Response.json({ msgs: fresh, ts: Date.now() }, { headers: CORS });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return Response.json({ msgs: [], ts: Date.now(), timeout: true }, { headers: CORS });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: CORS });
