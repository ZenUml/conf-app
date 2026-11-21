/**
 * Integration test: dirty → close → reopen → banner shows → restore → content reflects draft
 *
 * Tests the full autosave-draft flow without needing a Forge tunnel or staging
 * deployment. The global test-setup.ts already provides a base @forge/bridge
 * mock; we override view.onClose per-describe to capture the registered handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Override @forge/bridge BEFORE any module under test is imported.
// The global test-setup mock already wires a stub; here we replace view.onClose
// with a version that captures the handler so individual tests can invoke it.
const capturedCloseHandlers: Array<() => void | Promise<void>> = [];

vi.mock('@forge/bridge', () => ({
  view: {
    onClose: vi.fn(async (handler: () => void | Promise<void>) => {
      capturedCloseHandlers.push(handler);
    }),
    getContext: vi.fn(async () => ({ cloudId: 'test-cloud' })),
    close: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    theme: { enable: vi.fn(async () => {}) },
    changeWindowTitle: vi.fn(async () => {}),
    emitReadyEvent: vi.fn(async () => {}),
  },
  invoke: vi.fn(async () => null),
  invokeRemote: vi.fn(async () => null),
  requestConfluence: vi.fn(async () => ({ json: async () => ({}) })),
  router: { navigate: vi.fn(async () => {}) },
  events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}));

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createStore } from 'vuex';
import Header from '@/components/Header/Header.vue';
import { DiagramType } from '@/model/Diagram/Diagram';
import EventBus from '@/EventBus';
import extendedStore from '@/model/store2/ExtendedStore';

const mountedHeaders: Array<ReturnType<typeof mount>> = [];

/** Build a fresh Vuex store with controlled initial state. */
function makeStore(overrides: Record<string, any> = {}) {
  return createStore({
    ...extendedStore,
    state: {
      ...extendedStore.state,
      diagram: {
        id: '',
        diagramType: DiagramType.Sequence,
        code: 'A->B: hello',
        title: 'My Diagram',
        styles: {},
        mermaidCode: '',
        plantUmlCode: '',
        graphXml: '',
        isNew: false,
        updatedAt: 0,
        ...overrides,
      } as any,
      error: null,
      onElementClick: () => {},
    } as any,
  });
}

/** Mount Header with the given store and await the mounted() hook fully. */
async function mountHeader(store: ReturnType<typeof makeStore>) {
  const wrapper = mount(Header, { global: { plugins: [store] } });
  mountedHeaders.push(wrapper);
  // mounted() is async (awaits primeCloudId + loadDraft); flush all microtasks.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return wrapper;
}

/** The draft key used by draftStore for a new:diagram scope with cloudId test-cloud. */
const DRAFT_KEY = 'zenuml.draft.test-cloud.new:diagram';

beforeEach(() => {
  localStorage.clear();
  // closeGuard keeps one bridge callback for this iframe, even after all
  // subscribers unmount. Keep the mock's callback across test cases too.
  vi.clearAllMocks();
});

