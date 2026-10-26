'use strict';
// Actual Android WebView coverage. The owned emulator's files and preferences
// are snapshotted before fixtures and restored, including absent/new files.
const {connect,android,delay}=require('./cdp-client.cjs');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const M=require('../app/src/main/assets/model.js'),S=require('../app/src/main/assets/schedule.js');
const root=path.resolve(__dirname,'..'),pkg='cn.edu.njupt.studycheckin';
const adb=process.env.ANDROID_SDK_ROOT?path.join(process.env.ANDROID_SDK_ROOT,'platform-tools/adb.exe'):'adb';
const serial=process.env.ANDROID_SERIAL||'emulator-5572';
const formal=process.env.COURSE_FORMAL_UPGRADE==='1',privateBase='/data/user/0/'+pkg;
const version=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8'))[1];
const report=path.join(root,'docs','validation-v'+version),shots=path.join(root,'docs','screenshots','v'+version);
const checks=[],metrics=[],runtimeExceptions=[],saved=new Map(),savedDirs=new Map();
const historicalDates=M.dates('2026-10-12','2026-10-15');
let customCases,c,failure,restored=false,snapshotComplete=false,oldFont;
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const snapshotDirectory=path.join(require('node:os').tmpdir(),'daily-study-v141-snapshots',crypto.randomUUID());
const owners=new Map();
const check=(value,name)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
function closeClient(){if(c){runtimeExceptions.push(...c.events.filter(event=>event.method==='Runtime.exceptionThrown'));c.close();c=null;}}
const privateArgs=(mode,command)=>['-s',serial,mode,...(formal?[]:['run-as',pkg]),'sh','-c',mode==='shell'?quote((formal?'cd '+quote(privateBase)+' && ':'')+command):(formal?'cd '+quote(privateBase)+' && ':'')+command];
const runAs=(command,input,encoding='utf8')=>cp.execFileSync(adb,privateArgs('shell',command),{input,encoding});
const shell=command=>runAs(command).trim();
const read=file=>cp.execFileSync(adb,privateArgs('exec-out','cat '+quote(file)));
const write=(file,buffer)=>runAs('base64 -d > '+quote(file),Buffer.from(buffer).toString('base64'),null);
function roots(){
  return ['files','shared_prefs'].filter(dir=>{
    const status=shell('if [ -d '+quote(dir)+' ]; then printf directory; elif [ -e '+quote(dir)+' ] || [ -L '+quote(dir)+' ]; then printf other; else printf absent; fi');
    assert.notEqual(status,'other',dir+' must be a regular directory');return status==='directory';
  });
}
function paths(type){
  return roots().flatMap(dir=>{
    const predicate=type==='unsupported'?'! -type f ! -type d':'-type '+type;
    const raw=cp.execFileSync(adb,privateArgs('exec-out','find '+quote(dir)+' '+predicate+' -print0'));
    return raw.toString('utf8').split('\0').filter(Boolean);
  }).sort();
}
function owned(file){assert.ok(file==='files'||file==='shared_prefs'||/^(?:files|shared_prefs)\//.test(file),'unexpected app-private path');assert.ok(!file.split('/').includes('..'),'parent traversal in app-private path');return file;}
async function snapshot(){
  android('shell','am','force-stop',pkg);
  assert.deepEqual(paths('unsupported'),[],'app-private snapshot rejects symbolic links and special files');
  for(const dir of paths('d')){savedDirs.set(owned(dir),shell('stat -c %a '+quote(dir)));if(formal)owners.set(dir,shell('stat -c %u:%g '+quote(dir)));}
  for(const file of paths('f')){
    saved.set(owned(file),{bytes:read(file),mode:shell('stat -c %a '+quote(file))});
    if(formal)owners.set(file,shell('stat -c %u:%g '+quote(file)));
    const output=path.join(snapshotDirectory,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,saved.get(file).bytes);
  }
  fs.mkdirSync(snapshotDirectory,{recursive:true});fs.writeFileSync(path.join(snapshotDirectory,'manifest.json'),JSON.stringify({directories:[...savedDirs],owners:[...owners],files:[...saved].map(([file,item])=>({file,mode:item.mode,bytes:item.bytes.length,sha256:digest(item.bytes)}))},null,2));
  snapshotComplete=true;
}
async function restore(){
  if(!snapshotComplete)return;
  closeClient();android('shell','am','force-stop',pkg);
  shell('chmod 700 files');
  for(const file of paths('f'))if(!saved.has(file))shell('rm -- '+quote(owned(file)));
  for(const dir of [...savedDirs.keys()].sort((a,b)=>a.length-b.length))shell('mkdir -p '+quote(dir));
  for(const [file,item]of saved){write(file,item.bytes);shell('chmod '+item.mode+' '+quote(file));if(formal)shell('chown '+owners.get(file)+' '+quote(file));}
  for(const dir of paths('d').sort((a,b)=>b.length-a.length))if(!savedDirs.has(dir))shell('rmdir -- '+quote(owned(dir)));
  for(const [dir,mode]of [...savedDirs].sort((a,b)=>b[0].length-a[0].length)){shell('chmod '+mode+' '+quote(dir));if(formal)shell('chown '+owners.get(dir)+' '+quote(dir));}
  assert.deepEqual(paths('f'),[...saved.keys()].sort());
  for(const [file,item]of saved){assert.equal(digest(read(file)),digest(item.bytes),file+' restored digest');assert.equal(shell('stat -c %a '+quote(file)),item.mode,file+' restored mode');}
  assert.deepEqual(paths('d'),[...savedDirs.keys()].sort());
  restored=true;check(true,'all original app files and preferences restored byte for byte; fixture-only files removed');
}
const native=(name,...args)=>c.evaluate(`JSON.parse(Native[${JSON.stringify(name)}](...${JSON.stringify(args)}))`);
const state=()=>native('getState');
const click=async selector=>{await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(170);};
const input=async(selector,value,event='input')=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);await delay(100);};
async function boot(){
  closeClient();android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');
  for(let i=0;i<45;i++){try{const candidate=await connect();if(await candidate.evaluate('!!window.StudyUI')){c=candidate;break;}candidate.close();}catch{}await delay(150);}
  assert.ok(c,'actual debuggable Android WebView is available');await c.evaluate('InspirationUI.back()');
}
async function day(date){await click('.bottom-nav [data-nav=today]');await input('#day-picker',date,'change');}
async function shot(name,selector){
  await c.evaluate('document.activeElement.blur();document.querySelector("#toast").hidden=true');
  if(selector)await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`);
  await c.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await delay(1000);const remote='/sdcard/course-agenda-fix-ui.png';android('shell','screencap','-p',remote);android('pull',remote,path.join(shots,name+'.png'));
}
async function fixtureInstall(value){
  closeClient();android('shell','am','force-stop',pkg);shell('chmod 700 files');
  for(const file of paths('f'))if(/^files\/(?:study-state|plans|drafts|plan-switch-journal|restore-journal)\.json(?:\.(?:bak|new))?$/.test(file))shell('rm -- '+quote(file));
  for(const file of paths('f'))if(/^shared_prefs\/stopwatch\.xml(?:\.bak)?$/.test(file))shell('rm -- '+quote(file));
  write('files/study-state.json',Buffer.from(JSON.stringify(value)));await boot();
}
function baseFixture(){
  const value=M.migrateState(JSON.parse(fs.readFileSync(path.join(root,'app/src/main/assets/seed.json'),'utf8')),'2026-10-16');
  const course=value.plan.subjects.find(item=>item.id==='course-review');
  course.activePeriods=[{from:'2026-10-16',to:null}];
  const samples=[['2026-10-12',45,0,null],['2026-10-13',null,0,0],['2026-10-14',0,null,10],['2026-10-15',75,50,null]];
  for(const [date,minutes,newWords,reviewWords]of samples){const r=M.record(value,date);r.subjects.math.minutes=minutes;r.subjects.vocab.newWords=newWords;r.subjects.vocab.reviewWords=reviewWords;r.status=date==='2026-10-14'?'休息':'减量';r.restKept=date==='2026-10-14';r.note='历史随记 '+date;M.saveRecord(value,date,r);}
  return value;
}
function historyFootprint(value){
  const clipped=structuredClone(value);clipped.plan.endDate='2026-10-15';
  return {days:historicalDates.map(date=>({date,subjects:M.subjectsForDate(value,date),targets:value.plan.targets[date],record:value.records[date],summary:M.recordSummary(value,date)})),week:M.weekStats(clipped,'2026-10-12'),month:M.monthStats(clipped,'2026-10'),fullWeek:M.weekStats(value,'2026-10-12'),fullMonth:M.monthStats(value,'2026-10')};
}
async function historyCases(){
  const fixture=baseFixture(),baseline=historyFootprint(fixture),before={targets:fixture.plan.targets,records:fixture.records};
  await fixtureInstall(fixture);check((await native('getAppInfo')).versionName===version,'installed Android build matches current manifest');
  const loaded=await state();
  check(historicalDates.every(date=>M.recordSummary(loaded,date).totalSubjects===2),'historical dates retain their two-subject recording denominator');
  const expectedWeek=baseline.week.subjects.find(item=>item.id==='math'),expectedCourse=baseline.week.subjects.find(item=>item.id==='course-review'),expectedWords=M.wordStats(loaded,historicalDates)[0];
  check(expectedWeek.actual===120&&expectedWeek.recordedDays===3&&expectedWeek.reference===150&&expectedCourse.reference===0&&expectedCourse.totalDays===0,'historical math keeps 120 actual minutes, three recorded days and 150 reference minutes; inactive course adds none');
  check(expectedWords.newWords===50&&expectedWords.reviewWords===10,'historical word counts retain fifty new words and ten review words');
  const partial=M.recordSummary(loaded,'2026-10-13'),zero=M.recordSummary(loaded,'2026-10-14');
  check(partial.total===null&&partial.kind==='partial'&&partial.recordedSubjects===1,'word zero with unknown math remains a partial record without an invented zero-minute day');
  check(zero.total===0&&zero.reviewWords===10&&zero.kind==='complete','explicit zero minutes and ten reviewed words retain their actual complete-record state');
  for(const date of historicalDates){
    await day(date);
    const agenda=await c.evaluate(`(()=>{const a=document.querySelector('.course-agenda');return a?{text:a.innerText,first:a.querySelector('ol>li .agenda-heading').innerText,emptyStrong:[...a.querySelectorAll('strong')].some(e=>!e.textContent.trim()),courseInput:!!document.querySelector('#minutes-course-review')}:null;})()`);
    check(agenda&&agenda.text.indexOf('课程复习')<agenda.text.indexOf('高数')&&agenda.text.indexOf('高数')<agenda.text.indexOf('单词'),date+' shows course review then calculus then words');
    check(!/null|undefined|NaN/.test(agenda.text)&&!agenda.first.includes('分钟')&&!agenda.emptyStrong,date+' historical course order has no invented or empty minute label');
    check(!agenda.courseInput,date+' course order does not add an inactive historical recording field');
    assert.deepEqual(historyFootprint(await state()),baseline);check(true,date+' keeps historical null, zero, subjects, references, records and statistics unchanged');
  }
  const after=await state();assert.deepEqual({targets:after.plan.targets,records:after.records},before);check(true,'viewing all four historical days does not rewrite any reference or record');
  await shot('course-historical-order','.course-agenda');
  const empty=baseFixture();empty.plan.subjects.find(item=>item.id==='course-review').activePeriods=[];
  await fixtureInstall(empty);await day('2026-10-14');check(await c.evaluate('!document.querySelector(".course-agenda")'),'empty course activity periods do not resurrect a historical course agenda');
  const gap=baseFixture();gap.plan.subjects.find(item=>item.id==='course-review').activePeriods=[{from:'2026-10-16',to:'2026-10-17'},{from:'2026-10-20',to:null}];
  await fixtureInstall(gap);await day('2026-10-18');check(await c.evaluate('!document.querySelector(".course-agenda")'),'an archive gap after first activation does not resurrect the course agenda');
  const independent=baseFixture();independent.plan.startWeek=8;
  await fixtureInstall(independent);await day('2026-10-14');check(await c.evaluate('!document.querySelector(".course-agenda")'),'an independent plan does not acquire the original timetable historical fallback');
}
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const weekday=date=>(new Date(date+'T00:00:00Z').getUTCDay()+6)%7;
const normalizeRange=text=>text.replace(/\s/g,'').replace(/[—–−~～]/g,'-');
async function agenda(date){return c.evaluate(`StudySchedule.agenda(JSON.parse(Native.getState()),${JSON.stringify(date)})`);}
async function checkWeekend(date,total,afternoon){
  await day(date);const model=await agenda(date),text=await c.evaluate('document.querySelector(".course-agenda").innerText');
  check(model.courseMinutes===90&&model.mathMinutes===afternoon&&model.courseMinutes+model.mathMinutes===total,date+' displays ninety course minutes and '+afternoon+' calculus minutes');
  check(JSON.stringify(model.periods)===JSON.stringify({morning:[60,120],afternoon:afternoon===210?[180,240]:[120,180]}),date+' exposes the actual morning and afternoon ranges');
  const normalized=normalizeRange(text);
  check(normalized.includes('上午1-2小时')&&normalized.includes('下午'+(afternoon===210?'3-4':'2-3')+'小时')&&!/早间参考|下午休息|null|undefined/.test(text),date+' shows flexible ranges without limiting Sunday to morning');
}
async function openWeekends(){await click('.bottom-nav [data-nav=plan]');await click('[data-action=weekend-schedule]');}
function observationFootprint(value){return {records:value.records,reviews:value.reviews,sessions:value.sessions,wordTargets:value.plan.wordTargets,subjects:value.plan.subjects.map(s=>({...s,defaults:s.defaults.slice(0,5)})),weekGoals:value.plan.weekGoals,weekHints:value.plan.weekHints,weekTasks:value.plan.weekTasks};}
async function weekendCases(){
  const fresh=baseFixture();await fixtureInstall(fresh);
  await checkWeekend('2026-10-17',300,210);await shot('course-saturday-expanded','.course-agenda');
  await checkWeekend('2026-10-18',240,150);await shot('course-sunday-expanded','.course-agenda');
  const today=await c.evaluate('StudyModel.today()'),first=[today,'2026-10-15',fresh.plan.startDate].sort().at(-1);
  const legacy=baseFixture();legacy.plan.endDate=[legacy.plan.endDate,shift(first,21)].sort().at(-1);
  const course=legacy.plan.subjects.find(item=>item.id==='course-review'),math=legacy.plan.subjects.find(item=>item.id==='math');
  course.defaults[5]=60;course.defaults[6]=30;math.defaults[5]=30;math.defaults[6]=30;
  for(const date of M.dates('2026-10-16',legacy.plan.endDate)){
    const d=weekday(date),row=legacy.plan.targets[date]||(legacy.plan.targets[date]={});
    if(d>=5){row['course-review']=d===5?60:30;row.math=30;}else if(date>=first){row['course-review']=13;row.math=17;}
  }
  const affected=S.weekendDates(legacy,today),saturday=affected.find(date=>weekday(date)===5),sunday=affected.find(date=>weekday(date)===6&&date>saturday);
  assert.ok(saturday&&sunday,'a complete future weekend is present in the dynamically extended fixture');
  const r=M.record(legacy,saturday);r.subjects['course-review'].minutes=12;r.subjects.math.minutes=0;r.subjects.vocab.newWords=5;r.subjects.vocab.reviewWords=null;r.note='参考调整前的记录';r.status='休息';M.saveRecord(legacy,saturday,r);
  legacy.sessions.push({id:'weekend-reference-actual-session',date:'2026-10-14',subjectId:'math',seconds:61,endedAt:'2026-10-14T10:00:00Z'});
  await fixtureInstall(legacy);let current=await state();assert.deepEqual(current.plan.targets,legacy.plan.targets);check(true,'an existing profile keeps its original weekend and custom weekday references until explicit apply');
  await day(saturday);check((await agenda(saturday)).periods===null,'old ninety-minute weekend does not receive the new multi-hour range labels');
  check(await c.evaluate('!document.querySelector(".course-agenda").innerText.includes("上午")'),'old weekend card does not imply a longer morning assignment');
  await openWeekends();
  const preview=await c.evaluate('document.querySelector("#sheet").innerText'),button=await c.evaluate('(()=>{const b=document.querySelector("#sheet [data-action=apply-course-schedule]");return {mode:b.dataset.mode,from:b.dataset.from,to:b.dataset.to,revision:b.dataset.revision};})()');
  check(preview.includes('周末安排')&&preview.includes('240—360 分钟')&&preview.includes('180—300 分钟')&&preview.includes('包括自定值')&&preview.includes(affected.length+' 个周末日期'),'preview shows actual totals, date count and custom-reference replacement scope');
  check(button.mode==='weekends'&&button.from===affected[0]&&button.to===affected.at(-1)&&button.revision===String(current._revision||0),'preview action is bound to the actual weekend range and current saved revision');
  check(normalizeRange(preview).includes('课程复习1-2小时')&&normalizeRange(preview).includes('周六3-4小时')&&normalizeRange(preview).includes('周日2-3小时'),'preview includes both user-approved flexible periods');
  await shot('weekend-reference-preview');await click('#sheet [data-action=close-sheet]');assert.deepEqual(await state(),current);check(true,'cancelling weekend reference replacement leaves the complete saved state unchanged');
  // A competing saved reference invalidates the open preview rather than
  // allowing its confirmation to overwrite a newer revision.
  await openWeekends();const competing=structuredClone(current),workday=M.dates(first,legacy.plan.endDate).find(date=>weekday(date)<5);competing.plan.targets[workday].math=19;
  const savedCompeting=await native('saveState',JSON.stringify(competing));assert.ok(savedCompeting.ok,savedCompeting.error);current=await state();
  await click('#sheet [data-action=apply-course-schedule][data-mode=weekends]');check(await c.evaluate('document.querySelector("#sheet").open'),'a competing saved revision keeps the outdated preview open');
  assert.deepEqual(await state(),current);check(true,'an outdated preview does not replace newer saved references');await click('#sheet [data-action=close-sheet]');
  await openWeekends();
  try{
    shell('chmod 550 files');await click('#sheet [data-action=apply-course-schedule][data-mode=weekends]');
    check(await c.evaluate('document.querySelector("#sheet").open'),'actual native write failure keeps the weekend preview available for retry');
    assert.deepEqual(await state(),current);check(true,'actual native write failure leaves references and all actual records unchanged');
    check(!await c.evaluate('document.querySelector("#toast").textContent.includes("安排已更新")'),'a failed apply does not report a confirmed update');
  }finally{shell('chmod 700 files');}
  const expected=M.applyWeekendSchedule(current,today);await click('#sheet [data-action=apply-course-schedule][data-mode=weekends]');
  const updated=await state();
  check(!await c.evaluate('document.querySelector("#sheet").open')&&await c.evaluate('document.querySelector("#toast").textContent.includes("安排已更新")'),'only successful persistence closes the preview and confirms the update');
  assert.deepEqual(updated.plan.targets,expected.plan.targets);check(true,'the confirmed action replaces precisely the eligible future weekend references');
  const unaffected=Object.keys(current.plan.targets).filter(date=>!affected.includes(date));
  check(unaffected.every(date=>JSON.stringify(updated.plan.targets[date])===JSON.stringify(current.plan.targets[date])),'all past dates and custom weekday references remain unchanged');
  assert.deepEqual(updated.plan.subjects,expected.plan.subjects);assert.deepEqual(observationFootprint(updated),observationFootprint(current));check(true,'weekend reference replacement preserves actual zero/unknown values, counts, notes, sessions, goals and subject defaults');
  await checkWeekend(saturday,300,210);await checkWeekend(sunday,240,150);
  // Actual Android font scale, rather than an injected CSS-only approximation.
  android('shell','settings','put','system','font_scale','2.0');await boot();
  await c.call('Emulation.setDeviceMetricsOverride',{width:320,height:1000,deviceScaleFactor:1,mobile:true});await day(sunday);
  const layout=await c.evaluate('(()=>{const a=document.querySelector(".course-agenda");return {width:innerWidth,page:document.documentElement.scrollWidth,agenda:a.scrollWidth,available:a.clientWidth,text:a.innerText};})()');metrics.push({case:'Sunday agenda at 320 CSS pixels and Android 200 percent font',...layout});
  check((await native('getPlatformInfo')).fontScale===2&&layout.page<=layout.width&&layout.agenda<=layout.available,'Sunday course order and full range text fit 320px with actual 200% Android text');
  const ax=await c.call('Accessibility.getFullAXTree');
  check(ax.nodes.some(node=>!node.ignored&&node.name?.value==='复习顺序')&&ax.nodes.some(node=>!node.ignored&&normalizeRange(node.name?.value||'').includes('下午2-3小时')),'course-order region and afternoon range remain exposed to accessibility');
  check(ax.nodes.some(node=>!node.ignored&&node.role?.value==='spinbutton'&&node.name?.value.includes('课程复习实际分钟')),'course minute field retains its accessible name and unit');await shot('course-sunday-320px-200pct','.course-agenda');
  const assessmentLayout=await c.evaluate('(()=>{const a=document.querySelector(".daily-assessment"),o=document.querySelector(".overview.with-reference-range");return {page:document.documentElement.scrollWidth,width:innerWidth,assessment:a.scrollWidth,assessmentWidth:a.clientWidth,overview:o.scrollWidth,overviewWidth:o.clientWidth};})()');
  check(assessmentLayout.page<=assessmentLayout.width&&assessmentLayout.assessment<=assessmentLayout.assessmentWidth&&assessmentLayout.overview<=assessmentLayout.overviewWidth,'daily assessment and range metrics fit 320px with 200% Android text');await shot('assessment-320px-200pct','.daily-assessment');
  await click('.bottom-nav [data-nav=plan]');await click('[data-action=edit-reference]');
  const intervalAx=await c.call('Accessibility.getFullAXTree');check(intervalAx.nodes.some(n=>!n.ignored&&n.role?.value==='spinbutton'&&n.name?.value==='课程复习参考下限分钟')&&intervalAx.nodes.some(n=>!n.ignored&&n.role?.value==='spinbutton'&&n.name?.value==='课程复习参考上限分钟'),'both interval endpoints expose subject, bound and unit to accessibility');
  check(await c.evaluate('document.querySelector("#sheet").scrollWidth<=document.querySelector("#sheet").clientWidth'),'interval editor fits 320px with 200% Android text');await shot('reference-editor-320px-200pct');await click('#sheet [data-action=close-sheet]');
  await openWeekends();const sheet=await c.evaluate('(()=>{const e=document.querySelector("#sheet");return {scroll:e.scrollWidth,width:e.clientWidth,page:document.documentElement.scrollWidth,viewport:innerWidth};})()');metrics.push({case:'Weekend preview at 320 CSS pixels and Android 200 percent font',...sheet});
  check(sheet.scroll<=sheet.width&&sheet.page<=sheet.viewport,'weekend preview and replacement actions fit 320px at 200% text');
  const previewAx=await c.call('Accessibility.getFullAXTree');check(previewAx.nodes.some(node=>!node.ignored&&node.role?.value==='button'&&node.name?.value==='应用安排')&&previewAx.nodes.some(node=>!node.ignored&&node.role?.value==='button'&&node.name?.value==='取消'),'replacement and cancel controls retain accessible action names');
  await shot('weekend-preview-320px-200pct');await click('#sheet [data-action=close-sheet]');
}
async function assessmentCases(){
  const fixture=baseFixture(),date='2026-10-19';fixture.plan.targets[date].math={min:30,max:70};fixture.plan.targets[date]['course-review']={min:30,max:50};await fixtureInstall(fixture);await day(date);
  const submit=async()=>{await c.evaluate('document.querySelector("#daily-form").requestSubmit()');await delay(220);};
  const inputs=async(course,math,words,status)=>{
    await input('#minutes-course-review',course==null?'':String(course));await input('#minutes-math',math==null?'':String(math));await input('#newWords-vocab',words==null?'':String(words));
    if(status)await click('input[name=status][value="'+status+'"]');
  };
  await inputs(30,30,50,'正常参考');
  check(await c.evaluate('!document.querySelector(".assessment-pending").hidden&&document.querySelector(".assessment-results").hidden'),'unsaved inputs show pending assessment rather than a speculative result');
  const before=await state();
  try{shell('chmod 550 files');await submit();check(await c.evaluate('!document.querySelector(".assessment-pending").hidden&&!!document.querySelector(".save-feedback [data-action=retry-save]")'),'real daily save failure leaves assessment pending and offers retry');assert.deepEqual(await state(),before);}finally{shell('chmod 700 files');}
  await click('[data-action=retry-save][data-form=daily-form]');
  check(await c.evaluate('!document.querySelector(".assessment-results").hidden&&document.querySelector("[data-time-assessment]").dataset.timeAssessment==="within"'),'successful retry evaluates the saved lower-bound record');
  const revision=(await state())._revision;await submit();check((await state())._revision===revision,'unchanged repeated save does not create a new assessment revision');
  const cases=require('./fixtures/assessment-cases.json').filter(x=>!x.legacy&&!x.noCourse&&!x.zeroTargets&&!x.outsidePlan&&x.status);
  for(const row of cases){
    await inputs(row.course,row.math,row.newWords,row.status);await input('#reviewWords-vocab',row.reviewWords==null?'':String(row.reviewWords));await submit();
    const result=await c.evaluate('({time:document.querySelector("[data-time-assessment]").dataset.timeAssessment,word:document.querySelector("[data-word-assessment]").dataset.wordAssessment,pending:document.querySelector(".assessment-pending").hidden})');
    check(result.time===row.expected.kind&&result.word===row.expected.word&&result.pending,'saved WebView assessment '+row.id);
    const current=await state();check(current.records[date].subjects.math.minutes===row.math&&current.records[date].subjects['course-review'].minutes===row.course,'assessment retains actual blank/zero observations '+row.id);
  }
  await inputs(50,70.01,51,'正常参考');await submit();await shot('assessment-above-range','.daily-assessment');
  await inputs(0,null,null,'正常参考');await boot();await day(date);
  check(await c.evaluate('document.querySelector("#minutes-course-review").value==="0"&&document.querySelector("#minutes-math").value===""&&!document.querySelector(".assessment-pending").hidden'),'range assessment draft restores zero versus unknown after restart without publishing a result');await submit();
  check(await c.evaluate('document.querySelector("[data-time-assessment]").dataset.timeAssessment==="partial"'),'zero plus unknown remains pending completion after confirmed save');
  await click('[data-action=assessment-rules]');check((await c.evaluate('document.querySelector("#sheet").innerText')).includes('50%'),'assessment rules expose the selected reduction policy');await click('#sheet [data-action=close-sheet]');
  await click('.bottom-nav [data-nav=plan]');await click('[data-action=edit-reference]');
  await input('#target-math','90');await input('[id="target-math:max"]','60');await c.evaluate('document.querySelector("#reference-form").requestSubmit()');await delay(220);
  check(await c.evaluate('document.querySelector("#sheet").open&&document.querySelector("#target-math").value==="90"'),'invalid reversed interval leaves the editor and entered values available');
  await input('#target-math','10');await input('[id="target-math:max"]','20');await c.evaluate('document.querySelector("#reference-form").requestSubmit()');await delay(220);
  check(JSON.stringify((await state()).plan.targets[date].math)===JSON.stringify({min:10,max:20}),'reference editor persists both endpoints as one interval');
  await day(date);check((await c.evaluate('document.querySelector(".range-value").innerText')).includes('40—70'),'daily reference total shows the edited interval rather than a midpoint');
  await click('.bottom-nav [data-nav=review]');check(await c.evaluate('!!document.querySelector(".assessment-summary")'),'weekly review includes saved assessment counts');
  await day(date);await inputs(30,10,50,'减量');await submit();await shot('assessment-reduced','.daily-assessment');
}
function nativeCases(){
  let output='';
  try{
    output=cp.execFileSync(adb,['-s',serial,'shell','am','instrument','-w','-r',pkg+'/'+pkg+'.SmokeTests'],{encoding:'utf8',maxBuffer:8*1024*1024});
  }catch(error){output=String(error.stdout||'')+String(error.stderr||'');throw error;}
  finally{fs.writeFileSync(path.join(report,'native-test-results.txt'),output);}
  check(/(?:^|\n)INSTRUMENTATION_CODE:\s*-1\s*(?:\r?\n|$)/.test(output)&&!/\bFAILED\b|INSTRUMENTATION_FAILED|(?:^|\n)\s*FAIL:/m.test(output),'complete native SmokeTests finish with instrumentation code -1 and no failed result');
  for(const extension of ['pdf','csv']){
    const file='cache/reference-validation.'+extension,b=read(file);fs.writeFileSync(path.join(report,'reference-validation.'+extension),b);shell('rm -- '+quote(file));
    check(extension==='pdf'?b.subarray(0,4).toString()==='%PDF':b.toString('utf8').includes('30—50')&&b.toString('utf8').includes('完成（合格）'),'actual Android '+extension+' interval assessment sample is exported for review');
  }
}
async function formalCases(){
  const priorVersion=process.env.FORMAL_BASE_VERSION||'1.4.1',code=Number(/android:versionCode="(\d+)"/.exec(fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8'))[1]);
  const ui=require('./native-ui.cjs');assert.match(android('shell','id'),/uid=0/,'formal upgrade requires the owned emulator root shell');
  const info=()=>{const out=android('shell','dumpsys','package',pkg);return {version:/versionName=([^\s]+)/.exec(out)?.[1],code:Number(/versionCode=(\d+)/.exec(out)?.[1]),debuggable:/flags=\[[^\]]*DEBUGGABLE/.test(out)};};
  const bootFormal=async()=>{android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');await delay(1200);let skip=ui.nodes().find(n=>n.text?.includes('跳过'));if(skip){ui.tap(skip);await delay(200);}};
  const tap=async(text,scroll=true,maxBottom=scroll?2110:2300)=>{const matches=value=>text instanceof RegExp?text.test(value||''):value===text;for(let i=0;i<9;i++){const n=ui.nodes().find(n=>{const b=[...n.bounds.matchAll(/\d+/g)].map(x=>Number(x[0]));return (matches(n.text)||matches(n['content-desc']))&&b[1]>0&&b[3]>b[1]&&b[3]<maxBottom;});if(n){ui.tap(n);await delay(250);return;}if(scroll)android('shell','input','swipe','500','1700','500','650','250');await delay(100);}throw Error('Visible formal control missing: '+text);};
  const old=structuredClone(require('../app/src/main/assets/seed.json'));old.version=3;old._revision=11;old.plan.manualWeekGoals=true;old.plan.weekGoals={'2026-10-12':'保留我的课程目标'};old.plan.weekHints={};old.plan.weekTasks={'2026-10-12':[{id:'task_cover',title:'保留已有任务',subjectId:'math',done:true,updatedAt:'2026-10-16T08:00:00Z'}]};
  old.plan.subjects.unshift({id:'course-review',name:'课程复习',kind:'custom',defaults:[30,30,30,30,30,60,30],activePeriods:[{from:'2026-10-16',to:null}]});
  M.dates('2026-10-16',old.plan.endDate).forEach(date=>{old.plan.targets[date]['course-review']=weekday(date)===5?60:30;});
  const r=M.record(old,'2026-10-14');r.subjects.math.minutes=0;r.subjects.vocab.newWords=0;r.subjects.vocab.reviewWords=10;r.status='休息';r.note='正式升级保留记录';M.saveRecord(old,'2026-10-14',r);
  const rememberedDay='2026-10-19';old.plan.targets[rememberedDay].math={min:30,max:70};old.plan.targets[rememberedDay]['course-review']={min:30,max:50};const remembered=M.record(old,rememberedDay);remembered.status='正常参考';remembered.subjects.math.minutes=30;remembered.subjects['course-review'].minutes=30;remembered.subjects.vocab.newWords=50;M.saveRecord(old,rememberedDay,remembered);delete old.assessmentBases;delete old.plan.courseSchedule;old.version=4;
  const owner=android('shell','stat','-c','%u:%g',privateBase);android('shell','am','force-stop',pkg);
  for(const file of paths('f'))if(/^files\/(?:study-state|plans|drafts|plan-switch-journal)\.json(?:\.(?:bak|new))?$/.test(file))shell('rm -- '+quote(file));
  write('files/study-state.json',Buffer.from(JSON.stringify(old)));write('files/plans.json',Buffer.from(JSON.stringify({version:1,activeId:'main',items:[{id:'main',name:old.plan.title,state:null}]})));shell('chown '+owner+' files/study-state.json files/plans.json');
  android('install','--no-incremental','-r','-d',path.join(root,'dist/每日学习-v'+priorVersion+'.apk'));await bootFormal();check(info().version===priorVersion,'actual previous formal '+priorVersion+' launches with the legacy interval-free fixture');
  const before=read('files/study-state.json');android('shell','am','force-stop',pkg);android('install','--no-incremental','-r',path.join(root,'dist/每日学习-v'+version+'.apk'));
  check(read('files/study-state.json').equals(before),'same-signature formal cover installation preserves the complete original learning file');check(info().version===version&&info().code===code&&!info().debuggable,'installed formal APK matches current version and code without debug mode');
  await bootFormal();check(read('files/study-state.json').equals(before),'first formal launch migrates only the view and does not rewrite saved legacy observations');
  await tap('计划',false);if(code>=19)await tap('计划设置');await tap('课程与区间安排');
  const preview=ui.nodes().map(n=>n.text||'').join(' ');check(preview.includes('60—120')&&preview.includes('240—360')&&preview.includes('180—300'),'formal preview exposes weekday and both weekend intervals');
  await tap('取消',false);check(read('files/study-state.json').equals(before),'cancelling formal reference replacement preserves the original learning file');
  await tap('课程与区间安排');await tap('应用安排',false);const after=JSON.parse(read('files/study-state.json'));
  check(after.version===8&&after._revision===12,'formal interval application commits current schema exactly once');check(after.plan.courseSchedule.versions[0].courses.length===16,'formal migration persists the verified timetable with original period and week data');check(after.assessmentBases[rememberedDay].source==='existing','formal first save identifies retained legacy criteria correctly');check(require('../app/src/main/assets/reference.js').assess(after,rememberedDay).time.kind==='within','formal first save retains the previous saved-day assessment');assert.deepEqual(after.records,old.records);assert.deepEqual(after.plan.weekTasks,old.plan.weekTasks);assert.deepEqual(after.plan.weekGoals,old.plan.weekGoals);check(true,'formal interval application retains actual zero unknown fields word counts rest notes and tasks');
  const now=android('shell','date','+%Y-%m-%d'),affected=M.dates([now,old.plan.startDate].sort().at(-1),old.plan.endDate);
  check(affected.every(d=>typeof after.plan.targets[d].math==='object'&&typeof after.plan.targets[d]['course-review']==='object'),'formal saved future references contain both endpoints rather than midpoint values');
  M.dates(old.plan.startDate,shift(affected[0],-1)).forEach(d=>assert.deepEqual(after.plan.targets[d],old.plan.targets[d]));check(true,'formal future arrangement leaves all historical reference values unchanged');
  await tap('今日',false);
  if(code>=21)await tap(/^单词，.*编辑记录$/);else if(code>=19)await tap('单词 未记录');
  await tap('单词 新学增加5个');
  const draftOnly=JSON.parse(read('files/study-state.json'));check(!draftOnly.records[now],'formal quick addition stays in the draft until daily save');
  if(code>=21)await tap('完成',false);
  await tap(code>=21?'保存记录':'保存这一天');const wordSaved=JSON.parse(read('files/study-state.json')),wordEntry=wordSaved.records[now].subjects.vocab;
  check(wordEntry.newWords===5&&wordEntry.reviewWords===null&&wordEntry.wordLog.entries.length===1&&wordEntry.wordLog.entries[0].source==='quick','formal v1.6.1 saves the word batch and daily totals together');
  const wordIds=wordEntry.wordLog.entries.map(e=>e.id);await tap(code>=21?'保存记录':'保存这一天');assert.deepEqual(JSON.parse(read('files/study-state.json')).records[now].subjects.vocab.wordLog.entries.map(e=>e.id),wordIds);check(true,'formal repeat save keeps the same word event ID');
  await tap('设置',false);if(code>=19&&code<21)await tap('应用',false);await tap('关于');check(ui.nodes().some(n=>(n.text||'').replace(/\s/g,'').includes('版本'+version)),'formal About page displays the actual installed version');
  android('shell','screencap','-p','/sdcard/reference-formal-upgrade.png');android('pull','/sdcard/reference-formal-upgrade.png',path.join(shots,'formal-upgrade-about.png'));
  if(code>=22){
    await tap('关闭',false);await tap('计划',false);await tap('总体任务分配');
    let wordInput;for(let i=0;i<5;i++){wordInput=ui.nodes().find(n=>n.class==='android.widget.EditText'&&parseFloat(n.text)===50&&(n.text||'').includes('单词'));if(wordInput)break;await delay(200);}assert.ok(wordInput,'formal overall word-goal field');ui.tap(wordInput);android('shell','input','keyevent','KEYCODE_MOVE_END');for(let i=0;i<3;i++)android('shell','input','keyevent','KEYCODE_DEL');android('shell','input','text','40');if(/mInputShown=true|isInputViewShown\(\)=true/.test(android('shell','dumpsys','input_method')))android('shell','input','keyevent','KEYCODE_BACK');
    await tap('应用分配',true,2300);await ui.byId('android:id/button1');await delay(350);const allocation=JSON.parse(read('files/study-state.json'));
    check(require('../app/src/main/assets/model.js').wordTarget(allocation,now,'vocab')===40&&require('../app/src/main/assets/model.js').wordTarget(allocation,allocation.plan.endDate,'vocab')===40,'formal native controls apply forty new words to today and the remaining plan');
    assert.deepEqual(allocation.records,wordSaved.records);check(allocation.assessmentBases[now].words.find(w=>w.id==='vocab').goal===40&&allocation.assessmentBases[rememberedDay].words.find(w=>w.id==='vocab').goal===50,'formal batch change updates current criteria and preserves past criteria and actual records');
    await tap('今日',false);android('shell','screencap','-p','/sdcard/formal-allocation.png');android('pull','/sdcard/formal-allocation.png',path.join(shots,'formal-allocation-today.png'));
  }

}
async function main(){
  try{
    assert.equal(serial,'emulator-5572','fixture writes are restricted to the owned emulator');assert.equal(android('shell','getprop','ro.kernel.qemu'),'1','target must be an emulator');
    fs.mkdirSync(report,{recursive:true});fs.mkdirSync(shots,{recursive:true});oldFont=android('shell','settings','get','system','font_scale');await snapshot();
    android('shell','settings','put','system','font_scale','1.0');
    if(customCases)await customCases({M,S,check,fixtureInstall,state,native,day,click,input,shot,android,shell,read,write,delay,root,report,shots,baseFixture,evaluate:expression=>c.evaluate(expression),protocol:(method,params)=>c.call(method,params),nativeCases,boot});else if(formal)await formalCases();else if(process.env.COURSE_LAYOUT==='1'){
      cp.execFileSync(process.execPath,[path.join(root,'tests/plan-layout-ui.cjs')],{stdio:'inherit',env:process.env});
      const result=JSON.parse(fs.readFileSync(path.join(report,'plan-layout-results.json'),'utf8'));check(result.passed===76&&!result.error,'all seventy-six current plan-list layout regressions pass');
    }else if(process.env.COURSE_NATIVE_ONLY==='1')nativeCases();else{
      await historyCases();await assessmentCases();await weekendCases();
      if(process.env.COURSE_FIX_NATIVE==='1')nativeCases();
      check(runtimeExceptions.length===0&&c.events.filter(event=>event.method==='Runtime.exceptionThrown').length===0,'course scheduling flows have no uncaught WebView exception');
    }
  }catch(error){failure=error;console.error(error);}finally{
    try{await restore();}catch(error){failure=failure||error;console.error(error);}
    if(oldFont!==undefined){if(oldFont==='null')android('shell','settings','delete','system','font_scale');else android('shell','settings','put','system','font_scale',oldFont);}
    fs.mkdirSync(report,{recursive:true});fs.writeFileSync(path.join(report,process.env.COURSE_REPORT_NAME|| (formal?'formal-upgrade-results.json':process.env.COURSE_LAYOUT==='1'?'layout-wrapper-results.json':process.env.COURSE_NATIVE_ONLY==='1'?'native-wrapper-results.json':'course-agenda-fix-ui-results.json')),JSON.stringify({version,passed:checks.length,checks,metrics,runtimeExceptions,restored,originalFiles:[...saved].map(([file,item])=>({file,bytes:item.bytes.length,sha256:digest(item.bytes)})),error:failure?.stack||null,unverified:['Physical vivo X100s operation','TalkBack spoken output and gesture navigation']},null,2));
    console.log(JSON.stringify({passed:checks.length,restored,error:failure?.message||null}));if(failure)process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports=async function(cases){customCases=cases;return main();};
