'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),R=require('../app/src/main/assets/reference.js'),S=require('../app/src/main/assets/schedule.js');
const cases=require('./fixtures/assessment-cases.json'),seed=require('../app/src/main/assets/seed.json');
const date='2026-10-19',fresh=()=>M.migrateState(structuredClone(seed),'2026-10-15');
function fixture(c){
 const s=fresh(),row=s.plan.targets[date];if(c.outsidePlan)s.plan.endDate='2026-10-18';row.math=c.legacy?50:{min:30,max:70};row['course-review']=c.legacy?40:{min:30,max:50};
 if(c.zeroTargets){row.math={min:0,max:0};row['course-review']={min:0,max:0};}
 if(c.noCourse)s.plan.subjects.find(x=>x.id==='course-review').activePeriods=[];
 if(c.zeroWordGoal)s.plan.subjects.find(x=>x.id==='vocab').wordGoal=0;
 const r=M.record(s,date);r.status=c.status;r.subjects.math.minutes=c.math;r.subjects['course-review'].minutes=c.course;r.subjects.vocab.newWords=c.newWords;r.subjects.vocab.reviewWords=c.reviewWords;
 M.saveRecord(s,date,r);return s;
}
for(const c of cases)test('saved assessment: '+c.id,()=>{
 const s=fixture(c),before=structuredClone(s),a=R.assess(s,date);
 assert.equal(a.time.kind,c.expected.kind);assert.ok(a.time.actual===null?c.expected.actual===null:Math.abs(a.time.actual-c.expected.actual)<1e-8);assert.equal(a.time.min,c.expected.min);assert.equal(a.time.max,c.expected.max);assert.equal(a.words[0].kind,c.expected.word);
 if(c.outsidePlan)assert.equal(a.words[0].goal,null);
 assert.deepEqual(s,before,'assessment never writes records, goals, references or status');
});
test('interval references have one source, preserve old scalar values, and reject invalid backups',()=>{
 const s=fresh();assert.equal(s.version,4);assert.deepEqual(s.plan.targets['2026-10-15']['course-review'],{min:30,max:50});assert.equal(s.plan.targets['2026-10-14'].math,60);
 for(const invalid of [{min:40,max:30},{min:0,max:1441},{min:-1,max:2},{min:null,max:2},{min:'0',max:2},{min:0,max:2,other:1},[0,2]]){
  const bad=structuredClone(s);bad.plan.targets[date].math=invalid;assert.throws(()=>M.validateState(bad));
 }
 const legacy=structuredClone(s);legacy.version=3;assert.throws(()=>M.validateState(legacy));
 const words=structuredClone(s);words.plan.targets[date].vocab={min:0,max:50};assert.throws(()=>M.validateState(words));
 const roundtrip=JSON.parse(JSON.stringify(s));assert.deepEqual(roundtrip,s);assert.equal(M.validateState(roundtrip),true);
});
test('weekday and weekend totals match confirmed intervals, including custom edits and plan extensions',()=>{
 const s=fresh();assert.deepEqual(R.total(s,'2026-10-19'),{min:60,max:120});assert.deepEqual(R.total(s,'2026-10-24'),{min:240,max:360});assert.deepEqual(R.total(s,'2026-10-25'),{min:180,max:300});
 s.plan.targets[date].math={min:10,max:20};assert.deepEqual(R.total(s,date),{min:40,max:70});
 M.resizePlan(s,s.plan.startDate,'2027-01-03',7);assert.deepEqual(R.total(s,'2027-01-02'),{min:240,max:360});
 const ref=M.reference(s,date,'math');ref.min=0;assert.deepEqual(M.reference(s,date,'math'),{min:10,max:20});
});
test('weekly and monthly range totals retain actual aggregation and never add count goals to minutes',()=>{
 const s=fixture(cases[0]),stats=M.weekStats(s,date),month=M.monthStats(s,'2026-10');
 const math=stats.subjects.find(x=>x.id==='math');assert.ok(math.referenceRange.min<math.referenceRange.max);assert.equal(math.actual,30);
 assert.equal(month.actual,60);assert.equal(M.wordStats(s,[date])[0].newWords,50);
 const counts=R.counts(s,[date,'2026-10-20']);assert.deepEqual(counts,{below:0,within:1,above:0,rest:0,pending:1});
 const outside=R.assess(s,'2026-12-21');assert.equal(outside.time.kind,'outside');
});
test('sub-second floating sums do not cross a boundary due to arithmetic noise',()=>{
 const s=fixture(cases[0]);s.records[date].subjects.math.minutes=29.999999999999996;assert.equal(R.assess(s,date).time.kind,'within');
 s.records[date].subjects.math.minutes=29.999;assert.equal(R.assess(s,date).time.kind,'below');
});
test('reference controls stay distinct for imported subject IDs ending in max',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),app=fs.readFileSync('app/src/main/assets/app.js','utf8');
 const source=app.slice(app.indexOf('function rangeFields'),app.indexOf('function planView'));
 const html=['math','math-max'].map(id=>vm.runInNewContext('('+source+')('+JSON.stringify(id)+','+JSON.stringify('target-'+id)+',{min:30,max:70})',{R:()=>R,escape:x=>String(x)})).join('');
 const ids=Array.from(html.matchAll(/\bid="([^"]+)"/g),x=>x[1]);assert.equal(ids.length,4);assert.equal(new Set(ids).size,4);assert.ok(html.includes('参考上限分钟'));
});
test('assessment shows the saved arrangement beside its effective interval',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),app=fs.readFileSync('app/src/main/assets/app.js','utf8');
 const source=app.slice(app.indexOf('function assessmentView'),app.indexOf('function assessmentSummary'));
 for(const id of ['normal-at-lower','reduced-at-lower','review-at-lower']){
  const c=cases.find(c=>c.id===id),s=fixture(c),status=c.status==='正常参考'?'照常':c.status;
  const html=vm.runInNewContext('('+source+')('+JSON.stringify(date)+')',{R:()=>R,state:s,escape:x=>String(x),within:()=>true,statusLabel:x=>x==='正常参考'?'照常':x});
  assert.ok(html.includes(status+' · '));assert.ok(html.includes(c.expected.min+'—'+c.expected.max+' 分钟'));
 }
 const s=fixture(cases.find(c=>c.outsidePlan));
 const html=vm.runInNewContext('('+source+')('+JSON.stringify(date)+')',{R:()=>R,state:s,escape:x=>String(x),within:()=>false,statusLabel:x=>x==='正常参考'?'照常':x});
 assert.ok(html.includes('计划范围外'));assert.ok(!html.includes('null 个'));assert.ok(!html.includes(' / 50 个'));
});
module.exports={fixture};
