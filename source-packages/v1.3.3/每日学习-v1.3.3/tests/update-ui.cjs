'use strict';
// Real APK WebView rendering and real study/timer persistence, with deterministic
// updater-only fixtures. The fixture checks do not test downloading or installing.
const {connect,android,delay}=require('./cdp-client.cjs'),ui=require('./native-ui.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const PKG='cn.edu.njupt.studycheckin';
const version=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(__dirname,'../app/src/main/AndroidManifest.xml'),'utf8'))[1];
const reports=path.join(__dirname,'../docs/validation-v'+version),shots=path.join(__dirname,'../docs/screenshots/v'+version);
const checks=[],unverified=[],cleanupErrors=[];let c,injection,originalStudy,failure,liveResult,timerCreated=false;
const check=(ok,name)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name);};
const click=async selector=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control: '+${JSON.stringify(selector)});e.click()})()`);await delay(130);};
const panel=()=>c.evaluate('document.querySelector("#app-update")?.innerText||""');
const state=()=>c.evaluate('JSON.parse((window.__updateHarness?.native||Native).getState())');
const timer=()=>c.evaluate('JSON.parse((window.__updateHarness?.native||Native).getTimer())');
const calls=name=>c.evaluate(`window.__updateHarness.calls[${JSON.stringify(name)}]||0`);
const set=async(selector,value)=>c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
async function until(test,label,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await delay(180);}throw Error(label);}
async function capture(name){fs.mkdirSync(shots,{recursive:true});await c.evaluate('document.querySelector("#toast").hidden=true');android('shell','screencap','-p','/sdcard/daily-update-ui.png');android('pull','/sdcard/daily-update-ui.png',path.join(shots,name+'.png'));}
async function open(){
  android('shell','am','start','-W','-n',PKG+'/.MainActivity');
  await until(async()=>{try{c=await connect();if(await c.evaluate('!!window.StudyUI'))return true;c.close();c=null;}catch{}return false;},'Cannot connect to actual APK WebView');
  await c.evaluate('window.InspirationUI && InspirationUI.back()');
}
async function reload(){
  const from=c.events.length;await c.call('Page.reload');
  await until(async()=>c.events.slice(from).some(e=>e.method==='Debugger.paused'),'App boot did not pause at the Native bridge assignment');
  const paused=c.events.slice(from).find(e=>e.method==='Debugger.paused');
  const result=await c.call('Debugger.evaluateOnCallFrame',{callFrameId:paused.params.callFrames[0].callFrameId,expression:harness,returnByValue:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  await c.call('Debugger.resume');await delay(250);
  await until(async()=>await c.evaluate('!!window.StudyUI && !!window.__updateHarness'),'Updater fixture did not load before app boot');
  await c.evaluate('window.InspirationUI && InspirationUI.back()');
}
async function about(){await click('[data-nav=settings]');await click('[data-action=about]');}
const harness=`(() => {
  const native=window.Native;
  const info=JSON.parse(native.getAppInfo());
  const h=window.__updateHarness={native,calls:{},state:{phase:'idle',currentVersion:info.versionName,currentCode:info.versionCode,bytes:0,total:0,canInstall:true}};
  const count=name=>{h.calls[name]=(h.calls[name]||0)+1;};
  const methods={
    getUpdateState:()=>JSON.stringify(h.state),
    checkUpdate:()=>{count('check');h.state={...h.state,phase:'checking',error:''};return JSON.stringify({ok:true});},
    downloadUpdate:()=>{count('download');h.state={...h.state,phase:'downloading',bytes:0,total:h.state.candidate?.apkBytes||100,error:''};return JSON.stringify({ok:true});},
    cancelUpdate:()=>{count('cancel');h.state={...h.state,phase:h.state.candidate?'available':'idle',bytes:0,total:0,error:''};return JSON.stringify({ok:true});},
    installUpdate:()=>{count('install');return JSON.stringify({ok:true,requested:true});}
  };
  // The app is paused immediately before it captures Native. Keep every other
  // Java bridge method intact; no timer or study-store result is simulated.
  window.Native=new Proxy(native,{get(target,name){if(Object.hasOwn(methods,name))return methods[name];const value=target[name];return typeof value==='function'?(...args)=>target[name](...args):value;}});
  if(window.Native===native)throw Error('Unable to replace the global Native bridge for updater-only fixtures');
})();`;
async function simulate(next){await c.evaluate(`window.__updateHarness.state={...window.__updateHarness.state,...${JSON.stringify(next)}};window.onAppUpdateChanged()`);await delay(60);}
async function ready(candidate,canInstall=true){await simulate({phase:'ready',candidate,canInstall,error:'',bytes:candidate.apkBytes,total:candidate.apkBytes});}
function withoutRevision(value){value=structuredClone(value);delete value._revision;return value;}
(async()=>{
  try{
    check(/^emulator-/.test(process.env.ANDROID_SERIAL||'emulator-5572'),'test target is an owned emulator');
    await open();originalStudy=await state();check(!(await timer()).active,'no existing timer is interrupted by updater UI tests');
    const info=await c.evaluate('JSON.parse(Native.getAppInfo())');check(info.versionName===version,'installed version matches the manifest used for this test report');
    await about();check(await c.evaluate('document.querySelector("[data-build-version]").dataset.buildVersion')===info.versionName,'about version comes from actual installed package metadata');
    await click('[data-action=update-check]');
    await until(async()=>!['idle','checking'].includes((await c.evaluate('JSON.parse(Native.getUpdateState())')).phase),'Real GitHub check did not settle',30000);
    liveResult=await c.evaluate('JSON.parse(Native.getUpdateState())');
    check(['current','available','ready','error'].includes(liveResult.phase),'real native GitHub check produces a terminal status');
    if(liveResult.phase==='error'){
      check((await panel()).includes(liveResult.error)&&await c.evaluate('!!document.querySelector("#app-update [data-action=update-check]")'),'real network/check error has visible reason and usable retry');
      unverified.push('Live update check ended with an error: '+liveResult.error);
    }else check((await panel()).includes(liveResult.phase==='current'?'已是最新版本':liveResult.candidate.versionName),'real native check status is reflected in the update panel');
    await capture('update-real-check');
    await c.call('Page.enable');await c.call('Debugger.enable');
    const line=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/app.js'),'utf8').split(/\r?\n/).findIndex(s=>s.includes('bridge = window.Native || await createPreviewBridge()'));
    assert.ok(line>=0,'Native bridge assignment not found in app boot');
    injection=(await c.call('Debugger.setBreakpointByUrl',{urlRegex:'app\\.js(?:\\?.*)?$',lineNumber:line})).breakpointId;await reload();await about();
    check(await c.evaluate('!!window.__updateHarness && !!document.querySelector("[data-action=update-check]")'),'updater-only proxy is captured by actual app boot while other Native methods remain real');
    await click('[data-action=update-check]');check((await panel()).includes('正在检查更新')&&await calls('check')===1,'explicit check displays pending status without claiming a completed check');
    await click('[data-action=update-cancel]');check(await c.evaluate('!!document.querySelector("[data-action=update-check]")')&&await calls('cancel')===1,'canceling a pending check returns to an actionable idle state');
    await simulate({phase:'current',candidate:null});check((await panel()).includes('已是最新版本'),'current-version status is shown only for the current phase');
    await simulate({phase:'error',candidate:null,error:'连接失败，请重试'});check((await panel()).includes('连接失败，请重试')&&await c.evaluate('document.querySelector("#app-update [role=alert]").textContent.includes("连接失败")'),'error snapshots are rendered in the panel rather than discarded by generic Native error decoding');
    await click('[data-action=update-check]');check(await calls('check')===2&&(await panel()).includes('正在检查更新'),'error retry actually calls the native check action');
    const candidate={versionName:'9.9.9 测试',versionCode:9999,releaseNotes:'更新测试文字 <img src=x onerror="throw Error(1)">\n较长更新说明用于检查中文换行。'.repeat(4),apkBytes:100000};
    await simulate({phase:'available',candidate,error:''});check((await panel()).includes(candidate.versionName)&&await c.evaluate('!document.querySelector("#app-update img")'),'candidate version and notes are displayed as escaped text');
    await click('[data-action=update-download]');check(await calls('download')===1&&await c.evaluate('document.querySelector("#update-progress").value===0'),'download action shows zero initial progress without claiming a completed download');
    await simulate({phase:'downloading',bytes:42000,total:100000});check(await c.evaluate('document.querySelector("#update-progress").value===42'),'download progress reflects reported byte count');
    await click('[data-action=update-cancel]');check(await c.evaluate('!!document.querySelector("[data-action=update-download]")')&&!(await panel()).includes('下载完成'),'canceling download restores availability without a completion or installation claim');
    await simulate({phase:'error',candidate,error:'下载中断'});check(await c.evaluate('document.querySelector("#app-update [data-action=update-download]").textContent==="重试"'),'download failure offers the appropriate download retry');
    await ready(candidate,false);check((await panel()).includes('安装权限未开启')&&await c.evaluate('document.querySelector("[data-action=update-install]").textContent==="开启安装权限"'),'missing installation permission is a visible status with a user-initiated action');
    await ready(candidate,true);check((await panel()).includes('下载完成')&&!/已安装|更新成功/.test(await panel()),'verified ready state reports downloaded without claiming installation success');
    const currentVersion=await c.evaluate('document.querySelector("[data-build-version]").dataset.buildVersion');await click('[data-action=update-install]');
    check(await calls('install')===1&&!/已安装|更新成功/.test(await panel())&&await c.evaluate('document.querySelector("[data-build-version]").dataset.buildVersion')===currentVersion,'requesting installation does not change the installed version or announce success');
    await click('[data-action=close-sheet]');const originalTime=await c.evaluate('document.querySelector("#weekday-time").value');await set('#weekday-time',originalTime==='18:15'?'18:16':'18:15');await click('[data-action=about]');
    const draft=await c.evaluate('document.querySelector("#weekday-time").value');await simulate({phase:'downloading',candidate,bytes:85000,total:100000});
    check(await c.evaluate('document.querySelector("#weekday-time").value')===draft&&(await c.evaluate('StudyUI.snapshot()')).dirty.includes('reminders'),'asynchronous update progress preserves unsaved settings input and dirty state');
    await ready(candidate);const beforeBlocked=await calls('install');await click('[data-action=update-install]');
    check(await calls('install')===beforeBlocked&&await c.evaluate('!document.querySelector("#update-action-feedback").hidden&&document.querySelector("#update-action-feedback").textContent.includes("未保存")'),'unsaved form blocks installation with a visible local recovery instruction');
    check(await c.evaluate('document.querySelector("#weekday-time").value')===draft,'blocked installation retains the current form input');
    assert.deepEqual(await state(),originalStudy);check(true,'checking/downloading fixtures do not save settings or modify learning records');
    await set('#weekday-time',originalTime);await reload();await about();await ready(candidate);
    await c.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
    await c.evaluate('window.__updateHarness.largeTextBefore=document.documentElement.classList.contains("large-text");document.documentElement.classList.add("large-text");window.__updateHarness.fonts=Array.from(document.querySelectorAll("#sheet,#sheet *"),e=>({e,value:e.style.fontSize,size:parseFloat(getComputedStyle(e).fontSize)}));window.__updateHarness.fonts.forEach(x=>x.e.style.fontSize=(x.size*2)+"px")');
    check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#sheet").scrollWidth<=document.querySelector("#sheet").clientWidth+1'),'long update notes and actions fit a 320px viewport at 200% CSS text size');
    const tree=await c.call('Accessibility.getFullAXTree');const buttons=tree.nodes.filter(n=>!n.ignored&&n.role?.value==='button'&&['安装更新','重新检查','关闭'].includes(n.name?.value));check(buttons.some(n=>n.name?.value==='安装更新')&&buttons.every(n=>!!n.name?.value),'update controls retain accessible names in the real WebView accessibility tree');
    await capture('update-ready-large-text');await c.call('Emulation.clearDeviceMetricsOverride');await c.evaluate('if(!window.__updateHarness.largeTextBefore)document.documentElement.classList.remove("large-text");window.__updateHarness.fonts.forEach(x=>x.e.style.fontSize=x.value)');
    const today=await c.evaluate('StudyModel.today()'),subject=originalStudy.plan.subjects[0];
    const started=await c.evaluate(`JSON.parse(window.__updateHarness.native.startTimer(${JSON.stringify(subject.id)},${JSON.stringify(subject.name)},${JSON.stringify(today)}))`);
    if(started.error){unverified.push('Active timer installation gate UI could not be exercised: '+started.error);}
    else{
      timerCreated=true;
      await c.evaluate('window.__updateHarness.native.timerAction("pause")');const paused=await timer(),installs=await calls('install');await click('[data-action=update-install]');
      check(await c.evaluate('document.querySelector("#sheet-title").textContent==="当前计时尚未保存"&&!!document.querySelector("[data-action=update-finish]")&&!!document.querySelector("[data-action=update-discard]")'),'active native timer exposes cancel/save/discard choices at installation time');
      await click('[data-action=update-return]');check((await timer()).active&&(await timer()).elapsedMs===paused.elapsedMs&&await calls('install')===installs,'canceling the installation timer gate preserves the actual paused timer');
      await click('[data-action=update-install]');const askDiscard=c.evaluate('document.querySelector("[data-action=update-discard]").click()');await delay(150);await ui.byId('android:id/button2');await askDiscard;
      check((await timer()).active&&await calls('install')===installs,'canceling discard confirmation retains the timer and does not request installation');
      await click('[data-action=update-return]');await click('[data-action=update-install]');const sessionsBefore=(await state()).sessions.length;await click('[data-action=update-finish]');
      check(!(await timer()).active&&(await state()).sessions.length===sessionsBefore+1&&await calls('install')===installs+1,'save-and-continue persists the actual timer session before requesting installation');timerCreated=false;
      const startedAgain=await c.evaluate(`JSON.parse(window.__updateHarness.native.startTimer(${JSON.stringify(subject.id)},${JSON.stringify(subject.name)},${JSON.stringify(today)}))`);assert.ok(startedAgain.active,startedAgain.error);timerCreated=true;await c.evaluate('window.__updateHarness.native.timerAction("pause")');
      await click('[data-action=update-install]');const confirmDiscard=c.evaluate('document.querySelector("[data-action=update-discard]").click()');await delay(150);await ui.byId('android:id/button1');await confirmDiscard;
      check(!(await timer()).active&&(await state()).sessions.length===sessionsBefore+1&&await calls('install')===installs+2,'confirmed discard clears only the pending timer before requesting installation');timerCreated=false;
    }
    check(c.events.filter(e=>e.method==='Runtime.exceptionThrown').length===0,'no uncaught WebView exception in update status and installation-gate flows');
  }catch(error){failure=error;console.error(error);}
  finally{
    if(c){
      try{await c.call('Debugger.resume').catch(()=>{});await c.call('Emulation.clearDeviceMetricsOverride');if(injection)await c.call('Debugger.removeBreakpoint',{breakpointId:injection});await c.call('Debugger.disable').catch(()=>{});if(timerCreated)await c.evaluate('(window.__updateHarness?.native||Native).timerAction("discard")');}catch(e){cleanupErrors.push('fixture/timer cleanup: '+e.message);}
      if(originalStudy){try{const current=await state();if(JSON.stringify(withoutRevision(current))!==JSON.stringify(withoutRevision(originalStudy))){const restored=structuredClone(originalStudy);restored._revision=current._revision||0;const saved=await c.evaluate(`JSON.parse((window.__updateHarness?.native||Native).saveState(${JSON.stringify(JSON.stringify(restored))}))`);assert.ok(saved.ok,saved.error);}assert.deepEqual(withoutRevision(await state()),withoutRevision(originalStudy));}catch(e){cleanupErrors.push('study data restoration: '+e.message);}}
      try{await c.call('Page.reload');}catch{}c.close();
    }
    fs.mkdirSync(reports,{recursive:true});const result={version,platform:'Android APK WebView/CDP; real learning/timer bridge',passed:checks.length,checks,liveCheck:liveResult||null,fixtureScope:'Only getUpdateState/checkUpdate/downloadUpdate/cancelUpdate/installUpdate are overridden after the live check. Fixture download and install actions never download or install an APK.',unverified:['Fixture states do not verify APK transfer, checksum/signature verification, permission-settings return, or actual Package Installer behavior; these require native/platform tests.',...unverified],cleanupErrors,restored:cleanupErrors.length===0,failure:failure?.message||null};
    fs.writeFileSync(path.join(reports,'update-ui-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(failure||cleanupErrors.length)process.exitCode=1;
  }
})();
