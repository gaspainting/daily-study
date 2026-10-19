'use strict';
const Model=require('../app/src/main/assets/model.js');
function reference(){const current=globalThis.StudyModel;try{return require('./fixtures/reference-model-v1.3.2.cjs');}finally{globalThis.StudyModel=current;}}
function workload(size=1000){
 // These benchmark fixtures target the schema-2 algorithm baseline. Schema-3
 // weekly-goal behavior has its own suite and does not enter quantity queries.
 const s=Model.migrateState(structuredClone(require('../app/src/main/assets/seed.json')),'2026-12-21');
 s.version=2;delete s.plan.weekTasks;delete s.plan.courseSchedule;
 s.plan.subjects.push({id:'reading',name:'阅读',kind:'custom',defaults:[10,10,10,10,10,10,10]});
 const entry=(minutes,i)=>({minutes,newWords:null,reviewWords:null,content:'内容 '+i,problem:'',forgotWords:''});
 s.sessions=[];
 for(let i=0;i<size;i++){
  const date=new Date(Date.UTC(2010,0,1+i)).toISOString().slice(0,10);
  s.records[date]={subjects:{math:entry(i%3===0?null:i%11,i),vocab:{...entry(null,i),newWords:i%4===0?null:i%23,reviewWords:i%5===0?null:i%31}},status:i%9===0?'休息':null,restKept:null,note:i%17===0?'查找目标':'日常'};
  for(let j=0;j<2;j++)s.sessions.push({id:'session-'+i+'-'+j,date,subjectId:j?'reading':'math',seconds:i%60,endedAt:date+'T'+(j?'12':'11')+':00:00Z'});
  if(i%13===0)s.records[date].sessions=[{...s.sessions.at(-2)}];
 }
 return s;
}
module.exports={reference,workload};
