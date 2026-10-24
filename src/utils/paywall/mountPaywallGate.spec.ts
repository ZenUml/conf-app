import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram'

// Verifies `paywall_gate_evaluated` (#302 fail-open instrumentation) fires on
// every Lite gate decision — blocked OR not — carrying gate_fired +
// macro_count_source, and is suppressed on non-Lite variants.

const fakeCS = {
  initialize: vi.fn().mockResolvedValue(undefined),
  shouldBlockActions: { value: false },
  macrosCreated: { value: 0 },
  macroCountSource: { value: 'undefined' as string },
  cssEnabled: { value: true },
  paywallPolicySource: { value: 'default_on' as 'default_on' | 'exemption' | 'fail_open' },
  spacePaid: { value: false },
  spacePaidSource: { value: undefined as 'user_license' | 'space_license' | undefined },
  spaceKey: { value: 'OVERLIMIT' },
  upgradeUrl: { value: 'https://upgrade' },
  enterpriseBundleUrl: { value: 'https://bundle' },
}

vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => fakeCS,
  MACROS_LIMIT: 100,
  getUpgradeContext: () => ({
    macro_count: fakeCS.macrosCreated.value,
    macro_limit: 100,
    macro_usage_pct: 0,
    space_key: 'OVERLIMIT',
  }),
}))

vi.mock('@/utils/upgradeTracking', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return { ...actual, trackUpgradeEvent: vi.fn() }
})

vi.mock('@/mount-root', () => ({ mountRoot: vi.fn() }))

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isLite: vi.fn().mockReturnValue(true),
      getCurrentSpace: vi.fn().mockResolvedValue({ key: 'OVERLIMIT', id: '123' }),
    },
  },
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { accountId: 'acc-1' } },
  getView: vi.fn().mockResolvedValue({ close: vi.fn() }),
  isFullscreenMode: vi.fn().mockResolvedValue(false),
  isEditorMode: vi.fn().mockResolvedValue(false),
  getContext: vi.fn().mockResolvedValue({ extension: {} }),
}))

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn().mockReturnValue('example-tenant'),
}))

const StubContent = { name: 'StubContent', template: '<div/>' }

async function imports() {
  const gate = await import('./mountPaywallGate')
  const { trackUpgradeEvent, UpgradeEventName } = await import('@/utils/upgradeTracking')
  return { gate, trackUpgradeEvent: vi.mocked(trackUpgradeEvent), UpgradeEventName }
}

function gateEvalCall(trackUpgradeEvent: ReturnType<typeof vi.fn>, name: string) {
  return trackUpgradeEvent.mock.calls.find((c: any[]) => c[0] === name)
}

