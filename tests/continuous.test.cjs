'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{Worker}=require('node:worker_threads');
const M=require('../assets/model/model.js'),C=require('../assets/model/continuous.js');
const START=Date.parse('2024-02-03T22:00:00+08:00'),MS=C.civilMillisecondsPerModelUnit;
let cached;
async function fixture(t=START,enabled=[true,true,true,true,true],example=M.examples[1]){const chart=M.chart(example),r=await M.compute({chart,epochMs:t,enabled});return {sessionId:'continuity',chart,epochMs:t,enabled,seedPoints:r.custom,seedParameters:r.parameters,profile:r.profile};}
async function base(){if(!cached)cached=fixture();return cached;}
const norm=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const advance=(s,n,callbacks)=>s.advance({civilDurationMs:Math.round(n*MS),modelDuration:n},callbacks);

test('continuous seed is copied; rolling window preserves old points and appends true integration',async()=>{
  const input=await base(),seed=input.seedPoints.slice(),s=C.create(input),a=s.snapshot();assert.deepEqual(a.points,seed);assert.deepEqual(a.checkpoint.stateXYZ,Array.from(seed.slice(-3)));
  a.points[0]=999;assert.notEqual(s.snapshot().points[0],999);
  const b=await advance(s,.32);assert.equal(b.epochMs,START+24192000);assert.equal(b.points.length,27003);assert.equal(b.seedPointsRemaining,8969);
  assert.deepEqual(b.points.slice(0,(9001-32)*3),seed.slice(32*3));assert.deepEqual(input.seedPoints,seed);assert.notDeepEqual(b.points.slice(-3),seed.slice(-3));
  assert.equal(b.protocol.playbackSpeedChangesNumericalPath,false);assert.equal(b.protocol.continuedFromBirth,false);assert.equal(b.protocol.responseTimeModelUnits,1);assert.equal(b.protocol.staticCalibrationGuaranteesContinuousComplexity,false);
  assert.equal(b.protocol.rollingWindowModelUnits,90);assert.equal(b.protocol.rollingWindowCivilDays,78.75);assert.equal(b.protocol.windowDays,90);
  assert(b.points.every(Number.isFinite));for(const k of ['alpha','beta','tau','delta','epsilon','eta'])assert(b.parameters[k]>0);
});

test('different playback batching, pause and arbitrary partial endpoints preserve exactly one path',async()=>{
  const input=await base(),whole=C.create(input),parts=C.create({...input,sessionId:'parts'}),target=111111111;
  const w=await whole.advance({civilDurationMs:target});
  for(const n of [1000,235343,756000,482234,40000000,67776534])await parts.advance({civilDurationMs:n});
  const used=1000+235343+756000+482234+40000000+67776534;
  const before=parts.snapshot();assert.deepEqual(parts.snapshot().points,before.points,'pause snapshots have no side effects');
  const p=await parts.advance({civilDurationMs:target-used});assert.deepEqual(p.points,w.points);assert.deepEqual(p.parameters,w.parameters);assert.deepEqual(p.checkpoint.stateXYZ,w.checkpoint.stateXYZ);
  assert.equal(p.epochMs,START+target);assert.equal(p.points.length,27006);assert.equal(p.protocol.partialHeadIsActualIntegration,true);
  // The temporary head is not fed back into the canonical state at the next packet.
  const w2=await whole.advance({civilDurationMs:12345}),p2=await parts.advance({civilDurationMs:12345});assert.deepEqual(p2.points,w2.points);
  await assert.rejects(parts.advance({civilDurationMs:756000,modelDuration:1}),/fixed 8\/7/);
});

test('all crossed hour/day, solar-term and personal dayun boundaries are applied at their exact times',async()=>{
  const input=await base(),s=C.create(input),r=await s.advance({civilDurationMs:86400000});
  const events=r.diagnostics.lastBatch.events,solar=require('../assets/model/oracle-flow-boundaries.json').find(x=>x.label==='立春整秒').epochMs;
  assert.equal(events.filter(x=>x.types.includes('hour/day')).length,12);assert(events.some(x=>x.epochMs===solar&&x.types.includes('solar-term')));
  for(const event of events)assert.deepEqual(event.pillars,M.temporal(input.chart,event.epochMs).pillars);
  const month=C.create(await fixture(solar-1000)),before=month.snapshot(),at=await month.advance({civilDurationMs:1000});
  assert.deepEqual(at.parameters,before.parameters,'causal response has no parameter jump exactly at boundary');assert.notDeepEqual(at.targetParameters,before.targetParameters);assert.equal(at.temporal.flowPillars[0],'甲辰');
  const after=await month.advance({civilDurationMs:60000}),elapsed=60000/MS;
  for(const k of M.parameterOrder)assert(Math.abs(after.parameters[k]-(at.targetParameters[k]+(at.parameters[k]-at.targetParameters[k])*Math.exp(-elapsed)))<1e-12,k);
  const c=input.chart,dayun=C.create(await fixture(c.dayun.firstStartMs-1000)),d0=dayun.snapshot(),d1=await dayun.advance({civilDurationMs:1001});
  assert.equal(d0.temporal.dayun.active,false);assert.equal(d1.temporal.dayun.active,true);assert(d1.diagnostics.lastBatch.events.some(x=>x.epochMs===c.dayun.firstStartMs&&x.types.includes('dayun')));
});

