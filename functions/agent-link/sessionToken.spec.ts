import { describe, it, expect, vi } from 'vitest';
import {
  effectiveExpiryMs,
  isAtCap,
  isExpired,
  IDLE_TTL_MS,
  MAX_SESSION_MS,
  mintToken,
  nextState,
} from './sessionToken';
import type { SessionEvent, SessionState } from './sessionToken';

describe('mintToken', () => {
  it('matches one six-character CL-XXXXXX group using the Crockford base32 alphabet', () => {
    const token = mintToken();
    // Crockford base32 alphabet: digits + A-Z minus the ambiguous I, L, O, U.
    const charClass = '[0-9ABCDEFGHJKMNPQRSTVWXYZ]';
    expect(token).toMatch(new RegExp(`^CL-${charClass}{6}$`));
  });

  it('draws fresh entropy for every six-character code', () => {
    let nextByte = 0;
    const randomValues = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      (array as Uint8Array).fill(nextByte++);
      return array;
    });

    expect(mintToken()).toBe('CL-000000');
    expect(mintToken()).toBe('CL-111111');
    expect(randomValues).toHaveBeenCalledTimes(2);

    randomValues.mockRestore();
  });
});

describe('sliding TTL core (spec 2026-07-13 §3)', () => {
  const T0 = 1_000_000;

  it('pins the user-decided TTL policy values', () => {
    expect(IDLE_TTL_MS).toBe(10 * 60 * 1000);
    expect(MAX_SESSION_MS).toBe(60 * 60 * 1000);
  });

  it('fresh session expires at issuedAt + idle window', () => {
    expect(effectiveExpiryMs(T0, T0)).toBe(T0 + IDLE_TTL_MS);
  });

  it('a bump slides the deadline', () => {
    const bumped = T0 + 5 * 60_000;
    expect(effectiveExpiryMs(T0, bumped)).toBe(bumped + IDLE_TTL_MS);
  });

  it('the absolute cap bounds a fully-active session', () => {
    const lateBump = T0 + 55 * 60_000; // idle window would reach 65 min
    expect(effectiveExpiryMs(T0, lateBump)).toBe(T0 + MAX_SESSION_MS);
    expect(isAtCap(T0, lateBump)).toBe(true);
    expect(isAtCap(T0, T0)).toBe(false);
  });

  it('isExpired honors the slid deadline', () => {
    const bumped = T0 + 5 * 60_000;
    expect(isExpired(T0, bumped, bumped + IDLE_TTL_MS - 1)).toBe(false);
    expect(isExpired(T0, bumped, bumped + IDLE_TTL_MS)).toBe(true);
    // v1 behavior would have expired here (10 min past issue); sliding must not:
    expect(isExpired(T0, bumped, T0 + IDLE_TTL_MS + 1)).toBe(false);
  });

  it('isExpired is clamped by the cap even with continuous bumps', () => {
    const nowAtCap = T0 + MAX_SESSION_MS;
    expect(isExpired(T0, nowAtCap - 1, nowAtCap)).toBe(true);
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
