import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {renderSpec,SpecError,formatRenderReport,LIMITS} from './spec-render.mjs';
import {parseMermaid} from './parser.mjs';

export const SPEC_TOOL_DESCRIPTION='Render the layout.json you wrote in your run directory into candidate.svg and return text findings (rule measurements). It draws exactly your coordinates and never moves, reroutes or repairs anything; only malformed JSON or schema errors fail. Fast, no images: call diagram_inspect for the visual evidence.';
const MAX_RENDERS=80;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Per-job renderer behind the diagram_render_spec tool. Always resolves to a text result; schema errors are reported in the text and leave candidate.svg untouched. */
export function createSpecRenderer(job){
  let renders=0;
  const layoutPath=path.join(job.runDir,'layout.json');
  let model=null;
  try{model=parseMermaid(Buffer.from(job.sourceBytes).toString('utf8'))}catch{model=null}
  const text=t=>({content:[{type:'text',text:t}],details:{}});
  return async()=>{
    if(++renders>MAX_RENDERS)throw Error('SPEC_RENDER_LIMIT');
    const item=fs.lstatSync(layoutPath,{throwIfNoEntry:false});
    if(!item?.isFile()||item.isSymbolicLink())return text(`SCHEMA_ERROR: layout.json not found at ${layoutPath}. Write it there (a regular file) and call this tool again.`);
    if(item.size>LIMITS.bytes)return text(`SCHEMA_ERROR: layout.json is ${item.size} bytes; the limit is ${LIMITS.bytes}.`);
    let result;
    try{result=renderSpec(fs.readFileSync(layoutPath,'utf8'),{model})}
    catch(error){
      if(error instanceof SpecError)return {content:[{type:'text',text:`SCHEMA_ERROR: layout.json was not rendered and candidate.svg is unchanged.\n${error.errors.map(e=>`- ${e.path}: ${e.message}`).join('\n')}`}],details:{status:'SCHEMA_ERROR',errors:error.errors}};
      throw error;
    }
    const bytes=Buffer.from(result.svg);
    if(bytes.length>2_000_000)return text('SCHEMA_ERROR: the rendered SVG exceeds 2,000,000 bytes; simplify the layout.');
    const temp=path.join(job.runDir,`.candidate.${randomUUID()}.tmp`);
    try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});fs.renameSync(temp,job.outputPath)}finally{fs.rmSync(temp,{force:true})}
    const svgHash=hash(bytes);
    return {content:[{type:'text',text:formatRenderReport(result,{svgHash})}],details:{status:'RENDERED',svgHash,findings:result.findings.length,blocking:result.findings.filter(f=>f.severity==='blocking').length}};
  };
}

/** PI_DIAGRAM_SPEC_MODE: '1' offers layout.json next to make.py ('offered'); 'required' makes layout.json the only authoring path; anything else is 'off'. */
export const specModeFromEnv=(env=process.env)=>env.PI_DIAGRAM_SPEC_MODE==='required'?'required':env.PI_DIAGRAM_SPEC_MODE==='1'?'offered':'off';

