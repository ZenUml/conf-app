import { describe, it, expect } from 'vitest';
import { applyEvent, parseEnvelope, reattachEvent, routeMessage, statusEnvelope } from './forwarding';
import type { Envelope, Peer } from './forwarding';
import type { SessionState } from './sessionToken';

describe('parseEnvelope', () => {
  it('parses an "op" envelope with id/op/payload', () => {
    const env = parseEnvelope(
      JSON.stringify({ kind: 'op', id: 'req-1', op: 'update_diagram', payload: { dsl: 'A->B: hi' } }),
    );
    expect(env).toEqual({ kind: 'op', id: 'req-1', op: 'update_diagram', payload: { dsl: 'A->B: hi' } });
  });

  it('parses a "result" envelope keyed by id', () => {
    const env = parseEnvelope(JSON.stringify({ kind: 'result', id: 'req-1', payload: { ok: true } }));
    expect(env).toEqual({ kind: 'result', id: 'req-1', payload: { ok: true } });
  });

  it('parses an "error" envelope keyed by id', () => {
    const env = parseEnvelope(JSON.stringify({ kind: 'error', id: 'req-1', payload: { message: 'boom' } }));
    expect(env).toEqual({ kind: 'error', id: 'req-1', payload: { message: 'boom' } });
  });

  it('parses a bare "ping" envelope with no id/op/payload', () => {
    const env = parseEnvelope(JSON.stringify({ kind: 'ping' }));
    expect(env).toEqual({ kind: 'ping' });
  });

  it('omits id/op/payload fields that are absent from the input', () => {
    const env = parseEnvelope(JSON.stringify({ kind: 'op' }));
    expect(env).toEqual({ kind: 'op' });
    expect('id' in env).toBe(false);
    expect('op' in env).toBe(false);
    expect('payload' in env).toBe(false);
  });

  it('ignores id/op fields that are not strings', () => {
    const env = parseEnvelope(JSON.stringify({ kind: 'op', id: 42, op: null }));
    expect(env.id).toBeUndefined();
    expect(env.op).toBeUndefined();
  });

  it('returns kind "invalid" for malformed JSON', () => {
    const env = parseEnvelope('{not json');
    expect(env.kind).toBe('invalid');
    expect(env.reason).toBeTruthy();
  });

  it('returns kind "invalid" for valid JSON that is not an object', () => {
    expect(parseEnvelope('42').kind).toBe('invalid');
    expect(parseEnvelope('"hello"').kind).toBe('invalid');
    expect(parseEnvelope('null').kind).toBe('invalid');
    expect(parseEnvelope('[1,2,3]').kind).toBe('invalid');
  });

  it('returns kind "invalid" when "kind" is missing or unrecognized', () => {
    expect(parseEnvelope(JSON.stringify({})).kind).toBe('invalid');
    expect(parseEnvelope(JSON.stringify({ kind: 'delete_everything' })).kind).toBe('invalid');
  });

  it('parses a bare "disconnect" envelope (explicit disconnect signal)', () => {
    const env = parseEnvelope(JSON.stringify({ kind: 'disconnect' }));
    expect(env).toEqual({ kind: 'disconnect' });
  });
});

