/**
 * Storybook-only stub for @forge/bridge.
 * Mapped via .storybook/main.ts viteFinal alias so that modules with static
 * `import { FeatureFlags, view } from '@forge/bridge'` don't throw a
 * BridgeAPIError during Storybook's module evaluation phase.
 *
 * Only the minimal surface used by production code is exported here.
 * Real bridge calls are never made in Storybook (forgeGlobal.isForge = false).
 */

export class FeatureFlags {
  async initialize(): Promise<void> {}
  async checkFlag(_key: string, defaultValue: boolean): Promise<boolean> {
    return defaultValue
  }
  shutdown(): void {}
}

export const view = {
  getContext: async () => null,
  submit: async (_opts: any) => {},
  close: async () => {},
}

export const router = {
  open: (_url: string) => {},
  navigate: (_url: string) => {},
}

/**
 * Per-story response overrides. A story sets these before mounting, so a
 * component that reads Confluence users or calls our remote backend can be
 * rendered with realistic data instead of an empty shell. Import this object
 * from '@/stubs/forge-bridge' — Storybook aliases '@forge/bridge' to this same
 * module, so both specifiers resolve to one instance.
 */
export const stubResponses: {
  /** GET /wiki/rest/api/user?accountId=… keyed by accountId. */
  users: Record<string, { displayName: string }>
  /** Response body for any invokeRemote() call, keyed by a substring of its path. */
  remote: Array<{ match: string; status?: number; body: any }>
} = { users: {}, remote: [] }

export function resetStubResponses(): void {
  stubResponses.users = {}
  stubResponses.remote = []
}

export const requestConfluence = async (url: string, _opts?: any) => {
  const accountId = /accountId=([^&]+)/.exec(url)?.[1]
  if (accountId) {
    const user = stubResponses.users[decodeURIComponent(accountId)]
    if (user) return new Response(JSON.stringify(user), { status: 200 })
  }
  return new Response('{}', { status: 200 })
}

export const invokeRemote = async (opts: { path: string; method?: string; body?: any }) => {
  const hit = stubResponses.remote.find((r) => opts.path.includes(r.match))
  if (!hit) return { status: 404, body: 'no stub for ' + opts.path }
  return { status: hit.status ?? 200, body: hit.body }
}

export const invoke = async (_name: string, _payload?: any) => ({})

export class Modal {
  constructor(_opts: any) {}
  open() {}
  close() {}
}
