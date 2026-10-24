// No imports on purpose: fetchPng.ts and mcp-app-view.ts load the encoder
// lazily, and importing these URLs must not pull it into their main chunk.

/** The public PlantUML server every PlantUML surface renders through. */
export const PLANTUML_BASE = 'https://www.plantuml.com/plantuml';

export const svgUrl = (encoded: string): string => `${PLANTUML_BASE}/svg/${encoded}`;
export const pngUrl = (encoded: string): string => `${PLANTUML_BASE}/png/${encoded}`;
