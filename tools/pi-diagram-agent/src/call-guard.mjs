// Per-call time limit for the author model. One assistant turn (request sent -> message ended) may run at most PI_DIAGRAM_MAX_CALL_S
// seconds (default 480). Tool execution, the reviewer and the Judge are not model-call time: the timer runs only between a provider
// request and the end of the assistant message. Pure and clock-injectable: no Pi imports.
export const DEFAULT_MAX_CALL_S=480;

export function maxCallMsFromEnv(env=process.env){
  const v=Number(env.PI_DIAGRAM_MAX_CALL_S);
  return (Number.isFinite(v)&&v>0?v:DEFAULT_MAX_CALL_S)*1000;
}

/** @param opts {limitMs, onTimeout(info), setTimer, clearTimer, now}
 *  start()   a model call began (idempotent while one is running)
 *  end(stop) the assistant message ended with stopReason `stop`
 *  takeTimeout() after the aborted turn has ended: {elapsedMs,limitMs,consecutive,retry} once per timeout, else null.
 *  A first timeout may be retried; a timeout of the retried call (consecutive 2) may not. A call that completes normally resets the count. */
export function createCallGuard({limitMs,onTimeout=()=>{},setTimer=(...a)=>setTimeout(...a),clearTimer=t=>clearTimeout(t),now=()=>Date.now()}){
  let timer=null,startedAt=0,pending=null,consecutive=0;
  const stop=()=>{if(timer!==null){clearTimer(timer);timer=null}};
  return {
    start(){
      if(timer!==null)return;
      startedAt=now();
      timer=setTimer(()=>{timer=null;pending={elapsedMs:now()-startedAt,limitMs};onTimeout(pending)},limitMs);
      timer?.unref?.();
    },
    end(stopReason){
      stop();
      // The abort lost the race and the call finished anyway: it is not a timeout. A transport error is neither a timeout nor a success.
      if(stopReason!=='aborted'){pending=null;if(stopReason!=='error')consecutive=0}
    },
    takeTimeout(){
      if(!pending)return null;
      const p=pending;pending=null;consecutive++;
      return {...p,consecutive,retry:consecutive<2};
    },
    cancel(){stop();pending=null},
  };
}
