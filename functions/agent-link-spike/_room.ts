// Spike-grade in-memory room registry. One isolate may not see another's
// state on Cloudflare — acceptable: SSE/WS hold a single connection in one
// isolate; long-poll uses the `since` cursor. THROWAWAY: deleted in Task 5.
type Room = { seq: number; msgs: { seq: number; msg: string; t: number }[] };
const rooms = new Map<string, Room>();

export function room(id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = { seq: 0, msgs: [] };
    rooms.set(id, r);
  }
  return r;
}

export function pushMsg(id: string, msg: string): number {
  const r = room(id);
  r.seq += 1;
  r.msgs.push({ seq: r.seq, msg, t: Date.now() });
  if (r.msgs.length > 50) r.msgs.shift();
  return r.seq;
}

export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
