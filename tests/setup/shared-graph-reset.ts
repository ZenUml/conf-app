// Runs before tests/test-setup.ts for every spec file.
//
// The unit suite runs with `isolate: false`, so one worker runs many spec
// files in the same jsdom window and the same vite-node module cache. Vitest
// only resets either when isolation is on. This file does it instead:
//
//   1. Before each file: drop the vite-node module cache (including factory
//      mocks) and the mock registry, so a `vi.mock()` in one file never
//      reaches the next and module-level singletons are rebuilt per file.
//   2. After each file: undo what specs commonly leave on the shared window
//      (timers, stubbed globals and env, storage, document contents, and
//      properties added to or changed on window, document, navigator and the
//      DOM prototypes).
//
// See "Unit test cleanup rules" in AGENTS.md.
import { afterAll, vi } from 'vitest';
import { transformVNodeArgs } from 'vue';
import { config as vtuConfig } from '@vue/test-utils';

type CachedModule = unknown;
type ModuleCache = {
  forEach(cb: (mod: CachedModule, path: string) => void): void;
  invalidateModule(mod: CachedModule): void;
};
type Mocker = { moduleCache?: ModuleCache; reset?: () => void };

const KEEP = [/\/vitest\/dist\//, /\/vite-node\/dist\//, /vitest-virtual-\w+\/dist/, /@vitest\/dist/];

function dropModuleCache(): void {
  const mocker = (globalThis as { __vitest_mocker__?: Mocker }).__vitest_mocker__;
  // Vitest 2.1.9 keys its mock registry by the first file a worker ran when
  // isolation is off, so registrations pile up across files. Clear them.
  mocker?.reset?.();
  const cache = mocker?.moduleCache;
  if (!cache) return;
  const stale: CachedModule[] = [];
  cache.forEach((mod, path) => {
    if (!KEEP.some((re) => re.test(path))) stale.push(mod);
  });
  stale.forEach((mod) => cache.invalidateModule(mod));
}

dropModuleCache();

// ---- leaked timers ----------------------------------------------------------
// A timer a spec leaves behind (a 60 s license-notice deadline, a prefetch
// watchdog) would fire inside a later file of the same worker, and it keeps the
// worker process alive after the last file: Vitest then waits for it to run out.
// Track every timer started through the global and clear what is left per file.

type TimerHandle = ReturnType<typeof setTimeout>;
const TIMERS = Symbol.for('conf-app.unit.pendingTimers');
const timerHolder = globalThis as unknown as Record<symbol, Set<TimerHandle> | undefined>;

if (!timerHolder[TIMERS]) {
  const pending = new Set<TimerHandle>();
  Object.defineProperty(globalThis, TIMERS, { value: pending, configurable: true });
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (typeof fn !== 'function') return realSetTimeout(fn, ms, ...args);
    const handle: TimerHandle = realSetTimeout((...a: unknown[]) => {
      pending.delete(handle);
      return fn(...a);
    }, ms, ...args);
    pending.add(handle);
    return handle;
  }) as typeof setTimeout;
  globalThis.setInterval = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const handle = realSetInterval(fn, ms, ...args);
    pending.add(handle);
    return handle;
  }) as typeof setInterval;
}

function clearLeakedTimers(): void {
  const pending = timerHolder[TIMERS];
  if (!pending) return;
  for (const handle of pending) {
    clearTimeout(handle);
    clearInterval(handle);
  }
  pending.clear();
}

// ---- host object restore -------------------------------------------------

type Snapshot = Map<PropertyKey, PropertyDescriptor>;
const SNAPSHOTS = Symbol.for('conf-app.unit.hostSnapshots');
// Owned by vitest or installed once per worker; never touch them.
const SKIP_KEY = /^__vitest|^__VITEST/;
const VITEST_GLOBALS = new Set<PropertyKey>([
  'describe', 'it', 'test', 'expect', 'vi', 'vitest', 'suite', 'bench', 'chai', 'assert',
  'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'expectTypeOf', 'assertType',
  'onTestFailed', 'onTestFinished', 'IS_REACT_ACT_ENVIRONMENT',
]);

function hostTargets(): Array<[string, object]> {
  const g = globalThis as Record<string, unknown>;
  const names = [
    'navigator', 'document', 'Element', 'HTMLElement', 'SVGElement', 'HTMLCanvasElement',
    'HTMLImageElement', 'HTMLInputElement', 'HTMLAnchorElement', 'Node', 'Document', 'EventTarget',
    'Navigator', 'Window', 'Image', 'URL', 'Event', 'Storage',
  ];
  const out: Array<[string, object]> = [['globalThis', globalThis]];
  for (const name of names) {
    const value = g[name];
    if (value && (typeof value === 'object' || typeof value === 'function')) {
      out.push([name, name[0] === name[0].toUpperCase() && typeof value === 'function'
        ? (value as { prototype?: object }).prototype ?? (value as object)
        : (value as object)]);
      if (typeof value === 'function') out.push([`${name}.static`, value as object]);
    }
  }
  return out;
}

function snapshotOf(target: object): Snapshot {
  const snap: Snapshot = new Map();
  for (const key of Reflect.ownKeys(target)) {
    if (typeof key === 'string' && SKIP_KEY.test(key)) continue;
    const d = Object.getOwnPropertyDescriptor(target, key);
    if (d) snap.set(key, d);
  }
  return snap;
}

function sameDescriptor(a: PropertyDescriptor, b: PropertyDescriptor): boolean {
  return a.value === b.value && a.get === b.get && a.set === b.set
    && a.writable === b.writable && a.configurable === b.configurable && a.enumerable === b.enumerable;
}

