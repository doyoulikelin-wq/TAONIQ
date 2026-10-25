/* Runs only inside the self-contained Blob Worker. Stream state stays here;
 * transferred point arrays are snapshot copies, never the persistent ring. */
(function(){
  if(typeof document!=='undefined'||typeof self==='undefined')return;
  const jobs=new Map();let stream=null,streamGeneration=0,streamBusy=false;
  function stopStream(){streamGeneration++;stream=null;streamBusy=false;for(const token of jobs.values())if(token.stream)token.cancelled=true;}
  self.onmessage=async function(event){
    const{id,type,payload}=event.data||{};
    if(type==='cancel'){if(jobs.has(id))jobs.get(id).cancelled=true;return;}
    const token={cancelled:false,stream:type?.startsWith('stream-')};jobs.set(id,token);
    const callbacks={shouldCancel:()=>token.cancelled,onProgress:progress=>self.postMessage({id,type:'progress',progress})};
    let advanceGeneration=null;
    try{
      let result;
      if(type==='compute')result=await TaoModel.compute(payload,callbacks);
      else if(type==='calibrate')result=await TaoModel.calibrate(payload.chart,callbacks);
      else if(type==='stream-start'){stopStream();token.cancelled=false;stream=TaoContinuous.create(payload);result=stream.snapshot();}
      else if(type==='stream-stop'){if(payload?.sessionId&&stream&&payload.sessionId!==stream.sessionId)throw Error('Stream session mismatch');stopStream();token.cancelled=false;result={stopped:true,sessionId:payload?.sessionId||null};}
      else if(type==='stream-advance'){
        if(!stream||payload?.sessionId!==stream.sessionId)throw Error('Stream session mismatch');
        if(streamBusy)throw Error('One stream advance may be in flight');
        streamBusy=true;advanceGeneration=streamGeneration;
        result=await stream.advance(payload,{...callbacks,shouldCancel:()=>token.cancelled||streamGeneration!==advanceGeneration});
      }else throw Error('Unknown worker operation');
      if(token.cancelled)throw Error('Cancelled');
      const transfers=type==='compute'?[result.baseline.buffer,result.custom.buffer,result.noDayun.buffer]:result.points?[result.points.buffer]:[];
      self.postMessage({id,type:'result',result},transfers);
    }catch(error){self.postMessage({id,type:'error',error:error.message});}
    finally{jobs.delete(id);if(advanceGeneration!==null&&advanceGeneration===streamGeneration)streamBusy=false;}
  };
})();
