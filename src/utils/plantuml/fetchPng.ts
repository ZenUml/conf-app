/**
 * Fetch a ready-made raster PNG for a PlantUML source from the PlantUML server.
 *
 * WHY THIS EXISTS. A PlantUML macro renders by fetching an SVG from the remote
 * PlantUML server and inlining it with `v-html` (see `components/PlantUml.vue`).
 * Any DOM -> PNG path (`html-to-image` / `model/captureBlob.ts`) then has to
 * re-serialize and rasterize that inlined *remote-server* SVG, and it fails:
 * the offscreen image can't decode the server SVG, so html-to-image rejects
 * with a bare DOM Event (measured at ~81% for the attachment backup), and when
 * it doesn't reject outright it can still yield an effectively zero-pixel
 * canvas — a blank PNG.
 *
 * The server already publishes the raster we want at `/plantuml/png/<encoded>`,
 * so fetch THAT and skip DOM rasterization entirely. Deterministic, and it
 * costs one request to a host the diagram already had to reach in order to
 * render at all.
 *
 * Used only through `./png.ts`, which asks the server only when the renderer
 * is `server` or the local engine cannot draw the diagram (ADR-0010): with the
 * local renderer the PNG is the engine's SVG drawn on a canvas instead. That
 * module owns telemetry and the upscale; this one is a plain fetch with no
 * side effects.
 */

export const PLANTUML_PNG_SERVER = 'https://www.plantuml.com/plantuml/png/';

/**
 * Is this string actually PlantUML source?
 *
 * Callers can hold a mismatched type/content pair — e.g. the leftover ZenUML
 * `code` field of a doc whose type was later switched to plantuml. Every valid
 * PlantUML body starts with `@start...` (`utils/plantuml/validate.ts` enforces
 * `@startuml` before render); anything else earns a guaranteed 400 from the
 * server, so don't ask.
 */
export function isPlantUmlSource(content?: string | null): boolean {
  return (content?.trim() ?? '').startsWith('@start');
}

/**
 * `undefined` when the server declines to give us a raster; throws only if
 * `fetch` itself throws (network/CORS), which callers handle per their own
 * fallback policy.
 *
 * The encoder is imported dynamically: it pulls in pako's deflate, and neither
 * caller wants that in its initial chunk.
 */
export async function fetchPlantUmlPngBlob(code: string): Promise<Blob | undefined> {
  const { plantumlEncode } = await import('@/utils/plantuml/encode');
  const resp = await fetch(`${PLANTUML_PNG_SERVER}${plantumlEncode(code)}`);
  if (!resp.ok) return undefined;
  const blob = await resp.blob();
  // The server can answer 200 with a non-PNG body (e.g. an HTML/SVG error page
  // from a proxy/CDN) — only accept a real raster PNG. Content-Type is reliable
  // for the PlantUML server (image/png for PNGs).
  const type = (blob.type || '').toLowerCase().split(';')[0].trim();
  if (type !== 'image/png') return undefined;
  return blob;
}
