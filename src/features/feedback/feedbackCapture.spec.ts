import { afterEach, describe, expect, it } from 'vitest'

import { feedbackCaptureTarget } from './feedbackCapture'

describe('feedbackCaptureTarget', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('selects the diagram capture surface instead of its #app ancestor', () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="screen-capture-content">diagram</div>
        <div id="zenuml-feedback-host">feedback controls</div>
      </div>
    `

    expect(feedbackCaptureTarget()).toBe(document.querySelector('.screen-capture-content'))
  })
})
