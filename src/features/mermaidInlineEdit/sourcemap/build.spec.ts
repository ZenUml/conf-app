import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPSTREAM_MERMAID_VERSION } from './generated/sequenceLocParser.js';

const root = resolve(__dirname, '../../../..');

describe('generated position parser', () => {
  it('is up to date with the vendored upstream grammar and loc.patch', async () => {
    const { build, outputPath } = await import('../../../../scripts/mermaid-seq-loc/build.mjs');
    expect(readFileSync(outputPath, 'utf8')).toBe(build());
  });

  it('was built from the installed mermaid version', () => {
    const require = createRequire(resolve(root, 'package.json'));
    const installed = require('mermaid/package.json').version;
    expect(UPSTREAM_MERMAID_VERSION).toBe(installed);
  });
});
