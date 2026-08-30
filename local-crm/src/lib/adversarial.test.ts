/**
 * Adversarial suite: each test states an invariant the console needs for its own
 * claims to hold, then attacks it with input the code was not written for.
 *
 * Every case here was reproduced against the running console or in the module
 * itself before the test was written. A failure is a finding, not a flake.
 */
import { describe, expect, it } from 'vitest'
import type { Dataset } from '@/data/types'
import { placeholderDataset } from '@/data/placeholder'
import { bareYear, human, iso, isoOrNull, relative, requestedLabel, setBareDateYear } from './format'
import { lifecycleOf, stageLabel } from './lifecycle'
import { crmReducer, INITIAL_CRM_STATE, isKeyForSelected, stampNow } from '@/stores/crm'

const data: Dataset = placeholderDataset

describe('date parsing under hostile input', () => {
  it('rejects a value it cannot parse instead of inventing a day', () => {
    // Observed: iso('unknown') -> '2026-01-unknown', printed as "unknown Jan".
    expect(() => iso('unknown')).toThrow()
    expect(() => iso('')).toThrow()
    expect(() => iso('not a date')).toThrow()
    expect(() => iso('2026-08-30')).toThrow()
  })

  it('rejects a month token it does not know instead of defaulting to January', () => {
    // The console itself renders '30 Sept' through en-GB. Fed back in, the old
    // parser returned 2026-01-30: a September grant read as 30 January.
    expect(() => iso('30 Sept')).toThrow()
  })

  it('rejects nonexistent calendar dates while respecting month length and leap years', () => {
    expect(() => iso('31 Feb')).toThrow()
    expect(() => iso('31 Apr')).toThrow()
    expect(() => iso('29 Feb 23')).toThrow()
    expect(iso('29 Feb 24')).toBe('2024-02-29')
    expect(iso('30 Apr')).toBe('2026-04-30')
    expect(iso('31 Jan')).toBe('2026-01-31')
  })

  it('offers a non-throwing reader for values that may be absent', () => {
    expect(isoOrNull('unknown')).toBeNull()
    expect(isoOrNull('27 Aug 25')).toBe('2025-08-27')
  })

  it('round-trips every date it prints', () => {
    for (const value of ['27 Aug', '01 Sep', '26 Nov 25', '31 Dec 27']) {
      expect(human(iso(value))).toBe(value)
    }
  })

  it('never prints NaN to the operator', () => {
    expect(relative('not-a-day', data.today)).not.toContain('NaN')
  })

  it('keeps the year on a request from another year', () => {
    // 5 of 36 open JSM requests are 2025 rows. Rendered without a year they read
    // as this year's requests: ZEN-1157 (2025-04-07) showed "requested 07 Apr".
    expect(requestedLabel('2025-04-07T00:54:27.292Z')).toBe('07 Apr 25')
    expect(requestedLabel('2026-05-25T00:00:00.000Z')).toBe('25 May')
    expect(requestedLabel(null)).toBeNull()
    expect(requestedLabel('2025-02-31T00:00:00.000Z')).toBeNull()
  })

  it('prints one month vocabulary everywhere', () => {
    // en-GB writes September as 'Sept'; the rest of the console writes 'Sep'.
    expect(requestedLabel('2025-09-30T00:00:00.000Z')).toBe('30 Sep 25')
  })

  it('reads bare dates against the dataset year, not a literal in the formatter', () => {
    expect(bareYear()).toBe(data.today.slice(0, 4))
    try {
      setBareDateYear('2027')
      expect(iso('27 Aug')).toBe('2027-08-27')
      expect(human('2027-08-27')).toBe('27 Aug')
      expect(human('2026-08-27')).toBe('27 Aug 26')
    } finally {
      setBareDateYear(data.today.slice(0, 4))
    }
  })

  it('refuses a year value that is not a year', () => {
    expect(() => setBareDateYear('26')).toThrow()
  })
})

describe('lifecycle', () => {
  it('does not render the ingest run stages for a grant case with no grant', () => {
    const view = lifecycleOf(data, 'granted', null)
    expect(view.stages.map(stage => stage.name)).not.toContain('read')
    expect(view.stalled).toBe(true)
  })

  it('refuses an unknown case kind instead of picking a lifecycle for it', () => {
    expect(() => lifecycleOf(data, 'nonsense' as never, null)).toThrow()
  })

  it('does not label a completed stage as the current position', () => {
    // A grant that has not expired yet has no `now` stage at all. The old label
    // read 'detected · 1 of 8' — a stage the case finished.
    const view = {
      stalled: false,
      branches: '',
      stages: [
        { name: 'detected', state: 'done' as const, note: '' },
        { name: 'needs-evidence', state: 'todo' as const, note: '' },
        { name: 'resolved', state: 'todo' as const, note: '' }
      ]
    }
    expect(stageLabel(view)).toBe('needs-evidence · 2 of 3')
  })

  it('does not crash on an empty stage list', () => {
    expect(() => stageLabel({ stalled: false, branches: '', stages: [] })).not.toThrow()
  })
})

describe('action confirmation', () => {
  it('does not let a repeated click on the same button serve as its own confirmation', () => {
    // Reproduced in the running console: two clicks on the "Apply" CTA stamped
    // `done · 30 Aug 2026 18:11 · peng.xiao` with the confirm strip untouched.
    const armed = crmReducer(INITIAL_CRM_STATE, {
      type: 'run',
      key: 'ingest:migrate',
      needsConfirm: true,
      stamp: 'stamp-1'
    })
    expect(armed.confirming).toBe('ingest:migrate')

    const clickedAgain = crmReducer(armed, {
      type: 'run',
      key: 'ingest:migrate',
      needsConfirm: true,
      stamp: 'stamp-2'
    })
    expect(clickedAgain.done['ingest:migrate']).toBeUndefined()
    expect(clickedAgain.confirming).toBe('ingest:migrate')
  })

  it('stamps only on the confirm control', () => {
    const armed = crmReducer(INITIAL_CRM_STATE, {
      type: 'run',
      key: 'ingest:migrate',
      needsConfirm: true,
      stamp: 'stamp-1'
    })
    const confirmed = crmReducer(armed, {
      type: 'confirm',
      key: 'ingest:migrate',
      stamp: 'stamp-2'
    })
    expect(confirmed.done['ingest:migrate']).toBe('stamp-2')
    expect(confirmed.confirming).toBeNull()
  })

  it('ignores a confirmation for a key that was never armed', () => {
    const state = crmReducer(INITIAL_CRM_STATE, {
      type: 'confirm',
      key: 'ingest:migrate',
      stamp: 'stamp-1'
    })
    expect(state.done).toEqual({})
  })

  it('runs an action only for the case that is open', () => {
    expect(isKeyForSelected('grant:g1:created', 'grant:g1:created:revoke')).toBe(true)
    expect(isKeyForSelected('grant:g1:created', 'grant:g2:created:revoke')).toBe(false)
    expect(isKeyForSelected(null, 'grant:g1:created:revoke')).toBe(false)
  })
})

describe('audit stamp', () => {
  it('records the instant the operator ran the action, not the dataset date', () => {
    // The stamp was built from data.today plus the local clock: reading a
    // dataset extracted earlier filed every action under the extraction date.
    // Local components: the stamp reads the operator's own clock, so a UTC
    // literal would move the date under a runner in another timezone.
    const stamp = stampNow('peng.xiao', new Date(2026, 2, 4, 5, 6, 7))
    expect(stamp).toBe('04 Mar 2026 05:06 · peng.xiao')
  })
})