test('all-off keeps exact natal target and applied parameters while continuing the existing state',async()=>{
  const input=await fixture(START,[false,false,false,false,false]),s=C.create(input),r=await advance(s,.4);
  assert.deepEqual(r.targetParameters,input.chart.parameters);assert.deepEqual(r.parameters,input.chart.parameters);
  assert.deepEqual(r.checkpoint.initialPoint,Array.from(input.seedPoints.slice(-3)));assert.notDeepEqual(r.checkpoint.stateXYZ,[.1,0,0]);
});

test('halving RK step improves short-time continuation accuracy; cancellation rolls back atomically',async()=>{
  const input=await base(),coarse=C.create(input),fine=C.create({...input,maxStep:.00125}),reference=C.create({...input,maxStep:.000625});
  const [a,b,c]=await Promise.all([advance(coarse,.32),advance(fine,.32),advance(reference,.32)]),e1=norm(a.checkpoint.stateXYZ,c.checkpoint.stateXYZ),e2=norm(b.checkpoint.stateXYZ,c.checkpoint.stateXYZ);
  assert(e2<1e-6,`${e2}`);assert(e1>e2*5,`${e1} / ${e2}`);
  const s=C.create(input),saved=s.snapshot();let cancelled=false;
  await assert.rejects(advance(s,2,{shouldCancel:()=>cancelled,onProgress:p=>{if(p.fraction>.1)cancelled=true;}}),/Cancelled/);
  assert.deepEqual(s.snapshot().points,saved.points);assert.equal(s.snapshot().epochMs,saved.epochMs);assert.deepEqual(s.snapshot().parameters,saved.parameters);
  const restarted=await advance(s,.32);assert.deepEqual(restarted.points,a.points);
});

test('all eight real demo seeds continue finitely; a new birth owns independent state',async()=>{
  const results=[];for(const e of M.examples){const input=await fixture(START,undefined,e),s=C.create({...input,sessionId:e.id}),r=await advance(s,.32);assert(r.points.every(Number.isFinite),e.id);assert.equal(r.profile.key,input.chart.key);results.push(r);}
  assert.notDeepEqual(results[0].checkpoint.stateXYZ,results[1].checkpoint.stateXYZ);
});

test('the finite frozen seed prefix is fully replaced after one rolling window',async()=>{
  const input=await base(),s=C.create(input);for(let i=0;i<45;i++)await advance(s,2);const r=await advance(s,.01);
  assert.equal(r.seedPointsRemaining,0);assert.equal(r.modelElapsed,90.01);assert.equal(r.points.length,27003);assert.equal(r.diagnostics.appendedSamples,9001);assert(r.points.every(Number.isFinite));
});

test('actual bundled Worker retains stream state across transfer, cancels atomically and rejects stale sessions',async()=>{
  let source;const box={Date,Math,setTimeout,clearTimeout,document:{},URL:{createObjectURL:b=>{source=b.parts.join('');return 'blob:test';},revokeObjectURL(){}},Blob:class{constructor(parts){this.parts=parts;}},Worker:class{}};
  vm.createContext(box);vm.runInContext(fs.readFileSync(require.resolve('../assets/model/worker-source.js'),'utf8'),box);box.TaoWorker.create();
  const worker=new Worker("const {parentPort}=require('node:worker_threads');global.self=global;global.postMessage=(v,t)=>parentPort.postMessage(v,t);\n"+source+"\nparentPort.on('message',data=>self.onmessage({data}));",{eval:true});let id=0;
  function call(type,payload,cancel=false){return new Promise((resolve,reject)=>{const n=++id,onMessage=m=>{if(m.id!==n)return;if(m.type==='progress'&&cancel)worker.postMessage({id:n,type:'cancel'});if(m.type==='result'||m.type==='error'){worker.off('message',onMessage);m.type==='error'?reject(Error(m.error)):resolve(m.result);}};worker.on('message',onMessage);worker.postMessage({id:n,type,payload});});}
  try{
    const input=await base(),a=await call('stream-start',input);assert.deepEqual(a.points,input.seedPoints);
    const b=await call('stream-advance',{sessionId:'continuity',civilDurationMs:24192000,modelDuration:.32});assert.equal(b.epochMs,START+24192000);assert.equal(a.points.length,27003);
    await assert.rejects(call('stream-advance',{sessionId:'continuity',civilDurationMs:2*MS,modelDuration:2},true),/Cancelled/);
    const c=await call('stream-advance',{sessionId:'continuity',civilDurationMs:756000,modelDuration:.01});assert.equal(c.epochMs,b.epochMs+756000);assert(c.points.every(Number.isFinite));
    await call('stream-stop',{sessionId:'continuity'});await assert.rejects(call('stream-advance',{sessionId:'continuity',civilDurationMs:756000}),/mismatch/);
    const d=await call('stream-start',{...input,sessionId:'new'});assert.equal(d.modelElapsed,0);assert.deepEqual(d.points,input.seedPoints);
  }finally{await worker.terminate();}
});
