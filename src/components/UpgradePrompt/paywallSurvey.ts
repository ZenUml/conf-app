/**
 * Pricing survey shown in the Lite paywall modal when the user asks for an
 * extension. Everything here is pure so the question set, the completeness
 * rule, and the request body can be tested without mounting a component.
 * PaywallSurvey.vue renders from these definitions and holds no copy of its
 * own.
 *
 * The four price questions are a Van Westendorp Price Sensitivity Meter: the
 * four points only mean anything together, which is why an incomplete survey
 * is not worth a grant and Submit stays disabled until all of them are in.
 */
import type { PaywallSurveyQuestion } from '@/utils/analytics/catalog'

/** Analytics question ids, one per answerable field. Kept beside the field
 *  definitions so a new question cannot be added without naming its event
 *  property. Must match the PaywallSurveyQuestion union in the catalog. */
export const SURVEY_QUESTION_ROLE: PaywallSurveyQuestion = 'role'
export const SURVEY_QUESTION_UNIT_MOST: PaywallSurveyQuestion = 'unit_most'
export const SURVEY_QUESTION_UNIT_LEAST: PaywallSurveyQuestion = 'unit_least'
export const SURVEY_QUESTION_BLOCKER: PaywallSurveyQuestion = 'blocker'
export const SURVEY_QUESTION_COMMENT: PaywallSurveyQuestion = 'comment'

/** Endpoint that stores the response and, on a complete submit, grants the
 *  space license. Identity is derived server-side from the Forge token. */
export const SURVEY_ENDPOINT = '/api/paywall-survey'

/** Partial saves are batched: a radio click plus four typed prices would
 *  otherwise be six writes for one visit. */
export const PARTIAL_SAVE_DEBOUNCE_MS = 400

/** Days of editing granted for a completed survey. */
export const SURVEY_REWARD_DAYS = 15

/** Maximum length of the optional free-text comment, matching the backend cap. */
export const SURVEY_COMMENT_MAX_LENGTH = 500

/** Upper bound on a price answer, matching MAX_PRICE_USD in
 *  functions/api/paywall-survey.ts. The client clamps to it rather than letting
 *  the request come back as a 400 the user cannot act on. */
export const SURVEY_MAX_PRICE_USD = 1_000_000

export type SurveyRole = 'space_admin' | 'editor' | 'site_admin' | 'other'
export type SurveyUnit =
  | 'per_space_year'
  | 'per_user_month'
  | 'per_active_author'
  | 'per_diagram'
export type SurveyBlocker =
  | 'budget'
  | 'admin_approval'
  | 'procurement'
  | 'no_owner'
  | 'other'

export interface SurveyAnswers {
  role?: SurveyRole
  /** USD per year. Non-negative integers, ascending in the order listed. */
  priceTooCheap?: number
  priceBargain?: number
  priceExpensive?: number
  priceTooExpensive?: number
  unitMost?: SurveyUnit
  unitLeast?: SurveyUnit
  blocker?: SurveyBlocker
  comment?: string
}

export interface SurveyOption<T extends string> {
  value: T
  label: string
}

export interface SurveyPriceField {
  /** Key on SurveyAnswers. */
  key: 'priceTooCheap' | 'priceBargain' | 'priceExpensive' | 'priceTooExpensive'
  /** Analytics question id for this field. */
  question: PaywallSurveyQuestion
  /** Suffix of the field's data-testid, e.g. survey-price-too-cheap. */
  testId: string
  label: string
}

export const SURVEY_INTRO = (spaceKey: string): string =>
  `Answer 4 quick questions and get ${SURVEY_REWARD_DAYS} more days of editing in ${spaceKey}, for you, right away.`

export const ROLE_QUESTION_LABEL = 'Which describes you best?'
export const ROLE_OPTIONS: SurveyOption<SurveyRole>[] = [
  { value: 'space_admin', label: 'I administer this space' },
  { value: 'editor', label: 'I create or edit diagrams here' },
  { value: 'site_admin', label: 'I administer Confluence apps for the whole site' },
  { value: 'other', label: 'Other' },
]

export const PRICE_QUESTION_LABEL = (spaceKey: string): string =>
  `If unlocking ${spaceKey} for a year were priced at... (USD per year)`
/** Shown under the price grid when the four values are not in ascending order. */
export const PRICE_ORDER_ERROR = 'Each price should be at least the one before it.'

export const PRICE_FIELDS: SurveyPriceField[] = [
  {
    key: 'priceTooCheap',
    question: 'price_too_cheap',
    testId: 'survey-price-too-cheap',
    label: 'Too cheap to trust',
  },
  {
    key: 'priceBargain',
    question: 'price_bargain',
    testId: 'survey-price-bargain',
    label: 'A bargain',
  },
  {
    key: 'priceExpensive',
    question: 'price_expensive',
    testId: 'survey-price-expensive',
    label: 'Getting expensive',
  },
  {
    key: 'priceTooExpensive',
    question: 'price_too_expensive',
    testId: 'survey-price-too-expensive',
    label: 'Too expensive to consider',
  },
]

