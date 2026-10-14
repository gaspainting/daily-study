(function () {
  'use strict';
  const entries = new WeakMap();
  let api, keyFor, changed;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function controls(form) { return Array.from(form.elements).filter(e => e.name && !['submit', 'button'].includes(e.type)); }
  function controlKey(form, e) { return e.id || e.name + ':' + controls(form).filter(c => c.name === e.name).indexOf(e); }
  function fields(form) {
    const values = {};
    controls(form).forEach(e => { const key = controlKey(form, e); values[key] = ['radio', 'checkbox'].includes(e.type) ? e.checked : e.value; });
    return values;
  }
  function apply(form, values) {
    controls(form).forEach(e => { const key = controlKey(form, e); if (!(key in values)) return; if (['radio', 'checkbox'].includes(e.type)) e.checked = values[key]; else e.value = values[key]; });
    form.querySelectorAll('details').forEach(e => { if (Array.from(e.querySelectorAll('input,textarea')).some(c => c.value)) e.open = true; });
  }
  function banner(form, text, actions, error = false) {
    let e = form.querySelector('.draft-status');
    if (!e) { e = document.createElement('div'); e.className = 'draft-status'; form.prepend(e); }
    e.setAttribute('role', error ? 'alert' : 'status'); e.replaceChildren();
    const label = document.createElement('span'); label.textContent = text; e.append(label);
    actions.forEach(([name, title]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'text-button'; b.dataset.draftAction = name; b.textContent = title; e.append(b); });
  }
  function attach(form) {
    const key = keyFor(form); if (!key) return;
    const base = fields(form); form.dataset.draftKey = key;
    const entry = { key, base, saved: true, pending: null, readError: false }; entries.set(form, entry);
    try {
      const draft = api('getDraft', key).draft; if (!draft) return;
      if (form.id === 'reference-form' && draft.values['reference-date'] !== undefined && draft.values['reference-date'] !== base['reference-date']) {
        entry.legacyReference = draft;
        banner(form, '目标草稿：' + draft.values['reference-date'], [['reference', '查看目标草稿'], ['clear', '清除']], true);
        return;
      }
      if (equal(draft.values, base)) { api('deleteDraft', key); return; }
      const patches = {}, conflicts = [];
      Object.keys(draft.values).forEach(k => {
        if (!(k in base) || draft.values[k] === draft.base[k]) return;
        if (base[k] !== draft.base[k] && base[k] !== draft.values[k]) conflicts.push(k);
        patches[k] = draft.values[k];
      });
      if (conflicts.length) { entry.pending = patches; banner(form, '记录已更新', [['apply', '使用草稿'], ['clear', '保留当前记录']], true); return; }
      if (!Object.keys(patches).length) { api('deleteDraft', key); return; }
      apply(form, patches); changed(form); banner(form, '已恢复草稿', [['clear', '清除草稿']]);
    } catch (e) { entry.saved = false; entry.readError = true; banner(form, '草稿读取失败', [['retry', '重试']], true); }
  }
  function save(form) {
    const entry = entries.get(form); if (!entry) return true;
    if (entry.legacyReference) return false;
    try {
      const values = fields(form);
      if (equal(values, entry.base)) api('deleteDraft', entry.key);
      else api('saveDraft', entry.key, JSON.stringify(entry.base), JSON.stringify(values));
      entry.saved = true; entry.pending = null;
      if (!equal(values, entry.base)) banner(form, '草稿', [['clear', '清除']]);
      else form.querySelector('.draft-status')?.remove();
      return true;
    } catch (e) { entry.saved = false; banner(form, '草稿保存失败', [['retry', '重试']], true); return false; }
  }
  function clear(form) {
    const entry = entries.get(form); if (!entry) return;
    api('deleteDraft', entry.key); apply(form, entry.base); entry.saved = true; entry.pending = null; entry.legacyReference = null; form.querySelector('.draft-status')?.remove(); changed(form, false);
  }
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-draft-action]'); if (!button) return;
    const form = button.closest('form'), entry = entries.get(form); if (!entry) return;
    try {
      if (button.dataset.draftAction === 'reference') document.dispatchEvent(new CustomEvent('study-reference-draft', {detail:{form,draft:entry.legacyReference,sourceKey:entry.key}}));
      if (button.dataset.draftAction === 'retry') { if (entry.readError) attach(form); else save(form); }
      if (button.dataset.draftAction === 'clear' && window.confirm('清除这份草稿？')) clear(form);
      if (button.dataset.draftAction === 'apply' && window.confirm('使用草稿替换当前表单中的冲突字段？')) { apply(form, entry.pending); changed(form); save(form); }
    } catch (_) { banner(form, '草稿清除失败', [['retry', '重试']], true); }
  });
  window.StudyDrafts = {
    init(call, resolveKey, onChange) { api = call; keyFor = resolveKey; changed = onChange; },
    attach, save, fields,
    hasContextConflict(form) { return !!entries.get(form)?.legacyReference; },
    flush() { let ok = true; document.querySelectorAll('form[data-dirty]').forEach(f => { const entry = entries.get(f); if (entry && !entry.pending && !equal(fields(f), entry.base)) ok = save(f) && ok; }); return ok; },
    removeKey(key) { if (key) api('deleteDraft', key); }
  };
})();
