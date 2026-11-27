// E2E profile (zenuml-lite@stg, zenuml-lite@dev, ...) to the variant the test
// plan is built for. Any environment of a Lite or Full profile maps to its
// variant; other profiles keep their name before the '@'.
export function variantForApp(app) {
  if (/^zenuml-lite@/.test(app ?? '')) return 'lite';
  if (/^zenuml-full@/.test(app ?? '')) return 'full';
  return app?.split('@')[0];
}
