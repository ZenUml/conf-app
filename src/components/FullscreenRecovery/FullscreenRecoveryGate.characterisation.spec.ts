import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FullscreenRecoveryGate from './FullscreenRecoveryGate.vue'
import FullscreenRecoveryStatus from './FullscreenRecoveryStatus.vue'
import { fullLocalDate } from './recoveryPresentation'
import type { RecoverySnapshot } from '../../../shared/fullscreenRecovery'
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

// Characterisation of today's Fullscreen copy and DOM, with `feature` omitted.
// Scoped-style hashes depend on the file path, so they are stripped.
const html = (wrapper: ReturnType<typeof mount>) => wrapper.html().replace(/ data-v-[0-9a-f]+=""/g, '')
const base = { state: 'not_requested', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1' } as const satisfies RecoverySnapshot
const request = { id: 'FS-001', scenarios: ['present', 'other'], note: 'about the roadmap', email: 'reader@example.com', createdAt: base.serverNow, mailState: 'queued' } as const

describe('FullscreenRecoveryGate copy, feature omitted', () => {
  it('scenarios view', () => {
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot: base } })
    expect(wrapper.text()).toContain('ZenUML Lite · Fullscreen')
    expect(wrapper.get('h1').text()).toBe('How will you use Fullscreen?')
    expect(wrapper.get('.recovery__lead').text()).toBe('This space has reached the free limit of 100 diagrams. Tell us what you need. After your request is saved, you can use Fullscreen for 7 days starting with your first successful opening.')
    expect(wrapper.findAll('.recovery__choice').map(label => label.text())).toEqual([
      'Inspect details on my own', 'Present this diagram to others', 'Discuss it with colleagues', 'Something else',
    ])
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Contact support', 'Plan and usage', 'Back to diagram'])
    expect(html(wrapper)).toMatchInlineSnapshot(`
      "<section class="recovery" aria-labelledby="recovery-title" data-testid="fullscreen-recovery-gate">
        <div class="recovery__eyebrow">ZenUML Lite · Fullscreen</div>
        <h1 id="recovery-title">How will you use Fullscreen?</h1>
        <p class="recovery__lead">This space has reached the free limit of 100 diagrams. Tell us what you need. After your request is saved, you can use Fullscreen for 7 days starting with your first successful opening.</p>
        <fieldset class="recovery__fieldset">
          <legend>Choose one or more</legend> <label class="recovery__choice"><input type="checkbox" value="inspect_details"> <span>Inspect details on my own</span></label><label class="recovery__choice"><input type="checkbox" value="present"> <span>Present this diagram to others</span></label><label class="recovery__choice"><input type="checkbox" value="discuss"> <span>Discuss it with colleagues</span></label><label class="recovery__choice"><input type="checkbox" value="other"> <span>Something else</span></label>
        </fieldset>
        <details class="recovery__details">
          <summary>Additional context (optional)</summary> <label class="recovery__label" for="recovery-note">Anything that would help us understand your use</label> <textarea id="recovery-note" rows="3" maxlength="2000"></textarea>
        </details>
        <div class="recovery__actions"><button type="button" class="recovery__primary" disabled="">Contact support</button> <button type="button" class="recovery__secondary">Plan and usage</button></div> <button type="button" class="recovery__link">Back to diagram</button>
      </section>"
    `)
  })

  it('contact view', async () => {
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot: base, initialScenarios: ['present', 'discuss'] } })
    await wrapper.get('button.recovery__primary').trigger('click')
    expect(wrapper.get('h1').text()).toBe('Contact support')
    expect(wrapper.text()).toContain("We'll reply about this Fullscreen request at the address you provide.")
    expect(wrapper.text()).toContain('Current Confluence site, diagram reference, and your Fullscreen use.')
    expect(wrapper.text()).toContain('Use: Present this diagram to others, Discuss it with colleagues')
    expect(html(wrapper)).toMatchInlineSnapshot(`
      "<section class="recovery" aria-labelledby="recovery-title" data-testid="fullscreen-recovery-gate">
        <div class="recovery__eyebrow">ZenUML Lite · Fullscreen</div>
        <h1 id="recovery-title">Contact support</h1>
        <p class="recovery__lead">We'll reply about this Fullscreen request at the address you provide.</p>
        <div class="recovery__context"><strong>Included with your request</strong>
          <p>Current Confluence site, diagram reference, and your Fullscreen use.</p>
          <p>Use: Present this diagram to others, Discuss it with colleagues</p>
          <!--v-if-->
        </div>
        <form id="recovery-form"><label class="recovery__label" for="recovery-email">Reply email</label> <input id="recovery-email" type="email" autocomplete="email" inputmode="email" maxlength="254" required=""> <label class="recovery__consent"><input type="checkbox" required=""> <span>I agree that support may use this email to reply about this request.</span></label>
          <p class="recovery__subtle">A repeated request keeps the original access period.</p>
          <!--v-if-->
          <div class="recovery__actions"><button class="recovery__primary" type="submit" disabled="">Submit request</button> <button class="recovery__secondary" type="button">Back</button></div>
        </form> <button type="button" class="recovery__link">Back to diagram</button>
      </section>"
    `)
  })

  it('ready view', () => {
    const snapshot: RecoverySnapshot = { ...base, state: 'pending_activation', request, grant: { id: 'g', activatedAt: null, expiresAt: null } }
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot } })
    expect(wrapper.get('h1').text()).toBe('Fullscreen is ready')
    expect(wrapper.get('.recovery__lead').text()).toBe('Your 7 days have not started. They begin when the diagram first opens successfully in Fullscreen.')
    expect(wrapper.get('button.recovery__primary').text()).toBe('Open Fullscreen')
    expect(html(wrapper)).toMatchInlineSnapshot(`
      "<section class="recovery" aria-labelledby="recovery-title" data-testid="fullscreen-recovery-gate">
        <div class="recovery__eyebrow">ZenUML Lite · Fullscreen</div> <span class="recovery__badge">Request FS-001 saved</span>
        <h1 id="recovery-title">Fullscreen is ready</h1>
        <p class="recovery__lead">Your 7 days have not started. They begin when the diagram first opens successfully in Fullscreen.</p>
        <div class="summary" aria-label="Fullscreen request summary">
          <dl>
            <dt>Request reference</dt>
            <dd>FS-001</dd>
            <dt>Original use</dt>
            <dd>Present this diagram to others, Something else</dd>
            <dt>Additional context</dt>
            <dd>about the roadmap</dd>
            <dt>Reply email</dt>
            <dd>reader@example.com</dd>
          </dl>
        </div>
        <div class="recovery__actions"><button type="button" class="recovery__primary">Open Fullscreen</button> <button type="button" class="recovery__secondary">Maybe later</button></div>
      </section>"
    `)
  })

  it('ready view uses a supplied open label', () => {
    const snapshot: RecoverySnapshot = { ...base, state: 'pending_activation', request, grant: { id: 'g', activatedAt: null, expiresAt: null } }
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot, openLabel: 'Go' } })
    expect(wrapper.get('button.recovery__primary').text()).toBe('Go')
  })

  it('expired view', () => {
    const snapshot: RecoverySnapshot = { ...base, state: 'expired', request, grant: { id: 'g', activatedAt: '2026-10-15T00:00:00Z', expiresAt: null } }
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot } })
    expect(wrapper.get('h1').text()).toBe('Your temporary Fullscreen access has ended')
    expect(html(wrapper)).toMatchInlineSnapshot(`
      "<section class="recovery" aria-labelledby="recovery-title" data-testid="fullscreen-recovery-gate">
        <div class="recovery__eyebrow">ZenUML Lite · Fullscreen</div>
        <h1 id="recovery-title">Your temporary Fullscreen access has ended</h1>
        <p class="recovery__lead">It ended . You can still read the diagram on this page.</p>
        <p>Still need Fullscreen? Continue your existing request. You don't need to repeat your use case.</p>
        <div class="recovery__actions"><button type="button" class="recovery__primary">Continue the conversation</button> <button type="button" class="recovery__secondary">Plan and usage</button></div> <button type="button" class="recovery__link">Back to diagram</button>
      </section>"
    `)
  })

  it('request view, reply not yet sent, with support mailto', () => {
    const snapshot: RecoverySnapshot = { ...base, state: 'pending_activation', supportEmail: 'support@example.com', request, grant: { id: 'g', activatedAt: null, expiresAt: null } }
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot, initialView: 'request' } })
    expect(wrapper.get('a').attributes('href')).toBe('mailto:support@example.com?subject=Fullscreen%20request%20FS-001')
    expect(html(wrapper)).toMatchInlineSnapshot(`
      "<section class="recovery" aria-labelledby="recovery-title" data-testid="fullscreen-recovery-gate">
        <div class="recovery__eyebrow">ZenUML Lite · Fullscreen</div> <span class="recovery__badge">Request FS-001</span>
        <h1 id="recovery-title">Continue this request</h1>
        <div class="summary" aria-label="Fullscreen request summary">
          <dl>
            <dt>Request reference</dt>
            <dd>FS-001</dd>
            <dt>Original use</dt>
            <dd>Present this diagram to others, Something else</dd>
            <dt>Additional context</dt>
            <dd>about the roadmap</dd>
            <dt>Reply email</dt>
            <dd>reader@example.com</dd>
          </dl>
        </div>
        <p class="recovery__status">Your request is saved. Support has not sent a reply yet.</p>
        <p>Your 7 days begin when the diagram first opens successfully in Fullscreen.</p>
        <p>When support replies, you can continue in the same email thread. No new request form is needed.</p>
        <p>Can't find the email? <a href="mailto:support@example.com?subject=Fullscreen%20request%20FS-001">Email support</a> with reference FS-001.</p>
        <div class="recovery__actions"><button type="button" class="recovery__primary">Open Fullscreen</button> <button type="button" class="recovery__secondary">Back to diagram</button></div>
      </section>"
    `)
  })

  it('request view, original email delivered', () => {
    const snapshot: RecoverySnapshot = { ...base, state: 'pending_activation', request: { ...request, mailState: 'delivered' }, grant: { id: 'g', activatedAt: null, expiresAt: null } }
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot, initialView: 'request' } })
    expect(html(wrapper)).toMatchInlineSnapshot(`
      "<section class="recovery" aria-labelledby="recovery-title" data-testid="fullscreen-recovery-gate">
        <div class="recovery__eyebrow">ZenUML Lite · Fullscreen</div> <span class="recovery__badge">Request FS-001</span>
        <h1 id="recovery-title">Continue this request</h1>
        <div class="summary" aria-label="Fullscreen request summary">
          <dl>
            <dt>Request reference</dt>
            <dd>FS-001</dd>
            <dt>Original use</dt>
            <dd>Present this diagram to others, Something else</dd>
            <dt>Additional context</dt>
            <dd>about the roadmap</dd>
            <dt>Reply email</dt>
            <dd>reader@example.com</dd>
          </dl>
        </div>
        <p class="recovery__status">Support has sent a reply. You do not need to reply just to confirm receipt.</p>
        <p>Your 7 days begin when the diagram first opens successfully in Fullscreen.</p>
        <p>If you still need Fullscreen, reply to the original email and tell us what you need to do next. Support will review it. A reply does not automatically extend access.</p>
        <!--v-if-->
        <div class="recovery__actions"><button type="button" class="recovery__primary">Open Fullscreen</button> <button type="button" class="recovery__secondary">Back to diagram</button></div>
      </section>"
    `)
  })
})

