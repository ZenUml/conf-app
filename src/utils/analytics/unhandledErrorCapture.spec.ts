import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  installUnhandledErrorCapture,
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

describe('unhandledErrorCapture', () => {
  beforeEach(() => {
    _resetUnhandledErrorCaptureForTests();
    vi.clearAllMocks();
    installUnhandledErrorCapture();
  });

  it('reports a window error with location and stack head', () => {
    const err = new TypeError('x is undefined');
    err.stack = 'TypeError: x is undefined\n  at a\n  at b\n  at c\n  at d\n  at e\n  at f';
    fireError({ error: err, message: 'x is undefined', filename: 'app.js', lineno: 12, colno: 7 });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('client_unhandled_error', {
      feature_area: 'system',
      surface: 'iframe',
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
