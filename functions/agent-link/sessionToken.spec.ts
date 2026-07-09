import { describe, it, expect } from 'vitest';
import { TOKEN_TTL_MS, isExpired, mintToken, nextState } from './sessionToken';
import type { SessionEvent, SessionState } from './sessionToken';

describe('mintToken', () => {
  it('matches the CL-XXXX-XXXX format using the Crockford base32 alphabet', () => {
    const token = mintToken();
    // Crockford base32 alphabet: digits + A-Z minus the ambiguous I, L, O, U.
    const charClass = '[0-9ABCDEFGHJKMNPQRSTVWXYZ]';
    expect(token).toMatch(new RegExp(`^CL-${charClass}{4}-${charClass}{4}$`));
  });

  it('is unique across 1000 calls', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => mintToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe('isExpired', () => {
  const issuedAtMs = 1_000_000;

  it('is false just before the TTL elapses', () => {
    expect(isExpired(issuedAtMs, issuedAtMs + TOKEN_TTL_MS - 1)).toBe(false);
  });

  it('is true exactly at the TTL boundary', () => {
    expect(isExpired(issuedAtMs, issuedAtMs + TOKEN_TTL_MS)).toBe(true);
  });

  it('is true just after the TTL elapses', () => {
    expect(isExpired(issuedAtMs, issuedAtMs + TOKEN_TTL_MS + 1)).toBe(true);
  });

  it('is false immediately after issuance', () => {
    expect(isExpired(issuedAtMs, issuedAtMs)).toBe(false);
  });
});

describe('nextState', () => {
  const allStates: SessionState[] = ['created', 'paired', 'active', 'suspended', 'closed', 'expired'];
  const allEvents: SessionEvent[] = [
    'macro_connected',
    'agent_paired',
    'edit',
    'disconnect',
    'expire',
    'ws_drop',
    'reattach',
  ];

  it('created --macro_connected--> created (still waiting)', () => {
    expect(nextState('created', 'macro_connected')).toBe('created');
  });

  it('created --agent_paired--> paired', () => {
    expect(nextState('created', 'agent_paired')).toBe('paired');
  });

  it('paired --edit--> active', () => {
    expect(nextState('paired', 'edit')).toBe('active');
  });

  it('active --edit--> active', () => {
    expect(nextState('active', 'edit')).toBe('active');
  });

  it.each<SessionState>(['created', 'paired', 'active', 'suspended'])(
    '%s --disconnect--> closed',
    (state) => {
      expect(nextState(state, 'disconnect')).toBe('closed');
    },
  );

  it.each<SessionState>(['created', 'paired'])(
    '%s --expire--> expired',
    (state) => {
      expect(nextState(state, 'expire')).toBe('expired');
    },
  );

  it('invalid events leave the current state unchanged', () => {
    // 'edit' before pairing is invalid.
    expect(nextState('created', 'edit')).toBe('created');
    // re-connecting/re-pairing once already paired or active is invalid.
    expect(nextState('paired', 'macro_connected')).toBe('paired');
    expect(nextState('paired', 'agent_paired')).toBe('paired');
    expect(nextState('active', 'macro_connected')).toBe('active');
    expect(nextState('active', 'agent_paired')).toBe('active');
    // 'expire' once already active is invalid — active sessions don't expire.
    expect(nextState('active', 'expire')).toBe('active');
    // 'reattach' is only valid from 'suspended'.
    expect(nextState('created', 'reattach')).toBe('created');
    expect(nextState('paired', 'reattach')).toBe('paired');
    expect(nextState('active', 'reattach')).toBe('active');
  });

  // --- suspended (design §7 / G-design.md) --------------------------------

  it.each<SessionState>(['created', 'paired', 'active'])(
    '%s --ws_drop--> suspended (accidental disconnect, not the explicit Disconnect button)',
    (state) => {
      expect(nextState(state, 'ws_drop')).toBe('suspended');
    },
  );

  it('suspended --ws_drop--> suspended (already suspended, no-op)', () => {
    expect(nextState('suspended', 'ws_drop')).toBe('suspended');
  });

  it('suspended --reattach--> active (macro reconnects with the same token within the resume window)', () => {
    expect(nextState('suspended', 'reattach')).toBe('active');
  });

  it('suspended --expire--> expired (ttl_expiry: resume window = remaining token TTL, no extension)', () => {
    expect(nextState('suspended', 'expire')).toBe('expired');
  });

  it('suspended --disconnect--> closed (explicit Disconnect while suspended is still the terminal escape hatch)', () => {
    expect(nextState('suspended', 'disconnect')).toBe('closed');
  });

  it('stray macro_connected/agent_paired/edit while suspended are no-ops (ops are rejected, not queued)', () => {
    expect(nextState('suspended', 'macro_connected')).toBe('suspended');
    expect(nextState('suspended', 'agent_paired')).toBe('suspended');
    expect(nextState('suspended', 'edit')).toBe('suspended');
  });

  it('closed is absorbing: every event leaves it unchanged', () => {
    for (const event of allEvents) {
      expect(nextState('closed', event)).toBe('closed');
    }
  });

  it('expired is absorbing: every event leaves it unchanged', () => {
    for (const event of allEvents) {
      expect(nextState('expired', event)).toBe('expired');
    }
  });

  it('every (state, event) pair returns one of the six known states', () => {
    for (const state of allStates) {
      for (const event of allEvents) {
        expect(allStates).toContain(nextState(state, event));
      }
    }
  });
});
