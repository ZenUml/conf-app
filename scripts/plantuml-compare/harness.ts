// Browser side of compare.mjs: the real in-browser renderer (engine.ts, with
// the hosted C4 library and the GitHub C4 URL rewrite), exposed to Playwright.
import { renderPlantUmlLocally, PlantUmlLocalRenderError } from '@/utils/plantuml/engine';
import { rewriteHostedIncludes } from '@/utils/plantuml/stdlib';
import { plantumlEncode } from '@/utils/plantuml/encode';

type LocalResult = {
  status: 'ok' | 'syntax_error' | 'include' | 'engine_error' | 'load_failed';
  svg?: string;
  unresolvedInclude?: string;
  rewritten: boolean;
  message?: string;
  ms: number;
};

async function local(code: string): Promise<LocalResult> {
  const rewritten = rewriteHostedIncludes(code.trim()).rewritten;
  const t0 = performance.now();
  try {
    const svg = await renderPlantUmlLocally(code);
    const status = svg.includes('Syntax Error?') ? 'syntax_error' : 'ok';
    return { status, svg, rewritten, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    const e = err as PlantUmlLocalRenderError;
    return {
      status: e instanceof PlantUmlLocalRenderError ? e.reason : 'engine_error',
      unresolvedInclude: e?.unresolvedInclude,
      rewritten,
      message: String(e?.message ?? err).slice(0, 200),
      ms: Math.round(performance.now() - t0),
    };
  }
}

/** Draw an SVG string onto a canvas, scaled to fit `maxWidth`, as a PNG data URL. */
async function rasterize(svg: string, maxWidth = 900): Promise<string | null> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || maxWidth) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

(window as unknown as { harness: unknown }).harness = { local, rasterize, encode: plantumlEncode };
