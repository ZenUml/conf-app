#!/usr/bin/env node
/* global process */
/**
 * Generates the browser-safe, version-pinned Flowchart Jison artifact.
 *
 * This is a build-maintenance tool only. Runtime code imports the generated
 * artifact and never reads Mermaid source maps or Node-only modules.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MERMAID_VERSION = '11.12.2';
const SOURCE_PATH = '../src/diagrams/flowchart/parser/flow.jison';
const EXPECTED_SHA256 = '39e8a84d459c0f4c1d436892079d58baf4514bd222e0107dd9475571777087d9';
const root = process.cwd();
const packagePath = path.join(root, 'node_modules/mermaid/package.json');
const sourceMapPath = path.join(root, 'node_modules/mermaid/dist/mermaid.js.map');
const outputPath = path.join(root, 'src/domain/architectureTokens/generated/mermaid112FlowParser.js');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (packageJson.version !== MERMAID_VERSION) {
  throw new Error(`Expected Mermaid ${MERMAID_VERSION}; found ${packageJson.version ?? 'unknown'}.`);
}

const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
const index = sourceMap.sources.indexOf(SOURCE_PATH);
const generatedSource = sourceMap.sourcesContent[index];
const sha256 = generatedSource && createHash('sha256').update(generatedSource).digest('hex');
if (!generatedSource || sha256 !== EXPECTED_SHA256) {
  throw new Error('Mermaid Flowchart Jison source-map contract did not match the pinned artifact.');
}

// This leaves parser tokens untouched while removing only line-ending padding
// so generated code passes the repository whitespace check. The pin above is
// always calculated from the exact, unmodified Mermaid source-map entry.
const artifactSource = generatedSource.replace(/[ \t]+$/gm, '');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `/*\n * GENERATED FILE — do not edit by hand.\n * Source: Mermaid ${MERMAID_VERSION}, ${SOURCE_PATH}\n * Source SHA-256: ${EXPECTED_SHA256}\n * Regenerate with: node scripts/generate-mermaid112-flowchart-jison-artifact.mjs\n */\n${artifactSource}\nexport const MERMAID112_FLOWCHART_JISON_ARTIFACT = Object.freeze({\n  mermaidVersion: '${MERMAID_VERSION}',\n  sourcePath: '${SOURCE_PATH}',\n  sourceSha256: '${EXPECTED_SHA256}',\n});\n`);
