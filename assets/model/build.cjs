// Rebuild the self-contained file://-compatible browser + Blob Worker bundle.
const fs=require('node:fs'),path=require('node:path');const root=__dirname;
const data={atlas:require('./atlas-model.json'),drive:require('./drive-config.json'),protocol:require('./calibration-protocol.json'),examples:require('./examples.json')};
const files=['../vendor/lunar-1.7.7.js','encoding.js','drive.js','experiment.js','morphology.js','distance.js','mapper.js','model.js'];
const source='(function(){ const module=undefined,define=undefined;\nglobalThis.TAO_DATA='+JSON.stringify(data)+';\n'+files.map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n;\n')+'\n}).call(globalThis);';
const worker=source+'\n'+fs.readFileSync(path.join(root,'worker.js'),'utf8');
fs.writeFileSync(path.join(root,'worker-source.js'),source+'\n;globalThis.TaoWorker={create:function(){const url=URL.createObjectURL(new Blob(['+JSON.stringify(worker)+'],{type:"text/javascript"}));try{return new Worker(url);}finally{URL.revokeObjectURL(url);}}};\n');
console.log('worker-source.js',fs.statSync(path.join(root,'worker-source.js')).size,'bytes');
