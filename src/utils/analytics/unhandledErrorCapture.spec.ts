import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  installUnhandledErrorCapture,
  setUnhandledErrorContext,
  surfaceFromForgeContext,
  _resetUnhandledErrorCaptureForTests,
} from './unhandledErrorCapture';
import { trackAnalyticsEvent } from './trackAnalyticsEvent';

vi.mock('./trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

function fireError(init: ErrorEventInit): ErrorEvent {
  const event = new ErrorEvent('error', { cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function fireRejection(reason: unknown): Event {
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
  return event;
}

const track = vi.mocked(trackAnalyticsEvent);

const MACRO_VIEW = { moduleKey: 'zenuml-macro', extension: { type: 'confluence:macro', macro: {} } };

describe('unhandledErrorCapture', () => {
  beforeEach(() => {
    _resetUnhandledErrorCaptureForTests();
    vi.clearAllMocks();
    installUnhandledErrorCapture();
    setUnhandledErrorContext(MACRO_VIEW);
  });

  it('reports a window error with location and stack head', () => {
    const err = new TypeError('x is undefined');
    err.stack = 'TypeError: x is undefined\n  at a\n  at b\n  at c\n  at d\n  at e\n  at f';
    fireError({ error: err, message: 'x is undefined', filename: 'app.js', lineno: 12, colno: 7 });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('client_unhandled_error', {
      feature_area: 'system',
      surface: 'viewer',
      module_key: 'zenuml-macro',
      extension_type: 'confluence:macro',
      error_source: 'error',
      error_name: 'TypeError',
      error_message: 'x is undefined',
      stack_head: 'TypeError: x is undefined\n  at a\n  at b\n  at c\n  at d',
      error_filename: 'app.js',
      error_lineno: 12,
      error_colno: 7,
    });
  });

  it('reports an unhandled rejection with an Error reason', () => {
    const err = new RangeError('bad range');
    err.stack = undefined;
    fireRejection(err);

    const [, props] = track.mock.calls[0];
    expect(props).toMatchObject({
      error_source: 'unhandledrejection',
      error_name: 'RangeError',
      error_message: 'bad range',
    });
    expect(props).not.toHaveProperty('stack_head');
    expect(props).not.toHaveProperty('error_filename');
    expect(props).not.toHaveProperty('error_lineno');
  });

  it("uses error_name 'non_error' when the rejection reason is not an Error", () => {
    fireRejection('plain string reason');
    expect(track.mock.calls[0][1]).toMatchObject({
      error_name: 'non_error',
      error_message: 'plain string reason',
    });
  });

  it('caps error_message at 200 chars and stack_head at 1000 chars', () => {
    const err = new Error('m'.repeat(500));
    err.stack = Array.from({ length: 3 }, () => 's'.repeat(800)).join('\n');
    fireError({ error: err, message: err.message });

    const [, props] = track.mock.calls[0];
    expect((props.error_message as string).length).toBe(200);
    expect((props.stack_head as string).length).toBe(1000);
  });

  it('ignores ResizeObserver loop noise', () => {
    fireError({ message: 'ResizeObserver loop limit exceeded' });
    fireError({ message: 'ResizeObserver loop completed with undelivered notifications.' });
    fireRejection(new Error('ResizeObserver loop completed'));
    expect(track).not.toHaveBeenCalled();
  });

  it("ignores the opaque cross-origin 'Script error.' with no stack", () => {
    fireError({ message: 'Script error.' });
    expect(track).not.toHaveBeenCalled();
  });

  it("still reports 'Script error.' when a stack is present", () => {
    const err = new Error('Script error.');
    err.stack = 'Error: Script error.\n  at x';
    fireError({ error: err, message: 'Script error.' });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('sends the same name+message at most once per page lifetime', () => {
    fireError({ error: new Error('dup'), message: 'dup' });
    fireError({ error: new Error('dup'), message: 'dup' });
    fireRejection(new Error('dup'));
    fireError({ error: new Error('other'), message: 'other' });
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('sends at most 5 events per page lifetime', () => {
    for (let i = 0; i < 12; i++) {
      fireError({ error: new Error(`distinct ${i}`), message: `distinct ${i}` });
    }
    expect(track).toHaveBeenCalledTimes(5);
  });

  it('registers listeners once when installed twice', () => {
    const add = vi.spyOn(window, 'addEventListener');
    installUnhandledErrorCapture();
    installUnhandledErrorCapture();
    expect(add).not.toHaveBeenCalled();
    fireError({ error: new Error('once'), message: 'once' });
    expect(track).toHaveBeenCalledTimes(1);
    add.mockRestore();
  });

  it('does not call preventDefault', () => {
    const e1 = fireError({ error: new Error('a'), message: 'a' });
    const e2 = fireRejection(new Error('b'));
    expect(e1.defaultPrevented).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
  });

  it('never throws when tracking throws', () => {
    track.mockImplementationOnce(() => {
      throw new Error('tracker down');
    });
    expect(() => fireError({ error: new Error('boom'), message: 'boom' })).not.toThrow();
  });

  it('does not recurse when tracking raises an error event synchronously', () => {
    track.mockImplementationOnce(() => {
      fireError({ error: new Error('inner'), message: 'inner' });
    });
    fireError({ error: new Error('outer'), message: 'outer' });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('survives hostile error objects', () => {
    const hostile = {
      get message(): string {
        throw new Error('getter');
      },
    };
    expect(() => fireRejection(hostile)).not.toThrow();
  });
});

describe('surfaceFromForgeContext', () => {
  const cases: Array<[string, Record<string, unknown>, string | undefined]> = [
    ['opened modal', { extension: { type: 'confluence:macro', modal: { macroMode: 'editor' } } }, 'modal'],
    ['modal on a global page', { extension: { type: 'confluence:globalPage', modal: { macroMode: 'viewer' } } }, 'modal'],
    ['fullscreen modal', { extension: { type: 'confluence:macro', modal: { macroMode: 'fullscreen' } } }, 'fullscreen'],
    ['byline item', { moduleKey: 'zenuml-byline-newuser', extension: { type: 'confluence:contentBylineItem' } }, 'byline'],
    ['page banner host', { moduleKey: 'zenuml-page-banner', extension: { type: 'confluence:pageBanner' } }, 'page_banner'],
    ['unplaced banner', { moduleKey: 'zenuml-unplaced-banner', extension: { type: 'confluence:pageBanner' } }, 'page_banner'],
    ['global settings', { extension: { type: 'confluence:globalSettings' } }, 'get_started'],
    ['global page', { extension: { type: 'confluence:globalPage' } }, 'dashboard'],
    ['space page', { extension: { type: 'confluence:spacePage' } }, 'dashboard'],
    ['homepage feed', { extension: { type: 'confluence:homepageFeed' } }, 'route'],
    ['macro, display', { extension: { type: 'confluence:macro', macro: {} } }, 'viewer'],
    ['macro, configuring', { extension: { type: 'confluence:macro', macro: { isConfiguring: true } } }, 'editor'],
    ['macro, inserting', { extension: { type: 'confluence:macro', macro: { isInserting: true } } }, 'editor'],
    ['unknown extension', { extension: { type: 'confluence:other' } }, undefined],
    ['empty context', {}, undefined],
  ];
  it.each(cases)('%s', (_name, context, expected) => {
    expect(surfaceFromForgeContext(context)).toBe(expected);
  });
});

describe('unhandledErrorCapture before the Forge context arrives', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetUnhandledErrorCaptureForTests();
    vi.clearAllMocks();
    installUnhandledErrorCapture();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues errors and flushes them with the surface once the context is set', () => {
    fireError({ error: new Error('early'), message: 'early' });
    expect(track).not.toHaveBeenCalled();
    setUnhandledErrorContext({ moduleKey: 'zenuml-page-banner', extension: { type: 'confluence:pageBanner' } });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][1]).toMatchObject({
      surface: 'page_banner',
      module_key: 'zenuml-page-banner',
      extension_type: 'confluence:pageBanner',
      error_message: 'early',
    });
  });

  it('applies dedupe and the 5 cap to queued errors', () => {
    for (let i = 0; i < 8; i++) fireError({ error: new Error(`q${i % 7}`), message: `q${i % 7}` });
    setUnhandledErrorContext(MACRO_VIEW);
    expect(track).toHaveBeenCalledTimes(5);
  });

  it('flushes without surface after 5 s when the context never arrives', () => {
    fireError({ error: new Error('late'), message: 'late' });
    vi.advanceTimersByTime(4999);
    expect(track).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][1]).not.toHaveProperty('surface');
    expect(track.mock.calls[0][1]).not.toHaveProperty('module_key');
  });

  it('does not flush twice when the context arrives after the timeout', () => {
    fireError({ error: new Error('x'), message: 'x' });
    vi.advanceTimersByTime(5000);
    setUnhandledErrorContext(MACRO_VIEW);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('cancels the timer when the context arrives in time', () => {
    fireError({ error: new Error('x'), message: 'x' });
    setUnhandledErrorContext(MACRO_VIEW);
    vi.advanceTimersByTime(10000);
    expect(track).toHaveBeenCalledTimes(1);
  });
});
