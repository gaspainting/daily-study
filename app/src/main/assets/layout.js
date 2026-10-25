(function (root) {
  'use strict';
  const choices = new Map(), groups = new WeakMap();
  let context, observer;
  function node(tag, className, text) { const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e; }
  function group(parent, key, items, options={}) {
    const nav=node('div','layout-tabs '+(options.subject?'layout-subject-tabs':'layout-primary-tabs'));
    nav.setAttribute('role','tablist');nav.setAttribute('aria-label',options.label||'页面模块');
    const panels=[], buttons=[], selected=choices.get(key), uid=options.id;
    items.forEach(item=>{
      const button=node('button','layout-tab');button.type='button';button.id=uid+'-tab-'+item.id;button.dataset.layoutTab=item.id;
      button.setAttribute('role','tab');button.setAttribute('aria-controls',uid+'-panel-'+item.id);
      button.append(node('span','layout-tab-name',item.label));
      if(options.subject)button.append(node('small','layout-subject-preview'));
      const panel=node('section','layout-panel '+(options.subject?'layout-subject-panel':'layout-module-panel'));
      panel.id=uid+'-panel-'+item.id;panel.dataset.layoutPanel=item.id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panel.tabIndex=0;
      item.nodes.filter(Boolean).forEach(n=>panel.append(n));
      buttons.push(button);panels.push(panel);nav.append(button);
    });
    parent.append(nav);panels.forEach(p=>parent.append(p));
    const api={nav,panels,buttons,activate(id,focus=false,scroll=false){
      const index=Math.max(0,items.findIndex(item=>item.id===id));choices.set(key,items[index].id);
      buttons.forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});
      if(focus){buttons[index].focus({preventScroll:true});buttons[index].scrollIntoView({block:'nearest',inline:'nearest'});}
      if(scroll)nav.scrollIntoView({block:'start',behavior:'instant'});
      if(api.picker)api.picker.value=items[index].id;
      sizes();
    }};
    buttons.forEach((b,i)=>{
      b.addEventListener('click',()=>api.activate(items[i].id,false,true));
      b.addEventListener('keydown',e=>{const direction=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;let next=direction?(i+direction+items.length)%items.length:e.key==='Home'?0:e.key==='End'?items.length-1:-1;if(next<0)return;e.preventDefault();api.activate(items[next].id,true,true);});
      groups.set(panels[i],{api,id:items[i].id});
    });
    api.activate(selected||items[0].id);return api;
  }
  function reveal(element) {
    if(!element)return;
    const ancestors=[];for(let p=element;p;p=p.parentElement)ancestors.unshift(p);
    ancestors.forEach(p=>{const entry=groups.get(p);if(entry)entry.api.activate(entry.id);if(p.tagName==='DETAILS')p.open=true;});
  }
  function summary(form,id) {
    const value=name=>{const e=form.elements.namedItem(name+'-'+id);return e&&e.value!==''?e.value:null;};
    const learned=value('newWords'),reviewed=value('reviewWords'),quantity=value('quantity'),minutes=value('minutes');
    const subject=context.state.plan.subjects.find(s=>s.id===id);
    if(subject.kind==='vocab'){const parts=[];if(learned!==null)parts.push('新学 '+learned+' 个');if(reviewed!==null)parts.push('复习 '+reviewed+' 个');return parts.join(' · ')||'未记录';}
    if(subject.measure==='quantity')return quantity===null?'未记录':quantity+' '+subject.unit;
    return minutes===null?'未记录':minutes+' 分钟';
  }
  function subjects(form) {
    const entries=Array.from(form.querySelectorAll('.subject-entry')),section=entries[0]?.parentElement;
    if(!section)return;
    const items=entries.map(entry=>{const id=entry.querySelector('[id^="content-"]').id.slice(8),subject=context.state.plan.subjects.find(s=>s.id===id);entry.dataset.layoutSubject=id;return {id,label:subject.name,nodes:[entry]};});
    const host=node('div','layout-subjects');section.append(host);
    const tabs=group(host,context.planId+':subjects',items,{subject:true,label:'记录科目',id:'record-subject'});
    tabs.buttons.forEach((b,i)=>{b.dataset.layoutSubjectButton=items[i].id;});
    if(items.length>6||document.documentElement.classList.contains('large-text')){
      const picker=node('div','field layout-subject-picker'),label=node('label','','记录科目'),select=node('select');select.id='layout-subject-picker';label.htmlFor=select.id;
      items.forEach(item=>{const option=node('option','',item.label);option.value=item.id;select.append(option);});
      picker.append(label,select);host.prepend(picker);tabs.nav.hidden=true;tabs.picker=select;
      tabs.panels.forEach((p,i)=>{p.setAttribute('role','group');p.removeAttribute('aria-labelledby');p.setAttribute('aria-label',items[i].label);});
      select.addEventListener('change',()=>tabs.activate(select.value));tabs.activate(choices.get(context.planId+':subjects'));
    }
  }
  function daily(root) {
    const form=root.querySelector('#daily-form');if(!form)return;
    const assessment=root.querySelector('.daily-assessment'),course=root.querySelector('.course-agenda');
    const week=Array.from(root.children).find(e=>e.querySelector?.('#week-today-form'));
    const quick=root.querySelector('.quick-timers');if(quick){if(quick.nextElementSibling?.classList.contains('inline-form-note'))form.prepend(quick.nextElementSibling);quick.remove();}
    subjects(form);
    const arrangement=Array.from(form.children).find(e=>e.querySelector?.('.status-fieldset'));
    const row=arrangement.querySelector('.save-row'),dock=node('div','layout-save-dock');dock.append(row);form.append(dock);
    const details=node('details','layout-arrangement'),heading=node('summary');heading.append(node('strong','','今日安排'),node('span','layout-arrangement-status'));
    const legend=arrangement.querySelector('.section-heading');legend?.remove();
    details.append(heading);while(arrangement.firstChild)details.append(arrangement.firstChild);arrangement.append(details);
    details.open=!form.querySelector('[name="status"]:checked');
    const host=node('div','layout-modules');root.append(host);
    const items=[{id:'record',label:'记录',nodes:[form]}];
    if(course)items.push({id:'courses',label:'课程',nodes:[course]});
    if(week)items.push({id:'week',label:'周目标',nodes:[week]});
    if(assessment)items.push({id:'assessment',label:'评估',nodes:[assessment]});
    group(host,context.planId+':today',items,{id:'today-module',label:'今日模块'});
  }
  function plan(root) {
    const dateDetails=root.querySelector('#range-form')?.closest('details'),subjectDetails=root.querySelector('[data-subject-edit]')?.closest('details');
    if(!dateDetails||!subjectDetails)return;
    const oldSection=dateDetails.parentElement,dayNodes=Array.from(root.children).filter(e=>!e.matches('.plan-switch,.page-intro,.week-navigation')&&e!==oldSection);
    const settings=[dateDetails],subjectsPanel=node('div','layout-subject-editors');
    root.querySelectorAll('[data-action="course-schedule"],[data-action="weekend-schedule"]').forEach(e=>settings.push(e));
    root.querySelectorAll('[data-subject-edit]').forEach(form=>{const subject=context.state.plan.subjects.find(s=>s.id===form.dataset.subjectEdit);const detail=node('details','layout-subject-editor'),heading=node('summary');heading.append(node('strong','',subject.name),node('span','',subject.kind==='vocab'?'单词数量':subject.measure==='quantity'?'数量 · '+subject.unit:'时间 · 分钟'));detail.append(heading,form);subjectsPanel.append(detail);});
    const add=subjectDetails.querySelector('[data-action="add-subject"]');if(add)subjectsPanel.append(add);
    oldSection.remove();const host=node('div','layout-modules');root.append(host);
    group(host,context.planId+':plan',[{id:'schedule',label:'日程',nodes:dayNodes.filter(e=>!settings.includes(e))},{id:'subjects',label:'科目',nodes:[subjectsPanel]},{id:'settings',label:'计划设置',nodes:settings}],{id:'plan-module',label:'计划模块'});
  }
  function review(root) {
    const note=root.querySelector('#review-form');if(!note)return;
    const stats=Array.from(root.querySelectorAll('.chart-subject,.word-summary,.legend'));
    const output=root.querySelector('[data-action="export-report"]');
    const overview=Array.from(root.children).filter(e=>!e.matches('.plan-switch,.tracking-tabs,.page-intro,.week-navigation')&&e!==note&&e!==output&&!stats.includes(e));
    const host=node('div','layout-modules');root.append(host);
    group(host,context.planId+':review',[{id:'overview',label:'总览',nodes:overview},{id:'statistics',label:'科目统计',nodes:stats},{id:'note',label:'本周随记',nodes:[note,output]}],{id:'review-module',label:'复盘模块'});
  }
  function settings(root) {
    const reminder=root.querySelector('#reminder-form'),backup=root.querySelector('[data-action="export-backup"]')?.closest('.section');if(!reminder||!backup)return;
    const app=Array.from(root.children).filter(e=>e.matches('.section')&&e!==backup);
    const host=node('div','layout-modules');root.append(host);
    group(host,context.planId+':settings',[{id:'reminders',label:'提醒',nodes:[reminder]},{id:'backup',label:'备份与报表',nodes:[backup]},{id:'application',label:'应用',nodes:app}],{id:'settings-module',label:'设置模块'});
  }
  function sizes() {
    const nav=document.querySelector('.bottom-nav'),dock=document.querySelector('#daily-form .layout-save-dock');
    const visible=dock&&!dock.closest('[hidden]');document.body.classList.toggle('layout-has-dock',!!visible);
    document.documentElement.style.setProperty('--layout-nav-height',(nav?.getBoundingClientRect().height||78)+'px');
    document.documentElement.style.setProperty('--layout-dock-height',(visible?dock.getBoundingClientRect().height:0)+'px');
  }
  function sync() {
    const form=document.getElementById('daily-form');if(form){
      form.querySelectorAll('[data-layout-subject-button]').forEach(button=>{button.querySelector('.layout-subject-preview').textContent=summary(form,button.dataset.layoutSubjectButton);});
      const checked=form.querySelector('[name="status"]:checked'),status=form.querySelector('.layout-arrangement-status');if(status)status.textContent=checked?(checked.value==='正常参考'?'照常':checked.value):'未选择';
    }sizes();
  }
  let revealingInvalid=false;
  document.addEventListener('invalid',e=>{if(revealingInvalid)return;revealingInvalid=true;reveal(e.target);setTimeout(()=>{revealingInvalid=false;},0);},true);
  document.addEventListener('input',sync);document.addEventListener('change',sync);window.addEventListener('resize',sizes);
  root.StudyLayout={
    mount(element,options){
      observer?.disconnect();context=options;element.dataset.page=options.route;
      element.querySelectorAll('.eyebrow,.section-number,.subject-index').forEach(e=>e.remove());
      ({today:daily,plan,review,settings}[options.route]||(()=>{}))(element);
      element.querySelectorAll('.draft-status [role="alert"]').forEach(reveal);
      observer=new ResizeObserver(sizes);observer.observe(document.querySelector('.bottom-nav'));
      const dock=element.querySelector('.layout-save-dock');if(dock)observer.observe(dock);
      sync();
    },sync,reveal,
    activate(groupId,id){const panel=document.getElementById(groupId+'-panel-'+id);if(panel){groups.get(panel)?.api.activate(id);}},
    showSubject(id){const input=document.getElementById('content-'+id);reveal(input?.closest('.subject-entry'));sync();}
  };
})(typeof globalThis!=='undefined'?globalThis:this);
