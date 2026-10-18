'use strict';
const {connect,android,delay}=require('./cdp-client.cjs'),nativeUI=require('./native-ui.cjs');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),W=require('../app/src/main/assets/weekly-goals.js');
const root=path.resolve(__dirname,'..'),pkg='cn.edu.njupt.studycheckin',base='/data/user/0/'+pkg;
const adb=path.join(process.env.ANDROID_SDK_ROOT,'platform-tools/adb.exe'),serial=process.env.ANDROID_SERIAL||'emulator-5572';
const report=path.join(root,'docs/validation-v1.4.0'),shots=path.join(root,'docs/screenshots/v1.4.0');
const checks=[],metrics=[],saved=new Map();let c,failure,restored=false;
const check=(value,name)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
const shell=s=>android('shell',s),read=f=>cp.execFileSync(adb,['-s',serial,'exec-out','cat',base+'/'+f]);
const write=(f,b)=>cp.execFileSync(adb,['-s',serial,'shell','cat > '+base+'/'+f],{input:b});
const native=(n,...a)=>c.evaluate(`JSON.parse(Native[${JSON.stringify(n)}](...${JSON.stringify(a)}))`),state=()=>native('getState');
const click=async s=>{await c.evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);await delay(180);};
const input=async(s,v,event='input')=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);await delay(80);};
const submit=async s=>{await c.evaluate(`document.querySelector(${JSON.stringify(s)}).requestSubmit()`);await delay(250);};
const val=s=>c.evaluate(`document.querySelector(${JSON.stringify(s)}).value`);
const visible=s=>c.evaluate(`!!document.querySelector(${JSON.stringify(s)})?.getClientRects().length`);
const uiTasks=(form='week-form')=>c.evaluate(`JSON.parse(document.querySelector('#${form} [name="week-tasks"]').value)`);
const setState=async s=>{const result=await native('saveState',JSON.stringify(s));assert.ok(result.ok,JSON.stringify(result));};
const nav=r=>click('.bottom-nav [data-nav="'+r+'"]');
async function boot(){if(c)c.close();c=null;android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');for(let i=0;i<40;i++){try{c=await connect();if(await c.evaluate('!!window.StudyUI'))break;c.close();c=null;}catch{}await delay(150);}assert.ok(c);await c.evaluate('InspirationUI.back()');}
async function day(date){await nav('today');await input('#day-picker',date,'change');}
async function editor(){await click('[data-action=edit-week][data-scope=today]');}
async function add(title,subject){await click('#week-form [data-week-action=add]');const n=(await uiTasks()).at(-1).id;await input('[data-task-row="'+n+'"] textarea',title);if(subject)await input('[data-task-row="'+n+'"] select',subject,'change');return n;}
async function shot(name){await c.evaluate('document.getElementById("toast").hidden=true;document.activeElement.blur()');await delay(450);android('shell','screencap','-p','/sdcard/weekly-goals.png');android('pull','/sdcard/weekly-goals.png',path.join(shots,name+'.png'));}
async function confirmAction(expression,accept){const pending=c.evaluate(expression);await delay(220);await nativeUI.byId('android:id/button'+(accept?'1':'2'));await pending;await delay(200);}
const oldFont=android('shell','settings','get','system','font_scale');
(async()=>{try{
 fs.mkdirSync(report,{recursive:true});fs.mkdirSync(shots,{recursive:true});assert.equal(serial,'emulator-5572');assert.match(shell('id'),/uid=0/);android('shell','am','force-stop',pkg);
 for(const f of ['files/study-state.json','files/plans.json','files/drafts.json','shared_prefs/stopwatch.xml'])saved.set(f,shell('if [ -f '+base+'/'+f+' ]; then echo yes; else echo no; fi')==='yes'?read(f):null);
 const fixture=M.migrateState(structuredClone(require('../app/src/main/assets/seed.json')),'2026-10-18');
 fixture.plan.weekGoals['2026-10-12']='复习我正在使用的教材第三章';fixture.plan.weekHints['2026-10-12']='整理课堂笔记';
 const r=M.record(fixture,'2026-10-14');r.subjects.math.minutes=0;r.subjects.vocab.reviewWords=10;r.status='休息';M.saveRecord(fixture,'2026-10-14',r);
 write('files/study-state.json',Buffer.from(JSON.stringify(fixture)));shell('rm -f '+base+'/files/plans.json '+base+'/files/drafts.json');await boot();await day('2026-10-14');
 check((await native('getAppInfo')).versionName==='1.4.0'&&(await state()).version===3,'actual Android build and schema match v1.4.0');
 check(await c.evaluate('document.querySelector("[data-week-goal]").textContent.includes("教材第三章")'),'legacy free text appears on today without generated tasks');
 await editor();check((await val('#week-goal')).includes('教材第三章')&&(await uiTasks()).length===0,'editor retains old text and starts with an empty task list');
 const one=await add('整理课堂笔记与公式','math'),two=await add('完成教材第三章例题','math'),three=await add('回顾本周易忘词','vocab');
 check((await state()).plan.weekTasks['2026-10-12']===undefined,'adding and editing tasks only writes a draft');
 await click('[data-week-action=up][data-task-id="'+three+'"]');check((await uiTasks()).map(t=>t.id).join(',')===[one,three,two].join(','),'reordering keeps each stable task ID');
 await click('[data-week-action=delete][data-task-id="'+three+'"]');check((await uiTasks()).length===2&&await visible('[data-week-action=undo]'),'deletion exposes an actual undo action');await click('[data-week-action=undo]');check((await uiTasks())[1].id===three,'undo restores the same task and position');
 await shot('weekly-goal-editor');await submit('#week-form');
 let s=await state(),items=s.plan.weekTasks['2026-10-12'];check(items.length===3&&items[0].title==='整理课堂笔记与公式'&&items[1].subjectId==='vocab','manual save persists titles subject links and order');
 check(items.every(t=>!!Date.parse(t.updatedAt)),'saved changes carry actual operation timestamps');
 check(!await visible('#week-today-form .save-row'),'today save action appears only after changes or restored draft');
 const quantities=JSON.stringify({records:s.records,sessions:s.sessions,targets:s.plan.targets,reviews:s.reviews});
 await click('#week-today-form [data-task-id="'+one+'"]');check(!(await state()).plan.weekTasks['2026-10-12'][0].done&&await visible('#week-today-form .save-row'),'today checkbox exposes pending save without changing formal completion');
 await nav('review');check(await c.evaluate('document.querySelector(".review-goals").textContent.includes("0 / 3")'),'weekly review reads saved state while a checkbox draft is pending');
 check(JSON.parse((await native('getDraft','main:week:2026-10-12')).draft.base['week-tasks']).every(t=>!!t.updatedAt),'closed editor cannot recreate its stale draft over pending today input');
 await day('2026-10-14');check((await uiTasks('week-today-form'))[0].done,'returning today restores pending task completion');
 shell('chmod 550 '+base+'/files');await submit('#week-today-form');
 check((await uiTasks('week-today-form'))[0].done&&!(await state()).plan.weekTasks['2026-10-12'][0].done&&await c.evaluate('document.querySelector("#week-today-form .save-feedback").textContent.includes("保存失败")'),'actual filesystem failure retains checkbox input and reports failure');
 shell('chmod 700 '+base+'/files');await click('#week-today-form [data-action=retry-save]');
 s=await state();check(s.plan.weekTasks['2026-10-12'][0].done,'retry confirms saved completion');
 check(JSON.stringify({records:s.records,sessions:s.sessions,targets:s.plan.targets,reviews:s.reviews})===quantities,'task saves leave actual zero unknown words sessions references and reviews unchanged');
 const same=JSON.stringify(s.plan.weekTasks),revision=s._revision;await submit('#week-today-form');s=await state();check(JSON.stringify(s.plan.weekTasks)===same&&s._revision===revision,'repeated unchanged submission neither duplicates tasks nor changes timestamps or revision');
 await c.evaluate('document.querySelector("#week-today-form").scrollIntoView({block:"start"})');await shot('weekly-goals-today');
 await nav('review');check(await c.evaluate('document.querySelector(".review-goals").textContent.includes("1 / 3")&&document.querySelector(".review-goals").textContent.includes("未完成")'),'review shows saved complete and incomplete task groups');await shot('weekly-goals-review');
 await day('2026-10-19');check((await uiTasks('week-today-form')).length===0,'a new week starts without copied tasks');
 await day('2026-10-14');await editor();await input('[data-task-row="'+two+'"] textarea','草稿中的题号补充');await boot();await day('2026-10-14');await editor();
 check((await uiTasks()).find(t=>t.id===two).title==='草稿中的题号补充','task title and row structure recover after process restart');await submit('#week-form');
 // Independent native edit merges with the checked task instead of overwriting it.
 await editor();await input('[data-task-row="'+two+'"] textarea','本地新标题');s=await state();s.plan.weekTasks['2026-10-12'].find(t=>t.id===three).done=true;await setState(s);await submit('#week-form');
 s=await state();check(s.plan.weekTasks['2026-10-12'].find(t=>t.id===three).done&&s.plan.weekTasks['2026-10-12'].find(t=>t.id===two).title==='本地新标题','stable ID merge preserves independent changes from another writer');
 // Conflicting edits have a field-specific choice before another save.
 await editor();await input('[data-task-row="'+two+'"] textarea','我要保留的标题');s=await state();s.plan.weekTasks['2026-10-12'].find(t=>t.id===two).title='已保存的新标题';await setState(s);await submit('#week-form');
 check(await visible('[data-week-conflicts] select')&&(await state()).plan.weekTasks['2026-10-12'].find(t=>t.id===two).title==='已保存的新标题','competing titles produce a visible choice without overwriting the saved title');
 await input('[data-week-choice]','edited','change');await click('[data-week-action=resolve]');await submit('#week-form');check((await state()).plan.weekTasks['2026-10-12'].find(t=>t.id===two).title==='我要保留的标题','selected conflict resolution persists only after saving');
 // Draft conflict recovery uses the same per-task resolution.
 await editor();await input('[data-task-row="'+two+'"] textarea','重启前的草稿');s=await state();s.plan.weekTasks['2026-10-12'].find(t=>t.id===two).title='重启时的已保存内容';await setState(s);await boot();await day('2026-10-14');
 check(await visible('#week-today-form [data-week-choice]'),'conflicting recovered draft presents a per-task choice on today');await input('#week-today-form [data-week-choice]','edited','change');await click('#week-today-form [data-week-action=resolve]');await submit('#week-today-form');
 check((await state()).plan.weekTasks['2026-10-12'].find(t=>t.id===two).title==='重启前的草稿','recovered draft conflict selection saves the intended title');
 await nav('plan');await c.evaluate('document.querySelector("#range-form").closest("details").open=true');await input('#range-start','2026-10-13');await input('#range-end','2026-10-25');await input('#start-week','20');await submit('#range-form');await click('[data-action=edit-week]');await click('#sheet [data-action=week-history]');
 check(await c.evaluate('document.querySelector(".week-history").textContent.includes("原日期分组")'),'history finds the original weekly group after start date and teaching-label changes');await shot('weekly-goals-history');
 await click('[data-action=week-open][data-key="2026-10-12"]');check((await uiTasks()).length===3,'history opens original tasks for editing by stored dates');
 await click('[data-action=week-move]');await input('#week-move-date','2026-10-20');
 const beforeMove=JSON.stringify((await state()).plan);await confirmAction('document.querySelector("#week-move-form").requestSubmit()',false);
 check(JSON.stringify((await state()).plan)===beforeMove,'cancelling migration leaves source and destination unchanged');
 await confirmAction('document.querySelector("#week-move-form").requestSubmit()',true);s=await state();check(!s.plan.weekTasks['2026-10-12']&&s.plan.weekTasks['2026-10-20'].length===3,'confirmed migration moves task IDs and clears the original date group');
 await day('2026-10-21');await editor();const longId=await add('长任务名称与教材页码'.repeat(25),'math');await submit('#week-form');
 for(const width of [320,360,390,430]){await c.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});await delay(80);check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),width+'px today task layout has no horizontal overflow');}
 await editor();const ax=await c.call('Accessibility.getFullAXTree');
 check(ax.nodes.filter(n=>!n.ignored&&['checkbox','textbox','combobox','button'].includes(n.role?.value)).every(n=>!!n.name?.value),'editor controls expose accessible names including long task titles');
 check(await c.evaluate('[...document.querySelectorAll("#week-form button")].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=43)'),'task action buttons retain 44px touch height');
 await shot('weekly-goal-long-task');await click('#sheet [data-action=close-sheet]');
 android('shell','settings','put','system','font_scale','2.0');await boot();await day('2026-10-21');await c.call('Emulation.setDeviceMetricsOverride',{width:320,height:1000,deviceScaleFactor:1,mobile:true});
 check((await native('getPlatformInfo')).fontScale===2&&await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'320px at actual 200% system font fits full task text');
 await editor();check(await c.evaluate('document.querySelector("#sheet").scrollWidth<=document.querySelector("#sheet").clientWidth'),'200% editor fits without horizontal clipping');await shot('weekly-goals-large-text');
 await click('#sheet [data-action=close-sheet]');android('shell','settings','put','system','font_scale','1.0');await boot();await day('2026-10-21');
 // New plans and their task drafts are isolated from the source plan.
 await click('[data-action=plan-picker]');await click('[data-action=new-plan]');await input('#new-plan-name','任务隔离测试计划');await submit('#new-plan-form');
 check((await state()).plan.title==='任务隔离测试计划'&&W.keys((await state()).plan).length===0,'new plan does not inherit old goals or completed tasks');
 await click('[data-action=plan-picker]');await click('[data-action=switch-plan][data-plan=main]');await day('2026-10-21');check((await uiTasks('week-today-form')).some(t=>t.id===longId),'switching back restores original plan tasks');
 const runtime=c.events.filter(e=>e.method==='Runtime.exceptionThrown');check(runtime.length===0,'weekly UI flows have no uncaught runtime exceptions');
}catch(e){failure=e;console.error(e);}finally{
 try{if(c)c.close();c=null;android('shell','am','force-stop',pkg);shell('chmod 700 '+base+'/files');for(const[f,b]of saved){if(b===null)shell('rm -f '+base+'/'+f);else write(f,b);}restored=true;}catch(e){failure=failure||e;console.error(e);}
 android('shell','settings','put','system','font_scale',oldFont==='null'?'1.0':oldFont);
 fs.writeFileSync(path.join(report,'weekly-goals-ui-results.json'),JSON.stringify({passed:checks.length,checks,metrics,restored,error:failure?.stack||null,unverified:['Physical vivo X100s','TalkBack spoken output and gesture navigation']},null,2));console.log(JSON.stringify({passed:checks.length,restored,error:failure?.message||null}));if(failure)process.exitCode=1;
}})();
