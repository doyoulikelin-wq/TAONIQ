const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('theory diagram buttons select the matching source layer and explanation',()=>{
  const html=fs.readFileSync(require.resolve('../theory.html'),'utf8');
  const stages=['birth','time','view'],buttons=stages.map(stage=>({dataset:{stage},attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,f){this[k]=f;}}));
  const boxes=Object.fromEntries(['boxBirth','boxTime','boxView'].map(k=>[k,{classList:{toggle(n,on){this[n]=on;}}}]));
  const text={innerHTML:''};
  const document={querySelectorAll:s=>{assert.equal(s,'[data-stage]');return buttons;},getElementById:id=>id==='stageText'?text:boxes[id]};
  const box={document};vm.createContext(box);
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],box);
  buttons.forEach((b,i)=>{b.click();assert.equal(b.attributes['aria-pressed'],'true');buttons.forEach((other,j)=>assert.equal(other.attributes['aria-pressed'],String(i===j)));Object.values(boxes).forEach((e,j)=>assert.equal(e.classList['is-on'],i===j));assert.match(text.innerHTML,[/固定参数/,/五层输入/,/冻结参照/][i]);});
});
