import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { sliceUtf8ByteSpan } from '../../../src/domain/architectureTokens/utf8Locator.ts';
import { extractFlowchartNodeOccurrenceEvidence } from '../../../src/domain/architectureTokens/jisonFlowchartLocatorAdapter.ts';
import { mermaid112JisonParserFactory } from './mermaid112JisonParserFactory.mts';

const supportedRaw = [
  'flowchart TD',
  '  A[Start 😀] --> B{Check}',
  '  A --> C[Child]',
  '  C --> D --> E[End]',
  '  subgraph Group[Container]',
  '    D --> F[Inside]',
  '  end',
  '  X[Standalone]',
].join('\r\n');

const fixtures = [
  { name: 'CRLF, Unicode, repeated IDs, chained edge, and subgraph', source: supportedRaw, publicValid: true, outcome: 'ok' },
  { name: 'frontmatter', source: '---\ntitle: Example\n---\nflowchart TD\nA --> B', publicValid: true, outcome: 'frontmatter' },
  { name: 'ordinary comment', source: '%% removed comment\nflowchart TD\nA --> B', publicValid: true, outcome: 'comment_ok' },
  { name: 'directive', source: '%%{init: {"theme":"base"}}%%\nflowchart TD\nA --> B', publicValid: true, outcome: 'directive_or_comment' },
  { name: 'HTML attribute normalization', source: 'flowchart TD\nA["<span title=\"x\">Label</span>"] --> B', publicValid: true, outcome: 'html_attribute_normalization' },
  { name: 'entity encoding', source: 'flowchart TD\nA[#amp;] --> B', publicValid: true, outcome: 'entity_ok' },
  { name: 'close-brace whitespace rewrite', source: 'flowchart TD\r\nB{Check}    \r\nA --> B', publicValid: true, outcome: 'close_brace_ok' },
  { name: 'illegal Flowchart', source: 'flowchart TD\nA -->', publicValid: false, outcome: 'jison_parse_failure' },
] as const;

async function publicMermaidParses(source: string): Promise<boolean> {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, DOMParser: window.DOMParser });
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  try {
    await mermaid.parse(source);
    return true;
  } catch {
    return false;
  }
}

test('pins the generated Mermaid parser host to the installed 11.12.2 contract', () => {
  const factory = mermaid112JisonParserFactory();
  assert.equal(factory.mermaidVersion, '11.12.2');
  assert.equal(factory.generatedParserSha256, '39e8a84d459c0f4c1d436892079d58baf4514bd222e0107dd9475571777087d9');
});

for (const fixture of fixtures) {
  test(`public Mermaid and adapter contract: ${fixture.name}`, async () => {
    assert.equal(await publicMermaidParses(fixture.source), fixture.publicValid);
  const result = extractFlowchartNodeOccurrenceEvidence(fixture.source, mermaid112JisonParserFactory());

    if (fixture.outcome === 'ok' || fixture.outcome === 'comment_ok' || fixture.outcome === 'close_brace_ok' || fixture.outcome === 'entity_ok') {
      assert.equal(result.kind, 'ok');
      if (result.kind !== 'ok') return;
      if (fixture.outcome === 'comment_ok' || fixture.outcome === 'close_brace_ok' || fixture.outcome === 'entity_ok') {
        assert.deepEqual(
          result.occurrences.map(({ nativeId }) => nativeId),
          fixture.outcome === 'close_brace_ok' ? ['B', 'A', 'B'] : ['A', 'B'],
        );
        for (const occurrence of result.occurrences) {
          assert.equal(sliceUtf8ByteSpan(fixture.source, occurrence.span), occurrence.fragment);
        }
        return;
      }
      assert.equal(result.occurrences.filter(({ nativeId }) => nativeId === 'A').length, 2);
      assert.equal(result.occurrences.filter(({ nativeId }) => nativeId === 'D').length, 2);
      assert.equal(result.occurrences.find(({ nativeId }) => nativeId === 'X')?.role, 'declaration');
      for (const occurrence of result.occurrences) {
        assert.equal(sliceUtf8ByteSpan(fixture.source, occurrence.span), occurrence.fragment);
        assert.equal(sliceUtf8ByteSpan(fixture.source, occurrence.statementSpan).includes(occurrence.fragment), true);
      }
      assert.equal(result.occurrences.some(({ fragment, span }) => fragment.includes('😀') && span.endByte - span.startByte > fragment.length), true);
      return;
    }

    assert.deepEqual(result, {
      kind: fixture.outcome === 'jison_parse_failure' ? 'parse_failure' : 'unsupported_preprocessing',
      reason: fixture.outcome,
    });
  });
}
