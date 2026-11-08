import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(file,bytes)=>{const temp=path.join(path.dirname(file),`.${path.basename(file)}.${randomUUID()}.tmp`);try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})};};

/** Presentation-neutral browser images for Pi's actual original/candidate comparison. */
export async function renderAgentSvg(svgBytes,{outPrefix,displayWidth=1200,displayHeight=710,
  playwrightModulePath=process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE,
  browserExecutablePath=process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}={}){
  if(!Buffer.isBuffer(svgBytes)||svgBytes.length===0||svgBytes.length>2_000_000)throw Error('INVALID_SVG_BYTES');
  if(!outPrefix||!path.isAbsolute(outPrefix))throw Error('ABSOLUTE_OUTPUT_PREFIX_REQUIRED');
  if(!Number.isFinite(displayWidth)||displayWidth<320||displayWidth>2400||!Number.isFinite(displayHeight)||displayHeight<280||displayHeight>2400)throw Error('INVALID_DISPLAY_SIZE');
  let playwright;try{playwright=require(playwrightModulePath||'playwright')}catch{throw Error('PLAYWRIGHT_RUNTIME_UNAVAILABLE')}
  const svgHash=hash(svgBytes),browser=await playwright.chromium.launch({headless:true,...(browserExecutablePath?{executablePath:browserExecutablePath}:{})});
  const files=[];
  try{
    const page=await browser.newPage({deviceScaleFactor:2,viewport:{width:displayWidth,height:displayHeight},javaScriptEnabled:false});
    await page.route('**/*',route=>route.abort('blockedbyclient'));
    await page.setContent(svgBytes.toString('utf8'));
    const size=await page.evaluate(({displayWidth,displayHeight})=>{
      const svg=document.querySelector('svg');if(!svg)throw Error('SVG_MISSING');
      const view=svg.viewBox.baseVal,w=view?.width||Number.parseFloat(svg.getAttribute('width')),h=view?.height||Number.parseFloat(svg.getAttribute('height'));
      if(!(w>0&&h>0))throw Error('SVG_NATURAL_SIZE_UNAVAILABLE');
      const pageScale=Math.min(1,displayWidth/w),fullScale=Math.min(displayWidth/w,displayHeight/h),fontSizes=[...svg.querySelectorAll('text')].map(t=>Number.parseFloat(getComputedStyle(t).fontSize)).filter(Number.isFinite);
      const textBoxes=[...svg.querySelectorAll('text')].map((t,i)=>{const b=t.getBBox();return {i,x:b.x,y:b.y,w:b.width,h:b.height}});
      const overlaps=[];for(let i=0;i<textBoxes.length;i++)for(let j=i+1;j<textBoxes.length;j++){const a=textBoxes[i],b=textBoxes[j];if(a.x<b.x+b.w-.5&&b.x<a.x+a.w-.5&&a.y<b.y+b.h-.5&&b.y<a.y+a.h-.5)overlaps.push([a.i,b.i])}
      const offscreen=textBoxes.filter(t=>t.x<view.x-.5||t.y<view.y-.5||t.x+t.w>view.x+w+.5||t.y+t.h>view.y+h+.5).map(t=>t.i);
      svg.style.maxWidth='none';svg.style.width=`${w*pageScale}px`;svg.style.height=`${h*pageScale}px`;document.body.style.margin='0';
      return {natural:{w,h},pageScale,fullScale,fontSizes,textAudit:{overlaps:overlaps.slice(0,100),offscreen:offscreen.slice(0,100)}};
    },{displayWidth,displayHeight});
    if(size.natural.w*size.pageScale*size.natural.h*size.pageScale*4>40_000_000)throw Error('RENDER_PIXEL_BUDGET_EXCEEDED');
    await page.evaluate(()=>document.fonts.ready);
    const svg=page.locator('svg'),box=await svg.boundingBox();
    if(!box||box.width<=0||box.height<=0)throw Error('SVG_BOUNDS_UNAVAILABLE');
    await page.setViewportSize({width:Math.ceil(box.x+box.width),height:Math.ceil(box.y+box.height)});
    const stem=`${outPrefix}.${svgHash.slice(0,12)}`;
    const add=async(role,bytes)=>{const file=`${stem}.${role}.png`;save(file,bytes);const record={file:path.basename(file),path:file,sha256:hash(bytes)};files.push(record);return record};
    const full=await add('render-2x',await svg.screenshot());
    const crops=[];
    for(let row=0;row<2;row++)for(let col=0;col<2;col++)crops.push(await add(`crop-${row}-${col}`,await page.screenshot({clip:{x:box.x+col*box.width/2,y:box.y+row*box.height/2,width:box.width/2,height:box.height/2}})));
    await page.evaluate(({scale,w,h})=>{const svg=document.querySelector('svg');svg.style.width=`${w*scale}px`;svg.style.height=`${h*scale}px`;Object.assign(document.body.style,{display:'flex',alignItems:'center',justifyContent:'center',width:'100vw',height:'100vh',margin:'0',background:'#fff'})},{scale:size.fullScale,w:size.natural.w,h:size.natural.h});
    await page.setViewportSize({width:displayWidth,height:displayHeight});
    const fitBounds=await svg.boundingBox();
    if(!fitBounds||Math.abs(fitBounds.x+fitBounds.width/2-displayWidth/2)>1||Math.abs(fitBounds.y+fitBounds.height/2-displayHeight/2)>1)throw Error('CONTAIN_FIT_NOT_CENTERED');
    const fullscreen=await add('contain-2x',await page.screenshot());
    const effective=size.fontSizes.map(n=>n*size.fullScale).sort((a,b)=>a-b),mid=Math.floor(effective.length/2);
    return {status:'PASS',svgHash,full,crops,fullscreen,displayWidth,displayHeight,deviceScaleFactor:2,
      natural:size.natural,pageScale:size.pageScale,containFit:{scale:size.fullScale,fitBounds,textCount:effective.length,minCssPx:effective[0]??null,medianCssPx:effective.length?(effective.length%2?effective[mid]:(effective[mid-1]+effective[mid])/2):null,under10CssPx:effective.filter(n=>n<10).length},textAudit:size.textAudit,
      limitations:['Text overlap and offscreen checks are geometric observations, not a full visual or routing audit.']};
  }catch(error){for(const file of files)fs.rmSync(file.path,{force:true});throw error}
  finally{await browser.close()}
}
