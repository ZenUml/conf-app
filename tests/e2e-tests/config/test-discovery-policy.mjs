// Shared by actual Playwright collection and PR coverage authorization.
// An opt-in test remains documented coverage, but is not default PR coverage.
export const OPT_IN_TESTS = [{
  file: 'insert/byline-activation.spec.ts',
  glob: '**/byline-activation.spec.ts',
  environment: 'BYLINE_ACTIVATION_LIVE',
  reason: 'Ad hoc live test; also needs a prepared page and BYLINE_PAGE_ID.',
}];
export const optInTestIgnores = (env = process.env) => OPT_IN_TESTS.filter(test => !env[test.environment]).map(test => test.glob);
export const isDefaultPrSpec = file => !OPT_IN_TESTS.some(test => test.file === file);
