'use strict';
const {connect,android,delay}=require('./cdp-client.cjs');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/seed.json'),'utf8'));
const out=path.join(__dirname,'../docs/screenshots');fs.mkdirSync(out,{recursive:true});
(async()=>{
  android('shell','pm','grant','cn.edu.njupt.studycheckin','android.permission.POST_NOTIFICATIONS');
  const c=await connect();const results=[];let original;
  await c.evaluate('window.InspirationUI && window.InspirationUI.back()');
  const state=()=>c.evaluate('JSON.parse(Native.getState())');
  const click=async selector=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.click();return true})()`);await delay(220);};
  const set=async(selector,value)=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);};
  const submit=async id=>{await c.evaluate(`document.getElementById(${JSON.stringify(id)}).requestSubmit()`);await delay(350);};
  const nav=route=>click(`.bottom-nav [data-nav="${route}"]`);
  const screenshot=async name=>{await c.evaluate('document.querySelector("#toast").hidden=true');await delay(80);android('shell','screencap','-p','/sdcard/study-shot.png');android('pull','/sdcard/study-shot.png',path.join(out,name+'.png'));};
  const check=(condition,name)=>{assert.ok(condition,name);results.push(name);};
  const reset=async value=>{const current=await state();value=JSON.parse(JSON.stringify(value));value._revision=current._revision||0;const result=await c.evaluate(`JSON.parse(Native.saveState(${JSON.stringify(JSON.stringify(value))}))`);if(result.error)throw Error(result.error);await c.evaluate('window.onBackupRestored()');await delay(300);};
  try{
    original=await state();await reset(seed);await nav('today');
    check(await c.evaluate('document.body.innerText.includes("记下真实的学习")'),'today page loads in real WebView');
    check((await state()).plan.startDate==='2026-10-12'&&Object.keys((await state()).plan.targets).length===70,'native APK preserves70-day plan');
    check(Object.keys((await state()).records).length===0,'initial actuals stay empty');
    for(const route of ['today','plan','review','settings']){await nav(route);check(await c.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'no horizontal overflow '+route);await screenshot(route);}
    await nav('today');await set('#day-picker','2026-10-12');await set('#minutes-vocab',0);await click('input[name="status"][value="休息"]');await set('#rest-kept','true');await submit('daily-form');
    let r=(await state()).records['2026-10-12'];check(r.subjects.math.minutes===null&&r.subjects.vocab.minutes===0&&r.status==='休息','manual blank/0/rest roundtrip');
    await nav('plan');await click('[data-action="edit-reference"]');await set('#target-math',32);await submit('reference-form');
    check((await state()).plan.targets['2026-10-12'].math===32,'single-day reference editable');
    await click('[data-action="edit-week"]');await set('#week-goal','先理解左右极限的条件');await submit('week-form');check((await state()).plan.weekGoals['2026-10-12']==='先理解左右极限的条件','weekly goal editable');
    await click('[data-action="add-subject"]');await set('#new-subject-name','专业课');await set('#new-default-0',15);await submit('new-subject-form');
    let s=await state();check(s.plan.subjects.length===3&&s.plan.targets['2026-10-12'].custom_1===15,'new subject has references and no fake actuals');
    await set('#range-end','2026-12-21');await submit('range-form');s=await state();check(s.plan.endDate==='2026-12-21'&&s.records['2026-10-12'].status==='休息','resize preserves history');
    await nav('review');await set('#review-load','可承受，继续低强度');await set('#review-halfDayRest','true');await submit('review-form');check((await state()).reviews['2026-10-12'].halfDayRest===true,'weekly reflection saved');
    await nav('settings');await set('#weekend-time','19:00');await submit('reminder-form');check((await state()).settings.reminders.weekendTime==='10:00','rest-time reminder cannot be persisted');await set('#weekend-time','10:10');await submit('reminder-form');check((await state()).settings.reminders.weekendTime==='10:10'&&!(await state()).settings.reminders.enabled,'reminder editing preserves default off');
    await nav('today');await click('[data-action="go-today"]');await click('[data-action="start-timer"][data-subject="math"]');await delay(1300);
    let t=await c.evaluate('JSON.parse(Native.getTimer())');check(t.active&&t.running,'UI starts native foreground timer');
    await click('[data-action="timer-pause"]');t=await c.evaluate('JSON.parse(Native.getTimer())');const paused=t.elapsedMs;await delay(1100);check((await c.evaluate('JSON.parse(Native.getTimer())')).elapsedMs===paused,'native timer pause excludes elapsed rest');
    await click('[data-action="timer-resume"]');android('shell','input','keyevent','3');await delay(1300);android('shell','am','start','-n','cn.edu.njupt.studycheckin/.MainActivity');await delay(500);
    t=await c.evaluate('JSON.parse(Native.getTimer())');check(t.active&&t.running&&t.elapsedMs>paused,'background/reopen retains native timer');
    await click('[data-action="timer-finish"]');s=await state();const today=await c.evaluate('StudyModel.today()');check(s.records[today].subjects.math.minutes>0&&s.sessions.length===1,'UI finish commits actual once');
    check((await c.evaluate('JSON.parse(Native.getTimer())')).active===false,'finish clears active timer');
    check(!(await c.evaluate('JSON.parse(Native.getPlatformInfo())')).remindersExact,'APK uses ordinary reminders');
    await reset(seed);
    const errors=c.events.filter(e=>e.method==='Runtime.exceptionThrown');check(errors.length===0,'no uncaught WebView exceptions');
    fs.writeFileSync(path.join(__dirname,'../docs/ui-test-results.json'),JSON.stringify({platform:'Android16/API36 real APK WebView',passed:results.length,checks:results},null,2));
    console.log(JSON.stringify({passed:results.length,checks:results},null,2));
  } finally {try{if(original)await reset(original);}finally{c.close();}}
})().catch(error=>{console.error(error);process.exitCode=1;});
