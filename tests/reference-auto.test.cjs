'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),R=require('../app/src/main/assets/reference.js');
const S=require('../app/src/main/assets/schedule.js');
const seed=require('../app/src/main/assets/seed.json'),day='2026-10-21',past='2026-10-20';
// These fixtures exercise the pre-v1.6.7 migration and legacy reassessment contract.
const fresh=()=>{const s=M.migrateState(structuredClone(seed),'2026-10-15');delete s.evaluation;s.version=8;return s;};
function saved(s,d){const r=M.record(s,d);r.status='正常参考';r.subjects.math.minutes=60;r.subjects['course-review'].minutes=30;r.subjects.vocab.newWords=50;M.saveRecord(s,d,r);return r;}
test('legacy positive references are usable point intervals without rewriting past records or targets',()=>{
 const s=fresh();s.plan.targets[past].math=50;s.plan.targets[past]['course-review']=40;saved(s,past);const before=structuredClone(s);
 assert.equal(R.assess(s,past).time.kind,'within');assert.equal(R.assess(s,past).time.min,90);assert.deepEqual(s,before);
 const loaded=M.migrateState(s,day);assert.deepEqual(loaded.plan.targets[past],before.plan.targets[past]);assert.deepEqual(loaded.assessmentBases[past],before.assessmentBases[past]);assert.deepEqual(loaded.records,before.records);
});
test('current legacy criteria repair from current automatic references while word criteria remain frozen',()=>{
 const s=fresh();s.plan.targets[day].math=60;s.plan.targets[day]['course-review']=30;saved(s,day);const before=structuredClone(s);
 s.plan.targets[day].math={min:40,max:80};s.plan.targets[day]['course-review']={min:20,max:40};s.plan.wordTargets={[day]:{vocab:100}};
 const loaded=M.migrateState(s,day),result=R.assess(loaded,day);
 assert.deepEqual(loaded.records,before.records);assert.equal(result.time.kind,'within');assert.equal(result.time.min,60);assert.equal(result.time.max,120);assert.equal(result.words[0].goal,50);assert.equal(result.words[0].kind,'within');assert.equal(result.basis.source,'recalculated');
 assert.deepEqual(M.migrateState(loaded,day),loaded);assert.equal(s.assessmentBases[day].time[0].reference,30);
});
test('zero legacy criteria repair only when current intervals provide an actual target',()=>{
 const s=fresh();s.plan.targets[day].math=0;s.plan.targets[day]['course-review']=0;saved(s,day);
 s.plan.targets[day].math={min:40,max:80};s.plan.targets[day]['course-review']={min:20,max:40};const n=M.migrateState(s,day);
 assert.equal(R.assess(n,day).time.kind,'within');assert.deepEqual(n.records,s.records);
 const zero=fresh();zero.plan.targets[day].math={min:0,max:0};zero.plan.targets[day]['course-review']={min:0,max:0};saved(zero,day);const z=M.migrateState(zero,day);assert.equal(R.assess(z,day).time.kind,'range');assert.equal(R.assess(z,day).time.actual,90);
});
test('automatic references use the timetable and preserve explicit intervals custom scalars and inactive subjects',()=>{
 const s=fresh();s.plan.targets[day].math=60;s.plan.targets[day]['course-review']=30;s.plan.targets['2026-10-22'].math=17;s.plan.targets['2026-10-23'].math={min:7,max:19};s.plan.targets['2026-10-24'].math=210;s.plan.targets['2026-10-24']['course-review']=90;
 s.plan.subjects.push({id:'custom_auto',name:'专业课',kind:'custom',defaults:[25,25,25,25,25,25,25],activePeriods:[{from:day,to:'2026-10-23'}]});
 const n=M.migrateState(s,day);assert.deepEqual(n.plan.targets[day].math,{min:40,max:80});assert.deepEqual(n.plan.targets[day]['course-review'],{min:20,max:40});assert.deepEqual(n.plan.targets['2026-10-22'].math,{min:17,max:17});assert.deepEqual(n.plan.targets['2026-10-23'].math,{min:7,max:19});assert.deepEqual(n.plan.targets[day].custom_auto,{min:25,max:25});assert.equal(n.plan.targets['2026-10-23'].custom_auto,undefined);assert.deepEqual(R.total(n,'2026-10-24'),{min:240,max:360});assert.deepEqual(M.migrateState(n,day),n);
 const roundtrip=M.migrateState(JSON.parse(JSON.stringify(n)),day);assert.deepEqual(roundtrip,n);assert.deepEqual(n.records,s.records);
});
test('valid saved interval criteria survive upgrades even when today targets are different',()=>{
 const s=fresh();saved(s,day);const b=structuredClone(s.assessmentBases[day]);s.plan.targets[day].math={min:200,max:300};
 const n=M.migrateState(s,day);assert.deepEqual(n.assessmentBases[day],b);assert.equal(R.assess(n,day).time.kind,'within');
});
test('recorded time on a zero-reference subject counts without making blank zero-reference subjects required',()=>{
 const s=fresh();s.plan.subjects.push({id:'extra',name:'其他学习',kind:'custom',defaults:[0,0,0,0,0,0,0]});saved(s,day);s.records[day].subjects.extra.minutes=100;R.recalculate(s,day);
 assert.equal(R.assess(s,day).time.actual,190);assert.equal(R.assess(s,day).time.kind,'above');s.records[day].subjects.extra.minutes=null;assert.equal(R.assess(s,day).time.kind,'within');
 s.records[day].status='仅回顾';assert.equal(R.assess(s,day).time.actual,30);s.records[day].subjects.extra.minutes=500;assert.equal(R.assess(s,day).time.actual,30);
 s.records[day].status='休息';assert.equal(R.assess(s,day).time.kind,'rest');assert.equal(s.records[day].subjects.extra.minutes,500);
});
test('total editing distributes within per-subject limits and exactly preserves requested sums',()=>{
 for(let n=1;n<=24;n++)for(const total of [{min:0,max:0},{min:60,max:120},{min:300,max:500},{min:1440*n-1,max:1440*n}]){
  const entries=Array.from({length:n},(_,i)=>({id:'subject'+i,reference:{min:i?10:0,max:i?15:0}})),before=structuredClone(entries),out=R.distribute(entries,total);
  out.forEach(e=>R.validate(e.reference,true));assert.ok(Math.abs(out.reduce((a,e)=>a+e.reference.min,0)-total.min)<1e-7);assert.ok(Math.abs(out.reduce((a,e)=>a+e.reference.max,0)-total.max)<1e-7);assert.deepEqual(entries,before);
 }
 const integer=R.distribute([{id:'a',reference:17},{id:'b',reference:31}],{min:120,max:180});assert.ok(integer.every(e=>Number.isInteger(e.reference.min)&&Number.isInteger(e.reference.max)));
 assert.throws(()=>R.distribute([],{min:1,max:2}));assert.throws(()=>R.distribute([{id:'a',reference:0}],{min:20,max:10}));assert.throws(()=>R.distribute([{id:'a',reference:0}],{min:0,max:1441}));
});

