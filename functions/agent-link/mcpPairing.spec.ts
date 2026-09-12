import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentLinkSession } from './AgentLinkSession';
import { onRequestDelete, onRequestPost } from './mcp';
import { IDLE_TTL_MS } from './sessionToken';
import { onRequestDelete as revokeSession } from './session';

function fixture() {
  const stores = new Map<string, Map<string, any>>();
  const instances = new Map<string, AgentLinkSession>();
  const sockets = new Map<string, { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>();
  const failBindingWrite = { value: false };
  const beforeFetch: { value?: (name: string, path: string, init?: RequestInit) => Promise<void> } = {};
  const env: any = { AGENT_LINK: {
    idFromName: (name: string) => ({ name }),
    get: ({ name }: { name: string }) => ({ fetch: async (url: string, init?: RequestInit) => {
      await beforeFetch.value?.(name, new URL(url).pathname, init);
      if (failBindingWrite.value && name.startsWith('mcp:') && new URL(url).pathname === '/mcp-binding' && init?.method === 'POST') {
        return new Response(null, { status: 503 });
      }
      if (!instances.has(name)) {
        const store = stores.get(name) ?? new Map();
        stores.set(name, store);
        const state: any = {
          storage: { get: async (key: string) => store.get(key), put: async (key: string, value: unknown) => store.set(key, structuredClone(value)), delete: async (key: string) => store.delete(key), setAlarm: vi.fn(), deleteAlarm: vi.fn() },
          getWebSockets: (tag: string) => tag === 'macro' && sockets.has(name) ? [sockets.get(name)] : [],
          getTags: () => ['macro'], blockConcurrencyWhile: async (fn: () => Promise<unknown>) => fn(),
        };
        instances.set(name, new AgentLinkSession(state, env));
      }
      return instances.get(name)!.fetch(new Request(url, init));
    } }),
  } };
  function target(code: string) {
    stores.set(code, new Map([['session', { token: code, boundContext: { cloudId: 'cloud-test', pageId: '100', contentId: '200' }, scope: 'read-page+write-diagram', issuedAtMs: Date.now(), lastActivityMs: Date.now(), state: 'created' }]]));
    sockets.set(code, { send: vi.fn(), close: vi.fn() });
  }
  async function rpc(method: string, params?: unknown, sessionId?: string, protocol?: string) {
    const request = new Request('https://example.com/agent-link/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}), ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const response = await onRequestPost({ request, env } as any);
    return { response, body: await response.json() as any };
  }
  async function initialize(name = 'codex-mcp-client', version = '2025-06-18') {
    const result = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name, version: '1.0' } });
    return { ...result, id: result.response.headers.get('Mcp-Session-Id')! };
  }
  const connect = (id: string, code: string) => rpc('tools/call', { name: 'connect', arguments: { code } }, id);
  return { env, stores, instances, sockets, target, rpc, initialize, connect, failBindingWrite, beforeFetch };
}

afterEach(() => vi.useRealTimers());

