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
    saveOriginalFiles();await boot();
    check((await native('getAppInfo')).versionName===version,'feature tests run actual manifest build metadata');
    const originalCatalog=await native('getPlans');originalPlanId=originalCatalog.activeId;
    check(originalCatalog.plans.length<8,'fixture has space for isolated feature test plan');
    const originalState=await state();
    const dates=await c.evaluate(`(()=>{const t=StudyModel.today(),shift=n=>{const d=new Date(t+'T12:00:00');d.setDate(d.getDate()+n);return StudyModel.today(d);};return {today:t,yesterday:shift(-1),outside:shift(-10),start:shift(-3),end:shift(2)};})()`);
    ({today,yesterday,outside}=dates);
    await click('[data-action="plan-picker"]');await click('[data-action="new-plan"]');
    await input('#new-plan-name','功能验证 '+Date.now());await input('#new-plan-start',dates.start);await input('#new-plan-end',dates.end);await submit('#new-plan-form');
    const catalog=await native('getPlans');testPlanId=catalog.activeId;
    check(testPlanId!==originalPlanId&&catalog.plans.length===originalCatalog.plans.length+1,'creating plan through real form creates and activates separate named plan');
    let current=await state();[firstSubject,secondSubject]=current.plan.subjects;
    check(!!secondSubject&&Object.keys(current.records).length===0&&Object.keys(current.reviews).length===0&&(current.sessions||[]).length===0,'new plan has subjects and empty actual records review and sessions');
    const todayKey=testPlanId+':daily:'+today,yesterdayKey=testPlanId+':daily:'+yesterday;
    await input('#minutes-'+firstSubject.id,'0');await input('#daily-note','草稿\n原始随记');
    const draft=(await native('getDraft',todayKey)).draft;
    check(draft.values['minutes-'+firstSubject.id]==='0'&&draft.values['minutes-'+secondSubject.id]==='','immediate draft persistence distinguishes typed zero from empty subject');
    check(!((await state()).records[today]),'autosave draft does not create formal learning record');
    await capture('draft-zero-unsaved');
    await boot();
    check((await value('#minutes-'+firstSubject.id))==='0'&&(await value('#minutes-'+secondSubject.id))===''&&(await value('#daily-note'))==='草稿\n原始随记','force-stop and restart restore raw zero empty and multiline draft');
    check(await c.evaluate('document.querySelector(".draft-status").textContent.includes("已恢复草稿")&&!document.querySelector(".save-feedback").textContent.includes("已保存")'),'restored draft is labelled without claiming record saved');
    await gotoDate(yesterday);
    check((await value('#minutes-'+firstSubject.id))==='','different date starts with its own empty form');
    await input('#minutes-'+secondSubject.id,'12.5');await input('#daily-note','前一日的草稿');
    check((await native('getDraft',yesterdayKey)).draft.values['minutes-'+secondSubject.id]==='12.5','date-specific draft saves independent raw fractional minutes');
    await gotoDate(today);check((await value('#minutes-'+firstSubject.id))==='0','returning to original date recovers original draft');
    await uiSwitch(originalPlanId);
    check((await native('getPlans')).activeId===originalPlanId&&JSON.stringify((await state()).records)===JSON.stringify(originalState.records),'switching plan retains original plan saved records');
    await uiSwitch(testPlanId);check((await value('#minutes-'+firstSubject.id))==='0'&&(await value('#daily-note'))==='草稿\n原始随记','plan-specific draft survives switching away and back');
    const beforeFailure=(await native('getDraft',todayKey)).draft;
    runAs('chmod 400 files/drafts.json');runAs('chmod 500 files');
    try{
      await input('#daily-note','保留失败输入');
      check(await c.evaluate('document.querySelector(".draft-status").textContent.includes("草稿保存失败")'),'real file permission failure reports draft save failure');
      check((await value('#daily-note'))==='保留失败输入'&&JSON.stringify((await native('getDraft',todayKey)).draft)===JSON.stringify(beforeFailure),'draft failure retains typed input and old stored draft');
    }finally{runAs('chmod 700 files');runAs('chmod 600 files/drafts.json');}
    await click('#daily-form [data-draft-action="retry"]');
    check((await native('getDraft',todayKey)).draft.values['daily-note']==='保留失败输入','draft retry persists retained input after filesystem recovers');
    await confirmClick('#daily-form [data-draft-action="clear"]',false);
    check((await value('#daily-note'))==='保留失败输入'&&(await native('getDraft',todayKey)).draft!==null,'cancel clearing keeps draft and form values');
    await submit('#daily-form');current=await state();
    check(current.records[today].subjects[firstSubject.id].minutes===0&&current.records[today].subjects[secondSubject.id].minutes===null,'manual save persists zero plus unknown without inferring all-day zero');
    check((await native('getDraft',todayKey)).draft===null,'successful manual save removes only current form draft');
    const revision=current._revision;await submit('#daily-form');
    check((await state())._revision===revision,'repeat unchanged manual save does not rewrite record revision');
    await gotoDate(yesterday);await submit('#daily-form');
    check((await state()).records[yesterday].subjects[secondSubject.id].minutes===12.5&&(await native('getDraft',yesterdayKey)).draft===null,'second date draft becomes fractional actual record only after manual save');
    await c.evaluate(`(()=>{const s=JSON.parse(Native.getState()),r=StudyModel.record(s,${JSON.stringify(outside)});r.note='计划外关键词唯一';StudyModel.saveRecord(s,${JSON.stringify(outside)},r);const saved=JSON.parse(Native.saveState(JSON.stringify(s)));if(saved.error)throw Error(saved.error);StudyUI.reload();})()`);
    await nav('review');await nav('history');await input('#tracking-keyword','计划外关键词唯一');await click('[data-action="tracking-search"]');
    check(await c.evaluate(`document.querySelectorAll('.tracking-record').length===1&&document.querySelector('.tracking-record').dataset.date===${JSON.stringify(outside)}`),'history keyword search includes records outside current plan date range');
    await click('[data-action="tracking-reset"]');await input('#tracking-kind','partial','change');await click('[data-action="tracking-search"]');
    check(await c.evaluate('document.querySelectorAll(".tracking-record").length===2'),'partial-history filter includes zero plus unknown and fraction plus unknown');
    await input('#tracking-kind','zero','change');await click('[data-action="tracking-search"]');
    check(await c.evaluate('document.querySelectorAll(".tracking-record").length===0'),'zero-history filter excludes partial zero plus unrecorded subject');
    await click('[data-action="tracking-reset"]');await capture('history-search');
    await nav('month');await input('#tracking-month',today.slice(0,7),'change');
    const summary=await c.evaluate(`StudyModel.monthStats(JSON.parse(Native.getState()),${JSON.stringify(today.slice(0,7))})`);
    check(summary.actual===12.5&&summary.recordedDays===2,'monthly actual aggregates explicit zero and fraction without counting note-only day');
    check(await c.evaluate(`document.querySelector('[data-action="tracking-open-day"][data-date="${today}"]').textContent.includes('0 分钟')&&document.querySelector('[data-action="tracking-open-day"][data-date="${today}"]').textContent.includes('1/2')`),'month zero cell exposes partial subject count');
    check(await c.evaluate(`document.querySelector('[data-action="tracking-open-day"][data-date="${outside}"]').textContent.includes('随记')`),'month note-only cell does not show zero minutes');
    await capture('month-partial-zero');
    await nav('today');await gotoDate(today);await input('#minutes-'+firstSubject.id,'7');
    await injectPausedTimer(60);const finished=await native('timerAction','finish');check(finished.finished,'fixture paused timer saves real one-minute session');
    await boot();
    check(await c.evaluate('document.querySelector(".draft-status").textContent.includes("记录已更新")&&!!document.querySelector("[data-draft-action=apply]")'),'timer update detects conflict with older draft baseline after restart');
    check((await value('#minutes-'+firstSubject.id))==='1'&&(await native('getDraft',todayKey)).draft.values['minutes-'+firstSubject.id]==='7','conflicting draft leaves newer saved minutes visible and keeps alternate draft');
    await capture('draft-conflict');await confirmClick('#daily-form [data-draft-action="clear"]',true);
    check((await native('getDraft',todayKey)).draft===null&&(await state()).records[today].subjects[firstSubject.id].minutes===1,'keep-current conflict choice removes draft without replacing timer record');
    await nav('review');await nav('sessions');
    check(await c.evaluate('document.querySelectorAll(".tracking-record").length===1&&document.querySelector(".tracking-record").textContent.includes("1 分钟")&&document.querySelector(".tracking-record").textContent.includes("结束于")'),'session details expose saved net duration and actual end time');
    await input('#sessions-subject',secondSubject.id,'change');await click('[data-action="tracking-sessions-search"]');
    check(await c.evaluate('document.querySelectorAll(".tracking-record").length===0'),'session subject filter uses stored subject association');
    await click('[data-action="tracking-sessions-reset"]');await capture('session-detail');
    await nav('plan');await click('[data-action="add-subject"]');await input('#new-subject-name','专业课测试');await submit('#new-subject-form');
    const custom=(await state()).plan.subjects.find(subject=>subject.name==='专业课测试');check(!!custom,'new custom subject is added through actual form');
    await nav('review');await input('#review-subject-'+custom.id,'专业课自己的复盘');await submit('#review-form');
    const reviewState=await state(),week=await c.evaluate('StudyModel.weekInfo(JSON.parse(Native.getState()).plan,StudyUI.snapshot().reviewDate).key');
    check(reviewState.reviews[week].subjects[custom.id]==='专业课自己的复盘','custom subject review persists independently of legacy math and vocabulary fields');
    await nav('plan');const order=(await state()).plan.subjects.map(subject=>subject.id);
    const upDirection=await c.evaluate(`(()=>{const buttons=[...document.querySelectorAll('[data-action="move-subject"][data-subject="${custom.id}"]')];const up=buttons.find(button=>['-1','up'].includes(button.dataset.direction));if(!up)throw Error('Missing move up control');return up.dataset.direction;})()`);
    await click('[data-action="move-subject"][data-subject="'+custom.id+'"][data-direction="'+upDirection+'"]');
    check((await state()).plan.subjects.map(subject=>subject.id).indexOf(custom.id)===order.indexOf(custom.id)-1,'subject reorder preserves ID and changes display order');
    await actionWithOptionalConfirmation('[data-action="archive-subject"][data-subject="'+secondSubject.id+'"]');
    const archived=await state();
    check(archived.records[yesterday].subjects[secondSubject.id].minutes===12.5&&archived.reviews[week].subjects[custom.id]==='专业课自己的复盘','archiving preserves historic actual record and per-subject review');
    await nav('today');await gotoDate(today);
    check(await c.evaluate(`!document.querySelector('[data-action="start-timer"][data-subject="${secondSubject.id}"]')`),'archived subject is absent from current timer controls');
    await gotoDate(yesterday);check((await value('#minutes-'+secondSubject.id))==='12.5','historical archived-subject record stays editable with actual minutes');
    await nav('plan');await actionWithOptionalConfirmation('[data-action="restore-subject"][data-subject="'+secondSubject.id+'"]');await nav('today');await gotoDate(today);
    check(await c.evaluate(`!!document.querySelector('[data-action="start-timer"][data-subject="${secondSubject.id}"]')`),'restored subject returns to current timer controls');
    await injectPausedTimer(60);await uiSwitch(originalPlanId);
    check(await c.evaluate('document.querySelector("#sheet").textContent.includes("当前计时尚未保存")'),'plan switch with active timer offers save discard and cancel');
    await click('[data-action="close-sheet"]');
    check((await native('getPlans')).activeId===testPlanId&&(await native('getTimer')).active,'cancel plan switch preserves current plan and active timer');
    const rejected=await c.evaluate(`JSON.parse(Native.switchPlan(${JSON.stringify(originalPlanId)}))`);
    check(!!rejected.error&&(await native('getPlans')).activeId===testPlanId,'native plan switching refuses to move an unsaved timer across plans');
    await uiSwitch(originalPlanId);await click('[data-action="plan-finish"]');
    check((await native('getPlans')).activeId===originalPlanId&&!(await native('getTimer')).active,'saving timer then switching activates destination only after timer completes');
    check(JSON.stringify((await state()).records)===JSON.stringify(originalState.records),'timer from feature test plan never writes destination plan records');
    await uiSwitch(testPlanId);current=await state();
    check(current.records[today].subjects[firstSubject.id].minutes===2&&current.sessions.length===2,'completed timer and sessions remain associated with source plan');
    await nav('review');await nav('month');await c.evaluate('document.documentElement.style.fontSize="32px"');
    check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'month layout has no horizontal overflow at large text size');await capture('month-large-text');
    await c.evaluate('document.documentElement.style.fontSize=""');
    check(c.events.filter(event=>event.method==='Runtime.exceptionThrown').length===0,'feature interactions have no uncaught WebView exception');
  }catch(failure){error=failure;}
  finally{
    if(c){c.close();c=null;}
    try{restoreOriginalFiles();checks.push('original study catalog drafts and stopwatch bytes restored after integration tests');}catch(cleanup){error=error||cleanup;}
    fs.writeFileSync(path.join(reports,'features-v131-ui-results.json'),JSON.stringify({platform:'Android 16 API 36 actual APK WebView',passed:checks.length,checks,error:error?String(error):null},null,2));
  }
  if(error)throw error;console.log(JSON.stringify({passed:checks.length,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
