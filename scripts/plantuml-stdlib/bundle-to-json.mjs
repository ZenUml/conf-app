#!/usr/bin/env node
// Convert an official @plantuml/core stdlib bundle (e.g. c4.min.js from
// https://plantuml.github.io/plantuml/js-plantuml/) into the plain JSON that
// src/utils/plantuml/stdlib.ts hands to the engine through
// PLANTUML_STDLIB_LOADER (ADR-0010). The bundle is a script that assigns data to
// window.PLANTUML_STDLIB*; this script never runs it. It parses the file with
// the TypeScript parser and accepts only literal values (strings, arrays of
// strings, `'…'.split(";")`, object literals), failing on anything else, so a
// tampered bundle cannot smuggle code into the macro.
//
// usage: node scripts/plantuml-stdlib/bundle-to-json.mjs <bundle.min.js> <out.json>
import fs from 'node:fs';
import ts from 'typescript';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('usage: bundle-to-json.mjs <bundle.min.js> <out.json>');
  process.exit(2);
}

const source = ts.createSourceFile(inputPath, fs.readFileSync(inputPath, 'utf8'), ts.ScriptTarget.ES2020, true);

function fail(node, why) {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart());
  throw new Error(`${inputPath}:${line + 1}:${character + 1}: ${why}`);
}

function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) fail(prop, 'only plain properties are accepted');
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : fail(prop.name, 'computed key');
      out[key] = literal(prop.initializer);
    }
    return out;
  }
  // '…'.split(";") — how the bundle packs a file's lines.
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'split' && node.arguments.length === 1) {
    return literal(node.expression.expression).split(literal(node.arguments[0]));
  }
  return fail(node, `not a literal: ${ts.SyntaxKind[node.kind]}`);
}

// window.PLANTUML_STDLIB.<lib>.<file> / ["<file>"] → ['PLANTUML_STDLIB', lib, file]
function target(node) {
  const path = [];
  let cur = node;
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    path.unshift(ts.isPropertyAccessExpression(cur) ? cur.name.text : literal(cur.argumentExpression));
    cur = cur.expression;
  }
  if (!ts.isIdentifier(cur) || cur.text !== 'window') fail(node, 'assignment outside window.*');
  return path;
}

const GLOBALS = { PLANTUML_STDLIB: 'files', PLANTUML_STDLIB_JSON: 'json', PLANTUML_STDLIB_INFO: 'info' };
let lib = null;
const out = { files: {}, json: {}, info: null };

function visit(node) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const path = target(node.left);
    const slot = GLOBALS[path[0]] ?? fail(node, `unexpected global ${path[0]}`);
    // `window.X = window.X || {}` initialisers carry no data.
    if (ts.isBinaryExpression(node.right) && node.right.operatorToken.kind === ts.SyntaxKind.BarBarToken) return;
    if (path.length < 2) fail(node, 'assignment to a whole global');
    lib ??= path[1];
    if (path[1] !== lib) fail(node, `second library ${path[1]} in a ${lib} bundle`);
    if (slot === 'info') out.info = literal(node.right);
    else if (path.length === 3) out[slot][path[2]] = literal(node.right);
    else fail(node, `unexpected shape for ${path.join('.')}`);
    return;
  }
  ts.forEachChild(node, visit);
}
visit(source);

if (!lib || !Object.keys(out.files).length) throw new Error(`${inputPath}: no stdlib files found`);
fs.writeFileSync(outputPath, JSON.stringify({ lib, ...out }) + '\n');
console.log(`${lib}: ${Object.keys(out.files).length} files, version ${out.info?.version ?? '?'}, license ${out.info?.license ?? '?'} -> ${outputPath}`);