describe('MCP pairing through real target and binding Durable Objects', () => {
  it('negotiates a supported revision, preserves only a safe client label, and rejects reuse by another client', async () => {
    const f = fixture(); f.target('CL-ONE');
    const first = await f.initialize('codex-private-workspace');
    expect(first.body.result.protocolVersion).toBe('2025-06-18');
    expect((await f.connect(first.id, 'CL-ONE')).body.result.structuredContent.connected).toBe(true);
    const pushed = f.sockets.get('CL-ONE')!.send.mock.calls.map(([raw]) => JSON.parse(raw));
    expect(pushed).toContainEqual(expect.objectContaining({ activity: { type: 'agent_presence', stage: 'verified', clientName: 'Codex' } }));
    expect(JSON.stringify([...f.stores.values()].map(store => [...store]))).not.toContain('private-workspace');
    const second = await f.initialize('cursor');
    expect((await f.connect(second.id, 'CL-ONE')).body.error.data.code).toBe('code_already_used');
  });

  it('keeps pairing usable after real activity extends the original idle deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const f = fixture(); f.target('CL-LIVE');
    const { id } = await f.initialize();
    await f.connect(id, 'CL-LIVE');
    vi.setSystemTime(Date.now() + IDLE_TTL_MS - 1000);
    await f.env.AGENT_LINK.get({ name: 'CL-LIVE' }).fetch('https://agent-link-do/activity', { method: 'POST', body: JSON.stringify({ type: 'agent_request' }) });
    vi.setSystemTime(Date.now() + 2000);
    f.instances.clear(); // both target and binding rehydrate from storage
    expect((await f.rpc('tools/call', { name: 'get_status' }, id)).body.error).toBeUndefined();
  });

  it('rolls back the target claim when storing the MCP binding fails', async () => {
    const f = fixture(); f.target('CL-RETRY');
    const { id } = await f.initialize();
    f.failBindingWrite.value = true;
    expect((await f.connect(id, 'CL-RETRY')).body.error.data.code).toBe('binding_failed');
    expect(f.stores.get('CL-RETRY')!.has('mcpClaim')).toBe(false);
    f.failBindingWrite.value = false;
    const other = await f.initialize();
    expect((await f.connect(other.id, 'CL-RETRY')).body.result.structuredContent.connected).toBe(true);
  });

  it('refuses a stale binding after its target is claimed by another MCP client', async () => {
    const f = fixture(); f.target('CL-OWNER');
    const { id } = await f.initialize(); await f.connect(id, 'CL-OWNER');
    f.stores.get('CL-OWNER')!.set('mcpClaim', 'another-client');
    const result = await f.rpc('tools/call', { name: 'get_status' }, id);
    expect(result.response.status).toBe(401);
    expect(result.body.result).toBeUndefined();
  });

  it('rejects an incompatible request header without extending the target idle TTL', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const f = fixture(); f.target('CL-PROTOCOL');
    const { id } = await f.initialize(); await f.connect(id, 'CL-PROTOCOL');
    const before = f.stores.get('CL-PROTOCOL')!.get('session').lastActivityMs;
    vi.setSystemTime(Date.now() + 1000);
    const result = await f.rpc('tools/call', { name: 'get_status' }, id, '1900-01-01');
    expect(result.response.status).toBe(400);
    expect(f.stores.get('CL-PROTOCOL')!.get('session').lastActivityMs).toBe(before);
    expect(f.sockets.get('CL-PROTOCOL')!.send.mock.calls.map(([raw]) => JSON.parse(raw))).toContainEqual(expect.objectContaining({ activity: { type: 'protocol_incompatible' } }));
  });

  it('keeps a valid pairing when an attempted target switch has an invalid code', async () => {
    const f = fixture(); f.target('CL-CURRENT');
    const { id } = await f.initialize(); await f.connect(id, 'CL-CURRENT');
    expect((await f.connect(id, 'CL-NOT-THERE')).body.error.data.code).toBe('invalid_code');
    expect((await f.rpc('tools/call', { name: 'get_status' }, id)).body.error).toBeUndefined();
  });

  it('terminates a transport on DELETE so its old MCP session cannot claim another code', async () => {
    const f = fixture(); f.target('CL-DELETED');
    const { id } = await f.initialize(); await f.connect(id, 'CL-DELETED');
    await onRequestDelete({ env: f.env, request: new Request('https://example.com/agent-link/mcp', { method: 'DELETE', headers: { 'Mcp-Session-Id': id } }) } as any);
    expect((await f.connect(id, 'CL-DELETED')).response.status).toBe(404);
  });

  it('revokes a disconnected macro and releases its content lock before a new mint', async () => {
    const f = fixture(); f.target('CL-REVOKE');
    const lock = f.env.AGENT_LINK.get({ name: 'content:cloud-test:200' });
    await lock.fetch('https://agent-link-do/content-claim', { method: 'POST', body: JSON.stringify({ token: 'CL-REVOKE', expiresAt: Date.now() + 600_000 }) });
    f.sockets.delete('CL-REVOKE');
    const response = await revokeSession({ env: f.env, request: new Request('https://example.com/agent-link/session', { method: 'DELETE', body: JSON.stringify({ token: 'CL-REVOKE', cloudId: 'cloud-test', pageId: '100', contentId: '200' }) }) } as any);
    expect(response.status).toBe(200);
    expect(f.stores.get('CL-REVOKE')!.get('session').state).toBe('closed');
    expect((await lock.fetch('https://agent-link-do/content-claim', { method: 'POST', body: JSON.stringify({ token: 'CL-NEW', expiresAt: Date.now() + 600_000 }) })).status).toBe(200);
  });

  it('rolls back an in-flight claim when DELETE terminates the transport before binding commit', async () => {
    const f = fixture(); f.target('CL-OLD'); f.target('CL-NEW');
    const { id } = await f.initialize(); await f.connect(id, 'CL-OLD');
    let reached!: () => void; let resume!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    f.beforeFetch.value = async (name, path, init) => {
      if (name === `mcp:${id}` && path === '/mcp-binding' && init?.method === 'POST') {
        reached(); await released;
      }
    };
    const connecting = f.connect(id, 'CL-NEW');
    await paused;
    const deleted = await onRequestDelete({ env: f.env, request: new Request('https://example.com/agent-link/mcp', { method: 'DELETE', headers: { 'Mcp-Session-Id': id } }) } as any);
    expect(deleted.status).toBe(200);
    resume();
    expect((await connecting).body.error.data.code).toBe('binding_failed');
    expect(f.stores.get('CL-OLD')!.has('mcpClaim')).toBe(false);
    expect(f.stores.get('CL-NEW')!.has('mcpClaim')).toBe(false);
    expect(f.stores.get(`mcp:${id}`)!.has('mcpBinding')).toBe(false);
  });

  it('rejects a new connect while DELETE is releasing the old target', async () => {
    const f = fixture(); f.target('CL-OLD'); f.target('CL-NEW');
    const { id } = await f.initialize(); await f.connect(id, 'CL-OLD');
    let reached!: () => void; let resume!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    f.beforeFetch.value = async (name, path) => {
      if (name === 'CL-OLD' && path === '/mcp-release') { reached(); await released; }
    };
    const deleting = onRequestDelete({ env: f.env, request: new Request('https://example.com/agent-link/mcp', { method: 'DELETE', headers: { 'Mcp-Session-Id': id } }) } as any);
    await paused;
    const connecting = await f.connect(id, 'CL-NEW');
    resume(); await deleting;
    expect(connecting.response.status).toBe(404);
    expect(f.stores.get('CL-NEW')!.has('mcpClaim')).toBe(false);
  });

  it('validates DELETE protocol revisions and rejects a terminated session', async () => {
    const f = fixture(); const { id } = await f.initialize();
    const remove = (protocol?: string) => onRequestDelete({ env: f.env, request: new Request('https://example.com/agent-link/mcp', { method: 'DELETE', headers: { 'Mcp-Session-Id': id, ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}) } }) } as any);
    expect((await remove('1900-01-01')).status).toBe(400);
    expect((await remove('2025-06-18')).status).toBe(200);
    expect((await remove()).status).toBe(404);
  });

  it.each(['revoke', 'expiry'])('keeps a %s terminal code unusable after Durable Object eviction', async reason => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const f = fixture(); f.target('CL-TERMINAL');
    const target = f.env.AGENT_LINK.get({ name: 'CL-TERMINAL' });
    if (reason === 'revoke') {
      await target.fetch('https://agent-link-do/revoke', { method: 'POST', body: JSON.stringify({ cloudId: 'cloud-test', pageId: '100', contentId: '200' }) });
    } else {
      await target.fetch('https://agent-link-do/session');
      vi.setSystemTime(Date.now() + IDLE_TTL_MS + 1);
      await f.instances.get('CL-TERMINAL')!.alarm();
    }
    f.instances.clear(); f.sockets.clear();
    const response = await target.fetch('https://agent-link-do/channel?token=CL-TERMINAL&peer=macro&cloudId=cloud-test&pageId=100&contentId=200', { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(410);
    expect(f.stores.get('CL-TERMINAL')!.get('session').issuedAtMs).toBe(new Date('2026-09-12T00:00:00Z').getTime());
  });

  it('revokes a minted code even when its macro channel never opened', async () => {
    const f = fixture();
    const response = await revokeSession({ env: f.env, request: new Request('https://example.com/agent-link/session', { method: 'DELETE', body: JSON.stringify({ token: 'CL-UNOPENED', cloudId: 'cloud-test', pageId: '100', contentId: '200' }) }) } as any);
    expect(response.status).toBe(200);
    f.instances.clear();
    const channel = await f.env.AGENT_LINK.get({ name: 'CL-UNOPENED' }).fetch('https://agent-link-do/channel?token=CL-UNOPENED&peer=macro&cloudId=cloud-test&pageId=100&contentId=200', { headers: { Upgrade: 'websocket' } });
    expect(channel.status).toBe(410);
  });

  it('offers the latest server version for an unsupported initialize revision', async () => {
    const f = fixture();
    expect((await f.initialize('test-client', '2099-01-01')).body.result.protocolVersion).toBe('2025-11-25');
  });
});