afterEach(() => {
  for (const wrapper of mountedHeaders) wrapper.unmount();
  mountedHeaders.length = 0;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Test 1 — Dirty save via debounce
// ---------------------------------------------------------------------------
describe('Test 1 — debounced live save writes to localStorage', () => {
  it('saves a draft after the debounce window elapses', async () => {
    // Mount with real timers first so the async mounted() hook can settle.
    const store = makeStore();
    await mountHeader(store);

    // NOW switch to fake timers — the mounted hook has finished.
    vi.useFakeTimers();

    // Simulate the user typing new code by committing to the store.
    // The Header watcher fires and calls _draftSaver.save().
    store.commit('updateCode2', 'A->B: changed');

    // Nothing persisted yet — still within the 500ms debounce window.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    // Advance past the 500ms debounce delay.
    vi.advanceTimersByTime(600);
    // Allow async saveDraft (awaits getCloudId microtask) to settle.
    await vi.runAllTimersAsync();

    const raw = localStorage.getItem(DRAFT_KEY);
    expect(raw).not.toBeNull();
    const draft = JSON.parse(raw!);
    expect(draft.code).toBe('A->B: changed');
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Close handler fires a synchronous save (no debounce wait)
// ---------------------------------------------------------------------------
describe('Test 2 — view.onClose triggers sync draft save', () => {
  it('persists the current code synchronously when the close handler is invoked', async () => {
    const store = makeStore();
    await mountHeader(store);

    // Mutate code so it differs from originalCode.
    store.commit('updateCode2', 'A->B: unsaved before close');

    // Verify nothing is in storage yet (debounce not elapsed).
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    // Invoke the handler that Header registered with view.onClose.
    expect(capturedCloseHandlers).toHaveLength(1);
    await capturedCloseHandlers[capturedCloseHandlers.length - 1]();

    const raw = localStorage.getItem(DRAFT_KEY);
    expect(raw).not.toBeNull();
    const draft = JSON.parse(raw!);
    expect(draft.code).toBe('A->B: unsaved before close');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Re-mount with a newer draft emits 'draft-available'
// ---------------------------------------------------------------------------
describe('Test 3 — re-mount surfaces banner via draft-available event', () => {
  it('emits draft-available with scope and draft when a newer draft exists', async () => {
    // Pre-seed a draft newer than updatedAt=0.
    const newerSavedAt = Date.now() + 5000;
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ code: 'A->B: restored code', title: 'Restored Title', savedAt: newerSavedAt }),
    );

    const emitted: any[] = [];
    EventBus.$on('draft-available', (payload: any) => emitted.push(payload));

    const store = makeStore(); // updatedAt defaults to 0 < newerSavedAt
    await mountHeader(store);

    EventBus.$off('draft-available');

    expect(emitted).toHaveLength(1);
    expect(emitted[0].scope).toBe('new:diagram');
    expect(emitted[0].draft.code).toBe('A->B: restored code');
  });

  it('does NOT emit draft-available when draft is older than diagram.updatedAt', async () => {
    const olderSavedAt = Date.now() - 60_000;
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ code: 'stale', title: '', savedAt: olderSavedAt }),
    );

    const emitted: any[] = [];
    EventBus.$on('draft-available', (payload: any) => emitted.push(payload));

    // updatedAt is newer than the draft.
    const store = makeStore({ updatedAt: Date.now() });
    await mountHeader(store);

    EventBus.$off('draft-available');

    // Stale draft should be discarded, not surfaced.
    expect(emitted).toHaveLength(0);
    // And should have been cleared from storage.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('treats the ISO updatedAt written by Forge publish as the saved-version timestamp', async () => {
    const savedAt = Date.now();
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ code: 'stale', title: '', savedAt: savedAt - 60_000 }),
    );

    const emitted: any[] = [];
    EventBus.$on('draft-available', (payload: any) => emitted.push(payload));

    await mountHeader(makeStore({ updatedAt: new Date(savedAt).toISOString() }));

    EventBus.$off('draft-available');
    expect(emitted).toHaveLength(0);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 4 — draft-restore dispatches the right Vuex action and clears storage
// ---------------------------------------------------------------------------
describe('Test 4 — draft-restore dispatches updateCode2 + updateTitle and clears draft', () => {
  it('applies the draft to the store and removes it from localStorage', async () => {
    // Pre-seed so mounted() doesn't discard it.
    const savedAt = Date.now() + 5000;
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ code: 'A->B: draft code', title: 'Draft Title', savedAt }),
    );

    const store = makeStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');
    await mountHeader(store);

    // Simulate user clicking "Restore" — EventBus carries scope+draft.
    EventBus.$emit('draft-restore', {
      scope: 'new:diagram',
      draft: { code: 'A->B: draft code', title: 'Draft Title', savedAt },
    });

    // Allow any microtasks (clearDraft is async).
    await new Promise((r) => setTimeout(r, 0));

    // updateCode2 should have been dispatched with the draft code.
    expect(dispatchSpy).toHaveBeenCalledWith('updateCode2', 'A->B: draft code');
    // updateTitle should have been dispatched with the draft title.
    expect(dispatchSpy).toHaveBeenCalledWith('updateTitle', 'Draft Title');

    // Draft should be removed from localStorage.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('ignores draft-restore events whose scope does not match this editor', async () => {
    const store = makeStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');
    await mountHeader(store);

    // Emit with a different scope.
    EventBus.$emit('draft-restore', {
      scope: 'edit:999',
      draft: { code: 'wrong', title: 'wrong', savedAt: Date.now() },
    });

    // updateCode2 should NOT have been called.
    expect(dispatchSpy).not.toHaveBeenCalledWith('updateCode2', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// Test 5 — 'saved' event clears the draft
// ---------------------------------------------------------------------------
describe('Test 5 — saved event removes the draft from localStorage', () => {
  it('clears the draft when EventBus emits saved', async () => {
    // Pre-seed a draft.
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ code: 'A->B: saved code', title: 'T', savedAt: Date.now() }),
    );

    const store = makeStore();
    await mountHeader(store);

    // Confirm it's still there.
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    // Simulate successful publish.
    EventBus.$emit('saved');

    // clearDraft is async — allow microtasks to flush.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('does not let a pending debounced write resurrect the draft after publish', async () => {
    const store = makeStore();
    await mountHeader(store);
    vi.useFakeTimers();

    store.commit('updateCode2', 'A->B: published change');
    await nextTick();
    EventBus.$emit('saved');
    await vi.runAllTimersAsync();

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 6 — the draft is cleared when Publish commits, not when view.submit
// resolves. Under Playwright (and sometimes for real users) view.submit tears
// the iframe down before its promise settles, so the 'saved' handler never
// runs and the published content stayed behind as a new:diagram draft.
// ---------------------------------------------------------------------------
describe('Test 6 — publish-committing clears the draft before the editor closes', () => {
  const closeHandler = () => capturedCloseHandlers[capturedCloseHandlers.length - 1];

  it('removes the draft synchronously when Publish commits', async () => {
    const store = makeStore();
    await mountHeader(store);
    store.commit('updateCode2', 'A->B: about to publish');
    await nextTick();
    await closeHandler()(); // writes the draft synchronously
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    // No microtask flush: view.submit may tear the iframe down right after.
    EventBus.$emit('publish-committing');

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('does not let the close guard or a pending debounced write re-create the draft after commit', async () => {
    const store = makeStore();
    await mountHeader(store);
    vi.useFakeTimers();

    store.commit('updateCode2', 'A->B: published change');
    await nextTick();
    EventBus.$emit('publish-committing');
    // A late auto-title change during teardown must not write either.
    store.dispatch('updateTitle', 'Late auto title');
    await nextTick();
    // The iframe closes during view.submit: onClose fires.
    await closeHandler()();
    await vi.runAllTimersAsync();

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('writes the draft back when view.submit fails after commit, as the retry anchor', async () => {
    const store = makeStore();
    await mountHeader(store);

    store.commit('updateCode2', 'A->B: publish failed');
    await nextTick();
    EventBus.$emit('publish-committing');
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    EventBus.$emit('publish-commit-failed', new Error('MACRO_NOT_FOUND'));
    EventBus.$emit('save-error', new Error('MACRO_NOT_FOUND'));

    const raw = localStorage.getItem(DRAFT_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).code).toBe('A->B: publish failed');

    // After the failure the editor is live again: the close guard saves as before.
    store.commit('updateCode2', 'A->B: edited after failure');
    await nextTick();
    await closeHandler()();
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).code).toBe('A->B: edited after failure');
  });

  it('leaves the draft alone on a failure that happens before commit', async () => {
    const store = makeStore();
    await mountHeader(store);
    store.commit('updateCode2', 'A->B: blocked publish');
    await nextTick();
    await closeHandler()();
    const before = localStorage.getItem(DRAFT_KEY);

    EventBus.$emit('publish-commit-failed', new Error('publish blocked'));
    EventBus.$emit('save-error', new Error('publish blocked'));

    expect(localStorage.getItem(DRAFT_KEY)).toBe(before);
  });

  it('does not re-save published content when the editor closes after a successful save', async () => {
    const store = makeStore();
    await mountHeader(store);
    store.commit('updateCode2', 'A->B: saved, modal stays open');
    await nextTick();

    EventBus.$emit('saved');
    await new Promise((r) => setTimeout(r, 0));
    await closeHandler()();

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
