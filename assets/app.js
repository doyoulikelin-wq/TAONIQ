/* TAONIQ: one transaction connects chart, date, controls, labels and trajectories.
 * Model integration runs only in the bundled local Worker. No image morphing.
 * A: fixed natal parameters (or the same date with dayun disabled); B: all
 * enabled temporal layers. Both share projection, camera and world scale.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const MODEL = window.TaoModel;
  const NAMES = ['大运', '流年', '流月', '流日', '流时'];
  const OFFSET = 28800000;
  const DEFAULT_CAMERA = {azimuth: -72, elevation: 18};
  const reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : {matches:false,addEventListener(){}};
  const state = {
    chart: null, profile: null, temporal: null, epochMs: 0, nowMs: Date.now(),
    enabled: [true,true,true,true,true], multipliers: [1,1,1,1,1], windowDays: 90,
    result: null, resultKey: null, natal: null, natalMorphology: null,
    leftMode: 'birth', zoom: 1, camera: {...DEFAULT_CAMERA},
    worker: null, activeJob: null, revision: 0, busy: false, calibrating: false,
    playing: false, playTimer: null, debounce: null, error: null, initialized: false,
    reducedMotion: reduced.matches, cache: new Map(), profiles: new Map(), presetId: null,
    drawStats: {left: null,right:null}, completedComputations: 0
  };
  let resolveReady;
  const ready = new Promise(r => {resolveReady = r;});
  const idleWaiters = [];
  function iso(ms) { return new Date(ms + OFFSET).toISOString().slice(0,19); }
  function labelTime(ms) {return iso(ms).replace('T',' ');}
  function setText(id, text) {const n=$(id);if(n)n.textContent=text;}
  function setStatus(text, fraction, count) {
    setText('statusText',text);if(fraction!==undefined)$('computeProgress').value=Math.max(0,Math.min(1,fraction));
    if(count!==undefined)setText('statusCount',count);
  }
  function reportError(error) {
    const message = error && error.message ? error.message : String(error);
    state.error=message;$('error').hidden=false;setText('error',message);
    setStatus('计算已停止，请检查输入或当前设置。',0,'');
    state.playing=false;clearTimeout(state.playTimer);state.playTimer=null;renderPlay();
  }
  function clearError(){state.error=null;$('error').hidden=true;setText('error','');}
  function notifyIdle() {
    if(!state.busy && !state.debounce){while(idleWaiters.length)idleWaiters.shift()(state.result);}
  }
  function whenIdle(){if(!state.busy&&!state.debounce)return Promise.resolve(state.result);return new Promise(r=>idleWaiters.push(r));}
  function requestKey(){return JSON.stringify({birth:state.chart?.input,params:state.chart?.parameters,profile:{id:state.profile?.id,protocol:state.profile?.protocol,status:state.profile?.status,source:state.profile?.source,key:state.profile?.key,candidate:state.profile?.candidate},epochMs:state.epochMs,enabled:state.enabled,multipliers:state.multipliers,windowDays:state.windowDays});}
  function ensureWorker(){
    if(!state.worker){
      state.worker=window.TaoWorker.create();
      state.worker.onmessage=onWorkerMessage;
      state.worker.onerror=e=>{const job=state.activeJob;if(!job)return;state.activeJob=null;state.busy=false;state.calibrating=false;reportError(e.message||'本地计算线程异常');syncControls();notifyIdle();resolveReady(false);};
    }
    return state.worker;
  }
  function cancelJob(reason, keepCalibrationState){
    state.revision++;clearTimeout(state.debounce);state.debounce=null;
    if(state.activeJob && state.worker){state.worker.terminate();state.worker=null;}
    state.activeJob=null;state.busy=false;
    if(!keepCalibrationState)state.calibrating=false;
    if(reason)setStatus(reason,0,'');
  }
  function invalidateFlow(){
    state.result=null;state.resultKey=null;
    $('flowEmpty').hidden=false;setText('rightMetric','—');setText('rightDetail','选定时刻独立计算');
    $('export').disabled=true;renderParameters();draw();
  }
  function queueCompute(delay){
    if(!state.chart)return;
    cancelJob();invalidateFlow();clearError();syncControls();
    setStatus('准备计算当前时间与设置…',0,'');
    const revision=state.revision;
    state.debounce=setTimeout(()=>{state.debounce=null;if(revision!==state.revision)return;compute();},delay===undefined?90:delay);
  }
  function compute(){
    if(!state.chart)return;
    const key=requestKey(), cached=state.cache.get(key);
    if(cached){applyResult(cached,key);setStatus('当前设置已计算 · 本页缓存',1,'9,001 POINTS / VIEW');notifyIdle();schedulePlayback();return;}
    state.busy=true;state.calibrating=false;const id=++state.revision;
    state.activeJob={id,type:'compute',key,chartKey:state.chart.key,started:Date.now(),lastProgress:0};
    syncControls();setStatus('正在积分 · 生辰核与流盘使用相同观测协议',0,'');
    try{ensureWorker().postMessage({id,type:'compute',payload:{chart:state.chart,epochMs:state.epochMs,enabled:state.enabled.slice(),multipliers:state.multipliers.slice(),windowDays:state.windowDays,profile:state.profile}});}catch(e){state.activeJob=null;state.busy=false;reportError(e);syncControls();notifyIdle();resolveReady(false);}
  }
  function onWorkerMessage(event){
    const data=event.data,job=state.activeJob;
    if(!job||data.id!==job.id||job.chartKey!==state.chart?.key)return;
    if(data.type==='progress'){
      const p=data.progress||{};$('computeProgress').value=p.fraction||0;
      if(Date.now()-job.lastProgress>700||p.fraction===1){job.lastProgress=Date.now();setStatus(job.type==='calibrate'?'校准中 · 同一套 756 条件比较 9 种映射':(p.phase||'轨迹积分'),p.fraction,p.total?`${p.completed} / ${p.total}`:`${Math.round((p.fraction||0)*100)}%`);}
      return;
    }
    state.activeJob=null;state.busy=false;state.calibrating=false;
    if(data.type==='error'){
      reportError(data.error);syncControls();notifyIdle();resolveReady(false);return;
    }
    if(data.type!=='result'){reportError('计算返回了无法识别的消息');syncControls();notifyIdle();resolveReady(false);return;}
    if(job.type==='calibrate'){
      const result=data.result;
      if(result.profile?.key!==state.chart.key){reportError('校准结果与当前生辰不一致，未应用。');syncControls();notifyIdle();return;}
      state.profile=result.profile;state.profiles.set(state.chart.key,result.profile);
      state.chart.profile=result.profile;renderProfile();queueCompute(0);return;
    }
    // A result is accepted only if the entire submitted input still matches.
    if(job.key!==requestKey()){notifyIdle();return;}
    state.cache.set(job.key,data.result);while(state.cache.size>18)state.cache.delete(state.cache.keys().next().value);
    applyResult(data.result,job.key);
    setStatus('计算完成 · 形态是数值模拟结果',1,`${(data.result.custom.length/3).toLocaleString()} POINTS / VIEW`);
    notifyIdle();resolveReady(true);schedulePlayback();
  }
  function applyResult(result,key){
    state.result=result;state.resultKey=key;state.natal=result.baseline;state.natalMorphology=result.morphology.birth;
    state.profile=result.profile;state.temporal=result.temporal;state.completedComputations++;
    renderProfile();renderContext();renderParameters();draw();syncControls();
  }
  function submitBirth(input,presetId){
    pausePlayback(false);cancelJob();clearError();state.result=null;state.resultKey=null;state.natal=null;state.natalMorphology=null;
    state.chart=null;state.temporal=null;state.profile=null;state.presetId=null;
    clearChartReadout();draw();
    try{
      state.nowMs=Date.now();const chart=MODEL.chart(input);state.chart=chart;
      state.profile=state.profiles.get(chart.key)||chart.profile;
      state.presetId=presetId||MODEL.examples.find(e=>e.birth===chart.birth&&e.gender===chart.gender)?.id||null;
      state.epochMs=state.nowMs;state.temporal=MODEL.temporal(chart,state.epochMs);
      $('birthDate').value=chart.birth.slice(0,10);$('birthTime').value=chart.birth.slice(11);$('gender').value=chart.gender;
      state.enabled=[true,true,true,true,true];state.multipliers=[1,1,1,1,1];
      renderBirth();renderProfile();renderContext();syncControls();queueCompute(0);
      return chart;
    }catch(e){reportError(e);syncControls();notifyIdle();resolveReady(false);return null;}
  }
  function clearChartReadout(){
    setText('chartCode','待排盘');setText('profileState','等待有效生辰');setText('profileDetail','');
    $('natalPillars').innerHTML=['年','月','日','时'].map(x=>`<span>${x}<b>—</b></span>`).join('');$('elements').innerHTML='';
    setText('leftMetric','—');setText('rightMetric','—');setText('birthLabel','出生');setText('ageLabel','—');setText('dayunDescription','大运起点与顺逆随生辰计算。');
    setText('profileDot','');$('profileDot').classList.remove('ready');$('domainNote').hidden=true;
    if(MODEL)MODEL.examples.forEach(e=>$('preset'+e.id)?.setAttribute('aria-pressed','false'));
    NAMES.forEach((_,i)=>setText('pillar'+i,'—'));renderParameters();
  }
  function renderBirth(){
    const c=state.chart;if(!c)return;
    setText('chartCode',state.presetId?`${state.presetId} / ${c.anchorId}`:`${c.anchorId} / 自定义`);
    $('natalPillars').innerHTML=c.pillars.map((p,i)=>`<span>${['年','月','日','时'][i]}<b>${p}</b></span>`).join('');
    $('elements').innerHTML=['金','木','水','火','土'].map(e=>`<span class="element">${e}<b>${c.visibleWuxing[e]}</b><i style="--amount:${100*c.visibleWuxing[e]/8}%"></i></span>`).join('');
    MODEL.examples.forEach(e=>$('preset'+e.id).setAttribute('aria-pressed',String(e.id===state.presetId)));
    const example=MODEL.examples.find(e=>e.id===state.presetId);
    setText('presetNote',example?`${example.id} · ${example.pairId} 对照组。每组两例包含五行总量相同、四柱结构不同的生辰。`:'自定义生辰 · 使用有序四柱编码，保留年、月、日、时的区别。');
    $('domainNote').hidden=!c.domainFallback;
    setText('domainNote',c.domainFallback?`参数域修复：最近区域 ${c.originalAnchorId} 不满足模型条件，使用最近的有效区域 ${c.anchorId}。这是公开的工程适配。`:'');
  }
  function renderProfile(){
    const p=state.profile;
    if(!p)return;
    const text=p.status==='uncalibrated_preview'?'v0.8 预览 · 此生辰尚未校准':p.status==='calibrated_fallback_v08'?'校准完成 · 保留 v0.8 映射':'校准完成 · 生辰专属映射';
    setText('profileState',state.calibrating?'正在校准 · 预览仍可查看':text);
    setText('profileDetail',p.status==='uncalibrated_preview'?'可先观察基础预览。校准将比较 756 个条件，可能需要数分钟；不会为单幅图临时换映射。':`${p.label||p.id}。同一生辰的方案固定；有限条件通过不保证任意时间都复杂。校准仅留在本页，导出可保存配置。`);
    $('profileDot').classList.toggle('ready',p.status!=='uncalibrated_preview');
    $('calibrate').textContent=p.status==='uncalibrated_preview'?'校准此生辰 · 756 条件':'重新校准 · 756 条件';
  }
  function renderContext(){
    if(!state.chart)return;
    const c=state.chart,t=MODEL.temporal(c,state.epochMs);state.temporal=t;
    $('targetTime').value=iso(state.epochMs);$('targetTime').min=iso(c.birthMs);$('targetTime').max=iso(state.nowMs);
    $('timeline').value=state.nowMs===c.birthMs?0:Math.round(10000*(state.epochMs-c.birthMs)/(state.nowMs-c.birthMs));
    $('timeline').setAttribute('aria-valuetext',labelTime(state.epochMs)+' 北京时间');
    setText('birthLabel',c.birth.slice(0,10)+' 出生');setText('nowLabel',iso(state.nowMs).slice(0,10)+' 至今');
    const age=(state.epochMs-c.birthMs)/(365.2425*86400000);setText('ageLabel',`${Math.max(0,age).toFixed(1)} 年 · UTC+08`);
    t.layers.forEach((layer,i)=>{setText('pillar'+i,layer.pillar||'未起运');$('pillar'+i).classList.toggle('inactive',!layer.active);});
    const d=c.dayun,a=d.startAge;let desc=`${d.direction==='forward'?'顺行':'逆行'} · ${a.years}年${a.months}月${a.days}天${a.hours}小时起运 · ${iso(d.firstStartMs).slice(0,10)}`;
    if(t.dayun.active)desc+=` ｜第 ${t.dayun.step} 步 ${t.dayun.pillar}大运`;else desc+=' ｜当前尚未起运，大运输入为零';
    setText('dayunDescription',desc);
    setText('rightDetail',iso(state.epochMs).slice(0,16).replace('T',' '));
    syncControls();
  }
  function syncControls(){
    const has=!!state.chart,cal=state.calibrating;
    ['targetTime','timeline','goNow','resetLayers'].forEach(id=>$(id).disabled=!has||cal);
    $('play').disabled=!has||cal||state.reducedMotion;
    $('calibrate').disabled=!has||state.busy||cal;
    $('cancelCalibration').hidden=!cal;
    $('export').disabled=!state.result||state.resultKey!==requestKey()||cal;
    NAMES.forEach((_,i)=>{
      const active=has&&(i!==0||state.temporal?.dayun.active);
      $('enabled'+i).checked=state.enabled[i];$('enabled'+i).disabled=!has||cal||!active;
      $('strength'+i).value=state.multipliers[i];$('strength'+i).disabled=!has||cal||!active||!state.enabled[i];
      $('strength'+i).setAttribute('aria-valuetext',NAMES[i]+'默认强度的'+state.multipliers[i].toFixed(2)+'倍');
      setText('value'+i,state.multipliers[i].toFixed(2)+'×');
      const w=MODEL?MODEL.weights[i]:0;setText('budget'+i,'输入 '+(100*w*(active&&state.enabled[i]?state.multipliers[i]:0)).toFixed(2)+' / 100');
    });
    renderPlay();
  }
  function morphologyText(m){
    if(!m)return '待计算';
    if(m.class==='near_fixed_point')return '接近定点';
    if(m.class==='near_periodic')return `近周期 · T≈${m.recurrence.period.toFixed(3)}`;
    if(m.class==='invalid_nonfinite')return '无效数值';
    return '未标记简单 · 非混沌证明';
  }
  function renderParameters(){
    const r=state.result,c=state.chart;
    if(!c){$('parameterTable').innerHTML='<p class="field-note">生成后显示。</p>';setText('technicalState','等待计算');return;}
    $('parameterTable').innerHTML='<table><thead><tr><th scope="col">参数</th><th scope="col">生辰核</th><th scope="col">流盘</th><th scope="col">去大运</th></tr></thead><tbody>'+MODEL.parameterOrder.map(k=>`<tr><th scope="row">${k}</th><td>${c.parameters[k].toFixed(6)}</td><td>${r?r.parameters[k].toFixed(6):'计算中'}</td><td>${r?r.noDayunParameters[k].toFixed(6):'计算中'}</td></tr>`).join('')+'</tbody></table>';
    setText('protocolNote','生辰进入八参数，初态固定为 (0.1, 0, 0)。各时点独立预热 600、观察 90 个模型时间单位，步长 0.0025；模型时间不是公历天数。未标记简单，不等于已证明混沌。');
    setText('technicalState',r?JSON.stringify({mappingProfile:{id:r.profile.id,status:r.profile.status,source:r.profile.source,eligibleCount:r.profile.eligibleCount},parameterDomain:{anchor:c.anchorId,originalAnchor:c.originalAnchorId,repaired:c.domainFallback},protocol:r.protocol,morphology:r.morphology},null,2):'等待当前时间与设置的计算结果。');
  }
  function drawOrbit(canvasId,points,color){
    const canvas=$(canvasId),rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width||320),h=Math.max(1,rect.height||300),dpr=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr))canvas.width=Math.round(w*dpr);if(canvas.height!==Math.round(h*dpr))canvas.height=Math.round(h*dpr);
    const ctx=canvas.getContext('2d');if(!ctx)return {clipped:0,count:0};
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    // Fixed reticle describes the instrument frame, not an additional trajectory.
    ctx.strokeStyle='#19362b';ctx.lineWidth=.6;
    for(let j=0;j<4;j++){const x=j%2?w-13:13,y=j<2?12:h-12;ctx.beginPath();ctx.moveTo(x-3,y);ctx.lineTo(x+3,y);ctx.moveTo(x,y-3);ctx.lineTo(x,y+3);ctx.stroke();}
    if(!points)return {clipped:0,count:0};
    const proj=MODEL.projection,center=proj.center,scale=state.zoom*.46*Math.min(w,h)/proj.radius;
    const az=state.camera.azimuth*Math.PI/180,el=state.camera.elevation*Math.PI/180;
    const right=[-Math.sin(az),Math.cos(az),0],up=[-Math.sin(el)*Math.cos(az),-Math.sin(el)*Math.sin(az),Math.cos(el)];
    const n=points.length/3;let clipped=0;
    function xy(i,count){const j=3*i,x=points[j]-center[0],y=points[j+1]-center[1],z=points[j+2]-center[2],px=w/2+scale*(x*right[0]+y*right[1]+z*right[2]),py=h/2-scale*(x*up[0]+y*up[1]+z*up[2]);if(count&&(px<0||px>w||py<0||py>h))clipped++;return [px,py];}
    ctx.lineWidth=.65;ctx.lineCap='round';ctx.lineJoin='round';
    for(let k=0;k<16;k++){const start=Math.floor((n-1)*k/16),end=Math.floor((n-1)*(k+1)/16);ctx.beginPath();ctx.moveTo(...xy(start,false));for(let i=start+1;i<=end;i++)ctx.lineTo(...xy(i,true));ctx.strokeStyle=`rgba(${color},${.25+.37*k/15})`;ctx.stroke();}
    const last=xy(n-1,false);ctx.beginPath();ctx.arc(last[0],last[1],1.6,0,Math.PI*2);ctx.fillStyle=`rgb(${color})`;ctx.fill();
    return {clipped,count:n};
  }
  function draw(){
    const r=state.result,birthMode=state.leftMode==='birth';const left=birthMode?state.natal:r?.noDayun;
    state.drawStats.left=drawOrbit('natalCanvas',left,'137,213,180');state.drawStats.right=drawOrbit('flowCanvas',r?.custom,'216,185,119');
    $('natalEmpty').hidden=!!left;$('flowEmpty').hidden=!!r;
    setText('leftTitle',birthMode?'生辰核':'去大运流盘');setText('leftBadge',birthMode?'固定八参数':'仅关闭大运');
    setText('leftDetail',birthMode?'生辰参数 · 固定初态':'同时间 · 其余四层不变');
    if(left){const m=birthMode?state.natalMorphology:r?.morphology.noDayun;setText('leftMetric',morphologyText(m));}
    if(r){setText('rightMetric',morphologyText(r.morphology.flow));setText('rightDetail',iso(state.epochMs).slice(0,16).replace('T',' '));}
    if(state.drawStats.left.clipped)setText('leftDetail',`视野外 ${state.drawStats.left.clipped} 点 · 可缩小`);
    if(state.drawStats.right.clipped)setText('rightDetail',`视野外 ${state.drawStats.right.clipped} 点 · 可缩小`);
    if(r){$('natalCanvas').setAttribute('aria-label',`${state.chart.pillars.join(' ')} ${birthMode?'生辰核':'去大运流盘'}，${morphologyText(birthMode?state.natalMorphology:r.morphology.noDayun)}`);$('flowCanvas').setAttribute('aria-label',`${labelTime(state.epochMs)} 的流盘，${morphologyText(r.morphology.flow)}`);}
  }
  function setTime(ms,fromPlayback){
    if(!state.chart)return false;
    if(!Number.isFinite(ms)||ms<state.chart.birthMs||ms>state.nowMs){reportError('观测时刻须位于出生到当前时间之间。');renderContext();return false;}
    if(!fromPlayback)pausePlayback(false);
    state.epochMs=Math.round(ms);renderContext();queueCompute(100);return true;
  }
  function setLayer(i,enabled,multiplier){
    if(!Number.isInteger(i)||i<0||i>4||typeof enabled!=='boolean'||!Number.isFinite(multiplier)||multiplier<0||multiplier>2)throw Error('无效的层级控制');
    pausePlayback(false);state.enabled[i]=enabled;state.multipliers[i]=multiplier;syncControls();queueCompute(90);
  }
  function renderPlay(){
    $('play').innerHTML=state.playing?'暂停 <span aria-hidden="true">Ⅱ</span>':'播放 <span aria-hidden="true">▷</span>';
    $('play').setAttribute('aria-pressed',String(state.playing));$('play').title=state.reducedMotion?'系统已启用减少动态效果；请手动拖动时间轴':'逐个时点独立计算流盘';
  }
  function pausePlayback(cancelComputation){
    state.playing=false;clearTimeout(state.playTimer);state.playTimer=null;renderPlay();
    if(cancelComputation&&(state.activeJob?.type==='compute'||state.debounce)){cancelJob('已暂停；当前时点尚未计算完成。');syncControls();notifyIdle();}
  }
  function nextEpoch(){
    const step=$('playStep').value,ms=state.epochMs;
    if(step==='year')return Math.min(state.nowMs,MODEL.addYears(ms,1));
    if(step==='month'){const d=new Date(ms+OFFSET),month=d.getUTCMonth()+1,year=d.getUTCFullYear()+Math.floor(month/12),m=month%12,last=new Date(Date.UTC(year,m+1,0)).getUTCDate();return Math.min(state.nowMs,Date.UTC(year,m,Math.min(d.getUTCDate(),last),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds())-OFFSET);}
    return Math.min(state.nowMs,ms+(step==='hour'?2*3600000:86400000));
  }
  function schedulePlayback(){
    clearTimeout(state.playTimer);state.playTimer=null;
    if(!state.playing||state.busy||document.hidden||state.reducedMotion)return;
    if(state.epochMs>=state.nowMs){pausePlayback(false);setStatus('已播放至今。',1,'');return;}
    state.playTimer=setTimeout(()=>{state.playTimer=null;if(!state.playing)return;setTime(nextEpoch(),true);},1100);
  }
  function startPlayback(){
    if(!state.chart||state.calibrating||state.reducedMotion)return;
    clearError();state.playing=true;renderPlay();
    if(state.epochMs>=state.nowMs)setTime(state.chart.birthMs,true);
    else if(!state.busy&&!state.result)queueCompute(0);
    else schedulePlayback();
  }
  function calibrate(){
    if(!state.chart||state.busy)return;
    pausePlayback(false);cancelJob();clearError();state.busy=true;state.calibrating=true;
    const id=++state.revision;state.activeJob={id,type:'calibrate',chartKey:state.chart.key,started:Date.now(),lastProgress:0};
    renderProfile();syncControls();setStatus('开始出生专属校准 · 756 条件，可能需要数分钟',0,'0 / 756');
    try{ensureWorker().postMessage({id,type:'calibrate',payload:{chart:state.chart}});}catch(e){state.activeJob=null;state.busy=false;state.calibrating=false;reportError(e);syncControls();notifyIdle();}
  }
  function cancelCalibration(){
    if(!state.calibrating)return;cancelJob('校准已停止 · 保留原有映射与预览。');renderProfile();syncControls();notifyIdle();
  }
  function snapshot(){
    return {product:'TAONIQ',algorithmVersion:MODEL?.version,exportedAt:new Date().toISOString(),birth:state.chart?.input,timezone:'UTC+08:00',pillars:state.chart?.pillars,observationTime:iso(state.epochMs),epochMs:state.epochMs,enabled:state.enabled.slice(),multipliers:state.multipliers.slice(),defaultInputBudgets:MODEL?.weights,leftMode:state.leftMode,reference:state.leftMode==='noDayun'?{type:'noDayun',meaning:'Same observation date and settings with only the dayun layer disabled.',enabled:[false,...state.enabled.slice(1)],parameters:state.result?.noDayunParameters}:{type:'birth',meaning:'Fixed natal eight parameters with all temporal layers absent.',parameters:state.chart?.parameters},temporal:state.temporal,birthParameters:state.chart?.parameters,flowParameters:state.result?.parameters,noDayunParameters:state.result?.noDayunParameters,profile:state.profile,domain:{repaired:state.chart?.domainFallback,anchor:state.chart?.anchorId,originalAnchor:state.chart?.originalAnchorId},projection:MODEL?.projection,camera:{...state.camera},zoom:state.zoom,protocol:state.result?.protocol,morphology:state.result?.morphology,validComputedResult:!!state.result&&state.resultKey===requestKey(),interpretation:'Engineering symbolic visualization; no fate prediction. Each date is independently integrated with frozen parameters, not accumulated history.'};
  }
  function exportSnapshot(){
    if(!state.result||state.resultKey!==requestKey())return null;
    const text=JSON.stringify(snapshot(),null,2),blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='TAONIQ_'+iso(state.epochMs).replace(/[:T]/g,'-')+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return text;
  }
  function makeControls(){
    $('presets').innerHTML=MODEL.examples.map(e=>`<button type="button" class="preset" id="preset${e.id}" aria-pressed="false" title="${e.pillars.join(' ')} · ${e.pairId}">${e.id}</button>`).join('');
    MODEL.examples.forEach(e=>$('preset'+e.id).addEventListener('click',()=>submitBirth({birth:e.birth,gender:e.gender},e.id)));
    $('layers').innerHTML=NAMES.map((name,i)=>`<div class="layer" id="layer${i}"><div class="layer-title"><label for="enabled${i}"><input id="enabled${i}" type="checkbox" checked>${name}</label><span class="mono">0${i+1}</span></div><span class="layer-pillar" id="pillar${i}">—</span><label class="sr-only" for="strength${i}">${name}作用强度</label><input id="strength${i}" type="range" min="0" max="2" step="0.05" value="1" aria-valuetext="默认强度的1倍"><div class="layer-value"><span>强度</span><output id="value${i}" for="strength${i}">1.00×</output></div><p class="budget" id="budget${i}">输入预算</p></div>`).join('');
    NAMES.forEach((_,i)=>{$('enabled'+i).addEventListener('change',()=>setLayer(i,$('enabled'+i).checked,state.multipliers[i]));$('strength'+i).addEventListener('input',()=>setLayer(i,state.enabled[i],Number($('strength'+i).value)));});
  }
  function bind(){
    $('birthForm').addEventListener('submit',e=>{e.preventDefault();submitBirth({birth:$('birthDate').value+'T'+($('birthTime').value.length===5?$('birthTime').value+':00':$('birthTime').value),gender:$('gender').value});});
    $('timeline').addEventListener('input',()=>setTime(Math.round(state.chart.birthMs+(state.nowMs-state.chart.birthMs)*Number($('timeline').value)/10000)));
    $('targetTime').addEventListener('change',()=>{const v=$('targetTime').value;setTime(Date.parse((v.length===16?v+':00':v)+'+08:00'));});
    $('goNow').addEventListener('click',()=>{state.nowMs=Date.now();setTime(state.nowMs);});
    $('play').addEventListener('click',()=>state.playing?pausePlayback(true):startPlayback());
    $('playStep').addEventListener('change',()=>pausePlayback(true));
    $('leftMode').addEventListener('change',()=>{state.leftMode=$('leftMode').value;draw();});
    $('zoom').addEventListener('input',()=>{state.zoom=Number($('zoom').value);$('zoom').setAttribute('aria-valuetext',state.zoom.toFixed(2)+'倍');setText('zoomValue',state.zoom.toFixed(2)+'×');draw();});
    $('resetView').addEventListener('click',()=>{state.camera={...DEFAULT_CAMERA};state.zoom=1;$('zoom').value=1;setText('zoomValue','1.00×');$('zoom').setAttribute('aria-valuetext','1 倍');draw();});
    $('resetLayers').addEventListener('click',()=>{pausePlayback(false);state.enabled=[true,true,true,true,true];state.multipliers=[1,1,1,1,1];syncControls();queueCompute(0);});
    $('calibrate').addEventListener('click',calibrate);$('cancelCalibration').addEventListener('click',cancelCalibration);$('export').addEventListener('click',exportSnapshot);
    ['natalCanvas','flowCanvas'].forEach(id=>{
      const cv=$(id);let drag=null;
      cv.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,az:state.camera.azimuth,el:state.camera.elevation};cv.setPointerCapture?.(e.pointerId);});
      cv.addEventListener('pointermove',e=>{if(!drag)return;state.camera.azimuth=drag.az+(e.clientX-drag.x)*.4;state.camera.elevation=Math.max(-89,Math.min(89,drag.el+(e.clientY-drag.y)*.35));draw();});
      function end(){drag=null;}cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);cv.addEventListener('lostpointercapture',end);
    });
    window.addEventListener('resize',draw);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){pausePlayback(false);if(state.activeJob||state.debounce){const wasCalibration=state.calibrating;cancelJob(wasCalibration?'页面已隐藏，校准已停止；返回后可重新开始。':'页面已隐藏，当前计算已停止。');renderProfile();syncControls();notifyIdle();}}});
    reduced.addEventListener?.('change',e=>{state.reducedMotion=e.matches;if(e.matches)pausePlayback(true);syncControls();});
    if(window.IntersectionObserver){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>!e.isIntersecting)&&state.playing)pausePlayback(true);},{threshold:0});observer.observe($('laboratory'));}
    window.addEventListener('pagehide',()=>{pausePlayback(false);cancelJob();if(state.worker){state.worker.terminate();state.worker=null;}});
  }
  window.TaoApp={state,ready,whenIdle,submitBirth,setTime,setLayer,startPlayback,pause:()=>pausePlayback(true),calibrate,cancelCalibration,snapshot,exportSnapshot,draw,requestKey,cancel:()=>{pausePlayback(false);cancelJob('计算已取消。');renderProfile();syncControls();notifyIdle();}};
  try{
    if(!MODEL||!window.TaoWorker)throw Error('算法资源未能加载，请保持 assets 文件夹与此页面同目录。');
    $('birthDate').min='1901-01-01';$('birthDate').max=iso(state.nowMs).slice(0,10);
    makeControls();bind();state.initialized=true;
    const initial=MODEL.examples.find(e=>e.id==='T02')||MODEL.examples[0];
    submitBirth({birth:initial.birth,gender:initial.gender},initial.id);
  }catch(e){reportError(e);resolveReady(false);}
})();