describe('FullscreenRecoveryStatus copy, feature omitted', () => {
  const grant = { id: 'g', activatedAt: null }
  it('pending, active and expired messages and buttons', () => {
    const expiresAt = '2026-10-31T00:00:00Z'
    const when = fullLocalDate(expiresAt)
    const pending = mount(FullscreenRecoveryStatus, { props: { snapshot: { ...base, state: 'pending_activation' } } })
    expect(pending.text()).toBe('Your 7 days of Fullscreen begin when the diagram first opens successfully.')
    const active = mount(FullscreenRecoveryStatus, { props: { snapshot: { ...base, state: 'active', grant: { ...grant, expiresAt } } } })
    expect(active.text()).toBe(`Temporary Fullscreen access ends ${when}. Continue request`)
    const expired = mount(FullscreenRecoveryStatus, { props: { snapshot: { ...base, state: 'expired', grant: { ...grant, expiresAt } } } })
    expect(expired.text()).toBe(`Temporary Fullscreen access ended ${when}. This open view can continue; access is checked next time you open Fullscreen. Continue request Dismiss`)
    expect(expired.get('button[aria-label]').attributes('aria-label')).toBe('Dismiss Fullscreen access notice')
    expect(html(expired).replace(when ?? '', '<date>')).toMatchInlineSnapshot(`"<aside class="status" role="status" aria-live="polite" data-testid="fullscreen-recovery-status"><span>Temporary Fullscreen access ended <date>. This open view can continue; access is checked next time you open Fullscreen.</span> <button type="button">Continue request</button> <button type="button" aria-label="Dismiss Fullscreen access notice">Dismiss</button></aside>"`)
  })
})
