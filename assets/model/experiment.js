(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./drive.js'));
  else root.FlowExperiment=factory(root.FlowDriveV09);
})(typeof globalThis!=='undefined'?globalThis:this,function(Drive){
  'use strict';
  const ORDER=['alpha','beta','tau','delta','epsilon','zeta','kappa','eta'];
  const INITIAL=[0.1,0,0];
  const MAX_STEP=0.0025, SAMPLE_STEP=0.01, CHUNK=8000;
  function finite(x,name){if(!Number.isFinite(x))throw Error(name+' must be finite');return x;}
  function normalize(request){
    if(!request||!Drive)throw Error('FlowDrive and a request are required');
    const enabled=request.enabled===undefined?[true,true,true,true,true]:request.enabled;
    const multipliers=request.multipliers===undefined?[1,1,1,1,1]:request.multipliers;
    if(!Array.isArray(enabled)||enabled.length!==5||enabled.some(x=>typeof x!=='boolean'))throw Error('Five boolean enabled values required');
    if(!Array.isArray(multipliers)||multipliers.length!==5||multipliers.some(x=>!Number.isFinite(x)||x<0||x>2))throw Error('Five intensity multipliers in [0,2] required');
    const base=request.birthParameters;
    if(!base||ORDER.some(k=>!Number.isFinite(base[k])))throw Error('Eight finite birthParameters required');
    const config=request.driveConfig;
    if(!config||!Array.isArray(config.weights)||config.weights.length!==5)throw Error('A v0.9 driveConfig is required');
    if(request.dayunPillar!==null && (typeof request.dayunPillar!=='string'||request.dayunPillar.length!==2))throw Error('A dayunPillar string or explicit null is required');
    const effective=enabled.map((v,j)=>v&&(j!==0||request.dayunPillar!==null)?multipliers[j]:0);
    const cfg=Object.assign({},config,{weights:config.weights.map((w,j)=>w*effective[j]),disabled_layers:effective.flatMap((v,j)=>v===0?[j]:[])});
    const burnIn=request.burnIn===undefined?600:finite(request.burnIn,'burnIn');
    const windowDays=request.windowDays===undefined?90:finite(request.windowDays,'windowDays');
    if(burnIn<0||burnIn>2000||windowDays<=0||windowDays>365)throw Error('Protocol duration outside supported range');
    for(const d of [burnIn,windowDays])if(Math.abs(d/SAMPLE_STEP-Math.round(d/SAMPLE_STEP))>1e-7)throw Error('Duration must be a multiple of 0.01 model unit');
    const evaluated=Drive.evaluate(request.birthPillars,request.dayunPillar,request.flowPillars,base,cfg);
    const birth=ORDER.map(k=>base[k]);
    const key=JSON.stringify({birth,burnIn,windowDays,maxStep:MAX_STEP,sampleStep:SAMPLE_STEP,initial:INITIAL});
    return {birth,evaluated,enabled:enabled.slice(),multipliers:multipliers.slice(),effective,config:cfg,burnIn,windowDays,key};
  }
  function evaluate(request){
    const n=normalize(request);
    return Object.assign({},n.evaluated,{birthParams:n.birth.slice(),enabled:n.enabled,multipliers:n.multipliers,effectiveMultipliers:n.effective,baselineKey:n.key});
  }
  // Autonomous frozen-date integration. This is an equal-protocol counterfactual
  // shape experiment, not the historically accumulated state at the selected date.
  function integration(parameters,burnIn,windowDays,options){
    options=options||{};
    const h=options.maxStep===undefined?MAX_STEP:finite(options.maxStep,'maxStep');
    const sample=options.sampleStep===undefined?SAMPLE_STEP:finite(options.sampleStep,'sampleStep');
    if(!(h>0&&h<=MAX_STEP&&sample>=h))throw Error('Invalid integration sampling');
    const burnSteps=Math.round(burnIn/h), sampleEvery=Math.round(sample/h), count=Math.round(windowDays/sample)+1;
    if(Math.abs(burnSteps*h-burnIn)>1e-9||Math.abs(sampleEvery*h-sample)>1e-10||Math.abs((count-1)*sample-windowDays)>1e-9)throw Error('Integral step counts required');
    const totalSteps=burnSteps+(count-1)*sampleEvery;
    const p=parameters.slice();if(p.length!==8||p.some(x=>!Number.isFinite(x)))throw Error('Eight finite parameters required');
    const points=new Float64Array(count*3);
    let x=INITIAL[0],y=INITIAL[1],z=INITIAL[2],i=0,out=0,maxAbs=.1,minRadius=.1,axisZeroSteps=0,phaseMax=0;
    function save(){points[out++]=x;points[out++]=y;points[out++]=z;}
    if(burnSteps===0)save();
    function chunk(steps){
      const limit=Math.min(totalSteps,i+steps),a=p[0],b=p[1],tau=p[2],delta=p[3],epsilon=p[4],zeta=p[5],k=p[6],eta=p[7];
      for(;i<limit;){
        let u=x*x+y*y,omega=delta+zeta*z+eta*x,g=z-b;
        const ax=g*x-omega*y+k*y*z,ay=omega*x+g*y+k*x*z,az=tau+a*z-z*z*z/3-u*(1+epsilon*z)-2*k*x*y;
        if(u>1e-20)phaseMax=Math.max(phaseMax,Math.abs(omega+k*z*(x*x-y*y)/u));
        let qx=x+h*ax/2,qy=y+h*ay/2,qz=z+h*az/2;
        u=qx*qx+qy*qy;omega=delta+zeta*qz+eta*qx;g=qz-b;
        const bx=g*qx-omega*qy+k*qy*qz,by=omega*qx+g*qy+k*qx*qz,bz=tau+a*qz-qz*qz*qz/3-u*(1+epsilon*qz)-2*k*qx*qy;
        qx=x+h*bx/2;qy=y+h*by/2;qz=z+h*bz/2;
        u=qx*qx+qy*qy;omega=delta+zeta*qz+eta*qx;g=qz-b;
        const cx=g*qx-omega*qy+k*qy*qz,cy=omega*qx+g*qy+k*qx*qz,cz=tau+a*qz-qz*qz*qz/3-u*(1+epsilon*qz)-2*k*qx*qy;
        qx=x+h*cx;qy=y+h*cy;qz=z+h*cz;
        u=qx*qx+qy*qy;omega=delta+zeta*qz+eta*qx;g=qz-b;
        const dx=g*qx-omega*qy+k*qy*qz,dy=omega*qx+g*qy+k*qx*qz,dz=tau+a*qz-qz*qz*qz/3-u*(1+epsilon*qz)-2*k*qx*qy;
        x+=h*(ax+2*bx+2*cx+dx)/6;y+=h*(ay+2*by+2*cy+dy)/6;z+=h*(az+2*bz+2*cz+dz)/6;i++;
        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))throw Error('Numerical trajectory became non-finite; no clipping or replacement was applied');
        maxAbs=Math.max(maxAbs,Math.abs(x),Math.abs(y),Math.abs(z));minRadius=Math.min(minRadius,Math.hypot(x,y));
        if(x===0&&y===0)axisZeroSteps++;
        if(i>=burnSteps&&(i-burnSteps)%sampleEvery===0)save();
      }
      return i/totalSteps;
    }
    function result(){
      if(i!==totalSteps||out!==points.length)throw Error('Incomplete numerical integration');
      let radial2=0,mx=0,my=0,mz=0;
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(let j=0;j<points.length;j+=3){const px=points[j],py=points[j+1],pz=points[j+2];radial2+=px*px+py*py;mx+=px;my+=py;mz+=pz;for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],points[j+k]);hi[k]=Math.max(hi[k],points[j+k]);}}
      let variance=0;mx/=count;my/=count;mz/=count;
      for(let j=0;j<points.length;j+=3)variance+=(points[j]-mx)**2+(points[j+1]-my)**2+(points[j+2]-mz)**2;
      return {points,bounds:{min:lo,max:hi},diagnostics:{steps:totalSteps,maxAbs,minRadius,axisZeroSteps,radialRms:Math.sqrt(radial2/count),spreadRms:Math.sqrt(variance/count),maxAngularSpeed:phaseMax,maxPhasePerSample:phaseMax*sample,sampleCount:count,maxStep:h,sampleStep:sample,finite:true}};
    }
    return {chunk,result,totalSteps};
  }
  function integrateSync(parameters,burnIn,windowDays,options){const it=integration(parameters,burnIn,windowDays,options);it.chunk(it.totalSteps);return it.result();}
  function cached(n,c){
    if(!c)return null;
    if(c.key!==n.key||!c.points||c.points.length!==3*(Math.round(n.windowDays/SAMPLE_STEP)+1)||!c.diagnostics||!c.bounds)throw Error('Cached baseline does not match the exact integration protocol');
    return {points:new Float64Array(c.points),diagnostics:Object.assign({},c.diagnostics,{cacheHit:true}),bounds:{min:c.bounds.min.slice(),max:c.bounds.max.slice()}};
  }
  function combine(n,base,custom){
    const min=base.bounds.min.map((v,j)=>Math.min(v,custom.bounds.min[j])),max=base.bounds.max.map((v,j)=>Math.max(v,custom.bounds.max[j]));
    return {params:n.evaluated.params,parameters:n.evaluated.parameters,birthParams:n.birth,evaluation:n.evaluated,enabled:n.enabled,multipliers:n.multipliers,effectiveMultipliers:n.effective,
      baseline:base.points,custom:custom.points,baselineKey:n.key,baselineBounds:base.bounds,baselineDiagnostics:base.diagnostics,
      protocol:{type:'frozen-date-counterfactual',frozenCalendar:true,initial:INITIAL.slice(),burnIn:n.burnIn,windowDays:n.windowDays,maxStep:MAX_STEP,sampleStep:SAMPLE_STEP,sampleCount:base.points.length/3,continuedHistoricalState:false},
      bounds:{min,max},diagnostics:{baseline:base.diagnostics,custom:custom.diagnostics,allOff:n.effective.every(x=>x===0),inputBudgetOrder:n.config.weights.slice()}};
  }
  function sameParams(a,b){return a.every((v,i)=>Object.is(v,b[i]));}
  function computeSync(request,callbacks){
    callbacks=callbacks||{};const n=normalize(request),check=()=>{if(callbacks.shouldCancel&&callbacks.shouldCancel())throw Error('Cancelled');};
    check();let base=cached(n,callbacks.cachedBaseline);if(!base)base=integrateSync(n.birth,n.burnIn,n.windowDays);check();
    const custom=sameParams(n.birth,n.evaluated.params)?{points:base.points.slice(),diagnostics:Object.assign({},base.diagnostics),bounds:base.bounds}:integrateSync(n.evaluated.params,n.burnIn,n.windowDays);check();
    if(callbacks.onProgress)callbacks.onProgress(1);return combine(n,base,custom);
  }
  async function compute(request,callbacks){
    callbacks=callbacks||{};const n=normalize(request),check=()=>{if(callbacks.shouldCancel&&callbacks.shouldCancel())throw Error('Cancelled');};
    async function run(p,offset,scale){
      const it=integration(p,n.burnIn,n.windowDays);let progress=0;
      while(progress<1){check();progress=it.chunk(CHUNK);if(callbacks.onProgress)callbacks.onProgress(offset+scale*progress);await new Promise(resolve=>setTimeout(resolve,0));}
      check();return it.result();
    }
    check();let base=cached(n,callbacks.cachedBaseline);const wasCached=!!base;
    if(!base)base=await run(n.birth,0,.5);
    const custom=sameParams(n.birth,n.evaluated.params)?{points:base.points.slice(),diagnostics:Object.assign({},base.diagnostics),bounds:base.bounds}:await run(n.evaluated.params,wasCached?0:.5,wasCached?1:.5);
    check();if(callbacks.onProgress)callbacks.onProgress(1);return combine(n,base,custom);
  }
  return {evaluate,compute,computeSync,integrateSync,parameterOrder:ORDER.slice(),protocolDefaults:{initial:INITIAL.slice(),burnIn:600,windowDays:90,maxStep:MAX_STEP,sampleStep:SAMPLE_STEP}};
});
