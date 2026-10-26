'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
process.env.COURSE_REPORT_NAME=process.env.COURSE_REPORT_NAME||'baseline-recovery-ui-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 const {M,fixtureInstall,state,native,day,click,input,evaluate,check,delay}=h,today=await h.android('shell','date','+%Y-%m-%d');
 const source=()=>M.migrateState(structuredClone(require('../app/src/main/assets/seed.json')),today),s=source(),r=M.record(s,today);
 Object.assign(r.subjects.vocab,{newWords:5,reviewWords:0,wordLog:{base:{newWords:null,reviewWords:0},entries:[{id:'batch_ui_kept',kind:'new',operation:'add',count:5,at:today+'T12:00:00Z',source:'quick'}]}});
 r.status='正常参考';M.saveRecord(s,today,r);await fixtureInstall(s);await day(today);
 check((await state()).records[today].subjects.vocab.wordLog.entries.length===1,'actual native state contains the pre-existing saved word batch');
 if(process.env.BASELINE_FILTER_ONLY!=='1'){
 await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="课程").click()');
 await click('#cr-0-done');await input('#cr-0-note','例题复习笔记');
 const before=await state();await evaluate('document.querySelector("#course-review-form").requestSubmit()');await delay(250);
 await h.shot(process.env.BASELINE_PHASE==='before'?'course-review-before':'course-review-saved');
 fs.writeFileSync(path.join(h.report,'course-review-observation-'+(process.env.BASELINE_PHASE||'after')+'.json'),JSON.stringify(await evaluate('({feedback:document.querySelector("#course-review-form .save-feedback")?.innerText,checked:document.querySelector("#cr-0-done")?.checked,note:document.querySelector("#cr-0-note")?.value})'),null,2));
 let saved=await state();check(saved.courseReviews?.[today]?.[0]?.done&&saved.courseReviews[today][0].note==='例题复习笔记','course checklist saves with an existing wordLog and retains its checked state and note');
 assert.deepEqual(saved.records,before.records);assert.deepEqual(saved.assessmentBases,before.assessmentBases);check(saved.version===9,'checklist save preserves schema9, all observations and assessment criteria');
 const revision=saved._revision;await evaluate('document.querySelector("#course-review-form").requestSubmit()');await delay(120);check((await state())._revision===revision,'repeat checklist save does not create another formal revision');
 await input('#cr-0-note','写入失败后重试');
 try{h.shell('chmod 550 files');await evaluate('document.querySelector("#course-review-form").requestSubmit()');await delay(120);check(await evaluate('document.querySelector("#course-review-form .save-feedback").innerText.includes("保存失败")&&document.querySelector("#cr-0-note").value==="写入失败后重试"'),'actual native write failure retains course input and shows retry');assert.deepEqual(await state(),saved);}finally{h.shell('chmod 700 files');}
 await click('#course-review-form [data-action=retry-save]');saved=await state();check(saved.courseReviews[today][0].note==='写入失败后重试','Retry commits the retained course input');
 await h.boot();await day(today);check(await evaluate('document.querySelector("#cr-0-done").checked&&document.querySelector("#cr-0-note").value==="写入失败后重试"'),'cold restart retains saved course completion and note');
 }
 // Restore notification must clear filters whose subjects belong to old data.
 const current=await state();current.plan.subjects.push({id:'removed_subject',name:'恢复前科目',kind:'custom',defaults:[0,0,0,0,0,0,0]});
 check((await native('saveState',JSON.stringify(current))).ok,'install a subject which will be absent from the restored plan');await evaluate('onNativeResume()');
 await click('[data-nav=review]');await click('[data-nav=history]');await input('#tracking-subject','removed_subject','change');await click('[data-action=tracking-search]');
 await click('[data-nav=sessions]');await input('#sessions-subject','removed_subject','change');await click('[data-action=tracking-sessions-search]');await click('[data-nav=settings]');
 const restored=source();restored._revision=(await state())._revision;
 check((await native('saveState',JSON.stringify(restored))).ok,'replace formal state with a valid plan lacking the old subject');await evaluate('onBackupRestored()');
 await click('[data-nav=review]');await click('[data-nav=history]');
 fs.writeFileSync(path.join(h.report,'restore-filter-observation-'+(process.env.BASELINE_PHASE||'after')+'.json'),JSON.stringify(await evaluate('({historyVisible:!!document.querySelector("#tracking-subject"),feedback:document.querySelector("#toast").textContent})'),null,2));
 check(await evaluate('!!document.querySelector("#tracking-subject")&&document.querySelector("#tracking-subject").value===""'),'history remains accessible after restore removes a previously filtered subject');
 await click('[data-nav=sessions]');check(await evaluate('document.querySelector("#sessions-subject").value===""'),'session filter resets to all subjects after data restore');
});