describe('paywall_gate_evaluated (#302 instrumentation)', () => {
  // isLite is restored here because 'does NOT fire on a non-Lite variant' flips
  // it to false and vi.clearAllMocks() does not undo mockReturnValue. Without
  // this every test appended after it silently sees a non-Lite app and the gate
  // emits nothing — which reads as a broken assertion, not a leaked mock.
  beforeEach(async () => {
    vi.clearAllMocks()
    const globals = (await import('@/model/globals')).default
    vi.mocked(globals.apWrapper.isLite).mockReturnValue(true)
    fakeCS.shouldBlockActions.value = false
    fakeCS.macrosCreated.value = 0
    fakeCS.macroCountSource.value = 'undefined'
    fakeCS.paywallPolicySource.value = 'default_on'
    fakeCS.spacePaid.value = false
    fakeCS.spacePaidSource.value = undefined
  })

  it('fires with gate_fired=false + fail-open source on an ungated create mount', async () => {
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    const result = await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    expect(result).toBe(false) // gate did not fire → editor mounts ungated
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call).toBeTruthy()
    expect(call![1]).toMatchObject({
      gate_fired: false,
      macro_count_source: 'undefined',
      action_type: 'page_editor_create',
      is_lite: true,
      surface: 'editor',
    })
  })

  it('fires with gate_fired=true when the read succeeds over-limit', async () => {
    fakeCS.shouldBlockActions.value = true
    fakeCS.macrosCreated.value = 150
    fakeCS.macroCountSource.value = 'kv'
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    const result = await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    expect(result).toBe(true)
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call![1]).toMatchObject({ gate_fired: true, macro_count_source: 'kv', macro_count: 150 })
  })

  it('fires on the fullscreen-viewer path with action_type=fullscreen_viewer', async () => {
    const forge = await import('@/model/globals/forgeGlobal')
    vi.mocked(forge.isFullscreenMode).mockResolvedValue(true)
    vi.mocked(forge.isEditorMode).mockResolvedValue(false)
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryFullscreenViewerPaywall({ doc: undefined, content: StubContent, macroKind: 'sequence' })
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call![1]).toMatchObject({ action_type: 'fullscreen_viewer', surface: 'viewer', gate_fired: false })
  })

  it('carries space_paid_scope from the customer-success service (user_license)', async () => {
    fakeCS.spacePaid.value = true
    fakeCS.spacePaidSource.value = 'user_license'
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call![1]).toMatchObject({ space_paid_scope: 'user_license' })
  })

  it('carries space_paid_scope from the customer-success service (space_license)', async () => {
    fakeCS.spacePaid.value = true
    fakeCS.spacePaidSource.value = 'space_license'
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call![1]).toMatchObject({ space_paid_scope: 'space_license' })
  })

  it('reports paywall_policy_source: default_on on a blocking default-on decision', async () => {
    fakeCS.shouldBlockActions.value = true
    fakeCS.macrosCreated.value = 150
    fakeCS.macroCountSource.value = 'kv'
    fakeCS.paywallPolicySource.value = 'default_on'
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call![1]).toMatchObject({ paywall_policy_source: 'default_on', gate_fired: true })
  })

  it('reports paywall_policy_source: exemption on a non-blocking explicit exemption', async () => {
    fakeCS.shouldBlockActions.value = false
    fakeCS.macrosCreated.value = 150
    fakeCS.macroCountSource.value = 'kv'
    fakeCS.paywallPolicySource.value = 'exemption'
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call![1]).toMatchObject({ paywall_policy_source: 'exemption', gate_fired: false })
  })

  it('reports paywall_policy_source: fail_open on a non-blocking unavailable decision', async () => {
    fakeCS.shouldBlockActions.value = false
    fakeCS.macrosCreated.value = 0
    fakeCS.macroCountSource.value = 'undefined'
    fakeCS.paywallPolicySource.value = 'fail_open'
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call![1]).toMatchObject({ paywall_policy_source: 'fail_open', gate_fired: false })
  })

  it('still carries css_enabled alongside the new policy source', async () => {
    fakeCS.cssEnabled.value = true
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    const call = gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)
    expect(call![1]).toMatchObject({ css_enabled: true, paywall_policy_source: 'default_on' })
  })

  it('does NOT fire on a non-Lite variant', async () => {
    const globals = (await import('@/model/globals')).default
    vi.mocked(globals.apWrapper.isLite).mockReturnValue(false)
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: 'cc-1',
    })
    expect(gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)).toBeUndefined()
  })

  it('hands a blocked page editor continuation callback to PaywallGate', async () => {
    fakeCS.shouldBlockActions.value = true
    fakeCS.macrosCreated.value = 150
    const onContinueEditing = vi.fn()
    const { gate } = await imports()

    const fired = await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM,
      content: StubContent,
      macroKind: 'sequence',
      customContentId: undefined,
      // Added by the fix: this must remain dormant until an explicit
      // PaywallGate `continue-editing` event, never run merely because the
      // editor mounted behind the modal.
      onContinueEditing,
    })

    expect(fired).toBe(true)
    const [, , props] = vi.mocked(await import('@/mount-root')).mountRoot.mock.calls.at(-1)!
    expect(props.onContinueEditing).toBe(onContinueEditing)
  })
})

