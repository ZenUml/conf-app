import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

/**
 * The survey is the price of a 15-day extension, so the tests that matter are
 * the ones protecting the trade: an incomplete survey must not buy a grant,
 * the four price points must be usable as a Van Westendorp series, and the
 * free-text comment must never reach analytics.
 */

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))

vi.mock('@/utils/upgradeTracking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/upgradeTracking')>()
  return { ...actual, trackUpgradeEvent: vi.fn() }
})

vi.mock('@/composables/useCustomerSuccessService', () => ({
  getUpgradeContext: () => ({ macro_count: 147, macro_limit: 100, space_key: 'ENG' }),
}))

import PaywallSurvey from './PaywallSurvey.vue'
import { callRemote } from '@/utils/requestUtil'
import { trackUpgradeEvent } from '@/utils/upgradeTracking'
import {
  PARTIAL_SAVE_DEBOUNCE_MS,
  PRICE_ORDER_ERROR,
  SUBMIT_ERROR_MESSAGE,
  SURVEY_MAX_PRICE_USD,
  isSurveyComplete,
  newSurveyResponseId,
  priceOrderValid,
} from './paywallSurvey'

const COMPLETE_ANSWERS = {
  role: 'editor' as const,
  priceTooCheap: 50,
  priceBargain: 200,
  priceExpensive: 600,
  priceTooExpensive: 1500,
  unitMost: 'per_space_year' as const,
  unitLeast: 'per_diagram' as const,
  blocker: 'budget' as const,
}

function mountSurvey(props: Record<string, unknown> = {}) {
  return mount(PaywallSurvey, {
    props: { spaceKey: 'ENG', macroCount: 147, ...props },
  })
}

async function fillComplete(wrapper: VueWrapper) {
  await wrapper.find('[data-testid="survey-role-editor"]').setValue()
  await wrapper.find('[data-testid="survey-price-too-cheap"]').setValue('50')
  await wrapper.find('[data-testid="survey-price-bargain"]').setValue('200')
  await wrapper.find('[data-testid="survey-price-expensive"]').setValue('600')
  await wrapper.find('[data-testid="survey-price-too-expensive"]').setValue('1500')
  await wrapper.find('[data-testid="survey-unit-most-per_space_year"]').setValue()
  await wrapper.find('[data-testid="survey-unit-least-per_diagram"]').setValue()
  await wrapper.find('[data-testid="survey-blocker-budget"]').setValue()
}

function trackedCalls(name: string) {
  return vi.mocked(trackUpgradeEvent).mock.calls.filter((c) => c[0] === name)
}

describe('paywallSurvey completeness rules', () => {
  it('rejects a survey missing any required answer', () => {
    expect(isSurveyComplete(COMPLETE_ANSWERS)).toBe(true)
    for (const key of Object.keys(COMPLETE_ANSWERS)) {
      const partial = { ...COMPLETE_ANSWERS, [key]: undefined }
      expect(isSurveyComplete(partial), `${key} must be required`).toBe(false)
    }
  })

  it('requires the four prices to be non-decreasing', () => {
    expect(priceOrderValid(COMPLETE_ANSWERS)).toBe(true)
    expect(priceOrderValid({ ...COMPLETE_ANSWERS, priceBargain: 10 })).toBe(false)
    expect(isSurveyComplete({ ...COMPLETE_ANSWERS, priceBargain: 10 })).toBe(false)
    // Equal adjacent points are a legitimate answer, not a mistake.
    expect(priceOrderValid({ ...COMPLETE_ANSWERS, priceBargain: 50 })).toBe(true)
  })

  it('treats a half-filled price grid as incomplete, not invalid', () => {
    const partial = { ...COMPLETE_ANSWERS, priceTooExpensive: undefined }
    expect(priceOrderValid(partial)).toBe(true)
    expect(isSurveyComplete(partial)).toBe(false)
  })

  it('rejects the same payment unit as both best and worst', () => {
    expect(
      isSurveyComplete({ ...COMPLETE_ANSWERS, unitLeast: 'per_space_year' })
    ).toBe(false)
  })

  it('rejects a negative or fractional price', () => {
    expect(isSurveyComplete({ ...COMPLETE_ANSWERS, priceTooCheap: -1 })).toBe(false)
    expect(isSurveyComplete({ ...COMPLETE_ANSWERS, priceBargain: 200.5 })).toBe(false)
    // Zero is a real answer to "too cheap to trust".
    expect(isSurveyComplete({ ...COMPLETE_ANSWERS, priceTooCheap: 0 })).toBe(true)
  })

  it('rejects a price above the cap the backend enforces', () => {
    expect(
      isSurveyComplete({ ...COMPLETE_ANSWERS, priceTooExpensive: SURVEY_MAX_PRICE_USD })
    ).toBe(true)
    expect(
      isSurveyComplete({ ...COMPLETE_ANSWERS, priceTooExpensive: SURVEY_MAX_PRICE_USD + 1 })
    ).toBe(false)
  })

  it('mints a LOWERCASE v4 response id, the only shape the backend accepts', () => {
    // functions/api/paywall-survey.ts pins /^[0-9a-f]{8}-.../ with no /i.
    const id = newSurveyResponseId()
    expect(id).toBe(id.toLowerCase())
  })

  it('mints a v4-shaped response id', () => {
    const id = newSurveyResponseId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })
})

