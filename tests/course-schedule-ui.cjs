'use strict';
// Device mutations are limited to the owned emulator and restored byte for byte.
const {connect,android,delay}=require('./cdp-client.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const pkg='cn.edu.njupt.studycheckin',root=path.resolve(__dirname,'..'),M=require('../app/src/main/assets/model.js');
const version=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8'))[1];
const reports=path.join(root,'docs','validation-v'+version),shots=path.join(root,'docs/screenshots','v'+version);
const serial=process.env.ANDROID_SERIAL||'emulator-5572',adb=path.join(process.env.ANDROID_SDK_ROOT,'platform-tools/adb.exe');
let c,failure;const checks=[],saved=new Map(),check=(ok,name)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name);};
const shell=s=>android('shell','run-as',pkg,'sh','-c',"'"+s+"'");
const read=f=>cp.execFileSync(adb,['-s',serial,'exec-out','run-as',pkg,'cat',f]);
const write=(f,b)=>cp.execFileSync(adb,['-s',serial,'shell','run-as',pkg,'sh','-c',"'cat > "+f+"'"],{input:b});
const native=(n,...args)=>c.evaluate(`JSON.parse(Native[${JSON.stringify(n)}](...${JSON.stringify(args)}))`),state=()=>native('getState');
async function boot(){if(c)c.close();c=null;android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');for(let i=0;i<35;i++){try{c=await connect();if(await c.evaluate('!!window.StudyUI'))break;c.close();c=null;}catch{}await delay(150);}assert.ok(c);await c.evaluate('InspirationUI.back()');}
const click=async s=>{await c.evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);await delay(180);};
const input=async(s,value,event='input')=>{await c.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(s)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);await delay(90);};
const submit=async()=>{await c.evaluate('document.querySelector("#daily-form").requestSubmit()');await delay(200);};
async function screenshot(name,selector){if(selector)await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await delay(450);android('shell','screencap','-p','/sdcard/course-ui.png');android('pull','/sdcard/course-ui.png',path.join(shots,name+'.png'));}
async function save(s){const r=await native('saveState',JSON.stringify(s));assert.ok(r.ok,r.error);await c.evaluate('onNativeResume()');}
(async()=>{try{
 fs.mkdirSync(reports,{recursive:true});fs.mkdirSync(shots,{recursive:true});assert.equal(serial,'emulator-5572');android('shell','am','force-stop',pkg);
 for(const f of ['study-state.json','plans.json','drafts.json','plan-switch-journal.json'].flatMap(n=>['files/'+n,'files/'+n+'.bak','files/'+n+'.new']).concat(['shared_prefs/stopwatch.xml','shared_prefs/stopwatch.xml.bak']))saved.set(f,shell('if [ -f '+f+' ]; then echo yes; else echo no; fi')==='yes'?read(f):null);
 write('files/study-state.json',fs.readFileSync(path.join(root,'app/src/main/assets/seed.json')));shell('rm -f files/plans.json files/drafts.json');await boot();
 const today=await c.evaluate('StudyModel.today()');assert.equal(today,'2026-10-15','fixture is tied to known Thursday teaching week');
 check((await native('getAppInfo')).versionName===version,'installed APK version matches build metadata');
 let s=await state();check(s.plan.subjects[0].id==='course-review'&&s.plan.targets[today]['course-review']===40&&s.plan.targets[today].math===50,'old default plan upgrades to course 40 then math 50');
 check(s.plan.subjects.find(x=>x.id==='vocab').wordGoal===undefined&&M.wordTarget(s,today,'vocab')===50,'vocabulary keeps fifty-new-word quantity goal');
 const agenda=await c.evaluate('document.querySelector(".course-agenda").innerText');
 check(agenda.indexOf('课程复习')<agenda.indexOf('高数')&&agenda.includes('激光原理')&&agenda.includes('微型计算机'),'today lists actual Thursday courses before exam review');
 check(!/\d{2}:\d{2}|固定|10 分钟/.test(agenda),'agenda has references with no prescribed daily start or break times');
 check(await c.evaluate('document.querySelector("#problem-course-review").placeholder===""'),'course problem input does not show a calculus example');await screenshot('course-today-agenda','.course-agenda');
 await input('#day-picker','2026-10-14','change');check(await c.evaluate('!document.querySelector(".course-agenda")&&!document.querySelector("#minutes-course-review")'),'past day keeps original two-subject scope');
 check((await state()).plan.targets['2026-10-14'].math===60,'past reference remains unchanged');
 await input('#day-picker','2026-10-17','change');check((await c.evaluate('document.querySelector(".course-agenda").innerText')).includes('60 分钟'),'Saturday offers sixty course and thirty calculus minutes');await screenshot('course-saturday','.course-agenda');
 await input('#day-picker','2026-10-18','change');check((await c.evaluate('document.querySelector(".course-agenda").innerText')).match(/30 分钟/g).length===2,'Sunday reference is thirty plus thirty minutes');
 await input('#day-picker',today,'change');await input('#minutes-course-review','0');await submit();
 s=await state();check(s.records[today].subjects['course-review'].minutes===0&&s.records[today].subjects.math.minutes===null,'course zero leaves unrecorded calculus unknown');
 check(await c.evaluate('document.querySelector("#daily-count").innerText.includes("1/2")'),'partial zero day displays one-of-two timed subjects recorded');
 await input('#minutes-course-review','23');shell('chmod 550 files');await submit();
 check((await state()).records[today].subjects['course-review'].minutes===0&&await c.evaluate('document.querySelector("#minutes-course-review").value==="23"&&!!document.querySelector(".save-feedback [data-action=retry-save]")'),'real write failure keeps input and offers retry');shell('chmod 700 files');await click('[data-action=retry-save]');
 s=await state();check(s.records[today].subjects['course-review'].minutes===23,'retry confirms actual course minutes');const revision=s._revision;await submit();check((await state())._revision===revision,'unchanged repeated save does not duplicate records');
 await input('#minutes-course-review','25');await boot();check(await c.evaluate('document.querySelector("#minutes-course-review").value==="25"'),'course draft survives restart separately from saved minutes');await submit();
 await click('[data-action=start-timer][data-subject=course-review]');check((await native('getTimer')).running,'course timer starts with its own subject identity');
 android('shell','input','keyevent','3');await delay(300);android('shell','am','start','-W','-n',pkg+'/.MainActivity');await delay(250);await c.evaluate('InspirationUI.back()');
 check((await native('getTimer')).running&&await c.evaluate('!document.querySelector(".inspiration-splash")'),'background return retains course timer without a launch card');
 await click('[data-action=timer-pause]');const paused=await native('getTimer');check(!paused.running&&paused.active,'pause is active and not a saved completion');await click('[data-action=timer-finish]');
 s=await state();check(s.sessions.filter(x=>x.subjectId==='course-review').length===1&&s.records[today].subjects['course-review'].minutes>=25,'finishing course timer stores its own net session');
 s.plan.targets[today].math=17;await save(s);check((await c.evaluate('document.querySelector(".course-agenda").innerText')).includes('17 分钟'),'edited reference appears directly in agenda');
 await click('[data-nav=plan]');const before=JSON.stringify(await state());await click('[data-action=course-schedule]');
 check((await c.evaluate('document.querySelector("#sheet").innerText')).includes('替换上述日期')&&(await c.evaluate('document.querySelector("#sheet").innerText')).includes('周日早间'),'preview identifies affected reference range and Sunday morning allocation');await screenshot('course-apply-preview');
 await click('[data-action=close-sheet]');check(JSON.stringify(await state())===before,'cancelling schedule preview leaves all state unchanged');
 await click('[data-action=course-schedule]');shell('chmod 550 files');await click('[data-action=apply-course-schedule]');check(await c.evaluate('document.querySelector("#sheet").open')&&(await state()).plan.targets[today].math===17,'failed schedule write keeps preview open and reference unchanged');shell('chmod 700 files');await click('[data-action=apply-course-schedule]');
 check(!await c.evaluate('document.querySelector("#sheet").open')&&(await state()).plan.targets[today].math===50,'successful explicit apply updates only confirmed references');
 const content=s=>{s=structuredClone(s);delete s._revision;return s;};
 const main=content(await state()),active=(await native('getPlans')).activeId,custom=structuredClone(await state());custom.plan.title='独立计划验证';custom.plan.startWeek=8;
 custom.plan.subjects=custom.plan.subjects.filter(x=>x.id!=='course-review');for(const t of Object.values(custom.plan.targets))delete t['course-review'];custom.records={};custom.reviews={};custom.sessions=[];
 const created=await native('createPlan',JSON.stringify(custom));assert.ok(created.ok,created.error);assert.ok((await native('switchPlan',created.id)).ok);await boot();
 check((await state()).plan.subjects.length===2&&!await c.evaluate('!!document.querySelector(".course-agenda")'),'custom independent plan is not silently rescheduled');
 assert.ok((await native('switchPlan',active)).ok);await boot();assert.deepEqual(content(await state()),main);check(true,'switching plans retains the main course records and references');
 await c.call('Emulation.setDeviceMetricsOverride',{width:320,height:780,deviceScaleFactor:1,mobile:true});await c.evaluate('document.documentElement.classList.add("large-text");document.documentElement.style.fontSize="32px"');
 check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'course agenda and fields fit 320 CSS pixels at large text');
 const ax=await c.call('Accessibility.getFullAXTree');check(ax.nodes.some(n=>!n.ignored&&n.role?.value==='spinbutton'&&n.name?.value.includes('课程复习实际分钟')),'course actual field exposes its name and unit to accessibility');
 await click('[data-nav=plan]');await click('[data-action=course-schedule]');check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'schedule preview fits small viewport at large text');await screenshot('course-preview-large-text');
 check(c.events.filter(e=>e.method==='Runtime.exceptionThrown').length===0,'course scheduling interactions have no uncaught WebView exceptions');
 }catch(e){failure=e;console.error(e);}finally{
  if(c){c.close();c=null;}try{android('shell','am','force-stop',pkg);shell('chmod 700 files');for(const[f,b]of saved){if(b===null)shell('rm -f '+f);else write(f,b);}for(const[f,b]of saved){assert.equal(shell('if [ -f '+f+' ]; then echo yes; else echo no; fi'),b===null?'no':'yes');if(b)assert.deepEqual(read(f),b);}checks.push('original study, plans, drafts and stopwatch restored byte for byte');}catch(e){failure=failure||e;console.error(e);}
  fs.writeFileSync(path.join(reports,'course-ui-results.json'),JSON.stringify({passed:checks.length,checks,error:failure?.stack||null},null,2));
 }if(failure)throw failure;console.log('PASS '+checks.length+' checks');})().catch(e=>{console.error(e);process.exitCode=1;});
