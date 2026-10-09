import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {createSvgInstanceRuntime} from '../src/svg-instance.mjs';
import {createInteractiveHtml} from '../src/interactive-svg.mjs';
import {installInteractiveSvg, INTERACTIVE_SVG_STYLE} from '../src/interactive-runtime.mjs';
import {attachMermaidHighlights} from '../src/mermaid-highlights.mjs';

const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="fixture" width="240" height="100" viewBox="0 0 240 100" aria-labelledby="title description"><title id="title">Fixture</title><desc id="description">Arrow fixture</desc><defs><linearGradient id="paint"><stop stop-color="#345678"/><stop offset="1" stop-color="#345678"/></linearGradient><clipPath id="clip"><rect width="240" height="100"/></clipPath><mask id="mask"><rect width="240" height="100" fill="white"/></mask><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="20" refX="20" refY="10" orient="auto"><path d="M0 0 L20 10 L0 20 Z" fill="url(#paint)"/></marker><path id="sample" d="M0 0"/></defs><style>#fixture .edge{stroke:#345678;marker-end:url('#arrow')}#abcdef{fill:#abcdef}</style><g data-group="G" clip-path="url(#clip)" mask="url(#mask)"><path id="relation" class="edge flowchart-link" data-edge="E" data-id="E" data-source="A" data-target="B" d="M20 50 L180 50" fill="none" stroke-width="2"/><g id="node-A" class="node" data-node="A"><rect width="20" height="20" y="40"/></g><g id="node-B" class="node" data-node="B"><rect width="20" height="20" x="180" y="40"/></g><rect id="abcdef" width="2" height="2"/></g><use href="#sample"/><use xlink:href="#sample"/></svg>`;
const hash = value => createHash('sha256').update(value).digest('hex');
const enabled = !!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
async function withPage(run) {
  const pw = createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE);
  const browser = await pw.chromium.launch({headless:true,
    ...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1100,height:700}}), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {requests.push(route.request().url());return route.abort()});
    await page.setContent(`<style>body{margin:0;background:white}#pair{display:flex}svg{display:block}${INTERACTIVE_SVG_STYLE}</style><div id="hidden" style="display:none"></div><div id="single"></div><div id="original"></div><div id="pair"></div>`);
    await page.addScriptTag({content:`window.instances=(${createSvgInstanceRuntime.toString()})();window.installInteractiveSvg=(${installInteractiveSvg.toString()});const INTERACTIVE_SVG_STYLE=${JSON.stringify(INTERACTIVE_SVG_STYLE)};window.attachMermaidHighlights=(${attachMermaidHighlights.toString()});`});
    await run(page);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await browser.close(); }
}
// Decode the Chromium screenshot's RGB/RGBA PNG pixels, using only Node built-ins.
function paintedPixels(png) {
  let width, height, channels, chunks=[];
  for(let at=8;at<png.length;) {
    const length=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8),data=png.subarray(at+8,at+8+length);
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);channels=data[9]===2?3:data[9]===6?4:0;assert.ok(channels);assert.equal(data[12],0)}
    if(type==='IDAT')chunks.push(data);at+=length+12;
  }
  const data=inflateSync(Buffer.concat(chunks)),stride=width*channels,rows=Buffer.alloc(height*stride);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
  for(let y=0;y<height;y++)for(let x=0;x<stride;x++) {
    const filter=data[y*(stride+1)],raw=data[y*(stride+1)+x+1],a=x>=channels?rows[y*stride+x-channels]:0,b=y?rows[(y-1)*stride+x]:0,c=y&&x>=channels?rows[(y-1)*stride+x-channels]:0;
    assert.ok(filter<=4);rows[y*stride+x]=(raw+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
  }
  let count=0;for(let at=0;at<rows.length;at+=channels)if(rows[at]<180&&rows[at+1]<190&&rows[at+2]<210)count++;
  return count;
}
async function arrowCrop(page, host, index=0, y=40) {
  const rect = await page.locator(`${host} svg`).nth(index).evaluate((svg,y) => {
    const p = new DOMPoint(160, y).matrixTransform(svg.getScreenCTM());
    return {x:p.x,y:p.y,width:20,height:8};
  },y);
  // This crop contains the triangular arrow above the shaft (which is at y+10).
  return paintedPixels(await page.screenshot({clip:rect,animations:'disabled'}));
}
const mount = (page, host, text=source) => page.evaluate(({host,text}) => {
  window.mounted = instances.mountSvg(document.querySelector(host), text);
}, {host,text});