// The byline's "Add a diagram" opens the ORDINARY editor
// (openModal({ macroMode: 'editor' })) with no customContentId, so it lands in
// tryPageEditorPaywall's create branch and is gated by the same predicate as an
// insert-menu create. That is emergent from modal fall-through rather than
// stated anywhere, and this branch has already broken moduleKey-based routing
// twice — so it is pinned here, both that it BLOCKS and that it is LABELLED.
describe('byline create surface', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    fakeCS.shouldBlockActions.value = false
    fakeCS.macrosCreated.value = 0
    fakeCS.macroCountSource.value = 'undefined'
    fakeCS.spacePaid.value = false
    fakeCS.spacePaidSource.value = undefined
    const globals = (await import('@/model/globals')).default
    vi.mocked(globals.apWrapper.isLite).mockReturnValue(true)
    const forge = await import('@/model/globals/forgeGlobal')
    vi.mocked(forge.isFullscreenMode).mockResolvedValue(false)
    vi.mocked(forge.isEditorMode).mockResolvedValue(false)
    vi.mocked(forge.getContext).mockResolvedValue({ extension: {} } as any)
  })

  async function asBylineModal() {
    const forge = await import('@/model/globals/forgeGlobal')
    vi.mocked(forge.getContext).mockResolvedValue({
      extension: { modal: { macroMode: 'editor', origin: 'byline' } },
    } as any)
  }

  it('BLOCKS a byline create on an over-limit space', async () => {
    await asBylineModal()
    fakeCS.shouldBlockActions.value = true
    fakeCS.macrosCreated.value = 150
    const { gate } = await imports()
    const fired = await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    // true ⟹ the caller early-returns and the editor mounts under PaywallGate.
    expect(fired).toBe(true)
  })

  it('labels the block byline_create / surface byline, not page_editor_create', async () => {
    await asBylineModal()
    fakeCS.shouldBlockActions.value = true
    fakeCS.macrosCreated.value = 150
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    expect(gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)![1])
      .toMatchObject({ action_type: 'byline_create', surface: 'byline', gate_fired: true })
    // The blocked + triggered events must agree, or the funnel splits.
    for (const name of [UpgradeEventName.PAYWALL_BLOCKED_CREATE, UpgradeEventName.PAYWALL_TRIGGERED]) {
      expect(gateEvalCall(trackUpgradeEvent, name)![1]).toMatchObject({ action_type: 'byline_create' })
    }
  })

  it('tags the fail-open case too, so a byline create that slips through is visible', async () => {
    await asBylineModal()
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    const fired = await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    expect(fired).toBe(false)
    expect(gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)![1])
      .toMatchObject({ action_type: 'byline_create', gate_fired: false })
  })

  it('leaves the insert-menu create labelled page_editor_create', async () => {
    fakeCS.shouldBlockActions.value = true
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    expect(gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)![1])
      .toMatchObject({ action_type: 'page_editor_create', surface: 'editor' })
  })

  it('an EDIT from the byline stays page_editor — origin only splits creates', async () => {
    await asBylineModal()
    fakeCS.shouldBlockActions.value = true
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: '999',
    })
    expect(gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)![1])
      .toMatchObject({ action_type: 'page_editor' })
  })

  it('a context read that throws must not decide whether the gate runs', async () => {
    const forge = await import('@/model/globals/forgeGlobal')
    vi.mocked(forge.getContext).mockRejectedValue(new Error('bridge unavailable'))
    fakeCS.shouldBlockActions.value = true
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    const fired = await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: undefined,
    })
    expect(fired).toBe(true) // still blocked
    expect(gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)![1])
      .toMatchObject({ action_type: 'page_editor_create' }) // degrades to the old label
  })
})
