import { describe, it, expect } from 'vitest'
import { isSavedRefusalTitle, visibleDiagramTitle } from './aiTitleGuard.js'

// Saved titles are not model replies: a person may have typed them, so this
// check is narrower than looksLikeTitle. Every case below is invented. The
// refusal shapes follow the replies the model gave before PR #1053, cut to 80
// characters as they were saved; none is a stored customer title.
const SAVED_REFUSALS = [
  'Please provide the DSL that describes your flowchart and I will suggest a tit',
  'Please share the DSL (Domain-Specific Language) for this diagram so I can help',
  "I'm ready to help. Which DSL describes the diagram you would like me to name?",
  "I'm happy to help you pick a title for this flowchart diagram.",
  'I’m ready to help. What DSL describes the flowchart diagram you have in mind',
  "I don't see a DSL in the text you sent. Could you please share it so I can",
  "I'll need the DSL that describes the flowchart before I can write a title fo",
  "Unfortunately, I don't see any DSL in your message. Please share it and I'll",
  'Unfortunately, the text you sent does not contain a DSL (Domain-Specific Lan',
  "You didn't include a DSL or any details about the diagram. Can you share it",
  'You want me to write a title for a flowchart based on the DSL (Domain Specif',
  "Based on the DSL, I can't tell what the flowchart diagram is meant to show.",
  "Based on the provided text, I'll need you to share the DSL (Domain-Specific",
  'What is the DSL that describes this flowchart diagram?',
  'To create a title, I need the DSL that describes the diagram you are drawing.',
  'However, I need the DSL to write a title for this flowchart diagram.',
]

const PERSON_TITLES = [
  'DSL',
  'DSL Parser Flow',
  'How I parse the DSL',
  'What does the DSL do?',
  'Based on the DSL parser output, the billing pipeline end to end',
  'Order DSL compiler pipeline for the payments team in region two',
  'Please provide feedback flow for the onboarding survey team',
  'Why do we need retries?',
  'Here is the checkout flow',
  'Title search flow',
  'You and I flow',
  'Payment Service',
  'I/O DSL adapter for the payments ledger service and its consumers',
  '',
]

describe('isSavedRefusalTitle', () => {
  it.each(SAVED_REFUSALS)('flags a saved refusal: %s', (title) => {
    expect(isSavedRefusalTitle(title)).toBe(true)
  })

  it.each(PERSON_TITLES)('keeps a title a person could type: %s', (title) => {
    expect(isSavedRefusalTitle(title)).toBe(false)
  })

  it('treats a missing title as not a refusal', () => {
    expect(isSavedRefusalTitle(undefined)).toBe(false)
    expect(isSavedRefusalTitle(null)).toBe(false)
  })
})

describe('visibleDiagramTitle', () => {
  it('hides a saved refusal and keeps every other title as stored', () => {
    expect(visibleDiagramTitle(SAVED_REFUSALS[0])).toBe('')
    expect(visibleDiagramTitle('Order Service')).toBe('Order Service')
    expect(visibleDiagramTitle(undefined)).toBe('')
  })
})
