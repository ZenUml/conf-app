import { renderPlantUmlLocally } from '@/utils/plantuml/engine';
import { producePlantUmlPng } from '@/utils/plantuml/png';
import { normalizePlantUmlSvg } from '@/utils/plantuml/normalizeSvg';
import { captureBlob } from '@/model/captureBlob';

async function blobInfo(b: Blob | null | undefined) {
  if (!b) return null;
  const bmp = await createImageBitmap(b);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d')!; ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 128) dark++;
  const url = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(b); });
  return { width: bmp.width, height: bmp.height, darkPixels: dark, dataUrl: url };
}

async function run(code: string) {
  localStorage.setItem('plantumlRenderer', 'local');
  const svg = await renderPlantUmlLocally(code);
  const backup = await producePlantUmlPng(code, { purpose: 'backup', surface: 'viewer', upscale: true, background: 'white' });
  const exp = await producePlantUmlPng(code, { purpose: 'export', surface: 'modal' });
  // Re-test: html-to-image (captureBlob) on the local SVG inlined as PlantUml.vue does.
  const host = document.createElement('div'); host.className = 'screen-capture-content';
  host.innerHTML = `<div class="flex justify-center">${normalizePlantUmlSvg(svg)}</div>`;
  host.style.width = '800px';
  document.body.appendChild(host);
  let dom: unknown;
  try { dom = await blobInfo(await captureBlob(host, { backgroundColor: 'white', skipFonts: true })); }
  catch (e) { dom = { error: String((e as Error)?.message ?? e), type: (e as Event)?.type }; }
  host.remove();
  return {
    svgHead: svg.slice(0, 300),
    hasExternalRef: /(href|src)="https?:/.test(svg),
    backup: backup.ok ? { source: backup.source, upscale: backup.upscale, ...(await blobInfo(backup.blob)) } : backup,
    exp: exp.ok ? { source: exp.source, ...(await blobInfo(exp.blob)) } : exp,
    domCapture: dom,
  };
}
(window as any).harness = { run };