test('static wrapper refuses duplicate IDs and dangling marker/ARIA references before export', () => {
  const input = source.replace(/<use[^>]*\/>/g, '');
  assert.doesNotThrow(() => createInteractiveHtml(input));
  assert.doesNotThrow(() => createInteractiveHtml(input.replace('data-group="G"','data-group="url(#semantic-only)"')));
  assert.throws(() => createInteractiveHtml(input.replace('id="sample"','id="arrow"')), /SVG_DUPLICATE_ID/);
  assert.throws(() => createInteractiveHtml(input.replace("url('#arrow')", "url('#absent')")), /SVG_DANGLING_REFERENCE/);
  assert.throws(() => createInteractiveHtml(input.replace('title description','title absent')), /SVG_DANGLING_REFERENCE/);
});

test('independent factories namespace each SVG; refs, selectors, semantics and color literals survive', {skip:!enabled}, async () => withPage(async page => {
  const before = hash(source);
  await mount(page, '#hidden'); await mount(page, '#pair');
  await page.evaluate(({text,factory}) => {
    window.secondRuntime = (0,eval)(`(${factory})`)();
    secondRuntime.mountSvg(document.querySelector('#pair'), text);
  }, {text:source,factory:createSvgInstanceRuntime.toString()});
  const result = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('svg')];
    return {
      count:roots.length, ids:[...document.querySelectorAll('[id]')].map(e => e.id),
      checks:roots.map(svg => instances.validateSvgReferences(svg)),
      semantics:roots.map(svg => [svg.querySelector('[data-node]').dataset.node,svg.querySelector('[data-edge]').dataset.edge,svg.querySelector('[data-group]').dataset.group]),
      colors:roots.map(svg => getComputedStyle(svg.querySelector('rect[id]')).fill),
      hrefs:roots.map(svg => [...svg.querySelectorAll('use')].map(e => e.getAttribute('href') || e.getAttribute('xlink:href'))),
      styles:roots.map(svg => svg.querySelector('style').textContent),
    };
  });
  assert.equal(result.count, 3); assert.equal(new Set(result.ids).size, result.ids.length);
  for (const check of result.checks) assert.ok(check.referenceCount >= 8);
  for (const semantics of result.semantics) assert.deepEqual(semantics, ['A','E','G']);
  for (const color of result.colors) assert.equal(color, 'rgb(171, 205, 239)');
  for (const hrefs of result.hrefs) assert.ok(hrefs.every(h => /^#pi-svg-/.test(h)));
  for (const style of result.styles) assert.match(style, /fill:#abcdef/);
  assert.equal(hash(source), before);
}));

