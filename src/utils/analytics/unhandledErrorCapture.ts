// src/utils/analytics/unhandledErrorCapture.ts
//
// Reports uncaught frontend exceptions from every Forge Custom UI iframe as the
// Mixpanel event `client_unhandled_error`. Only a window `error` or an
// `unhandledrejection` that nothing handled lands here; errors that components
// already catch keep their own events.
//
// Safety rules: the handlers never throw, never call preventDefault (the
// browser console output stays), and never re-enter themselves.
import { trackAnalyticsEvent } from './trackAnalyticsEvent';
import type { Surface } from './catalog';
import type { AnalyticsProperties } from './types';

const MAX_EVENTS_PER_PAGE = 5;
const MAX_MESSAGE_CHARS = 200;
const MAX_STACK_LINES = 5;
const MAX_STACK_CHARS = 1000;
const CONTEXT_WAIT_MS = 5000;
const NON_ERROR_NAME = 'non_error';

const RESIZE_OBSERVER_NOISE = /ResizeObserver loop/;
const OPAQUE_CROSS_ORIGIN_MESSAGE = 'Script error.';

let installed = false;
let sentCount = 0;
let reporting = false;
const seen = new Set<string>();

type ForgeLikeContext = Record<string, any>;
let forgeContext: ForgeLikeContext | null = null;
// Set once the 5 s wait for the Forge context has expired.
let contextWaitExpired = false;
let waitTimer: ReturnType<typeof setTimeout> | null = null;
let queue: AnalyticsProperties[] = [];

/**
 * Maps the Forge context that forgeIndex.ts routes on to an existing Surface.
 * Choices follow what each route's own producers already stamp: PlanUsage and
 * AsyncApiDashboard use 'dashboard', HomepageFeedCard uses 'route', and
 * feedbackSurfaceForContext() maps globalSettings to 'get_started'. The
 * viewer/editor split mirrors ApWrapper2.isDisplayMode(). Returns undefined for
 * anything unrecognised so the caller omits `surface` rather than guessing.
 */
export function surfaceFromForgeContext(context: ForgeLikeContext | null | undefined): Surface | undefined {
  const extension = context?.extension ?? {};
  const moduleKey = String(context?.moduleKey ?? '');
  const type = extension.type;

  // Same test forgeIndex.ts routes on: Forge's default extension.modal has no
  // macroMode, so a bare `extension.modal` would mislabel non-modal iframes.
  if (extension.modal?.macroMode) {
    return extension.modal.macroMode === 'fullscreen' ? 'fullscreen' : 'modal';
  }
  if (type === 'confluence:contentBylineItem') return 'byline';
  if (moduleKey === 'zenuml-page-banner' || moduleKey === 'zenuml-unplaced-banner') {
    return 'page_banner';
  }
  if (type === 'confluence:globalSettings') return 'get_started';
  if (type === 'confluence:globalPage' || type === 'confluence:spacePage') return 'dashboard';
  if (type === 'confluence:homepageFeed') return 'route';
  if (type === 'confluence:macro') {
    return extension.macro?.isConfiguring || extension.macro?.isInserting ? 'editor' : 'viewer';
  }
  return undefined;
}

type ErrorSource = 'error' | 'unhandledrejection';

interface ErrorLocation {
  filename?: string;
  lineno?: number;
  colno?: number;
}

function describe(value: unknown): { name: string; message: string; stack?: string } {
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: String(value.message ?? ''),
      stack: typeof value.stack === 'string' ? value.stack : undefined,
    };
  }
  // Cross-realm errors fail instanceof; accept the Error shape.
  if (value && typeof value === 'object') {
    const shaped = value as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof shaped.message === 'string' && typeof shaped.name === 'string') {
      return {
        name: shaped.name,
        message: shaped.message,
        stack: typeof shaped.stack === 'string' ? shaped.stack : undefined,
      };
    }
    return { name: NON_ERROR_NAME, message: String(shaped.message ?? safeString(value)) };
  }
  return { name: NON_ERROR_NAME, message: safeString(value) };
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '';
  }
}

