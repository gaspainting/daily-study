'use strict';
const {connect,android,delay}=require('./cdp-client.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const checks=[],out=path.join(__dirname,'../docs/screenshots');fs.mkdirSync(out,{recursive:true});
const check=(b,name)=>{assert.ok(b,name);checks.push(name);};
let c;
const click=async selector=>{await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.click()})()`);await delay(180);};
const nav=route=>click('[data-nav="'+route+'"]');
const capture=name=>{android('shell','screencap','-p','/sdcard/study-v11-screen.png');android('pull','/sdcard/study-v11-screen.png',path.join(out,name+'.png'));};
const data=()=>c.evaluate(`JSON.parse(Native.getInspiration('daily',0,20))`);
async function open(){android('shell','am','force-stop','cn.edu.njupt.studycheckin');android('shell','am','start','-W','-n','cn.edu.njupt.studycheckin/.MainActivity');await delay(300);for(let i=0;i<30;i++){try{c=await connect();break;}catch{await delay(120);}}if(!c)throw Error('Cannot connect to APK');for(let i=0;i<140;i++){if(await c.evaluate('!!(window.StudyUI&&window.InspirationUI&&window.InspirationUI.snapshot().startupShown)'))break;await delay(100);}}
(async()=>{try{
  // Obtain genuine network media before timing the cached cold-start display.
  android('shell','am','start','-W','-n','cn.edu.njupt.studycheckin/.MainActivity');await delay(400);c=await connect();await c.evaluate('window.InspirationUI && window.InspirationUI.back()');
  for(let i=0;i<180;i++){if((await data()).cached>0)break;await delay(250);}check((await data()).cached>0,'real network image prepared without generated fallback');c.close();c=null;
  await open();check((await c.evaluate('InspirationUI.snapshot()')).splashVisible,'cold start shows random image/text splash');for(let i=0;i<15;i++){if(await c.evaluate('document.querySelector(".startup-content")?.classList.contains("ready")'))break;await delay(80);}await delay(240);capture('v1.1-startup');
  const startupId=(await c.evaluate('InspirationUI.snapshot()')).startupId;
  const skipAt=Date.now();await click('#skip-startup');check(!(await c.evaluate('InspirationUI.snapshot()')).splashVisible&&Date.now()-skipAt<1200,'splash skip immediately enters app');
  check((await c.evaluate('StudyUI.snapshot()')).route==='today','splash enters existing Today screen');
  await nav('inspiration');check(await c.evaluate('!!document.querySelector(".inspiration-tabs")'),'daily card module reachable in bottom navigation');
  let before=await data();if(!before.daily){capture('v1.1-undrawn');await click('[data-inspire="draw"]');for(let i=0;i<100;i++){if((await data()).daily)break;await delay(200);}}
  let d=await data();check(!!d.daily,'draw commits fixed daily card');const dailyId=d.daily.id;
  check((await c.evaluate(`JSON.parse(Native.drawDaily())`)).id===dailyId,'repeat draw returns same stored card');
  check(await c.evaluate(`(()=>{const id=${JSON.stringify(dailyId)};const e=JSON.parse(Native.getInspirationEntry(id));return e.card.language.startsWith('zh')||!!e.card.translation})()`),'displayed foreign content has Chinese meaning');
  if(!(await c.evaluate('document.querySelector("#inspiration-detail").open')))await click('.card-read');
  check(await c.evaluate('document.querySelector("#inspiration-detail").open'),'full original text opens in detail dialog');capture('v1.1-detail');
  const favoriteBefore=(await c.evaluate(`JSON.parse(Native.getInspirationEntry(${JSON.stringify(dailyId)}))`)).card.favorite;
  if(!favoriteBefore)await click('#inspiration-detail [data-inspire="favorite"]');
  check((await c.evaluate(`JSON.parse(Native.getInspirationEntry(${JSON.stringify(dailyId)}))`)).card.favorite,'favorite stored natively');
  await click('#inspiration-detail [data-inspire="close"]');capture('v1.1-daily');
  check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'daily page has no horizontal overflow');
  for(let i=0;i<20;i++){if(await c.evaluate(`(()=>{const images=[...document.querySelectorAll('.card-art')];return images.length>0&&images.every(i=>i.complete&&i.naturalWidth>0)})()`))break;await delay(100);}check(await c.evaluate(`(()=>{const images=[...document.querySelectorAll('.card-art')];return images.length>0&&images.every(i=>i.complete&&i.naturalWidth>0)})()`),'daily artwork loaded from local native media endpoint');
  await click('[data-inspire="scope"][data-scope="favorites"]');check(await c.evaluate('document.querySelectorAll(".inspiration-history-item").length>0'),'favorite appears in dedicated list');capture('v1.1-favorites');
  await click('[data-inspire="scope"][data-scope="history"]');check(await c.evaluate('document.querySelectorAll(".inspiration-history-item").length===1'),'one daily history item for current date');
  await click('[data-inspire="scope"][data-scope="startup"]');check(await c.evaluate('document.querySelectorAll(".inspiration-history-item").length>=1'),'startup history retained separately');capture('v1.1-startup-history');
  await nav('today');android('shell','input','keyevent','3');await delay(500);android('shell','am','start','-n','cn.edu.njupt.studycheckin/.MainActivity');await delay(450);
  check((await c.evaluate('InspirationUI.snapshot()')).startupId===startupId&&!(await c.evaluate('InspirationUI.snapshot()')).splashVisible,'background return does not show or replace splash');
  check((await data()).daily.id===dailyId,'background return retains fixed daily card');
  await nav('inspiration');await click('[data-inspire="scope"][data-scope="daily"]');
  if((await data()).online){await c.evaluate('document.querySelector("#inspiration-online").click()');await delay(180);}
  check(!(await data()).online,'online material preparation can be disabled');
  await click('.card-read');await click('#inspiration-detail [data-inspire="save"]');
  for(let i=0;i<50;i++){if(!(await data()).posterBusy)break;await delay(120);}
  const gallery=android('shell','content','query','--uri','content://media/external/images/media','--projection','_display_name:relative_path').includes('每日学习');check(gallery,'save image writes completed poster to Android gallery');
  await click('#inspiration-detail [data-inspire="share"]');await delay(1200);check(android('shell','dumpsys','activity','activities').includes('ChooserActivity'),'share opens Android system chooser');
  android('shell','input','keyevent','4');await delay(250);check((await data()).daily.id===dailyId,'cancel share leaves daily card unchanged');
  check(c.events.filter(e=>e.method==='Runtime.exceptionThrown').length===0,'no uncaught card page exceptions');
  c.close();c=null;await open();const second=(await c.evaluate('InspirationUI.snapshot()'));check(second.splashVisible&&second.startupId!==startupId,'fresh launch randomizes new startup record');
  await delay(5300);check(!(await c.evaluate('InspirationUI.snapshot()')).splashVisible,'splash automatically ends after five seconds');check((await data()).daily.id===dailyId,'process restart keeps same daily card');
  check((await c.evaluate(`JSON.parse(Native.getInspirationEntry(${JSON.stringify(dailyId)}))`)).card.favorite,'favorite persists across process restart');
  c.close();c=null;await open();const third=(await c.evaluate('InspirationUI.snapshot()'));android('shell','input','keyevent','3');await delay(350);android('shell','am','start','-W','-n','cn.edu.njupt.studycheckin/.MainActivity');await delay(350);const returned=await c.evaluate('InspirationUI.snapshot()');if(returned.splashVisible||returned.startupId!==third.startupId)console.log({third,returned});check(!returned.splashVisible&&returned.startupId===third.startupId,'backgrounding during splash returns directly without replay');
  await nav('settings');check(await c.evaluate('document.querySelector(".version-note").innerText.includes("1.1.0")'),'settings reports v1.1.0');capture('v1.1-settings');
  fs.writeFileSync(path.join(__dirname,'../docs/inspiration-ui-test-results.json'),JSON.stringify({platform:'Android16/API36 APK WebView',passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{if(c)c.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
