'use strict';
const assert=require('node:assert/strict'),{connect}=require('./cdp-client.cjs');
process.env.COURSE_REPORT_NAME='manual-ui-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 const {M,check,fixtureInstall,state,native,click,input,evaluate,delay,shot}=h;
 const seed=require('../app/src/main/assets/seed.json');await fixtureInstall(M.migrateState(structuredClone(seed),'2026-10-19'));
 await click('.bottom-nav [data-nav=settings]');const before=await state();
 check(await evaluate('document.querySelector(".manual-entry").textContent==="使用手册"'),'settings includes a visible labelled manual entry');
 await click('[data-action=user-manual]');
 check(await evaluate('document.querySelector("#sheet").open&&document.querySelector("#sheet-title").textContent==="使用手册"'),'manual opens in the existing in-app sheet');
 check(await evaluate('document.querySelectorAll(".manual-toc button").length===12&&document.querySelectorAll(".manual-chapter").length===12'),'all twelve current feature chapters are discoverable from the table of contents');
 await shot('manual-directory','#sheet');
 for(const id of ['records','timer','words','weeks','courses','assessment','history','plans','inspiration','reminders','backup','update']){
  await click('[data-section='+id+']');
  check(await evaluate('document.querySelector("#manual-'+id+'").open&&document.activeElement===document.querySelector("#manual-'+id+'>summary")'),'table of contents opens and focuses '+id+' chapter');
 }
 await click('[data-section=assessment]');await shot('manual-assessment','#sheet');await click('[data-action=manual-top]');
 check(await evaluate('document.querySelector("#sheet").scrollTop===0&&document.activeElement===document.querySelector(".manual-toc button")'),'directory control returns to the top and restores focus');
 await click('[data-section=backup]');check(await evaluate('document.querySelector("#manual-backup").innerText.includes("覆盖不能撤销")'),'backup chapter retains the actual overwrite consequence');
 assert.deepEqual(await state(),before);check(true,'opening and reading all chapters does not change any saved learning state');
 check(await evaluate('window.handleNativeBack()===true&&!document.querySelector("#sheet").open'),'Android back handler closes the manual before leaving settings');
 await input('#weekday-time','18:45');await click('[data-action=user-manual]');await evaluate('window.onNativeResume()');await click('#sheet [data-action=close-sheet]');
 check(await evaluate('document.querySelector("#weekday-time").value==="18:45"&&StudyUI.snapshot().dirty.includes("reminders")'),'opening closing and background return retain unsaved settings input');
 check((await state()).settings.reminders.weekdayTime===before.settings.reminders.weekdayTime,'reading help does not submit reminder settings');
 const network=await connect();
 try{
  await network.call('Network.enable');await network.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  check(await evaluate('navigator.onLine===false'),'actual WebView is offline for the reading check');
  await click('[data-action=user-manual]');await click('[data-section=courses]');
  check(await evaluate('document.querySelector("#manual-courses").open&&document.querySelector("#manual-courses").innerText.includes("保存复习清单")'),'the complete course chapter remains available offline');
 }finally{await network.call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});network.close();}
 await click('#sheet [data-action=close-sheet]');
 h.android('shell','settings','put','system','font_scale','2.0');await h.boot();await click('.bottom-nav [data-nav=settings]');await click('[data-action=user-manual]');
 await evaluate('document.querySelector("meta[name=viewport]").setAttribute("content","width=320")');await delay(250);
 check(await evaluate('document.querySelector("#sheet").scrollWidth<=document.querySelector("#sheet").clientWidth+1'),'manual directory fits 320px at 200 percent Android font');
 check(await evaluate('[...document.querySelectorAll(".manual-toc button, .manual-directory")].every(e=>e.getBoundingClientRect().height>=44&&e.textContent.trim())'),'manual navigation keeps visible labels and touch targets');
 await shot('manual-directory-320px-200pct','#sheet');await click('[data-section=courses]');
 check(await evaluate('document.querySelector("#sheet").scrollWidth<=document.querySelector("#sheet").clientWidth+1'),'long course instructions wrap without horizontal overflow at large text');
 check(await evaluate('document.querySelector("#manual-courses").getBoundingClientRect().top>=document.querySelector("#sheet .sheet-heading").getBoundingClientRect().bottom-1'),'chapter heading remains fully below the fixed reader controls');
 await shot('manual-chapter-320px-200pct','#sheet');await click('[data-action=manual-top]');await click('[data-section=backup]');await shot('manual-backup-320px-200pct','#sheet');
 assert.deepEqual(await state(),before);check(true,'offline reading large text and process restart leave formal learning records unchanged');
});
