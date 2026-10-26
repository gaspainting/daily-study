'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),R=require('../app/src/main/assets/reference.js'),S=require('../app/src/main/assets/schedule.js');
const legacy=require('./fixtures/reference-legacy-v161.json');
const date='2026-10-26',sat='2026-10-31',sun='2026-11-01';
const fresh=()=>M.migrateState(structuredClone(legacy),date);
test('v1.6.1 point presets migrate to course-aware weekday and full weekend ranges without changing history',()=>{
 const s=fresh();assert.equal(s.version,9);
 assert.deepEqual(R.total(s,date),{min:60,max:120});
 assert.deepEqual(R.total(s,sat),{min:240,max:360});assert.deepEqual(R.total(s,sun),{min:180,max:300});
 assert.deepEqual(s.plan.targets[sat]['course-review'],{min:60,max:120});assert.deepEqual(s.plan.targets[sat].math,{min:180,max:240});
 assert.deepEqual(s.records,legacy.records);
 for(const day of M.dates(s.plan.startDate,'2026-10-25'))assert.deepEqual(s.plan.targets[day],legacy.plan.targets[day]);
 assert.equal(M.validateState(s),true);assert.deepEqual(M.migrateState(s,date),s);
});
test('stale weekday intervals on a weekend repair while nonpreset custom intervals and unknown scalar remain',()=>{
 const s=fresh();s.plan.targets[sat]['course-review']={min:20,max:40};s.plan.targets[sat].math={min:40,max:80};S.autoReferences(s,date);
 assert.deepEqual(R.total(s,sat),{min:240,max:360});
 s.plan.targets[sun]['course-review']={min:7,max:19};s.plan.targets[sun].math=17;S.autoReferences(s,date);
 assert.deepEqual(s.plan.targets[sun]['course-review'],{min:7,max:19});assert.deepEqual(s.plan.targets[sun].math,{min:17,max:17});
 assert.equal(R.text(s.plan.targets[sun].math),'17');assert.equal(R.text({min:0,max:0}),'0');
});
test('explicit day references survive presets, zero, reload, JSON backup and schedule replacement clears only affected markers',()=>{
 const s=fresh();s.plan.targets[sat]['course-review']={min:30,max:30};s.plan.targets[sat].math={min:60,max:60};S.markManual(s,sat,['course-review','math']);
 s.plan.targets[sun].math={min:0,max:0};S.markManual(s,sun,['math']);
 const saved=JSON.parse(JSON.stringify(s)),loaded=M.migrateState(saved,date);assert.deepEqual(loaded.plan.targets[sat],s.plan.targets[sat]);assert.deepEqual(loaded.plan.targets[sun],s.plan.targets[sun]);
 S.applyWeekends(loaded,date);assert.deepEqual(R.total(loaded,sat),{min:240,max:360});assert.ok(!loaded.plan.manualReferences[sat]);assert.ok(!loaded.plan.manualReferences[sun]);
 assert.deepEqual(M.migrateState(loaded,date),loaded);
});
test('manual defaults stay intact when future dates are created and markers reject invalid references',()=>{
 const s=fresh(),subject=s.plan.subjects.find(x=>x.id==='math');M.updateSubject(s,'math',subject.name,Array.from({length:7},()=>({min:60,max:60})));
 M.resizePlan(s,s.plan.startDate,'2027-01-03',s.plan.startWeek);const loaded=M.migrateState(s,date);
 assert.equal(R.text(loaded.plan.targets['2027-01-02'].math),'60');
 for(const ids of [['vocab'],['missing'],['math','math'],[42]]){const bad=structuredClone(loaded);bad.plan.manualReferences={[sat]:ids};assert.throws(()=>M.validateState(bad));}
 const bad=structuredClone(loaded);bad.version=7;assert.throws(()=>M.validateState(bad));
 const quantity=M.addSubject(s,'题目',[5,5,5,5,5,5,5],date,'quantity','题');const wrong=structuredClone(s);wrong.plan.manualReferences={[sat]:[quantity.id]};assert.throws(()=>M.validateState(wrong));
});
test('repair fixes current preset criteria while preserving vocabulary criteria, actual records and past criteria',()=>{
 const s=structuredClone(legacy),rec=M.record(s,sat);rec.status='正常参考';rec.subjects.math.minutes=200;rec.subjects['course-review'].minutes=60;rec.subjects.vocab.newWords=50;M.saveRecord(s,sat,rec);
 const words=structuredClone(s.assessmentBases[sat].words),records=structuredClone(s.records);
 const loaded=M.migrateState(s,date),basis=loaded.assessmentBases[sat];assert.equal(basis.source,'recalculated');assert.deepEqual(basis.words,words);assert.deepEqual(loaded.records,records);
 const assessed=R.assess(loaded,sat).time;assert.equal(assessed.kind,'within');assert.equal(assessed.min,240);assert.equal(assessed.max,360);
 const past=M.migrateState(s,'2026-11-02');assert.deepEqual(past.assessmentBases[sat],s.assessmentBases[sat]);
 const again=M.migrateState(loaded,date);assert.deepEqual(again,loaded);
});
test('manual point criteria and nonpreset criteria are not rewritten by automatic repair',()=>{
 const s=fresh();s.plan.targets[sat].math={min:60,max:60};S.markManual(s,sat,['math']);
 const r=M.record(s,sat);r.status='正常参考';r.subjects.math.minutes=60;r.subjects['course-review'].minutes=60;M.saveRecord(s,sat,r);
 const original=structuredClone(s.assessmentBases[sat]);assert.deepEqual(M.migrateState(s,date).assessmentBases[sat],original);
});
test('schema7 migration and backup roundtrip retain the saved vocabulary ledger and exact daily totals',()=>{
 const s=fresh();s.version=7;delete s.evaluation;const record=M.record(s,sat);record.status='减量';
 record.subjects.vocab.newWords=15;record.subjects.vocab.reviewWords=0;
 record.subjects.vocab.wordLog={base:{newWords:null,reviewWords:0},entries:[{id:'legacy_saved_batch',kind:'new',operation:'add',count:15,at:'2026-10-31T10:00:00Z',source:'quick'}]};
 M.saveRecord(s,sat,record);const oldRecords=structuredClone(s.records),loaded=M.migrateState(JSON.parse(JSON.stringify(s)),date);
 assert.equal(loaded.version,9);assert.deepEqual(loaded.records,oldRecords);assert.equal(M.validateState(loaded),true);assert.deepEqual(M.migrateState(loaded,date),loaded);
});
