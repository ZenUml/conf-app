import * as Sentry from "@sentry/cloudflare";

// Re-export the Sentry functions that we need
export const { captureException, captureMessage, setTag, setTags, setUser } = Sentry;

/**
 * Capture an error with Sentry
 * @param err The error to capture
 */
export function captureError(err: unknown): void {
  console.error(err);
  captureException(err);
}

/**
 * Capture an installed message with Sentry
 * @param appKey The app key
 * @param clientKey The client key
 * @param baseUrl The base URL
 */
export function captureInstalledMessage(appKey: string, clientKey: string, baseUrl: string): void {
  setTags({
    'app-key': appKey,
    'client-key': clientKey,
    'base-url': baseUrl
  });
  captureMessage("{action: 'installed'}", "info");
}

/**
 * Capture an uninstalled message with Sentry
 * @param appKey The app key
 * @param clientKey The client key
 * @param baseUrl The base URL
 */
export function captureUninstalledMessage(appKey: string, clientKey: string, baseUrl: string): void {
  setTags({
    'app-key': appKey,
    'client-key': clientKey,
    'base-url': baseUrl
  });
  captureMessage("{action: 'uninstalled'}", "info");
}
