import forgeGlobal from '@/model/globals/forgeGlobal';

/**
 * Detect whether the app is running as an embed macro.
 *
 * Forge module keys for embed (set via manifest.yml):
 *   - `zenuml-embed-macro`       (full / diagramly variants)
 *   - `zenuml-embed-macro-lite`  (lite variant)
 *
 * Both variants share the `zenuml-embed-macro` prefix, which is what we match on.
 */
export function isEmbedMode(): boolean {
  const moduleKey = forgeGlobal.forgeContext?.moduleKey;
  return typeof moduleKey === 'string' && moduleKey.startsWith('zenuml-embed-macro');
}
