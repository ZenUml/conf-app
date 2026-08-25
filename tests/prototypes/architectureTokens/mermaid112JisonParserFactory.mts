// Node-only host for the experimental adapter. Do not import from product code.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import type { VersionPinnedJisonParser, VersionPinnedJisonParserFactory } from '../../../src/domain/architectureTokens/jisonFlowchartLocatorAdapter.ts';

const MERMAID_VERSION = '11.12.2';
const GENERATED_SOURCE_PATH = '../src/diagrams/flowchart/parser/flow.jison';
const GENERATED_SOURCE_SHA256 = '39e8a84d459c0f4c1d436892079d58baf4514bd222e0107dd9475571777087d9';

export function mermaid112JisonParserFactory(): VersionPinnedJisonParserFactory & Readonly<{
  mermaidVersion: string;
  generatedParserSha256: string;
}> {
  const packageJson = JSON.parse(fs.readFileSync('node_modules/mermaid/package.json', 'utf8')) as { version?: string };
  if (packageJson.version !== MERMAID_VERSION) throw new Error('Mermaid package version pin mismatch');

  const sourceMap = JSON.parse(fs.readFileSync('node_modules/mermaid/dist/mermaid.js.map', 'utf8')) as {
    sources: string[];
    sourcesContent: (string | null)[];
  };
  const sourceIndex = sourceMap.sources.indexOf(GENERATED_SOURCE_PATH);
  const generatedSource = sourceMap.sourcesContent[sourceIndex];
  if (!generatedSource || createHash('sha256').update(generatedSource).digest('hex') !== GENERATED_SOURCE_SHA256) {
    throw new Error('Mermaid Flowchart generated parser pin mismatch');
  }

  return {
    adapterVersion: 'mermaid-flowchart-jison@11.12.2+39e8a84d',
    mermaidVersion: MERMAID_VERSION,
    generatedParserSha256: GENERATED_SOURCE_SHA256,
    createParser(): VersionPinnedJisonParser {
      const sandbox: Record<string, unknown> = {};
      const withoutExports = generatedSource.replace(/\s*export \{ parser \};\s*export default parser;\s*$/, '');
      vm.runInNewContext(`${withoutExports}\nglobalThis.__flowParser = parser;`, sandbox, {
        filename: 'mermaid-11.12.2-flow.jison.generated.js',
      });
      return sandbox.__flowParser as VersionPinnedJisonParser;
    },
  };
}
