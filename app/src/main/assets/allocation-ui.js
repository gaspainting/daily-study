(function(root){
  'use strict';let h;
  const labels=['周一','周二','周三','周四','周五','周六','周日'];
  function subjects(state){return state.plan.subjects.filter(s=>!s.activePeriods||s.activePeriods.some(p=>p.to===null||p.to>h.today()));}
  function view(state){
    const items=subjects(state),times=items.filter(s=>s.kind!=='vocab'&&s.measure!=='quantity');
    let html='<form id="allocation-form" data-dirty="sheet"><p class="allocation-plan">'+h.escape(state.plan.title)+'</p>'+
      h.field('生效日期','allocation-from',[h.today(),state.plan.startDate].sort().pop(),{type:'date',min:[h.today(),state.plan.startDate].sort().pop(),max:state.plan.endDate,required:true})+
      '<p class="allocation-scope">新增日期沿用修改后的默认分配。</p>';
    const words=items.filter(s=>s.kind==='vocab');if(words.length)html+='<section class="allocation-section"><h3>单词新学</h3>'+words.map(s=>h.field(s.name+'（个 / 天）','allocation-word-'+s.id,s.wordGoal??50,{type:'number',min:0,max:100000,step:1,required:true})).join('')+'</section>';
    if(times.length){
      html+='<section class="allocation-section"><h3>参考时间</h3>'+h.selectField('星期','allocation-weekday','0',labels.map((label,i)=>[String(i),label]));
      html+=labels.map((label,i)=>'<div class="allocation-day" data-allocation-day="'+i+'"'+(i?' hidden':'')+'>'+h.rangeFields('总参考区间','allocation-total-'+i,times.reduce((v,s)=>{const r=root.StudyReference.range(s.defaults[i]);return {min:v.min+r.min,max:v.max+r.max};},{min:0,max:0}),times.length*1440)+times.map(s=>h.rangeFields(s.name,'allocation-time-'+s.id+'-'+i,s.defaults[i])).join('')+'</div>').join('');
      html+='<button class="text-button" type="button" data-action="allocation-weekdays">复制本日时间分配到周一至周五</button><span class="allocation-copy-state" role="status"></span></section>';
    }
    const quantities=items.filter(s=>s.measure==='quantity');if(quantities.length)html+='<section class="allocation-section"><h3>数量目标</h3>'+quantities.map(s=>'<details class="plain-details allocation-quantity"><summary>'+h.escape(s.name)+' · '+h.escape(s.unit)+'</summary>'+h.quantityDefaultsFields('allocation-quantity-'+s.id,s.defaults)+'</details>').join('')+'</section>';
    html+='<section class="allocation-section">'+h.selectField('单日自定目标','allocation-daily','keep',[['keep','保留'],['replace','覆盖']])+(state.evaluation?'':h.selectField('已记录日期的评估','allocation-assessment','recalculate',[['recalculate','按新目标评估'],['keep','保留原评估']]))+'</section><div class="save-row"><button class="cancel-button" type="button" data-action="close-sheet">取消</button><button class="primary" type="submit">应用分配</button></div></form>';
    return html;
  }
  function values(form,state){
    const times=subjects(state).filter(s=>s.kind!=='vocab'&&s.measure!=='quantity');
    const reject=(i,id,message)=>{form.elements.namedItem('allocation-weekday').value=String(i);form.querySelectorAll('[data-allocation-day]').forEach(e=>e.hidden=Number(e.dataset.allocationDay)!==i);const input=form.elements.namedItem(id);input.focus();input.scrollIntoView({block:'nearest'});throw new Error(labels[i]+'：'+message);};
    for(let i=0;i<7&&times.length;i++){
      const lower=Number(form.elements.namedItem('allocation-total-'+i).value),upper=Number(form.elements.namedItem('allocation-total-'+i+':max').value);let min=0,max=0;
      times.forEach(s=>{const id='allocation-time-'+s.id+'-'+i,r={min:Number(form.elements.namedItem(id).value),max:Number(form.elements.namedItem(id+':max').value)};try{root.StudyReference.validate(r,true);}catch(error){reject(i,id,s.name+'，'+error.message);}min+=r.min;max+=r.max;});
      if(!Number.isFinite(lower)||!Number.isFinite(upper)||lower<0||lower>upper||upper>times.length*1440)reject(i,'allocation-total-'+i,'总参考区间无效');
      if(Math.abs(min-lower)>0.0001||Math.abs(max-upper)>0.0001)reject(i,'allocation-total-'+i,'总参考区间与分项不一致');
    }
    const out={};subjects(state).forEach(s=>{
      if(s.kind==='vocab')out[s.id]={goal:Number(form.elements.namedItem('allocation-word-'+s.id).value)};
      else if(s.measure==='quantity')out[s.id]={defaults:Array.from({length:7},(_,i)=>Number(form.elements.namedItem('allocation-quantity-'+s.id+'-'+i).value))};
      else out[s.id]={defaults:Array.from({length:7},(_,i)=>({min:Number(form.elements.namedItem('allocation-time-'+s.id+'-'+i).value),max:Number(form.elements.namedItem('allocation-time-'+s.id+'-'+i+':max').value)}))};
    });return {from:form.elements.namedItem('allocation-from').value,replaceDaily:form.elements.namedItem('allocation-daily').value==='replace',reassess:form.elements.namedItem('allocation-assessment')?.value==='recalculate',values:out};
  }
  function sync(form,state,changed=''){
    if(!form||form.id!=='allocation-form')return;
    const day=Number(form.elements.namedItem('allocation-weekday')?.value||0);form.querySelectorAll('[data-allocation-day]').forEach(e=>e.hidden=Number(e.dataset.allocationDay)!==day);
    const changedDay=form.elements.namedItem(changed)?.closest('[data-allocation-day]')?.dataset.allocationDay;
    for(let i=0;i<7;i++){
      if(changed!=='copy'&&(changedDay===undefined||Number(changedDay)!==i))continue;
      const lower=form.elements.namedItem('allocation-total-'+i),upper=form.elements.namedItem('allocation-total-'+i+':max');if(!lower)continue;
      const entries=subjects(state).filter(s=>s.kind!=='vocab'&&s.measure!=='quantity').map(s=>({id:s.id,reference:{min:Number(form.elements.namedItem('allocation-time-'+s.id+'-'+i).value),max:Number(form.elements.namedItem('allocation-time-'+s.id+'-'+i+':max').value)}}));
      if(changed==='allocation-total-'+i||changed==='allocation-total-'+i+':max'){
        if(!lower.value||!upper.value||!lower.checkValidity()||!upper.checkValidity()||Number(lower.value)>Number(upper.value))continue;
        root.StudyReference.distribute(entries,{min:Number(lower.value),max:Number(upper.value)}).forEach(e=>{form.elements.namedItem('allocation-time-'+e.id+'-'+i).value=root.StudyReference.decimal(e.reference.min);form.elements.namedItem('allocation-time-'+e.id+'-'+i+':max').value=root.StudyReference.decimal(e.reference.max);});
      }else{lower.value=root.StudyReference.decimal(entries.reduce((sum,e)=>sum+e.reference.min,0));upper.value=root.StudyReference.decimal(entries.reduce((sum,e)=>sum+e.reference.max,0));}
    }
  }
  function weekdays(form,state){
    const day=Number(form.elements.namedItem('allocation-weekday').value),items=subjects(state).filter(s=>s.kind!=='vocab'&&s.measure!=='quantity');
    items.forEach(s=>[0,1,2,3,4].forEach(i=>['',':max'].forEach(end=>{form.elements.namedItem('allocation-time-'+s.id+'-'+i+end).value=form.elements.namedItem('allocation-time-'+s.id+'-'+day+end).value;})));
    sync(form,state,'copy');form.querySelector('.allocation-copy-state').textContent='已填入周一至周五，待应用';form.elements.namedItem('allocation-from').dispatchEvent(new Event('input',{bubbles:true}));
  }
  function summary(report){return '应用总体任务分配？\n'+report.from+' 至 '+report.to+'：'+report.days+' 天、'+report.targets+' 项目标。\n'+report.changes.map(c=>c.name+(c.kind==='words'?'：'+c.before+' → '+c.after+' 个 / 天':'：'+c.days.map((v,i)=>v?labels[i]:null).filter(Boolean).join('、'))).join('\n')+(report.reassessed?'\n更新 '+report.reassessed+' 天旧规则评估。':'')+(report.keptDaily?'保留 '+report.keptDaily+' 项单日自定目标。':'')+(report.keptUnits?'跳过 '+report.keptUnits+' 项单位不同的数量目标。':'')+'\n新增日期沿用修改后的默认分配。';}
  let revealing=false;
  document.addEventListener('invalid',e=>{const day=e.target.closest('[data-allocation-day]');if(!day||revealing)return;revealing=true;const form=day.closest('form');form.elements.namedItem('allocation-weekday').value=day.dataset.allocationDay;form.querySelectorAll('[data-allocation-day]').forEach(el=>el.hidden=el!==day);setTimeout(()=>{revealing=false;},0);},true);
  root.StudyAllocationUI={init(helpers){h=helpers;},view,values,sync,weekdays,summary};
})(typeof globalThis!=='undefined'?globalThis:this);
