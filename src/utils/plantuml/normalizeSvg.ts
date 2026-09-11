/**
 * PlantUML adds processing instructions containing the source and generator
 * metadata to its SVG output. They are useful to PlantUML-aware tooling, but
 * are unsupported nodes for Mixpanel's rrweb recorder. Removing them before
 * insertion keeps replay serialization focused on the actual diagram DOM.
 */
const PLANTUML_PROCESSING_INSTRUCTION = /<\?plantuml(?:-src)?\b[\s\S]*?\?>/gi;

export function normalizePlantUmlSvg(svg: string): string {
  return svg.replace(PLANTUML_PROCESSING_INSTRUCTION, '');
}
