// The one table mapping the stored `diagramType` vocabulary to (a) its
// canonical stored spelling and (b) the analytics `macro_type` value.
//
// Plain JavaScript with NO imports, on purpose: src/export.js is a Forge
// Function entry, and the Forge bundler typechecks the import graph of `.ts`
// files, which has broken deploys before. A `.js` file goes through
// babel-loader only. Do not add imports here (no Vue, no @forge/*, no `@/`).
//
// Because it cannot import the `DiagramType` enum
// (src/model/Diagram/Diagram.ts), the spellings below are copied from it and
// tests/unit/diagramTypeVocabulary.spec.ts asserts the two lists are equal.
// Adding a DiagramType member therefore fails that test until this file is
// updated, which is the only edit needed.

/** Canonical stored spellings, in DiagramType order (Unknown excluded). */
export const STORED_DIAGRAM_TYPES = Object.freeze([
  'sequence',
  'mermaid',
  'markdown',
  'plantuml',
  'graph',
  'OpenAPI',
  'AsyncAPI',
  'embed',
]);

// Real stored bodies spell the API specs `openapi` / `asyncapi` while the enum
// says `OpenAPI` / `AsyncAPI`, so every lookup folds case.
const STORED_BY_FOLDED = Object.freeze(
  Object.fromEntries(STORED_DIAGRAM_TYPES.map((t) => [t.toLowerCase(), t])),
);

/** The canonical stored spelling for `raw` (case-insensitive), or null. */
export function foldDiagramType(raw) {
  if (typeof raw !== 'string') return null;
  return STORED_BY_FOLDED[raw.toLowerCase()] ?? null;
}

/**
 * The analytics `macro_type` value (MacroTypeValue in
 * src/utils/analytics/catalog.ts) for `raw`, or the catalog's `'none'`
 * sentinel when the type is not recognised. Every macro_type is the
 * lower-cased stored spelling.
 */
export function toMacroType(raw) {
  const stored = foldDiagramType(raw);
  return stored ? stored.toLowerCase() : 'none';
}
