(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./encoding.js'));
 else root.FlowDriveV09=factory(root.BaziEncodingV05);
})(typeof globalThis!=='undefined'?globalThis:this,function(E){
 'use strict';
 const ORDER=['alpha','beta','tau','delta','epsilon','zeta','kappa','eta'];
 function positiveAxisRoot(alpha,tau){
  if(!(alpha>0)||!(tau>0)||!Number.isFinite(alpha)||!Number.isFinite(tau))throw Error('Positive finite alpha and tau required for axis root');
  const q=3*tau/(2*Math.pow(alpha,1.5));
  return 2*Math.sqrt(alpha)*(q<=1?Math.cos(Math.acos(q)/3):Math.cosh(Math.acosh(q)/3));
 }
 function sigmoid(x){return x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));}
 function negativeAxisCritical(alpha,beta,delta,zeta,q){
  if(q>1)return 0;
  if(!(alpha>0&&q>0))throw Error('Positive alpha and q required for negative axis root');
  const zminus=2*Math.sqrt(alpha)*Math.cos((Math.acos(q)+2*Math.PI)/3);
  return Math.hypot(zminus-beta,delta+zeta*zminus)/Math.abs(zminus);
 }
 function birthKey(pillars,parameters){return JSON.stringify({pillars,params:ORDER.map(k=>parameters[k])});}
 function evaluate(birthPillars,dayunPillar,flowPillars,birthParameters,config){
  let mappingProfile=null;
  if(config&&config.mapping_mode==='birth-calibrated-profile'){
   const key=birthKey(birthPillars,birthParameters),profile=config.birth_profiles&&config.birth_profiles[key];
   if(!profile)throw Error('Birth profile has not been calibrated by the frozen v0.9 protocol; no silent fallback is applied');
   mappingProfile={id:profile.id,label:profile.label,source:'birth-only-calibration',fallback:profile.fallback,eligibleCount:profile.eligibleCount,totalCandidates:9,key,calibrationStats:profile.calibrationStats};
   config=Object.assign({},config,profile.candidate);
  }
  if(config&&config.response_caps&&(!Array.isArray(config.response_caps)||config.response_caps.length!==8||config.response_caps.some(x=>!(x>0)||!Number.isFinite(x))))throw Error('Eight positive finite response_caps required');
  if(config&&config.eta_damping!==undefined&&(!Number.isFinite(config.eta_damping)||config.eta_damping<0))throw Error('Nonnegative finite eta_damping required');
  if(!E)throw Error('Load flow_calendar_bundle.js before drive.js');
  if(!config||typeof config.gain!=='number'||!Number.isFinite(config.gain))throw Error('A frozen numeric config.gain is required');
  const weights=config.weights,amplitudes=config.amplitudes;
  if(!Array.isArray(weights)||weights.length!==5||weights.some(x=>!Number.isFinite(x)||x<0))throw Error('Five nonnegative weights required');
  if(!Array.isArray(amplitudes)||amplitudes.length!==8||amplitudes.some(x=>!Number.isFinite(x)))throw Error('Eight finite amplitudes required');
  if(config.parameter_order&&JSON.stringify(config.parameter_order)!==JSON.stringify(ORDER))throw Error('Parameter order mismatch');
  if(config.additive_indices&&JSON.stringify(config.additive_indices)!=='[5]')throw Error('Only zeta is additive in this frozen driver');
  const birth=ORDER.map(k=>birthParameters[k]);
  if(birth.some(x=>!Number.isFinite(x)))throw Error('Eight finite birth parameters required');
  const disabled=new Set(config.disabled_layers||[]);
  for(const s of disabled)if(!Number.isInteger(s)||s<0||s>4)throw Error('disabled_layers must contain layer indices0..4');
  if(dayunPillar!==null && (typeof dayunPillar!=='string'||dayunPillar.length!==2))throw Error('dayunPillar must be a valid Jiazi string or null before first luck period');
  const dayunActive=dayunPillar!==null;
  if(!dayunActive)disabled.add(0);
  const flowVectors=E.unitChannels8(birthPillars,flowPillars);
  const dayunVector=dayunActive?E.unitChannels8(birthPillars,Array(4).fill(dayunPillar))[0]:Array(8).fill(0);
  const originalVectors=[dayunVector,...flowVectors];
  const matrix=config.direction_matrix;
  if(matrix&&(!Array.isArray(matrix)||matrix.length!==8||matrix.some(v=>!Array.isArray(v)||v.length!==8||v.some(x=>!Number.isFinite(x)))))throw Error('direction_matrix must be finite8x8');
  const vectors=matrix?originalVectors.map(v=>matrix.map(row=>row.reduce((s,x,j)=>s+x*v[j],0))):originalVectors;
  const rawNorms=[dayunActive?Math.hypot(...E.rawChannels8(birthPillars,Array(4).fill(dayunPillar))[0]):0,...E.rawChannels8(birthPillars,flowPillars).map(v=>Math.hypot(...v))];
  const contributions=vectors.map((v,s)=>v.map(x=>disabled.has(s)?0:weights[s]*x));
  const D=Array.from({length:8},(_,j)=>contributions.reduce((s,v)=>s+v[j],0));
  const uncappedChanges=D.map((x,j)=>config.gain*amplitudes[j]*x);
  const changes=config.response_caps?uncappedChanges.map((x,j)=>config.response_caps[j]*Math.tanh(x/config.response_caps[j])):uncappedChanges;
  if(config.eta_damping)changes[7]-=config.eta_damping*(1-Math.exp(-D.reduce((s,x)=>s+x*x,0)));
  if(config.delta_bias)changes[3]+=config.delta_bias*(1-Math.exp(-D.reduce((s,x)=>s+x*x,0)));
  const inactive=config.gain===0||contributions.every(v=>v.every(x=>x===0));
  const params=birth.map((p,j)=>inactive?p:j===5?p+changes[j]:p*Math.exp(changes[j]));
  const tauTransform=config.tau_transform||'exponential';
  const qBirth=3*birth[2]/(2*Math.pow(birth[0],1.5));
  let qCurrent=3*params[2]/(2*Math.pow(params[0],1.5));
  if(tauTransform==='birth-axis-branch'){
   if(!(qBirth>0&&Number.isFinite(qBirth)))throw Error('Positive finite birth q required');
   qCurrent=inactive?qBirth:qBirth>1?1+(qBirth-1)*Math.exp(changes[2]):qBirth<1?sigmoid(Math.log(qBirth/(1-qBirth))+changes[2]):1;
   if(!inactive)params[2]=(2/3)*Math.pow(params[0],1.5)*qCurrent;
  }else if(tauTransform!=='exponential')throw Error('Unknown tau_transform');
  const betaTransform=config.beta_transform||'exponential';
  if(betaTransform==='axis-root-logistic'){
   const cap=config.axis_beta_cap;
   if(!(cap>0&&cap<1))throw Error('axis_beta_cap must be in(0,1)');
   const rootBirth=positiveAxisRoot(birth[0],birth[2]),r0=birth[1]/(cap*rootBirth);
   if(!(r0>0&&r0<1))throw Error('Birth beta must be below axis_beta_cap times positive axis root');
   if(!inactive)params[1]=cap*positiveAxisRoot(params[0],params[2])*sigmoid(Math.log(r0/(1-r0))+changes[1]);
  }else if(betaTransform!=='exponential')throw Error('Unknown beta_transform');
  const kappaTransform=config.kappa_transform||'exponential';
  if(kappaTransform==='negative-axis-gap'){
   const criticalBirth=negativeAxisCritical(birth[0],birth[1],birth[3],birth[5],qBirth);
   const gapBirth=birth[6]-criticalBirth;
   if(!(gapBirth>0))throw Error('Birth kappa must exceed negative-axis critical value');
   if(!inactive){
    const qForThreshold=3*params[2]/(2*Math.pow(params[0],1.5));
    params[6]=negativeAxisCritical(params[0],params[1],params[3],params[5],qForThreshold)+gapBirth*Math.exp(changes[6]);
   }
  }else if(kappaTransform!=='exponential')throw Error('Unknown kappa_transform');
  if(params.some(x=>!Number.isFinite(x)))throw Error('Non-finite driven parameter');
  const scaledContributions=contributions.map(v=>v.map((x,j)=>config.gain*amplitudes[j]*x));
  return {mapping_profile:mappingProfile,params,parameters:Object.fromEntries(ORDER.map((k,j)=>[k,params[j]])),parameter_order:ORDER.slice(),D,original_unit_channels:originalVectors,uncapped_changes:uncappedChanges,unit_channels:vectors,layer_contributions:contributions,standardized_changes:changes,standardized_layer_contributions:scaledContributions,layer_input_norms:contributions.map(v=>Math.hypot(...v)),layer_scaled_norms:scaledContributions.map(v=>Math.hypot(...v)),raw_channel_norms:rawNorms,dayun_pillar:dayunPillar,dayun_active:dayunActive,layer_order:['dayun','year','month','day','hour'],gain:config.gain,response_caps:config.response_caps?config.response_caps.slice():null,eta_damping:config.eta_damping||0,weights:weights.slice(),amplitudes:amplitudes.slice(),disabled_layers:[...disabled],additive_indices:[5],beta_transform:betaTransform,tau_transform:tauTransform,kappa_transform:kappaTransform,axis_q:qCurrent};
 }
 return {evaluate,birthKey,positiveAxisRoot,negativeAxisCritical,parameter_order:ORDER.slice()};
});
