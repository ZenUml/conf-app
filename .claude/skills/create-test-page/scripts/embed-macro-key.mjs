// A Forge ADF extensionKey is either the bare module key or
// `<app-id>/<env-id>/static/<module key>`. Compare the whole last segment:
// a substring test makes `zenuml-embed-macro` also match `zenuml-embed-macro-lite`.
export function matchesMacroKey(extensionKey, key) {
  if (!extensionKey) return false;
  return extensionKey === key || extensionKey.endsWith(`/${key}`);
}
