(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BaziEncodingV05=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const STEMS='甲乙丙丁戊己庚辛壬癸',BRANCHES='子丑寅卯辰巳午未申酉戌亥';
 const W=[.4,.3,.2,.1],RAW_BUDGETS=[1,.3,.09,.027],BUDGETS=RAW_BUDGETS.map(x=>x/1.417),BE=[4,2,0,0,2,1,1,2,3,3,2,4];
 const mod=(a,n)=>(a%n+n)%n;
 function index(p){if(typeof p==='number'){if(!Number.isInteger(p)||p<0||p>=60)throw Error('Invalid Jiazi index');return p;}const s=STEMS.indexOf(p[0]),b=BRANCHES.indexOf(p[1]);for(let n=0;n<60;n++)if(n%10===s&&n%12===b)return n;throw Error('Invalid pillar');}
 const indices=p=>{if(p.length!==4)throw Error('Four ordered pillars required');return p.map(index);};
 function E(b,c){if(b===c)return 0;if((c+1)%5===b)return 1;if((b+1)%5===c)return -1;if((c+2)%5===b)return -.75;if((b+2)%5===c)return .75;throw Error('Invalid element');}
 function components(b,c){b=index(b);c=index(c);const bs=b%10,cs=c%10,bb=b%12,cb=c%12;return [E(Math.floor(bs/2),Math.floor(cs/2)),bs%2===cs%2?1:-1,E(BE[bb],BE[cb]),mod(bb+cb,12)===1?1:mod(bb-cb,12)===6?-1:0];}
 function tensor(birth,current){birth=indices(birth);current=indices(current);return current.map(c=>birth.map(b=>components(b,c)));}
 function layerVectors16(birth,current){return tensor(birth,current).map(layer=>layer.flatMap((comp,j)=>comp.map(x=>Math.sqrt(W[j])*x/2)));}
 function componentMeans(birth,current){return tensor(birth,current).map(layer=>Array.from({length:4},(_,k)=>layer.reduce((s,c,j)=>s+W[j]*c[k],0)));}
 function rawChannels8(birth,current){return tensor(birth,current).map(layer=>layer.flatMap((c,j)=>[Math.sqrt(W[j])*(.8*c[0]+.2*c[1]),Math.sqrt(W[j])*(.75*c[2]+.25*c[3])]));}
 let H=[[1]];while(H.length<8){const old=H;H=old.map(r=>r.concat(r)).concat(old.map(r=>r.concat(r.map(v=>-v))));}H=H.map(r=>r.map(v=>v/Math.sqrt(8)));
 function unitChannels8(birth,current){return rawChannels8(birth,current).map(r=>{const norm=Math.hypot(...r);if(norm<.2-1e-12)throw Error('Channel norm lower bound violated');return H.map(row=>row.reduce((s,a,i)=>s+a*r[i],0)/norm);});}
 function weightedUnitChannels8(birth,current,budgets=BUDGETS){return unitChannels8(birth,current).map((row,s)=>row.map(v=>budgets[s]*v));}
 return {components,tensor,interactionTensor:tensor,layerVectors16,componentMeans,rawChannels8,unitChannels8,weightedUnitChannels8,indices,birthWeights:W.slice(),rawLayerBudgets:RAW_BUDGETS.slice(),layerBudgets:BUDGETS.slice(),componentNames:['stemE','stemPolarity','branchE','branchRelation'],hadamard8:H};
});
