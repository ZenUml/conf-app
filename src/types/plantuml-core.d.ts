// @plantuml/core ships no types. Its public surface is these two functions;
// see the package README. The data files are side-effect-only scripts that
// register globals (PLANTUML_THEMES, PLANTUML_OPENICONIC, PLANTUML_EMOJI).
declare module '@plantuml/core' {
  export function renderToString(
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
    options?: { dark?: boolean; maxSvgSize?: number },
  ): void;
  export function render(lines: string[], targetId: string, options?: { dark?: boolean }): void;
}
declare module '@plantuml/core/themes.js';
declare module '@plantuml/core/openiconic.js';
declare module '@plantuml/core/emoji.js';
