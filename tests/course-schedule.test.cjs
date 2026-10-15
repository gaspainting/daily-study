'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const M=require('../app/src/main/assets/model.js'),S=require('../app/src/main/assets/schedule.js'),D=require('../app/src/main/assets/course-schedule-data.js');
const raw=()=>JSON.parse(fs.readFileSync(require.resolve('../app/src/main/assets/seed.json'),'utf8'));
const subject=(s,id)=>s.plan.subjects.find(x=>x.id===id),clone=x=>structuredClone(x),up=(s=raw(),date='2026-10-15')=>M.migrateState(s,date);
test('shared Java and JS generated table has the same 70 authoritative days',()=>{
 const java=fs.readFileSync('app/src/main/java/cn/edu/njupt/studycheckin/CourseScheduleData.java','utf8');
 assert.deepEqual(JSON.parse(JSON.parse(/static final String JSON=(.*);/.exec(java)[1])),D);
 assert.equal(Object.keys(D.days).length,70);
 for(const [date,d] of Object.entries(D.days)){
  assert.equal(d.review+d.math,d.weekday<5?90:d.weekday===5?90:60,date);
  assert.equal(d.review,d.weekday===5?60:d.weekday===6?30:d.courses.length>=3?40:30,date);
  assert.equal(d.legacyMath,raw().plan.targets[date].math,date);
 }
});
test('actual teaching weeks control odd classes and course ending weeks',()=>{
 assert.equal(S.day('2026-10-15').review,40);assert.equal(S.day('2026-10-22').review,30);
 assert.ok(S.day('2026-10-19').courses.includes('大学生就业指导'));
 assert.ok(!S.day('2026-10-26').courses.includes('大学生就业指导'));
 assert.ok(S.day('2026-11-03').courses.includes('毛概'));
 assert.ok(S.day('2026-11-10').courses.includes('习概'));
 assert.deepEqual(S.day('2026-11-11').courses,[]);
 assert.equal(S.day('2026-11-11').math,60);
 assert.throws(()=>S.day('2026-02-30'));
});
test('upgrade adds a future-only course subject without altering actuals or user work',()=>{
 const s=raw();s.plan.weekGoals['2026-10-12']='我的教材';s.plan.weekHints['2026-10-12']='例题';
 const r=M.record(s,'2026-10-14');r.subjects.math.minutes=null;r.subjects.vocab.minutes=0;r.status='休息';r.restKept=true;r.note='我的随记';M.saveRecord(s,'2026-10-14',r);
 s.sessions=[{id:'course-upgrade',date:'2026-10-14',subjectId:'math',seconds:61,endedAt:'2026-10-14T10:00:00Z'}];
 const before=clone(s),n=up(s);assert.deepEqual(s,before);assert.deepEqual(n.records,before.records);assert.deepEqual(n.sessions,before.sessions);
 assert.equal(n.plan.weekGoals['2026-10-12'],'我的教材');assert.equal(n.plan.weekHints['2026-10-12'],'例题');
 assert.equal(n.plan.subjects[0].id,'course-review');assert.deepEqual(subject(n,'course-review').activePeriods,[{from:'2026-10-15',to:null}]);
 assert.equal(M.subjectsForDate(n,'2026-10-14').length,2);assert.equal(M.subjectsForDate(n,'2026-10-15').length,3);
 assert.deepEqual(n.plan.targets['2026-10-14'],before.plan.targets['2026-10-14']);
 assert.equal(M.target(n,'2026-10-15','math'),50);assert.equal(M.target(n,'2026-10-15','course-review'),40);
 assert.equal(M.recordSummary(n,'2026-10-14').recordedSubjects,1);assert.equal(M.record(n,'2026-10-15').subjects['course-review'].minutes,null);
});
test('late upgrade begins today and never changes previously elapsed references',()=>{
 const s=raw(),n=up(s,'2026-10-20');
 for(const d of M.dates(s.plan.startDate,'2026-10-19'))assert.deepEqual(n.plan.targets[d],s.plan.targets[d]);
 assert.equal(subject(n,'course-review').activePeriods[0].from,'2026-10-20');assert.equal(n.plan.targets['2026-10-20'].math,50);
});
test('automatic update preserves a custom math reference, word goals and quick steps',()=>{
 const s=up();s.plan.subjects=s.plan.subjects.filter(x=>x.id!=='course-review');for(const t of Object.values(s.plan.targets))delete t['course-review'];
 subject(s,'math').defaults=[40,25,60,25,40,90,60];s.plan.targets['2026-10-15'].math=17;
 subject(s,'vocab').wordGoal=80;subject(s,'vocab').wordSteps=[1,5,10];s.plan.wordTargets={'2026-10-15':{vocab:33}};
 const n=up(s);assert.equal(n.plan.targets['2026-10-15'].math,17);assert.equal(M.wordTarget(n,'2026-10-15','vocab'),33);
 assert.deepEqual(subject(n,'vocab'),subject(s,'vocab'));
 assert.deepEqual(S.agenda(n,'2026-10-15').mathMinutes,17);
});
test('missing past targets keep their old fallback while future targets are allocated',()=>{
 const s=raw();delete s.plan.targets['2026-10-12'].math;delete s.plan.targets['2026-10-15'].math;
 const n=up(s);assert.equal(M.target(n,'2026-10-12','math'),40);assert.equal(M.target(n,'2026-10-15','math'),50);
 const custom=raw();subject(custom,'math').defaults=[12,12,12,12,12,12,12];delete custom.plan.targets['2026-10-15'].math;
 assert.equal(M.target(up(custom),'2026-10-15','math'),12);assert.deepEqual(subject(up(custom),'math').defaults,[12,12,12,12,12,12,12]);
});
test('repeated loading and archiving never reapply a schedule or resurrect a subject',()=>{
 const n=up();n.plan.targets['2026-10-16'].math=8;assert.deepEqual(up(n,'2026-10-16'),n);
 M.archiveSubject(n,'course-review','2026-10-16');assert.deepEqual(up(n,'2026-10-17'),n);assert.equal(S.agenda(n,'2026-10-17'),null);
});
test('custom plans require explicit application and ended plans remain untouched',()=>{
 const s=raw();s.plan.startWeek=8;assert.equal(up(s).plan.subjects.length,2);
 const n=M.applyCourseSchedule(s,'2026-10-15');assert.equal(n.plan.subjects.length,3);assert.equal(s.plan.subjects.length,2);
 assert.equal(up(raw(),'2026-12-21').plan.subjects.length,2);assert.equal(S.canApply(raw(),'2026-12-21'),false);
});
test('explicit reapplication only replaces course/math references in the preview range',()=>{
 const s=up();s.plan.targets['2026-10-16'].math=7;s.plan.targets['2026-10-15']['course-review']=12;
 const previous=clone(s),n=M.applyCourseSchedule(s,'2026-10-16');
 assert.deepEqual(s,previous);assert.deepEqual(n.plan.targets['2026-10-15'],previous.plan.targets['2026-10-15']);
 assert.equal(n.plan.targets['2026-10-16'].math,50);assert.deepEqual(n.records,s.records);assert.deepEqual(n.plan.wordTargets,s.plan.wordTargets);
});
test('subject limit and a conflicting course ID do not corrupt legacy data',()=>{
 const s=raw();for(let i=0;i<22;i++)s.plan.subjects.push({id:'other'+i,name:'其他'+i,kind:'custom',defaults:[0,0,0,0,0,0,0]});
 assert.equal(up(s).plan.subjects.length,24);assert.equal(S.canApply(s,'2026-10-15'),false);
 const collision=raw();collision.plan.subjects.push({id:'course-review',name:'自定',kind:'math',defaults:[0,0,0,0,0,0,0]});
 assert.equal(up(collision).plan.subjects.length,3);assert.equal(S.canApply(collision,'2026-10-15'),false);
});
test('agenda follows references and never invents fixed clock times',()=>{
 const n=up();assert.equal(S.agenda(n,'2026-10-14'),null);
 assert.equal(S.agenda(n,'2026-10-17').courseMinutes,60);assert.equal(S.agenda(n,'2026-10-18').mathMinutes,30);
 assert.deepEqual(Object.keys(S.agenda(n,'2026-10-15')).sort(),['courseId','courseMinutes','courseName','courses','mathMinutes','mathName','weekday'].sort());
 const app=fs.readFileSync('app/src/main/assets/app.js','utf8');const agenda=app.slice(app.indexOf('function courseAgenda'),app.indexOf('function todayView'));
 assert.doesNotMatch(agenda,/参考时段|agenda-time|休息 10 分钟|18:40|20:20/);
});
