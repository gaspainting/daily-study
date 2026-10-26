'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),R=require('../app/src/main/assets/reference.js'),A=require('../app/src/main/assets/allocation.js');
const now='2026-10-26',at='2026-10-26T07:00:00.000Z',seed=require('../app/src/main/assets/seed.json');
// Legacy allocation behavior remains covered independently of the new fixed-day ledger.
const fresh=()=>{const s=M.migrateState(structuredClone(seed),now);delete s.evaluation;s.version=8;return s;};
const request=s=>({from:now,replaceDaily:false,reassess:true,values:A.template(s)});
const apply=(s,r)=>A.apply(s,r,now,at);
function recorded(s,date){const r=M.record(s,date);r.status='正常参考';r.subjects.math.minutes=50;r.subjects['course-review'].minutes=30;r.subjects.vocab.newWords=40;r.subjects.vocab.reviewWords=0;M.saveRecord(s,date,r);return r;}
test('word allocation changes today and future defaults; past goals and observations stay exact',()=>{
 const s=fresh();recorded(s,'2026-10-20');recorded(s,now);const before=structuredClone(s),r=request(s);r.values.vocab.goal=40;
 const {state:n,report}=apply(s,r);assert.deepEqual(s,before);assert.equal(M.wordTarget(n,now,'vocab'),40);assert.equal(M.wordTarget(n,'2026-12-20','vocab'),40);assert.equal(M.wordTarget(n,'2026-10-25','vocab'),50);assert.deepEqual(n.records,s.records);assert.deepEqual(n.assessmentBases['2026-10-20'],s.assessmentBases['2026-10-20']);assert.equal(R.assess(n,now).words[0].kind,'within');assert.equal(report.reassessed,1);
 assert.deepEqual(n.assessmentBases[now].time,s.assessmentBases[now].time);M.resizePlan(n,n.plan.startDate,'2027-01-10',n.plan.startWeek);assert.equal(M.wordTarget(n,'2027-01-10','vocab'),40);
});
test('future effective date preserves intervening unrecorded dates',()=>{const s=fresh(),r=request(s);r.from='2026-11-01';r.values.vocab.goal=35;const n=apply(s,r).state;assert.equal(M.wordTarget(n,'2026-10-31','vocab'),50);assert.equal(M.wordTarget(n,'2026-11-01','vocab'),35);});
test('retained records outside a shortened plan keep their original fallback goals',()=>{const s=fresh();recorded(s,'2026-10-20');M.resizePlan(s,now,'2026-12-13',s.plan.startWeek);delete s.plan.wordTargets?.['2026-10-20'];const r=request(s);r.values.vocab.goal=40;r.values.math.defaults[0]={min:60,max:100};const n=apply(s,r).state;assert.equal(M.wordTarget(n,'2026-10-20','vocab'),50);assert.deepEqual(n.assessmentBases['2026-10-20'],s.assessmentBases['2026-10-20']);assert.deepEqual(n.records,s.records);});
test('explicit zero and custom word goals can be retained or replaced',()=>{const s=fresh();s.plan.wordTargets={[now]:{vocab:0},'2026-10-27':{vocab:70}};const r=request(s);r.values.vocab.goal=40;let out=apply(s,r);assert.equal(M.wordTarget(out.state,now,'vocab'),0);assert.equal(M.wordTarget(out.state,'2026-10-27','vocab'),70);assert.equal(out.report.keptDaily,2);r.replaceDaily=true;out=apply(s,r);assert.equal(M.wordTarget(out.state,now,'vocab'),40);assert.equal(M.wordTarget(out.state,'2026-10-27','vocab'),40);});
test('applying a later word change works after earlier per-day snapshots',()=>{let s=fresh();M.setWordGoal(s,'vocab',40,now);const r=request(s);r.values.vocab.goal=30;s=apply(s,r).state;assert.equal(M.wordTarget(s,'2026-10-27','vocab'),30);assert.equal(M.wordTarget(s,'2026-10-25','vocab'),50);});
test('changed weekdays apply to every matching future date without flattening other days',()=>{
 const s=fresh(),r=request(s),original=structuredClone(s.plan.targets);r.values.math.defaults[0]={min:60,max:100};const n=apply(s,r).state;
 for(const date of M.dates(s.plan.startDate,s.plan.endDate)){const changed=date>=now&&new Date(date+'T12:00:00Z').getUTCDay()===1;assert.deepEqual(n.plan.targets[date].math,changed?{min:60,max:100}:original[date].math);assert.deepEqual(n.plan.targets[date]['course-review'],original[date]['course-review']);}
 assert.deepEqual(R.range(R.total(n,now)),{min:80,max:140,legacy:false});
});
test('weekend allocations and point targets survive repeated automatic JS migration and extension',()=>{
 const s=fresh(),r=request(s);r.values.math.defaults[5]={min:210,max:270};r.values.math.defaults[6]={min:30,max:30};let n=apply(s,r).state;
 for(let i=0;i<4;i++)n=M.migrateState(n,now);
 assert.deepEqual(n.plan.targets['2026-10-31'].math,{min:210,max:270});assert.equal(R.text(n.plan.targets['2026-11-01'].math),'30');M.resizePlan(n,n.plan.startDate,'2027-01-10',n.plan.startWeek);n=M.migrateState(n,now);assert.deepEqual(n.plan.targets['2027-01-02'].math,{min:210,max:270});
});
test('manual day time overrides are retained unless replacement is selected',()=>{
 const s=fresh();s.plan.targets[now].math={min:12,max:19};s.plan.manualReferences={[now]:['math']};const r=request(s);r.values.math.defaults[0]={min:50,max:90};let n=apply(s,r).state;assert.deepEqual(n.plan.targets[now].math,{min:12,max:19});r.replaceDaily=true;n=apply(s,r).state;assert.deepEqual(n.plan.targets[now].math,{min:50,max:90});assert.ok(!n.plan.manualReferences[now]);
});
test('a second overall time allocation replaces the previous overall defaults',()=>{let s=fresh(),r=request(s);r.values.math.defaults[0]={min:50,max:90};s=apply(s,r).state;r=request(s);r.values.math.defaults[0]={min:65,max:95};s=apply(s,r).state;assert.deepEqual(s.plan.targets[now].math,{min:65,max:95});});
test('unrecorded history using fallback references is frozen before default changes',()=>{
 const s=fresh();delete s.plan.targets['2026-10-19'].math;const old=M.reference(s,'2026-10-19','math'),r=request(s);r.values.math.defaults[0]={min:65,max:95};const n=apply(s,r).state;assert.deepEqual(M.reference(n,'2026-10-19','math'),old);assert.ok(!Object.hasOwn(n.records,'2026-10-19'));
});
test('reassessment replaces only changed dimensions and can retain original criteria',()=>{
 const s=fresh();recorded(s,now);s.assessmentBases[now].time[0].reference={min:11,max:22};const r=request(s);r.values.vocab.goal=35;const n=apply(s,r).state;assert.deepEqual(n.assessmentBases[now].time,s.assessmentBases[now].time);assert.equal(n.assessmentBases[now].words[0].goal,35);r.reassess=false;assert.deepEqual(apply(s,r).state.assessmentBases[now],s.assessmentBases[now]);
});
test('quantity defaults remain separate from minutes and preserve custom and historical units',()=>{
 const s=fresh(),q=M.addSubject(s,'练习',[5,5,5,5,5,5,5],s.plan.startDate,'quantity','题'),r=request(s);s.plan.quantityTargets[now][q.id]=0;r.values[q.id].defaults=[10,10,10,10,10,10,10];let out=apply(s,r);assert.equal(M.quantityTarget(out.state,now,q.id),0);assert.equal(M.quantityTarget(out.state,'2026-10-27',q.id),10);assert.deepEqual(R.total(out.state,now),R.total(s,now));
 s.plan.quantityUnits={[now]:{[q.id]:'页'}};r.replaceDaily=true;out=apply(s,r);assert.equal(M.quantityTarget(out.state,now,q.id),0);assert.equal(out.report.keptUnits,1);
});
test('rest, partial, zero, notes, sessions and reviews are not rewritten by allocation',()=>{
 const s=fresh();const r=recorded(s,now);r.status='休息';r.subjects.math.minutes=null;r.subjects['course-review'].minutes=0;r.note='安排随记';M.saveRecord(s,now,r);s.sessions=[{id:'sample-session',date:now,subjectId:'math',seconds:12,endedAt:at}];const req=request(s);req.values.vocab.goal=40;const n=apply(s,req).state;assert.deepEqual(n.records,s.records);assert.deepEqual(n.sessions,s.sessions);assert.deepEqual(n.reviews,s.reviews);assert.equal(R.assess(n,now).time.kind,'rest');assert.equal(n.records[now].subjects.math.minutes,null);
});
test('invalid ranges quantities dates subjects and modes reject without mutating input',()=>{
 const s=fresh(),before=structuredClone(s);const invalid=[r=>r.from='2026-10-25',r=>r.from='2027-02-30',r=>r.from='2027-01-01',r=>r.values.vocab.goal=1.5,r=>r.values.vocab.goal=-1,r=>r.values.math.defaults[0]={min:90,max:30},r=>r.values.math.defaults.pop(),r=>r.values.math.defaults[0]={min:0,max:1441},r=>r.values.unknown={goal:1},r=>r.replaceDaily='yes',r=>r.values.math.extra=1];
 invalid.forEach(fn=>{const r=request(s);fn(r);assert.throws(()=>apply(s,r));assert.deepEqual(s,before);});
});
test('unchanged and repeated allocation leave the same targets and criteria',()=>{const s=fresh(),r=request(s);assert.deepEqual(apply(s,r).state,s);r.values.vocab.goal=40;const n=apply(s,r).state;assert.deepEqual(apply(n,r).state,n);assert.equal(apply(n,r).report.changes.length,0);});
