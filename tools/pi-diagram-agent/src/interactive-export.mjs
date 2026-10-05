import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createInteractiveHtml} from './interactive-svg.mjs';
import {deriveSharedSections} from './interactive-sections.mjs';

const require = createRequire(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Runs in Chromium. Read actual geometry and paint in the SVG root's coordinates. */
export function collectInteractiveFacts() {
  const root = document.querySelector('svg');
  if (!root) throw Error('SVG_MISSING');
  const inverse = root.getScreenCTM().inverse();
  const bound=[...root.querySelectorAll('path[data-source][data-target]')];
  const used=new Set([...root.querySelectorAll('path[data-edge]')].map(el=>el.getAttribute('data-edge')));
  return bound.map((element,index) => {
    let id=element.getAttribute('data-edge');
    if(id===null){id=`__interaction-edge-${index}`;while(used.has(id))id+='_';used.add(id)}
    const m = inverse.multiply(element.getScreenCTM()), paint = getComputedStyle(element);
    return {
      id, source: element.getAttribute('data-source'),
      target: element.getAttribute('data-target'), trunk: element.getAttribute('data-shared-trunk'),
      path: element.getAttribute('d'), rootTransform: {a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f},
      style: {dash:paint.strokeDasharray, width:parseFloat(paint.strokeWidth), stroke:paint.stroke,
        markerEnd:paint.markerEnd, lineCap:paint.strokeLinecap, lineJoin:paint.strokeLinejoin,
        miterLimit:paint.strokeMiterlimit, vectorEffect:paint.vectorEffect},
    };
  });
}

/** Export a separate interactive wrapper; the original audited SVG bytes are never edited. */
export async function exportInteractiveSvg(svgBytes, {
  outPath, title = 'Interactive diagram', facts = null,
  playwrightModulePath = process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE,
  browserExecutablePath = process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE,
} = {}) {
  if (!Buffer.isBuffer(svgBytes) || !svgBytes.length || svgBytes.length > 2_000_000) throw Error('INVALID_SVG_BYTES');
  if (!outPath || !path.isAbsolute(outPath)) throw Error('ABSOLUTE_INTERACTIVE_OUTPUT_REQUIRED');
  // Validate before opening the SVG in a browser or writing an executable document.
  createInteractiveHtml(svgBytes, {title});
  if (!facts) {
    let playwright;
    try { playwright = require(playwrightModulePath || 'playwright'); }
    catch { throw Error('PLAYWRIGHT_RUNTIME_UNAVAILABLE'); }
    const browser = await playwright.chromium.launch({headless:true,
      ...(browserExecutablePath ? {executablePath:browserExecutablePath} : {})});
    try {
      const page = await browser.newPage({javaScriptEnabled:false});
      await page.route('**/*', route => route.abort('blockedbyclient'));
      await page.evaluate(input => {
        const doc = new DOMParser().parseFromString(input, 'image/svg+xml');
        if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw Error('INVALID_SVG_XML');
        document.body.appendChild(document.importNode(doc.documentElement, true));
      }, svgBytes.toString('utf8'));
      facts = await page.evaluate(collectInteractiveFacts);
    } finally { await browser.close(); }
  }
  const sharedSections = deriveSharedSections(facts);
  const bytes = Buffer.from(createInteractiveHtml(svgBytes, {title, sharedSections}));
  const temp = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, bytes, {flag:'wx', mode:0o600});
    fs.renameSync(temp, outPath);
  } finally { fs.rmSync(temp, {force:true}); }
  return {file:path.basename(outPath), path:outPath, sha256:hash(bytes), sourceSvgSha256:hash(svgBytes),
    sharedSectionCount:sharedSections.length};
}
