import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION, type ExtensionFrame, type HubFrame, type PrRef } from '@zenuml/pr-panel-shared'
import { ReviewStore } from './review-store'
import { HubRuntime, type RuntimeOptions } from './runtime'

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'prp-'))
}

export const PR: PrRef = { host: 'github.com', owner: 'Acme', repo: 'Widgets', number: 7, headSha: 'aaaaaaa1', title: 'Add widget' }
export const PR2: PrRef = { host: 'github.com', owner: 'acme', repo: 'widgets', number: 8, headSha: 'bbbbbbb2' }
export const REPO = { host: 'github.com', owner: 'acme', repo: 'widgets' }
export const REPO_KEY = 'github.com/acme/widgets'

let idCounter = 0
export function frame<T extends ExtensionFrame['type']>(
  type: T,
  body: Omit<Extract<ExtensionFrame, { type: T }>, 'v' | 'id' | 'ts' | 'type'>,
): Extract<ExtensionFrame, { type: T }> {
  idCounter += 1
  return { v: 1, id: `f${idCounter}`, ts: Date.now(), type, ...body } as Extract<ExtensionFrame, { type: T }>
}

export interface FakeConnection {
  id: string
  frames: HubFrame[]
  send(frame: HubFrame): void
  of<T extends HubFrame['type']>(type: T): Extract<HubFrame, { type: T }>[]
  last<T extends HubFrame['type']>(type: T): Extract<HubFrame, { type: T }> | undefined
}

export function fakeConnection(id = 'conn-1'): FakeConnection {
  const frames: HubFrame[] = []
  const of = <T extends HubFrame['type']>(type: T): Extract<HubFrame, { type: T }>[] =>
    frames.filter((f): f is Extract<HubFrame, { type: T }> => f.type === type)
  return {
    id,
    frames,
    send: (f) => frames.push(f),
    of,
    last: (type) => of(type).at(-1),
  }
}

export function makeRuntime(options: Partial<RuntimeOptions> = {}): { runtime: HubRuntime; dir: string } {
  const dir = tempDir()
  let t = 1_000_000
  const runtime = new HubRuntime({
    store: new ReviewStore(join(dir, 'store')),
    now: () => (t += 10),
    ...options,
  })
  return { runtime, dir }
}

/** Attach + hello a fake extension connection. */
export function connectExtension(runtime: HubRuntime, id = 'conn-1'): FakeConnection {
  const conn = fakeConnection(id)
  runtime.attachExtension(conn)
  runtime.handleExtensionFrame(conn.id, frame('hello', { extVersion: '0.1.0', protocolVersion: PROTOCOL_VERSION }))
  return conn
}
