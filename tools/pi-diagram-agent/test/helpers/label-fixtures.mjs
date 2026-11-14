import assert from 'node:assert/strict';
// Synthetic fixtures for the edge-label tests (no customer content).

export const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
export const defs='<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs>';
export const node=(id,x,y,w,h)=>`<g data-node="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="black"/><text x="${x+w/2-4}" y="${y+h/2+4}">N</text></g>`;
export const edge=(s,t,d)=>`<path data-source="${s}" data-target="${t}" d="${d}" stroke="black" fill="none" marker-end="url(#arrow)"/>`;
export const doc=(...parts)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 700">${defs}${parts.join('')}</svg>`;
/** Edge label pill: opaque white background without border, centred text. rect/transform attributes can be overridden per test. */
export const label=({s,t,cx,cy,w=40,h=24,text='go',rect='fill="#ffffff"',transform='',tagged=true,withRect=true})=>
  `<g ${tagged?`data-edge-label-source="${s}" data-edge-label-target="${t}"`:'class="edge-label"'}${transform?` transform="${transform}"`:''}>${withRect?`<rect x="${cx-w/2}" y="${cy-h/2}" width="${w}" height="${h}" rx="12" ${rect}/>`:''}<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="15">${text}</text></g>`;
export const near=(a,b,tol=0.6)=>assert.ok(Math.abs(a-b)<=tol,`${a} is not within ${tol} of ${b}`);

// ---- horizontal fixture: A->B at y=330 (labelled "go"), C->D at y=530 ----
export const H_SRC='flowchart LR\n A[N] -->|go| B[N]\n C[N] --> D[N]\n';
export const hBase=()=>[node('A',60,300,100,60),node('B',450,300,100,60),node('C',60,500,100,60),node('D',450,500,100,60),edge('A','B','M160 330 L450 330'),edge('C','D','M160 530 L450 530')];

// ---- R3: label styling, measured from the drawn SVG ----

// ---- R4(b): a label box never covers a route other than its own ----

// ---- R2: rotated labels use the transformed footprint everywhere ----
// Vertical fixture: C->D is vertical at x=300, G->H vertical at x=365, E->F horizontal at y=125 (crosses both; a fixture, not a recommendation).
export const V_SRC='flowchart LR\n C[N] -->|a long label| D[N]\n G[N] --> H[N]\n E[N] --> F[N]\n';
export const vBase=()=>[node('C',250,20,100,60),node('D',250,400,100,60),node('G',360,20,100,60),node('H',360,400,100,60),node('E',20,95,100,60),node('F',480,95,100,60),
  edge('C','D','M300 80 L300 400'),edge('G','H','M365 80 L365 400'),edge('E','F','M120 125 L480 125')];
export const vLabel=(cy,rotated)=>label({s:'C',t:'D',cx:300,cy,w:140,text:'a long label',transform:rotated?`rotate(-90 300 ${cy})`:''});

// ---- spec renderer: label.vertical, rotated footprint, no border + background ----
export const baseSpec=()=>({
  canvas:{w:760,h:400,title:'Synthetic flow',desc:'Four synthetic nodes.'},
  palette:{step:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Process step'},data:{fill:'#e9f7ef',stroke:'#1e7a46',text:'#14432a',meaning:'Data store'}},
  nodes:[{id:'A',shape:'rect',rect:[20,128,120,64],text:'Start',role:'step'},{id:'B',shape:'decision',centre:[330,160],tier:'S',text:'Ready',role:'step'},
    {id:'C',shape:'store',centre:[600,160],tier:'S',text:'Store',role:'data'},{id:'D',shape:'capsule',rect:[540,280,120,64],text:'Skip',role:'step'}],
  edges:[{source:'A',target:'B',points:[[140,160],[226.5,160]]},{source:'B',target:'C',points:[[433.5,160],[540,160]],label:{text:'Yes',x:487,y:142}},
    {source:'B',target:'D',dashed:true,points:[[330,209.83],[330,312],[540,312]]}]});
export const withLabel=(label)=>{const s=baseSpec();s.edges[1].label=label;return s};
export const rulesOf=(r,rule)=>r.findings.filter(f=>f.rule===rule);


export const SPEC_SOURCE='flowchart LR\n  A[Start] --> B{Ready}\n  B -- "Yes" --> C[(Store)]\n  B -.-> D(Skip)\n';
