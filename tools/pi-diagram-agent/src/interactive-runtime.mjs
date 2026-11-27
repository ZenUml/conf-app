export function installInteractiveSvg(svg,sharedSections=[],status=null){
  const slot=Symbol.for('pi-diagram-agent.interactive-svg');
  svg[slot]?.destroy?.();
  const ns='http://www.w3.org/2000/svg',nodes=new Map(),edges=new Map(),sections=new Map(sharedSections.map(s=>[s.id,s]));
  for(const node of svg.querySelectorAll('g[data-node]')){if(nodes.has(node.dataset.node))throw Error('Duplicate node binding');nodes.set(node.dataset.node,node)}
  const boundPaths=[...svg.querySelectorAll('path[data-source][data-target]')],reserved=new Set([...svg.querySelectorAll('path[data-edge]')].map(e=>e.dataset.edge));
  for(const [i,path] of boundPaths.entries()){
    let id=path.dataset.edge;
    if(!path.hasAttribute('data-edge')){id='__interaction-edge-'+i;while(reserved.has(id))id+='_';reserved.add(id)}
    if(!id||edges.has(id))throw Error('Duplicate edge binding');
    edges.set(id,{element:path,source:path.dataset.source,target:path.dataset.target});
  }
  for(const section of sections.values())if(section.members.some(id=>!edges.has(id)))throw Error('Unknown shared section member');
  const snapshots=new Map(),listeners=[],ownedClasses=['focus-on','is-active','interaction-inactive','has-active-descendant'];
  const remember=(el,names)=>{let entry=snapshots.get(el);if(!entry)snapshots.set(el,entry=new Map());for(const name of names)if(!entry.has(name))entry.set(name,el.getAttribute(name))};
  const restoreClasses=el=>{const entry=snapshots.get(el);if(!entry?.has('class'))return;const before=new Set((entry.get('class')||'').split(/\s+/));for(const cls of ownedClasses)el.classList.toggle(cls,before.has(cls));if(!el.getAttribute('class')&&entry.get('class')===null)el.removeAttribute('class')};
  const restoreRawClasses=el=>{
    const entry=snapshots.get(el);if(!entry?.has('class'))return;
    restoreClasses(el);
    const raw=entry.get('class'),before=new Set((raw||'').split(/\s+/).filter(c=>c&&!ownedClasses.includes(c))),after=new Set((el.getAttribute('class')||'').split(/\s+/).filter(c=>c&&!ownedClasses.includes(c)));
    const removed=[...before].some(c=>!after.has(c)),added=[...after].filter(c=>!before.has(c));
    if(!removed&&!added.length){if(raw===null)el.removeAttribute('class');else el.setAttribute('class',raw)}
    else if(!removed){const prefix=raw||'';el.setAttribute('class',prefix+(prefix&&!/\s$/.test(prefix)?' ':'')+added.join(' '))}
    // If external code removed an original token, preserve that removal and the
    // external additions instead of resurrecting the original class list.
  };
  const listen=(el,type,handler)=>{el.addEventListener(type,handler);listeners.push([el,type,handler])};
  const statusChildren=status?[...status.childNodes]:null;
  remember(svg,['class','data-focus-kind','data-focus-id','data-selection-kind','data-selection-id']);
  for(const node of nodes.values())remember(node,['class','tabindex','role','aria-label']);
  for(const [id,edge] of edges){remember(edge.element,['class','pointer-events','data-edge']);if(!edge.element.hasAttribute('data-edge'))edge.element.dataset.edge=id}
  const label=id=>nodes.get(id)?.querySelector('[data-role="label"]')?.textContent.trim()||nodes.get(id)?.textContent.trim().replace(/\s+/g,' ')||id;
  const element=name=>document.createElementNS(ns,name),hits=element('g'),overlays=element('g'),nodePaint=element('g'),nodeHits=element('g');
  hits.classList.add('interaction-hit-layer');overlays.classList.add('interaction-overlay-layer');nodePaint.classList.add('interaction-node-overlay-layer');nodeHits.classList.add('interaction-node-hit-layer');
  overlays.setAttribute('pointer-events','none');nodePaint.setAttribute('pointer-events','none');svg.append(hits,overlays,nodePaint,nodeHits);
  let hover=null,focus=null,selection=null,destroyed=false,forwarding=false;
  const same=(a,b)=>a&&b&&a.kind===b.kind&&a.id===b.id;
  const rootTransform=(source,clone)=>{const root=svg.getScreenCTM(),matrix=source.getScreenCTM();if(!root||!matrix)throw Error('SVG transform unavailable');const m=root.inverse().multiply(matrix);clone.setAttribute('transform',`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`)};
  const all=[...nodes.values(),...[...edges.values()].map(e=>e.element)];
  function paintNode(node){
    const copy=node.cloneNode(true),originals=[node,...node.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];
    for(let i=0;i<clones.length;i++){
      const el=clones[i],computed=getComputedStyle(originals[i]);
      // Retain renderer classes and geometry, while removing identity/interaction
      // attributes. Inline computed properties preserve HTML labels (foreignObject,
      // table, p, span, etc.) even outside their original ancestor CSS selectors.
      for(const attr of [...el.attributes])if(attr.name==='id'||attr.name.startsWith('data-')||/^on/i.test(attr.name)||['tabindex','role','aria-label'].includes(attr.name))el.removeAttribute(attr.name);
      for(const cls of ownedClasses)el.classList.remove(cls);
      for(const key of computed){if(!i&&['transform','transform-origin'].includes(key))continue;el.style.setProperty(key,computed.getPropertyValue(key))}
      el.style.setProperty('pointer-events','none','important');el.style.setProperty('animation','none');el.style.setProperty('transition','none');
      el.setAttribute('tabindex','-1');el.setAttribute('aria-hidden','true');
    }
    // The clone's renderer CSS may carry its own transform. Put the measured
    // root transform on a neutral wrapper and neutralize only the clone root.
    copy.removeAttribute('transform');copy.style.setProperty('transform','none','important');
    const wrapper=element('g');rootTransform(node,wrapper);wrapper.classList.add('active-node-overlay');wrapper.setAttribute('pointer-events','none');wrapper.setAttribute('aria-hidden','true');wrapper.append(copy);nodePaint.append(wrapper);
  }
  function paint(){
    if(destroyed)return;
    const current=selection||hover||focus;
    for(const el of snapshots.keys())restoreClasses(el);
    svg.classList.toggle('focus-on',!!current||new Set((snapshots.get(svg).get('class')||'').split(/\s+/)).has('focus-on'));
    svg.dataset.focusKind=current?.kind||'none';svg.dataset.focusId=current?.id||'';svg.dataset.selectionKind=selection?.kind||'none';svg.dataset.selectionId=selection?.id||'';
    overlays.replaceChildren();nodePaint.replaceChildren();
    if(!current){if(status)status.textContent='Hover or focus an item to trace connections. Click, Enter or Space locks selection; Escape clears it.';return}
    const activeEdges=new Set(),activeNodes=new Set();
    if(current.kind==='node'){activeNodes.add(current.id);for(const [id,edge] of edges)if(edge.source===current.id||edge.target===current.id)activeEdges.add(id)}
    else if(current.kind==='edge')activeEdges.add(current.id);
    else for(const id of sections.get(current.id)?.members||[])activeEdges.add(id);
    for(const id of activeEdges){const edge=edges.get(id);activeNodes.add(edge.source);activeNodes.add(edge.target)}
    for(const el of all)el.classList.add('interaction-inactive');
    const activate=el=>{if(!el)return;el.classList.remove('interaction-inactive');el.classList.add('is-active');for(let parent=el.parentElement;parent&&parent!==svg;parent=parent.parentElement){remember(parent,['class']);parent.classList.add('has-active-descendant');parent.classList.remove('interaction-inactive')}};
    for(const id of activeNodes){const node=nodes.get(id);activate(node);if(node)paintNode(node)}
    for(const id of activeEdges){
      const original=edges.get(id).element;activate(original);const copy=original.cloneNode(false),style=getComputedStyle(original);
      for(const attr of [...copy.attributes])if(attr.name==='id'||attr.name.startsWith('data-')||['class','style','tabindex','role','aria-label'].includes(attr.name))copy.removeAttribute(attr.name);
      rootTransform(original,copy);copy.classList.add('active-edge-overlay');
      for(const key of ['stroke','stroke-width','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','fill','vector-effect','marker-start','marker-mid','marker-end'])copy.style.setProperty(key,style.getPropertyValue(key));
      copy.setAttribute('pointer-events','none');copy.setAttribute('aria-hidden','true');overlays.append(copy);
    }
    const drawnNodes=[...activeNodes].filter(id=>nodes.has(id)),lock=selection?'Selected':'Tracing';
    if(status)status.textContent=current.kind==='node'?`${lock} node ${label(current.id)}: ${activeEdges.size} incident connectors; ${drawnNodes.filter(id=>id!==current.id).length} neighboring nodes.`:current.kind==='edge'?`${lock} connector ${label(edges.get(current.id).source)} → ${label(edges.get(current.id).target)}: 1 connector; ${drawnNodes.length} endpoint nodes.`:`${lock} shared section: ${activeEdges.size} connectors; ${new Set([...activeEdges].map(id=>edges.get(id).source).filter(id=>nodes.has(id))).size} source nodes; ${drawnNodes.length} endpoint nodes.`;
  }
  const reset=()=>{if(destroyed)return;selection=null;hover=null;focus=null;paint()};
  const handledClicks=new WeakSet();
  function bind(el,item,keyboard=true,forwardElement=null){
    if(keyboard){el.setAttribute('tabindex','0');el.setAttribute('role','button');el.setAttribute('aria-label',item.kind==='node'?`Trace node ${label(item.id)}`:item.kind==='edge'?`Trace connector ${item.id}`:`Trace shared section ${item.id}`)}else el.setAttribute('aria-hidden','true');
    listen(el,'pointerenter',()=>{hover=item;paint()});listen(el,'pointerleave',()=>{if(same(hover,item))hover=null;paint()});listen(el,'focus',()=>{focus=item;paint()});listen(el,'blur',()=>{if(same(focus,item))focus=null;paint()});
    const toggle=()=>{if(same(selection,item)){selection=null;hover=null;focus=null}else selection=item;paint()};
    listen(el,'click',event=>{
      if(forwarding)return;
      handledClicks.add(event);
      if(forwardElement){forwarding=true;try{forwardElement.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:event.clientX,clientY:event.clientY,button:event.button,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey,metaKey:event.metaKey}))}finally{forwarding=false}event.stopPropagation()}
      toggle();
    });
    listen(el,'keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();toggle()}});
  }
  const configure=hit=>{for(const name of ['id','class','style','marker-start','marker-mid','marker-end','data-edge','data-source','data-target'])hit.removeAttribute(name);hit.classList.add('interaction-hit');hit.setAttribute('fill','none');hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width','14');hit.setAttribute('stroke-dasharray','none');hit.setAttribute('vector-effect','non-scaling-stroke');hit.setAttribute('pointer-events','stroke')};
  for(const [id,edge] of edges){edge.element.setAttribute('pointer-events','none');const hit=edge.element.cloneNode(false);rootTransform(edge.element,hit);configure(hit);hit.classList.add('edge-hit');hit.dataset.hitEdge=id;bind(hit,{kind:'edge',id},true,edge.element);hits.append(hit)}
  for(const section of sections.values()){const hit=element('path');configure(hit);hit.setAttribute('d',`M${section.points[0].join(' ')} L${section.points[1].join(' ')}`);hit.classList.add('trunk-hit');hit.dataset.hitSection=section.id;bind(hit,{kind:'trunk',id:section.id});hits.append(hit)}
  for(const [id,node] of nodes){
    bind(node,{kind:'node',id});const box=node.getBBox(),hit=element('path');hit.setAttribute('d',`M${box.x} ${box.y} L${box.x+box.width} ${box.y} L${box.x+box.width} ${box.y+box.height} L${box.x} ${box.y+box.height} Z`);rootTransform(node,hit);hit.classList.add('node-hit');hit.setAttribute('fill','transparent');hit.setAttribute('stroke','none');hit.setAttribute('pointer-events','all');hit.dataset.hitNode=id;bind(hit,{kind:'node',id},false,node);nodeHits.append(hit);
  }
  listen(svg,'pointerleave',()=>{hover=null;paint()});listen(svg,'click',event=>{if(!forwarding&&!handledClicks.has(event))reset()});
  const parent=svg.parentElement;if(parent)listen(parent,'click',event=>{if(event.target===parent)reset()});
  listen(document,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();reset();if(svg.contains(document.activeElement))document.activeElement?.blur?.()}});
  const destroy=()=>{
    if(destroyed)return;destroyed=true;
    for(const [el,type,handler] of listeners)el.removeEventListener(type,handler);
    for(const layer of [hits,overlays,nodePaint,nodeHits])layer.remove();
    for(const [el,attrs] of snapshots){restoreRawClasses(el);for(const [name,value] of attrs)if(name!=='class'){if(value===null)el.removeAttribute(name);else el.setAttribute(name,value)}}
    if(status)status.replaceChildren(...statusChildren);
    if(svg[slot]===api)delete svg[slot];
  };
  const api={reset,destroy};svg[slot]=api;paint();return api;
}
export const INTERACTIVE_SVG_STYLE=`.focus-on .interaction-inactive{opacity:.18!important}.focus-on .is-active,.focus-on .has-active-descendant{opacity:1!important}.interaction-hit{cursor:pointer}.interaction-hit:focus-visible{outline:none;stroke:#4d90fe;stroke-opacity:.18}.is-active:focus-visible{outline:2px solid #4d90fe;outline-offset:2px}.active-edge-overlay{pointer-events:none}`;
