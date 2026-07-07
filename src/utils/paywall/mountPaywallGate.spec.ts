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
  spacePaid: { value: false },
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
  beforeEach(() => {
    vi.clearAllMocks()
    fakeCS.shouldBlockActions.value = false
    fakeCS.macrosCreated.value = 0
    fakeCS.macroCountSource.value = 'undefined'
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

  it('does NOT fire on a non-Lite variant', async () => {
    const globals = (await import('@/model/globals')).default
    vi.mocked(globals.apWrapper.isLite).mockReturnValue(false)
    const { gate, trackUpgradeEvent, UpgradeEventName } = await imports()
    await gate.tryPageEditorPaywall({
      doc: NULL_DIAGRAM, content: StubContent, macroKind: 'sequence', customContentId: 'cc-1',
    })
    expect(gateEvalCall(trackUpgradeEvent, UpgradeEventName.PAYWALL_GATE_EVALUATED)).toBeUndefined()
  })
})
