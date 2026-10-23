import { beforeEach, describe, expect, it, vi } from 'vitest'

// #939: the canonical analytics record (R2 archive + D1 fact) must not depend
// on the endpoint's other side effects succeeding first.

const mocks = vi.hoisted(() => ({
  postData: vi.fn(),
  saveToBucket: vi.fn(),
  upsertForgeInstallation: vi.fn(),
  captureError: vi.fn(),
  put: vi.fn(),
  run: vi.fn(),
}))

vi.mock('../../functions/utils/zaraz', () => ({ postData: mocks.postData }))
vi.mock('../../functions/utils/R2Bucket', () => ({ saveToBucket: mocks.saveToBucket }))
vi.mock('../../functions/utils/dbUtils', () => ({ upsertForgeInstallation: mocks.upsertForgeInstallation }))
vi.mock('../../functions/utils/authenticate', () => ({ validateContextToken: vi.fn(async () => ({})) }))
vi.mock('../../functions/utils/sentry', () => ({
  captureError: mocks.captureError,
  captureUninstalledMessage: vi.fn(),
}))

import { onRequest as uninstalled } from '../../functions/uninstalled'
import { onRequest as forgeInstalled } from '../../functions/forge-installed'
import { recordAnalyticsEvent, normalizeUninstallAnalyticsEvent } from '../../functions/utils/analytics'

// Fake bindings: R2 `put` is the archive, D1 `prepare().bind().run()` the fact insert.
const env = {
  DB: { prepare: () => ({ bind: (...args: unknown[]) => ({ run: () => mocks.run(...args) }) }) },
  EVENT_BUCKET: { put: (...args: unknown[]) => mocks.put(...args) },
  ALLOWED_FORGE_APP_IDS: 'app-1',
}
/** The D1 fact's r2Key column is the last bound parameter. */
const insertedR2Key = () => mocks.run.mock.calls[0].at(-1)

async function call(handler: (ctx: any) => Promise<Response>, body: unknown) {
  const pending: Promise<unknown>[] = []
  const request = new Request('https://example.test/x', {
    method: 'POST',
    headers: { Authorization: 'Bearer fit-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await handler({ request, env, waitUntil: (p: Promise<unknown>) => pending.push(p) })
  await Promise.allSettled(pending)
  return res
}

const UNINSTALL = { eventType: 'uninstalled', key: 'app-key', clientKey: 'client-1', baseUrl: 'https://example.atlassian.net/wiki' }
const INSTALL = { app: { id: 'app-1' }, context: { cloudId: 'cloud-1' }, installerAccountId: 'u-1' }

describe('analytics ingest endpoints (#939)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.put.mockResolvedValue(undefined)
    mocks.run.mockResolvedValue({ success: true })
    mocks.saveToBucket.mockResolvedValue(undefined)
    mocks.upsertForgeInstallation.mockResolvedValue(undefined)
  })

  it('uninstalled records the D1 fact even when the Zaraz call fails', async () => {
    mocks.postData.mockRejectedValue(new Error('zaraz down'))
    const res = await call(uninstalled, UNINSTALL)
    expect(res.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(insertedR2Key()).toEqual(expect.stringContaining('.json'))
  })

  it('uninstalled does not wait for a slow Zaraz call before responding', async () => {
    mocks.postData.mockReturnValue(new Promise(() => {}))
    const pending: Promise<unknown>[] = []
    const request = new Request('https://example.test/x', {
      method: 'POST',
      headers: { Authorization: 'Bearer fit-token' },
      body: JSON.stringify(UNINSTALL),
    })
    const res = await uninstalled({ request, env, waitUntil: (p: Promise<unknown>) => pending.push(p) } as any)
    expect(res.status).toBe(200)
  })

  it('forge-installed records the D1 fact even when the installation upsert fails', async () => {
    mocks.upsertForgeInstallation.mockRejectedValue(new Error('D1 busy'))
    const res = await call(forgeInstalled, INSTALL)
    expect(res.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.captureError).toHaveBeenCalled()
  })
})

describe('recordAnalyticsEvent (#939)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('still inserts the fact, without an R2 key, when the archive fails', async () => {
    mocks.put.mockRejectedValue(new Error('R2 down'))
    mocks.run.mockResolvedValue({ success: true })
    const pending: Promise<unknown>[] = []
    const event = normalizeUninstallAnalyticsEvent(UNINSTALL)
    recordAnalyticsEvent({ waitUntil: (p) => pending.push(p) }, env as any, event, UNINSTALL)
    await Promise.allSettled(pending)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(insertedR2Key()).toBeFalsy()
    expect(mocks.captureError).toHaveBeenCalledTimes(1)
  })

  it('never rejects the waitUntil promise when the insert fails', async () => {
    mocks.put.mockResolvedValue(undefined)
    mocks.run.mockRejectedValue(new Error('D1 down'))
    const pending: Promise<unknown>[] = []
    recordAnalyticsEvent({ waitUntil: (p) => pending.push(p) }, env as any, normalizeUninstallAnalyticsEvent(UNINSTALL), UNINSTALL)
    await expect(Promise.all(pending)).resolves.toBeDefined()
    expect(mocks.captureError).toHaveBeenCalledTimes(1)
  })
})
