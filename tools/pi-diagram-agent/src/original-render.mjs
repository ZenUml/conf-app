import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeName=name=>/^[a-zA-Z0-9._-]+$/.test(name)&&name!=='.'&&name!=='..';
const DEFAULT_CONFIG=Object.freeze({startOnLoad:false,theme:'neutral'});

function localFile(file,kind){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error(`${kind}_PATH_MUST_BE_ABSOLUTE`);
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error(`${kind}_MUST_BE_REGULAR_FILE`);
  return fs.readFileSync(file);
}
function sourceBytes(source){
  const bytes=Buffer.isBuffer(source)?source:typeof source==='string'?Buffer.from(source,'utf8'):null;
  if(!bytes||bytes.length===0)throw Error('SOURCE_REQUIRED');
  let decoded;
  try{decoded=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}
  catch{throw Error('SOURCE_NOT_EXACT_UTF8')}
  if(Buffer.from(decoded,'utf8').compare(bytes)!==0)throw Error('SOURCE_NOT_EXACT_UTF8');
  return {bytes,text:decoded};
}
function versionFor(bundlePath){
  const packageFile=path.resolve(path.dirname(bundlePath),'..','package.json');
  try{const pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));return pkg.name==='mermaid'&&typeof pkg.version==='string'?pkg.version:null}catch{return null}
}
function getPlaywright(modulePath){
  try{return require(modulePath||process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE||'playwright')}
  catch{throw Error('PLAYWRIGHT_RUNTIME_UNAVAILABLE')}
}
function bounded(promise,timeoutMs){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ORIGINAL_BROWSER_TIMEOUT')),timeoutMs)})])
    .finally(()=>clearTimeout(timer));
}
function outputDirectory(outPrefix){
  if(typeof outPrefix!=='string'||!path.isAbsolute(outPrefix)||!safeName(path.basename(outPrefix)))throw Error('INVALID_OUTPUT_PREFIX');
  const dir=path.dirname(outPrefix),stat=fs.lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('OUTPUT_DIRECTORY_UNAVAILABLE');
  return dir;
}

