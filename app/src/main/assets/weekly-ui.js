(function () {
  'use strict';
  const W = () => window.StudyWeeks;
  const escape = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const contexts = new WeakMap(), deleted = new WeakMap();
  let getPlan;
  const tasks = form => JSON.parse(form.elements.namedItem('week-tasks').value);
  const values = form => ({ goal: form.elements.namedItem('week-goal').value, hint: form.elements.namedItem('week-hint').value, tasks: tasks(form) });
  const fields = value => ({ 'week-goal': value.goal, 'week-hint': value.hint, 'week-tasks': JSON.stringify(value.tasks) });
  function fromFields(value) { return { goal: value['week-goal'] || '', hint: value['week-hint'] || '', tasks: JSON.parse(value['week-tasks'] || '[]') }; }
  function subjectLabel(id) { return getPlan().subjects.find(s => s.id === id)?.name || ''; }
  function list(items, id, editor, key, interactive) {
    return items.map((task, i) => {
      const check = id + '-' + task.id, title = task.title || '未命名任务';
      const checkbox = interactive ? '<input type="checkbox" id="' + check + '" data-task-id="' + task.id + '" data-task-field="done"' + (task.done ? ' checked' : '') + ' aria-label="' + escape(title + '，完成') + '">' : '<span class="task-state">' + (task.done ? '已完成' : '未完成') + '</span>';
      if (!editor) return '<li class="weekly-task" data-task-row="' + task.id + '"><label class="task-check"' + (interactive ? ' for="' + check + '"' : '') + '>' + checkbox + '<span class="task-text">' + escape(task.title) + (task.subjectId ? '<small class="task-subject">' + escape(subjectLabel(task.subjectId)) + '</small>' : '') + '</span></label></li>';
      return '<li class="weekly-task task-editor" data-task-row="' + task.id + '"><div class="task-edit-heading"><label class="task-toggle">' + checkbox + '</label><label for="' + check + '-title">任务 ' + (i + 1) + '</label></div><textarea id="' + check + '-title" data-task-id="' + task.id + '" data-task-field="title" rows="2" maxlength="500" required>' + escape(task.title) + '</textarea><label for="' + check + '-subject">科目（选填）</label><select id="' + check + '-subject" data-task-id="' + task.id + '" data-task-field="subjectId"><option value="">不关联科目</option>' + getPlan().subjects.map(s => '<option value="' + s.id + '"' + (task.subjectId === s.id ? ' selected' : '') + '>' + escape(s.name) + (window.StudyModel.subjectActive(s, key) ? '' : '（已归档）') + '</option>').join('') + '</select><div class="task-actions"><button type="button" data-week-action="up" data-task-id="' + task.id + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="上移任务 ' + escape(title) + '">上移</button><button type="button" data-week-action="down" data-task-id="' + task.id + '"' + (i === items.length - 1 ? ' disabled' : '') + ' aria-label="下移任务 ' + escape(title) + '">下移</button><button type="button" data-week-action="delete" data-task-id="' + task.id + '" aria-label="删除任务 ' + escape(title) + '">删除</button></div></li>';
    }).join('');
  }
  function count(items) { return items.filter(t => t.done).length + ' / ' + items.length + ' 项已完成'; }
  function controls(plan, key, mode) {
    const value = W().snapshot(plan, key), editor = mode === 'editor', id = editor ? 'week-form' : 'week-today-form';
    const hidden = (name, value) => '<input type="hidden" name="' + name + '" data-draft-field="' + name + '" value="' + escape(value) + '">';
    return '<form id="' + id + '" data-week-mode="' + mode + '" data-dirty="' + (editor ? 'sheet' : 'weekly') + '" data-key="' + key + '" data-week-base="' + escape(JSON.stringify(value)) + '">' + (editor ? '<p class="week-range">' + key.replaceAll('-', '.') + ' — ' + W().end(key).replaceAll('-', '.') + '</p><div class="field"><label for="week-goal">本周目标（选填）</label><textarea id="week-goal" name="week-goal" rows="3" maxlength="8000">' + escape(value.goal) + '</textarea></div>' : hidden('week-goal', value.goal) + hidden('week-hint', value.hint) + '<p class="goal-copy" data-week-goal'+(!value.goal?' hidden':'')+'>'+escape(value.goal)+'</p><p class="hint week-note" data-week-hint'+(!value.hint?' hidden':'')+'>'+escape(value.hint)+'</p>') + hidden('week-tasks', JSON.stringify(value.tasks)) + '<p class="week-task-count" data-week-count role="status"' + (!value.tasks.length ? ' hidden' : '') + '>' + count(value.tasks) + '</p><ul class="weekly-tasks" data-week-tasks>' + list(value.tasks, id, editor, key, true) + '</ul>' + (editor ? '<div class="task-tools"><button type="button" class="text-button" data-week-action="add">添加任务</button><button type="button" class="text-button" data-week-action="undo" hidden>撤销删除</button></div><div class="field"><label for="week-hint">随记（选填）</label><textarea id="week-hint" name="week-hint" rows="3" maxlength="8000">' + escape(value.hint) + '</textarea></div>' : '') + '<div data-week-conflicts></div><div class="save-row"' + (!editor ? ' hidden' : '') + '><button type="submit" class="primary">保存目标</button></div></form>';
  }
  function readonly(plan, key, grouped) {
    const value = W().snapshot(plan, key);
    if (!value.goal && !value.hint && !value.tasks.length) return '';
    const group = done => '<h3 class="task-group-heading">' + (done ? '已完成' : '未完成') + '</h3><ul class="weekly-tasks">' + list(value.tasks.filter(t => t.done === done), 'saved-week', false, key, false) + '</ul>';
    return (value.goal ? '<p class="goal-copy">' + escape(value.goal) + '</p>' : '') + (value.tasks.length ? '<p class="week-task-count">' + count(value.tasks) + '</p>' + (grouped ? [false, true].filter(done => value.tasks.some(t => t.done === done)).map(group).join('') : '<ul class="weekly-tasks">' + list(value.tasks, 'saved-week', false, key, false) + '</ul>') : '') + (value.hint ? '<p class="hint week-note">' + escape(value.hint) + '</p>' : '');
  }
  function set(form, value) { Object.entries(fields(value)).forEach(([name, input]) => { form.elements.namedItem(name).value = input; }); sync(form); }
  function mark(form) {
    form.querySelector('[data-week-conflicts]')?.replaceChildren(); contexts.delete(form);
    form.querySelector('.save-row').hidden = false;
    const counter=form.querySelector('[data-week-count]'); if(counter)counter.textContent=count(tasks(form))+' · 待保存';
    form.elements.namedItem('week-tasks').dispatchEvent(new Event('input', { bubbles: true }));
  }
  function sync(form) {
    if (!form?.dataset.weekMode) return;
    const value = tasks(form); W().taskList(value, new Set(getPlan().subjects.map(s => s.id)), true);
    form.querySelector('[data-week-tasks]').innerHTML = list(value, form.id, form.dataset.weekMode === 'editor', form.dataset.key, true);
    const counter = form.querySelector('[data-week-count]'); counter.hidden = !value.length; counter.textContent = count(value);
    const undo = form.querySelector('[data-week-action="undo"]'); if (undo) undo.hidden = !deleted.get(form)?.length;
    const add = form.querySelector('[data-week-action="add"]'); if(add){add.disabled=value.length>=W().limit;let limit=form.querySelector('[data-week-limit]');if(!limit){limit=document.createElement('p');limit.dataset.weekLimit='';limit.className='hint';limit.textContent='每周最多50项任务';add.closest('.task-tools').after(limit);}limit.hidden=value.length<W().limit;}
    ['goal','hint'].forEach(name=>{const e=form.querySelector('[data-week-'+name+']');if(e){const text=form.elements.namedItem('week-'+name).value;e.textContent=text;e.hidden=!text;}});
    lock(form);
  }
  function lock(form) { form.querySelectorAll('[data-task-field],textarea[name="week-goal"],textarea[name="week-hint"]').forEach(e=>{e.disabled=!!form.dataset.weekConflict;}); }
  function describe(value) {
    if (value === undefined) return '已删除';
    if (value === null) return '不关联科目';
    if (typeof value === 'boolean') return value ? '已完成' : '未完成';
    if (Array.isArray(value)) return '顺序已调整';
    if (typeof value === 'object') return value.title + ' · ' + (value.done ? '已完成' : '未完成');
    return subjectLabel(value) || value || '空白';
  }
  function showConflicts(form, base, current, edited, kind) {
    const result = W().merge(base, current, edited);
    contexts.set(form, { base, current, edited, kind });
    form.dataset.weekConflict = 'true';
    lock(form);
    form.querySelector('[data-week-conflicts]').innerHTML = '<div class="week-conflicts" role="alert"><h3>目标已更新</h3>' + result.conflicts.map((c, i) => '<div class="field"><label for="' + form.id + '-conflict-' + i + '">' + escape(c.label) + '</label><p>已保存：' + escape(describe(c.current)) + '</p><p>当前输入：' + escape(describe(c.edited)) + '</p><select id="' + form.id + '-conflict-' + i + '" data-week-choice="' + escape(c.key) + '"><option value="">选择处理方式</option><option value="current">保留已保存内容</option><option value="edited">使用当前输入</option></select></div>').join('') + '<button type="button" class="compact-button" data-week-action="resolve">应用选择</button></div>';
    form.querySelector('.save-row').hidden = false;
  }
  document.addEventListener('study-draft-applied', event => { if (event.target.dataset.weekMode) sync(event.target); });
  document.addEventListener('study-draft-cleared', event => {
    const form = event.target; if (!form.dataset.weekMode) return;
    contexts.delete(form); deleted.delete(form); delete form.dataset.weekConflict; form.querySelector('[data-week-conflicts]').replaceChildren(); sync(form);
  });
  document.addEventListener('study-draft-merge', event => {
    const form = event.target, detail = event.detail; if (!form.dataset.weekMode) return;
    const base = fromFields(detail.draft.base), current = fromFields(detail.current), edited = fromFields(detail.draft.values);
    const result = W().merge(base, current, edited);
    // Draft values are permitted to contain a newly added, still blank task.
    W().taskList(result.value.tasks, new Set(getPlan().subjects.map(s => s.id)), true);
    detail.handled = true; detail.values = fields(result.value); detail.conflicted = !!result.conflicts.length;
    if (detail.conflicted) showConflicts(form, base, current, edited, 'draft');
  });
  document.addEventListener('input', event => {
    const input = event.target.closest('[data-task-field]'); if (!input) return;
    event.stopImmediatePropagation(); if(input.dataset.taskField!=='title')return;
    const form = input.closest('form'), value = tasks(form);
    value.find(t => t.id === input.dataset.taskId).title = input.value;
    const row=input.closest('[data-task-row]'),name=input.value||'未命名任务';
    row.querySelector('[data-task-field="done"]').setAttribute('aria-label',name+'，完成');
    row.querySelectorAll('[data-week-action]').forEach(button=>button.setAttribute('aria-label',({up:'上移任务 ',down:'下移任务 ',delete:'删除任务 '})[button.dataset.weekAction]+name));
    form.elements.namedItem('week-tasks').value = JSON.stringify(value); mark(form);
  });
  document.addEventListener('change', event => {
    const input = event.target.closest('[data-task-field]'); if (!input) return;
    event.stopImmediatePropagation(); const form = input.closest('form'), value = tasks(form), task = value.find(t => t.id === input.dataset.taskId);
    task[input.dataset.taskField] = input.dataset.taskField === 'done' ? input.checked : input.value || null;
    form.elements.namedItem('week-tasks').value = JSON.stringify(value);
    form.querySelector('[data-week-count]').textContent = count(value); mark(form);
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-week-action]'); if (!button || button.disabled) return;
    const form = button.closest('form'), action = button.dataset.weekAction, value = tasks(form), index = value.findIndex(t => t.id === button.dataset.taskId);
    if (action === 'resolve') {
      const context = contexts.get(form), choices = {};
      for (const select of form.querySelectorAll('[data-week-choice]')) { if (!select.value) { select.focus(); return; } choices[select.dataset.weekChoice] = select.value; }
      const result = W().merge(context.base, context.current, context.edited, choices);
      contexts.delete(form); delete form.dataset.weekConflict; form.querySelector('[data-week-conflicts]').replaceChildren(); lock(form);
      if (context.kind === 'draft') window.StudyDrafts.resolve(form, fields(result.value));
      else { form.dataset.weekBase = JSON.stringify(context.current); set(form, result.value); mark(form); }
      return;
    }
    if (form.dataset.weekConflict) { form.querySelector('[data-week-conflicts] select')?.focus(); return; }
    let focus;
    if (action === 'add') {
      if (value.length >= W().limit) return;
      const bytes = new Uint32Array(4); crypto.getRandomValues(bytes);
      const task = { id: 'task_' + Array.from(bytes, b => b.toString(16)).join('_'), title: '', subjectId: null, done: false, updatedAt: '' };
      value.push(task); focus = '#' + form.id + '-' + task.id + '-title';
    } else if (action === 'delete') {
      const undo = deleted.get(form) || []; undo.push({ index, task: value.splice(index, 1)[0] }); deleted.set(form, undo); focus = '[data-week-action="undo"]';
    } else if (action === 'undo') {
      if (value.length >= W().limit) return;
      const item = deleted.get(form)?.pop(); if (!item) return;
      value.splice(Math.min(item.index, value.length), 0, item.task); focus = '#' + form.id + '-' + item.task.id + '-title';
    } else if (action === 'up' || action === 'down') {
      const destination = index + (action === 'up' ? -1 : 1);
      if (index < 0 || destination < 0 || destination >= value.length) return;
      value.splice(destination, 0, value.splice(index, 1)[0]); focus = '[data-week-action="' + action + '"][data-task-id="' + button.dataset.taskId + '"]';
    }
    form.elements.namedItem('week-tasks').value = JSON.stringify(value); sync(form); mark(form); form.querySelector(focus)?.focus();
  });
  window.StudyWeekUI = { init: fn => { getPlan = fn; }, controls, readonly, values, sync, showConflicts, base: form => JSON.parse(form.dataset.weekBase) };
})();