function takeBaselineOnce(): Map<object, Snapshot> {
  const holder = globalThis as unknown as Record<symbol, Map<object, Snapshot> | undefined>;
  let baseline = holder[SNAPSHOTS];
  // A node-environment file has no jsdom globals to snapshot or restore; wait
  // for the first file that has a window so the baseline includes them.
  if (!baseline && typeof document === 'undefined') return new Map();
  if (!baseline) {
    baseline = new Map();
    for (const [, target] of hostTargets()) {
      if (!baseline.has(target)) baseline.set(target, snapshotOf(target));
    }
    Object.defineProperty(globalThis, SNAPSHOTS, { value: baseline, configurable: true });
  }
  return baseline;
}

const baseline = takeBaselineOnce();

// jsdom's globals (CSS, URLSearchParams, ...) are installed as accessors whose
// setter stores the assigned value in a closure. `globalThis.X = v` therefore
// changes nothing the descriptor snapshot can see, and it outlives the file.
// Remember each settable accessor's value at worker start and put it back.
const INITIAL_VALUES = Symbol.for('conf-app.unit.accessorInitialValues');

function takeAccessorValuesOnce(): Map<PropertyKey, unknown> {
  const holder = globalThis as unknown as Record<symbol, Map<PropertyKey, unknown> | undefined>;
  let values = holder[INITIAL_VALUES];
  if (!values && typeof document === 'undefined') return new Map();
  if (!values) {
    values = new Map();
    for (const key of Reflect.ownKeys(globalThis)) {
      if (typeof key === 'string' && SKIP_KEY.test(key)) continue;
      if (VITEST_GLOBALS.has(key)) continue;
      const d = Object.getOwnPropertyDescriptor(globalThis, key);
      if (!d?.get || !d.set) continue;
      try { values.set(key, d.get.call(globalThis)); } catch { /* getter needs a live window */ }
    }
    Object.defineProperty(globalThis, INITIAL_VALUES, { value: values, configurable: true });
  }
  return values;
}

const accessorValues = takeAccessorValuesOnce();

function restoreAccessorOverrides(): void {
  for (const [key, initial] of accessorValues) {
    const d = Object.getOwnPropertyDescriptor(globalThis, key);
    if (!d?.get || !d.set) continue;
    try {
      if (d.get.call(globalThis) !== initial) d.set.call(globalThis, initial);
    } catch { /* ignore */ }
  }
}

function restoreHostObjects(): void {
  restoreAccessorOverrides();
  for (const [target, snap] of baseline) {
    const isGlobal = target === globalThis;
    for (const key of Reflect.ownKeys(target)) {
      if (typeof key === 'string' && SKIP_KEY.test(key)) continue;
      if (isGlobal && VITEST_GLOBALS.has(key)) continue;
      const now = Object.getOwnPropertyDescriptor(target, key);
      if (!now) continue;
      const was = snap.get(key);
      try {
        if (!was) {
          if (now.configurable) delete (target as Record<PropertyKey, unknown>)[key];
        } else if (!sameDescriptor(now, was) && now.configurable) {
          Object.defineProperty(target, key, was);
        }
      } catch { /* non-restorable host property */ }
    }
    for (const [key, was] of snap) {
      if (isGlobal && VITEST_GLOBALS.has(key)) continue;
      if (Object.getOwnPropertyDescriptor(target, key)) continue;
      try { Object.defineProperty(target, key, was); } catch { /* ignore */ }
    }
  }
}

// ---- Vue and Vue Test Utils globals ----------------------------------------
// Both packages are loaded once per worker. Test Utils installs a vnode
// transformer on every mount and never removes it, so after a `shallow` mount
// every later plain `createApp(...)` renders `<anonymous-stub>`. It also keeps
// `config.global` (stubs, plugins, mocks) for the life of the worker.

type VtuGlobal = typeof vtuConfig.global;
const VTU_DEFAULTS = Symbol.for('conf-app.unit.vtuDefaults');

function copyVtuGlobal(g: VtuGlobal): VtuGlobal {
  return {
    ...g,
    stubs: { ...g.stubs },
    provide: { ...g.provide },
    components: { ...g.components },
    config: { ...g.config },
    directives: { ...g.directives },
    mixins: [...(g.mixins ?? [])],
    mocks: { ...g.mocks },
    plugins: [...(g.plugins ?? [])],
  } as VtuGlobal;
}

const vtuHolder = globalThis as unknown as Record<symbol, VtuGlobal | undefined>;
if (!vtuHolder[VTU_DEFAULTS]) {
  Object.defineProperty(globalThis, VTU_DEFAULTS, { value: copyVtuGlobal(vtuConfig.global), configurable: true });
}

function resetVueGlobals(): void {
  transformVNodeArgs();
  const defaults = vtuHolder[VTU_DEFAULTS];
  if (defaults) vtuConfig.global = copyVtuGlobal(defaults);
}

resetVueGlobals();

// ---- per-file hygiene ----------------------------------------------------
// Per file, not per test: with isolation on these were gone after every file,
// and a spec may legitimately set things up in beforeAll.

// Work a spec leaves in flight (a dynamic import, a promise chain) would keep
// running into the next file of the same worker. Let it settle first, then drop
// whatever it loaded, so the next file imports a clean graph.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterAll(async () => {
  vi.useRealTimers();
  await settle();
  resetVueGlobals();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearLeakedTimers();
  restoreHostObjects();
  try { localStorage.clear(); } catch { /* storage unavailable */ }
  try { sessionStorage.clear(); } catch { /* storage unavailable */ }
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
    document.body.removeAttribute('class');
    document.body.removeAttribute('style');
    document.head.innerHTML = '';
  }
  dropModuleCache();
});
