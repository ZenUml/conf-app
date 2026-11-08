// @vitest-environment-options {"url":"https://github.com/example-owner/example-repo/pull/7"}
import { describe, expect, it, vi } from 'vitest'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import type { HubFrame, ReviewGroup } from '@zenuml/pr-panel-shared'
const wire = vi.hoisted(() => ({ receive: undefined as undefined | ((f: HubFrame) => void) }))
vi.mock('../bridge/port', () => ({
 documentId: 'origin', envelope: (body: unknown) => body,
 PanelPort: class {
 onStatus() {} onFrame(fn: (f: HubFrame) => void) { wire.receive = fn }
 connect() {} disconnect() {} send() { return true } post() {}
 }
}))
import { createPageController } from './controller'
describe('delayed native result', () => {
 it('does not re-arm navigation after the user soft-navigates to another PR', async () => {
 document.body.innerHTML = '<nav aria-label="Repository"></nav><turbo-frame id="repo-content-turbo-frame"></turbo-frame>'
 const ctx = new ContentScriptContext('github'); const controller = createPageController(ctx); await controller.start()
 const pr = { host: 'github.com', owner: 'example-owner', repo: 'example-repo', number: 7 }
 const group: ReviewGroup = { groupId: 'g1', product: 'Example', requestedCount: 2, status: 'ready', createdAt: 1, updatedAt: 2,
 items: [7,8].map(number => ({ pr: { ...pr, number }, decisionTitle: 'PR '+number, ci: 'success', materialHeadSha: 'aaaaaaa', materialUpdatedAt: 1, outcome: number === 7 ? 'merged' : 'pending' })) }
 controller.store.applyFrame({ v:1, id:'g', ts:1, type:'group', group, preparation:null })
 const url = new URL('https://github.com/example-owner/example-repo/pull/99')
 history.pushState(null, '', url)
 document.getElementById('repo-content-turbo-frame')!.append(document.createElement('div'))
 await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
 expect(controller.store.state.pr?.number).toBe(99)
 const timers = vi.spyOn(globalThis, 'setTimeout')
 wire.receive!({ v:1, id:'late', ts:2, type:'reviewItemResult', groupId:'g1', pr, outcome:'merged', source:'native', documentId:'origin' })
 expect(timers.mock.calls.filter(call => call[1] === 3000)).toHaveLength(0)
 expect(document.querySelector('zenuml-pr-list')).toBeNull()
 ctx.notifyInvalidated(); timers.mockRestore()
 })
})
