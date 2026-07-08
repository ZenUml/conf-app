// SSE transport probe: emits `open`, then a `tick` every 2s and any pushed
// `msg` for the room. THROWAWAY spike endpoint — deleted in Task 5.
import { room, CORS } from './_room';

export const onRequestGet: PagesFunction = async ({ request }) => {
  const id = new URL(request.url).searchParams.get('room') || 'default';
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(ctrl) {
      let lastSeq = 0;
      ctrl.enqueue(enc.encode(`event: open\ndata: sse-ready\n\n`));
      timer = setInterval(() => {
        const r = room(id);
        r.msgs
          .filter((m) => m.seq > lastSeq)
          .forEach((m) => {
            lastSeq = m.seq;
            ctrl.enqueue(enc.encode(`event: msg\ndata: ${JSON.stringify(m)}\n\n`));
          });
        ctrl.enqueue(enc.encode(`event: tick\ndata: ${Date.now()}\n\n`));
      }, 2000);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      ...CORS,
    },
  });
};
