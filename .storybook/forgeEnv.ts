// Root tsc uses legacy Node resolution, which cannot see these package exports
// (every story file has the same errors); Vite and Storybook resolve them.
// @ts-expect-error -- legacy moduleResolution
import { onUnmounted } from 'vue'
// @ts-expect-error -- legacy moduleResolution
import type { Decorator } from '@storybook/vue3-vite'
import forgeGlobal from '@/model/globals/forgeGlobal'
import globals from '@/model/globals'

/**
 * Storybook renders every story in one preview iframe, so the module singletons
 * `forgeGlobal` and `globals.apWrapper` outlive a story. This decorator applies
 * a story's Forge environment when the story renders and puts every key it
 * touched back when the story unmounts, so a story never depends on which one
 * was open before it.
 *
 * Apply runs synchronously in the decorator body, before the story component's
 * setup() reads the singletons. Restore runs in the wrapper's onUnmounted.
 * Keys that were absent before are deleted (not set to undefined), so an
 * ApWrapper2 prototype method shadowed by a stub comes back.
 */
export interface ForgeEnvOptions {
  /** Members of `forgeGlobal`: isForge, isLite, forgeContext, zenumlRemoteBaseUrl, view, … */
  forge?: Record<string, unknown>
  /** Members of `globals.apWrapper`: canUserEdit, isDisplayMode, getCurrentPage, … */
  apWrapper?: Record<string, unknown>
}

type Snapshot = { target: object; key: string; had: boolean; value: unknown }

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

function assignWithSnapshot(target: object, values: Record<string, unknown> | undefined, snaps: Snapshot[]) {
  for (const key of Object.keys(values ?? {})) {
    snaps.push({ target, key, had: has(target, key), value: (target as any)[key] })
    ;(target as any)[key] = values![key]
  }
}

/** Apply the options and return a function that restores every touched key. */
export function applyForgeEnv(opts: ForgeEnvOptions): () => void {
  const snaps: Snapshot[] = []
  assignWithSnapshot(forgeGlobal, opts.forge, snaps)
  assignWithSnapshot(globals.apWrapper, opts.apWrapper, snaps)
  let restored = false
  return () => {
    if (restored) return
    restored = true
    // Reverse order: a key listed twice returns to its first value.
    for (const { target, key, had, value } of [...snaps].reverse()) {
      if (had) (target as any)[key] = value
      else delete (target as any)[key]
    }
  }
}

/**
 * Pass a function when the options hold objects a story mutates (for example
 * a forgeContext it edits in place), so every render gets fresh ones.
 */
export function forgeEnv(opts: ForgeEnvOptions | (() => ForgeEnvOptions)): Decorator {
  return () => {
    const restore = applyForgeEnv(typeof opts === 'function' ? opts() : opts)
    return {
      template: '<story />',
      setup() {
        onUnmounted(restore)
      },
    }
  }
}

const staged: Array<() => void> = []

/**
 * For setup helpers that run inside a story's own decorator body or render()
 * and cannot be rewritten as one `forgeEnv(...)` entry (for example one helper
 * shared by dozens of stories, driven by per-story options). Applies now and
 * queues the restore; the `forgeEnvScope` decorator on the same story takes the
 * queue when the story mounts and restores on unmount. Without a scope
 * decorator the restore never runs, so use this only under `forgeEnvScope`.
 */
export function stageForgeEnv(opts: ForgeEnvOptions): void {
  staged.push(applyForgeEnv(opts))
}

/** Restores, on unmount, everything `stageForgeEnv` applied while this story was composed. */
export const forgeEnvScope: Decorator = () => ({
  template: '<story />',
  setup() {
    const mine = staged.splice(0)
    onUnmounted(() => {
      for (const restore of mine.reverse()) restore()
    })
  },
})

/** The `forgeContext` of a Lite viewer on a page, as the viewer stories build it. */
export function liteViewerContext(o: { pageId?: string; accountId?: string } = {}) {
  return {
    accountId: o.accountId ?? 'storybook-user',
    cloudId: 'storybook-cloud',
    extension: {
      content: { id: o.pageId ?? 'storybook-page' },
      space: { key: 'DOCS' },
      config: {},
    },
  } as any
}
