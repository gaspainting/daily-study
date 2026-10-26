'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const M=require('../app/src/main/assets/model.js');
const {workload}=require('./baseline-workload.cjs');
const root=path.resolve(__dirname,'..'),version=/versionName="([^"]+)"/.exec(fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8'))[1];
const output=process.env.BASELINE_REPORT_DIR||path.join(root,'docs/validation-v'+version);
const phase=process.env.BASELINE_PHASE||'baseline',today='2026-10-26';
function measure(name,fn){for(let i=0;i<2;i++)fn();const values=[];for(let i=0;i<9;i++){const start=performance.now();fn();values.push(performance.now()-start);}const sorted=values.slice().sort((a,b)=>a-b);return {name,samplesMs:values,medianMs:sorted[4],p95Ms:sorted[8]};}
const results=[70,365,730].map(days=>{const state=workload(days,today);return {days,recordDays:Object.keys(state.records).length,sessions:state.sessions.length,stateBytes:Buffer.byteLength(JSON.stringify(state)),results:[
 measure('validate',()=>M.validateState(state)),
 measure('migrationRead',()=>M.migrateState(state,today)),
 measure('serialize',()=>JSON.stringify(state)),
 measure('historyAll',()=>M.historySearch(state,{})),
 measure('historyDateAndKeyword',()=>M.historySearch(state,{from:'2026-10-01',to:today,keyword:'查找目标'})),
 measure('historyQuantity',()=>M.historySearch(state,{subjectId:'practice',recordKind:'zero'})),
 measure('sessionsAll',()=>M.sessionSearch(state,{})),
 measure('sessionsDateAndSubject',()=>M.sessionSearch(state,{from:'2026-10-01',to:today,subjectId:'math'})),
 measure('weekStats',()=>M.weekStats(state,today)),
 measure('monthStats',()=>M.monthStats(state,'2026-10'))
 ]};});
const report={version,phase,sourceCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),scope:'Node model execution; synthetic validated schema-8 workloads; not phone latency',runtime:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,today,results};
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'model-performance-'+phase+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(x=>({days:x.days,recordDays:x.recordDays,stateBytes:x.stateBytes,mediansMs:Object.fromEntries(x.results.map(y=>[y.name,Number(y.medianMs.toFixed(3))]))})),null,2));
