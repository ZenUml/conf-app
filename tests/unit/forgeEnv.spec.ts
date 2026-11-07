import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import forgeGlobal from '@/model/globals/forgeGlobal'
import globals from '@/model/globals'
import { applyForgeEnv, forgeEnv, forgeEnvScope, liteViewerContext, stageForgeEnv } from '../../.storybook/forgeEnv'

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const wrapper = () => globals.apWrapper as any

function renderStory(decorator: ReturnType<typeof forgeEnv>) {
  const decorated = (decorator as any)(() => ({ template: '<i id="inner" />' }), {} as any)
  return mount({ ...decorated, template: '<div><story /></div>', components: { story: { template: '<i />' } } })
}

describe('forgeEnv decorator', () => {
  afterEach(() => {
    delete (forgeGlobal as any).__probe
    delete wrapper().__probeFn
  })

  it('sets forge and apWrapper keys before the story mounts', () => {
    const canUserEdit = async () => true
    const restore = applyForgeEnv({ forge: { isForge: false, isLite: true }, apWrapper: { canUserEdit } })
    expect(forgeGlobal.isForge).toBe(false)
    expect(forgeGlobal.isLite).toBe(true)
    expect(wrapper().canUserEdit).toBe(canUserEdit)
    restore()
  })

  it('restores every touched key on unmount, deleting keys that were absent', () => {
    const forge = forgeGlobal as any
    const w = wrapper()
    forge.isLite = undefined // present, value undefined
    delete forge.__probe // absent
    const protoCanUserEdit = Object.getPrototypeOf(w).canUserEdit
    const beforeForge = { isForge: forge.isForge, isLite: forge.isLite, forgeContext: forge.forgeContext }
    const lite = has(forge, 'isLite')
    const wrapperOwn = has(w, 'canUserEdit')

    const wrapperMount = renderStory(
      forgeEnv({
        forge: { isForge: !forge.isForge, isLite: true, forgeContext: liteViewerContext(), __probe: 1 } as any,
        apWrapper: { canUserEdit: async () => false, __probeFn: () => 1 } as any,
      }),
    )
    expect(forge.__probe).toBe(1)
    expect(w.canUserEdit).not.toBe(protoCanUserEdit)
    wrapperMount.unmount()

    expect(forge.isForge).toBe(beforeForge.isForge)
    expect(forge.isLite).toBe(beforeForge.isLite)
    expect(has(forge, 'isLite')).toBe(lite)
    expect(forge.forgeContext).toBe(beforeForge.forgeContext)
    expect(has(forge, '__probe')).toBe(false)
    expect(has(w, '__probeFn')).toBe(false)
    expect(has(w, 'canUserEdit')).toBe(wrapperOwn)
    expect(w.canUserEdit).toBe(protoCanUserEdit)
  })

  it('does not leak from story A into story B', () => {
    const a = renderStory(forgeEnv({ forge: { isLite: true } }))
    a.unmount()
    const before = (forgeGlobal as any).isLite
    const b = renderStory(forgeEnv({ forge: { isLite: undefined } }))
    b.unmount()
    expect((forgeGlobal as any).isLite).toBe(before)
  })
})

describe('stageForgeEnv + forgeEnvScope', () => {
  it('restores staged keys, including previously absent ones, when the scoped story unmounts', () => {
    const forge = forgeGlobal as any
    const w = wrapper()
    const before = forge.isLite
    delete w.__stagedFn
    // a helper runs inside a story decorator body and stages the env
    stageForgeEnv({ forge: { isLite: !before }, apWrapper: { __stagedFn: () => 1 } })
    stageForgeEnv({ forge: { isLite: 'second' } })
    const scope = (forgeEnvScope as any)(() => ({}), {} as any)
    const m = mount({ ...scope, template: '<div />' })
    expect(forge.isLite).toBe('second')
    m.unmount()
    expect(forge.isLite).toBe(before)
    expect(has(w, '__stagedFn')).toBe(false)
  })
})

describe('liteViewerContext', () => {
  it('builds a Lite viewer context with overridable ids', () => {
    expect(liteViewerContext().accountId).toBe('storybook-user')
    const ctx = liteViewerContext({ pageId: 'p1', accountId: 'u1' })
    expect(ctx.accountId).toBe('u1')
    expect(ctx.extension.content.id).toBe('p1')
  })
})
