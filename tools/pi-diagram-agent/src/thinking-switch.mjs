/** Optional first-draft thinking level: run the first candidate at a lower level, then switch revisions to `finalLevel` after the first successful inspection. */
export const THINKING_LEVELS=['off','minimal','low','medium','high','xhigh'];

export function createThinkingSwitch({firstDraftLevel,finalLevel='high',setLevel,now=Date.now}){
  if(!firstDraftLevel)return {start:()=>null,wrap:inspect=>inspect};
  if(!THINKING_LEVELS.includes(firstDraftLevel)||!THINKING_LEVELS.includes(finalLevel))throw Error(`INVALID_FIRST_DRAFT_THINKING: ${firstDraftLevel}`);
  let startedAt=null,switchedAfterMs=null;
  return {
    start(){startedAt=now();setLevel(firstDraftLevel);return firstDraftLevel},
    wrap(inspect){
      return async(...args)=>{
        const result=await inspect(...args); // a failed inspection throws here and does not switch
        if(switchedAfterMs===null){switchedAfterMs=now()-(startedAt??now());setLevel(finalLevel)}
        const note={firstDraft:firstDraftLevel,revisions:finalLevel,switchedAfterMs,current:finalLevel};
        const first=result.content?.[0];
        if(first?.type==='text'){
          let body;try{body=JSON.parse(first.text)}catch{body=null}
          if(body&&typeof body==='object')result.content[0]={...first,text:JSON.stringify({...body,thinking:note})};
          else result.content[0]={...first,text:`${first.text}\n${JSON.stringify({thinking:note})}`};
        }
        result.details={...result.details,thinking:note};
        return result;
      };
    },
  };
}
