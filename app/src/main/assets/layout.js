(function (root) {
  'use strict';
  const choices = new Map(), groups = new WeakMap();
  let context, observer, editors = new Map(), deferredRestore;
  function node(tag, className, text) { const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e; }
  function icon(name) { const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');svg.setAttribute('aria-hidden','true');use.setAttribute('href','#i-'+name);svg.append(use);return svg; }
  function group(parent, key, items, options={}) {
    const nav=node('div','layout-tabs layout-primary-tabs');
    nav.setAttribute('role','tablist');nav.setAttribute('aria-label',options.label||'页面模块');
    const panels=[], buttons=[], selected=choices.get(key), uid=options.id;
    items.forEach(item=>{
      const button=node('button','layout-tab',item.label);button.type='button';button.id=uid+'-tab-'+item.id;
      button.setAttribute('role','tab');button.setAttribute('aria-controls',uid+'-panel-'+item.id);
      const panel=node('section','layout-panel layout-module-panel');
      panel.id=uid+'-panel-'+item.id;panel.dataset.layoutPanel=item.id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panel.tabIndex=0;
      item.nodes.filter(Boolean).forEach(n=>panel.append(n));buttons.push(button);panels.push(panel);nav.append(button);
    });
    parent.append(nav);panels.forEach(p=>parent.append(p));
    const api={nav,panels,buttons,activate(id,focus=false,scroll=false){
      const index=Math.max(0,items.findIndex(item=>item.id===id));choices.set(key,items[index].id);
      buttons.forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});
      if(focus){buttons[index].focus({preventScroll:true});buttons[index].scrollIntoView({block:'nearest',inline:'nearest'});}
      if(scroll)nav.scrollIntoView({block:'start',behavior:'instant'});sizes();
    }};
    buttons.forEach((b,i)=>{
      b.addEventListener('click',()=>api.activate(items[i].id,false,true));
      b.addEventListener('keydown',e=>{const direction=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;const next=direction?(i+direction+items.length)%items.length:e.key==='Home'?0:e.key==='End'?items.length-1:-1;if(next<0)return;e.preventDefault();api.activate(items[next].id,true,true);});
      groups.set(panels[i],{api,id:items[i].id});
    });api.activate(selected||items[0].id);return api;
  }
  function reveal(element) {
    if(!element)return;
    const ancestors=[];for(let p=element;p;p=p.parentElement)ancestors.unshift(p);
    ancestors.forEach(p=>{const entry=groups.get(p);if(entry)entry.api.activate(entry.id);if(p.tagName==='DETAILS')p.open=true;});
  }
  function editor(parent, id, items) {
    const dialog=node('dialog','layout-editor');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'-title');
    const header=node('div','layout-editor-heading'),close=node('button','icon-button','×'),title=node('h2'),done=node('button','text-button','完成');
    title.id=id+'-title';close.type=done.type='button';close.setAttribute('aria-label','关闭编辑');close.dataset.layoutClose='';done.dataset.layoutDone='';header.append(close,title,done);dialog.append(header);
    const panels=items.map(item=>{const panel=node('section','layout-editor-panel');panel.id=id+'-'+item.id;panel.dataset.editorPanel=item.id;panel.setAttribute('role','group');panel.setAttribute('aria-label',item.label);item.nodes.filter(Boolean).forEach(n=>panel.append(n));dialog.append(panel);return panel;});
    let current,opener;
    const api={dialog,activate(value){
      const index=items.findIndex(item=>item.id===value);if(index<0)return;
      panels.forEach((p,i)=>p.hidden=i!==index);title.textContent=items[index].label;dialog.dataset.panel=value;current=value;
      if(!dialog.open){opener=document.activeElement;dialog.showModal();dialog.scrollTop=0;}
      sync();
    },close(){if(!dialog.open)return false;dialog.close();sync();if(opener?.isConnected)opener.focus({preventScroll:true});return true;},current:()=>dialog.open?current:null};
    close.onclick=done.onclick=()=>api.close();
    dialog.addEventListener('cancel',e=>{e.preventDefault();api.close();});
    dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)api.close();});
    panels.forEach((p,i)=>groups.set(p,{api,id:items[i].id}));parent.append(dialog);editors.set(id,api);return api;
  }
  function subjectValue(form, subject) {
    const read=name=>{const input=form.elements.namedItem(name+'-'+subject.id);return input&&(input.value!==''||input.validity.badInput)?{value:input.value,valid:input.validity.valid}:null;};
    const minutes=read('minutes'),learned=read('newWords'),reviewed=read('reviewWords'),quantity=read('quantity');
    const invalid=[minutes,learned,reviewed,quantity].some(v=>v&&!v.valid);
    const actual=subject.kind==='vocab'?learned:subject.measure==='quantity'?quantity:minutes;
    const unit=subject.kind==='vocab'?'个':subject.measure==='quantity'?form.elements.namedItem('quantity-'+subject.id)?.dataset.unit||subject.unit:'分钟';
    return {value:invalid?'待修正':actual?actual.value:'未记录',unit:invalid||!actual?'':unit,minutes,learned,reviewed,quantity,invalid,written:!!(minutes||learned||reviewed||quantity)};
  }
  function subjects(form) {
    const entries=Array.from(form.querySelectorAll('.subject-entry')),section=entries[0]?.parentElement;
    if(!section)return [];
    section.querySelector('.section-heading')?.remove();
    const list=node('div','layout-subject-list');list.setAttribute('aria-label','学习记录');
    const items=entries.map(entry=>{
      const id=entry.querySelector('[id^="content-"]').id.slice(8),subject=context.state.plan.subjects.find(s=>s.id===id);
      entry.dataset.layoutSubject=id;entry.querySelector('.subject-heading h3')?.remove();
      const button=node('button','layout-subject-row');button.type='button';button.dataset.layoutSubjectButton=id;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','daily-record-editor');
      const kind=subject.kind==='vocab'?'words':subject.kind==='math'?'math':'course';
      const mark=node('span','layout-subject-icon '+kind),main=node('span','layout-subject-label'),actual=node('span','layout-subject-actual');
      mark.append(icon(kind));main.append(node('strong','',subject.name),node('small','layout-subject-reference'));
      actual.append(node('strong','layout-subject-value'),node('small','layout-subject-unit'));button.append(mark,main,actual,icon('next'));
      if(subject.kind==='vocab'){
        const line=node('div','layout-word-line'),quick=node('button','text-button layout-word-quick','记一笔');quick.type='button';quick.dataset.action='word-log-add';quick.dataset.subject=id;quick.setAttribute('aria-label',subject.name+'，记一笔');button.lastElementChild.remove();line.append(button,quick);list.append(line);
      }else list.append(button);
      return {id,label:subject.name,nodes:[entry]};
    });section.prepend(list);return items;
  }
  function daily(element) {
    const form=element.querySelector('#daily-form');if(!form)return;
    const assessment=element.querySelector('.daily-assessment'),course=element.querySelector('.course-agenda');
    const week=Array.from(element.children).find(e=>e.querySelector?.('#week-today-form'));
    const quick=element.querySelector('.quick-timers'),timerAvailable=!!quick,timerAllowed=!!quick?.querySelector('button:not(:disabled)'),limit=quick?.nextElementSibling?.classList.contains('inline-form-note')?quick.nextElementSibling:null;
    if(quick){limit?.remove();quick.remove();}
    const items=subjects(form),arrangement=Array.from(form.children).find(e=>e.querySelector?.('.status-fieldset'));
    if(!arrangement)return;
    const row=arrangement.querySelector('.save-row'),dock=node('div','layout-save-dock');dock.append(row);form.append(dock);
    const pending=node('span','layout-save-state');pending.setAttribute('role','status');pending.setAttribute('aria-live','polite');row.prepend(pending);
    row.querySelector('[type=submit]').textContent='保存记录';
    const note=arrangement.querySelector('#daily-note')?.closest('.field');arrangement.querySelector('.section-heading')?.remove();
    items.push({id:'arrangement',label:form.dataset.automaticEvaluation?'休息记录':'今日安排',nodes:Array.from(arrangement.children).filter(n=>n!==note)});
    if(note)items.push({id:'note',label:'随记',nodes:[note]});
    const tools=node('div','layout-record-tools'),choose=node('button','layout-arrangement-button');choose.type='button';choose.dataset.layoutOpen='arrangement';choose.setAttribute('aria-haspopup','dialog');
    choose.append(node('span','',form.dataset.automaticEvaluation?'休息记录':'今日安排'),node('span','layout-arrangement-status'),icon('down'));
    const actions=node('span','layout-record-actions');
    if(timerAvailable){const timer=node('button','text-button','计时');timer.type='button';timer.dataset.action='timer-picker';timer.disabled=!timerAllowed;timer.prepend(icon('play'));if(limit)timer.setAttribute('aria-describedby','layout-timer-reason');actions.append(timer);}
    const notes=node('button','text-button','随记');notes.type='button';notes.dataset.layoutOpen='note';notes.setAttribute('aria-haspopup','dialog');notes.append(icon('next'));actions.append(notes);tools.append(choose,actions);
    const preview=node('p','layout-note-preview');arrangement.replaceChildren(tools,preview);
    if(limit){limit.id='layout-timer-reason';arrangement.append(limit);items.forEach(item=>{if(item.nodes[0]?.querySelector('[data-action=start-timer]:disabled'))item.nodes[0].append(node('p','inline-form-note',limit.textContent));});}
    const api=editor(form,'daily-record-editor',items);
    const editorDock=node('div','layout-editor-save'),insideFeedback=node('div','layout-editor-feedback'),save=node('button','primary','保存记录');save.type='submit';save.dataset.dailyEditorSave='';save.setAttribute('aria-label','保存今日全部记录');insideFeedback.hidden=true;editorDock.append(insideFeedback,save);api.dialog.append(editorDock);
    form.querySelectorAll('[data-layout-subject-button]').forEach(button=>button.onclick=()=>api.activate(button.dataset.layoutSubjectButton));
    form.querySelectorAll('[data-layout-open]').forEach(button=>button.onclick=()=>api.activate(button.dataset.layoutOpen));
    const host=node('div','layout-modules');element.append(host);
    const modules=[{id:'record',label:'记录',nodes:[form]}];
    if(course)modules.push({id:'courses',label:'课程',nodes:[course]});if(week)modules.push({id:'week',label:'本周',nodes:[week]});if(assessment)modules.push({id:'assessment',label:'评估',nodes:[assessment]});
    group(host,context.planId+':today',modules,{id:'today-module',label:'今日模块'});
  }
  function plan(element) {
    const dateDetails=element.querySelector('#range-form')?.closest('details'),subjectDetails=element.querySelector('[data-subject-edit]')?.closest('details');if(!dateDetails||!subjectDetails)return;
    const oldSection=dateDetails.parentElement,week=element.querySelector('.week-navigation'),dayNodes=Array.from(element.children).filter(e=>!e.matches('.page-intro,.week-navigation,.allocation-entry')&&e!==oldSection);
    const settings=[dateDetails],subjectsPanel=node('div','layout-subject-editors');
    element.querySelectorAll('[data-action="course-schedule"],[data-action="weekend-schedule"]').forEach(e=>settings.push(e));
    element.querySelectorAll('[data-subject-edit]').forEach(form=>{const subject=context.state.plan.subjects.find(s=>s.id===form.dataset.subjectEdit),detail=node('details','layout-subject-editor'),heading=node('summary');heading.append(node('strong','',subject.name),node('span','',subject.kind==='vocab'?'单词数量':subject.measure==='quantity'?'数量 · '+subject.unit:'时间 · 分钟'),icon('next'));detail.append(heading,form);subjectsPanel.append(detail);});
    const add=subjectDetails.querySelector('[data-action="add-subject"]');if(add)subjectsPanel.append(add);oldSection.remove();
    const host=node('div','layout-modules');element.append(host);group(host,context.planId+':plan',[{id:'schedule',label:'本周安排',nodes:[week,...dayNodes.filter(e=>!settings.includes(e))]},{id:'subjects',label:'科目',nodes:[subjectsPanel]},{id:'settings',label:'计划设置',nodes:settings}],{id:'plan-module',label:'计划模块'});
  }
  function review(element) {
    const note=element.querySelector('#review-form');if(!note)return;
    const stats=Array.from(element.querySelectorAll('.chart-subject:not(.quantity-chart),.word-summary,.quantity-summary,.legend')),output=element.querySelector('[data-action="export-report"]');
    const overview=Array.from(element.children).filter(e=>!e.matches('.tracking-tabs,.page-intro,.week-navigation')&&e!==note&&e!==output&&!stats.includes(e));
    const host=node('div','layout-modules');element.append(host);group(host,context.planId+':review',[{id:'overview',label:'总览',nodes:overview},{id:'statistics',label:'科目统计',nodes:stats},{id:'note',label:'本周随记',nodes:[note,output]}],{id:'review-module',label:'复盘模块'});
  }
  function settings(element) {
    const reminder=element.querySelector('#reminder-form'),backup=element.querySelector('[data-action="export-backup"]')?.closest('.section'),widget=element.querySelector('[data-action="pin-widget"]')?.closest('.section'),themeSection=element.querySelector('[data-theme-section]'),theme=themeSection?.querySelector('.theme-setting-row');if(!reminder||!backup)return;
    const manual=element.querySelector('[data-action="user-manual"]'),rest=element.querySelector('#rest-hours-form')?.closest('.section'),about=element.querySelector('[data-action="about"]');
    [reminder,backup,widget,themeSection].filter(Boolean).forEach(e=>e.querySelector?.('.section-heading')?.remove());
    const items=[{id:'reminders',label:'学习提醒',nodes:[reminder]},{id:'backup',label:'备份与导出',nodes:[backup]}];if(widget)items.push({id:'widget',label:'桌面小组件',nodes:[widget]});
    const host=node('div','layout-settings-list');element.append(host);const api=editor(element,'settings-editor',items);
    const addGroup=(label,rows)=>{host.append(node('h2','layout-list-heading',label));rows.forEach(item=>{let button;if(item.element){button=item.element;button.classList.add(button.querySelector?.('#rest-hours-form')?'settings-inline-section':'layout-setting-row');}else{button=node('button','layout-setting-row');button.type='button';button.append(node('span','',item.label));if(item.trailing)button.append(node('small','',item.trailing));button.dataset.layoutSettings=item.id;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','settings-editor');button.onclick=()=>api.activate(item.id);button.append(icon('next'));}host.append(button);});};
    addGroup('学习',[{id:'reminders',label:'学习提醒',trailing:context.state.settings.reminders.enabled?'已开启':'关闭'},...(rest?[{element:rest}]:[])]);
    addGroup('数据',[{id:'backup',label:'备份与导出'}]);addGroup('应用',[...(widget?[{id:'widget',label:'桌面小组件'}]:[]),...(theme?[{element:theme}]:[]),...(manual?[{element:manual}]:[]),...(about?[{element:about}]:[])]);
    element.querySelectorAll(':scope>.section').forEach(e=>{if(!e.children.length)e.remove();});
  }
  function sizes() {
    const nav=document.querySelector('.bottom-nav'),dock=document.querySelector('#daily-form .layout-save-dock');const visible=dock&&!dock.closest('[hidden]');
    document.body.classList.toggle('layout-has-dock',!!visible);document.documentElement.style.setProperty('--layout-nav-height',(nav?.getBoundingClientRect().height||72)+'px');document.documentElement.style.setProperty('--layout-dock-height',(visible?dock.getBoundingClientRect().height:0)+'px');
  }
  function sync() {
    const form=document.getElementById('daily-form');if(form){
      form.querySelectorAll('[data-draft-unit-for]').forEach(field=>{const input=form.elements.namedItem(field.dataset.draftUnitFor);if(!input)return;input.dataset.unit=field.value;input.closest('.actual-input').querySelector('span').textContent='实际 '+field.value;const id=field.dataset.draftUnitFor.slice(9),subject=context.state.plan.subjects.find(s=>s.id===id);input.setAttribute('aria-label',subject.name+'实际数量（'+field.value+'）');});
      form.querySelectorAll('[data-layout-subject-button]').forEach(button=>{
        const id=button.dataset.layoutSubjectButton,subject=context.state.plan.subjects.find(s=>s.id===id),value=subjectValue(form,subject),entry=form.querySelector('[data-layout-subject="'+CSS.escape(id)+'"]');
        const reference=entry.querySelector('.reference-pill')?.textContent||'';
        button.querySelector('.layout-subject-value').textContent=value.value;button.querySelector('.layout-subject-unit').textContent=value.unit;
        button.querySelector('.layout-subject-reference').textContent=reference+(subject.kind==='vocab'&&value.reviewed?' · 复习 '+value.reviewed.value+' 个':'');
        button.setAttribute('aria-label',subject.name+'，'+value.value+(value.unit?' '+value.unit:'')+'，'+reference+'，编辑记录');
      });
      const checked=form.querySelector('[name="status"]:checked'),status=form.querySelector('.layout-arrangement-status');if(status)status.textContent=form.dataset.automaticEvaluation?({'':'未记录',true:'已保留',false:'需要调整'}[form.elements.namedItem('restKept').value]):checked?(checked.value==='正常参考'?'照常':checked.value):'未选择';
      const note=form.querySelector('.layout-note-preview');if(note){const text=Array.from((form.elements.namedItem('daily-note')?.value||'').replace(/\s+/g,' ').trim());note.textContent=text.slice(0,72).join('')+(text.length>72?'…':'');}
      const pending=!!context.isDailyDirty?.(),pendingState=form.querySelector('.layout-save-state');if(pendingState){pendingState.textContent=pending?'待保存':'';pendingState.hidden=!pending;}
      const total=document.getElementById('daily-total');if(total){
        const inputs=context.state.plan.subjects.map(subject=>form.elements.namedItem('minutes-'+subject.id)).filter(Boolean),written=inputs.filter(input=>input.value!==''),invalid=inputs.some(input=>!input.validity.valid);
        const minutes=written.length?written.reduce((sum,input)=>sum+Number(input.value),0):null;
        total.textContent=invalid?'待修正':minutes===null?'未记录':(context.minuteLabel||String)(minutes);total.classList.toggle('is-empty',minutes===null||invalid);
        document.getElementById('daily-unit').hidden=minutes===null||invalid;
        total.parentElement.querySelector('.metric-label').textContent=pending?'填写时长':'已记录时长';
        document.getElementById('daily-count').textContent=invalid?'有输入待修正':written.length+'/'+inputs.length+' 科目有时长记录';
      }
    }sizes();
  }
  function snapshot() { return context?{route:context.route,planId:context.planId,date:context.date,open:Array.from(editors,([id,api])=>({id,panel:api.current(),scrollTop:api.dialog.scrollTop})).filter(e=>e.panel)}:null; }
  function restore(value) {
    if(!value||value.route!==context?.route||value.planId!==context?.planId||value.date!==context?.date)return;
    if(document.querySelector('#sheet[open]')){deferredRestore=value;return;}
    value.open.forEach(item=>{const api=editors.get(item.id);if(api){api.activate(item.panel);api.dialog.scrollTop=item.scrollTop||0;}});
  }
  let revealingInvalid=false;
  document.addEventListener('invalid',e=>{if(revealingInvalid)return;revealingInvalid=true;reveal(e.target);setTimeout(()=>{revealingInvalid=false;},0);},true);
  document.addEventListener('input',sync);document.addEventListener('change',sync);window.addEventListener('resize',sizes);
  window.visualViewport?.addEventListener('resize',()=>{const field=document.activeElement;if(field?.matches('input,textarea,select')&&field.closest('dialog[open]'))requestAnimationFrame(()=>field.scrollIntoView({block:'nearest',behavior:'instant'}));});
  document.addEventListener('click',e=>{const button=e.target.closest('[data-action="start-timer"]');if(button&&!button.disabled)editors.forEach(api=>api.close());});
  document.getElementById('sheet').addEventListener('close',()=>{if(deferredRestore){const value=deferredRestore;deferredRestore=null;restore(value);}});
  root.StudyLayout={mount(element,options){
    observer?.disconnect();context=options;editors=new Map();deferredRestore=null;element.dataset.page=options.route;
    element.querySelectorAll('.page-intro>.eyebrow,:scope>.eyebrow,.section-number,.subject-index').forEach(e=>e.remove());
    const intro=element.querySelector('.page-intro');if(intro)element.prepend(intro);
    ({today:daily,plan,review,settings}[options.route]||(()=>{}))(element);
    element.querySelectorAll('.draft-status [role="alert"]').forEach(reveal);
    observer=new ResizeObserver(sizes);observer.observe(document.querySelector('.bottom-nav'));const dock=element.querySelector('.layout-save-dock');if(dock)observer.observe(dock);sync();
  },sync,reveal,snapshot,restore,
  closeEditor(){for(const api of editors.values())if(api.close())return true;return false;},
  activate(groupId,id){const panel=document.getElementById(groupId+'-panel-'+id);if(panel)groups.get(panel)?.api.activate(id);},
  showSubject(id){const input=document.getElementById('content-'+id);reveal(input?.closest('.subject-entry'));sync();}
  };
})(typeof globalThis!=='undefined'?globalThis:this);
