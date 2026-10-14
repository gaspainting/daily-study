'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Model=require('../app/src/main/assets/model.js'),{reference,workload}=require('./audit-workload.cjs');
const Old=reference(),state=workload(5000),clean=x=>JSON.parse(JSON.stringify(x));
function median(model,method,filters){for(let i=0;i<3;i++)model[method](state,filters);const samples=[];for(let i=0;i<9;i++){const start=performance.now();model[method](state,filters);samples.push(performance.now()-start);}return samples.sort((a,b)=>a-b)[4];}
const runs=[['historySearch',{}],['historySearch',{from:'2020-01-01',to:'2020-01-31',keyword:'查找目标'}],['sessionSearch',{}],['sessionSearch',{from:'2020-01-01',to:'2020-01-31',subjectId:'math'}]];
const results=runs.map(([method,filters])=>{assert.deepEqual(Model[method](state,filters),clean(Old[method](state,filters)));const beforeMs=median(Old,method,filters),afterMs=median(Model,method,filters);return {method,filters,beforeMedianMs:beforeMs,afterMedianMs:afterMs,improvementPercent:100*(beforeMs-afterMs)/beforeMs,exactResultMatch:true};});
const out={records:5000,sessions:10000,stateBytes:Buffer.byteLength(JSON.stringify(state)),runtime:process.version,samples:9,results};const dir=path.resolve(__dirname,'../docs/validation-v1.3.3');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'algorithm-benchmark.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
