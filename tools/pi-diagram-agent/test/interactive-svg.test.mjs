import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installInteractiveSvg,INTERACTIVE_SVG_STYLE} from '../src/interactive-runtime.mjs';
import {createInteractiveHtml} from '../src/interactive-svg.mjs';
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#345"/></marker><style>.owner path{stroke-dasharray:5 3}</style></defs><g class="owner" transform="translate(10 0)"><path data-edge="a" data-source="A" data-target="T" d="M10 80 L210 80" stroke="#345" stroke-width="2" fill="none" marker-end="url(#arrow)"/></g><path data-edge="b" data-source="B" data-target="T" d="M20 120 L140 120 L140 80 L220 80" stroke="#345" fill="none" marker-end="url(#arrow)"/><path data-edge="c" data-source="C" data-target="T" d="M20 160 L220 160" stroke="#345" fill="none" marker-end="url(#arrow)"/><g opacity=".3"><g data-node="A"><rect x="0" y="70" width="20" height="20" fill="white" stroke="black"/><text x="4" y="83">A</text></g></g><g data-node="B"><rect x="0" y="110" width="20" height="20" fill="white" stroke="black"/><text x="4" y="123">B</text></g><g data-node="C"><rect x="0" y="150" width="20" height="20" fill="white" stroke="black"/><text x="4" y="163">C</text></g><g data-node="T"><rect x="220" y="70" width="20" height="110" fill="white" stroke="black"/><text x="224" y="90">T</text></g></svg>`;
const sections=[{id:'s1',family:'f',members:['a','b'],points:[[140,80],[220,80]]}];
test('deterministic escaped standalone output, static SVG and invalid sections',()=>{
 const a=createInteractiveHtml(svg,{title:'<unsafe & title>',sharedSections:sections});assert.equal(a,createInteractiveHtml(svg,{title:'<unsafe & title>',sharedSections:sections}));assert.ok(a.includes('&lt;unsafe &amp; title&gt;'));assert.ok(a.includes('id="view-fit"'));assert.ok(a.includes('id="view-native"'));
 assert.doesNotThrow(()=>createInteractiveHtml('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'));
 for(const s of [{...sections[0],members:['a','missing']},{...sections[0],members:['a','a']},{...sections[0],points:[[0,0],[10,10]]},{...sections[0],points:[[0,0],[0,0]]}])assert.throws(()=>createInteractiveHtml(svg,{sharedSections:[s]}));
});
test('unsafe markup, external stylesheet references and malformed SVG fail closed',()=>{
 for(const bad of ['<script>alert(1)</script>','<foreignObject/>','<image href="https://example.com/a"/>','<rect onclick="run()"/>','<style>@import "https://example.com/a";</style>','<rect fill="url(https://example.com/a)"/>','<animate attributeName="x"/>'])assert.throws(()=>createInteractiveHtml(svg.replace('</svg>',bad+'</svg>')));
 assert.throws(()=>createInteractiveHtml('<svg><g></svg>'));assert.throws(()=>createInteractiveHtml('<svg xmlns="http://www.w3.org/2000/svg"><rect fill=red/></svg>'));assert.throws(()=>createInteractiveHtml('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red" fill="blue"/></svg>'));assert.throws(()=>createInteractiveHtml(new Uint8Array([0xff])));
});
const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
async function browserRun(fn,{touch=false,input=svg}={}){const {chromium}=createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE?{executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}:{})});try{const page=await browser.newPage({viewport:touch?{width:390,height:720}:{width:800,height:600},hasTouch:touch,isMobile:touch});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent(createInteractiveHtml(input,{sharedSections:sections}));await fn(page);assert.deepEqual(errors,[])}finally{await browser.close()}}
const point=async(page,x,y)=>page.evaluate(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(document.querySelector('#diagram svg').getScreenCTM());return {x:p.x,y:p.y}},[x,y]);
const move=async(page,x,y,click=false)=>{const p=await point(page,x,y);if(click)await page.mouse.click(p.x,p.y);else await page.mouse.move(p.x,p.y)};
const state=page=>page.evaluate(()=>{const s=document.querySelector('#diagram svg');return {kind:s.dataset.focusKind,id:s.dataset.focusId,selection:s.dataset.selectionKind,edges:[...s.querySelectorAll('path[data-edge].is-active')].map(e=>e.dataset.edge).sort(),nodes:[...s.querySelectorAll('g[data-node].is-active')].map(n=>n.dataset.node).sort(),status:document.querySelector('#hover-status').textContent}});
test('actual pointer hover, selection persistence/toggle/background, exact section members and node priority',{skip:!enabled},async()=>browserRun(async page=>{
 await move(page,50,80);assert.deepEqual((await state(page)).edges,['a']);assert.deepEqual((await state(page)).nodes,['A','T']);
 await move(page,50,80,true);await page.mouse.move(0,0);assert.equal((await state(page)).selection,'edge');assert.deepEqual((await state(page)).edges,['a']);
 await move(page,50,80,true);assert.equal((await state(page)).kind,'none');
 await move(page,170,80);assert.deepEqual((await state(page)).edges,['a','b']);assert.equal((await state(page)).kind,'trunk');assert.match((await state(page)).status,/2 connectors; 2 source nodes; 3 endpoint nodes/);
 await move(page,170,80,true);await page.mouse.move(0,0);assert.deepEqual((await state(page)).edges,['a','b']);
 await move(page,280,190,true);assert.equal((await state(page)).kind,'none');
 await move(page,10,80);assert.equal((await state(page)).kind,'node');assert.deepEqual((await state(page)).edges,['a']);
 assert.equal(await page.locator('g[data-node="A"]').evaluate(n=>getComputedStyle(n.parentElement).opacity),'1');
}));
test('keyboard selection, Escape, faithful transformed overlays and view controls',{skip:!enabled},async()=>browserRun(async page=>{
 await page.locator('g[data-node="T"]').focus();await page.keyboard.press('Enter');await page.mouse.move(0,0);assert.equal((await state(page)).selection,'node');assert.deepEqual((await state(page)).edges,['a','b','c']);
 await page.keyboard.press('Enter');assert.equal((await state(page)).kind,'none');await page.keyboard.press('Space');assert.equal((await state(page)).selection,'node');await page.keyboard.press('Escape');assert.equal((await state(page)).kind,'none');
 await move(page,50,80);const overlay=await page.locator('.active-edge-overlay').evaluate(e=>({id:e.id,edge:e.getAttribute('data-edge'),stroke:getComputedStyle(e).stroke,dash:getComputedStyle(e).strokeDasharray,marker:getComputedStyle(e).markerEnd,matrix:e.getCTM().e}));assert.equal(overlay.id,'');assert.equal(overlay.edge,null);assert.equal(overlay.stroke,'rgb(51, 68, 85)');assert.equal(overlay.dash,'5px, 3px');assert.match(overlay.marker,/#arrow/);assert.equal(overlay.matrix,10);
 await page.locator('#view-fit').click();assert.equal(await page.locator('#diagram svg').evaluate(e=>e.style.width),'100%');await page.locator('#view-native').click();assert.equal(await page.locator('#diagram svg').evaluate(e=>e.style.width),'300px');
 await move(page,50,80,true);await page.locator('#view-fit').click();await page.keyboard.press('Escape');assert.equal((await state(page)).kind,'none');
}));

test('filled transformed container cannot conceal root hits/overlays; nodes still win',{skip:!enabled},async()=>{
 const nested=svg.replace('</defs>','</defs><g transform="translate(5 5)"><rect width="260" height="190" fill="white"/>').replace('</svg>','</g></svg>');
 await browserRun(async page=>{
   await move(page,55,85);assert.deepEqual((await state(page)).edges,['a']);await move(page,55,85,true);assert.equal((await state(page)).selection,'edge');
   const layers=await page.evaluate(()=>{const root=document.querySelector('#diagram svg'),children=[...root.children];return {group:children.findIndex(n=>n.getAttribute('transform')==='translate(5 5)'),overlay:children.findIndex(n=>n.classList.contains('interaction-overlay-layer')),nodes:children.findIndex(n=>n.classList.contains('interaction-node-overlay-layer'))}});assert.ok(layers.overlay>layers.group);assert.ok(layers.nodes>layers.overlay);
   await move(page,55,85,true);await move(page,15,85);assert.equal((await state(page)).kind,'node');assert.deepEqual((await state(page)).edges,['a']);
 },{input:nested});
});
test('phone tap selects exact section members and second tap clears',{skip:!enabled},async()=>browserRun(async page=>{
 const p=await point(page,170,80);await page.touchscreen.tap(p.x,p.y);assert.equal((await state(page)).selection,'trunk');assert.deepEqual((await state(page)).edges,['a','b']);await page.touchscreen.tap(p.x,p.y);assert.equal((await state(page)).kind,'none');
},{touch:true}));
test('CSP blocks network even for escaped CSS URL; namespace injection rejected',{skip:!enabled},async()=>{
 assert.throws(()=>createInteractiveHtml('<svg xmlns="http://www.w3.org/1999/xhtml"><rect/></svg>'));
 assert.throws(()=>createInteractiveHtml(svg.replace('</svg>','</svg><body><script>run()</script></body>')));
 await browserRun(async page=>{let requests=0;await page.route('**/*',route=>{requests++;route.abort()});await page.evaluate(()=>{const style=document.createElement('style');style.textContent='#diagram{background-image:url(https://example.com/probe)}';document.head.append(style)});await page.waitForTimeout(50);assert.equal(requests,0);assert.ok(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'));});
});

test('legacy endpoint-bound parallel paths receive stable distinct wrapper-only IDs',{skip:!enabled},async()=>{
 const legacy=svg.replace('data-source="B"','data-source="A"').replace('data-edge="a" ','').replace('data-edge="b" ','').replace('data-edge="c"','data-edge="__interaction-edge-0"');
 const html=createInteractiveHtml(legacy,{sharedSections:[{id:'legacy-section',family:'f',members:['__interaction-edge-0_','__interaction-edge-1'],points:[[140,80],[220,80]]}]});
 assert.ok(!legacy.includes('data-edge="a"'));assert.equal(html,createInteractiveHtml(legacy,{sharedSections:[{id:'legacy-section',family:'f',members:['__interaction-edge-0_','__interaction-edge-1'],points:[[140,80],[220,80]]}]}));
 const {chromium}=createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE?{executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}:{})});try{const page=await browser.newPage();await page.setContent(html);const ids=await page.locator('path[data-edge]').evaluateAll(paths=>paths.map(p=>p.dataset.edge));assert.deepEqual(ids,['__interaction-edge-0_','__interaction-edge-1','__interaction-edge-0']);await move(page,50,80);assert.deepEqual((await state(page)).edges,['__interaction-edge-0_']);await move(page,50,120);assert.deepEqual((await state(page)).edges,['__interaction-edge-1']);assert.ok(!legacy.includes('__interaction-edge-0_'));}finally{await browser.close()}
 const parallel=legacy.replace('data-source="B"','data-source="A"');assert.doesNotThrow(()=>createInteractiveHtml(parallel));
});

test('browser runtime reinstall/destroy restores attributes, status and original callbacks',{skip:!enabled},async()=>{
 const {chromium}=createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE?{executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}:{})});try{
 const page=await browser.newPage();await page.setContent(`<style>${INTERACTIVE_SVG_STYLE}</style><div id="diagram">${svg.replace('data-edge="a" ','').replace('data-source="A"','class="  edge-pattern-solid edge-pattern-solid   flowchart-link \t" data-source="A"').replace('g data-node="A"','g data-node="A" tabindex="7" role="link" aria-label="Original"')}</div><p id="hover-status"><strong>Original status</strong></p>`);
 await page.evaluate(()=>{const s=document.querySelector('svg'),a=s.querySelector('[data-node="A"]');window.before=s.outerHTML;window.calls=0;window.delegated=0;a.addEventListener('click',()=>window.calls++);s.addEventListener('click',e=>{if(e.target.closest?.('[data-node]')===a)window.delegated++})});
 await page.evaluate(`window.api=(${installInteractiveSvg.toString()})(document.querySelector('svg'),[],document.getElementById('hover-status'))`);
 await move(page,10,80,true);assert.equal((await state(page)).selection,'node');assert.deepEqual(await page.evaluate(()=>[window.calls,window.delegated]),[1,1]);
 await page.evaluate(`window.api=(${installInteractiveSvg.toString()})(document.querySelector('svg'),[],document.getElementById('hover-status'))`);assert.equal(await page.locator('.interaction-hit-layer').count(),1);
 await move(page,10,80,true);assert.equal((await state(page)).selection,'node');assert.deepEqual(await page.evaluate(()=>[window.calls,window.delegated]),[2,2]);
 await page.evaluate(()=>window.api.reset());assert.equal((await state(page)).kind,'none');await page.evaluate(()=>{window.api.destroy();window.api.destroy()});assert.equal(await page.locator('.interaction-hit-layer').count(),0);
 assert.equal(await page.locator('svg').evaluate(s=>s.outerHTML),await page.evaluate(()=>window.before));assert.equal(await page.locator('#hover-status').innerHTML(),'<strong>Original status</strong>');
 await page.locator('[data-node="A"]').click();assert.deepEqual(await page.evaluate(()=>[window.calls,window.delegated]),[3,3]);assert.equal(await page.locator('svg').getAttribute('data-selection-kind'),null);
 await page.evaluate(`window.api=(${installInteractiveSvg.toString()})(document.querySelector('svg'),[],document.getElementById('hover-status'))`);await page.evaluate(()=>{document.querySelector('path[data-source="A"]').classList.add('external-added');window.api.destroy()});const restored=await page.locator('path[data-source="A"]').getAttribute('class');assert.ok(restored.includes('edge-pattern-solid edge-pattern-solid'));assert.ok(restored.includes('external-added'));
 }finally{await browser.close()}
});
test('foreignObject HTML table/div/p/span label paint preserves layout and color',{skip:!enabled},async()=>{
 const {chromium}=createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE?{executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}:{})});try{
 const page=await browser.newPage();const direct=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><g class="scope" transform="translate(30 20)"><g class="node" data-node="A" transform="translate(20 10)"><rect width="130" height="80" fill="white" stroke="black"/><g class="label"><foreignObject width="130" height="80"><div xmlns="http://www.w3.org/1999/xhtml" class="html-label"><table><tbody><tr><td><p><span class="ink">Alpha<br/>Beta</span></p></td></tr></tbody></table></div></foreignObject></g></g><g data-node="B" transform="translate(260 10)"><rect width="50" height="80" fill="white"/></g><path data-edge="e" data-source="A" data-target="B" d="M150 50 L260 50" fill="none" stroke="black"/></g></svg>`;
 await page.setContent(`<style>${INTERACTIVE_SVG_STYLE}.scope .label .html-label{display:table-cell;white-space:nowrap;line-height:1.5;text-align:center;max-width:200px;width:130px;color:rgb(22,44,66);font:16px Arial}.scope .label table{border-spacing:0;width:130px}.scope .label td{padding:3px}.scope .label p{margin:0}.scope .label .ink{color:rgb(80,30,100)}</style><div id="diagram">${direct}</div><p id="hover-status"></p>`);
 await page.evaluate(`window.api=(${installInteractiveSvg.toString()})(document.querySelector('svg'),[],document.getElementById('hover-status'))`);await move(page,80,60,true);
 const result=await page.evaluate(()=>{const original=document.querySelector('g[data-node="A"]'),clone=document.querySelector('.active-node-overlay .node'),measure=el=>{const r=el.getBoundingClientRect(),c=getComputedStyle(el);return {x:r.x,y:r.y,w:r.width,h:r.height,display:c.display,whiteSpace:c.whiteSpace,lineHeight:c.lineHeight,textAlign:c.textAlign,color:c.color,fontSize:c.fontSize,maxWidth:c.maxWidth}};return ['foreignObject','div','table','td','p','span'].map(selector=>({selector,a:measure(original.querySelector(selector)),b:measure(clone.querySelector(selector))}))});
 for(const r of result){for(const k of ['x','y','w','h'])assert.ok(Math.abs(r.a[k]-r.b[k])<.1,`${r.selector} ${k}: ${r.a[k]} != ${r.b[k]}`);for(const k of ['display','whiteSpace','lineHeight','textAlign','color','fontSize','maxWidth'])assert.equal(r.a[k],r.b[k],`${r.selector} ${k}`)}
 assert.throws(()=>createInteractiveHtml(direct));
 }finally{await browser.close()}
});

test('edge hit clicks preserve direct/delegated edge callbacks and toggle once',{skip:!enabled},async()=>{
 const {chromium}=createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE?{executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}:{})});try{
 const page=await browser.newPage();await page.setContent(`<style>${INTERACTIVE_SVG_STYLE}</style><div id="diagram">${svg}</div><p id="hover-status"></p>`);await page.evaluate(()=>{const s=document.querySelector('svg'),edge=s.querySelector('[data-edge="a"]');window.edgeDirect=0;window.edgeDelegated=0;edge.addEventListener('click',()=>window.edgeDirect++);s.addEventListener('click',e=>{if(e.target===edge)window.edgeDelegated++})});
 await page.evaluate(`window.api=(${installInteractiveSvg.toString()})(document.querySelector('svg'),[],document.getElementById('hover-status'))`);
 await move(page,54,80,true);assert.equal((await state(page)).selection,'edge');assert.deepEqual(await page.evaluate(()=>[window.edgeDirect,window.edgeDelegated]),[1,1]);await move(page,54,80,true);assert.equal((await state(page)).kind,'none');assert.deepEqual(await page.evaluate(()=>[window.edgeDirect,window.edgeDelegated]),[2,2]);
 await page.evaluate(()=>window.api.destroy());await move(page,54,80,true);assert.deepEqual(await page.evaluate(()=>[window.edgeDirect,window.edgeDelegated]),[3,3]);
 }finally{await browser.close()}
});
