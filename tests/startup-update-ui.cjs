'use strict';
// Actual APK WebView; only updater responses are deterministic fixtures.
// The shared wrapper restores every original private file and preference.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {connect}=require('./cdp-client.cjs');
process.env.COURSE_REPORT_NAME='startup-update-ui-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 const {boot,evaluate,native,check,click,input,shot,android,delay,state}=h;
 await boot();const before=await state();
 const real=await native('getUpdateState');
 check(['checking','current','available','ready','error'].includes(real.phase),'cold boot initiates a real native update check without entering About');
 check((await native('checkStartupUpdate')).started===false,'native cold-start claim cannot be consumed twice');
 await native('cancelUpdate');
 const c=await connect();
 const source=fs.readFileSync(path.join(h.root,'app/src/main/assets/app.js'),'utf8').split(/\r?\n/);
 const line=source.findIndex(s=>s.includes('bridge = window.Native || await createPreviewBridge()'));
 assert.ok(line>0);await c.call('Debugger.enable');
 const bp=await c.call('Debugger.setBreakpointByUrl',{url:'file:///android_asset/app.js',lineNumber:line});
 async function reload(options={}){
  const from=c.events.length;await c.call('Page.reload');
  await until(()=>c.events.slice(from).some(e=>e.method==='Debugger.paused'),'boot breakpoint');
  const paused=c.events.slice(from).find(e=>e.method==='Debugger.paused');
  const script=`(()=>{
   const n=window.Native,info=JSON.parse(n.getAppInfo()),o=${JSON.stringify(options)};
   const x=window.__startupUpdate={native:n,checks:0,downloads:0,installs:0,reads:0,accepted:o.accepted!==false,
    state:{phase:'checking',currentCode:info.versionCode,currentVersion:info.versionName,bytes:0,total:0,canInstall:true,candidate:null,error:''}};
   const methods={
    getStartup:()=>{const s=JSON.parse(n.getInspiration('startup',0,1));return JSON.stringify(s.items?.length?{show:true,entry:s.items[0]}:{show:true,waiting:true});},
    nextStartup:()=>JSON.stringify({waiting:true}),
    checkStartupUpdate:()=>{x.checks++;return JSON.stringify({started:x.accepted});},
    getUpdateState:()=>{x.reads++;if(o.readFailure)throw Error('fixture read failure');return JSON.stringify(x.state);},
    checkUpdate:()=>{x.state.phase='checking';return JSON.stringify({ok:true});},
    downloadUpdate:()=>{x.downloads++;x.state.phase='downloading';return JSON.stringify({ok:true});},
    cancelUpdate:()=>{x.state.phase=x.state.candidate?'available':'idle';return JSON.stringify({ok:true});},
    installUpdate:()=>{x.installs++;return JSON.stringify({ok:true});}
   };
   window.Native=new Proxy(n,{get(t,k){if(Object.hasOwn(methods,k))return methods[k];return typeof t[k]==='function'?(...a)=>t[k](...a):t[k];}});
  })()`;
  const result=await c.call('Debugger.evaluateOnCallFrame',{callFrameId:paused.params.callFrames[0].callFrameId,expression:script,returnByValue:true});
  assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));await c.call('Debugger.resume');
  await until(()=>evaluate('!!window.StudyUI&&!!window.__startupUpdate'),'fresh boot');
 }
 async function until(fn,name,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(90);}throw Error('Timeout: '+name);}
 const view=()=>evaluate('({open:document.querySelector("#sheet").open,title:document.querySelector("#sheet-title")?.textContent,panel:document.querySelector("#app-update")?.innerText||"",badge:!document.querySelector("#update-entry").hidden,splash:!document.querySelector("#startup-screen").hidden,inert:document.querySelector(".app-shell").inert})');
 const candidate=await evaluate(`({versionCode:JSON.parse(Native.getAppInfo()).versionCode+1,versionName:'9.9.9',apkBytes:100000,releaseNotes:'启动更新测试：课程与记录功能保留。\\n<script>bad()</script>'})`);
 async function result(value,callback=true){await evaluate(`Object.assign(__startupUpdate.state,${JSON.stringify(value)});${callback?'onAppUpdateChanged()':''}`);await delay(100);}
 try{
  await reload();check(await evaluate('__startupUpdate.checks===1&&__startupUpdate.downloads===0'),'one launch check does not automatically download an APK');
  check(!(await view()).open&&(await view()).splash,'checking runs alongside the existing startup image');
  await result({phase:'available',candidate});
  check((await view()).open&&(await view()).title==='应用更新','newer candidate opens an update prompt directly during startup');
  check(!(await view()).splash&&!(await view()).inert,'update prompt replaces the image splash and releases its inert state');
  check((await view()).panel.includes('9.9.9')&&(await view()).panel.includes('<script>bad()</script>')&&!await evaluate('!!document.querySelector("#app-update script")'),'startup version and notes render safely as text');
  check(await evaluate('!!document.querySelector("[data-action=update-download]")&&!!document.querySelector(".update-later")'),'download and later are discoverable startup actions');
  candidate.releaseNotes='启动时可查看新版说明并下载更新。';await result({phase:'available',candidate});
  await shot('startup-update-available','#sheet');
  await click('.update-later');check(!(await view()).open&&(await view()).badge,'later dismisses the prompt and keeps a page-header entry');
  await result({phase:'available',candidate});check(!(await view()).open,'repeated native callbacks do not repeat a dismissed startup prompt');
  await evaluate('onNativeResume();onNativeResume()');check(!(await view()).open&&await evaluate('__startupUpdate.checks===1'),'ordinary resume does not recheck or reprompt');
  await click('#update-entry');await click('[data-action=update-download]');
  check(await evaluate('__startupUpdate.downloads===1')&&(await view()).panel.includes('下载中 0%'),'explicit startup download uses the existing updater action and real progress state');
  await result({phase:'downloading',bytes:42000,total:100000});check(await evaluate('document.querySelector("#update-progress").value===42'),'startup progress follows reported bytes');
  await click('[data-action=update-cancel]');check((await view()).panel.includes('下载更新')&&!(await view()).panel.includes('下载完成'),'cancellation remains retryable without claiming download success');
  await result({phase:'error',error:'下载中断',candidate});check((await view()).panel.includes('下载中断')&&await evaluate('document.querySelector("#app-update [data-action=update-download]").textContent==="重试"'),'download failure retains an actionable retry in the startup prompt');
  await result({phase:'ready',candidate,canInstall:false});
  check((await view()).panel.includes('安装权限未开启')&&await evaluate('document.querySelector("[data-action=update-install]").textContent==="开启安装权限"'),'installation permission is requested through an explicit action');
  await result({phase:'ready',candidate,canInstall:true});await click('[data-action=update-install]');
  check(await evaluate('__startupUpdate.installs===1')&&!/已安装|更新成功/.test((await view()).panel),'requesting installation does not claim installation success');
  await shot('startup-update-ready','#sheet');
  await c.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
  await evaluate('document.documentElement.classList.add("large-text");const sizes=[...document.querySelectorAll("#sheet,#sheet *,.masthead,.masthead *")].map(e=>({e,size:parseFloat(getComputedStyle(e).fontSize)}));sizes.forEach(x=>x.e.style.fontSize=(x.size*2)+"px")');
  check(await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#sheet").scrollWidth<=document.querySelector("#sheet").clientWidth+1'),'startup prompt and header fit 320px with enlarged text');
  const ax=await c.call('Accessibility.getFullAXTree');const names=ax.nodes.filter(n=>!n.ignored&&n.role?.value==='button').map(n=>n.name?.value);
  check(['安装更新','稍后','关闭'].every(name=>names.includes(name)),'startup update actions have names in the real accessibility tree');
  await shot('startup-update-large-text','#sheet');await c.call('Emulation.clearDeviceMetricsOverride');
  await reload();await result({phase:'current',candidate:null});
  check(!(await view()).open&&!(await view()).badge,'current version produces no update interruption');
  await reload();await result({phase:'error',candidate:null,error:'检查失败'});
  check(!(await view()).open&&!(await view()).badge&&await evaluate('document.querySelector("#toast").hidden'),'offline check failure produces no blocking prompt or error toast');
  await evaluate('InspirationUI.dismiss()');check(!(await view()).open&&!await evaluate('document.querySelector(".app-shell").inert'),'offline startup can enter the app immediately');
  await reload({accepted:false});await result({phase:'available',candidate});
  check(!(await view()).open,'native refusal on an already-consumed or restored Activity suppresses automatic prompts');
  await reload({readFailure:true});check(!(await view()).open,'unexpected update-state read failure does not stop app startup');
  await reload();await evaluate('InspirationUI.dismiss()');await click('.bottom-nav [data-nav=settings]');await click('[data-action=about]');await click('[data-action=update-cancel]');await evaluate('onAppUpdateChanged()');await click('[data-action=close-sheet]');await result({phase:'available',candidate});
  check(!(await view()).open,'canceling the pending check in About also cancels its automatic prompt');
  await reload();await evaluate('InspirationUI.dismiss()');await click('.bottom-nav [data-nav=settings]');
  const weekday=await evaluate('document.querySelector("#weekday-time").value');const draft=weekday==='18:15'?'18:16':'18:15';await input('#weekday-time',draft);
  await result({phase:'available',candidate});
  check(!(await view()).open&&(await view()).badge&&await evaluate(`document.querySelector('#weekday-time').value===${JSON.stringify(draft)}`),'a slow startup response does not interrupt or overwrite unsaved input');
  await click('#update-entry');await result({phase:'ready',candidate,canInstall:true});await click('[data-action=update-install]');
  check(await evaluate('__startupUpdate.installs===0')&&(await view()).panel.includes('未保存'),'installation remains blocked until current page edits are saved');
  await click('.update-later');check(await evaluate(`document.querySelector('#weekday-time').value===${JSON.stringify(draft)}`),'closing the update prompt retains unsaved input');
  await shot('startup-update-header-draft');
  await reload();await evaluate('InspirationUI.dismiss()');await click('.bottom-nav [data-nav=settings]');await click('[data-action=user-manual]');
  await result({phase:'available',candidate});check((await view()).title==='使用手册'&&(await view()).badge,'a late response does not replace an existing dialog');
  await reload();android('shell','input','keyevent','3');await delay(300);
  android('shell','am','start','-W','-n','cn.edu.njupt.studycheckin/.MainActivity');await delay(400);await result({phase:'available',candidate});
  check(!(await view()).open&&(await view()).badge&&await evaluate('__startupUpdate.checks===1'),'returning from actual Android background does not present a late startup prompt');
  await reload();await result({phase:'available',candidate},false);await until(async()=>(await view()).open,'callback-independent native check completion');
  check((await view()).open,'startup polling observes completion even when a previous Activity owned the callback');
  await evaluate('handleNativeBack()');await result({phase:'available',candidate});check(!(await view()).open,'Android back dismisses the startup prompt without reopening');
  await reload();await result({phase:'available',candidate:{...candidate,versionCode:1}});check(!(await view()).open&&!(await view()).badge,'same or older builds are never offered by the startup UI');
  assert.deepEqual(await state(),before);check(true,'all startup update choices preserve formal learning records');
  const subject=before.plan.subjects.find(s=>s.kind!=='vocab');const today=await evaluate('StudyModel.today()');
  const started=await native('startTimer',subject.id,subject.name,today);assert.ok(!started.error,started.error);
  await native('timerAction','pause');await reload();await result({phase:'ready',candidate,canInstall:true});
  const timerBefore=await native('getTimer');await click('[data-action=update-install]');
  check((await view()).title==='当前计时尚未保存'&&await evaluate('__startupUpdate.installs===0'),'active paused timer blocks startup installation with concrete choices');
  await click('[data-action=update-return]');check((await view()).title==='应用更新'&&(await view()).panel.includes('下载完成'),'timer cancel returns to the startup updater rather than About');
  assert.deepEqual(await native('getTimer'),timerBefore);check(true,'canceling installation preserves the paused timer');
  await click('[data-action=update-install]');await click('[data-action=update-finish]');
  check(!(await native('getTimer')).active&&await evaluate('__startupUpdate.installs===1'),'save and continue actually finishes the timer before requesting installation');
  const afterSave=await state();check(afterSave.sessions.length===(before.sessions?.length||0)+1,'timer save creates exactly one session');
  await click('[data-action=update-install]');check((await state()).sessions.length===afterSave.sessions.length,'repeated install action does not duplicate a saved session');
 }finally{
  await c.call('Debugger.removeBreakpoint',{breakpointId:bp.breakpointId}).catch(()=>{});
  await c.call('Debugger.disable').catch(()=>{});await c.call('Emulation.clearDeviceMetricsOverride').catch(()=>{});c.close();
 }
});
