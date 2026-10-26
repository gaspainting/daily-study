'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),C=require('../app/src/main/assets/courses.js');
const seed=require('../app/src/main/assets/seed.json'),date='2026-10-26';
function fixture(version=8){
 const s=M.migrateState(structuredClone(seed),date),r=M.record(s,date);
 Object.assign(r.subjects.vocab,{newWords:5,reviewWords:0,wordLog:{base:{newWords:null,reviewWords:0},entries:[{id:'batch_kept',kind:'new',operation:'add',count:5,at:date+'T12:00:00Z',source:'quick'}]}});
 r.status='正常参考';M.saveRecord(s,date,r);s.version=version;if(version<9)delete s.evaluation;
 if(version>=8){s.plan.manualReferences={[date]:['math']};s.plan.manualReferenceDefaults=['math'];s.plan.quantityUnits={};}
 M.validateState(s);return s;
}
for(const version of [7,8,9]){
 for(const operation of ['review','timetable','change'])test('course '+operation+' preserves schema '+version+' word batches and newer plan fields',()=>{
  const s=fixture(version),before=structuredClone(s);let next;
  if(operation==='review'){const base=C.checklist(s,date),rows=structuredClone(base);rows[0].done=true;rows[0].note='保留的复习笔记';next=C.saveReviews(s,date,rows,base);assert.equal(next.courseReviews[date][0].done,true);}
  if(operation==='timetable'){const v=structuredClone(C.version(s,date));v.from=date;v.courses[0].name='调整课程名';next=C.putVersion(s,v,date);}
  if(operation==='change'){const c=C.base(s,date)[0];next=C.putChange(s,{id:'schema_change',courseId:c.id,fromDate:date,toDate:'2026-10-27',note:'补课'},date);}
  assert.equal(next.version,version);M.validateState(next);
  for(const key of ['records','sessions','assessmentBases'])assert.deepEqual(next[key],before[key]);
  for(const key of ['manualReferences','manualReferenceDefaults','quantityUnits'])assert.deepEqual(next.plan[key],before.plan[key]);
  assert.deepEqual(s,before,'operations do not alter the caller snapshot');
 });
}
test('unchanged checklist repeat save retains newer data version and batch identity',()=>{
 const s=fixture(),base=C.checklist(s,date),once=C.saveReviews(s,date,base,base),twice=C.saveReviews(once,date,base,base);
 M.validateState(twice);assert.deepEqual(twice,once);assert.equal(twice.records[date].subjects.vocab.wordLog.entries[0].id,'batch_kept');
});
