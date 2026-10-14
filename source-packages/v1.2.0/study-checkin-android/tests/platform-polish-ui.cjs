'use strict';
// Run only against the owned, debuggable API 36 emulator; never against a user's phone.
const {connect,android,delay}=require('./cdp-client.cjs'),ui=require('./native-ui.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const PKG='cn.edu.njupt.studycheckin',PERMISSION='android.permission.POST_NOTIFICATIONS';
const version=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(__dirname,'../app/src/main/AndroidManifest.xml'),'utf8'))[1];
const reportFile=path.join(__dirname,'../docs/validation-v'+version+'/platform-polish-ui-results.json');
const shotDir=path.join(__dirname,'../docs/screenshots/v'+version);
let c,permissionBefore,appOpBefore,originalStudy,originalInspiration,widgetsBefore,widgetBoundsBefore,filesCaptured=false;
const checks=[],unverified=[],cleanupErrors=[];
const check=(ok,message)=>{assert.ok(ok,message);checks.push(message);console.log('PASS '+message);};
const safeAndroid=(...args)=>{try{return android(...args);}catch{return '';}};
const platform=()=>c.evaluate('JSON.parse(Native.getPlatformInfo())');
const study=()=>c.evaluate('JSON.parse(Native.getState())');
const click=async selector=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing UI control');e.click();})()`);await delay(200);};
const navSettings=()=>click('[data-nav="settings"]');
async function requestWidget(){const message=await c.evaluate('document.querySelector("[data-action=pin-widget]").click();document.querySelector("#toast").textContent');await delay(400);return message;}
async function reconnect(){
  if(c)c.close();c=null;
  android('shell','am','start','-W','-n',PKG+'/.MainActivity');
  for(let i=0;i<30;i++){try{c=await connect();if(await c.evaluate('!!window.StudyUI'))break;c.close();c=null;}catch{c=null;}await delay(150);}
  assert.ok(c,'Cannot connect to test APK');
  await c.evaluate('window.InspirationUI && InspirationUI.back()');await delay(100);
}
async function until(fn,message){for(let i=0;i<30;i++){if(await fn())return;await delay(200);}throw Error(message);}
function permissionSnapshot(){
  const dump=android('shell','dumpsys','package',PKG),line=dump.split('\n').find(x=>x.includes(PERMISSION+': granted='));
  assert.ok(line,'Runtime notification permission not present');
  return {granted:line.includes('granted=true'),userSet:/\bUSER_SET\b/.test(line),userFixed:/\bUSER_FIXED\b/.test(line)};
}
function widgetIds(){
  const lines=android('shell','dumpsys','appwidget').split('\n'),ids=[];
  for(let i=0;i<lines.length;i++){
    const m=/\bid=(\d+)\b/.exec(lines[i]);if(!m)continue;
    let block=lines[i];for(let j=i+1;j<Math.min(lines.length,i+16)&&!/^\s*(?:\[\d+\]\s*)?id=\d+\b/.test(lines[j]);j++)block+='\n'+lines[j];
    if(block.includes(PKG)&&block.includes('StudyWidget'))ids.push(Number(m[1]));
  }
  return [...new Set(ids)].sort((a,b)=>a-b);
}
const widgetLogs=()=>android('shell','logcat','-d','-v','brief','-s','DailyStudyWidget:I','*:S');
async function nativeControl(predicate,label){
  for(let i=0;i<12;i++){const nodes=ui.nodes(),node=nodes.find(predicate);if(node){ui.tap(node);return;}await delay(150);}throw Error('Native control missing: '+label);
}
async function capture(name){fs.mkdirSync(shotDir,{recursive:true});android('shell','screencap','-p','/sdcard/platform-polish-shot.png');android('pull','/sdcard/platform-polish-shot.png',path.join(shotDir,name+'.png'));}
async function setReminders(enabled){
  await navSettings();const current=await c.evaluate('document.querySelector("#reminders-enabled").checked');
  if(current!==enabled)await click('#reminders-enabled');
  await c.evaluate('document.querySelector("#reminder-form").requestSubmit()');
  await until(async()=>((await study()).settings.reminders.enabled===enabled)&&await c.evaluate('document.querySelector("#reminder-form .save-feedback")?.textContent.includes("已保存")'),'Reminder settings did not save');
}
function widgetContainers(){
  // Keep hierarchy so each app-owned root resolves to its actual launcher host.
  ui.nodes();const xml=android('shell','cat','/sdcard/daily-release-ui.xml'),stack=[],nodes=[];
  for(const token of xml.matchAll(/<\/?node\b[^>]*>/g)){
    const tag=token[0];if(tag.startsWith('</')){stack.pop();continue;}
    const node=Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));node.parent=stack.at(-1);nodes.push(node);
    if(!tag.endsWith('/>'))stack.push(node);
  }
  const hosts=[];
  for(const root of nodes.filter(n=>n['resource-id']===PKG+':id/widget_root')){
    let host=root;for(let p=root.parent;p;p=p.parent){if(/AppWidgetHostView/.test(p.class||'')){host=p;break;}}
    // widget_root is the complete remote-view container if the launcher flattens its host class.
    if(host.bounds&&!hosts.some(n=>n.bounds===host.bounds))hosts.push(host);
  }
  return hosts;
}
async function removeNewWidgets(){
  let extra=widgetIds().filter(id=>!widgetsBefore.includes(id));
  if(extra.length&&!widgetBoundsBefore)throw Error('No pre-addition widget bounds snapshot; refusing to select a widget');
  const maxAttempts=extra.length;
  for(let attempt=0;extra.length&&attempt<maxAttempts;attempt++){
    android('shell','input','keyevent','3');await delay(250);
    const containers=widgetContainers();
    if(widgetBoundsBefore.some(bounds=>!containers.some(n=>n.bounds===bounds)))throw Error('Existing widget moved or is not visible; refusing ambiguous cleanup');
    const added=containers.filter(n=>!widgetBoundsBefore.includes(n.bounds));
    if(added.length!==extra.length)throw Error('New widget containers are ambiguous; refusing to alter existing widgets');
    const node=added[0];
    const p=[...node.bounds.matchAll(/\d+/g)].map(x=>Number(x[0])),x=Math.round((p[0]+p[2])/2),y=Math.round((p[1]+p[3])/2);
    let down=false;
    try{
      android('shell','input','touchscreen','motionevent','DOWN',String(x),String(y));down=true;await delay(800);
      const target=ui.nodes().find(n=>/^(Remove|删除|移除)$/.test(n.text||n['content-desc']||'')||/delete_target|remove_target/.test(n['resource-id']||''));
      if(!target)throw Error('Launcher removal target unavailable; remove the newly added widget manually');
      const b=[...target.bounds.matchAll(/\d+/g)].map(a=>Number(a[0])),tx=Math.round((b[0]+b[2])/2),ty=Math.round((b[1]+b[3])/2);
      android('shell','input','touchscreen','motionevent','UP',String(x),String(y));down=false;
      android('shell','input','keyevent','4');await delay(180);
      android('shell','input','touchscreen','draganddrop',String(x),String(y),String(tx),String(ty),'1500');
      // Launcher Undo retains the bound ID briefly after the view has disappeared.
      const previousExtra=extra.slice(),deadline=Date.now()+15000;
      do{await delay(300);extra=widgetIds().filter(id=>!widgetsBefore.includes(id));}while(extra.length>=previousExtra.length&&Date.now()<deadline);
      if(extra.length>=previousExtra.length)throw Error('New widget IDs remain after 15-second Undo wait: '+extra.join(','));
    }finally{if(down)safeAndroid('shell','input','touchscreen','motionevent','UP',String(x),String(y));}
    extra=widgetIds().filter(id=>!widgetsBefore.includes(id));
  }
  if(extra.length)throw Error('New widget IDs remain: '+extra.join(','));
}
async function restore(){
  // Continue every cleanup step even after a failed assertion or disconnected WebView.
  if(widgetsBefore){try{await removeNewWidgets();assert.deepEqual(widgetIds(),widgetsBefore);}catch(e){cleanupErrors.push('widget cleanup: '+e.message);}}
  if(filesCaptured){try{
    if(c){c.close();c=null;}android('shell','am','force-stop',PKG);
    for(const [name,cache] of [['study-state.json','platform-polish-study.json'],['inspiration.json','platform-polish-inspiration.json']]){
      android('shell','run-as',PKG,'cp','cache/'+cache,'files/'+name);android('shell','run-as',PKG,'rm','cache/'+cache);
    }
    assert.deepEqual(JSON.parse(android('shell','run-as',PKG,'cat','files/study-state.json')),originalStudy);
    assert.deepEqual(JSON.parse(android('shell','run-as',PKG,'cat','files/inspiration.json')),originalInspiration);
  }catch(e){cleanupErrors.push('private store restoration: '+e.message);}}
  if(permissionBefore){try{
    android('shell','pm',permissionBefore.granted?'grant':'revoke',PKG,PERMISSION);
    for(const [flag,key] of [['user-set','userSet'],['user-fixed','userFixed']])android('shell','pm',permissionBefore[key]?'set-permission-flags':'clear-permission-flags',PKG,PERMISSION,flag);
    if(appOpBefore)android('shell','cmd','appops','set',PKG,'POST_NOTIFICATION',appOpBefore);
    assert.deepEqual(permissionSnapshot(),permissionBefore);
  }catch(e){cleanupErrors.push('notification permission restoration: '+e.message);}}
  if(c){c.close();c=null;}
}
(async()=>{let failure;
  try{
    check(/^emulator-/.test(process.env.ANDROID_SERIAL||'emulator-5572'),'test target is an owned emulator');
    check(android('shell','getprop','ro.build.version.sdk')==='36','platform is Android 16/API 36');
    await reconnect();check(!(await c.evaluate('JSON.parse(Native.getTimer())')).active,'no pre-existing timer is altered by platform tests');
    permissionBefore=permissionSnapshot();appOpBefore=/POST_NOTIFICATION:\s*(\w+)/.exec(safeAndroid('shell','cmd','appops','get',PKG,'POST_NOTIFICATION'))?.[1];
    widgetsBefore=widgetIds();
    await until(async()=>!await c.evaluate('JSON.parse(Native.getInspiration("daily",0,1)).fetching'),'Wait for existing image preparation to finish before snapshot');
    originalStudy=JSON.parse(android('shell','run-as',PKG,'cat','files/study-state.json'));
    originalInspiration=JSON.parse(android('shell','run-as',PKG,'cat','files/inspiration.json'));
    android('shell','run-as',PKG,'cp','files/study-state.json','cache/platform-polish-study.json');
    android('shell','run-as',PKG,'cp','files/inspiration.json','cache/platform-polish-inspiration.json');filesCaptured=true;
    await c.evaluate('Native.setInspirationOnline(false)');
    const next=await study();next.settings.reminders.enabled=false;
    check((await c.evaluate(`JSON.parse(Native.saveState(${JSON.stringify(JSON.stringify(next))}))`)).ok,'temporary disabled reminder baseline saved');
    android('shell','pm','revoke',PKG,PERMISSION);android('shell','pm','clear-permission-flags',PKG,PERMISSION,'user-set','user-fixed');
    await reconnect();await navSettings();
    check(!ui.nodes().some(n=>(n['resource-id']||'').includes('permission_deny_button')),'opening app/settings does not request notification permission');
    await click('#reminders-enabled');await delay(250);
    check(ui.nodes().some(n=>(n['resource-id']||'').includes('permission_deny_button')),'user enabling reminders opens actual notification permission prompt');
    await nativeControl(n=>(n['resource-id']||'').endsWith(':id/permission_deny_button')||/^(Don.t allow|不允许|拒绝)$/.test(n.text||''),'deny notification permission');
    await until(async()=>!(await platform()).notificationsGranted,'Denied notification permission is not reflected by Native');
    await c.evaluate('onNativeResume()');
    check(await c.evaluate('!document.querySelector("#notification-status").hidden&&document.querySelector("#notification-status").textContent.includes("通知权限未开启")&&!!document.querySelector("[data-action=notification-settings]")'),'permission refusal is a real visible state with working settings action');
    check(!(await study()).settings.reminders.enabled,'permission interaction does not silently save reminder draft');await capture('reminder-permission-denied');
    await click('[data-action="notification-settings"]');await delay(350);
    check(/com.android.settings/.test(android('shell','dumpsys','activity','activities')),'notification action opens Android settings');
    await nativeControl(n=>n.checkable==='true'&&n.checked==='false'&&(/Switch/.test(n.class||'')||/switch_widget|switch_bar/.test(n['resource-id']||'')),'enable app notifications in system settings');
    android('shell','input','keyevent','4');await delay(350);
    await until(async()=>(await platform()).notificationsGranted,'Grant in Android settings was not reflected on return');
    check(await c.evaluate('document.querySelector("#notification-status").hidden'),'system settings return clears denied-permission state');
    await setReminders(true);check((await study()).settings.reminders.enabled,'enabled reminders persist only after explicit successful save');
    await setReminders(false);check(!(await study()).settings.reminders.enabled,'turning reminders off persists false');
    check((await platform()).notificationsGranted,'turning reminders off does not revoke unrelated notification permission');
    check(await c.evaluate('document.querySelector("#notification-status").hidden'),'disabled reminders have no permission fallback block');await capture('reminders-off');
    if(!(await platform()).supportsPinWidget){
      await click('[data-action="pin-widget"]');check(await c.evaluate('document.querySelector("#sheet").textContent.includes("当前桌面未接受")'),'unsupported launcher exposes manual help after the action');
      unverified.push('Launcher does not support pin requests: actual cancellation and success were not verified');
    }else{
      android('shell','input','keyevent','3');await delay(250);widgetBoundsBefore=widgetContainers().map(n=>n.bounds);
      await reconnect();await navSettings();
      const logsBefore=widgetLogs(),requestMessage=await requestWidget();
      check(requestMessage==='已发起添加请求','widget request reports requested, not added');
      check(ui.nodes().some(n=>/^(Add|Add automatically|Add to home screen|添加|自动添加)$/.test(n.text||'')||/pin|widget/i.test(n['resource-id']||'')),'launcher presents real widget confirmation');
      await nativeControl(n=>/^(Cancel|取消)$/.test(n.text||'')||(n['resource-id']||'')==='android:id/button2','cancel widget request');await delay(400);
      assert.deepEqual(widgetIds(),widgetsBefore);check(true,'canceling pin request creates no study widget');
      check(widgetLogs()===logsBefore,'cancel/no callback is not reported as widget success');
      await reconnect();await navSettings();const beforeSuccess=widgetLogs();await requestWidget();
      await nativeControl(n=>/^(Add|Add automatically|Add to home screen|添加|自动添加)$/.test(n.text||'')||(n['resource-id']||'')==='android:id/button1','confirm widget addition');
      await until(async()=>widgetLogs().slice(beforeSuccess.length).includes('Widget pin confirmed:'),'No verified launcher callback received after addition');
      const delta=widgetLogs().slice(beforeSuccess.length),id=Number(/Widget pin confirmed:\s*(\d+)/.exec(delta)?.[1]);
      check(Number.isInteger(id)&&!widgetsBefore.includes(id)&&widgetIds().includes(id),'success callback refers to a newly bound StudyWidget ID');await capture('widget-added');
    }
  }catch(e){failure=e;console.error(e);}
  finally{await restore();
    fs.mkdirSync(path.dirname(reportFile),{recursive:true});const result={version,platform:'Android 16/API 36 actual APK permission/Settings/Launcher UI',passed:checks.length,checks,unverified,cleanupErrors,restored:cleanupErrors.length===0,failure:failure?.message||null};
    fs.writeFileSync(reportFile,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
    if(failure||cleanupErrors.length)process.exitCode=1;
  }
})();
