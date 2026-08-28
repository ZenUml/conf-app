import { describe, it, expect } from 'vitest'
import {
  nextClientState,
  SETUP_TIMEOUT_MS,
  type AgentLinkClientState,
  type AgentLinkClientEvent,
} from './agentLinkState'

describe('agentLinkState', () => {
  it('exports the 20s setup-timeout constant', () => {
    expect(SETUP_TIMEOUT_MS).toBe(20000)
  })

  describe('nextClientState — valid transitions', () => {
    it('idle --connect_clicked--> waiting', () => {
      expect(nextClientState('idle', 'connect_clicked')).toBe('waiting')
    })

    it('waiting --session_created--> waiting (self-loop)', () => {
      expect(nextClientState('waiting', 'session_created')).toBe('waiting')
    })

    it('waiting --agent_connected--> connected', () => {
      expect(nextClientState('waiting', 'agent_connected')).toBe('connected')
    })

    it('waiting --timeout--> timeout', () => {
      expect(nextClientState('waiting', 'timeout')).toBe('timeout')
    })

    it('timeout --agent_connected--> connected', () => {
      expect(nextClientState('timeout', 'agent_connected')).toBe('connected')
    })

    it('connected --disconnect--> closed', () => {
      expect(nextClientState('connected', 'disconnect')).toBe('closed')
    })

    it('waiting --disconnect--> closed', () => {
      expect(nextClientState('waiting', 'disconnect')).toBe('closed')
    })

    it('waiting --mint_rejected--> already_linked', () => {
      expect(nextClientState('waiting', 'mint_rejected')).toBe('already_linked')
    })

    it('waiting --mint_failed--> failed', () => {
      expect(nextClientState('waiting', 'mint_failed')).toBe('failed')
    })

    it('timeout --disconnect--> closed', () => {
      expect(nextClientState('timeout', 'disconnect')).toBe('closed')
    })

    it('timeout --mint_rejected--> already_linked (late 409 after setup timer)', () => {
      expect(nextClientState('timeout', 'mint_rejected')).toBe('already_linked')
    })

    it('timeout --mint_failed--> failed (late mint failure after setup timer)', () => {
      expect(nextClientState('timeout', 'mint_failed')).toBe('failed')
    })

    it('connected --ws_drop--> suspended (accidental disconnect, not the explicit Disconnect button)', () => {
      expect(nextClientState('connected', 'ws_drop')).toBe('suspended')
    })

    it('suspended --resumed--> connected (same-token reattach succeeded)', () => {
      expect(nextClientState('suspended', 'resumed')).toBe('connected')
    })

    it('suspended --reconnect_failed--> recovery_exhausted', () => {
      expect(nextClientState('suspended', 'reconnect_failed')).toBe('recovery_exhausted')
    })

    it('waiting/timeout --protocol_incompatible--> incompatible', () => {
      expect(nextClientState('waiting', 'protocol_incompatible')).toBe('incompatible')
      expect(nextClientState('timeout', 'protocol_incompatible')).toBe('incompatible')
    })

    it('suspended --disconnect--> closed (explicit Disconnect while suspended)', () => {
      expect(nextClientState('suspended', 'disconnect')).toBe('closed')
    })

    // #314 — the client-side TTL watchdog fires 'expired' from any state that
    // still has a live (or pending) session; idle/closed/already_linked/failed
    // have no session to expire, so 'expired' is a no-op there (see the
    // no-op cases below).
    it('waiting --expired--> expired (token TTL lapsed before an agent paired)', () => {
      expect(nextClientState('waiting', 'expired')).toBe('expired')
    })

    it('timeout --expired--> expired (token TTL lapsed after the setup timer)', () => {
      expect(nextClientState('timeout', 'expired')).toBe('expired')
    })

    it('connected --expired--> expired (token TTL lapsed while paired)', () => {
      expect(nextClientState('connected', 'expired')).toBe('expired')
    })

    it('suspended --expired--> expired (token TTL lapsed during a drop)', () => {
      expect(nextClientState('suspended', 'expired')).toBe('expired')
    })

    it('expired --disconnect--> closed (explicit close/re-link out of expired)', () => {
      expect(nextClientState('expired', 'disconnect')).toBe('closed')
    })
  })

  describe('nextClientState — invalid events leave state unchanged', () => {
    const cases: Array<[AgentLinkClientState, AgentLinkClientEvent]> = [
      ['idle', 'session_created'],
      ['idle', 'agent_connected'],
      ['idle', 'timeout'],
      ['idle', 'disconnect'],
      ['idle', 'mint_rejected'],
      ['idle', 'mint_failed'],
      ['idle', 'ws_drop'],
      ['idle', 'resumed'],
      ['idle', 'expired'],
      ['idle', 'reconnect_failed'],
      ['idle', 'protocol_incompatible'],
      ['waiting', 'connect_clicked'],
      ['waiting', 'ws_drop'],
      ['waiting', 'resumed'],
      ['waiting', 'reconnect_failed'],
      ['timeout', 'connect_clicked'],
      ['timeout', 'session_created'],
      ['timeout', 'timeout'],
      ['timeout', 'ws_drop'],
      ['timeout', 'resumed'],
      ['timeout', 'reconnect_failed'],
      ['connected', 'connect_clicked'],
      ['connected', 'session_created'],
      ['connected', 'agent_connected'],
      ['connected', 'timeout'],
      ['connected', 'mint_rejected'],
      ['connected', 'mint_failed'],
      ['connected', 'resumed'],
      ['connected', 'reconnect_failed'],
      ['connected', 'protocol_incompatible'],
      ['suspended', 'connect_clicked'],
      ['suspended', 'session_created'],
      ['suspended', 'agent_connected'],
      ['suspended', 'timeout'],
      ['suspended', 'mint_rejected'],
      ['suspended', 'mint_failed'],
      ['suspended', 'ws_drop'],
      ['suspended', 'protocol_incompatible'],
      ['already_linked', 'connect_clicked'],
      ['already_linked', 'session_created'],
      ['already_linked', 'agent_connected'],
      ['already_linked', 'timeout'],
      ['already_linked', 'disconnect'],
      ['already_linked', 'mint_rejected'],
      ['already_linked', 'mint_failed'],
      ['already_linked', 'ws_drop'],
      ['already_linked', 'resumed'],
      ['already_linked', 'expired'],
      ['failed', 'connect_clicked'],
      ['failed', 'session_created'],
      ['failed', 'agent_connected'],
      ['failed', 'timeout'],
      ['failed', 'disconnect'],
      ['failed', 'mint_rejected'],
      ['failed', 'mint_failed'],
      ['failed', 'ws_drop'],
      ['failed', 'resumed'],
      ['failed', 'expired'],
    ]

    it.each(cases)('%s + %s is a no-op', (current, event) => {
      expect(nextClientState(current, event)).toBe(current)
    })
  })

  describe('closed is absorbing', () => {
    const allEvents: AgentLinkClientEvent[] = [
      'connect_clicked',
      'session_created',
      'agent_connected',
      'timeout',
      'disconnect',
      'mint_rejected',
      'mint_failed',
      'ws_drop',
      'resumed',
      'reconnect_failed',
      'protocol_incompatible',
      'expired',
    ]

    it.each(allEvents)('closed + %s stays closed', (event) => {
      expect(nextClientState('closed', event)).toBe('closed')
    })
  })
})