/** Short prompt paragraph for spec mode (PI_DIAGRAM_SPEC_MODE=1 offers it, =required makes it the only path). */
export function specModeParagraph({runDir,jobId,required=false}){
  const layoutPath=path.join(runDir,'layout.json');
  const lead=required
    ?`Layout spec mode (required). This overrides the earlier instruction to write a diagram-specific script or SVG: you author ${layoutPath} (JSON) and our renderer draws candidate.svg from it (diagram_render_spec with job ID ${jobId} renders it on demand; diagram_build_check renders it too); it draws`
    :`Layout spec mode. Instead of writing a generator script you may write ${layoutPath} (JSON) and call diagram_render_spec with job ID ${jobId}; it draws`;
  return `${lead} candidate.svg exactly as specified and returns text findings. You still decide every coordinate: node positions, ports, every route point, label and legend placement. The renderer never moves, reroutes or repairs anything and does not pick a layout; findings are measurements against the rules, and you choose whether and how to fix them. Then call diagram_inspect as usual.
Schema (all numbers are SVG units; unknown keys are errors):
- canvas: {w, h, title, desc}
- palette: {role: {fill, stroke, text, meaning}} as #rrggbb; meaning is required. Edges take the colour of their target's role unless the edge sets role.
- groups: [{id, label, rect:[x,y,w,h], role?}]
- nodes: [{id, group?, shape (one of rect|capsule|decision|cylinder|subroutine|circle|doublecircle|hexagon|parallelogram|parallelogram_alt|trapezoid|trapezoid_alt|asymmetric), rect:[x,y,w,h] or centre:[cx,cy]+tier S|M|L|XL, text: string (wrapped in the label box) or [lines], role, align?: center|left, font?: number: omit it and the renderer picks the largest whole font (14 to 28) that fits the label box, comparable nodes uniform}]. Source to shape: [..] rect, (..) and ([..]) capsule, {..} decision, [(..)] cylinder, [[..]] subroutine (a rect with an inset bar near each side, not a cylinder), ((..)) circle, (((..))) doublecircle, {{..}} hexagon (points left and right; a decision hexagon points up and down), [/../] parallelogram, [\\..\\] parallelogram_alt, [/..\\] trapezoid, [\\../] trapezoid_alt, >..] asymmetric (flag). rect, capsule, decision, cylinder and subroutine must keep their shape or the code reports shape-change; the others have no rule notation. Aliases: store, queue, stadium. Label box inside the outline: rect/capsule inset 8; subroutine inset 24 left and right; cylinder inset 32 top and bottom; circle diameter = tier diagonal + 24 (doublecircle + 36); hexagon, parallelogram, trapezoid, asymmetric add a slant per side of h/4 (hexagon, asymmetric) or h/3, h = tier height + 24; tiers S 96x40, M 200x80, L 320x120, XL 480x160. Endpoints sit on the outline with legs perpendicular to the face (circle: cardinal points only); ports on parallelogram, trapezoid and asymmetric are NOT-CHECKABLE for the auditor. A decision's visible outline tip is pulled in from the nominal vertex (about 4.5 left/right, 2.2 top/bottom on an S diamond); findings give the exact point.
- edges: [{id?, source, target, points: [[x,y],...] explicit orthogonal corners including both endpoints on the node outlines, dashed?, role?, label?: {text, x, y, vertical?: boolean} with x,y the centre of the label pill, trunk?: string}]. Edge labels: a label of fewer than 4 words should float on its own route, centred on a straight segment; vertical: true draws the label rotated -90 degrees around the centre (reading bottom to top) and every clearance check then uses the rotated box, so use it on a vertical or mostly vertical route. A label has no border and an opaque background (the renderer draws the canvas colour with stroke none); its background must never hide another route, so if the label cannot sit on or beside its own route without that, change the layout (widen the gap, spread the ports) instead of moving the label away. At or above 20 source relations (PI_DIAGRAM_DENSE_RELATIONS) a crossing is reported as minor: minimise crossings with port order and lanes, do not chase zero. trunk declares a shared final trunk (rule 10): give every connector that converges on the same target from the same direction the same trunk id; each keeps its own full points route and the coincident final leg is exempt from parallel clearance only when ids and target match and the overlap ends at the target (one arrowhead is drawn where the heads coincide). Bends get uniform r=5 fillets and a per-colour arrowhead automatically.
- legend: {x, y, direction?: down|right, entries: [{kind: node|line, role, label, shape? (any node shape above, drawn as a small glyph), dashed?}]}
The findings cover orthogonality, endpoints and ports, rule 13 final leg (>= fillet + 10 + 8), fillet room, parallel spans (>= 10), crossings, node/group/heading intrusion, text fit, group membership, label clearance, contrast, canvas bounds and a node/edge census against the source.`;
}