function stackHead(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const head = stack.split('\n').slice(0, MAX_STACK_LINES).join('\n').slice(0, MAX_STACK_CHARS);
  return head || undefined;
}

function report(
  source: ErrorSource,
  info: { name: string; message: string; stack?: string },
  location: ErrorLocation = {},
): void {
  const message = info.message.slice(0, MAX_MESSAGE_CHARS);

  if (RESIZE_OBSERVER_NOISE.test(info.message)) return;
  if (info.message === OPAQUE_CROSS_ORIGIN_MESSAGE && !info.stack) return;

  const key = `${info.name}\u0000${message}`;
  if (seen.has(key)) return;
  if (sentCount >= MAX_EVENTS_PER_PAGE) return;
  seen.add(key);
  sentCount += 1;

  const head = stackHead(info.stack);
  dispatch({
    feature_area: 'system',
    error_source: source,
    error_name: info.name,
    error_message: message,
    ...(head ? { stack_head: head } : {}),
    ...(location.filename ? { error_filename: location.filename } : {}),
    ...(typeof location.lineno === 'number' && location.lineno > 0
      ? { error_lineno: location.lineno }
      : {}),
    ...(typeof location.colno === 'number' && location.colno > 0
      ? { error_colno: location.colno }
      : {}),
  });
}

function withContext(props: AnalyticsProperties): AnalyticsProperties {
  const surface = surfaceFromForgeContext(forgeContext);
  const moduleKey = forgeContext?.moduleKey;
  const extensionType = forgeContext?.extension?.type;
  return {
    ...props,
    ...(surface ? { surface } : {}),
    ...(typeof moduleKey === 'string' && moduleKey ? { module_key: moduleKey } : {}),
    ...(typeof extensionType === 'string' && extensionType ? { extension_type: extensionType } : {}),
  };
}

function send(props: AnalyticsProperties): void {
  trackAnalyticsEvent('client_unhandled_error', withContext(props));
}

function dispatch(props: Partial<AnalyticsProperties>): void {
  const full = props as AnalyticsProperties; // surface is stamped in withContext
  if (forgeContext || contextWaitExpired) {
    send(full);
    return;
  }
  queue.push(full);
  if (!waitTimer) {
    waitTimer = setTimeout(() => {
      waitTimer = null;
      contextWaitExpired = true;
      flushQueue();
    }, CONTEXT_WAIT_MS);
  }
}

function flushQueue(): void {
  const pending = queue;
  queue = [];
  for (const props of pending) guarded(() => send(props));
}

/** Call once the Forge context is known. Flushes errors queued before it. */
export function setUnhandledErrorContext(context: ForgeLikeContext): void {
  try {
    forgeContext = context;
    if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
    flushQueue();
  } catch {
    // Telemetry must never surface as a new error.
  }
}

function guarded(fn: () => void): void {
  // `reporting` stops an error raised while reporting from re-entering.
  if (reporting) return;
  reporting = true;
  try {
    fn();
  } catch {
    // Telemetry must never surface as a new error.
  } finally {
    reporting = false;
  }
}

function onError(event: ErrorEvent): void {
  guarded(() => {
    const info = event.error != null
      ? describe(event.error)
      : { name: 'Error', message: String(event.message ?? '') };
    // Cross-origin script errors arrive as message-only; prefer the event
    // message when the error object carries none.
    if (!info.message && event.message) info.message = String(event.message);
    report('error', info, {
      filename: event.filename || undefined,
      lineno: event.lineno,
      colno: event.colno,
    });
  });
}

function onRejection(event: PromiseRejectionEvent): void {
  guarded(() => report('unhandledrejection', describe(event.reason)));
}

/** Idempotent: safe to call from every entry; listeners register once. */
export function installUnhandledErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
}

/** Test-only: drop listeners and counters so each test starts clean. */
export function _resetUnhandledErrorCaptureForTests(): void {
  if (typeof window !== 'undefined') {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
  installed = false;
  sentCount = 0;
  reporting = false;
  seen.clear();
  forgeContext = null;
  contextWaitExpired = false;
  if (waitTimer) clearTimeout(waitTimer);
  waitTimer = null;
  queue = [];
}
