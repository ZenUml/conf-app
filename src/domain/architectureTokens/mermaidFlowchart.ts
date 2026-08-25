import { utf8ByteSpanFor, type Utf8ByteSpan } from './utf8Locator';

/**
 * An intentionally small canonical model for Mermaid Flowchart source.
 *
 * Mermaid itself remains the syntax authority: callers must validate with its
 * public `parse()` API before using this parser. This module never reads a
 * Mermaid AST and intentionally returns `unsupported` instead of guessing.
 */

export type { Utf8ByteSpan } from './utf8Locator';

export type NodeOccurrence = Readonly<{
  span: Utf8ByteSpan;
  statementSpan: Utf8ByteSpan;
  role: 'declaration' | 'edge_endpoint';
}>;

/**
 * Parser-derived source-position evidence consumed by the product Locator.
 * It deliberately carries no parser-specific identity: a Jison adapter and
 * the legacy handwritten extractor can both supply this shape.
 */
export type NodeOccurrenceSourcePositionEvidence = Readonly<{
  nativeId: string;
  role: NodeOccurrence['role'];
  span: Utf8ByteSpan;
  statementSpan: Utf8ByteSpan;
}>;

export type CanonicalNode = Readonly<{
  kind: 'node';
  nativeId: string;
  label: string | null;
  shape: string | null;
  containerPath: readonly string[];
  primaryOccurrence: NodeOccurrence;
  occurrences: readonly NodeOccurrence[];
  incidentNativeIds: readonly string[];
  statementContexts: readonly string[];
}>;

export type CanonicalEdge = Readonly<{
  kind: 'edge';
  span: Utf8ByteSpan;
  endpointNativeIds: readonly string[];
}>;

export type CanonicalSubgraph = Readonly<{
  kind: 'subgraph';
  nativeId: string | null;
  title: string | null;
  span: Utf8ByteSpan;
  containerPath: readonly string[];
}>;

export type CanonicalFlowchart = Readonly<{
  kind: 'flowchart';
  direction: string | null;
  nodes: readonly CanonicalNode[];
  edges: readonly CanonicalEdge[];
  subgraphs: readonly CanonicalSubgraph[];
}>;

export type FlowchartParseResult =
  | Readonly<{ kind: 'ok'; model: CanonicalFlowchart }>
  | Readonly<{ kind: 'unsupported'; reason: string }>;

/**
 * The Locator owns the canonical model and decides how parser evidence becomes
 * a product locator. The parser is never the Locator: node facts, occurrence
 * identity, roles, statement context, and all future locator semantics remain
 * in this domain layer. It fails closed if supplied evidence cannot account
 * for every existing occurrence exactly once.
 */
export function applyNodeOccurrenceSourcePositionEvidence(
  model: CanonicalFlowchart,
  evidence: readonly NodeOccurrenceSourcePositionEvidence[],
): CanonicalFlowchart | null {
  const byNativeId = new Map<string, NodeOccurrenceSourcePositionEvidence[]>();
  for (const occurrence of evidence) {
    const entries = byNativeId.get(occurrence.nativeId) ?? [];
    entries.push(occurrence);
    byNativeId.set(occurrence.nativeId, entries);
  }

  if (model.nodes.reduce((count, node) => count + node.occurrences.length, 0) !== evidence.length) return null;

  const nodes = model.nodes.map((node) => {
    const existing = [...node.occurrences].sort(compareNodeOccurrence);
    const supplied = [...(byNativeId.get(node.nativeId) ?? [])].sort(compareNodeOccurrence);
    if (existing.length !== supplied.length) return null;
    const occurrences = existing.map((locator, index) => {
      const position = supplied[index];
      if (locator.role !== position.role) return null;
      return { ...locator, span: position.span, statementSpan: position.statementSpan };
    });
    if (occurrences.some((occurrence) => occurrence === null)) return null;
    const primaryIndex = existing.findIndex((occurrence) => occurrence === node.primaryOccurrence);
    return {
      ...node,
      occurrences: occurrences as NodeOccurrence[],
      primaryOccurrence: occurrences[primaryIndex < 0 ? 0 : primaryIndex] as NodeOccurrence,
    };
  });
  if (nodes.some((node) => node === null)) return null;
  return { ...model, nodes: nodes as CanonicalNode[] };
}

