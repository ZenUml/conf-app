import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readMermaidFlowchartModel, attachMermaidHighlights} from './mermaid-highlights.mjs';
import {installInteractiveSvg, INTERACTIVE_SVG_STYLE} from './interactive-runtime.mjs';
import {createSvgInstanceRuntime} from './svg-instance.mjs';

const require=createRequire(import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
const jsData=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

/** Render once with local Mermaid, then attach to those same nodes and curves.
 * This deliberately does not weaken the agent-SVG export's foreignObject ban. */
export async function exportMermaidInteractive(source, {
  outPath, mermaidBundlePath=process.env.PI_DIAGRAM_MERMAID_BUNDLE,
  playwrightModulePath=process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE,
  browserExecutablePath=process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE,
}={}) {
  const bytes=typeof source==='string'?Buffer.from(source):source;
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>256_000)throw Error('INVALID_MERMAID_SOURCE');
  const code=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  if(!Buffer.from(code,'utf8').equals(bytes))throw Error('SOURCE_NOT_EXACT_UTF8');
  if(!outPath||!path.isAbsolute(outPath))throw Error('ABSOLUTE_INTERACTIVE_OUTPUT_REQUIRED');
  if(!mermaidBundlePath||!path.isAbsolute(mermaidBundlePath))throw Error('MERMAID_BUNDLE_REQUIRED');
  const bundle=fs.readFileSync(mermaidBundlePath),pw=require(playwrightModulePath||'playwright');
  const browser=await pw.chromium.launch({headless:true,...(browserExecutablePath?{executablePath:browserExecutablePath}:{})});
  let rendered;
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),requests=[];
    page.setDefaultTimeout(30000);
    await page.route('**/*',route=>{requests.push(route.request().url());return route.abort('blockedbyclient')});
    await page.setContent('<!doctype html><meta charset="utf-8"><div id="diagram"></div>');
    await page.addScriptTag({content:bundle.toString('utf8')});
    await page.addScriptTag({content:`const readMermaidFlowchartModel=(${readMermaidFlowchartModel.toString()});const svgInstances=(${createSvgInstanceRuntime.toString()})();`});
    rendered=await page.evaluate(async code=>{
      mermaid.initialize({startOnLoad:false,theme:'neutral',securityLevel:'strict'});
      const diagram=await mermaid.mermaidAPI.getDiagramFromText(code);
      const model=readMermaidFlowchartModel(diagram);
      const result=await mermaid.render('mermaid-interactive',code);
      const host=document.getElementById('diagram');
      // Mermaid emits HTML label markup (e.g. <br>); normalize it off-document
      // before the XML mount, preserving the renderer's raw instance separately.
      const template=document.createElement('template');template.innerHTML=result.svg;
      const renderedSvg=new XMLSerializer().serializeToString(template.content.querySelector('svg'));
      window.instance=svgInstances.mountSvg(host,renderedSvg);
      await document.fonts.ready;
      return {svg:renderedSvg,model};
    },code);
    if(requests.length)throw Error('MERMAID_EXTERNAL_REQUEST_BLOCKED');
    // Resolve all bindings and prove that installation works before saving.
    await page.addScriptTag({content:`const INTERACTIVE_SVG_STYLE=${jsData(INTERACTIVE_SVG_STYLE)};const installInteractiveSvg=(${installInteractiveSvg.toString()});const attachMermaidHighlights=(${attachMermaidHighlights.toString()});attachMermaidHighlights(instance.svg,${jsData(rendered.model)},instance);svgInstances.validateSvgReferences(instance.svg);`});
  } finally {await browser.close()}
  const script=`
const data=${jsData(rendered)};
const INTERACTIVE_SVG_STYLE=${jsData(INTERACTIVE_SVG_STYLE)};
const installInteractiveSvg=(${installInteractiveSvg.toString()});
const attachMermaidHighlights=(${attachMermaidHighlights.toString()});
const svgInstances=(${createSvgInstanceRuntime.toString()})();
const instance=svgInstances.mountSvg(document.getElementById('diagram'),data.svg,{afterMount:(svg,binding)=>attachMermaidHighlights(svg,data.model,{...binding,status:document.getElementById('hover-status')})});
const {svg}=instance;
const box=svg.viewBox.baseVal;
const native=()=>{svg.style.maxWidth='none';svg.style.width=box.width+'px';svg.style.height=box.height+'px'};
document.getElementById('view-native').addEventListener('click',native);
document.getElementById('view-fit').addEventListener('click',()=>{svg.style.width='100%';svg.style.height='auto';svg.style.maxWidth='100%'});native();
`;
  const scriptHash=createHash('sha256').update(script).digest('base64');
  const html=Buffer.from(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'"><title>Mermaid 关系高亮</title><style>body{margin:0;padding:20px;background:#f6f7f9;font:14px system-ui}#diagram{overflow:auto;max-height:80vh;background:white;padding:12px;border:1px solid #ddd}button{margin:0 8px 12px 0;padding:6px 12px}svg{display:block}</style></head><body><button id="view-fit">适应窗口</button><button id="view-native">100%</button><div id="diagram"></div><p id="hover-status" role="status" aria-live="polite"></p><script>${script}</script></body></html>`);
  const temp=path.join(path.dirname(outPath),`.${path.basename(outPath)}.${randomUUID()}.tmp`);
  try {fs.writeFileSync(temp,html,{flag:'wx',mode:0o600});fs.renameSync(temp,outPath)}finally{fs.rmSync(temp,{force:true})}
  return {file:path.basename(outPath),path:outPath,sha256:sha(html),sourceHash:sha(bytes),renderedSvgHash:sha(rendered.svg),
    mermaidBundleHash:sha(bundle),nodeCount:rendered.model.nodes.length,edgeCount:rendered.model.edges.length};
}
