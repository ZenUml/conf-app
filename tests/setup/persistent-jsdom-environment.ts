// jsdom environment that is created once per worker process.
//
// With `isolate: false`, Vitest still builds and tears down a fresh jsdom for
// every spec file. Packages that Vitest loads natively (Vue, DOMPurify, ...)
// are loaded once per worker and keep the `document` and `window` of the FIRST
// jsdom, so later files see Vue render into a stale document while the test
// sees a new one (`el instanceof Element` is false, `wrapper.find()` finds
// nothing). Keeping one jsdom for the whole worker keeps them consistent.
// Per-file state is reset in tests/setup/shared-graph-reset.ts.
import { builtinEnvironments, type Environment } from 'vitest/environments';

type Teardown = { teardown(global: unknown): void | Promise<void> };

const STATE = Symbol.for('conf-app.unit.persistentJsdom');

const environment: Environment = {
  name: 'persistent-jsdom',
  transformMode: 'web',
  async setup(global, options) {
    const holder = globalThis as unknown as Record<symbol, Teardown | undefined>;
    if (!holder[STATE]) {
      const g = global as { URLSearchParams: typeof URLSearchParams };
      const nodeUrlSearchParams = g.URLSearchParams;
      holder[STATE] = (await builtinEnvironments.jsdom.setup(global, options)) as Teardown;
      // Node's fetch (undici) loads lazily and keeps the URLSearchParams that is
      // global at that moment, so `new Request(url, { body: new URLSearchParams() })`
      // fails when the worker first used fetch in a node-environment file and
      // jsdom's class is global now. Keep Node's class, as a node file sees it.
      Object.defineProperty(global, 'URLSearchParams', {
        value: nodeUrlSearchParams,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
    // Never tear the window down between files; the process exit does it.
    return { teardown() {} };
  },
};

export default environment;
