'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Model=require('../app/src/main/assets/model.js'),Tracking=require('../app/src/main/assets/tracking.js');
const {reference,workload}=require('./audit-workload.cjs');const Old=reference(),clean=x=>JSON.parse(JSON.stringify(x));
test('history optimization retains exact rows, order, null/zero states and combined filter behavior',()=>{
 const s=workload();for(const f of [{},{keyword:'查找目标'},{subjectId:'vocab',recordKind:'partial'},{status:'休息',from:'2011-01-01',to:'2011-03-01'},{recordKind:'zero'},{keyword:'does not exist'}])assert.deepEqual(Model.historySearch(s,f),clean(Old.historySearch(s,f)));
});
test('session optimization preserves root precedence, legacy deduplication, filtering and timestamp order',()=>{
 const s=workload();for(const f of [{},{subjectId:'math'},{from:'2011-01-01',to:'2011-01-15'},{subjectId:'reading',from:'2011-02-01'}])assert.deepEqual(Model.sessionSearch(s,f),clean(Old.sessionSearch(s,f)));
 const out=Model.sessionSearch(s,{});out[0].seconds=9999;assert.notEqual(s.sessions.at(-1).seconds,9999);
});
test('statistical results stay unchanged across archive periods, old time records and count goals',()=>{
 const s=workload(50);s.plan.subjects[0].activePeriods=[{from:'1900-01-01',to:'2026-10-14'}];
 s.plan.wordTargets={'2026-10-14':{vocab:0}};
 assert.deepEqual(Model.weekStats(s,'2026-10-14'),clean(Old.weekStats(s,'2026-10-14')));
 assert.deepEqual(Model.monthStats(s,'2026-10'),clean(Old.monthStats(s,'2026-10')));
 assert.deepEqual(Model.wordStats(s,['2026-10-13','2026-10-14']),clean(Old.wordStats(s,['2026-10-13','2026-10-14'])));
});
test('word only monthly statistics omit the contradictory no subject record message',()=>{
 const s=workload(1);s.plan.subjects=s.plan.subjects.filter(x=>x.id==='vocab');s.records={};s.sessions=[];
 Object.values(s.plan.targets).forEach(t=>Object.keys(t).filter(id=>id!=='vocab').forEach(id=>delete t[id]));
 const day='2026-10-14';s.records[day]={subjects:{vocab:{minutes:null,content:'',problem:'',newWords:0,reviewWords:10,forgotWords:''}},status:null,restKept:null,note:''};
 const html=Tracking.renderMonth(s,'2026-10');assert.ok(html.includes('10 个'));assert.ok(!html.includes('暂无科目记录'));
});