test('painted arrows persist through retained hidden/single/pair/original views, next graphs and repeated mounts', {skip:!enabled}, async () => withPage(async page => {
  await mount(page, '#single');
  const painted = await arrowCrop(page, '#single');
  assert.ok(painted>40,'expected triangle paint above the shaft');
  await page.evaluate(() => document.querySelector('#single .edge').style.markerEnd='none');
  assert.equal(await arrowCrop(page, '#single'),0,'marker-none negative control is blank');
  await page.evaluate(() => {document.querySelector('#single .edge').style.removeProperty('marker-end');document.querySelector('#single marker').setAttribute('orient','180')});
  assert.equal(await arrowCrop(page, '#single'),0,'reversed arrow direction must fail the expected region');
  await page.evaluate(() => document.querySelector('#single').replaceChildren());
  await page.evaluate(text => {document.querySelector('#hidden').innerHTML=text;document.querySelector('#single').innerHTML=text}, source);
  assert.equal(await arrowCrop(page, '#single'),0,'raw hidden duplicate reproduces missing marker paint');
  const second=source.replace('id="arrow"','id="next-arrow"').replace(/#arrow/g,'#next-arrow')
    .replace('id="fixture"','id="next-graph"').replace(/#fixture/g,'#next-graph')
    .replace('id="relation"','id="next-relation"').replace('height="100" viewBox="0 0 240 100"','height="150" viewBox="0 0 240 150"')
    .replace('</defs>','<marker id="second-arrow" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="20" refX="20" refY="10" orient="auto"><path d="M0 0 L20 10 L0 20 Z" fill="#345678"/></marker></defs>')
    .replace('</svg>','<path data-edge="E2" data-source="A" data-target="B" d="M20 110 L180 110" fill="none" stroke="#345678" stroke-width="2" marker-end="url(#second-arrow)"/></svg>');
  for(const [turn,text] of [source,second,source].entries()) {
    await page.evaluate(() => {for(const id of ['hidden','single','original','pair'])document.getElementById(id).replaceChildren()});
    await mount(page,'#hidden',text);await mount(page,'#single',text);
    await mount(page,'#original',text.replace('Fixture','Original'));
    await mount(page,'#pair',text.replace('Fixture','Original'));await mount(page,'#pair',text.replace('Fixture','Refined'));
    // Retain every SVG while changing the visible stage: single→pair→original→pair.
    for(const visible of ['single','pair','original','pair']) {
      await page.evaluate(visible=>{for(const id of ['single','original','pair'])document.getElementById(id).style.display=id===visible?(id==='pair'?'flex':'block'):'none'},visible);
      for(let index=0;index<(visible==='pair'?2:1);index++) {
        assert.ok(Math.abs(await arrowCrop(page,`#${visible}`,index)-painted)<10,`${turn} ${visible} ${index}: triangle paint remains`);
        if(turn===1)assert.ok(await arrowCrop(page,`#${visible}`,index,100)>40,'second graph also paints its separate marker');
      }
    }
  }
  await page.evaluate(() => {
    const svg=document.querySelector('#pair svg:last-child');window.control=installInteractiveSvg(svg);
    svg.querySelector('.edge-hit').dispatchEvent(new MouseEvent('click',{bubbles:true}));instances.validateSvgReferences(svg);
  });
  assert.equal(await page.locator('#pair .active-edge-overlay').count(),1);
  assert.ok(Math.abs(await arrowCrop(page,'#pair',1)-painted)<10,'selection overlay retains expected arrow paint');
}));

test('invalid mounts preserve host; validation catches cross-owner/collision and unsupported CSS', {skip:!enabled}, async () => withPage(async page => {
  await mount(page, '#single');
  const result = await page.evaluate(text => {
    const host=document.querySelector('#single'), before=host.innerHTML, failures=[];
    for (const candidate of [text.replace('id="sample"','id="arrow"'),text.replace("url('#arrow')","url('#absent')"),text.replace('#fixture .edge','#fixture\\ .edge'),text.replace('#fixture .edge',':is(.edge,.other)'),text.replace('#fixture .edge','[id="relation"]')]) {
      try { instances.mountSvg(host,candidate); failures.push('accepted'); } catch(e) {failures.push(e.message)}
    }
    try {instances.mountSvg(host,text,{afterMount(){throw Error('HOOK_FAILED')}})} catch(e) {failures.push(e.message)}
    const preserved=before===host.innerHTML;
    const svg=host.querySelector('svg'),marker=svg.querySelector('marker');
    const foreign=document.createElementNS('http://www.w3.org/2000/svg','svg');foreign.append(marker);document.querySelector('#pair').append(foreign);
    try {instances.validateSvgReferences(svg)} catch(e) {failures.push(e.message)}
    svg.querySelector('defs').append(marker);
    const duplicate=marker.cloneNode(true);document.querySelector('#hidden').append(duplicate);
    try {instances.validateSvgReferences(svg)} catch(e) {failures.push(e.message)}
    duplicate.remove();
    const nested=document.createElementNS('http://www.w3.org/2000/svg','svg');nested.append(marker);svg.append(nested);
    try {instances.validateSvgReferences(svg)} catch(e) {failures.push(e.message)}
    return {failures,preserved};
  },source);
  assert.equal(result.preserved,true);
  assert.match(result.failures[0],/DUPLICATE_ID/);assert.match(result.failures[1],/DANGLING_REFERENCE/);
  assert.match(result.failures[2],/CSS_SYNTAX_UNSUPPORTED/);assert.match(result.failures[3],/CSS_SELECTOR_UNSUPPORTED/);assert.match(result.failures[4],/CSS_SELECTOR_UNSUPPORTED/);assert.equal(result.failures[5],'HOOK_FAILED');
  assert.match(result.failures[6],/REFERENCE_WRONG_OWNER/);assert.match(result.failures[7],/DOCUMENT_ID_COLLISION/);
  assert.match(result.failures[8],/REFERENCE_WRONG_OWNER/);
}));

test('namespaced Mermaid-style bindings attach repeatedly, reset and destroy with stable IDs', {skip:!enabled}, async () => withPage(async page => {
  await mount(page,'#single');
  const result = await page.evaluate(() => {
    const {svg,idMap,sourceRootId}=mounted,model={type:'flowchart-v2',nodes:[{id:'A',domId:'node-A'},{id:'B',domId:'node-B'}],edges:[{id:'E',source:'A',target:'B'}]};
    const original=svg.outerHTML, originalModel=JSON.stringify(model);
    let control=attachMermaidHighlights(svg,model,{idMap,sourceRootId});
    svg.querySelector('.edge-hit').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    instances.validateSvgReferences(svg);control.reset();
    control=attachMermaidHighlights(svg,model,{idMap,sourceRootId});
    const hits=svg.querySelectorAll('.edge-hit').length;control.destroy();
    return {hits,restored:original===svg.outerHTML,modelUntouched:originalModel===JSON.stringify(model),check:instances.validateSvgReferences(svg)};
  });
  assert.equal(result.hits,1);assert.equal(result.restored,true);assert.equal(result.modelUntouched,true);
}));

test('root tag/class styles and descendant CSS keep paint while each instance stays scoped', {skip:!enabled}, async()=>withPage(async page=>{
  const text=source.replace('id="fixture"','id="fixture" class="root-class"').replace('</style>','svg{color:#112233}.root-class{stroke:#123456}.edge{stroke:#234567}svg path{stroke-linecap:round}.root-class .node{fill:#789abc}</style>');
  await mount(page,'#single',text);await mount(page,'#pair',source);
  const paints=await page.evaluate(()=>[...document.querySelectorAll('#single svg,#pair svg')].map(svg=>({color:getComputedStyle(svg).color,stroke:getComputedStyle(svg).stroke,edge:getComputedStyle(svg.querySelector('.edge')).stroke,cap:getComputedStyle(svg.querySelector('.edge')).strokeLinecap,node:getComputedStyle(svg.querySelector('.node')).fill})));
  assert.equal(paints[0].color,'rgb(17, 34, 51)');assert.equal(paints[0].stroke,'rgb(18, 52, 86)');
  // Existing ID-scoped edge rule has greater specificity, as in the source.
  assert.equal(paints[0].edge,'rgb(52, 86, 120)');assert.equal(paints[1].edge,'rgb(52, 86, 120)');
  assert.notEqual(paints[1].color,paints[0].color);assert.equal(paints[0].cap,'round');assert.equal(paints[0].node,'rgb(120, 154, 188)');assert.notEqual(paints[1].cap,paints[0].cap);
}));

test('keyframe names work across separate style blocks and inline animation declarations', {skip:!enabled},async()=>withPage(async page=>{
  const text=source.replace('</svg>','<style>@keyframes pulse{from{stroke-dashoffset:10}to{stroke-dashoffset:0}}</style><style>.edge{animation-name:pulse;animation-duration:2s}</style><path class="inline" d="M1 1 L2 2" style="ANIMATION:pulse 3s linear infinite"/></svg>');
  await mount(page,'#single',text);await mount(page,'#pair',text);
  const names=await page.evaluate(()=>[...document.querySelectorAll('#single svg,#pair svg')].map(svg=>[getComputedStyle(svg.querySelector('.edge')).animationName,getComputedStyle(svg.querySelector('.inline')).animationName]));
  for(const pair of names){assert.match(pair[0],/^pi-svg-\d+-\d+-kf-pulse$/);assert.equal(pair[0],pair[1])}assert.notEqual(names[0][0],names[1][0]);
}));

test('IDREF attribute selectors are rejected before mount and semantic bindings stay verbatim', {skip:!enabled},async()=>withPage(async page=>{
  await mount(page,'#single');
  const result=await page.evaluate(text=>{
    const host=document.querySelector('#single'),before=host.innerHTML;
    let error;try{instances.mountSvg(host,text.replace('#fixture .edge','[aria-labelledby="title"]'))}catch(e){error=e.message}
    const instance=instances.mountSvg(document.querySelector('#pair'),text.replace('data-group="G"','data-group="url(#arrow)"'));
    return {error,unchanged:before===host.innerHTML,semantic:instance.svg.querySelector('[data-group]').getAttribute('data-group')};
  },source);assert.match(result.error,/SVG_CSS_SELECTOR_UNSUPPORTED/);assert.equal(result.unchanged,true);assert.equal(result.semantic,'url(#arrow)');
}));

test('mounted paint validation refuses a host CSS marker override owned by another SVG', {skip:!enabled},async()=>withPage(async page=>{
  const result=await page.evaluate(text=>{
    document.querySelector('#hidden').innerHTML='<svg xmlns="http://www.w3.org/2000/svg"><defs><marker id="foreign-arrow"/></defs></svg>';
    const style=document.createElement('style');style.textContent='#single .edge{marker-end:url(#foreign-arrow)!important}';document.head.append(style);
    const host=document.querySelector('#single');let error;
    try{instances.mountSvg(host,text)}catch(e){error=e.message}
    return {error,children:host.childElementCount};
  },source);assert.match(result.error,/SVG_REFERENCE_WRONG_OWNER:foreign-arrow/);assert.equal(result.children,0);
}));

test('leading-hyphen ID selectors retain style; Unicode selectors and ambiguous animation names reject', {skip:!enabled},async()=>withPage(async page=>{
  const text=source.replace('id="relation"','id="-relation"').replace('#fixture .edge','#-relation');
  await mount(page,'#single',text);
  assert.equal(await page.locator('#single .edge').evaluate(e=>getComputedStyle(e).stroke),'rgb(52, 86, 120)');
  const errors=await page.evaluate(text=>{
    const failures=[];
    for(const svg of [text.replace('#-relation','#é'),text.replace('</svg>','<style>@keyframes linear{from{opacity:0}to{opacity:1}}.edge{animation:linear 1s linear}</style></svg>')])
      try{instances.mountSvg(document.querySelector('#pair'),svg)}catch(e){failures.push(e.message)}
    return failures;
  },text);assert.match(errors[0],/SVG_CSS_SELECTOR_UNSUPPORTED/);assert.match(errors[1],/SVG_CSS_ANIMATION_NAME_UNSUPPORTED/);
}));
