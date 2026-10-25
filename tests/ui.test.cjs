// Executes the delivered UI with DOM/Canvas/Worker stubs and real numerical results.
// This is deliberately not a browser, native input, layout or Blob-security test.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const M=require('../assets/model/model.js'),root=path.resolve(__dirname,'..');
test('UI transactions preserve birth, date, controls, reference, cancellation and export',async()=>{
  const els=new Map(),timers=new Map(),frames=new Map(),workers=[],observers=[],blobs=new Map(),downloads=[],docEvents={},winEvents={};
  let seq=0,drawCalls=0,checks=0,frameStamp=0;const renderCalls=[];
  const check=(v,m)=>{checks++;assert(v,m);};
  const ctx=new Proxy({measureText:s=>({width:String(s).length*7})},{get(o,k){return k in o?o[k]:(...args)=>{drawCalls++;assert(args.every(v=>typeof v!=='number'||Number.isFinite(v)),'finite Canvas coordinates');};},set(o,k,v){o[k]=v;return true;}});
  function element(id){
    const classes=new Set(),e={id,attributes:{},events:{},style:{},children:[],disabled:false,checked:false,hidden:false,value:'',textContent:'',width:0,height:0,
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},
      setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k];},
      addEventListener(k,f){this.events[k]=f;},appendChild(n){this.children.push(n);},remove(){},
      getBoundingClientRect(){return {width:380,height:300};},getContext(){return ctx;},setPointerCapture(){},
      click(){if(this.disabled)return;if(this.tagName==='A')downloads.push({url:this.href,name:this.download});this.events.click?.({target:this});}};
    let html='';Object.defineProperty(e,'innerHTML',{get:()=>html,set(v){html=v;parse(v);}});return e;
  }
  function parse(html){for(const tag of html.match(/<[a-z][^>]*>/gi)||[]){const id=tag.match(/\bid="([^"]+)"/)?.[1];if(!id)continue;const e=els.get(id)||element(id);els.set(id,e);e.tagName=tag.match(/^<(\w+)/)[1].toUpperCase();for(const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)){e.setAttribute(m[1],m[2]);if(m[1]==='value')e.value=m[2];}for(const k of ['hidden','checked','disabled'])if(new RegExp('\\s'+k+'(?:\\s|>)').test(tag))e[k]=true;}}
  const pageSource=fs.readFileSync(path.join(root,'index.html'),'utf8');parse(pageSource);
  for(const match of pageSource.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){const options=[...match[2].matchAll(/<option\b([^>]*)>/g)];const selected=options.find(o=>/\bselected\b/.test(o[1]))||options[0];if(selected)els.get(match[1]).value=selected[1].match(/value="([^"]*)"/)?.[1]||'';}
  const get=id=>{assert(els.has(id),'real HTML element '+id);return els.get(id);};
  const document={hidden:false,getElementById:get,addEventListener(k,f){docEvents[k]=f;},body:element('body'),createElement(tag){const e=element('created'+(++seq));e.tagName=tag.toUpperCase();return e;}};
  const media={matches:false,addEventListener(k,f){this.change=f;}};
  class IntersectionObserverStub{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}setVisible(isIntersecting){this.callback([{target:this.target,isIntersecting}]);}}
  class WorkerStub{constructor(){this.requests=[];this.streams=new Map();workers.push(this);}postMessage(q){this.request=q;this.requests.push(q);}terminate(){this.terminated=true;}emit(data){this.onmessage?.({data});}}
  const box={console,document,TaoModel:M,TaoWorker:{create:()=>new WorkerStub()},Date,Math,Number,Map,Promise,Blob,devicePixelRatio:1,
    IntersectionObserver:IntersectionObserverStub,performance:{now:()=>frameStamp},
    requestAnimationFrame(f){const id=++seq;frames.set(id,f);return id;},cancelAnimationFrame:id=>frames.delete(id),
    URL:{createObjectURL(b){const u='blob:qa/'+(++seq);blobs.set(u,b);return u;},revokeObjectURL:u=>blobs.delete(u)},
    matchMedia:()=>media,addEventListener(k,f){winEvents[k]=f;},setTimeout(f,delay){const id=++seq;timers.set(id,{f,delay});return id;},clearTimeout:id=>timers.delete(id)};
  box.window=box;vm.createContext(box);
  const rendererFile=path.join(root,'assets/view3d.js');
  assert(fs.existsSync(rendererFile),'3D renderer is delivered');
  vm.runInContext(fs.readFileSync(rendererFile,'utf8'),box,{filename:'assets/view3d.js'});
  const view3d=box.TaoView3D;
  box.TaoView3D={...view3d,draw(canvas,points,options){renderCalls.push({id:canvas.id,points,projection:options.projection,camera:{...options.camera},zoom:options.zoom});return view3d.draw(canvas,points,options);}};
  vm.runInContext(fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),box,{filename:'assets/app.js'});
  const A=box.TaoApp;
  async function flush(){for(let i=0;i<4;i++)await Promise.resolve();}
  async function scheduled(){for(const [id,t] of [...timers])if(t.delay<=120){timers.delete(id);t.f();}await flush();return workers.at(-1);}
  async function finish(w=workers.at(-1)){const q=w.request;assert(q?.type==='compute');const r=await M.compute(q.payload);w.emit({id:q.id,type:'result',result:r});await flush();return r;}
  async function run(){const w=await scheduled();if(A.state.activeJob?.type==='compute')await finish(w);check(!A.state.busy&&!A.state.error,'current computation completes');}
  async function finishStream(w=workers.at(-1),q=w.request){
    const C=require('../assets/model/continuous.js');let result;
    if(q.type==='stream-start'){const stream=C.create(q.payload);w.streams.set(q.payload.sessionId,stream);result=stream.snapshot();}
    else if(q.type==='stream-advance'){const stream=w.streams.get(q.payload.sessionId);assert(stream,'worker-local continuous session');result=await stream.advance(q.payload);}
    else throw Error('Unexpected stream request '+q.type);
    w.emit({id:q.id,type:'result',result});await flush();return result;
  }
  const startCount=()=>workers.reduce((n,w)=>n+w.requests.filter(q=>q.type==='stream-start').length,0);
  const advanceCount=()=>workers.reduce((n,w)=>n+w.requests.filter(q=>q.type==='stream-advance').length,0);
  async function presentBuffered(){const before=A.state.epochMs;for(let i=0;i<5&&A.state.epochMs===before;i++){frame(frameStamp+40);await flush();}check(A.state.epochMs>before,'buffered numerical frame is presented on the playback clock');}

  function fire(id,event,extra={}){const e=get(id);e.events[event]?.({target:e,preventDefault(){},...extra});}
  function frame(stamp){frameStamp=stamp;for(const [id,f] of [...frames]){frames.delete(id);f(stamp);}}
  function same(a,b){return a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));}
  check(get('playStep').value==='month'&&get('playDelay').value==='7','HTML defaults to monthly manual steps and seven civil days per playback second');get('leftMode').value='birth';
  check(A.state.initialized,'app initialized');check(get('export').disabled,'pending output cannot export');
  observers[0].setVisible(false);
  check(!A.state.stageSeen&&A.state.autoRotate&&!frames.size&&!!A.state.debounce,'initial below-fold observer preserves both automatic preference and queued first computation');
  const startupWorker=await scheduled();observers[0].setVisible(false);
  check(A.state.activeJob?.type==='compute'&&!startupWorker.terminated,'initial below-fold observer also preserves the first computation after its worker starts');
  await run();await A.ready;
  check(A.state.presetId==='T02','default example T02');check(A.state.result.custom.length===27003,'9001 flow points');
  check(A.state.drawStats.left.count===9001&&A.state.drawStats.right.count===9001,'both panels draw actual points');
  observers[0].setVisible(false);
  check(!A.state.stageSeen&&A.state.autoRotate&&!A.state.rotationFrame&&!frames.size,'initially below the fold preserves automatic rotation preference while suspending frames');
  observers[0].setVisible(true);
  check(A.state.stageSeen&&A.state.autoRotate&&frames.size===1,'first appearance in view starts one automatic rotation loop');
  const initial=A.state.result.custom.slice();
  get('leftMode').value='noDayun';fire('leftMode','change');check(A.state.leftMode==='noDayun'&&get('leftTitle').textContent==='去大运流盘','explicit dayun ablation');
  check(same(initial,A.state.result.custom),'reference selector preserves current flow');get('leftMode').value='birth';fire('leftMode','change');
  for(let i=0;i<5;i++){
    check(get('enabled'+i).attributes.type==='checkbox'&&get('strength'+i).attributes.type==='range','native layer controls '+i);
    get('enabled'+i).checked=false;fire('enabled'+i,'change');check(!A.state.enabled[i]&&get('strength'+i).disabled,'checkbox disables only its layer '+i);await run();
    get('enabled'+i).checked=true;fire('enabled'+i,'change');await run();check(same(initial,A.state.result.custom),'restoring layer restores exact output '+i);
    get('strength'+i).value='2';fire('strength'+i,'input');check(A.state.multipliers[i]===2,'strength handler '+i);
    get('strength'+i).value='1';fire('strength'+i,'input');await run();
  }
  for(let i=0;i<5;i++)A.setLayer(i,false,1);await run();check(same(A.state.result.custom,A.state.result.baseline),'all-off actual trajectories identical');
  get('resetLayers').click();await run();check(same(initial,A.state.result.custom),'reset recovers original flow');
  const birth=A.state.chart.birthMs;get('timeline').value='0';fire('timeline','input');await run();
  check(A.state.epochMs===birth&&!A.state.temporal.dayun.active,'timeline exact birth');check(get('enabled0').disabled&&get('budget0').textContent.includes('0.00'),'prestart dayun control and budget zero');
  const first=A.state.chart.dayun.firstStartMs;A.setTime(first);await run();check(A.state.temporal.dayun.step===1&&!get('enabled0').disabled,'first dayun activates exactly');
  A.setTime(Date.parse('2020-01-02T03:04:05+08:00'));await run();check(get('targetTime').value==='2020-01-02T03:04:05','target retains seconds');
  const before=A.state.epochMs;check(!A.setTime(birth-1)&&A.state.epochMs===before,'out-of-range time rejected');A.setTime(before);await run();
  // A new date invalidates current output; late worker messages cannot relabel it.
  A.setLayer(0,true,1.2);const stale=await scheduled(),staleQ=stale.request;
  A.setLayer(0,true,1.8);const current=await scheduled();check(stale.terminated&&get('export').disabled&&!A.state.result,'old work aborted and stale plot removed');
  stale.emit({id:staleQ.id,type:'progress',progress:{fraction:1}});check(A.state.activeJob.id===current.request.id,'late progress ignored');
  stale.emit({id:staleQ.id,type:'result',result:{wrong:true}});check(!A.state.result,'late result ignored');await finish(current);check(A.state.multipliers[0]===1.8&&A.snapshot().validComputedResult,'latest state commits');
  // Unknown birth is genuinely mapped and labelled as an uncalibrated preview.
  get('birthDate').value='1991-03-08';get('birthTime').value='11:37:28';get('gender').value='female';fire('birthForm','submit');
  check(!A.state.result&&!A.state.natal,'new birth clears both prior curves');await run();
  check(A.state.chart.birth==='1991-03-08T11:37:28'&&!A.state.presetId,'form uses actual supplied birth');
  check(A.state.profile.status==='uncalibrated_preview'&&get('profileState').textContent.includes('尚未校准'),'unknown preview is honest');
  check(A.state.chart.pillars.join(' ')==='辛未 辛卯 丁丑 丙午','own four pillars');
  const originalProfile=A.state.profile;get('calibrate').click();const cw=workers.at(-1),cq=cw.request;
  check(A.state.calibrating&&get('timeline').disabled&&!get('cancelCalibration').hidden,'calibration locks time but exposes cancel');
  cw.emit({id:cq.id,type:'progress',progress:{fraction:.5,completed:378,total:756}});check(get('computeProgress').value===.5,'calibration progress visible');
  get('cancelCalibration').click();check(!A.state.calibrating&&cw.terminated&&A.state.profile===originalProfile&&A.state.profiles.size===0,'cancel preserves preview; no partial profile cached');
  // Complete the real numerical calibration, then deliver it through the actual UI handler.
  get('calibrate').click();const done=workers.at(-1),calibrated=await M.calibrate(done.request.payload.chart),profile=calibrated.profile;
  check(calibrated.completed===756,'all calibration trajectories complete');done.emit({id:done.request.id,type:'result',result:calibrated});await run();
  check(A.state.profile.status==='calibrated_fallback_v08'&&A.state.profiles.get(A.state.chart.key)?.id===profile.id,'complete calibration uses explicit fallback and birth cache');
  check(get('profileState').textContent.includes('保留 v0.8'),'fallback not mislabeled as new driver');
  // Continuous playback appends ODE samples to a rolling tail, never replaces a frame with an independent frozen attractor.
  A.setAutoRotate(false);A.setTime(Date.parse('2020-01-02T03:04:05+08:00'));await run();
  const birthReference=A.state.natal,birthBytes=birthReference.slice(),seed=A.state.result.custom.slice(),seedEpoch=A.state.epochMs;
  get('leftMode').value='noDayun';fire('leftMode','change');A.startPlayback();
  check(A.state.playbackDaysPerSecond===7&&A.state.playing,'continuous playback starts at seven days per second');
  check(A.state.leftMode==='birth'&&get('leftMode').disabled,'continuous playback fixes the left reference to the natal core');
  check(A.state.activeJob?.type==='stream-start'&&same(A.state.result.custom,seed),'starting a stream retains the completed right-hand plot');
  const sw=workers.at(-1),sq=sw.request;await finishStream(sw,sq);
  const streamId=sq.payload.sessionId,starts=startCount();
  check(A.state.stream?.id===streamId&&A.state.epochMs===seedEpoch,'stream starts at the selected date without resetting it');
  const advances=advanceCount();for(let i=0;i<5;i++)frame(frameStamp+40);
  check(A.state.epochMs===seedEpoch&&same(A.state.result.custom,seed),'buffering never blanks the plot or skips civil time');
  check(advanceCount()===advances,'only one advance may be in flight while buffering');
  const firstAdvance=sw.request;check(firstAdvance.type==='stream-advance'&&firstAdvance.payload.sessionId===streamId,'prefetch continues the same worker session');
  const firstFrame=await finishStream(sw,firstAdvance);
  check(A.state.epochMs===seedEpoch,'arriving data does not jump the visible clock outside a playback frame');
  check(!A.state.busy&&get('calibrate').disabled,'calibration remains disabled while playing even between numerical batches');
  await presentBuffered();
  const appended=Math.round(firstAdvance.payload.modelDuration/.01);
  check(same(seed.subarray(appended*3),A.state.result.custom.subarray(0,seed.length-appended*3)),'successive frames retain the exact overlapping tail instead of interpolating whole images');
  check(A.state.epochMs===firstFrame.epochMs&&same(A.state.result.custom,firstFrame.points),'visible civil time and trajectory come from the same numerical frame');
  check(A.state.natal===birthReference&&same(A.state.natal,birthBytes),'natal reference keeps its exact array and all xyz values throughout playback');
  check(renderCalls.filter(x=>x.id==='natalCanvas').at(-1).points===birthReference&&renderCalls.filter(x=>x.id==='flowCanvas').at(-1).points===A.state.result.custom,'the renderer receives the fixed natal core beside the current continuous tail');
  check(/continuous/.test(A.state.result.protocol.type),'flow declares continuous rather than frozen-date semantics');
  check(JSON.stringify(A.state.result.parameters)===JSON.stringify(firstFrame.parameters),'displayed parameters are actually applied dynamic parameters');
  const pausedEpoch=A.state.epochMs,pausedPoints=A.state.result.custom.slice(),pendingAdvance=sw.request;
  check(pendingAdvance.type==='stream-advance','next numerical batch is prefetched');A.pause();
  check(!A.state.playing&&!sw.terminated,'pausing retains the live numerical session');
  check(get('calibrate').disabled,'calibration is disabled while the paused in-flight packet is unfinished');
  const readyWhilePaused=await finishStream(sw,pendingAdvance),requestsAfterPause=advanceCount();
  check(!get('calibrate').disabled,'calibration becomes available when a paused packet has completed');
  for(let i=0;i<5;i++)frame(frameStamp+40);
  check(A.state.epochMs===pausedEpoch&&same(A.state.result.custom,pausedPoints),'an in-flight reply cannot advance the paused visible state');
  check(advanceCount()===requestsAfterPause,'a paused stream does not recursively prefetch');
  A.startPlayback();check(startCount()===starts,'resume reuses its session instead of warming up a new attractor');check(get('calibrate').disabled,'resume immediately locks calibration before its buffered frame is consumed');await presentBuffered();
  check(A.state.epochMs===readyWhilePaused.epochMs&&same(A.state.result.custom,readyWhilePaused.points),'resume presents the exact next buffered continuation');
  A.pause();get('playDelay').value='30';fire('playDelay','change');
  check(A.state.playbackDaysPerSecond===30,'continuous playback speed is adjustable');
  const continuousExport=A.snapshot();
  check(continuousExport.reference.type==='birth'&&/continuous/.test(continuousExport.protocol.type),'continuous export identifies the fixed natal reference and nonautonomous protocol');
  check(JSON.stringify(continuousExport.flowParameters)===JSON.stringify(A.state.result.parameters),'continuous export contains the displayed applied parameters');
  check(continuousExport.continuous?.seedPoints?.length===27003&&continuousExport.continuous?.current?.points?.length===27003&&continuousExport.continuous?.current?.checkpoint,'continuous export preserves seed, current tail and checkpoint');
  check(continuousExport.continuous.modelUnitsPerCivilDay===8/7&&Array.isArray(continuousExport.continuous.replay),'export records the fixed civil/model clock ratio and replay batches');
  check(continuousExport.continuous.replay.reduce((n,p)=>n+p.count,0)===2&&continuousExport.continuous.replay.reduce((n,p)=>n+p.count*p.civilDurationMs,0)===A.state.epochMs-seedEpoch,'replay includes only the two displayed batches, excluding pending work');
  get('export').click();check(downloads.length===1,'continuous session can be downloaded while a later packet is in flight');
  const downloadedContinuous=JSON.parse(await blobs.get(downloads[0].url).text());
  check(downloadedContinuous.validComputedResult&&downloadedContinuous.continuous.current.epochMs===A.state.epochMs&&same(downloadedContinuous.continuous.current.points,A.state.result.custom),'downloaded JSON retains the exact displayed continuous tail and date');
  check(JSON.stringify(downloadedContinuous.flowParameters)===JSON.stringify(A.state.result.parameters)&&downloadedContinuous.protocol.continuedHistoricalState===true&&downloadedContinuous.protocol.continuedFromBirth===false,'download records applied parameters and true session provenance without implying complete life history');
  const staleStreamRequest=sw.request,staleStreamPoints=A.state.result.custom;
  const seekedStreamEpoch=A.state.epochMs;A.setTime(seekedStreamEpoch);
  check(!A.state.stream&&sw.terminated,'manual seeking discards the old continuous session even at the same selected date');await run();
  check(A.state.result.protocol.type==='frozen-date-counterfactual','manual review recomputes its frozen protocol instead of returning a cached continuous tail');
  const soughtPoints=A.state.result.custom,soughtEpoch=A.state.epochMs;
  sw.emit({id:staleStreamRequest.id,type:'result',result:{sessionId:streamId,points:staleStreamPoints,epochMs:seedEpoch}});
  check(A.state.result.custom===soughtPoints&&A.state.epochMs===soughtEpoch,'a previous continuous reply cannot replace a manually sought result');
  get('playDelay').value='7';fire('playDelay','change');
  A.setTime(Date.parse('2020-01-31T03:04:05+08:00'));await run();get('nextTime').click();await run();
  check(A.state.epochMs===Date.parse('2020-02-29T03:04:05+08:00'),'monthly next step clamps to leap month end');
  get('prevTime').click();await run();check(A.state.epochMs===Date.parse('2020-01-29T03:04:05+08:00'),'monthly previous step preserves valid current day and seconds');
  get('playStep').value='year';fire('playStep','change');A.setTime(Date.parse('2020-02-29T03:04:05+08:00'));await run();
  get('prevTime').click();await run();check(A.state.epochMs===Date.parse('2019-02-28T03:04:05+08:00'),'year step clamps leap day');
  get('playStep').value='day';fire('playStep','change');const dayStart=A.state.epochMs;get('nextTime').click();await run();
  check(A.state.epochMs===dayStart+86400000,'daily step moves one civil day');
  get('playStep').value='hour';fire('playStep','change');const hourStart=A.state.epochMs;get('nextTime').click();await run();
  check(A.state.epochMs===hourStart+7200000,'hour step moves one two-hour shichen');
  A.setTime(A.state.chart.birthMs);await run();get('prevTime').click();await run();check(A.state.epochMs===A.state.chart.birthMs,'previous step cannot go before birth');
  A.setTime(A.state.nowMs);await run();get('nextTime').click();await run();check(A.state.epochMs===A.state.nowMs,'next step cannot go after now');
  A.setTime(A.state.nowMs-1000);await run();A.startPlayback();const endWorker=workers.at(-1);await finishStream(endWorker,endWorker.request);
  const finalRequest=endWorker.request;check(finalRequest.type==='stream-advance'&&finalRequest.payload.civilDurationMs===1000,'last partial numerical batch is clamped exactly to now');
  const finalFrame=await finishStream(endWorker,finalRequest);await presentBuffered();
  check(A.state.epochMs===A.state.nowMs&&!A.state.playing&&finalFrame.epochMs===A.state.nowMs,'continuous playback reaches now without overshooting or requesting another batch');

  // The two 3D views rotate the same camera; the stored numerical trajectory and time do not change.
  get('autoRotate').checked=true;fire('autoRotate','change');get('rotationSpeed').value='6';fire('rotationSpeed','input');
  const fixedEpoch=A.state.epochMs,fixedKey=A.requestKey(),fixedCount=A.state.completedComputations,natalPoints=A.state.natal.slice(),flowPoints=A.state.result.custom.slice(),azimuth=A.state.camera.azimuth;
  check(A.state.autoRotate&&A.state.rotationSpeed===6&&frames.size===1,'one automatic rotation loop at six degrees per second');
  frame(1000);for(let i=1;i<=20;i++)frame(1000+i*50);
  check(Math.abs(A.state.camera.azimuth-azimuth-6)<1e-8,'camera rotation follows elapsed seconds rather than frame count');
  const highRateDraws=renderCalls.length,highRateAzimuth=A.state.camera.azimuth;
  for(let i=1;i<=100;i++)frame(2000+i*10);
  check(renderCalls.length-highRateDraws<=64,'high refresh displays do not redraw both canvases more than about thirty times per second');
  check(Math.abs(A.state.camera.azimuth-highRateAzimuth-6)<0.25,'rotation speed remains stable on high refresh displays');
  check(A.state.epochMs===fixedEpoch&&A.requestKey()===fixedKey&&A.state.completedComputations===fixedCount,'camera animation changes neither observation date nor computation');
  check(same(A.state.natal,natalPoints)&&same(A.state.result.custom,flowPoints),'3D view preserves all original xyz samples');
  const drawnLeft=renderCalls.filter(x=>x.id==='natalCanvas').at(-1),drawnRight=renderCalls.filter(x=>x.id==='flowCanvas').at(-1);
  check(JSON.stringify(drawnLeft.camera)===JSON.stringify(drawnRight.camera)&&drawnLeft.projection===drawnRight.projection&&drawnLeft.zoom===drawnRight.zoom,'left and right use the identical camera and world scale');
  check(A.state.drawStats.left.perspective&&A.state.drawStats.right.perspective,'both plots use the true perspective renderer');
  const draggedAz=A.state.camera.azimuth;fire('natalCanvas','pointerdown',{button:0,clientX:20,clientY:40,pointerId:1});
  fire('natalCanvas','pointermove',{clientX:70,clientY:60,pointerId:1});fire('natalCanvas','pointerup',{pointerId:1});
  check(!A.state.autoRotate&&!get('autoRotate').checked&&!frames.size,'manual drag pauses automatic rotation');
  check(A.state.camera.azimuth!==draggedAz&&A.state.epochMs===fixedEpoch,'drag changes shared view without changing time');
  get('autoRotate').checked=true;fire('autoRotate','change');check(frames.size===1,'automatic rotation can resume');
  A.setTime(A.state.chart.birthMs);await run();A.startPlayback();
  const visibilityWorker=workers.at(-1);await finishStream(visibilityWorker,visibilityWorker.request);
  check(observers.length===1,'one visibility observer watches the visualization');
  const offscreenEpoch=A.state.epochMs,offscreenPoints=A.state.result.custom,offscreenRequest=visibilityWorker.request;
  observers[0].setVisible(false);
  check(!A.state.playing&&!A.state.playFrame&&!A.state.rotationFrame&&!frames.size,'offscreen plot stops both animation loops');
  const offscreenResult=await finishStream(visibilityWorker,offscreenRequest);
  check(A.state.epochMs===offscreenEpoch&&A.state.result.custom===offscreenPoints,'an offscreen numerical reply does not change the paused frame');
  observers[0].setVisible(true);check(!frames.size&&!A.state.playing&&!A.state.autoRotate,'returning onscreen waits for explicit playback and camera restart');
  A.startPlayback();await presentBuffered();
  check(A.state.epochMs===offscreenResult.epochMs&&A.state.stream.id===offscreenResult.sessionId,'onscreen resume continues its preserved numerical session');
  get('autoRotate').checked=true;fire('autoRotate','change');
  const hiddenEpoch=A.state.epochMs,hiddenPoints=A.state.result.custom,hiddenRequest=visibilityWorker.request;
  document.hidden=true;docEvents.visibilitychange();check(!A.state.playing&&!A.state.playFrame&&!A.state.rotationFrame&&!frames.size,'hidden page stops both animation loops');
  await finishStream(visibilityWorker,hiddenRequest);
  check(A.state.epochMs===hiddenEpoch&&A.state.result.custom===hiddenPoints,'hidden in-flight results remain buffered rather than changing the view');
  document.hidden=false;docEvents.visibilitychange();check(!frames.size&&!A.state.playing,'returning to page does not restart either animation');
  get('autoRotate').checked=true;fire('autoRotate','change');check(frames.size===1,'camera rotation can be restarted after tab visibility returns');
  A.setLayer(4,true,1.1);check(!A.state.stream&&visibilityWorker.terminated,'changing a layer abandons the previous numerical session');const reducedWorker=await scheduled();media.change({matches:true});
  check(A.state.activeJob?.type==='compute'&&!reducedWorker.terminated,'switching to reduced motion preserves the current static-result computation');await run();
  A.startPlayback();check(!A.state.playing&&get('play').disabled&&!A.state.rotationFrame&&!frames.size,'reduced motion disables both automatic animations');
  media.change({matches:false});get('autoRotate').checked=true;fire('autoRotate','change');check(frames.size===1,'explicitly enabling rotation after reduced motion keeps a single loop');
  get('zoom').value='1.5';fire('zoom','input');check(A.state.zoom===1.5,'shared zoom');get('resetView').click();check(A.state.zoom===1,'reset shared camera');
  get('leftMode').value='noDayun';fire('leftMode','change');
  get('export').click();check(downloads.length===2,'frozen settings file download');const exported=JSON.parse(await blobs.get(downloads.at(-1).url).text());
  check(exported.birth.birth===A.state.chart.birth&&exported.epochMs===A.state.epochMs&&exported.validComputedResult,'export binds actual birth/date/result');
  check(exported.protocol.continuedHistoricalState===false,'export carries frozen-date semantics');
  check(exported.leftMode==='noDayun'&&exported.reference,'export identifies left comparison');
  check(exported.animation&&exported.animation.daysPerSecond===A.state.playbackDaysPerSecond&&exported.animation.rotationDegreesPerSecond===A.state.rotationSpeed&&exported.animation.autoRotate===A.state.autoRotate,'export preserves the continuous viewing speed and camera settings');
  A.submitBirth({birth:'2001-02-29T01:00:00',gender:'male'});check(!A.state.chart&&!A.state.result&&get('export').disabled&&!get('error').hidden,'invalid birth cannot retain a mislabeled old result');
  A.submitBirth(M.examples[1]);await run();check(A.state.profile.key!==profile.key,'another birth cannot borrow calibrated profile');
  A.setLayer(2,true,1.7);const ew=await scheduled();ew.emit({id:ew.request.id,type:'error',error:'Simulated numerical failure'});
  check(A.state.error&&get('export').disabled&&!A.state.result,'numerical errors do not export');get('resetLayers').click();await run();
  check(drawCalls>100000,'real trajectory coordinates sent to Canvas API');A.cancel();
  get('autoRotate').checked=true;fire('autoRotate','change');A.calibrate();winEvents.pagehide();
  check(A.state.disposed&&!A.state.playing&&!A.state.rotationFrame&&!frames.size&&!A.state.worker,'pagehide releases timers, renderer loop and worker');
  winEvents.pageshow();check(!A.state.disposed&&!get('timeline').disabled&&get('cancelCalibration').hidden,'returning from navigation restores controls after an interrupted calibration');
  check(!A.state.autoRotate&&!A.state.playing&&!frames.size,'history return keeps the stable view without restarting motion');
  A.setTime(A.state.chart.birthMs+86400000);await run();A.startPlayback();const navWorker=workers.at(-1);await finishStream(navWorker,navWorker.request);
  await finishStream(navWorker,navWorker.request);await presentBuffered();
  const navEpoch=A.state.epochMs,navPoints=A.state.result.custom,navId=A.state.stream.id,navRequest=navWorker.request;
  winEvents.pagehide();check(A.state.stream?.detached&&navWorker.terminated&&A.state.result.custom===navPoints,'navigation releases its worker while preserving the last displayed continuous tail');
  await finishStream(navWorker,navRequest);check(A.state.epochMs===navEpoch&&A.state.result.custom===navPoints,'late navigation replies cannot replace the preserved last frame');
  winEvents.pageshow();check(!A.state.playing&&!frames.size&&A.snapshot().continuous.detached,'history return exposes a stopped session and does not secretly resume it');
  A.startPlayback();const restartedWorker=await scheduled();if(A.state.activeJob?.type==='compute')await finish(restartedWorker);
  check(A.state.activeJob?.type==='stream-start'&&A.state.stream.id!==navId&&A.state.stream.startEpochMs===navEpoch,'explicit playback after navigation establishes a new labelled session at the retained date');
  await finishStream(restartedWorker,restartedWorker.request);A.pause();await finishStream(restartedWorker,restartedWorker.request);
  A.calibrate();check(A.state.calibrating&&restartedWorker.terminated&&A.state.stream.detached,'calibration abandons the live worker and marks its preserved continuous frame as detached');
  A.cancelCalibration();const previousChart=A.state.chart.key;A.submitBirth(M.examples[0]);
  check(A.state.chart.key!==previousChart&&!A.state.stream&&!A.state.result&&!A.state.natal,'a new birth discards every previous session and both prior plots');await run();
  console.log(JSON.stringify({uiChecks:checks,drawCalls,workerInstances:workers.length,boundary:'Node DOM/Canvas stubs and real numeric results; not browser layout/native UI/security verification.'}));
});
