// Deterministic synthetic flowchart SVG + matching Mermaid source for audit performance and equivalence tests.
// `mix` picks outline kinds; `labelDx` lists label x offsets (relative to the gap start) so labels can clear, touch or cross outlines.
const outline=(kind,x,y,w,h,sw)=>{
  const s=`fill="#fff" stroke="#333" stroke-width="${sw}"`;
  if(kind==='round')return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ${s}/>`;
  if(kind==='ellipse')return `<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" ${s}/>`;
  if(kind==='diamond')return `<polygon points="${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}" ${s}/>`;
  if(kind==='path')return `<path d="M${x+8} ${y} H${x+w-8} Q${x+w} ${y} ${x+w} ${y+8} V${y+h-8} Q${x+w} ${y+h} ${x+w-8} ${y+h} H${x+8} Q${x} ${y+h} ${x} ${y+h-8} V${y+8} Q${x} ${y} ${x+8} ${y} Z" ${s}/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${s}/>`;
};
export function syntheticDiagram({cols=8,rows=5,kinds=['round'],labelDx=[18],labelY=[0],sw=1.5,rotate=false}={}){
  const w=120,h=50,gx=160,gy=100,id=(r,c)=>`N${r*cols+c}`;
  let src='flowchart LR\n',nodes='',edges='',labels='';
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const n=r*cols+c,x=20+c*gx,y=20+r*gy,kind=kinds[n%kinds.length];
    src+=`  ${id(r,c)}[Node ${n}]\n`;
    nodes+=`<g data-node="${id(r,c)}">${outline(kind,x,y,w,h,sw)}<text x="${x+30}" y="${y+30}">Node ${n}</text></g>`;
    if(c+1<cols){
      const k=r*cols+c,dx=labelDx[k%labelDx.length],dy=labelY[k%labelY.length],lx=x+w+dx,ly=y+h/2-9+dy;
      src+=`  ${id(r,c)} -->|e${k}| ${id(r,c+1)}\n`;
      edges+=`<path data-source="${id(r,c)}" data-target="${id(r,c+1)}" d="M${x+w} ${y+h/2} L${x+gx} ${y+h/2}" fill="none" stroke="#000"/>`;
      labels+=`<g data-edge-label-source="${id(r,c)}" data-edge-label-target="${id(r,c+1)}"><rect x="${lx}" y="${ly}" width="26" height="18" fill="#fff"/><text x="${lx+3}" y="${ly+13}">e${k}</text></g>`;
    }
  }
  const body=`${edges}${nodes}${labels}`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols*gx+40} ${rows*gy+40}">${rotate?`<g transform="rotate(7 300 200)">${body}</g>`:body}</svg>`;
  return {source:src,svg};
}