export const UNIT_QUESTION_LABEL =
  'Which way of paying fits your team best? And which fits worst?'
export const UNIT_MOST_LABEL = 'Fits best'
export const UNIT_LEAST_LABEL = 'Fits worst'
export const UNIT_OPTIONS: SurveyOption<SurveyUnit>[] = [
  { value: 'per_space_year', label: 'Per space, per year' },
  { value: 'per_user_month', label: 'Per Confluence user, per month' },
  { value: 'per_active_author', label: 'Per active diagram author' },
  { value: 'per_diagram', label: 'Per number of diagrams' },
]

export const BLOCKER_QUESTION_LABEL =
  'If your team wanted to lift the limit permanently, what is the hard part internally?'
export const BLOCKER_OPTIONS: SurveyOption<SurveyBlocker>[] = [
  { value: 'budget', label: 'Budget' },
  { value: 'admin_approval', label: 'Admin approval' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'no_owner', label: 'Nobody owns it' },
  { value: 'other', label: 'Other' },
]

export const COMMENT_QUESTION_LABEL = 'Anything else?'

export const SUBMIT_BUTTON_LABEL = `Submit and unlock ${SURVEY_REWARD_DAYS} days`
export const SUBMIT_BUTTON_PENDING_LABEL = 'Submitting...'
export const SKIP_BUTTON_LABEL = 'Skip and request via support instead'
export const SUBMIT_ERROR_MESSAGE =
  'Could not save your answers. Please try again or skip.'

/** A price the backend will accept: a whole number of USD from 0 to the cap. */
function isValidPrice(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= SURVEY_MAX_PRICE_USD
  )
}

/**
 * The four Van Westendorp points must be non-decreasing. Returns true when the
 * order holds OR when any of them is still blank: a half-filled grid is
 * incomplete, not invalid, so the inline error does not fire while typing.
 */
export function priceOrderValid(answers: SurveyAnswers): boolean {
  const values = PRICE_FIELDS.map((field) => answers[field.key])
  if (!values.every(isValidPrice)) return true
  const [tooCheap, bargain, expensive, tooExpensive] = values as number[]
  return tooCheap <= bargain && bargain <= expensive && expensive <= tooExpensive
}

/** Every required answer present, prices well-ordered, and the two payment
 *  units different. Gates the Submit button; the backend re-checks it. */
export function isSurveyComplete(answers: SurveyAnswers): boolean {
  if (!answers.role) return false
  if (!PRICE_FIELDS.every((field) => isValidPrice(answers[field.key]))) return false
  if (!priceOrderValid(answers)) return false
  if (!answers.unitMost || !answers.unitLeast) return false
  if (answers.unitMost === answers.unitLeast) return false
  if (!answers.blocker) return false
  return true
}

/**
 * v4 UUID. Prefers crypto.randomUUID; the fallback keeps the version and
 * variant nibbles so the backend's uuid check passes in the older WebViews
 * and in jsdom, where randomUUID is not always present.
 */
export function newSurveyResponseId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export interface SurveyPayload {
  responseId: string
  spaceKey: string
  macroCount?: number
  appVersion?: string
  answers: SurveyAnswers
  submitted: boolean
}

/**
 * Request body for POST /api/paywall-survey. Blank answers are dropped so a
 * partial save never writes `undefined` over a value the user already gave,
 * and the comment is trimmed and capped at the backend's own limit.
 */
export function buildSurveyPayload(args: {
  responseId: string
  spaceKey: string
  macroCount?: number
  appVersion?: string
  answers: SurveyAnswers
  submitted: boolean
}): SurveyPayload {
  const answers: SurveyAnswers = {}
  if (args.answers.role) answers.role = args.answers.role
  for (const field of PRICE_FIELDS) {
    const value = args.answers[field.key]
    if (isValidPrice(value)) answers[field.key] = value
  }
  if (args.answers.unitMost) answers.unitMost = args.answers.unitMost
  if (args.answers.unitLeast) answers.unitLeast = args.answers.unitLeast
  if (args.answers.blocker) answers.blocker = args.answers.blocker
  const comment = args.answers.comment?.trim()
  if (comment) answers.comment = comment.slice(0, SURVEY_COMMENT_MAX_LENGTH)

  return {
    responseId: args.responseId,
    spaceKey: args.spaceKey,
    ...(args.macroCount !== undefined ? { macroCount: args.macroCount } : {}),
    ...(args.appVersion !== undefined ? { appVersion: args.appVersion } : {}),
    answers,
    submitted: args.submitted,
  }
}
