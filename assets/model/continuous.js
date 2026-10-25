/* v0.11 causal, non-autonomous continuation. The civil/model clock ratio is
 * fixed: playback speed controls scheduling only, never the numerical path.
 * Canonical RK/sample nodes are anchored at session start. A partial endpoint
 * is integrated for display but never becomes a packet-dependent restart state.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./model.js'),require('./experiment.js'),require('../vendor/lunar-1.7.7.js'),require('./examples.json'));
  else root.TaoContinuous=factory(root.TaoModel,root.FlowExperiment,root,root.TAO_DATA.examples);
})(typeof globalThis!=='undefined'?globalThis:this,function(Model,Experiment,L,Examples){
  'use strict';
  const DAY=86400000,OFFSET=28800000,MS_PER_MODEL=DAY*7/8,SAMPLE_MS=756000,MAX_STEP=.0025,TAU=1,COUNT=9001;
  const ORDER=Model.parameterOrder.slice(),POSITIVE=[0,1,2,3,4,7];
  const clone=x=>JSON.parse(JSON.stringify(x));
  function finiteParams(p){if(!Array.isArray(p)||p.length!==8||p.some(x=>!Number.isFinite(x))||POSITIVE.some(i=>p[i]<=0))throw Error('Eight finite parameters with positive dissipative coefficients required');return p;}
  function solarAt(t){const d=new Date(t+OFFSET);return L.Solar.fromYmdHms(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds());}
  function nextJie(t){const jie=solarAt(t).getLunar().getNextJie(false);if(!jie)throw Error('Next solar-term boundary unavailable');const ms=Date.parse(jie.getSolar().toYmdHms().replace(' ','T')+'+08:00');if(!(ms>t))throw Error('Solar-term boundary did not advance');return ms;}
  function nextHour(t){const anchor=Date.UTC(2000,0,1,1)-OFFSET,period=7200000;return anchor+(Math.floor((t-anchor)/period)+1)*period;}
  function rhs(x,p){const [a,b,t,d,e,z,k,n]=p,[X,Y,Z]=x,u=X*X+Y*Y,w=d+z*Z+n*X,g=Z-b;return [g*X-w*Y+k*Y*Z,w*X+g*Y+k*X*Z,t+a*Z-Z*Z*Z/3-u*(1+e*Z)-2*k*X*Y];}
  function response(p,target,h){const f=Math.exp(-h/TAU);return p.map((v,j)=>target[j]+(v-target[j])*f);}
  function step(x,p,target,h){
    if(!(h>0&&h<=MAX_STEP+1e-12))throw Error('Continuous RK step outside supported range');
    const pm=response(p,target,h/2),pe=response(p,target,h),a=rhs(x,p),b=rhs(x.map((v,j)=>v+h*a[j]/2),pm),c=rhs(x.map((v,j)=>v+h*b[j]/2),pm),d=rhs(x.map((v,j)=>v+h*c[j]),pe);
    const state=x.map((v,j)=>v+h*(a[j]+2*b[j]+2*c[j]+d[j])/6);
    if(state.some(v=>!Number.isFinite(v)))throw Error('Continuous trajectory became non-finite; no replacement or clipping applied');
    finiteParams(pe);return {xyz:state,p:pe};
  }
  function create(options){
    if(!options||typeof options.sessionId!=='string'||!options.sessionId.length)throw Error('A nonempty stream sessionId is required');
    const chart=Model.chart(options.chart.input),epochMs=options.epochMs;
    if(!Number.isSafeInteger(epochMs)||epochMs<chart.birthMs||epochMs>Date.now())throw Error('Stream start must be between birth and now');
    const enabled=options.enabled===undefined?[true,true,true,true,true]:options.enabled.slice(),multipliers=options.multipliers===undefined?[1,1,1,1,1]:options.multipliers.slice();
    const profile=Model.profileFor(chart,options.profile),config={...Examples.legacyDrive,...profile.candidate};delete config.mapping_mode;delete config.birth_profiles;
    const maxStep=options.maxStep===undefined?MAX_STEP:options.maxStep,gridMs=maxStep*MS_PER_MODEL;
    if(![.0025,.00125,.000625].includes(maxStep)||!Number.isSafeInteger(gridMs))throw Error('Supported maxStep is .0025, .00125 or .000625');
    const seed=options.seedPoints;
    if(!seed||seed.length!==COUNT*3||Array.from(seed).some(x=>!Number.isFinite(x)))throw Error('A finite 9001-point seed trajectory is required');
    function targetAt(t){const temporal=Model.temporal(chart,t),ev=Experiment.evaluate({birthPillars:chart.pillars,birthParameters:chart.parameters,dayunPillar:temporal.dayun.pillar,flowPillars:temporal.flowPillars,driveConfig:config,enabled,multipliers});return {temporal,params:finiteParams(ev.params.slice())};}
    const initialTarget=targetAt(epochMs),given=options.seedParameters;
    const initialParams=given?finiteParams(Array.isArray(given)?given.slice():ORDER.map(k=>given[k])):initialTarget.params.slice();
    const start=epochMs,initialPoint=Array.from(seed.slice(-3)),sessionId=options.sessionId;
    let busy=false,state={epochMs,integratedMs:epochMs,xyz:initialPoint.slice(),p:initialParams.slice(),target:initialTarget.params,temporal:initialTarget.temporal,
      ring:new Float64Array(seed),cursor:0,samples:0,steps:0,boundaryCount:0,jieMs:nextJie(epochMs),lastBatch:{events:[],steps:0,newSamples:0}};
    function boundary(s){return Math.min(nextHour(s.integratedMs),s.jieMs,s.temporal.dayun.endMs);}
    function atBoundary(s,t,events){
      const types=[];if(t===nextHour(s.integratedMs-1))types.push('hour/day');if(t===s.jieMs){types.push('solar-term');s.jieMs=nextJie(t);}if(t===s.temporal.dayun.endMs)types.push('dayun');
      const target=targetAt(t);s.target=target.params;s.temporal=target.temporal;s.boundaryCount++;events.push({epochMs:t,types,pillars:target.temporal.pillars.slice()});
    }
    function ordered(s){const result=new Float64Array(COUNT*3),pivot=s.cursor*3;result.set(s.ring.subarray(pivot));result.set(s.ring.subarray(0,pivot),s.ring.length-pivot);return result;}
    function snapshot(){
      let xyz=state.xyz,p=state.p;const dt=(state.epochMs-state.integratedMs)/MS_PER_MODEL;
      if(dt>0){const partial=step(xyz,p,state.target,dt);xyz=partial.xyz;p=partial.p;}
      let points=ordered(state);const lastSampleMs=start+state.samples*SAMPLE_MS;
      if(state.epochMs>lastSampleMs){const withHead=new Float64Array(points.length+3);withHead.set(points);withHead.set(xyz,points.length);points=withHead;}
      const elapsed=(state.epochMs-start)/MS_PER_MODEL,remaining=Math.max(0,COUNT-state.samples),temporal=Model.temporal(chart,state.epochMs);
      const parameters=Object.fromEntries(ORDER.map((k,j)=>[k,p[j]])),targetParameters=Object.fromEntries(ORDER.map((k,j)=>[k,state.target[j]]));
      const protocol={type:'continuous-nonautonomous-continuation',version:'0.11',continuedHistoricalState:true,continuedFromBirth:false,sessionStartMs:start,
        seedType:options.seedProvenance||'frozen-date-window',seedWindowModelUnits:90,rollingWindowModelUnits:90,rollingWindowCivilDays:78.75,windowDays:90,initialSeedPoints:COUNT,seedPointsRemaining:remaining,
        maxStep,sampleStep:.01,modelUnitsPerCivilDay:8/7,civilMillisecondsPerModelUnit:MS_PER_MODEL,responseTimeModelUnits:TAU,
        parameterResponse:'dp/dmodelTime = (calendarTarget - p) / 1; exact exponential response at RK4 stages',
        calendarBoundaries:'every two-hour/day boundary, exact solar jie and personal dayun boundaries',
        playbackSpeedChangesNumericalPath:false,finiteWindowChaosClaim:false,staticCalibrationGuaranteesContinuousComplexity:false,
        positiveParametersPreserved:true,nonlinearAxisConstraintsDuringResponseGuaranteed:false,partialHeadIsActualIntegration:state.epochMs>lastSampleMs};
      return {sessionId,points,parameters,targetParameters,epochMs:state.epochMs,temporal,profile:clone(profile),protocol,modelElapsed:elapsed,seedPointsRemaining:remaining,
        checkpoint:{sessionId,sessionStartMs:start,epochMs:state.epochMs,stateXYZ:xyz.slice(),appliedParameters:p.slice(),targetParameters:state.target.slice(),
          canonicalEpochMs:state.integratedMs,canonicalStateXYZ:state.xyz.slice(),canonicalParameters:state.p.slice(),modelElapsed:elapsed,samplesAppended:state.samples,
          nextSampleMs:lastSampleMs+SAMPLE_MS,nextBoundaryMs:boundary(state),initialPoint:initialPoint.slice(),initialParameters:initialParams.slice(),
          birth:clone(chart.input),enabled:enabled.slice(),multipliers:multipliers.slice(),profile:clone(profile),protocol:clone(protocol)},
        diagnostics:{finite:true,integrationSteps:state.steps,boundaryCount:state.boundaryCount,lastBatch:clone(state.lastBatch),sampleCount:points.length/3,tailSampleCount:COUNT,appendedSamples:state.samples}};
    }
    async function advance(request,callbacks){
      callbacks=callbacks||{};if(busy)throw Error('One stream advance may be in flight');
      const duration=request?.civilDurationMs;
      if(!Number.isSafeInteger(duration)||duration<=0||duration>2*MS_PER_MODEL)throw Error('civilDurationMs must be a positive integer within two model units');
      const modelDuration=duration/MS_PER_MODEL;
      if(request.modelDuration!==undefined&&(!Number.isFinite(request.modelDuration)||Math.abs(request.modelDuration-modelDuration)>1e-10))throw Error('modelDuration must follow fixed 8/7 model units per civil day');
      const targetEpoch=state.epochMs+duration;if(targetEpoch>Date.now())throw Error('Continuous advance cannot pass the current time');
      const check=()=>{if(callbacks.shouldCancel?.())throw Error('Cancelled');};check();busy=true;
      const s={...state,xyz:state.xyz.slice(),p:state.p.slice(),target:state.target.slice(),ring:state.ring.slice(),temporal:clone(state.temporal)},events=[],beforeSteps=s.steps,beforeSamples=s.samples;
      try{
        let work=0;
        for(;;){
          check();const nextGrid=start+(Math.floor((s.integratedMs-start)/gridMs)+1)*gridMs,nextSample=start+(s.samples+1)*SAMPLE_MS,edge=boundary(s),end=Math.min(nextGrid,nextSample,edge);
          if(end>targetEpoch)break;
          const advanced=step(s.xyz,s.p,s.target,(end-s.integratedMs)/MS_PER_MODEL);s.xyz=advanced.xyz;s.p=advanced.p;s.integratedMs=end;s.steps++;
          if(end===nextSample){s.ring.set(s.xyz,s.cursor*3);s.cursor=(s.cursor+1)%COUNT;s.samples++;}
          if(end===edge)atBoundary(s,end,events);
          if(++work%256===0){callbacks.onProgress?.({fraction:Math.max(0,(end-state.epochMs)/duration),phase:'连续积分'});await new Promise(resolve=>setTimeout(resolve,0));}
        }
        check();s.epochMs=targetEpoch;s.lastBatch={events,steps:s.steps-beforeSteps,newSamples:s.samples-beforeSamples};
        if(targetEpoch>s.integratedMs)step(s.xyz,s.p,s.target,(targetEpoch-s.integratedMs)/MS_PER_MODEL);
        state=s;callbacks.onProgress?.({fraction:1,phase:'连续积分'});return snapshot();
      }finally{busy=false;}
    }
    return Object.freeze({sessionId,advance,snapshot});
  }
  return Object.freeze({create,modelUnitsPerCivilDay:8/7,civilMillisecondsPerModelUnit:MS_PER_MODEL,sampleCivilMilliseconds:SAMPLE_MS,maxStep:MAX_STEP,responseTimeModelUnits:TAU});
});
