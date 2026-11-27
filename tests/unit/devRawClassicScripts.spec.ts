import { describe, expect, it } from 'vitest';
import path from 'path';
// @ts-expect-error -- plain .mjs build helper without types
import { rawClassicScriptFile, devRawClassicScripts } from '../../scripts/build/devRawClassicScripts.mjs';

const ROOT = path.resolve('/repo');
const RECORDER =
  '/node_modules/.pnpm/mixpanel-browser@2.83.0/node_modules/mixpanel-browser/dist/mixpanel-recorder.min.js';

describe('rawClassicScriptFile', () => {
  it('serves the Mixpanel recorder from disk when the SDK requests it', () => {
    expect(rawClassicScriptFile(RECORDER, ROOT)).toBe(path.join(ROOT, RECORDER));
  });

  it('serves an /@fs/ path as that absolute file', () => {
    const abs = `/elsewhere/node_modules/mixpanel-browser/dist/mixpanel-recorder.min.js`;
    expect(rawClassicScriptFile(`/@fs${abs}`, ROOT)).toBe(path.resolve(abs));
  });

  it.each([
    ['the `?url` module import', `${RECORDER}?url`],
    ['a versioned module request', `${RECORDER}?v=abc123`],
    ['another file of the package', '/node_modules/mixpanel-browser/dist/mixpanel.module.js'],
    ['app source', '/src/utils/analytics/mixpanelClient.ts'],
    ['a malformed escape', '/node_modules/%E0%A4%A/mixpanel-browser/dist/mixpanel-recorder.min.js'],
    ['an empty url', ''],
  ])('leaves %s to Vite', (_label, url) => {
    expect(rawClassicScriptFile(url, ROOT)).toBeNull();
  });

  it('does not resolve outside the project root', () => {
    const url = '/node_modules/../../etc/node_modules/mixpanel-browser/dist/mixpanel-recorder.min.js';
    expect(rawClassicScriptFile(url, ROOT)).toBeNull();
  });
});

describe('devRawClassicScripts', () => {
  it('runs only under the dev server', () => {
    expect(devRawClassicScripts().apply).toBe('serve');
  });
});
