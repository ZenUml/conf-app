// Inject a message into a spike room (drives the round-trip tests).
// THROWAWAY spike endpoint — deleted in Task 5.
import { pushMsg, CORS } from './_room';

export const onRequestPost: PagesFunction = async ({ request }) => {
  const id = new URL(request.url).searchParams.get('room') || 'default';
  const body = (await request.json().catch(() => ({ msg: '' }))) as { msg?: string };
  const seq = pushMsg(id, body.msg || '');
  return Response.json({ ok: true, seq }, { headers: CORS });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: CORS });