test('weekend period captions follow exact edited endpoints rather than a matching midpoint',()=>{const s=fresh();assert.ok(S.agenda(s,'2026-10-24').periods);s.plan.targets['2026-10-24']['course-review']={min:30,max:150};assert.equal(S.agenda(s,'2026-10-24').periods,null);});
test('reference editor defaults to new criteria and only offers retention when the previous time target is usable',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),app=fs.readFileSync('app/src/main/assets/app.js','utf8'),source=app.slice(app.indexOf('function referenceFields'),app.indexOf('function editReference'));
 const s=fresh();saved(s,day);
 const render=()=>vm.runInNewContext('('+source+')('+JSON.stringify(day)+')',{window:{StudyEvaluation:require('../app/src/main/assets/evaluation.js')},M:()=>M,R:()=>R,state:s,rangeFields:(...a)=>JSON.stringify(a),field:(...a)=>JSON.stringify(a),selectField:(label,id,value,options)=>JSON.stringify({label,id,value,options})});
 assert.ok(render().includes('recalculate'));assert.ok(render().includes('keep'));assert.ok(render().includes('reference-total'));
 s.assessmentBases[day].time.forEach(e=>e.reference={min:0,max:0});assert.ok(!render().includes('keep'));assert.ok(render().includes('recalculate'));
});
