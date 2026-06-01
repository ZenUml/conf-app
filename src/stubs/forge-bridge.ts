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

export const requestConfluence = async (_url: string, _opts?: any) => {
  return new Response('{}', { status: 200 })
}

export const invoke = async (_name: string, _payload?: any) => ({})

export class Modal {
  constructor(_opts: any) {}
  open() {}
  close() {}
}