describe('PaywallSurvey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(callRemote).mockResolvedValue({
      ok: true,
      responseId: 'r1',
      submitted: false,
      grant: 'none',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks paywall_survey_shown on mount with the reward and the surface', () => {
    mountSurvey({ actionType: 'page_editor' })

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_survey_shown',
      expect.objectContaining({
        ui_component: 'modal',
        survey_reward_days: 15,
        action_type: 'page_editor',
        macro_count: 147,
      })
    )
  })

  it('keeps Submit disabled until every required answer is in', async () => {
    const wrapper = mountSurvey()
    const submit = () =>
      wrapper.find('[data-testid="survey-submit-btn"]').element as HTMLButtonElement

    expect(submit().disabled).toBe(true)
    await wrapper.find('[data-testid="survey-role-editor"]').setValue()
    expect(submit().disabled).toBe(true)

    await fillComplete(wrapper)
    expect(submit().disabled).toBe(false)
  })

  it('shows the order message and blocks Submit when the prices descend', async () => {
    const wrapper = mountSurvey()
    await fillComplete(wrapper)
    expect(wrapper.find('[data-testid="survey-price-error"]').exists()).toBe(false)

    await wrapper.find('[data-testid="survey-price-bargain"]').setValue('10')

    expect(wrapper.find('[data-testid="survey-price-error"]').text()).toBe(PRICE_ORDER_ERROR)
    expect(
      (wrapper.find('[data-testid="survey-submit-btn"]').element as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('disables the worst-fit option that is already picked as best fit', async () => {
    const wrapper = mountSurvey()
    await wrapper.find('[data-testid="survey-unit-most-per_space_year"]').setValue()

    const conflicting = wrapper.find('[data-testid="survey-unit-least-per_space_year"]')
      .element as HTMLInputElement
    expect(conflicting.disabled).toBe(true)
    expect(
      (wrapper.find('[data-testid="survey-unit-least-per_diagram"]').element as HTMLInputElement)
        .disabled
    ).toBe(false)
  })

  it('clears a worst-fit pick that is later chosen as best fit', async () => {
    const wrapper = mountSurvey()
    await fillComplete(wrapper)

    // per_diagram was the worst fit; making it the best fit must drop it.
    await wrapper.find('[data-testid="survey-unit-most-per_diagram"]').setValue()

    expect(
      (wrapper.find('[data-testid="survey-unit-least-per_diagram"]').element as HTMLInputElement)
        .checked
    ).toBe(false)
    expect(
      (wrapper.find('[data-testid="survey-submit-btn"]').element as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('tracks a chosen option as survey_answer, keyed by question', async () => {
    const wrapper = mountSurvey()
    await wrapper.find('[data-testid="survey-role-site_admin"]').setValue()

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_survey_answered',
      expect.objectContaining({ survey_question: 'role', survey_answer: 'site_admin' })
    )

    await wrapper.find('[data-testid="survey-blocker-procurement"]').setValue()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_survey_answered',
      expect.objectContaining({ survey_question: 'blocker', survey_answer: 'procurement' })
    )
  })

  it('tracks a typed price as survey_answer_number, once the value settles', async () => {
    vi.useFakeTimers()
    const wrapper = mountSurvey()
    await wrapper.find('[data-testid="survey-price-bargain"]').setValue('1')
    await wrapper.find('[data-testid="survey-price-bargain"]').setValue('19')
    await wrapper.find('[data-testid="survey-price-bargain"]').setValue('199')

    // Debounced, so the half-typed 1 and 19 never become price answers.
    expect(trackedCalls('paywall_survey_answered')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(PARTIAL_SAVE_DEBOUNCE_MS)

    const calls = trackedCalls('paywall_survey_answered')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({
      survey_question: 'price_bargain',
      survey_answer_number: 199,
    })
    expect(calls[0][1]).not.toHaveProperty('survey_answer')
  })

  it('tracks every price typed within one debounce window, not just the last field edited', async () => {
    // Regression test: schedulePartialSave() used to take a per-call `onFlush`
    // closure, so editing a second field before the first field's debounce
    // fired replaced (and lost) the first field's closure. Typing all four
    // price points in quick succession used to emit only the last one.
    vi.useFakeTimers()
    const wrapper = mountSurvey()
    await wrapper.find('[data-testid="survey-price-too-cheap"]').setValue('50')
    await wrapper.find('[data-testid="survey-price-bargain"]').setValue('150')
    await wrapper.find('[data-testid="survey-price-expensive"]').setValue('400')
    await wrapper.find('[data-testid="survey-price-too-expensive"]').setValue('800')

    expect(trackedCalls('paywall_survey_answered')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(PARTIAL_SAVE_DEBOUNCE_MS)

    const calls = trackedCalls('paywall_survey_answered')
    expect(calls).toHaveLength(4)
    const byQuestion = Object.fromEntries(
      calls.map((c) => [(c[1] as { survey_question: string }).survey_question, c[1]])
    )
    expect(Object.keys(byQuestion).sort()).toEqual(
      ['price_bargain', 'price_expensive', 'price_too_cheap', 'price_too_expensive'].sort()
    )
    expect(byQuestion.price_too_cheap).toMatchObject({ survey_answer_number: 50 })
    expect(byQuestion.price_bargain).toMatchObject({ survey_answer_number: 150 })
    expect(byQuestion.price_expensive).toMatchObject({ survey_answer_number: 400 })
    expect(byQuestion.price_too_expensive).toMatchObject({ survey_answer_number: 800 })
  })

  it('flushes a price answered event before submitting, even when submit follows a keystroke immediately', async () => {
    vi.mocked(callRemote).mockResolvedValue({
      ok: true,
      responseId: 'r1',
      submitted: true,
      grant: 'granted',
    })
    const wrapper = mountSurvey()
    await fillComplete(wrapper)
    // Real timers, no advance: the 400ms debounce for the last-typed price
    // (priceTooExpensive) has not fired yet when Submit is clicked.
    await wrapper.find('[data-testid="survey-submit-btn"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const allCalls = vi.mocked(trackUpgradeEvent).mock.calls
    const answeredIndex = allCalls.findIndex(
      (c) =>
        c[0] === 'paywall_survey_answered' &&
        (c[1] as { survey_question: string }).survey_question === 'price_too_expensive'
    )
    const submittedIndex = allCalls.findIndex((c) => c[0] === 'paywall_survey_submitted')

    expect(answeredIndex).toBeGreaterThanOrEqual(0)
    expect(allCalls[answeredIndex][1]).toMatchObject({
      survey_question: 'price_too_expensive',
      survey_answer_number: 1500,
    })
    expect(submittedIndex).toBeGreaterThan(answeredIndex)
  })

  it('clamps an over-cap price in the field itself rather than earning a 400', async () => {
    vi.useFakeTimers()
    const wrapper = mountSurvey()
    const field = wrapper.find('[data-testid="survey-price-too-expensive"]')
    await field.setValue(String(SURVEY_MAX_PRICE_USD * 20))
    await vi.advanceTimersByTimeAsync(PARTIAL_SAVE_DEBOUNCE_MS)

    expect((field.element as HTMLInputElement).value).toBe(String(SURVEY_MAX_PRICE_USD))
    expect(vi.mocked(callRemote).mock.calls[0][2]).toMatchObject({
      answers: { priceTooExpensive: SURVEY_MAX_PRICE_USD },
    })
  })

  it('never sends the comment text to analytics', async () => {
    vi.useFakeTimers()
    const secret = 'we are moving to a competitor next quarter'
    const wrapper = mountSurvey()
    await wrapper.find('[data-testid="survey-comment"]').setValue(secret)
    await vi.advanceTimersByTimeAsync(PARTIAL_SAVE_DEBOUNCE_MS)

    const answered = trackedCalls('paywall_survey_answered')
    expect(answered).toHaveLength(1)
    expect(answered[0][1]).toMatchObject({ survey_question: 'comment' })
    expect(JSON.stringify(vi.mocked(trackUpgradeEvent).mock.calls)).not.toContain(secret)
    // It does reach the backend, which is the whole point of asking.
    expect(vi.mocked(callRemote).mock.calls[0][2]).toMatchObject({
      answers: { comment: secret },
    })
  })

  it('debounces the partial save into one POST with submitted false', async () => {
    vi.useFakeTimers()
    const wrapper = mountSurvey()
    await wrapper.find('[data-testid="survey-role-editor"]').setValue()
    await wrapper.find('[data-testid="survey-blocker-budget"]').setValue()
    await wrapper.find('[data-testid="survey-price-bargain"]').setValue('200')

    expect(callRemote).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(PARTIAL_SAVE_DEBOUNCE_MS)

    expect(callRemote).toHaveBeenCalledTimes(1)
    const [endpoint, method, body] = vi.mocked(callRemote).mock.calls[0]
    expect(endpoint).toBe('/api/paywall-survey')
    expect(method).toBe('POST')
    expect(body).toMatchObject({
      spaceKey: 'ENG',
      macroCount: 147,
      submitted: false,
      answers: { role: 'editor', blocker: 'budget', priceBargain: 200 },
    })
    expect(body.responseId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('swallows a failed partial save, which is not the user problem', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(callRemote).mockRejectedValue(new Error('HTTP 500: boom'))

    const wrapper = mountSurvey()
    await wrapper.find('[data-testid="survey-role-editor"]').setValue()
    await vi.advanceTimersByTimeAsync(PARTIAL_SAVE_DEBOUNCE_MS)

    expect(wrapper.find('[data-testid="survey-error"]').exists()).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('submits with submitted true, emits the grant, and tracks it', async () => {
    vi.mocked(callRemote).mockResolvedValue({
      ok: true,
      responseId: 'server-id',
      submitted: true,
      grant: 'granted',
      expiresAt: '2026-09-18T00:00:00.000Z',
    })
    const wrapper = mountSurvey({ actionType: 'page_editor_create' })
    await fillComplete(wrapper)
    await wrapper.find('[data-testid="survey-submit-btn"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const submitCall = vi
      .mocked(callRemote)
      .mock.calls.find((c) => (c[2] as { submitted: boolean }).submitted)
    expect(submitCall?.[2]).toMatchObject({
      submitted: true,
      spaceKey: 'ENG',
      answers: COMPLETE_ANSWERS,
    })

    const emitted = wrapper.emitted('submitted')
    expect(emitted).toHaveLength(1)
    expect(emitted?.[0][0]).toMatchObject({
      grant: 'granted',
      expiresAt: '2026-09-18T00:00:00.000Z',
    })

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_survey_submitted',
      expect.objectContaining({ survey_grant: 'granted', survey_reward_days: 15 })
    )
  })

  it('cancels a pending partial save so the submit is the only write', async () => {
    vi.useFakeTimers()
    const wrapper = mountSurvey()
    await fillComplete(wrapper)
    await wrapper.find('[data-testid="survey-submit-btn"]').trigger('click')
    await vi.advanceTimersByTimeAsync(PARTIAL_SAVE_DEBOUNCE_MS * 3)

    expect(callRemote).toHaveBeenCalledTimes(1)
    expect((vi.mocked(callRemote).mock.calls[0][2] as { submitted: boolean }).submitted).toBe(true)
  })

  it('shows the retry copy and tracks survey_grant error when the submit fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(callRemote).mockRejectedValue(new Error('HTTP 409: already_submitted'))
    const wrapper = mountSurvey()
    await fillComplete(wrapper)
    await wrapper.find('[data-testid="survey-submit-btn"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="survey-error"]').text()).toBe(SUBMIT_ERROR_MESSAGE)
    expect(wrapper.emitted('submitted')).toBeFalsy()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_survey_submitted',
      expect.objectContaining({ survey_grant: 'error' })
    )
    // Still submittable: the user can retry or skip.
    expect(
      (wrapper.find('[data-testid="survey-submit-btn"]').element as HTMLButtonElement).disabled
    ).toBe(false)
    warn.mockRestore()
  })

  it('emits skipped with the response id and tracks the skip', async () => {
    const wrapper = mountSurvey()
    await wrapper.find('[data-testid="survey-skip-btn"]').trigger('click')

    const emitted = wrapper.emitted('skipped')
    expect(emitted).toHaveLength(1)
    expect(emitted?.[0][0]).toMatch(/^[0-9a-f-]{36}$/i)
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_survey_skipped',
      expect.objectContaining({ ui_component: 'modal', space_key: 'ENG' })
    )
  })

  it('names the space and the reward in the intro so the trade is explicit', () => {
    const wrapper = mountSurvey({ spaceKey: 'ARCH' })
    expect(wrapper.text()).toContain('get 15 more days of editing in ARCH')
  })
})
