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

    it('timeout --disconnect--> closed', () => {
      expect(nextClientState('timeout', 'disconnect')).toBe('closed')
    })
  })

  describe('nextClientState — invalid events leave state unchanged', () => {
    const cases: Array<[AgentLinkClientState, AgentLinkClientEvent]> = [
      ['idle', 'session_created'],
      ['idle', 'agent_connected'],
      ['idle', 'timeout'],
      ['idle', 'disconnect'],
      ['waiting', 'connect_clicked'],
      ['timeout', 'connect_clicked'],
      ['timeout', 'session_created'],
      ['timeout', 'timeout'],
      ['connected', 'connect_clicked'],
      ['connected', 'session_created'],
      ['connected', 'agent_connected'],
      ['connected', 'timeout'],
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
    ]

    it.each(allEvents)('closed + %s stays closed', (event) => {
      expect(nextClientState('closed', event)).toBe('closed')
    })
  })
})
