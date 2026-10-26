'use strict';
// Synthetic, validated schema-8 data for repeatable release baselines.
const M=require('../app/src/main/assets/model.js');
const R=require('../app/src/main/assets/reference.js');
const seed=require('../app/src/main/assets/seed.json');
const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function workload(days=730,today='2026-10-26'){
 if(!Number.isInteger(days)||days<1||days>730)throw Error('Baseline days must be 1 through 730');
 const s=M.migrateState(structuredClone(seed),today),first=shift(today,1-days);
 Object.assign(s.plan,{title:'基线样本（合成数据）',startDate:first,endDate:today,targets:{},weekGoals:{},weekHints:{},weekTasks:{},wordTargets:{},quantityTargets:{},quantityUnits:{},manualReferences:{},manualReferenceDefaults:[]});
 s.plan.subjects.forEach(x=>{x.activePeriods=[{from:first,to:null}];});
 s.plan.subjects.push({id:'practice',name:'练习',kind:'custom',measure:'quantity',unit:'题',defaults:[20,20,20,20,20,30,30],activePeriods:[{from:first,to:null}]});
 s.records={};s.reviews={};s.sessions=[];s.assessmentBases={};s.courseReviews={};s._revision=1;
 const entry=()=>({minutes:null,content:'',problem:'',newWords:null,reviewWords:null,forgotWords:''});
 for(let i=0;i<days;i++){
  const date=shift(first,i),weekday=(new Date(date+'T00:00:00Z').getUTCDay()+6)%7;
  s.plan.targets[date]={math:weekday<5?{min:40,max:80}:weekday===5?{min:180,max:240}:{min:120,max:180},'course-review':weekday<5?{min:20,max:40}:{min:60,max:120}};
  if(i%11===0&&i!==days-1)continue;
  const subjects=Object.fromEntries(s.plan.subjects.map(x=>[x.id,entry()]));
  Object.assign(subjects.math,{minutes:i%7===0?null:i%6===0?0:40+i%41,content:'教材第'+(i+1)+'页\n函数与练习',problem:i%4===0?'需要回顾的例题':''});
  subjects['course-review'].minutes=i%8===0?null:i%5===0?0:20+i%31;
  Object.assign(subjects.vocab,{newWords:i%9===0?null:i%5===0?0:40+i%16,reviewWords:i%6===0?null:i%71,forgotWords:i%4===0?'sample; review':''});
  const unit=i<Math.floor(days/2)?'页':'题';
  Object.assign(subjects.practice,{quantity:i%10===0?null:i%6===0?0:20+i%11,quantityUnit:unit});
  s.plan.quantityUnits[date]={practice:unit};
  s.records[date]={subjects,status:['正常参考','减量','仅回顾','休息'][i%4],restKept:i%3===0?null:i%2===0,note:i%13===0?'查找目标：学习随记':'学习随记 '+i};
  s.assessmentBases[date]=R.capture(s,date,'record',date+'T12:00:00.000Z');
  for(let j=0;j<2;j++)s.sessions.push({id:'baseline-'+i+'-'+j,date,subjectId:j?'course-review':'math',seconds:60*(j?20:40)+i%60,endedAt:date+'T'+(j?'12':'11')+':00:00Z'});
 }
 M.validateState(s);
 if(Buffer.byteLength(JSON.stringify(s))>4*1024*1024)throw Error('Baseline exceeds the production per-plan storage limit');
 return s;
}
module.exports={workload,shift};
