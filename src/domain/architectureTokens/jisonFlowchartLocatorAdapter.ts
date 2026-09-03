import { sliceUtf8ByteSpan, utf8ByteSpanFor, type Utf8ByteSpan } from './utf8Locator';

/**
 * Version-pinned Flowchart occurrence/position evidence adapter.
 *
 * It does not produce product Locators. A host supplies an exact Mermaid Jison
 * parser only after checking its package/source-map contract; the distinct
 * Locator domain layer decides how accepted evidence becomes a locator.
 */

export type JisonReductionLocation = Readonly<{ range?: readonly [number, number] }>;

export type VersionPinnedJisonParser = {
  yy: unknown;
  lexer: { options: { ranges?: boolean } };
  performAction: (...args: unknown[]) => unknown;
  parse(input: string): unknown;
  productions_: readonly (0 | readonly [number, number])[];
  symbols_: Readonly<Record<string, number>>;
};

export type VersionPinnedJisonParserFactory = Readonly<{
  adapterVersion: string;
  createParser(): VersionPinnedJisonParser;
}>;

export type JisonNodeOccurrenceEvidence = Readonly<{
  nativeId: string;
  role: 'declaration' | 'edge_endpoint';
  span: Utf8ByteSpan;
  statementSpan: Utf8ByteSpan;
  /** Audit-only evidence; never persist JavaScript indices as a locator. */
  parserUtf16Range: readonly [number, number];
  fragment: string;
}>;

export type JisonOccurrenceEvidenceResult =
  | Readonly<{ kind: 'ok'; adapterVersion: string; occurrences: readonly JisonNodeOccurrenceEvidence[] }>
  | Readonly<{
      kind: 'unsupported_preprocessing';
      reason:
        | 'lone_carriage_return'
        | 'frontmatter'
        | 'directive_or_comment'
        | 'html_attribute_normalization'
        | 'entity_encoding'
        | 'flowparser_close_brace_whitespace';
    }>
  | Readonly<{ kind: 'adapter_unavailable'; reason: 'missing_jison_location_contract' | 'factory_failed' }>
  | Readonly<{ kind: 'parse_failure'; reason: 'jison_parse_failure' }>
  | Readonly<{
      kind: 'mapping_failure';
      reason: 'unmappable_jison_span' | 'missing_vertex_statement_span' | 'locator_roundtrip_failed';
    }>;

type PreparedSource = Readonly<{
  parserText: string;
  /** Each parser-text UTF-16 code unit maps to one raw code unit, or none. */
  rawOrigin: readonly (number | null)[];
}>;

type CapturedVertex = Readonly<{ nativeId: string; parserRange: readonly [number, number] }>;
type CapturedStatement = Readonly<{ parserRange: readonly [number, number]; isEdge: boolean }>;

/** @deprecated Use JisonNodeOccurrenceEvidence: this type is evidence, not a Locator. */
export type JisonNodeOccurrence = JisonNodeOccurrenceEvidence;
/** @deprecated Use JisonOccurrenceEvidenceResult: this result is evidence, not a Locator. */
export type JisonLocatorAdapterResult = JisonOccurrenceEvidenceResult;

/**
 * Extract node occurrences from an injected, version-pinned Jison parser.
 *
 * The first slice supports only CRLF-to-LF source mapping. Every other known
 * Mermaid preprocessing rewrite is rejected before parser coordinates are
 * considered, so callers can fall back without receiving a guessed locator.
 */
