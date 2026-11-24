#!/usr/bin/env node
/**
 * Extracts diagram sources from Mermaid's own test files into a fixture for
 * the position parser's corpus test.
 *
 *   node scripts/mermaid-seq-loc/extract-corpus.mjs [version]                       # sequence
 *   node scripts/mermaid-seq-loc/extract-corpus.mjs [version] --grammar flowchart   # flowchart
 *
 * sequence: downloads packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js
 * at the tag `mermaid@<version>` and keeps every string or template literal
 * that contains "sequenceDiagram". Writes
 * src/features/mermaidInlineEdit/sourcemap/__fixtures__/upstream-sequence-corpus.<version>.json
 *
 * flowchart: lists packages/mermaid/src/diagrams/flowchart/parser/ at the same
 * tag (GitHub contents API), downloads every `*.spec.js` / `*.spec.ts` in it
 * and keeps every string or template literal with a line that starts with
 * `graph` or `flowchart`. Interpolated templates are expanded only in the
 * `it.each([...strings])` form; any other interpolated template is skipped and
 * counted. Writes `upstream-flowchart-corpus.<version>.json` beside the other.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MERMAID_VERSION } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const grammarAt = args.indexOf('--grammar');
const grammar = grammarAt >= 0 ? args.splice(grammarAt, 2)[1] : 'sequence';
const version = args[0] ?? MERMAID_VERSION;
const raw = (path) => `https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid%40${version}/${path}`;

const CORPORA = {
  sequence: {
    async files() {
      return ['packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js'];
    },
    keep: (text) => text.includes('sequenceDiagram'),
    strictTemplates: true,
  },
  flowchart: {
    async files() {
      const dir = 'packages/mermaid/src/diagrams/flowchart/parser';
      const url = `https://api.github.com/repos/mermaid-js/mermaid/contents/${dir}?ref=mermaid%40${version}`;
      const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
      const entries = await response.json();
      return entries
        .filter((e) => e.type === 'file' && /\.spec\.[jt]s$/.test(e.name))
        .map((e) => `${dir}/${e.name}`)
        .sort();
    },
    keep: (text) => /(?:^|\n)[^\S\n]*(?:graph|flowchart)(?![\w-])/.test(text),
    strictTemplates: false,
  },
};
const corpus = CORPORA[grammar];
if (!corpus) throw new Error(`unknown grammar "${grammar}" (known: ${Object.keys(CORPORA).join(', ')})`);

let skippedTemplates = 0;

/** String and template literals, in file order, read with the TypeScript parser. */
function literals(source, fileName) {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const kind = fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    if (ts.isTemplateExpression(node) && corpus.keep(node.getText())) {
      const expanded = expandEach(ts, node);
      if (expanded) out.push(...expanded);
      else if (corpus.strictTemplates) throw new Error(`unsupported interpolated source at offset ${node.pos}`);
      else skippedTemplates += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/**
 * A template with `${x}` inside `it.each(['a', 'b'])(name, (x) => ...)`:
 * one source per table value. Anything else: null.
 */
function expandEach(ts, template) {
  let node = template.parent;
  while (node && !(ts.isCallExpression(node) && ts.isCallExpression(node.expression))) node = node.parent;
  const each = node?.expression;
  const table = each?.arguments?.[0];
  const ok =
    each?.expression.getText() === 'it.each' &&
    table &&
    ts.isArrayLiteralExpression(table) &&
    table.elements.every((e) => ts.isStringLiteral(e)) &&
    template.templateSpans.every((span) => ts.isIdentifier(span.expression));
  if (!ok) return null;
  return table.elements.map((value) =>
    template.head.text + template.templateSpans.map((span) => value.text + span.literal.text).join(''),
  );
}

const files = await corpus.files();
const all = [];
for (const path of files) {
  const response = await fetch(raw(path));
  if (!response.ok) throw new Error(`GET ${raw(path)} -> ${response.status}`);
  all.push(...literals(await response.text(), path));
}
const sources = [...new Set(all.filter(corpus.keep))];
const fixture = {
  source: `mermaid@${version} ${files.join(', ')}`,
  license:
    'Extracted from Mermaid (https://github.com/mermaid-js/mermaid), MIT License, ' +
    'Copyright (c) 2014 - 2022 Knut Sveidqvist. Test input only.',
  sources,
};
const out = resolve(
  here,
  '../../src/features/mermaidInlineEdit/sourcemap/__fixtures__',
  `upstream-${grammar}-corpus.${version}.json`,
);
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${sources.length} sources to ${join(out)}${skippedTemplates ? ` (${skippedTemplates} interpolated templates skipped)` : ''}`);
