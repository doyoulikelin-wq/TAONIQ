// Executes the delivered UI with DOM/Canvas/Worker stubs and real numerical results.
// This is deliberately not a browser, native input, layout or Blob-security test.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const M=require('../assets/model/model.js'),root=path.resolve(__dirname,'..');
test('UI transactions preserve birth, date, controls, reference, cancellation and export',async()=>{
  const els=new Map(),timers=new Map(),workers=[],blobs=new Map(),downloads=[],docEvents={},winEvents={};
  let seq=0,drawCalls=0,checks=0;
  const check=(v,m)=>{checks++;assert(v,m);};
  const ctx=new Proxy({},{get(o,k){return k in o?o[k]:(...args)=>{drawCalls++;assert(args.every(v=>typeof v!=='number'||Number.isFinite(v)),'finite Canvas coordinates');};},set(o,k,v){o[k]=v;return true;}});
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
  parse(fs.readFileSync(path.join(root,'index.html'),'utf8'));
  const get=id=>{assert(els.has(id),'real HTML element '+id);return els.get(id);};
  const document={hidden:false,getElementById:get,addEventListener(k,f){docEvents[k]=f;},body:element('body'),createElement(tag){const e=element('created'+(++seq));e.tagName=tag.toUpperCase();return e;}};
  const media={matches:false,addEventListener(k,f){this.change=f;}};
  class WorkerStub{constructor(){workers.push(this);}postMessage(q){this.request=q;}terminate(){this.terminated=true;}emit(data){this.onmessage?.({data});}}
  const box={console,document,TaoModel:M,TaoWorker:{create:()=>new WorkerStub()},Date,Math,Number,Map,Promise,Blob,devicePixelRatio:1,
    URL:{createObjectURL(b){const u='blob:qa/'+(++seq);blobs.set(u,b);return u;},revokeObjectURL:u=>blobs.delete(u)},
    matchMedia:()=>media,addEventListener(k,f){winEvents[k]=f;},setTimeout(f,delay){const id=++seq;timers.set(id,{f,delay});return id;},clearTimeout:id=>timers.delete(id)};
  box.window=box;vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),box,{filename:'assets/app.js'});
  const A=box.TaoApp;
  async function flush(){for(let i=0;i<4;i++)await Promise.resolve();}
  async function scheduled(){for(const [id,t] of [...timers])if(t.delay<=120){timers.delete(id);t.f();}await flush();return workers.at(-1);}
  async function finish(w=workers.at(-1)){const q=w.request;assert(q?.type==='compute');const r=await M.compute(q.payload);w.emit({id:q.id,type:'result',result:r});await flush();return r;}
  async function run(){const w=await scheduled();if(A.state.activeJob?.type==='compute')await finish(w);check(!A.state.busy&&!A.state.error,'current computation completes');}
  function fire(id,event){const e=get(id);e.events[event]?.({target:e,preventDefault(){}});}
  function same(a,b){return a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));}
  get('playStep').value='year';get('leftMode').value='birth';
  check(A.state.initialized,'app initialized');check(get('export').disabled,'pending output cannot export');await run();await A.ready;
  check(A.state.presetId==='T02','default example T02');check(A.state.result.custom.length===27003,'9001 flow points');
  check(A.state.drawStats.left.count===9001&&A.state.drawStats.right.count===9001,'both panels draw actual points');
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
  // Date playback really recomputes, and hidden/reduced-motion stops it.
  A.setTime(A.state.chart.birthMs);await run();A.startPlayback();
  check(A.state.playing,'play starts');const tick=[...timers].find(([,t])=>t.delay===1100);check(!!tick,'next date scheduled');timers.delete(tick[0]);tick[1].f();await run();
  check(A.state.epochMs===M.addYears(A.state.chart.birthMs,1),'year playback advances calendar date');
  document.hidden=true;docEvents.visibilitychange();check(!A.state.playing&&!A.state.playTimer,'hidden page stops playback');document.hidden=false;docEvents.visibilitychange();
  media.change({matches:true});A.startPlayback();check(!A.state.playing&&get('play').disabled,'reduced motion disables automatic play');media.change({matches:false});
  get('zoom').value='1.5';fire('zoom','input');check(A.state.zoom===1.5,'shared zoom');get('resetView').click();check(A.state.zoom===1,'reset shared camera');
  get('leftMode').value='noDayun';fire('leftMode','change');
  get('export').click();check(downloads.length===1,'settings file download');const exported=JSON.parse(await blobs.get(downloads[0].url).text());
  check(exported.birth.birth===A.state.chart.birth&&exported.epochMs===A.state.epochMs&&exported.validComputedResult,'export binds actual birth/date/result');
  check(exported.protocol.continuedHistoricalState===false,'export carries frozen-date semantics');
  check(exported.leftMode==='noDayun'&&exported.reference,'export identifies left comparison');
  A.submitBirth({birth:'2001-02-29T01:00:00',gender:'male'});check(!A.state.chart&&!A.state.result&&get('export').disabled&&!get('error').hidden,'invalid birth cannot retain a mislabeled old result');
  A.submitBirth(M.examples[1]);await run();check(A.state.profile.key!==profile.key,'another birth cannot borrow calibrated profile');
  A.setLayer(2,true,1.7);const ew=await scheduled();ew.emit({id:ew.request.id,type:'error',error:'Simulated numerical failure'});
  check(A.state.error&&get('export').disabled&&!A.state.result,'numerical errors do not export');get('resetLayers').click();await run();
  check(drawCalls>100000,'real trajectory coordinates sent to Canvas API');A.cancel();
  console.log(JSON.stringify({uiChecks:checks,drawCalls,workerInstances:workers.length,boundary:'Node DOM/Canvas stubs and real numeric results; not browser layout/native UI/security verification.'}));
});
