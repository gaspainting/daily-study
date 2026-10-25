'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),R=require('../app/src/main/assets/reference.js'),T=require('../app/src/main/assets/tracking.js');
const seed=require('../app/src/main/assets/seed.json'),date='2026-10-19',at='2026-10-19T02:00:00.000Z';
function fixture(){const s=M.migrateState(structuredClone(seed),'2026-10-16');s.plan.targets[date].math={min:30,max:70};s.plan.targets[date]['course-review']={min:30,max:50};const r=M.record(s,date);r.status='正常参考';r.subjects.math.minutes=30;r.subjects['course-review'].minutes=30;r.subjects.vocab.newWords=50;M.saveRecord(s,date,r);return s;}
test('saved basis survives changed references names defaults vocabulary goals and archive while actual changes still count',()=>{
 const s=fixture(),before=structuredClone(s.records);assert.equal(s.version,8);assert.equal(R.assess(s,date).basis.source,'record');
 s.plan.targets[date].math={min:200,max:300};s.plan.wordTargets={[date]:{vocab:80}};s.plan.subjects.find(s=>s.id==='math').name='数学新名称';M.archiveSubject(s,'course-review',date);
 assert.equal(R.assess(s,date).time.kind,'within');assert.equal(R.assess(s,date).words[0].kind,'within');assert.equal(R.basis(s,date).time.find(s=>s.id==='math').name,'高数');assert.deepEqual(s.records,before);
 s.records[date].subjects.math.minutes=200;assert.equal(R.assess(s,date).time.kind,'above');
});
test('explicit recalculation replaces only selected basis with current thresholds',()=>{
 const s=fixture(),records=structuredClone(s.records);s.plan.targets[date].math={min:200,max:300};s.plan.wordTargets={[date]:{vocab:80}};const prior=structuredClone(s.assessmentBases[date]);
 const preview=structuredClone(s);R.recalculate(preview,date,at);assert.deepEqual(s.assessmentBases[date],prior);assert.equal(R.assess(preview,date).time.kind,'below');assert.equal(R.assess(preview,date).words[0].kind,'below');assert.equal(preview.assessmentBases[date].source,'recalculated');assert.deepEqual(preview.records,records);assert.throws(()=>R.recalculate(s,'2026-10-20'));
});
test('legacy migration never pretends to know original criteria and preservation precedes reference changes',()=>{
 const old=fixture();delete old.assessmentBases;delete old.plan.courseSchedule;old.version=4;const original=structuredClone(old),view=M.migrateState(old,'2026-10-19');assert.deepEqual(old,original);assert.equal(R.assess(view,date).basis.saved,false);assert.equal(R.assess(view,date).basis.source,'current');
 const changed=structuredClone(view);changed.plan.targets[date].math={min:200,max:300};R.preserve(view,changed,at);assert.equal(R.assess(changed,date).time.kind,'within');assert.equal(changed.assessmentBases[date].source,'existing');assert.equal(changed.assessmentBases[date].capturedAt,at);assert.equal(changed.plan.targets[date].math.min,200);assert.deepEqual(changed.records,old.records);
});
test('repeated saves preserve basis timestamps and statuses zero null remain explicit',()=>{
 const s=fixture(),b=structuredClone(s.assessmentBases[date]);M.saveRecord(s,date,M.record(s,date));assert.deepEqual(s.assessmentBases[date],b);
 const r=M.record(s,date);r.status='休息';r.subjects.math.minutes=0;r.subjects['course-review'].minutes=null;M.saveRecord(s,date,r);assert.equal(R.assess(s,date).time.kind,'rest');assert.equal(s.records[date].subjects.math.minutes,0);assert.equal(s.records[date].subjects['course-review'].minutes,null);r.status='正常参考';M.saveRecord(s,date,r);assert.equal(R.assess(s,date).time.kind,'partial');
});
test('basis validation rejects unknown rules extra fields fake timestamps missing records invalid subjects and bounds',()=>{
 const s=fixture();assert.equal(M.validateState(s),true);const mutate=[b=>b.rule=2,b=>b.source='current',b=>b.extra=true,b=>b.capturedAt='2026-02-30T02:00:00.000Z',b=>b.inside='true',b=>b.time[0].reference={min:2,max:1},b=>b.time[0].id='__proto__',b=>b.words[0].goal=0.5,b=>b.time.push(structuredClone(b.time[0]))];
 for(const change of mutate){const bad=structuredClone(s);change(bad.assessmentBases[date]);assert.throws(()=>M.validateState(bad));}
 const dangling=structuredClone(s);delete dangling.records[date];assert.throws(()=>M.validateState(dangling));const old=structuredClone(s);old.version=4;assert.throws(()=>M.validateState(old));
});
test('filters use assessment categories independently of recorded state and combine dates keywords and arrangements',()=>{
 const s=fixture();for(const [day,mode,minutes,words] of [['2026-10-20','减量',0,0],['2026-10-21','休息',200,100],['2026-10-22','正常参考',200,null]]){const r=M.record(s,day);r.status=mode;r.note='历史搜索';r.subjects.math.minutes=minutes;r.subjects['course-review'].minutes=0;r.subjects.vocab.newWords=words;M.saveRecord(s,day,r);}
 assert.deepEqual(M.historySearch(s,{assessmentKind:'within'}).map(r=>r.date),[date]);assert.deepEqual(M.historySearch(s,{assessmentKind:'below',keyword:'历史搜索'}).map(r=>r.date),['2026-10-20']);assert.deepEqual(M.historySearch(s,{assessmentDimension:'words',assessmentKind:'empty',from:'2026-10-22',to:'2026-10-22'}).map(r=>r.date),['2026-10-22']);assert.equal(M.historySearch(s,{assessmentKind:'rest',status:'休息'}).length,1);assert.equal(M.historySearch(s,{assessmentKind:'empty',from:'2026-10-23',to:'2026-10-23'})[0].entry,false);assert.throws(()=>M.historySearch(s,{assessmentKind:'invented'}));
});
test('rates exclude rest blank partial and unconfigured days and keep dimensions independent',()=>{
 const s=fixture();for(const [day,status,math,course,words] of [['2026-10-20','正常参考',0,0,80],['2026-10-21','休息',null,null,null],['2026-10-22','正常参考',0,null,0]]){const r=M.record(s,day);r.status=status;r.subjects.math.minutes=math;r.subjects['course-review'].minutes=course;r.subjects.vocab.newWords=words;M.saveRecord(s,day,r);}
 const days=M.dates(date,'2026-10-23'),t=R.summary(s,days,'time'),w=R.summary(s,days,'words');assert.equal(t.graded,2);assert.equal(t.achieved,1);assert.equal(t.rate,50);assert.equal(t.rest,1);assert.equal(t.empty,1);assert.equal(t.partial,1);assert.equal(w.graded,3);assert.equal(w.achieved,2);assert.equal(w.rate,67);assert.equal(R.summary(s,[],'time').rate,null);
});
test('multiple vocabulary subjects make partial knowledge pending rather than a false failure',()=>{
 const s=fixture();s.plan.subjects.push({id:'words2',name:'词汇二',kind:'vocab',defaults:[0,0,0,0,0,0,0],wordGoal:20});R.recalculate(s,date,at);assert.equal(R.kind(R.assess(s,date),'words'),'partial');const r=M.record(s,date);r.subjects.words2.newWords=0;M.saveRecord(s,date,r);assert.equal(R.kind(R.assess(s,date),'words'),'below');
});
test('history markup exposes independent controls and month summaries omit future unrecorded dates',()=>{
 const s=fixture();const h=T.renderHistory(s,{assessmentDimension:'words',assessmentKind:'within'});assert.ok(h.includes('tracking-assessment-kind'));assert.ok(h.includes('新学：完成'));const text=T.renderAssessments(s,M.dates(date,'2026-10-25'),{today:date});assert.ok(text.includes('达标 1 / 已评估 1 天'));assert.ok(!text.includes('2026-10-25'));assert.ok(!text.includes('NaN'));assert.ok(!text.includes('Infinity'));assert.deepEqual(JSON.parse(JSON.stringify(s)),s);
});
module.exports={fixture};
