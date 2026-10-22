/** The four shipped variants. Mirrors the `forge:deploy:*` scripts in package.json. */
export type Variant = 'lite' | 'full' | 'diagramly' | 'asyncapi';

export interface VariantProfile {
  variant: Variant;
  /** APP_ID from package.json's forge:deploy:<variant>:* scripts. Public; also in manifest.yml. */
  appId: string;
  /** CONNECT_KEY — the `ac:<connectKey>:` half of every custom-content type this variant writes. */
  connectKey: string;
  /** SEQUENCE_MACRO_KEY — hosts sequence/mermaid/plantuml, and on asyncapi the AsyncAPI editor. */
  sequenceMacroKey: string;
  /** Content keys this variant actually writes. Empty types are never probed. */
  contentKeys: string[];
  /** LITE_KEY_SUFFIX — appended to every macro module key. Lite only. */
  macroKeySuffix: string;
}

/**
 * Every variant's fixed identity, straight from package.json's deploy scripts.
 *
 * Deliberately duplicated here rather than imported from src/: this module runs
 * in the Cloudflare Worker, where `forgeGlobal` (which is how the frontend
 * picks a variant — it reads its own build) does not exist and would be the
 * wrong question anyway. The frontend asks "which variant am I?"; this asks
 * "which variant is installed over there?", which only the site can answer.
 */
export const VARIANTS: readonly VariantProfile[] = [
  {
    variant: 'lite',
    appId: '8ad26115-211f-4216-971b-0540f606303d',
    connectKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro',
    contentKeys: ['zenuml-content-sequence', 'zenuml-content-graph'],
    macroKeySuffix: '-lite',
  },
  {
    variant: 'full',
    appId: 'd9e4002b-120b-426b-834b-402a4a5adce7',
    connectKey: 'com.zenuml.confluence-addon',
    sequenceMacroKey: 'zenuml-sequence-macro',
    contentKeys: ['zenuml-content-sequence', 'zenuml-content-graph'],
    macroKeySuffix: '',
  },
  {
    // Diagramly stores EVERY diagram under one key — see ApWrapper2's
    // DIAGRAMLY_CUSTOM_CONTENT_TYPES comment and #524, where probing for the
    // lite/full types on Diagramly returned nothing and every discovery
    // caller came back empty.
    variant: 'diagramly',
    appId: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
    connectKey: 'gptdock-confluence',
    sequenceMacroKey: 'gpt-diagram-macro',
    contentKeys: ['gpt-custom-content-key'],
    macroKeySuffix: '',
  },
  {
    // `ac:my-api:async-api-doc` is inherited from the standalone
    // AsyncAPI-Conf-V2 app so migrated customer documents stay readable.
    variant: 'asyncapi',
    appId: '49017727-af19-4ab6-8d5a-7d28108936b6',
    connectKey: 'my-api',
    sequenceMacroKey: 'zenuml-asyncapi-macro',
    contentKeys: ['async-api-doc'],
    macroKeySuffix: '',
  },
] as const;

/** `ac:<connectKey>:<contentKey>` — ApWrapper2.customContentType's shape, for a variant we are probing rather than running as. */
export function customContentTypesFor(profile: VariantProfile): string[] {
  return profile.contentKeys.map((key) => customContentTypeOf(profile, key));
}

/** Every variant's profile by its Forge app id; undefined for an app id that is not ours. */
export function variantByAppId(appId: string): VariantProfile | undefined {
  return VARIANTS.find((v) => v.appId === appId);
}

/** The Forge app id of one variant. */
export function appIdOf(variant: Variant): string {
  const profile = VARIANTS.find((v) => v.variant === variant);
  if (!profile) throw new Error(`unknown variant: ${variant}`);
  return profile.appId;
}

/**
 * `ac:<connectKey>:<key>` for one content key; defaults to the variant's first (primary) content key.
 * Lite/full: zenuml-content-sequence. Diagramly's only key is gpt-custom-content-key.
 */
export function customContentTypeOf(profile: VariantProfile, contentKey: string = profile.contentKeys[0]): string {
  return `ac:${profile.connectKey}:${contentKey}`;
}
