'use strict';
const fs=require('node:fs'),path=require('node:path');
const {workload}=require('./baseline-workload.cjs');
const E=require('../app/src/main/assets/evaluation.js');
process.env.COURSE_REPORT_NAME='performance-ui-wrapper-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 const today=h.android('shell','date','+%Y-%m-%d'),results=[];
 for(const days of [70,730]){
  const fixture=workload(days,today);delete fixture.evaluation;E.initialize(fixture,{today:E.shift(fixture.plan.startDate,-1),at:E.shift(fixture.plan.startDate,-1)+'T00:00:00.000Z',timezone:'GMT'});await h.fixtureInstall(fixture);
  if(days===70)fs.writeFileSync(path.join(h.report,'performance-fixture-70-schema9.json'),JSON.stringify(fixture,null,2)+'\n');
  const numbers=[];const measurements=[['nativeReadAndDecode','JSON.parse(Native.getState())'],['nativeReadEncodeAndSave','(()=>{const current=JSON.parse(Native.getState()),out=JSON.parse(Native.saveState(JSON.stringify(current)));if(!out.ok)throw Error(out.error);})()'],['historyAll','StudyModel.historySearch(JSON.parse(Native.getState()),{})'],['monthStats','StudyModel.monthStats(JSON.parse(Native.getState()),'+JSON.stringify(today.slice(0,7))+')']];
  for(const [name,expression]of measurements){const samplesMs=[];for(let i=0;i<3;i++)samplesMs.push(await h.evaluate(`(()=>{const start=performance.now();${expression};return performance.now()-start;})()`));const sorted=samplesMs.slice().sort((a,b)=>a-b);numbers.push({name,samplesMs,medianMs:sorted[1],maxMs:sorted[2]});}
  const saves={name:'nativeWritePreparedPayload',samplesMs:[]};for(let i=0;i<3;i++)saves.samplesMs.push(await h.evaluate('(()=>{const text=Native.getState(),t=performance.now(),out=JSON.parse(Native.saveState(text));if(!out.ok)throw Error(out.error);return performance.now()-t;})()'));saves.medianMs=saves.samplesMs.slice().sort((a,b)=>a-b)[1];saves.maxMs=Math.max(...saves.samplesMs);
  await h.evaluate('onNativeResume()');
  const routes=[];
  for(const route of ['plan','review','history','sessions','inspiration','settings','today']){
   const timing=await h.evaluate(`(async()=>{const t=performance.now();document.querySelector('[data-nav="'+${JSON.stringify(route)}+'"]' ).click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t;})()`);
   routes.push({route,renderThroughTwoFramesMs:timing});
  }
  const nativeBefore=await h.state();
  await h.evaluate('StudyLayout.showSubject("math")');await h.input('#minutes-math','42');
  const savePaint=await h.evaluate('(async()=>{const t=performance.now();document.querySelector("#daily-form").requestSubmit();await new Promise(r=>setTimeout(r,30));for(let i=0;i<700&&document.querySelector("#daily-form .save-feedback")?.textContent.includes("保存中");i++)await new Promise(r=>setTimeout(r,20));if(!document.querySelector("#daily-form .save-feedback")?.textContent.includes("已保存"))throw Error("No confirmed save result");await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t;})()');
  h.check((await h.state()).records[today].subjects.math.minutes===42,days+' day baseline actual form saves forty-two minutes');
  h.check((await h.state()).records[today].subjects.vocab.newWords===nativeBefore.records[today].subjects.vocab.newWords,days+' day baseline daily save retains independent vocabulary');
  results.push({days,recordDays:Object.keys(fixture.records).length,sessions:fixture.sessions.length,stateBytes:Buffer.byteLength(JSON.stringify(fixture)),metrics:numbers.concat([saves]),routes,programmaticRecord:{steps:['open subject editor','fill minutes','save record'],stepCount:3,saveThroughTwoFramesMs:savePaint}});
  await h.shot('baseline-'+days+'-day-today');
 }
 const env={sdk:h.android('shell','getprop','ro.build.version.sdk'),release:h.android('shell','getprop','ro.build.version.release'),timezone:h.android('shell','getprop','persist.sys.timezone'),webView:h.android('shell','dumpsys','webviewupdate').match(/Current WebView package[^\n]*/)?.[0]||'',scope:'3 samples per operation, maximum shown instead of p95; full automatic bases for each synthetic day. Actual Android WebView and native bridge; synthetic states; route and save paint use two animation frames; timings are not vivo measurements'};
 fs.writeFileSync(path.join(h.report,'device-performance.json'),JSON.stringify({environment:env,results},null,2)+'\n');
 h.check(results.every(x=>x.metrics.every(m=>m.samplesMs.every(Number.isFinite))),'all native bridge and WebView timings are finite recorded measurements');
 console.log(JSON.stringify(results.map(x=>({days:x.days,metrics:x.metrics.map(y=>({name:y.name,medianMs:Math.round(y.medianMs)})),recordSavePaintMs:Math.round(x.programmaticRecord.saveThroughTwoFramesMs)}))));
});
