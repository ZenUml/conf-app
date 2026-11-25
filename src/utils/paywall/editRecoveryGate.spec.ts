import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram'

// The editor entry point and the edit request gate (spec examples E1-E9, client side).
// The server decides; the client only renders what it is told.
const recoveryMount = vi.hoisted(() => vi.fn().mockResolvedValue('handled'))
vi.mock('./fullscreenRecoveryGate', () => ({ mountFullscreenRecovery: recoveryMount, observeOrdinaryFullscreenReady: vi.fn() }))

const fakeCS = {
  initialize: vi.fn().mockResolvedValue(undefined),
  shouldBlockActions: { value: false },
  editRequestGateApplies: { value: true },
  createRequestGateApplies: { value: true },
  macrosCreated: { value: 2282 }, macroCountSource: { value: 'kv' },
  cssEnabled: { value: true }, paywallPolicySource: { value: 'default_on' },
  spacePaid: { value: false }, spacePaidStatusKnown: { value: true }, spacePaidSource: { value: undefined },
  spaceKey: { value: 'ENG' }, upgradeUrl: { value: 'u' }, enterpriseBundleUrl: { value: 'b' },
}
vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => fakeCS, MACROS_LIMIT: 100, getUpgradeContext: () => ({}),
}))
vi.mock('@/utils/upgradeTracking', async (importOriginal) => ({ ...(await importOriginal() as object), trackUpgradeEvent: vi.fn() }))
vi.mock('@/mount-root', () => ({ mountRoot: vi.fn() }))
vi.mock('@/model/globals', () => ({ default: { apWrapper: { isLite: vi.fn().mockReturnValue(true), getCurrentSpace: vi.fn().mockResolvedValue({ key: 'ENG' }) } } }))
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { accountId: 'acc-1' } }, getView: vi.fn(), isFullscreenMode: vi.fn().mockResolvedValue(false),
  isEditorMode: vi.fn().mockResolvedValue(false), getContext: vi.fn().mockResolvedValue({ extension: {} }),
}))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({ getClientDomain: vi.fn().mockReturnValue('example-tenant') }))

const Content = { name: 'Editor', template: '<div/>' }
const open = async (customContentId: string | undefined, onContinueEditing = vi.fn()) => {
  const { tryPageEditorPaywall } = await import('./mountPaywallGate')
  return { result: await tryPageEditorPaywall({ doc: NULL_DIAGRAM, content: Content, macroKind: 'sequence', customContentId, onContinueEditing }), onContinueEditing }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeCS.editRequestGateApplies.value = true
  fakeCS.createRequestGateApplies.value = true
  recoveryMount.mockResolvedValue('handled')
  vi.mocked((await import('@/model/globals')).default.apWrapper.isLite).mockReturnValue(true)
})

describe('Click Edit on an existing diagram', () => {
  it('E1/E2/E4: the server says the gate applies -> the recovery gate with feature edit replaces the editor', async () => {
    const { result, onContinueEditing } = await open('cc-1')
    expect(result).toBe(true)
    expect(recoveryMount).toHaveBeenCalledWith(expect.objectContaining({ feature: 'edit', editTarget: 'existing_diagram', spaceKey: 'ENG', content: Content, onOpen: onContinueEditing }))
  })
  it('E3: an active grant (the server answers "disabled") -> the ordinary editor', async () => {
    recoveryMount.mockResolvedValue('disabled')
    expect((await open('cc-1')).result).toBe(false)
  })
  it('E5: the lookup fails or times out -> the editor opens (fail open)', async () => {
    recoveryMount.mockResolvedValue('unavailable')
    expect((await open('cc-1')).result).toBe(false)
    recoveryMount.mockRejectedValue(new Error('boom'))
    expect((await open('cc-1')).result).toBe(false)
  })
  it('E6/E7: no edit effect from the server (Full, Diagramly, watermark, block_create) -> no lookup at all', async () => {
    fakeCS.editRequestGateApplies.value = false
    expect((await open('cc-1')).result).toBe(false)
    expect(recoveryMount).not.toHaveBeenCalled()
    vi.mocked((await import('@/model/globals')).default.apWrapper.isLite).mockReturnValue(false)
    fakeCS.editRequestGateApplies.value = true
    expect((await open('cc-1')).result).toBe(false)
    expect(recoveryMount).not.toHaveBeenCalled()
  })
})

describe('Create a new diagram', () => {
  it('site at block_create or later -> the same edit request gate, tagged as a new diagram', async () => {
    fakeCS.editRequestGateApplies.value = false
    const { result, onContinueEditing } = await open(undefined)
    expect(result).toBe(true)
    expect(recoveryMount).toHaveBeenCalledWith(expect.objectContaining({ feature: 'edit', editTarget: 'new_diagram', spaceKey: 'ENG', onOpen: onContinueEditing }))
  })
  it('an active edit grant opens the editor; a failed lookup opens it too', async () => {
    recoveryMount.mockResolvedValue('disabled')
    expect((await open(undefined)).result).toBe(false)
    recoveryMount.mockRejectedValue(new Error('boom'))
    expect((await open(undefined)).result).toBe(false)
  })
  it('no create effect (notice, watermark, Full, Diagramly) -> no lookup', async () => {
    fakeCS.createRequestGateApplies.value = false
    expect((await open(undefined)).result).toBe(false)
    vi.mocked((await import('@/model/globals')).default.apWrapper.isLite).mockReturnValue(false)
    fakeCS.createRequestGateApplies.value = true
    expect((await open(undefined)).result).toBe(false)
    expect(recoveryMount).not.toHaveBeenCalled()
  })
})