type CharSpan = Readonly<{ start: number; end: number }>;
type Statement = Readonly<{ text: string; span: CharSpan }>;
type MutableNode = {
  nativeId: string;
  label: string | null;
  shape: string | null;
  containerPath: string[];
  occurrences: NodeOccurrence[];
  incidentNativeIds: Set<string>;
  statementContexts: Set<string>;
};

const HEADER = /^\s*(?:flowchart|graph)(?:\s+([A-Za-z]{2}))?\s*(?:%%.*)?$/i;
const NODE_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]*/;
const EDGE_ARROW = /^(?:<-->|-+>|=+>|-\.+->|\.+->|-{3,}|={3,}|-\.+-)/;
const STYLE = /^style\s+[A-Za-z_][A-Za-z0-9_-]*\s+[A-Za-z-][A-Za-z0-9-]*\s*:\s*[^,;]+(?:\s*,\s*[A-Za-z-][A-Za-z0-9-]*\s*:\s*[^,;]+)*\s*;?$/i;
const SUBGRAPH_DIRECTION = /^direction\s+(?:TB|TD|BT|RL|LR)\s*$/i;

function compareNodeOccurrence(
  left: Pick<NodeOccurrence, 'span'>,
  right: Pick<NodeOccurrence, 'span'>,
): number {
  return left.span.startByte - right.span.startByte || left.span.endByte - right.span.endByte;
}

/**
 * Parses only the supported Flowchart-node subset. `unsupported` is a
 * fail-closed result, never permission to infer identity from unfamiliar text.
 */
export function parseFlowchartSource(source: string): FlowchartParseResult {
  const statements = splitStatements(source);
  const first = statements.find((statement) => !isComment(statement.text));
  if (!first) return { kind: 'unsupported', reason: 'missing_flowchart_header' };

  const header = HEADER.exec(first.text);
  if (!header) return { kind: 'unsupported', reason: 'not_a_flowchart' };

  const nodes = new Map<string, MutableNode>();
  const edges: CanonicalEdge[] = [];
  const subgraphs: CanonicalSubgraph[] = [];
  const containers: string[] = [];

  for (const statement of statements.slice(statements.indexOf(first) + 1)) {
    const trimmed = statement.text.trim();
    if (!trimmed || isComment(trimmed)) continue;
    if (/^end\s*$/i.test(trimmed)) {
      if (containers.length === 0) return { kind: 'unsupported', reason: 'unmatched_subgraph_end' };
      containers.pop();
      continue;
    }
    if (STYLE.test(trimmed)) continue;
    if (containers.length > 0 && SUBGRAPH_DIRECTION.test(trimmed)) {
      if (!isStandaloneSourceLine(source, statement.span)) {
        return { kind: 'unsupported', reason: 'unsupported_flowchart_statement' };
      }
      continue;
    }

    const subgraph = parseSubgraph(trimmed, statement);
    if (subgraph) {
      subgraphs.push({
        kind: 'subgraph',
        nativeId: subgraph.nativeId,
        title: subgraph.title,
        span: toByteSpan(source, statement.span),
        containerPath: [...containers],
      });
      containers.push(subgraph.nativeId ?? subgraph.title ?? `anonymous-${subgraphs.length}`);
      continue;
    }

    const endpointSpans = splitEdgeEndpoints(statement);
    if (endpointSpans.length > 1) {
      const endpointIds: string[] = [];
      for (const endpoint of endpointSpans) {
        const parsed = parseNode(source.slice(endpoint.start, endpoint.end));
        if (!parsed) return { kind: 'unsupported', reason: 'unsupported_edge_endpoint' };
        endpointIds.push(parsed.nativeId);
        recordNode(nodes, source, statement, endpoint, parsed, 'edge_endpoint', containers);
      }
      for (let index = 0; index < endpointIds.length - 1; index += 1) {
        nodes.get(endpointIds[index])?.incidentNativeIds.add(endpointIds[index + 1]);
        nodes.get(endpointIds[index + 1])?.incidentNativeIds.add(endpointIds[index]);
      }
      edges.push({ kind: 'edge', span: toByteSpan(source, statement.span), endpointNativeIds: endpointIds });
      continue;
    }

    const declaration = trimSpan(source, statement.span);
    const parsed = parseNode(source.slice(declaration.start, declaration.end));
    if (!parsed) return { kind: 'unsupported', reason: 'unsupported_flowchart_statement' };
    recordNode(nodes, source, statement, declaration, parsed, 'declaration', containers);
  }

  if (containers.length > 0) return { kind: 'unsupported', reason: 'unclosed_subgraph' };

  return {
    kind: 'ok',
    model: {
      kind: 'flowchart',
      direction: header[1]?.toUpperCase() ?? null,
      nodes: [...nodes.values()].map((node): CanonicalNode => ({
        kind: 'node',
        nativeId: node.nativeId,
        label: node.label,
        shape: node.shape,
        containerPath: node.containerPath,
        primaryOccurrence: node.occurrences.find((occurrence) => occurrence.role === 'declaration')
          ?? node.occurrences[0],
        occurrences: node.occurrences,
        incidentNativeIds: [...node.incidentNativeIds].sort(),
        statementContexts: [...node.statementContexts].sort(),
      })),
      edges,
      subgraphs,
    },
  };
}

