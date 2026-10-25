(function (root) {
  'use strict';
  const L = root.StudyWordLog;
  const removed = new WeakMap();
  const fieldFor = {new: 'newWords', review: 'reviewWords'};
  const labelFor = {new: '新学', review: '复习'};
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const copy = value => JSON.parse(JSON.stringify(value));
  let h;
  const id = () => 'w_' + (root.crypto?.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
  const inputFor = (form, subject, kind) => form.elements.namedItem(fieldFor[kind] + '-' + subject);
  const storeFor = (form, subject) => form.elements.namedItem('word-log-' + subject);
  const entryFor = (form, subject) => storeFor(form, subject).closest('.word-entry');
  const baseline = subject => h.baseline(subject) || {newWords: null, reviewWords: null};
  function read(form, subject) {
    const value = storeFor(form, subject).value;
    let log;
    try { log = value ? JSON.parse(value) : L.from(baseline(subject)); }
    catch (_) { throw new Error('分次草稿格式有误，请恢复已保存明细'); }
    L.totals(log); return log;
  }
  function write(form, subject, log) {
    const base = baseline(subject);
    storeFor(form, subject).value = !base.wordLog && !log.entries.length && equal(log.base, L.from(base).base) ? '' : JSON.stringify(log);
  }
  function countValue(input) {
    if (!input.validity.valid) throw new Error('词数请填写 0 至 100000 的整数，或留空');
    return input.value === '' ? null : Number(input.value);
  }
  function reconcile(form, subject) {
    let log = read(form, subject), changed = false;
    const savedIds = (baseline(subject).wordLog?.entries || []).map(e => e.id);
    for (const kind of ['new', 'review']) {
      const input = inputFor(form, subject, kind);
      if (!input.validity.valid) continue;
      const value = countValue(input);
      if (L.totals(log)[fieldFor[kind]] !== value) {
        log = L.setTotal(log, kind, value, id(), new Date().toISOString(), savedIds); changed = true;
      }
    }
    if (changed) write(form, subject, log);
    return log;
  }
  const countText = n => n === null ? '未记录' : n + ' 个';
  function totalsText(log) { const total = L.totals(log); return '新学 ' + countText(total.newWords) + ' · 复习 ' + countText(total.reviewWords); }
  function sourceText(e) { return e.operation === 'set' ? '总数调整' : e.source === 'quick' ? '快捷累加' : '手动添加'; }
  function list(form, subject, log) {
    const entry = entryFor(form, subject), container = entry.querySelector('[data-word-log-list]'), esc = h.escape;
    const base = log.base, saved = baseline(subject);
    const pending = !equal(log, L.from(saved));
    let html = base.newWords !== null || base.reviewWords !== null ? '<p class="word-log-base">原有总数 · ' + esc(totalsText({base, entries: []})) + '</p>' : '';
    html += log.entries.length ? '<ol class="word-log-entries">' + log.entries.slice().reverse().map(e => {
      const date = new Date(e.at), when = date.toLocaleString('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false});
      const title = labelFor[e.kind] + (e.operation === 'add' ? ' +' + e.count + ' 个' : '总数 → ' + countText(e.count));
      return '<li><div class="word-log-info"><strong>' + esc(title) + '</strong><small>记录于 <time datetime="' + esc(e.at) + '">' + esc(when) + '</time> <span class="word-log-source">· ' + sourceText(e) + '</span>' + (e.editedAt ? ' <span class="word-log-source">· 已修改</span>' : '') + '</small></div><div class="word-log-actions"><button type="button" data-action="word-log-edit" data-subject="' + esc(subject) + '" data-entry="' + esc(e.id) + '" aria-label="修改' + esc(title) + '">修改</button><button type="button" data-action="word-log-remove" data-subject="' + esc(subject) + '" data-entry="' + esc(e.id) + '" aria-label="移除' + esc(title) + '">移除</button></div></li>';
    }).join('') + '</ol>' : '<p class="word-log-empty">暂无分次记录</p>';
    if (removed.has(entry)) html += '<button type="button" class="text-button" data-action="word-log-restore" data-subject="' + esc(subject) + '">撤销移除</button>';
    container.innerHTML = html;
    entry.querySelector('[data-word-log-count]').textContent = log.entries.length ? ' · ' + log.entries.length + ' 条' : '';
    entry.querySelector('[data-word-log-status]').textContent = pending ? '待保存' : '';
  }
  function sync(form, fromInputs = false) {
    if (!form || form.id !== 'daily-form') return;
    form.querySelectorAll('[data-word-log-store]').forEach(store => {
      const subject = store.dataset.wordLogStore, problem = entryFor(form, subject).querySelector('[data-word-log-error]');
      try { const log = fromInputs ? reconcile(form, subject) : read(form, subject); list(form, subject, log); problem.hidden = true; }
      catch (error) { problem.querySelector('[data-word-log-error-text]').textContent = error.name === 'Error' ? error.message : '分次草稿读取失败'; problem.hidden = false; }

    });
  }
  function notify(form, subject, log) {
    write(form, subject, log);
    const total = L.totals(log);
    for (const kind of ['new', 'review']) inputFor(form, subject, kind).value = total[fieldFor[kind]] ?? '';
    h.clearUndo(form);
    storeFor(form, subject).dispatchEvent(new Event('input', {bubbles: true}));
    list(form, subject, log);
    entryFor(form, subject).querySelector('[data-word-feedback]').textContent = totalsText(log) + '，待保存';
  }
  function subjectFor(input) { return input.id.slice(input.id.startsWith('newWords-') ? 9 : 12); }
  function addition(input, amount) {
    const form = input.form, subject = subjectFor(input), kind = input.id.startsWith('newWords-') ? 'new' : 'review';
    const log = reconcile(form, subject), entry = {id: id(), kind, operation: 'add', count: amount, at: new Date().toISOString(), source: 'quick'};
    const next = L.append(log, entry);
    write(form, subject, next); removed.delete(entryFor(form, subject));
    list(form, subject, next); return entry.id;
  }
  function undoAddition(input, entryId) {
    const form = input.form, subject = subjectFor(input), next = L.remove(read(form, subject), entryId);
    write(form, subject, next); list(form, subject, next);
  }
  function editor(subject, entryId, kind = 'new') {
    const form = document.getElementById('daily-form'), log = reconcile(form, subject), entry = entryId ? log.entries.find(e => e.id === entryId) : null;
    if (entryId && !entry) throw new Error('这条单词明细已不存在');
    const operation = entry?.operation || 'add', label = operation === 'set' ? '调整后总数（个，留空为未记录）' : '数量（个）';
    const html = '<form id="word-log-editor" data-subject="' + h.escape(subject) + '" data-entry="' + h.escape(entryId || '') + '">' +
      (entry ? '<p>' + labelFor[entry.kind] + ' · ' + sourceText(entry) + '</p>' : h.selectField('类别', 'word-log-kind', kind, [['new', '新学'], ['review', '复习']])) +
      h.field(label, 'word-log-count', entry?.count ?? '', {type: 'number', min: operation === 'add' ? 1 : 0, max: 100000, step: 1, required: operation === 'add', placeholder: operation === 'set' ? '未记录' : ''}) +
      '<p class="word-log-preview" role="status" aria-live="polite"></p><p class="word-log-error" role="alert" hidden></p><div class="save-row"><button type="button" class="cancel-button" data-action="close-sheet">取消</button><button type="submit" class="primary">' + (entry ? '应用修改' : '加入今日记录') + '</button></div></form>';
    h.openSheet(entry ? '修改单词明细' : '记一笔', html, true);
    const editor = document.getElementById('word-log-editor');
    editor.dataset.operation = operation; editor.dataset.kind = entry?.kind || kind;
    previewEditor(editor);
  }
  function editedLog(editor) {
    const form = document.getElementById('daily-form'), subject = editor.dataset.subject, log = read(form, subject);
    const value = countValue(editor.elements.namedItem('word-log-count'));
    return editor.dataset.entry ? L.edit(log, editor.dataset.entry, value, new Date().toISOString()) : L.append(log, {id: id(), kind: editor.elements.namedItem('word-log-kind').value, operation: 'add', count: value, at: new Date().toISOString(), source: 'manual'});
  }
  function previewEditor(editor) {
    try { editor.querySelector('.word-log-preview').textContent = (editor.dataset.entry ? '修改后：' : '加入后：') + totalsText(editedLog(editor)); }
    catch (_) { editor.querySelector('.word-log-preview').textContent = ''; }
  }
  function remove(subject, entryId) {
    const form = document.getElementById('daily-form'), log = read(form, subject), next = L.remove(log, entryId), entry = entryFor(form, subject);
    if (!root.confirm('移除这条单词明细？\n移除后：' + totalsText(next))) return;
    removed.set(entry, copy(log)); notify(form, subject, next);
    entry.querySelector('[data-action="word-log-restore"]')?.focus({preventScroll: true});
  }
  function restore(subject) {
    const form = document.getElementById('daily-form'), entry = entryFor(form, subject), log = removed.get(entry);
    if (!log) return; removed.delete(entry); notify(form, subject, log);
    entry.querySelector('[data-action="word-log-edit"]')?.focus({preventScroll: true});
  }
  document.addEventListener('submit', e => {
    if (e.target.id !== 'word-log-editor') return;
    e.preventDefault(); e.stopImmediatePropagation(); const editor = e.target;
    try {
      if (!editor.reportValidity()) return;
      const log = editedLog(editor); removed.delete(entryFor(document.getElementById('daily-form'), editor.dataset.subject));
      const form = document.getElementById('daily-form'), subject = editor.dataset.subject, entryId = editor.dataset.entry;
      notify(form, subject, log); h.closeSheet(true);
      entryFor(form, subject).querySelector(entryId ? '[data-action="word-log-edit"][data-entry="' + entryId + '"]' : '[data-action="word-log-add"]')?.focus({preventScroll: true});
    } catch (error) { const message = editor.querySelector('.word-log-error'); message.hidden = false; message.textContent = error.message; }
  });
  document.addEventListener('input', e => { if (e.target.closest('#word-log-editor')) previewEditor(e.target.form); });
  root.StudyWordLogUI = {
    init(helpers) { h = helpers; },
    view(subject, record, escape) { return '<input type="hidden" name="word-log-' + escape(subject.id) + '" id="word-log-' + escape(subject.id) + '" data-word-log-store="' + escape(subject.id) + '" value="' + escape(record.wordLog ? JSON.stringify(record.wordLog) : '') + '"><div data-word-log-error role="alert" hidden><span data-word-log-error-text></span><button type="button" class="text-button" data-action="word-log-reset" data-subject="' + escape(subject.id) + '">恢复已保存明细</button></div><div class="word-log-heading"><button type="button" class="text-button" data-action="word-log-add" data-subject="' + escape(subject.id) + '">记一笔</button><span data-word-log-status role="status" aria-live="polite"></span></div><details class="details-toggle word-log"><summary>分次记录<span data-word-log-count></span></summary><div data-word-log-list></div></details>'; },
    sync, addition, undoAddition, editor, remove, restore,
    restoreSaved(subject) {
      if (!root.confirm('恢复已保存的单词数量和明细？未保存的单词改动将被替换。')) return;
      const form = document.getElementById('daily-form'); removed.delete(entryFor(form, subject));
      notify(form, subject, L.from(baseline(subject))); sync(form);
    },
    input(input) {
      if (!/^(newWords|reviewWords)-/.test(input.id)) return;
      const subject = subjectFor(input), form = input.form;
      if (!storeFor(form, subject)) return;
      removed.delete(entryFor(form, subject)); list(form, subject, reconcile(form, subject));
    },
    record(form, subject) { const log = reconcile(form, subject); return storeFor(form, subject).value ? {newWords: countValue(inputFor(form, subject, 'new')), reviewWords: countValue(inputFor(form, subject, 'review')), wordLog: log} : {newWords: countValue(inputFor(form, subject, 'new')), reviewWords: countValue(inputFor(form, subject, 'review'))}; },
    reset(form) { if (form?.id === 'daily-form') form.querySelectorAll('.word-entry').forEach(e => removed.delete(e)); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