describe('routeMessage', () => {
  it('routes an agent "op" to the macro', () => {
    const env: Envelope = { kind: 'op', op: 'read_page' };
    expect(routeMessage('agent', env)).toEqual({ to: 'macro' });
  });

  it('routes a macro "result" to the agent', () => {
    const env: Envelope = { kind: 'result', id: 'req-1', payload: {} };
    expect(routeMessage('macro', env)).toEqual({ to: 'agent' });
  });

  it('routes a macro "error" to the agent', () => {
    const env: Envelope = { kind: 'error', id: 'req-1', payload: {} };
    expect(routeMessage('macro', env)).toEqual({ to: 'agent' });
  });

  it.each<Peer>(['macro', 'agent'])('drops a "ping" from %s locally', (from) => {
    expect(routeMessage(from, { kind: 'ping' })).toEqual({ drop: 'ping' });
  });

  it('drops an "op" sent by the macro (wrong direction) as unknown', () => {
    expect(routeMessage('macro', { kind: 'op', op: 'read_page' })).toEqual({ drop: 'unknown' });
  });

  it('drops a "result"/"error" sent by the agent (wrong direction) as unknown', () => {
    expect(routeMessage('agent', { kind: 'result', id: 'req-1' })).toEqual({ drop: 'unknown' });
    expect(routeMessage('agent', { kind: 'error', id: 'req-1' })).toEqual({ drop: 'unknown' });
  });

  it('drops an invalid envelope as unknown', () => {
    expect(routeMessage('agent', { kind: 'invalid', reason: 'bad' })).toEqual({ drop: 'unknown' });
  });

  it.each<Peer>(['macro', 'agent'])(
    'drops a "disconnect" from %s locally (handled by AgentLinkSession, not forwarded)',
    (from) => {
      expect(routeMessage(from, { kind: 'disconnect' })).toEqual({ drop: 'disconnect' });
    },
  );
});

describe('applyEvent', () => {
  it('drives paired -> active on an agent "op"', () => {
    expect(applyEvent('paired', { kind: 'op', op: 'update_diagram' }, 'agent')).toBe('active');
  });

  it('keeps active -> active on a subsequent agent "op"', () => {
    expect(applyEvent('active', { kind: 'op', op: 'update_diagram' }, 'agent')).toBe('active');
  });

  it('leaves "created" unchanged for an agent "op" before pairing (invalid edit-before-pair)', () => {
    expect(applyEvent('created', { kind: 'op', op: 'read_page' }, 'agent')).toBe('created');
  });

  it('leaves state unchanged for a macro "result"/"error" (only agent ops drive edit)', () => {
    expect(applyEvent('paired', { kind: 'result', id: 'req-1' }, 'macro')).toBe('paired');
    expect(applyEvent('active', { kind: 'error', id: 'req-1' }, 'macro')).toBe('active');
  });

  it('leaves state unchanged for a "ping"', () => {
    expect(applyEvent('paired', { kind: 'ping' }, 'agent')).toBe('paired');
    expect(applyEvent('paired', { kind: 'ping' }, 'macro')).toBe('paired');
  });

  it('leaves terminal states ("closed"/"expired") unchanged even for an agent "op"', () => {
    const terminal: SessionState[] = ['closed', 'expired'];
    for (const state of terminal) {
      expect(applyEvent(state, { kind: 'op', op: 'update_diagram' }, 'agent')).toBe(state);
    }
  });
});

describe('reattachEvent', () => {
  it('returns "reattach" when the session was suspended, regardless of which peer reconnects', () => {
    expect(reattachEvent('macro', true)).toBe('reattach');
    expect(reattachEvent('agent', true)).toBe('reattach');
  });

  it('returns the original bootstrap event for a first connect (not suspended)', () => {
    expect(reattachEvent('macro', false)).toBe('macro_connected');
    expect(reattachEvent('agent', false)).toBe('agent_paired');
  });
});

describe('statusEnvelope (relay-originated status bus, spec 2026-07-13 §4)', () => {
  it('serializes expiresAt + hitCap, omitting activity when absent', () => {
    expect(JSON.parse(statusEnvelope(1234, false))).toEqual({ kind: 'status', expiresAt: 1234, hitCap: false });
  });

  it('carries an activity payload when given', () => {
    expect(JSON.parse(statusEnvelope(1234, true, { type: 'guardrail_rejected', detail: 'parse_error' }))).toEqual({
      kind: 'status', expiresAt: 1234, hitCap: true,
      activity: { type: 'guardrail_rejected', detail: 'parse_error' },
    });
  });

  it('a PEER-sent status stays invalid — relay-originated only', () => {
    const parsed = parseEnvelope(statusEnvelope(1234, false));
    expect(parsed.kind).toBe('invalid');
  });
});
