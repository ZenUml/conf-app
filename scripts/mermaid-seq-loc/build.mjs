#!/usr/bin/env node
/**
 * Builds the position-aware Mermaid sequence parser.
 *
 *   node scripts/mermaid-seq-loc/build.mjs                 # rebuild the generated parser
 *   node scripts/mermaid-seq-loc/build.mjs --check         # exit 1 if the checked-in file is stale
 *   node scripts/mermaid-seq-loc/build.mjs --fetch 11.17.2 # download the pristine upstream grammar
 *
 * Input: the pristine upstream grammar vendored at
 * `upstream/sequenceDiagram.<version>.jison` and `loc.patch`. The patch is
 * applied with `patch --fuzz=0`, so a patch that no longer fits a new upstream
 * version fails loudly instead of applying somewhere else.
 *
 * Output: `src/features/mermaidInlineEdit/sourcemap/generated/sequenceLocParser.js`,
 * compiled the way upstream compiles it (`.build/jisonTransformer.ts`).
 *
 * To move to a new Mermaid version: `--fetch <version>`, update
 * MERMAID_VERSION below, rebuild, run the sourcemap tests.
 */
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Must equal the installed `mermaid` package version. The environment variable
 * exists only for the weekly upstream-sync workflow, which builds against the
 * newest published Mermaid inside the CI workspace without committing anything.
 */
export const MERMAID_VERSION = process.env.MERMAID_SEQ_LOC_VERSION || '11.17.2';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const upstreamPath = (version) => join(here, 'upstream', `sequenceDiagram.${version}.jison`);
const versionParts = (version) => version.split(/[.-]/).slice(0, 3).map(Number);
const compareVersions = (a, b) => {
  const [pa, pb] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

/**
 * `loc.patch` fits the pinned Mermaid. When a newer upstream grammar changes a
 * line the patch touches, a `loc.<version>.patch` cut from that grammar sits
 * beside it, so the weekly sync job can build the next version before the pin
 * moves. A target version uses the newest `loc.<v>.patch` with v <= target,
 * otherwise `loc.patch`. The upgrade PR renames that file to `loc.patch`.
 */
export function patchFileFor(version) {
  const candidates = readdirSync(here)
    .map((name) => /^loc\.(\d+\.\d+\.\d+)\.patch$/.exec(name)?.[1])
    .filter((v) => v && compareVersions(v, version) <= 0)
    .sort(compareVersions);
  return candidates.length ? `loc.${candidates.at(-1)}.patch` : 'loc.patch';
}
const patchPath = (version) => join(here, patchFileFor(version));
export const outputPath = join(
  repoRoot,
  'src/features/mermaidInlineEdit/sourcemap/generated/sequenceLocParser.js',
);

function applyPatch(version) {
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-seq-loc-'));
  try {
    const out = join(dir, 'sequenceDiagram.jison');
    // -o writes the result elsewhere: the vendored upstream file stays pristine.
    // -r - : no .rej files. --fuzz=0: every context line must match exactly.
    execFileSync(
      'patch',
      ['--batch', '--forward', '--fuzz=0', '-r', '-', '-o', out, upstreamPath(version), patchPath(version)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return readFileSync(out, 'utf8');
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    throw new Error(`${patchFileFor(version)} does not apply to upstream ${version}:\n${detail || error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function compile(grammar, patchFile) {
  const require = createRequire(import.meta.url);
  const jison = require('jison');
  const generator = new jison.Generator(grammar, { moduleType: 'js', 'token-stack': true });
  const source = generator.generate({ moduleMain: '() => {}' });
  return [
    '/* eslint-disable */',
    '// @ts-nocheck',
    `// GENERATED FILE, DO NOT EDIT. Rebuild: node scripts/mermaid-seq-loc/build.mjs`,
    `// Source: mermaid@${MERMAID_VERSION} packages/mermaid/src/diagrams/sequence/parser/sequenceDiagram.jison`,
    `// (MIT, (c) Knut Sveidqvist and the Mermaid contributors) plus scripts/mermaid-seq-loc/${patchFile}.`,
    `export const UPSTREAM_MERMAID_VERSION = '${MERMAID_VERSION}';`,
    source,
    'parser.parser = parser;',
    'export { parser };',
    'export default parser;',
    '',
  ].join('\n');
}

export function build(version = MERMAID_VERSION) {
  return compile(applyPatch(version), patchFileFor(version));
}

async function fetchUpstream(version) {
  const url =
    `https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid%40${version}` +
    '/packages/mermaid/src/diagrams/sequence/parser/sequenceDiagram.jison';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  writeFileSync(upstreamPath(version), await response.text());
  console.log(`wrote ${upstreamPath(version)}`);
}

async function main(args) {
  if (args[0] === '--fetch') {
    if (!args[1]) throw new Error('usage: --fetch <mermaid version>');
    await fetchUpstream(args[1]);
    return;
  }
  const generated = build();
  if (args[0] === '--check') {
    const current = readFileSync(outputPath, 'utf8');
    if (current !== generated) {
      console.error(`${outputPath} is stale. Run: node scripts/mermaid-seq-loc/build.mjs`);
      process.exit(1);
    }
    console.log('generated parser is up to date');
    return;
  }
  writeFileSync(outputPath, generated);
  console.log(`wrote ${outputPath} (${Buffer.byteLength(generated)} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
