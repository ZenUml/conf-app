// The build step of diagram_build_check: (1) run the author's generator at its fixed entry point, so the author's normal loop is
// edit -> diagram_build_check -> submit, with no separate "run the script" turn. The generator runs through Pi's ctx.executeTool('bash'), which
// passes the same tool_call / tool_result handlers as a model-issued call (Pi 1.0.0, docs/extensions.md "A tool can run other tools").
//   make.py present            -> `cd <runDir> && python3 make.py` (timeout 60 s)
//   no make.py, layout.json, spec mode on -> render the spec (diagram_render_spec's renderer)
//   neither                    -> candidate.svg exactly as written
// The generator must write only candidate.svg in the run directory. Failures come back as a short actionable message ({ok:false}); only a
// genuine tool failure throws.
import fs from 'node:fs';
import path from 'node:path';

export const GENERATOR_ENTRY='make.py';
export const GENERATOR_TIMEOUT_S=60;
export const MAX_GENERATOR_OUTPUT_CHARS=1500;
const MAX_GENERATOR_BYTES=1_000_000;
// Files the orchestrator and the inspector themselves create in the run directory while a generator may be running (inspect calls can run in parallel).
const TOOL_OWNED=/^(?:candidate\.[0-9a-f]{12}\.|orch\.|source\.|accepted-reference|\.)/;

const shellQuote=s=>`'${String(s).replace(/'/g,`'\\''`)}'`;
const snapshot=dir=>{
  const out=new Map();
  for(const name of fs.readdirSync(dir)){
    if(TOOL_OWNED.test(name))continue;
    const st=fs.lstatSync(path.join(dir,name),{throwIfNoEntry:false});
    if(st)out.set(name,`${st.size}:${st.mtimeMs}`);
  }
  return out;
};
const textOf=outcome=>(outcome?.result?.content??[]).filter(c=>c?.type==='text').map(c=>c.text).join('\n');
/** The tail of the output (tracebacks end with the useful line), bounded. */
export const tailOutput=(text,max=MAX_GENERATOR_OUTPUT_CHARS)=>{
  const t=String(text??'').trim();
  return t.length<=max?t:'…'+t.slice(t.length-max+1);
};

/** @param job result of prepareAgentTask  @param opts {specMode, renderSpec, timeoutSeconds} */
export function createBuildStep(job,{specMode=false,renderSpec=null,timeoutSeconds=GENERATOR_TIMEOUT_S}={}){
  const generator=path.join(job.runDir,GENERATOR_ENTRY),layout=path.join(job.runDir,'layout.json');
  const regular=file=>{const st=fs.lstatSync(file,{throwIfNoEntry:false});return !!st&&st.isFile()&&!st.isSymbolicLink()};
  /** @param ctx the extension tool context (ctx.executeTool) @returns {Promise<{ok:boolean,source:string,message?:string,ms?:number}>} */
  return async function build(ctx){
    const started=Date.now();
    if(regular(generator)){
      if(fs.statSync(generator).size>MAX_GENERATOR_BYTES)return {ok:false,source:GENERATOR_ENTRY,message:`${GENERATOR_ENTRY} is larger than ${MAX_GENERATOR_BYTES} bytes; keep the generator small.`};
      if(typeof ctx?.executeTool!=='function')throw Error('GENERATOR_EXECUTION_UNAVAILABLE: ctx.executeTool is not available in this Pi runtime');
      const before=snapshot(job.runDir);
      const outcome=await ctx.executeTool('bash',{command:`cd ${shellQuote(job.runDir)} && python3 ${GENERATOR_ENTRY}`,timeout:timeoutSeconds});
      const out=tailOutput(textOf(outcome));
      if(outcome?.isError){
        const timedOut=/timeout|timed out/i.test(out);
        return {ok:false,source:GENERATOR_ENTRY,ms:Date.now()-started,message:timedOut
          ?`${GENERATOR_ENTRY} timed out after ${timeoutSeconds} s and was stopped. Make it faster (no browser, no network, no long loops), then run diagram_build_check again.`
          :`${GENERATOR_ENTRY} failed. Fix it and run diagram_build_check again. Last output:\n${out||'(no output)'}`};
      }
      const after=snapshot(job.runDir),stray=[...after].filter(([name,sig])=>name!=='candidate.svg'&&before.get(name)!==sig).map(([name])=>name);
      if(stray.length)return {ok:false,source:GENERATOR_ENTRY,ms:Date.now()-started,message:`GENERATOR_WROTE_OTHER_FILES: ${GENERATOR_ENTRY} must write only candidate.svg in the run directory, but it created or changed: ${stray.slice(0,8).join(', ')}. Write scratch data elsewhere (for example a path under the system temp directory) or keep it in memory.`};
      return {ok:true,source:GENERATOR_ENTRY,ms:Date.now()-started};
    }
    if(specMode&&renderSpec&&regular(layout)){
      const result=await renderSpec();
      const text=textOf({result});
      if(result?.details?.status==='SCHEMA_ERROR'||/^SCHEMA_ERROR/.test(text))return {ok:false,source:'layout.json',ms:Date.now()-started,message:tailOutput(text)};
      return {ok:true,source:'layout.json',ms:Date.now()-started};
    }
    return {ok:true,source:'candidate.svg',ms:Date.now()-started};
  };
}
