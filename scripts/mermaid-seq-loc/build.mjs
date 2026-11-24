#!/usr/bin/env node
/**
 * Builds the position-aware Mermaid parsers: one per grammar in GRAMMARS
 * (sequence diagrams and flowcharts).
 *
 *   node scripts/mermaid-seq-loc/build.mjs                       # rebuild every generated parser
 *   node scripts/mermaid-seq-loc/build.mjs --check               # exit 1 if a checked-in file is stale
 *   node scripts/mermaid-seq-loc/build.mjs --fetch 11.17.2       # download every pristine upstream grammar
 *   node scripts/mermaid-seq-loc/build.mjs --grammar flowchart   # any mode, one grammar only
 *
 * Input per grammar: the pristine upstream grammar vendored at
 * `upstream/<file>.<version>.jison` and its patch (`loc.patch` for sequence,
 * `flowchart.loc.patch` for flowcharts). The patch is applied with
 * `patch --fuzz=0`, so a patch that no longer fits a new upstream version
 * fails loudly instead of applying somewhere else.
 *
 * Output: `src/features/mermaidInlineEdit/sourcemap/generated/<output>`,
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

/**
 * - `file`: upstream grammar name; vendored as `upstream/<file>.<version>.jison`.
 * - `patchPrefix`: `<prefix>.patch`, or `<prefix>.<version>.patch` (see patchFileFor).
 * - `output`: generated parser in src/features/mermaidInlineEdit/sourcemap/generated/.
 * - `upstreamPath`: the grammar's path in the mermaid-js/mermaid repository.
 */
export const GRAMMARS = {
  sequence: {
    file: 'sequenceDiagram',
    patchPrefix: 'loc',
    output: 'sequenceLocParser.js',
    upstreamPath: 'packages/mermaid/src/diagrams/sequence/parser/sequenceDiagram.jison',
  },
  flowchart: {
    file: 'flow',
    patchPrefix: 'flowchart.loc',
    output: 'flowchartLocParser.js',
    upstreamPath: 'packages/mermaid/src/diagrams/flowchart/parser/flow.jison',
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const grammarOf = (name) => {
  const grammar = GRAMMARS[name];
  if (!grammar) throw new Error(`unknown grammar "${name}" (known: ${Object.keys(GRAMMARS).join(', ')})`);
  return grammar;
};
const upstreamPath = (version, name) => join(here, 'upstream', `${grammarOf(name).file}.${version}.jison`);
const versionParts = (version) => version.split(/[.-]/).slice(0, 3).map(Number);
const compareVersions = (a, b) => {
  const [pa, pb] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `<prefix>.patch` fits the pinned Mermaid. When a newer upstream grammar
 * changes a line the patch touches, a `<prefix>.<version>.patch` cut from
 * that grammar sits beside it, so the weekly sync job can build the next
 * version before the pin moves. A target version uses the newest
 * `<prefix>.<v>.patch` with v <= target, otherwise `<prefix>.patch`. The
 * upgrade PR renames that file to `<prefix>.patch`.
 */
export function patchFileFor(version, name = 'sequence') {
  const { patchPrefix } = grammarOf(name);
  const pattern = new RegExp(`^${escapeRegExp(patchPrefix)}\\.(\\d+\\.\\d+\\.\\d+)\\.patch$`);
  const candidates = readdirSync(here)
    .map((file) => pattern.exec(file)?.[1])
    .filter((v) => v && compareVersions(v, version) <= 0)
    .sort(compareVersions);
  return candidates.length ? `${patchPrefix}.${candidates.at(-1)}.patch` : `${patchPrefix}.patch`;
}
const patchPath = (version, name) => join(here, patchFileFor(version, name));

export const outputPathFor = (name) =>
  join(repoRoot, 'src/features/mermaidInlineEdit/sourcemap/generated', grammarOf(name).output);
/** The sequence parser's output path (kept for existing callers). */
export const outputPath = outputPathFor('sequence');

function applyPatch(version, name) {
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-seq-loc-'));
  try {
    const out = join(dir, `${grammarOf(name).file}.jison`);
    // -o writes the result elsewhere: the vendored upstream file stays pristine.
    // -r - : no .rej files. --fuzz=0: every context line must match exactly.
    execFileSync(
      'patch',
      ['--batch', '--forward', '--fuzz=0', '-r', '-', '-o', out, upstreamPath(version, name), patchPath(version, name)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return readFileSync(out, 'utf8');
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    throw new Error(`${patchFileFor(version, name)} does not apply to upstream ${version}:\n${detail || error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function compile(grammar, patchFile, name) {
  const require = createRequire(import.meta.url);
  const jison = require('jison');
  const generator = new jison.Generator(grammar, { moduleType: 'js', 'token-stack': true });
  if (generator.conflicts) throw new Error(`${patchFile}: the patched ${name} grammar has ${generator.conflicts} conflicts`);
  const source = generator.generate({ moduleMain: '() => {}' });
  return [
    '/* eslint-disable */',
    '// @ts-nocheck',
    `// GENERATED FILE, DO NOT EDIT. Rebuild: node scripts/mermaid-seq-loc/build.mjs`,
    `// Source: mermaid@${MERMAID_VERSION} ${grammarOf(name).upstreamPath}`,
    `// (MIT, (c) Knut Sveidqvist and the Mermaid contributors) plus scripts/mermaid-seq-loc/${patchFile}.`,
    `export const UPSTREAM_MERMAID_VERSION = '${MERMAID_VERSION}';`,
    source,
    'parser.parser = parser;',
    'export { parser };',
    'export default parser;',
    '',
  ].join('\n');
}

/** The generated parser source for one grammar (default: sequence). */
export function build(version = MERMAID_VERSION, name = 'sequence') {
  return compile(applyPatch(version, name), patchFileFor(version, name), name);
}

async function fetchUpstream(version, name) {
  const url = `https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid%40${version}/${grammarOf(name).upstreamPath}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  writeFileSync(upstreamPath(version, name), await response.text());
  console.log(`wrote ${upstreamPath(version, name)}`);
}

/** Splits `--grammar <name>` off the arguments. */
function parseArgs(args) {
  const rest = [];
  let names = Object.keys(GRAMMARS);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--grammar') {
      if (!args[i + 1]) throw new Error('usage: --grammar <name>');
      grammarOf(args[i + 1]);
      names = [args[i + 1]];
      i += 1;
    } else rest.push(args[i]);
  }
  return { names, rest };
}

async function main(argv) {
  const { names, rest: args } = parseArgs(argv);
  if (args[0] === '--fetch') {
    if (!args[1]) throw new Error('usage: --fetch <mermaid version>');
    for (const name of names) await fetchUpstream(args[1], name);
    return;
  }
  let stale = false;
  for (const name of names) {
    const generated = build(MERMAID_VERSION, name);
    const target = outputPathFor(name);
    if (args[0] === '--check') {
      if (readFileSync(target, 'utf8') !== generated) {
        console.error(`${target} is stale. Run: node scripts/mermaid-seq-loc/build.mjs`);
        stale = true;
      } else {
        console.log(`${name}: generated parser is up to date`);
      }
      continue;
    }
    writeFileSync(target, generated);
    console.log(`wrote ${target} (${Buffer.byteLength(generated)} bytes)`);
  }
  if (stale) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
