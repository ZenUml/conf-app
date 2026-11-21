/**
 * Development environments deployed with a non-default Connect key.
 *
 * Confluence allows one installation per Connect key on a site, so two Forge
 * environments of the same app can share a site only when one of them is
 * deployed with its own key (measured 2026-11-21: a second Lite environment
 * with the fixed key got 409 APP_ALREADY_INSTALLED; with a different key it
 * installed next to the first). Such an environment registers its
 * custom-content types as `ac:<its key>:<content key>`, so every backend check
 * that names our types must know the key. The frontend gets it at build time
 * (CONNECT_KEY_OVERRIDE); the backend serves every environment from one
 * deployment, so it looks the key up here by the verified Forge environment.
 *
 * Development environments only. Staging and production keep the variant's
 * fixed key, and callers that hold a verified FIT ignore this table unless the
 * FIT says DEVELOPMENT. How to add an environment:
 * docs/reference/dev-connect-key.md.
 */
export interface DevConnectKey {
  /** Forge app ID (the variant), as in package.json's forge:deploy:* scripts. */
  appId: string;
  /** Forge environment UUID, from `forge environments list`. */
  environmentId: string;
  /** The CONNECT_KEY_OVERRIDE this environment is built and deployed with. */
  connectKey: string;
}

export const DEV_CONNECT_KEYS: readonly DevConnectKey[] = [
  {
    // Lite, environment `alt-key`.
    appId: '8ad26115-211f-4216-971b-0540f606303d',
    environmentId: '4d8bcead-f943-4b68-8298-648e626e6891',
    connectKey: 'com.zenuml.confluence-addon-lite-alt',
  },
];

/** Every non-default Connect key registered for this app, across its development environments. */
export function devConnectKeysForApp(appId: string, table: readonly DevConnectKey[] = DEV_CONNECT_KEYS): string[] {
  return table.filter((entry) => entry.appId === appId).map((entry) => entry.connectKey);
}

/**
 * The non-default Connect key of one development environment, or undefined.
 * `environmentId` may be the bare UUID or the FIT's environment ARI
 * (`ari:cloud:ecosystem::environment/<appId>/<uuid>`).
 */
export function devConnectKeyFor(
  appId: string,
  environmentId: string,
  table: readonly DevConnectKey[] = DEV_CONNECT_KEYS,
): string | undefined {
  const uuid = environmentId.slice(environmentId.lastIndexOf('/') + 1);
  return table.find((entry) => entry.appId === appId && entry.environmentId === uuid)?.connectKey;
}