function recordNode(
  nodes: Map<string, MutableNode>,
  source: string,
  statement: Statement,
  nodeSpan: CharSpan,
  parsed: { nativeId: string; label: string | null; shape: string | null },
  role: NodeOccurrence['role'],
  containers: readonly string[],
): void {
  let node = nodes.get(parsed.nativeId);
  if (!node) {
    node = {
      nativeId: parsed.nativeId,
      label: parsed.label,
      shape: parsed.shape,
      containerPath: [...containers],
      occurrences: [],
      incidentNativeIds: new Set(),
      statementContexts: new Set(),
    };
    nodes.set(parsed.nativeId, node);
  } else if (parsed.label !== null || parsed.shape !== null) {
    node.label = parsed.label;
    node.shape = parsed.shape;
  }
  node.occurrences.push({
    span: toByteSpan(source, nodeSpan),
    statementSpan: toByteSpan(source, statement.span),
    role,
  });
  node.statementContexts.add(normalizeStatementContext(statement.text));
}

function parseSubgraph(text: string, statement: Statement): { nativeId: string | null; title: string | null } | null {
  if (!/^subgraph\b/i.test(text)) return null;
  const body = text.replace(/^subgraph\s+/i, '').trim();
  if (!body) return { nativeId: null, title: null };
  const node = parseNode(body);
  if (node) return { nativeId: node.nativeId, title: node.label ?? node.nativeId };
  if (/^[^[\](){}]+$/.test(body)) return { nativeId: null, title: body };
  void statement;
  return null;
}

function parseNode(text: string): { nativeId: string; label: string | null; shape: string | null } | null {
  const trimmed = text.trim();
  const id = NODE_ID.exec(trimmed);
  if (!id) return null;
  const nativeId = id[0];
  const suffix = trimmed.slice(nativeId.length).trim();
  if (!suffix) return { nativeId, label: null, shape: null };

  const forms: ReadonlyArray<readonly [string, string, string]> = [
    ['((', '))', 'double_circle'],
    ['[[', ']]', 'subroutine'],
    ['[(', ')]', 'cylinder'],
    ['[', ']', 'square'],
    ['(', ')', 'round'],
    ['{', '}', 'diamond'],
  ];
  for (const [open, close, shape] of forms) {
    if (suffix.startsWith(open) && suffix.endsWith(close)) {
      const label = suffix.slice(open.length, suffix.length - close.length).trim();
      return { nativeId, label: unquote(label), shape };
    }
  }
  return null;
}