/** Browser-render a raw Mermaid input with a local product bundle. PASS means evidence captured, not semantic improvement. */
export async function renderOriginalMermaid(source,{
  outPrefix,mermaidBundlePath,mermaidConfig=DEFAULT_CONFIG,playwrightModulePath,
  browserExecutablePath=process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE,
  displayWidth=1200,timeoutMs=30000,
}={}){
  const dir=outputDirectory(outPrefix);
  const {bytes:rawBytes,text:raw}=sourceBytes(source);
  if(rawBytes.length>2_000_000)throw Error('ORIGINAL_SOURCE_SIZE_LIMIT');
  if(!mermaidBundlePath)throw Error('MERMAID_BUNDLE_REQUIRED');
  const bundleBytes=localFile(mermaidBundlePath,'MERMAID_BUNDLE');
  if(!Number.isFinite(displayWidth)||displayWidth<320||displayWidth>2400)throw Error('INVALID_DISPLAY_WIDTH');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw Error('INVALID_TIMEOUT');
  if(!mermaidConfig||typeof mermaidConfig!=='object'||Array.isArray(mermaidConfig))throw Error('INVALID_MERMAID_CONFIG');
  const config=structuredClone(mermaidConfig);
  if(config.startOnLoad!==false)throw Error('MERMAID_AUTOSTART_UNSUPPORTED');
  const rendered=raw.replaceAll('\u00a0',' ');
  const sourceHash=hash(rawBytes),renderedSourceHash=hash(Buffer.from(rendered,'utf8')),
    bundleHash=hash(bundleBytes),configHash=hash(Buffer.from(JSON.stringify(config)));
  const version=versionFor(mermaidBundlePath);
  const playwright=getPlaywright(playwrightModulePath);
  const browser=await playwright.chromium.launch({headless:true,timeout:timeoutMs,...(browserExecutablePath?{executablePath:browserExecutablePath}:{})});
  const runStem=`${path.basename(outPrefix)}.original.${sourceHash.slice(0,12)}.${bundleHash.slice(0,12)}.${randomUUID()}`;
  const staged=fs.mkdtempSync(path.join(dir,`.${runStem}.`));
  const promoted=[];
  let page;
  try{
    page=await browser.newPage({deviceScaleFactor:2,viewport:{width:Math.ceil(displayWidth),height:900},javaScriptEnabled:true});
    page.setDefaultTimeout(timeoutMs);
    const blockedRequests=[];
    await page.route('**/*',route=>{blockedRequests.push(route.request().url());return route.abort('blockedbyclient')});
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff"><div id="diagram"></div></body></html>');
    await bounded(page.addScriptTag({content:bundleBytes.toString('utf8')}),timeoutMs);
    const renderedResult=await bounded(page.evaluate(async ({source:code,config:settings,renderId})=>{
      const mermaid=globalThis.mermaid;
      if(!mermaid||typeof mermaid.initialize!=='function'||typeof mermaid.render!=='function')throw Error('MERMAID_API_UNAVAILABLE');
      mermaid.initialize(settings);
      const result=await mermaid.render(renderId,code);
      const host=document.getElementById('diagram');
      host.innerHTML=result.svg;
      result.bindFunctions?.(host);
      const svg=host.querySelector('svg');
      if(!svg)throw Error('MERMAID_SVG_MISSING');
      return {svg:svg.outerHTML,textCount:svg.querySelectorAll('text').length,htmlLabelCount:svg.querySelectorAll('foreignObject').length};
    },{source:rendered,config,renderId:`original-${sourceHash.slice(0,20)}`}),timeoutMs);
    if(blockedRequests.length)throw Error('ORIGINAL_EXTERNAL_REQUEST_BLOCKED');
    const svgBytes=Buffer.from(renderedResult.svg,'utf8'),svgHash=hash(svgBytes);
    const metrics=await page.evaluate(width=>{
      const svg=document.querySelector('#diagram svg'),view=svg.viewBox.baseVal;
      const naturalWidth=view?.width||Number.parseFloat(svg.getAttribute('width')),
        naturalHeight=view?.height||Number.parseFloat(svg.getAttribute('height'));
      if(!Number.isFinite(naturalWidth)||!Number.isFinite(naturalHeight)||naturalWidth<=0||naturalHeight<=0)throw Error('MERMAID_DIMENSIONS_UNAVAILABLE');
      const shownWidth=Math.min(width,naturalWidth),shownHeight=naturalHeight*shownWidth/naturalWidth;
      if(shownWidth*shownHeight*4>40_000_000||shownWidth>8000||shownHeight>8000)throw Error('RENDER_PIXEL_BUDGET_EXCEEDED');
      svg.style.maxWidth='none';svg.style.width=`${shownWidth}px`;svg.style.height=`${shownHeight}px`;
      document.body.style.width=`${shownWidth}px`;
      return {naturalWidth,naturalHeight,displayWidth:shownWidth,displayHeight:shownHeight,fitScale:shownWidth/naturalWidth};
    },displayWidth);
    await page.evaluate(()=>document.fonts.ready);
    const box=await page.locator('#diagram svg').boundingBox();
    if(!box||box.width<=0||box.height<=0)throw Error('SVG_BOUNDS_UNAVAILABLE');
    await page.setViewportSize({width:Math.ceil(box.x+box.width),height:Math.ceil(box.y+box.height)});
    const fullBytes=await page.locator('#diagram svg').screenshot({timeout:timeoutMs});
    const files=[{role:'svg',name:`${runStem}.${svgHash.slice(0,12)}.svg`,bytes:svgBytes},
      {role:'full',name:`${runStem}.${svgHash.slice(0,12)}.render-2x.png`,bytes:fullBytes}];
    for(let row=0;row<2;row++)for(let col=0;col<2;col++){
      const crop=await page.screenshot({clip:{x:box.x+col*box.width/2,y:box.y+row*box.height/2,width:box.width/2,height:box.height/2},timeout:timeoutMs});
      files.push({role:`crop-${row}-${col}`,name:`${runStem}.${svgHash.slice(0,12)}.crop-${row}-${col}.png`,bytes:crop});
    }
    for(const item of files)fs.writeFileSync(path.join(staged,item.name),item.bytes,{flag:'wx',mode:0o600});
    const evidence={status:'PASS',sourceHash,rawSourceBytes:rawBytes.length,renderedSourceHash,
      normalization:raw===rendered?'none':'nbsp-to-space',mermaid:{version,bundleHash,config,configHash},
      originalSvgHash:svgHash,metrics,deviceScaleFactor:2,
      media:Object.fromEntries(files.map(f=>[f.role,{file:f.name,sha256:hash(f.bytes),bytes:f.bytes.length}])),
      observations:{svgTextElements:renderedResult.textCount,htmlLabelElements:renderedResult.htmlLabelCount,blockedRequestCount:blockedRequests.length},
      limitations:['Original browser rendering is evidence for visual comparison, not semantic or layout certification.',
        'Standalone browser page does not reproduce the product DiagramViewport sizing, pan, or zoom.',
        ...(renderedResult.htmlLabelCount?['HTML labels inside foreignObject are included in screenshots but not independently measured for collisions.']:[]),
        ...(version?[]:['Bundle package version unavailable; bundle SHA-256 remains authoritative.'])]};
    const receiptName=`${runStem}.${svgHash.slice(0,12)}.evidence.json`;
    fs.writeFileSync(path.join(staged,receiptName),JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
    for(const item of files){const destination=path.join(dir,item.name);fs.renameSync(path.join(staged,item.name),destination);promoted.push(destination)}
    const receiptPath=path.join(dir,receiptName);fs.renameSync(path.join(staged,receiptName),receiptPath);promoted.push(receiptPath);
    return {...evidence,receiptPath};
  }catch(error){for(const file of promoted)fs.rmSync(file,{force:true});throw error}
  finally{await page?.close().catch(()=>{});await browser.close();fs.rmSync(staged,{recursive:true,force:true})}
}

/** Measure source labels against declared fixed tiers using browser glyph advances.
 * This is a sizing witness, not an SVG ink or final-drawing certificate.
 */
export async function measureMermaidLabelTiers(source,{
  model,actualTiers={},playwrightModulePath,browserExecutablePath=process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE,
  timeoutMs=30000,
}={}){
  const {bytes,text}=sourceBytes(source),sourceHash=hash(bytes),
    renderedSourceHash=hash(Buffer.from(text.replaceAll('\u00a0',' '),'utf8'));
  if(bytes.length>256_000)throw Error('FONT_SOURCE_SIZE_LIMIT');
  const {parseMermaid}=await import('./parser.mjs');
  const parsed=parseMermaid(text);
  if(parsed.sourceHash!==sourceHash)throw Error('SOURCE_PARSER_HASH_MISMATCH');
  if(parsed.nodes.length>64||parsed.nodes.some(n=>n.text.length>2048||n.text.split(/\s+/).length>256||n.text.split('\n').length>64))
    throw Error('FONT_MEASUREMENT_SIZE_LIMIT');
  if(model){
    if(model.sourceHash!==sourceHash||JSON.stringify(model.nodes.map(n=>[n.id,n.text]))!==JSON.stringify(parsed.nodes.map(n=>[n.id,n.text])))
      throw Error('MODEL_SOURCE_BINDING_MISMATCH');
  }
  const {BOX_RULES_PROFILE}=await import('./rules-profile.mjs');
  const rules=BOX_RULES_PROFILE.sizingContract;
  const tiers=rules.tiers.map(([w,h])=>({w,h}));
  const nodeIds=new Set(parsed.nodes.map(n=>n.id));
  if(Object.keys(actualTiers).some(id=>!nodeIds.has(id)))throw Error('ACTUAL_TIER_UNKNOWN_NODE');
  const playwright=getPlaywright(playwrightModulePath);
  const browser=await playwright.chromium.launch({headless:true,timeout:timeoutMs,...(browserExecutablePath?{executablePath:browserExecutablePath}:{})});
  try{
    const page=await browser.newPage({viewport:{width:800,height:600}});
    page.setDefaultTimeout(timeoutMs);
    await page.route('**/*',route=>route.abort('blockedbyclient'));
    await page.setContent('<!doctype html><html><meta charset="utf-8"><body></body></html>');
    const measured=await bounded(page.evaluate(({nodes,tiers,horizontalPadding,verticalPadding,firstLineInkHeight,lineHeight})=>{
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      if(!ctx)throw Error('CANVAS_UNAVAILABLE');
      const width=(s,size)=>{ctx.font=`400 ${size}px Arial, Helvetica, sans-serif`;return ctx.measureText(s).width};
      const wrap=(paragraph,available,size)=>{
        const words=paragraph.trim().split(/\s+/).filter(Boolean),lines=[];let line='';
        for(const word of words){if(width(word,size)>available+1e-6)return {lines:[],tooWideWord:word};
          const combined=line?`${line} ${word}`:word;
          if(line&&width(combined,size)>available+1e-6){lines.push(line);line=word}else line=combined;
        }
        lines.push(line);return {lines,tooWideWord:null};
      };
      return nodes.map(node=>{
        const paragraphs=node.text.split('\n'),hasDetail=paragraphs.length>1;
        const measuredTiers=tiers.map((tier,index)=>{
          const available=tier.w-horizontalPadding;
          let lines=[],error=null,fontSizes=[];
          if(hasDetail){for(let p=0;p<paragraphs.length;p++){
            const size=p===0?16:14,result=wrap(paragraphs[p],available,size);
            if(result.tooWideWord){error='unbreakable-word';break}
            lines.push(...result.lines);fontSizes.push(...result.lines.map(()=>size));
          }}else{
            const primary=wrap(node.text,available,16);
            if(primary.tooWideWord)error='unbreakable-word';
            else{lines=primary.lines;fontSizes=lines.map(()=>16)}
          }
          const widths=lines.map((line,i)=>width(line,fontSizes[i]));
          const requiredHeight=firstLineInkHeight+Math.max(0,lines.length-1)*lineHeight+verticalPadding;
          return {index,tier:[tier.w,tier.h],availableWidth:available,lines,fontSizes,
            measuredWidths:widths,requiredHeight,
            fits:!error&&requiredHeight<=tier.h&&widths.every(w=>w<=available+1e-6),error};
        });
        return {id:node.id,tiers:measuredTiers};
      });
    },{nodes:parsed.nodes.map(n=>({id:n.id,text:n.text})),tiers,
      horizontalPadding:rules.horizontalPadding,verticalPadding:rules.verticalPadding,
      firstLineInkHeight:rules.firstLineInkHeight,lineHeight:rules.lineHeight}),timeoutMs);
    const nodes=measured.map((item,i)=>{
      const first=item.tiers.find(t=>t.fits),actual=actualTiers[item.id]??null;
      const actualIndex=actual?tiers.findIndex(t=>t.w===actual[0]&&t.h===actual[1]):null;
      if(actual&&actualIndex<0)throw Error(`ACTUAL_TIER_UNDECLARED:${item.id}`);
      return {id:item.id,textHash:hash(Buffer.from(parsed.nodes[i].text,'utf8')),
        firstFittingTier:first?.tier??null,firstFittingIndex:first?.index??null,
        actualTier:actual,actualIndex,
        smallerTierWitness:actualIndex!=null&&first&&first.index<actualIndex?{tier:first.tier,lines:first.lines,measuredWidths:first.measuredWidths,requiredHeight:first.requiredHeight}:null,
        unresolved:!first?'no measured tier fits':null,
        tiers:item.tiers};
    });
    return {status:'MEASURED',sourceHash,renderedSourceHash,method:{engine:'Chromium CanvasRenderingContext2D.measureText',browserVersion:browser.version(),
      font:'400 16px Arial, Helvetica, sans-serif primary; 400 14px Arial, Helvetica, sans-serif detail',tiers:rules.tiers,
      horizontalPadding:rules.horizontalPadding,verticalPadding:rules.verticalPadding,
      firstLineInkHeight:rules.firstLineInkHeight,lineHeight:rules.lineHeight},nodes,
      limitations:['Canvas advance widths are measured; actual SVG text ink bounds and rendered wrapping still need independent verification.']};
  }finally{await browser.close()}
}
