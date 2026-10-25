'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),C=require('../app/src/main/assets/courses.js'),R=require('../app/src/main/assets/reference.js');
const seed=require('../app/src/main/assets/seed.json'),fresh=()=>M.migrateState(structuredClone(seed),'2026-10-19'),date='2026-10-19';
test('legacy migration is a view and seeds only the original semester with verified period labels',()=>{
 const old=structuredClone(seed),before=structuredClone(old),s=M.migrateState(old,date);assert.deepEqual(old,before);assert.equal(s.version,8);assert.equal(s.plan.courseSchedule.versions[0].courses.length,16);assert.deepEqual(C.occurrences(s,date).map(c=>c.slot),['3—4节','6—7节','8—9节']);assert.equal(C.occurrences(s,'2026-10-15').length,3);assert.equal(C.occurrences(s,'2026-10-22').length,2);assert.deepEqual(s.records,old.records);
 const custom=structuredClone(seed);custom.plan.endDate='2026-12-19';assert.equal(C.occurrences(M.migrateState(custom,date),date).length,0);
});
test('effective revisions preserve prior dates and do not change actuals criteria or reference intervals',()=>{
 let s=fresh();const r=M.record(s,date);r.subjects.math.minutes=0;r.subjects['course-review'].minutes=null;r.status='休息';M.saveRecord(s,date,r);
 const v=structuredClone(C.version(s,date));v.from=date;v.courses[0].name='新版课程';const before=structuredClone(s);s=C.putVersion(s,v,date);assert.equal(C.occurrences(s,date)[0].name,'新版课程');assert.equal(C.occurrences(s,'2026-10-12')[0].name,'光电子学');for(const k of ['records','assessmentBases'])assert.deepEqual(s[k],before[k]);assert.deepEqual(s.plan.targets,before.plan.targets);assert.deepEqual(R.assess(s,date),R.assess(before,date));assert.throws(()=>C.putVersion(s,{...v,from:'2026-10-18'},date));
 const later={...v,from:'2026-10-26'};s=C.putVersion(s,later,date);assert.throws(()=>C.putVersion(s,v,date));
});
test('parity is based on teaching week and semester boundaries include both end weeks',()=>{
 let s=fresh();const v={from:date,anchor:date,startWeek:9,courses:[{id:'c',name:'单周课',day:0,slot:'',firstWeek:9,lastWeek:11,parity:'odd'}]};s=C.putVersion(s,v,date);assert.equal(C.occurrences(s,date).length,1);assert.equal(C.occurrences(s,'2026-10-26').length,0);assert.equal(C.occurrences(s,'2026-11-02').length,1);assert.equal(C.occurrences(s,'2026-11-09').length,0);
});
test('move cancel and reversal operate on one occurrence including arrival across versions',()=>{
 const s=fresh(),c=C.base(s,date)[0];let next=C.putChange(s,{id:'change_1',courseId:c.id,fromDate:date,toDate:'2026-10-21',note:'补课'},date);assert.equal(C.occurrences(next,date).length,2);const moved=C.occurrences(next,'2026-10-21').find(x=>x.key===c.key);assert.equal(moved.originDate,date);assert.equal(moved.date,'2026-10-21');assert.equal(moved.changeNote,'补课');assert.throws(()=>C.putChange(next,{id:'x',courseId:c.id,fromDate:date,toDate:null,note:''},date));assert.deepEqual(C.removeChange(next,'change_1',date).plan.courseSchedule,s.plan.courseSchedule);
 assert.throws(()=>C.removeChange(next,'change_1','2026-10-20'));assert.throws(()=>C.putChange(s,{id:'x',courseId:c.id,fromDate:date,toDate:date,note:''},date));
 next=C.putChange(s,{id:'cancel_1',courseId:c.id,fromDate:date,toDate:null,note:''},date);assert.equal(C.occurrences(next,date).length,2);assert.throws(()=>C.putChange(s,{id:'x',courseId:'missing',fromDate:date,toDate:null,note:''},date));
 const v=structuredClone(C.version(s,date));v.from=date;v.courses=v.courses.filter(x=>x.id!==c.id);assert.throws(()=>C.putVersion(next,v,date));
});
test('weekend checklist covers this week once per course and respects cancelled meetings',()=>{
 const s=fresh(),names=C.checklist(s,'2026-10-25').map(r=>r.name);assert.equal(names.length,new Set(names).size);assert.ok(names.includes('物理光学'));assert.ok(names.includes('激光原理'));assert.equal(names.includes('大学生就业指导'),true);assert.ok(C.checklist(s,'2026-10-25').every(r=>r.slot==='本周回顾'&&r.originDate<='2026-10-25'));const v=structuredClone(C.version(s,date));v.from=date;v.courses.push({id:'sunday',name:'周日课',day:6,firstWeek:1,lastWeek:18,parity:'all',slot:''});const next=C.putVersion(s,v,date);assert.ok(!C.checklist(next,'2026-10-24').some(r=>r.name==='周日课'));assert.ok(C.checklist(next,'2026-10-25').some(r=>r.name==='周日课'));
});
test('checklist save retains snapshots independently of minute grades weekly tasks and drafts',()=>{
 let s=fresh();const week=M.weekInfo(s.plan,date).key;s.plan.weekTasks[week]=[{id:'task_1',title:'教材例题',done:false,subjectId:'course-review',updatedAt:'2026-10-19T01:00:00.000Z'}];
 const baseline=C.checklist(s,date),rows=structuredClone(baseline);rows[0].done=true;rows[0].note='待看第二题';rows[0].task={week,id:'task_1',title:'教材例题'};const before=structuredClone(s);s=C.saveReviews(s,date,rows,baseline);assert.equal(C.summary(s,date),'1/3 门已复习');assert.deepEqual(s.records,before.records);assert.deepEqual(s.assessmentBases,before.assessmentBases);assert.deepEqual(s.plan.weekTasks,before.plan.weekTasks);assert.deepEqual(before.courseReviews,undefined);assert.deepEqual(C.saveReviews(s,date,rows,baseline),s);
 let v=structuredClone(C.version(s,date));v.from=date;v.courses[0].name='重命名';s=C.putVersion(s,v,date);assert.equal(C.checklist(s,date)[0].name,'光电子学');s.plan.weekTasks[week]=[];assert.doesNotThrow(()=>C.saveReviews(s,date,C.checklist(s,date),C.checklist(s,date)));before.plan.weekTasks[week]=[];assert.throws(()=>C.saveReviews(before,date,rows,baseline));
});
test('concurrent checklist edits merge different fields and reject a conflicting field',()=>{
 let s=fresh();const base=C.checklist(s,date),a=structuredClone(base),b=structuredClone(base);a[0].done=true;s=C.saveReviews(s,date,a,base);b[0].note='并发笔记';s=C.saveReviews(s,date,b,base);assert.equal(s.courseReviews[date][0].done,true);assert.equal(s.courseReviews[date][0].note,'并发笔记');b[0].note='另一个笔记';assert.throws(()=>C.saveReviews(s,date,b,base));
});
test('strict backup validation rejects corrupt timetable and checklist fields',()=>{
 const s=fresh();const mutations=[x=>x.plan.courseSchedule.changes.push({id:'bad',courseId:'missing',fromDate:date,toDate:null,note:''}),x=>x.plan.courseSchedule.extra=1,x=>x.plan.courseSchedule.versions=[],x=>x.plan.courseSchedule.versions[0].anchor='2026-10-13',x=>x.plan.courseSchedule.versions[0].startWeek=1.5,x=>x.plan.courseSchedule.versions[0].courses[0].parity='any',x=>x.plan.courseSchedule.versions[0].courses[0].lastWeek=0,x=>x.plan.courseSchedule.versions[0].courses[0].id='constructor',x=>x.plan.courseSchedule.versions[0].courses.push(structuredClone(x.plan.courseSchedule.versions[0].courses[0])),x=>x.courseReviews={'2026-02-30':[]},x=>{x.courseReviews={[date]:C.checklist(x,date)};x.courseReviews[date][0].done=1;},x=>{x.courseReviews={[date]:C.checklist(x,date)};x.courseReviews[date][0].key='wrong';},x=>{x.courseReviews={[date]:C.checklist(x,date)};x.courseReviews[date][0].task={week:date,id:'task_1',title:'x',extra:1};}];for(const change of mutations){const x=structuredClone(s);change(x);assert.throws(()=>M.validateState(x));}assert.doesNotThrow(()=>M.validateState(JSON.parse(JSON.stringify(s))));
});
test('explicit interval arrangement reads the edited timetable while keeping saved day criteria',()=>{
 let s=fresh(),v=structuredClone(C.version(s,date));v.from=date;v.courses=v.courses.filter(c=>c.day!==0);s=C.putVersion(s,v,date);const next=M.applyCourseSchedule(s,date);assert.deepEqual(next.plan.targets[date]['course-review'],{min:20,max:40});assert.deepEqual(next.plan.targets[date].math,{min:40,max:80});assert.deepEqual(s.plan.targets['2026-10-18'],next.plan.targets['2026-10-18']);
});