function splitEdgeEndpoints(statement: Statement): CharSpan[] {
  const source = statement.text;
  const arrows: number[] = [];
  let quote = false;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && source[index - 1] !== '\\') quote = !quote;
    if (quote) continue;
    if ('[({'.includes(char)) depth += 1;
    if ('])}'.includes(char)) depth -= 1;
    if (depth !== 0) continue;
    const arrow = source.slice(index).match(EDGE_ARROW);
    if (arrow) {
      arrows.push(index);
      index += arrow[0].length - 1;
    }
  }
  if (arrows.length === 0) return [];

  const segments: CharSpan[] = [];
  let segmentStart = 0;
  for (const arrowAt of arrows) {
    const textLabelStart = findWhitespaceDelimitedTextLabel(source, segmentStart, arrowAt);
    segments.push(trimSpan(source, {
      start: segmentStart,
      end: textLabelStart ?? arrowAt,
    }, statement.span.start));
    const arrow = source.slice(arrowAt).match(EDGE_ARROW);
    segmentStart = arrowAt + (arrow?.[0].length ?? 0);
    if (source[segmentStart] === '|') {
      const labelEnd = findUnescapedPipe(source, segmentStart + 1);
      if (labelEnd !== -1) segmentStart = labelEnd + 1;
    }
  }
  segments.push(trimSpan(source, { start: segmentStart, end: source.length }, statement.span.start));
  return segments.filter((span) => span.start < span.end);
}

/**
 * Mermaid also permits `A -- label --> B`. We accept only the whitespace
 * delimited form so an identifier containing `--` cannot be reinterpreted as
 * an edge. Other label spellings remain unsupported until explicitly modelled.
 */
function findWhitespaceDelimitedTextLabel(source: string, start: number, end: number): number | null {
  const terminal = source.slice(end).match(EDGE_ARROW)?.[0];
  if (!terminal) return null;
  const labelConnector = terminal.startsWith('=') ? '==' : terminal.startsWith('.') ? '-.' : '--';
  let quote = false;
  let depth = 0;
  for (let index = start; index < end - labelConnector.length; index += 1) {
    const char = source[index];
    if (char === '"' && source[index - 1] !== '\\') quote = !quote;
    if (quote) continue;
    if ('[({'.includes(char)) depth += 1;
    if ('])}'.includes(char)) depth -= 1;
    if (depth !== 0 || source.slice(index, index + labelConnector.length) !== labelConnector) continue;
    const before = source[index - 1];
    const after = source[index + labelConnector.length];
    if (
      /\s/.test(before ?? '')
      && /\s/.test(after ?? '')
      && source.slice(index + labelConnector.length, end).trim()
    ) {
      return index;
    }
  }
  return null;
}

function findUnescapedPipe(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '|' && source[index - 1] !== '\\') return index;
  }
  return -1;
}

function splitStatements(source: string): Statement[] {
  const statements: Statement[] = [];
  let start = 0;
  let quote = false;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && source[index - 1] !== '\\') quote = !quote;
    if (!quote) {
      if ('[({'.includes(char)) depth += 1;
      if ('])}'.includes(char)) depth -= 1;
      if ((char === '\n' || char === ';') && depth === 0) {
        const end = char === '\n' && source[index - 1] === '\r' ? index - 1 : index;
        statements.push({ text: source.slice(start, end), span: { start, end } });
        start = index + 1;
      }
    }
  }
  if (start < source.length) statements.push({ text: source.slice(start), span: { start, end: source.length } });
  return statements;
}

function trimSpan(source: string, span: CharSpan, offset = 0): CharSpan {
  let start = offset + span.start;
  let end = offset + span.end;
  while (start < end && /\s/.test(source[start - offset])) start += 1;
  while (end > start && /\s/.test(source[end - 1 - offset])) end -= 1;
  return { start, end };
}

function toByteSpan(source: string, span: CharSpan): Utf8ByteSpan {
  return utf8ByteSpanFor(source, span.start, span.end);
}

function normalizeStatementContext(statement: string): string {
  return statement.trim().replace(/\s+/g, ' ');
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function isComment(text: string): boolean {
  return /^\s*%%/.test(text);
}

function isStandaloneSourceLine(source: string, span: CharSpan): boolean {
  const lineStart = source.lastIndexOf('\n', Math.max(0, span.start - 1)) + 1;
  const nextLine = source.indexOf('\n', span.end);
  const lineEnd = nextLine === -1 ? source.length : nextLine;
  return source.slice(lineStart, span.start).trim() === ''
    && source.slice(span.end, lineEnd).trim() === '';
}