export function extractFlowchartNodeOccurrenceEvidence(
  rawSource: string,
  factory: VersionPinnedJisonParserFactory,
): JisonOccurrenceEvidenceResult {
  const prepared = prepareRawSource(rawSource);
  if ('kind' in prepared) return prepared;

  let parser: VersionPinnedJisonParser;
  try {
    parser = factory.createParser();
  } catch {
    return { kind: 'adapter_unavailable', reason: 'factory_failed' };
  }

  const productionKinds = inspectProductionKinds(parser);
  if (!productionKinds) return { kind: 'adapter_unavailable', reason: 'missing_jison_location_contract' };

  parser.lexer.options.ranges = true;
  const vertices: CapturedVertex[] = [];
  const statements: CapturedStatement[] = [];
  const originalPerformAction = parser.performAction;
  parser.performAction = function captureLocations(this: { $?: unknown; _$?: JisonReductionLocation }, ...args: unknown[]) {
    const production = args[4];
    const result = originalPerformAction.apply(this, args);
    const range = cloneRange(this._$);
    if (range && typeof production === 'number' && productionKinds.vertex.has(production) && typeof this.$ === 'string') {
      vertices.push({ nativeId: this.$, parserRange: range });
    }
    if (range && typeof production === 'number' && productionKinds.vertexStatement.has(production)) {
      const nodes = (this.$ as { nodes?: unknown })?.nodes;
      statements.push({ parserRange: range, isEdge: Array.isArray(nodes) && nodes.length > 1 });
    }
    return result;
  };

  try {
    parser.yy = createNonRenderingSemanticSink();
    parser.parse(prepared.parserText);
  } catch {
    return { kind: 'parse_failure', reason: 'jison_parse_failure' };
  }

  const occurrences: JisonNodeOccurrenceEvidence[] = [];
  for (const vertex of vertices) {
    const rawRange = mapParserRangeToRaw(prepared, vertex.parserRange);
    if (!rawRange) return { kind: 'mapping_failure', reason: 'unmappable_jison_span' };
    const statementRange = findStatementRange(vertex.parserRange, statements);
    if (!statementRange) return { kind: 'mapping_failure', reason: 'missing_vertex_statement_span' };
    const rawStatementRange = mapParserRangeToRaw(prepared, statementRange.parserRange);
    if (!rawStatementRange) return { kind: 'mapping_failure', reason: 'unmappable_jison_span' };

    const fragment = rawSource.slice(rawRange[0], rawRange[1]);
    const span = utf8ByteSpanFor(rawSource, rawRange[0], rawRange[1]);
    const statementSpan = utf8ByteSpanFor(rawSource, rawStatementRange[0], rawStatementRange[1]);
    if (sliceUtf8ByteSpan(rawSource, span) !== fragment
      || !sliceUtf8ByteSpan(rawSource, statementSpan).includes(fragment)) {
      return { kind: 'mapping_failure', reason: 'locator_roundtrip_failed' };
    }
    occurrences.push({
      nativeId: vertex.nativeId,
      role: statementRange.isEdge ? 'edge_endpoint' : 'declaration',
      span,
      statementSpan,
      parserUtf16Range: vertex.parserRange,
      fragment,
    });
  }

  return { kind: 'ok', adapterVersion: factory.adapterVersion, occurrences };
}

function prepareRawSource(raw: string): PreparedSource | Exclude<JisonOccurrenceEvidenceResult, { kind: 'ok' | 'adapter_unavailable' | 'parse_failure' }> {
  if (/\r(?!\n)/.test(raw)) return { kind: 'unsupported_preprocessing', reason: 'lone_carriage_return' };
  if (/^---(?:\r?\n|$)/.test(raw)) return { kind: 'unsupported_preprocessing', reason: 'frontmatter' };
  // Mermaid comments are line-scoped.  Keep every original code-unit position
  // by substituting the comment text with spaces before Jison sees it; this
  // preserves positions of every subsequent Flowchart construct in raw source.
  // Directives remain unsupported because they are executable preprocessing,
  // rather than inert text removal.
  if (/^\s*%%\{/m.test(raw)) return { kind: 'unsupported_preprocessing', reason: 'directive_or_comment' };
  if (/<[A-Za-z]\w*(?:\s[^>]*)?>/.test(raw)) {
    return { kind: 'unsupported_preprocessing', reason: 'html_attribute_normalization' };
  }

  let parserText = '';
  const rawOrigin: (number | null)[] = [];
  const ordinaryCommentUnits = commentCodeUnits(raw);
  const closeBraceWhitespaceUnits = closeBraceWhitespaceCodeUnits(raw);
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === '\r' && raw[index + 1] === '\n') {
      parserText += '\n';
      rawOrigin.push(null);
      index += 1;
      continue;
    }
    if (ordinaryCommentUnits.has(index)) {
      parserText += ' ';
      rawOrigin.push(index);
      continue;
    }
    // Mermaid's Flowchart host removes horizontal whitespace between a close
    // brace and its following newline.  Omit those raw units from parser text;
    // later ranges still map to their original contiguous node fragments.
    if (closeBraceWhitespaceUnits.has(index)) continue;
    parserText += raw[index];
    rawOrigin.push(index);
  }

  if (parserText.replace(/}\s*\n/g, '}\n') !== parserText) {
    return { kind: 'unsupported_preprocessing', reason: 'flowparser_close_brace_whitespace' };
  }
  return { parserText, rawOrigin };
}

