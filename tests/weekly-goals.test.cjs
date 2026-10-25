'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../app/src/main/assets/model.js'), W = require('../app/src/main/assets/weekly-goals.js');
const seed = require('../app/src/main/assets/seed.json'), copy = structuredClone;
const fresh = () => M.migrateState(copy(seed), '2026-10-18');
const stamp = '2026-10-18T10:00:00.000Z', later = '2026-10-19T12:00:00.000Z', key = '2026-10-12';
const task = (n, extra = {}) => ({ id:'task_'+n, title:'任务 '+n, subjectId:null, done:false, updatedAt:stamp, ...extra });
const goal = tasks => ({ goal:'用户教材与章节', hint:'随记', tasks });
function put(s, k, g) { W.put(s.plan,k,W.prepare(s.plan,k,g,stamp)); M.validateState(s); }

test('schema1/2 clone migration preserves text, quantities, sessions and dates without splitting goals', () => {
 for(const version of [1,2]) {
  const s=copy(seed);s.version=version;s.plan.weekGoals[key]='我的教材\n两段文字';s.plan.weekHints[key]='自己填写';if(version===2)s.plan.manualWeekGoals=true;
  const r=M.record(s,key);r.subjects.math.minutes=0;r.subjects.vocab.newWords=null;M.saveRecord(s,key,r);
  const original=copy(s),next=M.migrateState(s,'2026-10-18');
  assert.deepEqual(s,original);assert.equal(next.version,8);assert.deepEqual(next.plan.weekTasks,{});
  assert.equal(next.plan.weekGoals[key],original.plan.weekGoals[key]);assert.deepEqual(next.records,s.records);assert.deepEqual(next.sessions,s.sessions);
  assert.deepEqual(M.migrateState(next,'2026-10-18'),next);
 }
});
test('stable IDs and exact task contents survive JSON backup and schema-preserving subject/word/schedule operations', () => {
 const s=fresh();put(s,key,goal([task(1,{subjectId:'math',done:true}),task(2)]));
 M.archiveSubject(s,'math','2026-10-18');M.restoreSubject(s,'math','2026-10-19');M.setWordSteps(s,'vocab',[1,2,3]);M.setWordGoal(s,'vocab',40,'2026-10-18');
 M.addSubject(s,'阅读',[0,0,0,0,0,0,0],'2026-10-18');M.moveSubject(s,'vocab',-1);
 const next=M.applyCourseSchedule(s,'2026-10-19');assert.equal(next.version,8);assert.equal(s.version,8);assert.deepEqual(next.plan.weekTasks,s.plan.weekTasks);
 assert.deepEqual(W.snapshot(JSON.parse(JSON.stringify(s)).plan,key),W.snapshot(s.plan,key));
});
test('checking a task changes no learning observations, reference budgets, reviews or historical statistics', () => {
 const s=fresh(),r=M.record(s,key);r.subjects.math.minutes=0;M.saveRecord(s,key,r);
 const before=copy(s),weekly=M.weekStats(s,key),monthly=M.monthStats(s,'2026-10');
 put(s,key,goal([task(1,{done:true})]));
 for(const f of ['records','sessions','reviews'])assert.deepEqual(s[f],before[f]);assert.deepEqual(s.plan.targets,before.plan.targets);
 assert.deepEqual(M.weekStats(s,key),weekly);assert.deepEqual(M.monthStats(s,'2026-10'),monthly);
 assert.equal(s.records[key].subjects.vocab.newWords,null);
});
test('date anchor and history retain old groups after changing start date, teaching labels and plan shortening', () => {
 const s=fresh();put(s,key,goal([task(1,{done:true})]));M.resizePlan(s,s.plan.startDate,s.plan.endDate,20);
 assert.equal(W.active(s.plan,key),true);M.resizePlan(s,'2026-10-13','2026-10-20',20);
 assert.equal(W.active(s.plan,key),false);assert.deepEqual(W.keys(s.plan),[key]);assert.equal(W.snapshot(s.plan,key).tasks[0].done,true);
 assert.equal(W.snapshot(s.plan,'2026-10-13').tasks.length,0);assert.equal(W.end(key),'2026-10-18');
});
test('new weeks and independent plans have no automatic tasks or completion state', () => {
 const a=fresh(),b=fresh();put(a,key,goal([task(1,{done:true})]));assert.deepEqual(W.snapshot(a.plan,'2026-10-19'),{goal:'',hint:'',tasks:[]});assert.deepEqual(b.plan.weekTasks,{});
 const snap=W.snapshot(a.plan,key);snap.tasks[0].title='改快照';assert.notEqual(a.plan.weekTasks[key][0].title,snap.tasks[0].title);
});
test('three-way merge preserves independent task edits and additions by stable ID', () => {
 const base=goal([task(1),task(2)]),current=copy(base),edited=copy(base);
 current.tasks[0].title='外部改名';current.tasks.push(task(3));edited.tasks[0].done=true;edited.tasks.push(task(4));edited.hint='本地随记';
 const result=W.merge(base,current,edited);assert.deepEqual(result.conflicts,[]);
 assert.equal(result.value.tasks.find(t=>t.id==='task_1').title,'外部改名');assert.equal(result.value.tasks.find(t=>t.id==='task_1').done,true);
 assert.deepEqual(new Set(result.value.tasks.map(t=>t.id)),new Set(['task_1','task_2','task_3','task_4']));assert.equal(result.value.hint,'本地随记');
});
test('task deletion versus edit and competing text edits require explicit per-field choices', () => {
 const base=goal([task(1),task(2)]),current=copy(base),edited=copy(base);current.tasks[0].title='新内容';edited.tasks.shift();current.goal='已保存文字';edited.goal='草稿文字';
 const result=W.merge(base,current,edited);assert.deepEqual(new Set(result.conflicts.map(c=>c.key)),new Set(['goal','task_1']));
 const resolved=W.merge(base,current,edited,{goal:'edited',task_1:'current'});assert.equal(resolved.conflicts.length,0);assert.equal(resolved.value.goal,'草稿文字');assert.equal(resolved.value.tasks[0].title,'新内容');
 const deleted=W.merge(base,current,edited,{goal:'current',task_1:'edited'});assert.deepEqual(deleted.value.tasks.map(t=>t.id),['task_2']);
});
test('reordering preserves IDs and detects competing saved orders', () => {
 const base=goal([task(1),task(2),task(3)]),current=copy(base),edited=copy(base);edited.tasks.reverse();
 assert.deepEqual(W.merge(base,current,edited).value.tasks.map(t=>t.id),['task_3','task_2','task_1']);current.tasks=[task(2),task(1),task(3)];
 assert.ok(W.merge(base,current,edited).conflicts.some(c=>c.key==='order'));
 assert.deepEqual(W.merge(base,current,edited,{order:'current'}).value.tasks.map(t=>t.id),['task_2','task_1','task_3']);
});
test('save stamps confirmed content changes once and repeated saves preserve timestamps', () => {
 const s=fresh();put(s,key,goal([task(1)]));let value=W.snapshot(s.plan,key);value.tasks[0].done=true;value=W.prepare(s.plan,key,value,later);W.put(s.plan,key,value);
 assert.equal(value.tasks[0].updatedAt,later);assert.deepEqual(W.prepare(s.plan,key,value,'2026-10-20T00:00:00Z'),value);
});
test('move produces a validated clone, preserves task timestamps, and supports explicit merge/replace', () => {
 const s=fresh();put(s,key,goal([task(1)]));put(s,'2026-10-19',goal([task(2,{done:true})]));const before=copy(s.plan);
 const merged=W.transfer(s.plan,key,'2026-10-19','merge');assert.deepEqual(s.plan,before);assert.equal(W.keys(merged).length,1);assert.equal(merged.weekTasks['2026-10-19'].length,2);assert.equal(merged.weekTasks['2026-10-19'][1].updatedAt,stamp);
 const replaced=W.transfer(s.plan,key,'2026-10-19','replace');assert.deepEqual(replaced.weekTasks['2026-10-19'].map(t=>t.id),['task_1']);
 assert.throws(()=>W.transfer(s.plan,key,key,'merge'));assert.throws(()=>W.transfer(s.plan,key,'2025-01-01','replace'));assert.deepEqual(s.plan,before);
});
test('validation rejects duplicate IDs across weeks, missing subjects, wrong booleans, dates, timestamps and oversized lists', () => {
 const s=fresh();put(s,key,goal([task(1)]));
 const mutations=[x=>x.plan.weekTasks[key][0].done='true',x=>x.plan.weekTasks[key][0].subjectId='absent',x=>x.plan.weekTasks[key][0].title='',x=>x.plan.weekTasks[key][0].updatedAt='yesterday',x=>x.plan.weekTasks[key][0].extra=1,x=>x.plan.weekTasks[key][0].id='constructor',x=>x.plan.weekTasks['2026-10-19']=[task(1)],x=>x.plan.weekTasks['2026-02-30']=[task(2)],x=>x.plan.weekTasks[key]=Array.from({length:51},(_,i)=>task(i)),x=>x.version=2];
 mutations.forEach((mutate,i)=>{const x=copy(s);mutate(x);assert.throws(()=>M.validateState(x),undefined,String(i));});
 const before=copy(s.plan);assert.throws(()=>W.prepare(s.plan,key,goal([task(3,{title:'   '})]),stamp));assert.deepEqual(s.plan,before);
});
test('merge limit failures preserve both source and destination including original empty/zero records', () => {
 const s=fresh();put(s,key,goal([task(99)]));put(s,'2026-10-19',goal(Array.from({length:50},(_,i)=>task(i))));const before=copy(s);
 assert.throws(()=>W.transfer(s.plan,key,'2026-10-19','merge'),/50/);assert.deepEqual(s,before);
});
