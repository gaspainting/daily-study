(function (root, factory) {
  'use strict';
  var words = factory();
  if (typeof module === 'object' && module.exports) module.exports = words;
  root.StudyWords = words;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function addition(value, amount) {
    if (typeof value !== 'string' || typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 100000) throw new Error('快捷加数须为 1 至 100000 的整数');
    var current = value === '' ? 0 : Number(value);
    if (!Number.isInteger(current) || current < 0 || current + amount > 100000) throw new Error('词数须为 0 至 100000 的整数');
    return { before: value, after: String(current + amount) };
  }
  function undo(change, current) { return change && current === change.after ? change.before : null; }
  return Object.freeze({ addition: addition, undo: undo });
});
