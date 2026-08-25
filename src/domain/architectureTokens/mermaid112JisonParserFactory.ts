import flowParser, { MERMAID112_FLOWCHART_JISON_ARTIFACT } from './generated/mermaid112FlowParser.js';
import type { VersionPinnedJisonParser, VersionPinnedJisonParserFactory } from './jisonFlowchartLocatorAdapter';

/**
 * Browser-safe host for the exact Jison parser extracted from Mermaid 11.12.2.
 *
 * The generated artifact is checked in with its Mermaid source-map hash.  This
 * module deliberately has no Node, filesystem, VM, or Mermaid-private-runtime
 * imports: the parser is a pinned build artifact, not a runtime source-map read.
 */
const EXPECTED_CONTRACT = Object.freeze({
  mermaidVersion: '11.12.2',
  sourcePath: '../src/diagrams/flowchart/parser/flow.jison',
  sourceSha256: '39e8a84d459c0f4c1d436892079d58baf4514bd222e0107dd9475571777087d9',
});

type GeneratedFlowParser = VersionPinnedJisonParser & Readonly<{
  Parser?: new () => VersionPinnedJisonParser;
}>;

function isPinnedArtifact(): boolean {
  return MERMAID112_FLOWCHART_JISON_ARTIFACT.mermaidVersion === EXPECTED_CONTRACT.mermaidVersion
    && MERMAID112_FLOWCHART_JISON_ARTIFACT.sourcePath === EXPECTED_CONTRACT.sourcePath
    && MERMAID112_FLOWCHART_JISON_ARTIFACT.sourceSha256 === EXPECTED_CONTRACT.sourceSha256
    && typeof (flowParser as GeneratedFlowParser).Parser === 'function';
}

function createIsolatedParser(): VersionPinnedJisonParser {
  const Parser = (flowParser as GeneratedFlowParser).Parser;
  if (!Parser) throw new Error('Pinned Flowchart Jison parser constructor is unavailable.');
  const parser = new Parser();

  // `parse()` creates a per-parse lexer from this object. Copy mutable options
  // so enabling Jison ranges cannot affect another adapter invocation.
  parser.lexer = {
    ...parser.lexer,
    options: { ...parser.lexer.options },
  };
  return parser;
}

export function mermaid112JisonParserFactory(): VersionPinnedJisonParserFactory {
  if (!isPinnedArtifact()) throw new Error('Pinned Mermaid Flowchart Jison artifact contract mismatch.');
  return {
    adapterVersion: `mermaid-flowchart-jison@${EXPECTED_CONTRACT.mermaidVersion}+${EXPECTED_CONTRACT.sourceSha256.slice(0, 8)}`,
    createParser: createIsolatedParser,
  };
}
