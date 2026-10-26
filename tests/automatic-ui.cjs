'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),E=require('../app/src/main/assets/evaluation.js');
process.env.COURSE_REPORT_NAME='automatic-ui-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 const {M,check,evaluate,input,click,state,day,native}=h,today=E.context('Asia/Shanghai',Number(h.android('shell','date','+%s'))*1000).today;
 async function submit(selector,answer){return evaluate(`(async()=>{const original=window.confirm;${answer===undefined?'':`window.confirm=()=>${answer};`}try{document.querySelector(${JSON.stringify(selector)}).requestSubmit();await new Promise(r=>setTimeout(r,40));for(let i=0;i<300&&document.querySelector(${JSON.stringify(selector)}+" .save-feedback")?.textContent.includes("保存中");i++)await new Promise(r=>setTimeout(r,30));}finally{window.confirm=original;}})()`);}

 function fixture(){const s=M.migrateState(structuredClone(require('../app/src/main/assets/seed.json')),today);delete s.evaluation;s.plan.startDate=E.shift(today,-8);s.plan.endDate=E.shift(today,14);s.plan.targets={};s.plan.wordTargets={};s.records={};s.assessmentBases={};s.plan.subjects.forEach(x=>{if(x.kind==='vocab')x.wordGoal=40;else x.defaults=Array(7).fill({min:30,max:60});});E.initialize(s,{today:E.shift(today,-8),at:E.shift(today,-8)+'T04:00:00.000Z',timezone:'Asia/Shanghai'});M.validateState(s);return s;}
 const source=fixture();await h.fixtureInstall(source);await day(today);
 check(await evaluate('document.querySelector("#daily-form").dataset.automaticEvaluation==="true"&&document.querySelectorAll("input[type=radio][name=status]").length===0'),'daily automatic flow removes the mode selector');
 check(await evaluate('document.querySelector(".automatic-assessment").innerText.includes("未记录")'),'empty saved day remains unrecorded');
 await evaluate('StudyLayout.showSubject("math")');await input('#minutes-math','0');await evaluate('document.querySelector(".layout-editor[open] [data-layout-done]")?.click()');
 await submit('#daily-form');
 if(!(await state()).records[today])throw Error(await evaluate('document.querySelector("#daily-form .save-feedback")?.innerText||document.querySelector("#daily-form").innerText'));
 check((await state()).records[today].subjects.math.minutes===0&&(await state()).records[today].subjects['course-review'].minutes===null,'saving one zero preserves other blank subjects');
 check(await evaluate('document.querySelector(".automatic-day-result").textContent==="待补全"'),'zero plus blank is partial, not all-day zero');
 await evaluate('StudyLayout.showSubject("math")');await input('#minutes-math','45');await evaluate('document.querySelector(".layout-editor[open] [data-layout-done]")?.click()');
 await evaluate('StudyLayout.showSubject("course-review")');await input('#minutes-course-review','45');await evaluate('document.querySelector(".layout-editor[open] [data-layout-done]")?.click()');
 await evaluate('StudyLayout.showSubject("vocab")');await input('#newWords-vocab','40');await evaluate('document.querySelector(".layout-editor[open] [data-layout-done]")?.click()');
 check((await state()).records[today].subjects.math.minutes===0,'unsaved edits do not change the formal evaluation');
 try{h.shell('chmod 550 files');await submit('#daily-form');check(await evaluate('document.querySelector("#daily-form .save-feedback").textContent.includes("保存失败")&&document.querySelector("#minutes-math").value==="45"'),'native write failure keeps the edited values and offers retry');}finally{h.shell('chmod 700 files');}
 await click('#daily-form [data-action=retry-save]');
 check(await evaluate('document.querySelector(".automatic-day-result").textContent==="全部必达目标已完成"'),'native save success publishes the complete overall result');
 check(await evaluate('document.querySelector("[data-auto-goal=\\"total-time\\"]").textContent==="标准达标"'),'ninety saved minutes receives the middle interval band');
 let saved=await state();const revision=saved._revision;await submit('#daily-form');check((await state())._revision===revision,'repeat daily save does not add a revision or duplicate an event');
 await click('#today-module-tab-assessment');await h.shot('automatic-today-saved','.automatic-assessment');
 // Editing execution targets must not lower the fixed primary result.
 await click('.range-edit');
 // Fall back to the visible total edit entry on builds with no scope attribute.
 await input('#reference-total','30');await input('#reference-total\\:max','60');await input('#target-vocab','10');
 check(await evaluate('!document.querySelector("#reference-assessment")'),'automatic reference editing offers no replacement of the original assessment');
 await submit('#reference-form');
 saved=await state();check(saved.evaluation.bases[today].items.find(x=>x.id==='total-time').min===60,'same-day target edits keep the original frozen minimum');
 await click('[data-action=assessment-basis]');check(await evaluate('document.querySelector("dialog[open]").innerText.includes("调整后对照")'),'basis details show the original and adjusted comparison');await h.shot('automatic-basis');await click('[data-action=close-sheet]');
 // Existing native session evidence must prompt a concrete correction.
 const timed=fixture(),r=M.record(timed,today);r.subjects.math.minutes=30;r.subjects['course-review'].minutes=45;r.subjects.vocab.newWords=40;M.saveRecord(timed,today,r);timed.sessions=[{id:'source_timer',date:today,subjectId:'math',seconds:1800,endedAt:today+'T05:00:00Z'}];await h.fixtureInstall(timed);await day(today);
 await evaluate('StudyLayout.showSubject("math")');await input('#minutes-math','10');await evaluate('document.querySelector(".layout-editor[open] [data-layout-done]")?.click()');

 await submit('#daily-form',false);check((await state()).records[today].subjects.math.minutes===30,'cancelling a lower manual total keeps the formal timer total');
 await submit('#daily-form',true);saved=await state();check(saved.records[today].timeCorrections.math.timerSeconds===1800&&saved.records[today].subjects.math.minutes===10,'confirmed correction saves its source and actual value together');
 // Real native future-only schedule command, including its editor and confirmation.
 await click('[data-nav=plan]');await click('[data-action=evaluation-schedule]');await input('#evaluation-scope','date','change');await input('#evaluation-date',E.shift(today,1),'change');await input('#evaluation-type','review','change');await input('#evaluation-reviewMin','45');await input('#evaluation-reviewMax','60');await input('#evaluation-reviewWords','80');
 await submit('#evaluation-schedule-form',true);saved=await state();if(saved.evaluation.bases[E.shift(today,1)].dayType!=='review')throw Error(await evaluate('document.querySelector("#evaluation-schedule-form .save-feedback")?.textContent||document.querySelector("dialog[open]")?.textContent||"Schedule result missing"'));check(saved.evaluation.bases[E.shift(today,1)].dayType==='review'&&saved.evaluation.bases[today].dayType==='study','schedule editor commits tomorrow review without changing today');
 await click('[data-action=evaluation-schedule]');await input('#evaluation-scope','date','change');await input('#evaluation-date',E.shift(today,2),'change');await input('#evaluation-type','rest','change');await submit('#evaluation-schedule-form',true);saved=await state();check(saved.evaluation.bases[E.shift(today,2)].dayType==='rest','advance rest requires a saved explicit future schedule');
 await day(E.shift(today,2));await click('#today-module-tab-assessment');check(await evaluate('document.querySelector(".automatic-day-result").textContent==="计划休息"'),'planned rest appears without grading it as success');await h.shot('automatic-planned-rest','.automatic-assessment');
 await day(E.shift(today,1));await click('#today-module-tab-assessment');await h.shot('automatic-planned-review','.automatic-assessment');
 await h.boot();await day(today);check(await evaluate('document.querySelectorAll("input[type=radio][name=status]").length===0'),'cold restart retains automatic mode and fixed criteria');
 // Closed-day coverage example, actual WebView rendering of the new statistics.
 let stats=fixture();const days=Array.from({length:7},(_,i)=>E.shift(today,i-7));stats=E.scheduleChange(stats,{from:days[0],scope:'date',date:days[6],config:E.defaultConfig('rest')},{today:E.shift(today,-8),at:E.shift(today,-8)+'T04:00:00.000Z',timezone:'Asia/Shanghai'});for(let i=0;i<4;i++){const x=M.record(stats,days[i]);x.subjects.math.minutes=i===3?10:45;x.subjects['course-review'].minutes=i===3?10:45;x.subjects.vocab.newWords=40;M.saveRecord(stats,days[i],x);}await h.fixtureInstall(stats);await day(today);
 const summary=await evaluate(`StudyEvaluationUI.stats(JSON.parse(Native.getState()),${JSON.stringify(days)},${JSON.stringify(today)})`);check(summary.includes('50%')&&summary.includes('66.7%')&&summary.includes('75%'),'actual WebView statistics show plan rate, coverage and the conditional secondary rate');
 await evaluate('document.querySelector("[data-nav=review]").click()');await click('[data-nav=month]');await h.shot('automatic-month-statistics','.automatic-statistics');
 // Layout plus accessibility-tree checks; spoken TalkBack still needs a device.
 await day(today);await h.protocol('Emulation.setDeviceMetricsOverride',{width:320,height:760,deviceScaleFactor:1,mobile:true});h.android('shell','settings','put','system','font_scale','1.5');await h.boot();await day(today);await h.protocol('Emulation.setDeviceMetricsOverride',{width:320,height:760,deviceScaleFactor:1,mobile:true});await click('#today-module-tab-assessment');
 const bounds=await evaluate('({width:innerWidth,body:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll(".automatic-assessment button")].map(e=>({text:e.textContent.trim(),height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width}))})');fs.writeFileSync(path.join(h.report,'automatic-layout-debug.json'),JSON.stringify(bounds,null,2));check(bounds.body<=bounds.width+1&&bounds.buttons.every(x=>x.text&&x.height>=40),'small-screen large-font automatic card has labelled reachable actions without horizontal overflow');
 const ax=await h.protocol('Accessibility.getFullAXTree',{});check(ax.nodes.some(n=>n.name?.value==='今日评估')&&ax.nodes.some(n=>n.name?.value==='查看依据'),'Android WebView accessibility tree exposes assessment and basis actions');await h.shot('automatic-large-font');
 fs.writeFileSync(path.join(h.report,'automatic-layout-measurements.json'),JSON.stringify({today,bounds,scope:'Android36 actual WebView, synthetic fixtures; JS confirmations controlled for positive/cancel cases; no TalkBack speech or physical vivo test'},null,2)+'\n');
});
