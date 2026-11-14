/**
 * Name and a scrubbed message of an error that a Confluence fetch threw
 * instead of returning a response (no HTTP status). Mixpanel needs these to
 * tell a network failure (Safari "Load failed", Chrome "Failed to fetch") from
 * a host-side bridge rejection or a module-load failure: before this, all of
 * them were only `error_class: thrown`.
 *
 * The message is scrubbed before it leaves the browser: URL query strings,
 * email addresses and digit runs of 4+ (content, page and account ids) are
 * replaced, whitespace is collapsed and the result is cut to 100 characters.
 */
export interface ThrownFetchErrorDescription {
  name: string;
  message: string;
}

const MAX_MESSAGE_LENGTH = 100;

export function describeThrownFetchError(error: unknown): ThrownFetchErrorDescription {
  return { name: errorName(error), message: scrubMessage(rawMessage(error)) };
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name || error.constructor?.name || 'Error';
  }
  return error === null ? 'null' : typeof error;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
}

function scrubMessage(message: string): string {
  return message
    .replace(/\?[^\s]*/g, '')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '{email}')
    .replace(/\d{4,}/g, '{n}')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}