/**
 * Return non-newline UTF-16 units in an ordinary Mermaid comment.  The
 * replacement is position-preserving: Jison receives whitespace, while its
 * location range maps back to the same raw code-unit offsets.
 */
function commentCodeUnits(raw: string): ReadonlySet<number> {
  const units = new Set<number>();
  for (const match of raw.matchAll(/^[\t ]*%%(?!\{)[^\r\n]*/gm)) {
    const start = match.index ?? 0;
    for (let index = start; index < start + match[0].length; index += 1) units.add(index);
  }
  return units;
}

/**
 * Map the one known Flowchart rewrite we can reproduce exactly: horizontal
 * whitespace following `}` immediately before LF or CRLF is removed.
 * Other whitespace forms remain rejected by the final preprocessing guard.
 */
function closeBraceWhitespaceCodeUnits(raw: string): ReadonlySet<number> {
  const units = new Set<number>();
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== '}') continue;
    let cursor = index + 1;
    while (raw[cursor] === ' ' || raw[cursor] === '\t') cursor += 1;
    const newlineFollows = raw[cursor] === '\n' || (raw[cursor] === '\r' && raw[cursor + 1] === '\n');
    if (!newlineFollows) continue;
    for (let whitespace = index + 1; whitespace < cursor; whitespace += 1) units.add(whitespace);
    index = cursor - 1;
  }
  return units;
}

/**
 * @deprecated Compatibility export during the migration from the misleading
 * “locator adapter” name. New product code must consume occurrence evidence
 * through `extractFlowchartNodeOccurrenceEvidence` and the Locator layer.
 */
export const locateFlowchartNodeOccurrences = extractFlowchartNodeOccurrenceEvidence;

function inspectProductionKinds(parser: VersionPinnedJisonParser): { vertex: ReadonlySet<number>; vertexStatement: ReadonlySet<number> } | null {
  if (!parser.lexer?.options || typeof parser.performAction !== 'function' || typeof parser.parse !== 'function') return null;
  const numberToSymbol = Object.fromEntries(Object.entries(parser.symbols_).map(([name, number]) => [number, name]));
  const vertex = new Set<number>();
  const vertexStatement = new Set<number>();
  parser.productions_.forEach((rule, production) => {
    if (!Array.isArray(rule)) return;
    const symbol = numberToSymbol[rule[0]];
    if (symbol === 'vertex') vertex.add(production);
    if (symbol === 'vertexStatement') vertexStatement.add(production);
  });
  return vertex.size > 0 && vertexStatement.size > 0 ? { vertex, vertexStatement } : null;
}

function createNonRenderingSemanticSink(): Record<string, unknown> {
  let firstGraph = true;
  return {
    lex: {
      firstGraph: () => {
        const result = firstGraph;
        firstGraph = false;
        return result;
      },
    },
    addVertex() {}, addLink() {}, addSubGraph() { return 'jison-prototype-subgraph'; },
    setDirection() {}, setAccTitle() {}, setAccDescription() {}, setClass() {}, setLink() {}, setTooltip() {},
    updateLink() {}, updateLinkInterpolate() {},
    destructLink(value: string) { return { type: value, stroke: 'normal', length: 1 }; },
  };
}

function cloneRange(location: JisonReductionLocation | undefined): readonly [number, number] | undefined {
  const range = location?.range;
  return range && range.length === 2 ? [range[0], range[1]] : undefined;
}

function mapParserRangeToRaw(prepared: PreparedSource, parserRange: readonly [number, number]): readonly [number, number] | undefined {
  const [start, end] = parserRange;
  if (start < 0 || end <= start || end > prepared.rawOrigin.length) return undefined;
  const origin = prepared.rawOrigin.slice(start, end);
  if (origin.some((value) => value === null)) return undefined;
  const raw = origin as number[];
  for (let index = 1; index < raw.length; index += 1) {
    if (raw[index] !== raw[index - 1] + 1) return undefined;
  }
  return [raw[0], raw[raw.length - 1] + 1];
}

function findStatementRange(
  vertexRange: readonly [number, number],
  statements: readonly CapturedStatement[],
): CapturedStatement | undefined {
  const containing = statements.filter(({ parserRange }) => parserRange[0] <= vertexRange[0] && parserRange[1] >= vertexRange[1]);
  const smallest = (items: readonly CapturedStatement[]) => items
    .slice()
    .sort((a, b) => (a.parserRange[1] - a.parserRange[0]) - (b.parserRange[1] - b.parserRange[0]))[0];
  return smallest(containing.filter(({ isEdge }) => isEdge)) ?? smallest(containing);
}
