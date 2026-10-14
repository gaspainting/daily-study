'use strict';
const {connect,android,delay}=require('./cdp-client.cjs');
const nativeUI=require('./native-ui.cjs');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const pkg='cn.edu.njupt.studycheckin',serial=process.env.ANDROID_SERIAL||'emulator-5572';
const adb=process.env.ANDROID_SDK_ROOT?path.join(process.env.ANDROID_SDK_ROOT,'platform-tools','adb.exe'):'adb';
const version=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(__dirname,'../app/src/main/AndroidManifest.xml'),'utf8'))[1];
const reports=path.join(__dirname,'../docs/validation-v'+version),screens=path.join(__dirname,'../docs/screenshots/v'+version);
const checks=[],snapshots=new Map();let c,originalPlanId,testPlanId,today,yesterday,outside,firstSubject,secondSubject;
fs.mkdirSync(reports,{recursive:true});fs.mkdirSync(screens,{recursive:true});
const check=(condition,name)=>{assert.ok(condition,name);checks.push(name);};
const runAs=command=>android('shell','run-as',pkg,'sh','-c',"'"+command+"'");
const binaryRead=file=>execFileSync(adb,['-s',serial,'exec-out','run-as',pkg,'cat',file]);
const binaryWrite=(file,data)=>execFileSync(adb,['-s',serial,'shell','run-as',pkg,'sh','-c',"'cat > "+file+"'"],{input:data,stdio:['pipe','pipe','pipe']});
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function saveOriginalFiles(){
  if(!serial.startsWith('emulator-'))throw Error('Feature fixture writes are restricted to the owned emulator');
  check(android('shell','getprop','ro.debuggable')==='1','fixture writes use debuggable owned emulator');
  android('shell','am','force-stop',pkg);
  const paths=['study-state.json','plans.json','drafts.json','plan-switch-journal.json'].flatMap(name=>['files/'+name,'files/'+name+'.bak','files/'+name+'.new'])
    .concat(['shared_prefs/stopwatch.xml','shared_prefs/stopwatch.xml.bak']);
  paths.forEach(file=>{
    const present=runAs('if [ -f '+file+' ]; then echo yes; elif [ -e '+file+' ]; then echo invalid; else echo no; fi');
    if(present==='invalid')throw Error('Unexpected fixture path type: '+file);
    snapshots.set(file,present==='yes'?binaryRead(file):null);
  });
}
function restoreOriginalFiles(){
  if(!snapshots.size)return;
  android('shell','am','force-stop',pkg);
  runAs('chmod 700 files');
  for(const[file,data]of snapshots){
    if(data===null)runAs('rm -f '+file);
    else{if(file.startsWith('shared_prefs/'))runAs('mkdir -p shared_prefs');runAs('if [ -f '+file+' ]; then chmod 600 '+file+'; fi');binaryWrite(file,data);}
  }
  for(const[file,data]of snapshots){
    const present=runAs('if [ -f '+file+' ]; then echo yes; else echo no; fi');
    assert.equal(present,data===null?'no':'yes','restored file presence '+file);
    if(data!==null)assert.equal(hash(binaryRead(file)),hash(data),'restored original bytes '+file);
  }
}
async function boot(){
  if(c){c.close();c=null;}
  android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');
  for(let i=0;i<30;i++){try{c=await connect();break;}catch{await delay(120);}}
  if(!c)throw Error('Feature APK WebView did not start');
  for(let i=0;i<40;i++){if(await c.evaluate('!!(window.StudyUI&&window.StudyDrafts)'))break;await delay(100);}
  await c.evaluate('InspirationUI.back()');await delay(100);
}
const native=(name,...args)=>c.evaluate(`(()=>{const r=JSON.parse(Native[${JSON.stringify(name)}](...${JSON.stringify(args)}));if(r.error)throw Error(r.error);return r;})()`);
const state=()=>native('getState');
const click=async selector=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});if(e.disabled)throw Error('Disabled '+${JSON.stringify(selector)});e.click();})()`);await delay(140);};
const nav=route=>click('[data-nav="'+route+'"]');
const input=async(selector,value,type='input')=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}));})()`);await delay(50);};
const gotoDate=date=>input('#day-picker',date,'change');
const value=selector=>c.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
async function submit(selector){await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);await delay(180);}
async function confirmClick(selector,accept){
  const pending=c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(200);
  await nativeUI.byId('android:id/button'+(accept?'1':'2'));await pending;await delay(120);
}
async function actionWithOptionalConfirmation(selector){
  const pending=c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(200);
  const confirm=nativeUI.nodes().find(node=>node['resource-id']==='android:id/button1');
  if(confirm)nativeUI.tap(confirm);
  await pending;await delay(120);
}
async function capture(name){await c.evaluate('document.querySelector("#toast").hidden=true');android('shell','screencap','-p','/sdcard/features-v131.png');android('pull','/sdcard/features-v131.png',path.join(screens,name+'.png'));}
async function uiSwitch(id){await click('[data-action="plan-picker"]');await click('[data-action="switch-plan"][data-plan="'+id+'"]');}
async function injectPausedTimer(seconds){
  if(c){c.close();c=null;}android('shell','am','force-stop',pkg);
  const timer={id:'features-v131-'+Date.now(),subjectId:firstSubject.id,subjectName:firstSubject.name,date:today,running:false,accumulatedMs:seconds*1000,message:''};
  const escaped=JSON.stringify(timer).replace(/[<>&"']/g,v=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[v]));
  runAs('mkdir -p shared_prefs');binaryWrite('shared_prefs/stopwatch.xml',Buffer.from('<?xml version="1.0" encoding="utf-8" standalone="yes"?><map><string name="timer">'+escaped+'</string></map>'));
  runAs('rm -f shared_prefs/stopwatch.xml.bak');await boot();
}
(async()=>{let error;
try{
  saveOriginalFiles();binaryWrite('files/study-state.json',fs.readFileSync(path.join(__dirname,'fixtures/legacy-seed-v1.3.1.json')));await boot();
  const catalog=await native('getPlans');originalPlanId=catalog.activeId;let s=await state();[firstSubject,secondSubject]=s.plan.subjects;today=await c.evaluate('StudyModel.today()');yesterday=await c.evaluate(`StudyModel.today(new Date(Date.parse(${JSON.stringify(today)}+'T12:00:00')-86400000))`);
  check((await native('getAppInfo')).versionName===version,'UI build matches manifest');
  check(Object.keys(s.plan.weekGoals).length===0&&Object.keys(s.plan.weekHints).length===0,'old preset goals and timetable hints are absent after upgrade');
  check(JSON.parse(binaryRead('files/study-state.json')).plan.weekGoals['2026-10-12'],'read-only migration leaves original file intact before a save');
  check(await c.evaluate('!!document.querySelector("#newWords-vocab")&&!!document.querySelector("#reviewWords-vocab")&&!document.querySelector("[data-action=start-timer][data-subject=vocab]")'),'vocabulary primary fields are counts and no vocabulary timer exists');
  check(await c.evaluate('document.querySelector(".word-entry .reference-pill").textContent.includes("50 个")'),'default goal is fifty new words');
  await click('[data-action="add-words"][data-field="newWords-vocab"][data-amount="10"]');await click('[data-action="add-words"][data-field="newWords-vocab"][data-amount="20"]');await click('[data-action="add-words"][data-field="reviewWords-vocab"][data-amount="20"]');
  check((await value('#newWords-vocab'))==='30'&&(await value('#reviewWords-vocab'))==='20','fragmented new and review additions remain independent');
  check(await c.evaluate('!document.activeElement.matches(".word-entry input")&&document.querySelector("[data-word-feedback]").textContent==="复习 20 个"'),'quick addition announces quantity without focusing a text field');
  check(!(await state()).records[today],'quantity increments remain drafts before explicit save');await boot();
  check((await value('#newWords-vocab'))==='30'&&(await value('#reviewWords-vocab'))==='20','quantity draft restores after process restart');
  await submit('#daily-form');s=await state();let v=s.records[today].subjects.vocab;
  check(v.newWords===30&&v.reviewWords===20&&v.minutes===null&&s.records[today].subjects.math.minutes===null,'manual save stores independent counts without fabricating time');
  let revision=s._revision;await submit('#daily-form');await submit('#daily-form');check((await state())._revision===revision,'repeat save does not duplicate quantity or revision');
  await click('[data-action="add-words"][data-field="newWords-vocab"][data-amount="20"]');runAs('chmod 550 files');await submit('#daily-form');
  check((await state()).records[today].subjects.vocab.newWords===30&&(await value('#newWords-vocab'))==='50','actual filesystem save failure preserves formal quantity and typed value');
  check(await c.evaluate('!!document.querySelector("#daily-form [data-action=retry-save]")&&document.querySelector("#daily-form .save-feedback").getAttribute("role")==="alert"'),'failed quantity save has usable retry action');runAs('chmod 700 files');await click('#daily-form [data-action="retry-save"]');
  check((await state()).records[today].subjects.vocab.newWords===50,'retry saves fifty new words without adding review count');
  await c.evaluate('document.querySelector(".word-entry").scrollIntoView({block:"start"})');await delay(500);await capture('vocabulary-quantity');
  await input('#newWords-vocab','0');await input('#reviewWords-vocab','');await submit('#daily-form');v=(await state()).records[today].subjects.vocab;
  check(v.newWords===0&&v.reviewWords===null&&v.minutes===null,'explicit zero and empty review remain zero and null');
  check(await c.evaluate('document.querySelector("#daily-total").textContent==="未记录"'),'word zero does not become zero minutes');
  await gotoDate(yesterday);await input('#reviewWords-vocab','10');await submit('#daily-form');v=(await state()).records[yesterday].subjects.vocab;
  check(v.newWords===null&&v.reviewWords===10,'review-only fragmented learning leaves new words unknown');
  await gotoDate(today);await click('[data-action="edit-week"][data-scope="today"]');check((await value('#week-goal'))===''&&(await value('#week-hint'))==='','first weekly editor opens empty fields');
  await input('#week-goal','我的复习教材第六章');await input('#week-hint','做例题2和3');await submit('#week-form');
  const key=await c.evaluate(`StudyModel.weekKey(JSON.parse(Native.getState()).plan,${JSON.stringify(today)})`);
  check((await state()).plan.weekGoals[key]==='我的复习教材第六章','user weekly goal saves on selected week');
  const next=await c.evaluate(`StudyModel.today(new Date(Date.parse(${JSON.stringify(today)}+'T12:00:00')+7*86400000))`);await gotoDate(next);await click('[data-action="edit-week"][data-scope="today"]');
  check((await value('#week-goal'))==='','next week starts empty instead of copying the previous goal');await input('#week-goal','下一周自己的安排');await submit('#week-form');await gotoDate(today);
  check(await c.evaluate('document.querySelector(".goal-copy").textContent==="我的复习教材第六章"'),'returning week restores its own goal');await capture('weekly-user-goal');
  await nav('plan');check(await c.evaluate('document.querySelector(".plan-day-subjects").textContent.includes("新学 50 个")'),'plan list labels word targets with count units');
  await c.evaluate('document.querySelector("#subject-vocab").closest("details").open=true');await input('#word-goal-vocab','70');await submit('#subject-vocab');s=await state();
  check(s.plan.subjects.find(x=>x.id==='vocab').wordGoal===70&&s.plan.wordTargets[today].vocab===70&&s.plan.wordTargets[yesterday].vocab===50,'changing daily goal applies from today and preserves past word targets');
  check(s.records[today].subjects.vocab.newWords===0&&s.plan.targets[today].vocab===20,'goal edit preserves actual zero and legacy minute references');
  await click('[data-action="edit-reference"]');check((await value('#target-vocab'))==='70'&&await c.evaluate('document.querySelector("label[for=target-vocab]").textContent.includes("新学目标")'),'daily goal editor uses word quantity');await input('#target-vocab','80');await submit('#reference-form');
  check((await state()).plan.wordTargets[today].vocab===80&&(await state()).records[today].subjects.vocab.newWords===0,'date-specific word goal leaves actual count unchanged');await c.evaluate('document.querySelector("#subject-vocab").closest("details").open=true');await submit('#subject-vocab');check((await state()).plan.wordTargets[today].vocab===80,'unchanged default-goal save preserves date override');
  await nav('today');await click('[data-action="plan-picker"]');await click('[data-action="new-plan"]');await input('#new-plan-name','词数隔离验证');await submit('#new-plan-form');testPlanId=(await native('getPlans')).activeId;
  check(testPlanId!==originalPlanId&&(await state()).plan.subjects.find(x=>x.id==='vocab').wordGoal===70&&Object.keys((await state()).plan.weekGoals).length===0,'new plan copies count default and begins without weekly goals');
  let onlyWords=await state();onlyWords.plan.subjects.find(x=>x.kind==='math').activePeriods=[];await native('saveState',JSON.stringify(onlyWords));await c.evaluate('onNativeResume()');check(await c.evaluate('!document.querySelector("#daily-total")&&!document.querySelector(".quick-timers")'),'word-only plan has no empty time overview or timer container');
  await click('[data-action="add-words"][data-field="newWords-vocab"][data-amount="5"]');await submit('#daily-form');await uiSwitch(originalPlanId);
  check((await state()).records[today].subjects.vocab.newWords===0,'switching plan retains each plan quantity');
  await nav('review');check(await c.evaluate('document.querySelector(".word-summary").textContent.includes("复习")&&document.querySelector(".word-summary").textContent.includes("10 个")'),'weekly review shows independent new and review totals');await capture('weekly-vocabulary-stats');
  await nav('month');check(await c.evaluate(`document.querySelector('[data-date="${today}"]').getAttribute('aria-label').includes('新学 0 个')`),'monthly calendar shows vocabulary zero as count');
  check(await c.evaluate('document.querySelector(".word-summary").textContent.includes("10 个")'),'month statistics include review-only day');await capture('monthly-vocabulary-stats');await nav('history');
  check(await c.evaluate('document.querySelector(".tracking-list").textContent.includes("新学 0 个")&&document.querySelector(".tracking-list").textContent.includes("复习 10 个")'),'history distinguishes zero new words and review-only quantity');
  await nav('today');s=await state();s.records[today].subjects.vocab.minutes=15;s.records[today].subjects.vocab.newWords=25;await native('saveState',JSON.stringify(s));await c.evaluate('onNativeResume()');await input('#reviewWords-vocab','60');await submit('#daily-form');
  check((await state()).records[today].subjects.vocab.minutes===15,'quantity save preserves existing legacy vocabulary minutes');
  firstSubject=secondSubject;await injectPausedTimer(60);const result=await native('timerAction','finish');check(result.finished,'pre-upgrade paused vocabulary timer can still finish');s=await state();
  check(s.records[today].subjects.vocab.minutes===16&&s.records[today].subjects.vocab.newWords===25&&s.records[today].subjects.vocab.reviewWords===60,'legacy timer adds time without changing new or review words');await c.evaluate('onNativeResume()');
  await input('#newWords-vocab','30');s=await state();s.records[today].subjects.vocab.newWords=40;await native('saveState',JSON.stringify(s));await c.evaluate('onNativeResume()');
  let pending=c.evaluate('document.querySelector("#daily-form").requestSubmit()');await delay(180);await nativeUI.byId('android:id/button2');await pending;
  check((await state()).records[today].subjects.vocab.newWords===40&&(await value('#newWords-vocab'))==='30','cancel quantity conflict preserves newer record and unsaved input');
  pending=c.evaluate('document.querySelector("#daily-form").requestSubmit()');await delay(180);await nativeUI.byId('android:id/button1');await pending;
  check((await state()).records[today].subjects.vocab.newWords===30,'confirmed quantity conflict saves selected input');
  await c.evaluate('document.documentElement.classList.add("large-text");document.documentElement.style.fontSize="32px"');
  check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'count controls fit at large text size');
  const ax=await c.call('Accessibility.getFullAXTree'),controls=ax.nodes.filter(n=>!n.ignored&&['button','textbox','spinbutton','combobox','checkbox','radio'].includes(n.role?.value));check(controls.every(n=>n.name?.value),'quantity controls expose accessible names');await c.evaluate('document.documentElement.style.fontSize="";document.documentElement.classList.remove("large-text")');
  check(c.events.filter(e=>e.method==='Runtime.exceptionThrown').length===0,'quantity and weekly-goal interactions have no uncaught WebView exception');
}catch(e){error=e;}finally{if(c){c.close();c=null;}try{restoreOriginalFiles();checks.push('original study catalog drafts and stopwatch bytes restored');}catch(e){error=error||e;}fs.writeFileSync(path.join(reports,'vocabulary-ui-results.json'),JSON.stringify({passed:checks.length,checks,error:error?.stack||null},null,2));}
if(error)throw error;console.log(JSON.stringify({passed:checks.length,checks},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
