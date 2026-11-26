/**
 * Which Forge install an API-created test page renders with.
 *
 * A bare macro key in page ADF (`extensionKey: zenuml-sequence-macro-lite`,
 * the shape migrated Connect pages carry) names no app environment. When a
 * site has two environments of the same app installed, Confluence picks one
 * of them itself. On lite-dev on 2026-11-22 it picked the PR dev environment
 * `pr-1284` instead of the PR slot `pr`, so the agent-link E2E of PR #1297
 * read the wrong build's backend URL and failed.
 *
 * So fixtures write the full Forge key `<appId>/<environmentId>/static/<key>`
 * of the environment under test, the same node shape Confluence writes when a
 * user inserts the macro (see src/utils/byline/addToPage.ts). The bare key is
 * kept for one legacy case, and only where it is unambiguous.
 *
 * Pure: no Playwright, no test config, so tests/unit can cover it.
 */

export interface ForgeExtensionRow {
  appId: string;
  environmentId: string;
  environmentKey: string;
  /** Module key, e.g. `zenuml-sequence-macro-lite`. */
  key: string;
}

export interface ForgeIdentity {
  appId: string;
  environmentId: string;
  environmentKey: string;
  /** How many environments of this app expose the macro on the site. */
  environmentCount: number;
}

/**
 * Confluence GraphQL query the editor's macro browser runs
 * (FetchPreFilteredForgeAppsQuery, trimmed). `includeHidden` is required:
 * without it the field fails with a NullPointerException (observed 2026-11-23).
 */
export const FORGE_MACROS_QUERY = `query E2EForgeMacros($cloudId: ID!, $context: ConfluenceExtensionRenderingContextInput, $types: [String], $includeHidden: Boolean) {
  confluence_forgeExtensionsByType(cloudId: $cloudId, context: $context, types: $types, includeHidden: $includeHidden) {
    appId
    environmentId
    environmentKey
    key
  }
}`;

export function selectForgeIdentity(
  rows: ForgeExtensionRow[],
  want: { appId: string; moduleKey: string; environmentKey?: string },
): ForgeIdentity {
  const matches = rows.filter((r) => r.appId === want.appId && r.key === want.moduleKey);
  const keys = [...new Set(matches.map((r) => r.environmentKey))];
  const describe = `app ${want.appId} macro ${want.moduleKey}: ${keys.length} environments installed (${keys.join(', ') || 'none'})`;
  let chosen: ForgeExtensionRow | undefined;
  if (want.environmentKey) {
    chosen = matches.find((r) => r.environmentKey === want.environmentKey);
    if (!chosen) throw new Error(`Forge environment "${want.environmentKey}" not installed for ${describe}`);
  } else {
    if (keys.length !== 1) {
      throw new Error(`Cannot choose a Forge environment for ${describe}; set forgeEnvironment on the E2E profile or E2E_FORGE_ENVIRONMENT`);
    }
    chosen = matches[0];
  }
  return {
    appId: chosen.appId,
    environmentId: chosen.environmentId,
    environmentKey: chosen.environmentKey,
    environmentCount: keys.length,
  };
}

/** Macro node pinned to one Forge environment. `guestParams` is what the macro reads as `extension.config`. */
export function forgeMacroNode(
  identity: { appId: string; environmentId: string },
  moduleKey: string,
  guestParams: Record<string, string>,
  localId: string,
) {
  const path = `${identity.appId}/${identity.environmentId}/static/${moduleKey}`;
  return {
    type: 'extension',
    attrs: {
      layout: 'default',
      extensionType: 'com.atlassian.ecosystem',
      extensionKey: path,
      parameters: {
        layout: 'extension',
        extensionId: `ari:cloud:ecosystem::extension/${path}`,
        guestParams,
      },
      localId,
    },
  };
}

/** Bare-key node, as on a page migrated from the Connect app. Unambiguous only with one environment installed. */
export function legacyMacroNode(
  moduleKey: string,
  title: string,
  macroParams: Record<string, { value: string }>,
) {
  return {
    type: 'extension',
    attrs: {
      layout: 'default',
      extensionType: 'com.atlassian.confluence.macro.core',
      extensionKey: moduleKey,
      parameters: {
        macroParams,
        macroMetadata: {
          macroId: { value: '' },
          schemaVersion: { value: '1' },
          placeholder: [{ type: 'icon', data: { url: '/image/zenuml_logo.png' } }],
          title,
        },
      },
      localId: '',
    },
  };
}
