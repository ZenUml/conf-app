#!/usr/bin/env node
/**
 * Extracts the sequence diagram sources from Mermaid's own test file into a
 * fixture for the position parser's corpus test.
 *
 *   node scripts/mermaid-seq-loc/extract-corpus.mjs [version]
 *
 * Downloads packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js at
 * the tag `mermaid@<version>` and writes every string or template literal that
 * contains "sequenceDiagram" to
 * src/features/mermaidInlineEdit/sourcemap/__fixtures__/upstream-sequence-corpus.<version>.json
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MERMAID_VERSION } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const version = process.argv[2] ?? MERMAID_VERSION;
const url =
  `https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid%40${version}` +
  '/packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js';

const response = await fetch(url);
if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
const spec = await response.text();

/** String and template literals, in file order, read with the TypeScript parser. */
function literals(source) {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const file = ts.createSourceFile('spec.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    if (ts.isTemplateExpression(node) && node.getText().includes('sequenceDiagram')) {
      out.push(...expandEach(ts, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/**
 * A template with `${x}` inside `it.each(['a', 'b'])(name, (x) => ...)`:
 * one source per table value. Anything else is not supported.
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
  if (!ok) throw new Error(`unsupported interpolated sequence source at offset ${template.pos}`);
  return table.elements.map((value) =>
    template.head.text + template.templateSpans.map((span) => value.text + span.literal.text).join(''),
  );
}

const sources = [...new Set(literals(spec).filter((s) => s.includes('sequenceDiagram')))];
const fixture = {
  source: `mermaid@${version} packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js`,
  license:
    'Extracted from Mermaid (https://github.com/mermaid-js/mermaid), MIT License, ' +
    'Copyright (c) 2014 - 2022 Knut Sveidqvist. Test input only.',
  sources,
};
const out = resolve(
  here,
  '../../src/features/mermaidInlineEdit/sourcemap/__fixtures__',
  `upstream-sequence-corpus.${version}.json`,
);
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${sources.length} sources to ${join(out)}`);
