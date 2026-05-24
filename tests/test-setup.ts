// Global mocks for tests
import { vi } from 'vitest';

// @forge/bridge bootstraps a connection to the Atlassian custom UI bridge at
// module-load time. In jsdom that throws "Unable to establish a connection",
// which fails any spec that transitively imports from it (Header.vue,
// closeGuard, draftStore, ...). Provide a dummy module so individual specs
// don't each have to vi.mock it.
vi.mock('@forge/bridge', () => ({
  view: {
    onClose: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    getContext: vi.fn(async () => ({ cloudId: 'test-cloud' })),
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


// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  root: Element | null = null;
  rootMargin: string = '';
  thresholds: ReadonlyArray<number> = [];


  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit
  ) {}


  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords() { return []; }
};


// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};


// Mock matchMedia
global.matchMedia = vi.fn().mockImplementation(query => {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
});