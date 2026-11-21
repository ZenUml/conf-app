import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPSTREAM_MERMAID_VERSION as FLOWCHART_VERSION } from './generated/flowchartLocParser.js';
import { UPSTREAM_MERMAID_VERSION } from './generated/sequenceLocParser.js';

const root = resolve(__dirname, '../../../..');
const installedMermaid = () => createRequire(resolve(root, 'package.json'))('mermaid/package.json').version;

describe('generated position parser', () => {
  it('is up to date with the vendored upstream grammar and loc.patch', async () => {
    const { build, outputPath } = await import('../../../../scripts/mermaid-seq-loc/build.mjs');
    expect(readFileSync(outputPath, 'utf8')).toBe(build());
  });

  it('was built from the installed mermaid version', () => {
    expect(UPSTREAM_MERMAID_VERSION).toBe(installedMermaid());
  });
});

describe('generated flowchart position parser', () => {
  it('is up to date with the vendored upstream grammar and flowchart.loc.patch', async () => {
    const { build, MERMAID_VERSION, outputPathFor } = await import('../../../../scripts/mermaid-seq-loc/build.mjs');
    expect(readFileSync(outputPathFor('flowchart'), 'utf8')).toBe(build(MERMAID_VERSION, 'flowchart'));
  });

  it('was built from the installed mermaid version', () => {
    expect(FLOWCHART_VERSION).toBe(installedMermaid());
  });
});
