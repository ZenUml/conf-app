import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {renderSpec,SpecError,formatRenderReport,LIMITS} from './spec-render.mjs';
import {parseMermaid} from './parser.mjs';
import {BOX_RULES_PROFILE} from './rules-profile.mjs';
const SIZE_NAMES=['compact','standard','wide','extra'];
const SIZE_SCHEMA=BOX_RULES_PROFILE.sizingContract.tiers.map((t,i)=>`${SIZE_NAMES[i]} ${t.join('x')}`).join(', ');

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
    try{result=renderSpec(fs.readFileSync(layoutPath,'utf8'),{model,presentation:job.manifest?.presentation??job.presentation??{mode:'fit',width:1200,height:710}})}
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
  return `${lead} candidate.svg exactly as specified and returns text findings. You decide every coordinate, port, route, label and legend placement. The renderer never moves, reroutes or repairs anything; you fix its findings. Then call diagram_inspect as usual.
Schema (SVG units; unknown keys are errors):
- canvas: {w, h, title, desc}
- presentation?: {mode: fit|native, width?, height?, scale?}; default fit 1200x710. Native uses scale (default 1); fit uses min(width/canvas.w,height/canvas.h); labels >=12 effective px.
- palette: {role: {fill, stroke, text, meaning}} as #rrggbb; meaning is required. Edges take the colour of their target's role unless the edge sets role.
- groups: [{id, label, rect:[x,y,w,h], role?, parent? (explicit nesting)}]; sibling groups never overlap.
- nodes: [{id, group?, sizeFamily?, sizeTier?: compact|standard|wide|extra, sizeExtension?: {width,height} whole nonnegative grid steps, layer?, shape (one of rect|capsule|decision|cylinder|subroutine|circle|doublecircle|hexagon|parallelogram|parallelogram_alt|trapezoid|trapezoid_alt|asymmetric), rect:[x,y,w,h] or centre:[cx,cy]+tier S|M|L|XL, text: string (wrapped in the label box) or [lines], role, align?: center|left, font?: number: omit it and the renderer picks the largest whole font (14 to 28) that fits the label box, comparable nodes uniform}]. Preserve source shape; [[..]] subroutine, [(..)] cylinder. Decision allows a long-text hexagon. Aliases: store=cylinder, queue=subroutine, stadium=capsule. Label boxes: rect/capsule inset 8; subroutine 24 sideways; cylinder 32 vertically; other shapes add fixed padding/points. S/M/L/XL use the size profile. Endpoints sit on the outline with legs perpendicular to the face (circle: cardinal points only); ports on parallelogram, trapezoid and asymmetric are NOT-CHECKABLE for the auditor.
- edges: [{id?, source, target, points: [[x,y],...] explicit orthogonal corners including both endpoints on the node outlines, dashed?, role?, label?: {text, x, y, vertical?: boolean} with x,y the centre of the label pill, trunk?: string}]. source and target are node ids or group ids; a group end sits on the group rectangle, perpendicular to its side. Every source relation, node-to-group included, must be drawn; never redirect one to a member. Edge labels: a label of fewer than 4 words should float on its own route, centred on a straight segment; vertical: true draws it rotated -90 degrees around the centre (bottom to top); checks use its rotated box. A label has no border and an opaque canvas background; never hide another route. If it cannot sit on/beside its route, widen the gap or spread ports. At or above 20 source relations (PI_DIAGRAM_DENSE_RELATIONS), crossings are minor: minimise with port order and lanes, do not chase zero. trunk explicitly declares semantically related incoming connectors at one target (equal targets alone are insufficient). Keep each full route and compatible style; merge early where useful without premerge crossings, then share one continuous downstream suffix, possibly with bends, and one visible arrowhead. Never split and rejoin; only the suffix is exempt from parallel clearance. Compare routes as a whole family preserving the suffix, never independent shortcuts. Never overlap outgoing starts or first shafts. Bends get r=5 fillets and colour-matched arrows.
- legend: {x, y, direction?: down|right, entries: [{kind: node|line, role, label, shape? (any node shape above, drawn as a small glyph), dashed?}]}
Size profile: ${SIZE_SCHEMA} label boxes, grow on the ${BOX_RULES_PROFILE.gridStep}-unit grid for long text. Use one tier for a semantic family/shape/layer; emit data-size-family, data-size-tier, JSON data-size-extension and data-layer; never auto resize. Group headings are not route obstacles; nodes, node text and edge labels remain protected. Positive-length riding on any group border is blocking, including endpoint ancestors; transverse crossings are allowed. Count visible crossings once per location, not duplicate logical paths, excluding valid merge joins. Prefer a layered body when meaningful layers exist; not every edge runs down.
Write layout.json once, one node, edge or group per line. For each revision use the edit tool on layout.json to change only what moves; never rewrite or re-send the whole layout.\nThe findings cover orthogonality, endpoints and ports, rule 13 final leg (>= fillet + 10 + 8), fillet room, parallel spans (>= 10), crossings, node/group intrusion, group-border riding and sibling overlap, text fit, group membership, label clearance, contrast, canvas bounds and a node/edge census against the source.`;
}
