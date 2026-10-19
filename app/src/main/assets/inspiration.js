/* All production card selection and storage belong to Native. This file only presents them. */
(function () {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const image = card => card.previewImage || 'https://study.local/media/' + card.imageKey;
  const detail = document.getElementById('inspiration-detail'), splash = document.getElementById('startup-screen');
  let bridge, refresh, tell, scope = 'daily', offset = 0, data = null, activeEntry = null;
  let query = '', pendingQuery = '', theme = '', language = '';
  let initialized = false, startupEntry = null, startupShown = false, splashTimer, splashStarted = 0, splashLoadingTimeout;
  let waitingStartup = false, startupPoll, startupNetworkTimeout;
  const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
  function call(name, ...args) { const r = decode(bridge[name](...args)); if (r && r.error) throw new Error(r.error); return r; }
  function attempt(fn) { try { return fn(); } catch (e) { tell(e.message || '图文暂时无法打开'); return false; } }
  function time(at) { const d = new Date(at); return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
  function repeat(entry) { return entry.imageRepeat || entry.textRepeat ? '<span class="card-note">含曾展示内容</span>' : ''; }
  function copy(card, full) { return '<p class="card-text' + (full ? ' full' : '') + '" lang="' + esc(card.language) + '">' + esc(card.text) + '</p>' + (card.translation ? '<div class="card-translation"><span class="eyebrow">中文释义</span><p>' + esc(card.translation) + '</p></div>' : ''); }
  function controls(entry) { const c = entry.card; return '<div class="card-actions"><button data-inspire="favorite" data-id="' + esc(entry.id) + '" aria-pressed="' + c.favorite + '">' + icon('heart') + (c.favorite ? '已收藏' : '收藏') + '</button><button data-inspire="save" data-id="' + esc(entry.id) + '">' + icon('download') + '保存图片</button><button data-inspire="share" data-id="' + esc(entry.id) + '">' + icon('share') + '分享</button></div>'; }
  function attribution(card) {
    const words = [card.textAuthor, card.textSource].filter(Boolean).join(' · ');
    const picture = [card.imageAuthor, card.imageSource].filter(Boolean).join(' · ');
    return '<div class="card-attribution"><p>文字：' + esc(words) + '</p><p>图片：' + esc(picture) + '</p></div>';
  }
  function source(card) {
    return '<details class="card-source"><summary>来源</summary>' + (card.textPage ? '<p class="source-url">文字出处：' + esc(card.textPage) + '</p>' : '') + (card.textLicense ? '<p>' + esc(card.textLicense) + '</p>' : '') + (card.imageTitle ? '<p>作品：' + esc(card.imageTitle) + '</p>' : '') + (card.imagePage ? '<p class="source-url">图片来源：' + esc(card.imagePage) + '</p>' : '') + (card.imageLicense ? '<p>' + esc(card.imageLicense) + '</p>' : '') + (card.translationSource ? '<p>释义：' + esc(card.translationSource) + '</p>' : '') + (card.ai && !card.textId.startsWith('original_') ? '<p>素材标记：含AI辅助内容</p>' : '') + '</details>';
  }
  function mainCard(entry) {
    const c = entry.card;
    return '<article class="daily-card"><div class="card-heading"><span>' + esc(entry.date.replaceAll('-', '.')) + '</span><span>日签</span></div><button class="card-art-button" data-inspire="detail" data-id="' + esc(entry.id) + '" aria-label="查看完整图文"><img class="card-art" src="' + esc(image(c)) + '" alt="' + esc(c.imageTitle || '日签图片') + '"></button>' + copy(c, false) + '<button class="text-button card-read" data-inspire="detail" data-id="' + esc(entry.id) + '">阅读全文 ' + icon('next') + '</button>' + attribution(c) + (entry.imageRepeat || entry.textRepeat ? '<div class="card-meta">' + repeat(entry) + '</div>' : '') + controls(entry) + '</article>';
  }
  function historyItem(entry) { const c = entry.card, marks = [c.favorite ? '已收藏' : '', entry.imageRepeat || entry.textRepeat ? '曾展示' : ''].filter(Boolean); return '<button class="inspiration-history-item" data-inspire="detail" data-id="' + esc(entry.id) + '"><img src="' + esc(image(c)) + '" alt="' + esc(c.imageTitle || '图文插图') + '" loading="lazy"><span class="history-copy"><span class="history-date">' + esc(entry.date.replaceAll('-', '.')) + (entry.kind === 'startup' ? ' · ' + time(entry.at) + ' 开屏' : ' 日签') + '</span><span class="history-text">' + esc(c.text) + '</span>' + (marks.length ? '<span class="history-theme">' + marks.join(' · ') + '</span>' : '') + '</span>' + icon('next') + '</button>'; }
  function load() {
    data = scope === 'daily' ? call('getInspiration', scope, offset, 20) : call('searchInspiration', scope, offset, 20, query, theme, language);
    if (scope !== 'daily' && offset > 0 && offset >= data.total) {
      offset = data.total ? Math.floor((data.total - 1) / 20) * 20 : 0;
      data = call('searchInspiration', scope, offset, 20, query, theme, language);
    }
    return data;
  }
  function filterSelect(id, label, value, options) {
    const choices = [...new Set(options)];
    if (value && !choices.includes(value)) choices.push(value);
    return '<div class="field"><label for="' + id + '">' + label + '</label><select id="' + id + '"><option value="">全部' + label + '</option>' + choices.map(item => '<option value="' + esc(item) + '"' + (item === value ? ' selected' : '') + '>' + esc(id === 'inspiration-language' ? languageName(item) : item) + '</option>').join('') + '</select></div>';
  }
  function languageName(value) {
    const labels = { zh: '中文', 'zh-CN': '简体中文', 'zh-Hans': '简体中文', 'zh-TW': '繁体中文', 'zh-Hant': '繁体中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语', it: '意大利语' };
    if (labels[value]) return labels[value];
    try { return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(value) || value; } catch (_) { return value; }
  }
  function filters() {
    const options = call('getInspirationFilters');
    return '<form id="inspiration-search-form" class="inspiration-filters" role="search" aria-label="搜索日签"><div class="inspiration-search-row"><div class="field"><label for="inspiration-query">关键词</label><input id="inspiration-query" type="search" maxlength="200" value="' + esc(pendingQuery) + '" autocomplete="off"></div><button type="submit">搜索</button></div><div class="inspiration-filter-selects">' + filterSelect('inspiration-theme', '主题', theme, options.themes || []) + filterSelect('inspiration-language', '语言', language, options.languages || []) + '</div>' + (query || theme || language ? '<button type="button" class="text-button" data-inspire="reset-filters">清除筛选</button>' : '') + '</form>';
  }
  function applyFilters() {
    const input = document.getElementById('inspiration-query'), themes = document.getElementById('inspiration-theme'), languages = document.getElementById('inspiration-language');
    if (!input || !themes || !languages) return;
    const focus = document.activeElement && document.activeElement.id;
    query = pendingQuery = input.value.trim(); theme = themes.value; language = languages.value; offset = 0;
    refresh();
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }
  function view() {
    try {
      load();
      let html = '<div class="page-intro inspiration-intro"><div class="eyebrow">DAILY / 每日激励</div><h1>日签</h1></div><div class="inspiration-tabs" role="group" aria-label="图文分类">' + [['daily', '今日日签'], ['history', '日签历史'], ['favorites', '收藏'], ['startup', '开屏回看']].map(([s, text]) => '<button data-inspire="scope" data-scope="' + s + '" aria-pressed="' + (scope === s) + '">' + text + '</button>').join('') + '</div>';
      if (scope === 'daily') {
        html += data.daily ? mainCard(data.daily) : '<div class="undrawn-card"><span class="eyebrow">' + esc(data.today.replaceAll('-', '.')) + ' / 尚未抽取</span><svg class="undrawn-art" viewBox="0 0 160 110" aria-hidden="true"><path d="M22 87h116M40 85V29h80v56M46 76l28-28 22 18 17-15"/><circle cx="99" cy="40" r="6"/><path d="M19 21h13m-6-6v12m112-9 3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/></svg><h2>尚未抽取</h2><button class="primary draw-button" data-inspire="draw"' + (data.drawing ? ' disabled' : '') + '>' + (data.drawing ? '正在获取图片…' : '抽取今日日签') + ' ' + icon('next') + '</button></div>';
        html += (!data.daily && data.drawMessage ? '<p class="inspiration-footnote" role="status">' + esc(data.drawMessage) + '</p>' : '');
      } else {
        const items = data.items || [];
        html += filters() + '<div class="history-count" role="status">' + ({ history: '日签历史', favorites: '收藏', startup: '开屏回看' }[scope]) + ' · ' + data.total + ' 条</div>' + (items.length ? '<div class="inspiration-history">' + items.map(historyItem).join('') + '</div>' : '<div class="empty">' + (query || theme || language ? '没有匹配的日签' : scope === 'favorites' ? '暂无收藏' : '暂无记录') + '</div>');
        if (data.total > 20) html += '<div class="history-pagination"><button data-inspire="page" data-offset="' + Math.max(0, offset - 20) + '"' + (offset === 0 ? ' disabled' : '') + '>上一页</button><span>' + (Math.floor(offset / 20) + 1) + ' / ' + Math.ceil(data.total / 20) + '</span><button data-inspire="page" data-offset="' + (offset + 20) + '"' + (offset + 20 >= data.total ? ' disabled' : '') + '>下一页</button></div>';
      }
      html += '<div class="section inspiration-preparation"><div class="section-heading"><h2>图文</h2><span class="section-number">MATERIALS</span></div><div class="settings-row"><div><h3>联网准备素材</h3></div><label class="switch" aria-label="联网准备素材"><input id="inspiration-online" type="checkbox"' + (data.online ? ' checked' : '') + '><span></span></label></div><p class="hint" id="inspiration-fetch-status" role="status">' + esc(data.fetching ? '正在获取图文…' : '待用图文 ' + data.ready + ' 张') + '</p><div class="preparation-actions"><button data-inspire="refresh"' + (!data.online || data.fetching ? ' disabled' : '') + '>' + (data.fetching ? '正在准备…' : '准备新图文') + '</button><button class="text-button" data-inspire="clean"' + (data.fetching ? ' disabled' : '') + '>清理未使用素材</button></div></div>';
      return html;
    } catch (e) { return '<div class="page-intro"><h1>每日激励</h1><p class="notice">' + esc(e.message) + '</p><button data-inspire="retry">重新读取</button></div>'; }
  }
  function openEntry(id) { activeEntry = call('getInspirationEntry', id); renderDetail(); if (!detail.open) detail.showModal(); }
  function renderDetail() { if (!activeEntry) return; const e = activeEntry, c = e.card; detail.innerHTML = '<div class="sheet-heading"><div><span class="eyebrow">' + (e.kind === 'daily' ? '日签' : '开屏回看') + ' / ' + esc(e.date.replaceAll('-', '.')) + '</span><h2 id="inspiration-detail-title">' + (e.kind === 'daily' ? '日签' : '开屏回看') + '</h2></div><button class="icon-button" data-inspire="close" aria-label="关闭完整图文">×</button></div><img class="card-art detail-art" src="' + esc(image(c)) + '" alt="' + esc(c.imageTitle || '插图') + '">' + copy(c, true) + attribution(c) + (e.imageRepeat || e.textRepeat ? '<div class="card-meta">' + repeat(e) + '</div>' : '') + controls(e) + source(c); }
  function dismissSplash() { clearInterval(splashTimer); clearInterval(startupPoll); clearTimeout(startupNetworkTimeout); clearTimeout(splashLoadingTimeout); waitingStartup = false; if (bridge && bridge.cancelStartup) decode(bridge.cancelStartup()); splash.hidden = true; document.querySelector('.app-shell').inert = false; const main = document.getElementById('app'); if (main) main.focus({ preventScroll: true }); }
  function beginCountdown() { if (splashStarted || splash.hidden) return; clearTimeout(splashLoadingTimeout); splashStarted = performance.now(); splash.querySelector('.startup-content').classList.add('ready'); const tick = () => { const seconds = Math.max(0, Math.ceil((5000 - (performance.now() - splashStarted)) / 1000)); const count = document.getElementById('startup-countdown'); if (count) count.textContent = seconds + '秒'; if (seconds <= 0) dismissSplash(); }; tick(); splashTimer = setInterval(tick, 100); }
  function showStartup(entry) { clearInterval(startupPoll); clearTimeout(startupNetworkTimeout); waitingStartup = false; startupEntry = entry; startupShown = true; splashStarted = 0; const c = entry.card; const excerpt = c.text.length > 100 ? c.text.slice(0, 100) + '…' : c.text, translation = c.translation.length > 75 ? c.translation.slice(0, 75) + '…' : c.translation; const shortened = excerpt !== c.text || translation !== c.translation;
    splash.innerHTML = '<div class="startup-top"><span class="brand-mark">日</span><button id="skip-startup" data-inspire="skip">跳过 <span id="startup-countdown">5秒</span></button></div><div class="startup-content"><img id="startup-image" src="' + esc(image(c)) + '" alt="' + esc(c.imageTitle || '开屏插图') + '"><p class="startup-text" lang="' + esc(c.language) + '">' + esc(excerpt) + '</p>' + (translation ? '<p class="startup-translation">' + esc(translation) + '</p>' : '') + (shortened ? '<span class="startup-caption">节选</span>' : '') + attribution(c) + '</div><div class="startup-bottom"><span>每日学习</span></div>';
    splash.hidden = false; document.querySelector('.app-shell').inert = true; document.getElementById('skip-startup').focus({ preventScroll: true });
    const img = document.getElementById('startup-image'); img.addEventListener('load', beginCountdown, { once: true }); img.addEventListener('error', () => { img.hidden = true; beginCountdown(); }, { once: true }); if (img.complete) beginCountdown(); else splashLoadingTimeout = setTimeout(beginCountdown, 1500);
  }
  function pollStartup() { if (!waitingStartup) return; attempt(() => { const next = call('nextStartup'); if (next.show && next.entry) showStartup(next.entry); else if (!next.waiting) dismissSplash(); }); }
  function showStartupWaiting() { waitingStartup = true; splash.innerHTML = '<div class="startup-top"><span class="brand-mark">日</span><button id="skip-startup" data-inspire="skip">跳过</button></div><div class="startup-content ready"><h2 class="startup-wait-title">正在获取图文</h2></div><div class="startup-bottom"><span>每日学习</span></div>'; splash.hidden = false; document.querySelector('.app-shell').inert = true; document.getElementById('skip-startup').focus({ preventScroll: true }); startupPoll = setInterval(pollStartup, 350); startupNetworkTimeout = setTimeout(() => { if (waitingStartup) { dismissSplash(); tell('图片尚未就绪'); } }, 8000); }
  function init(adapter, rerender, notify, showOnInit = true) { bridge = adapter; refresh = rerender; tell = notify; if (initialized) return; initialized = true; if (showOnInit) attempt(() => { const result = call('getStartup'); if (result.waiting) showStartupWaiting(); else if (result.show && result.entry) showStartup(result.entry); }); }
  document.addEventListener('click', event => { const button = event.target.closest('[data-inspire]'); if (!button || button.disabled || !bridge) return;
    attempt(() => { const action = button.dataset.inspire, id = button.dataset.id;
      if (action === 'skip') return dismissSplash();
      if (action === 'scope') { scope = button.dataset.scope; offset = 0; refresh(); return; }
      if (action === 'reset-filters') { query = ''; pendingQuery = ''; theme = ''; language = ''; offset = 0; refresh(); return; }
      if (action === 'page') { offset = Number(button.dataset.offset); refresh(); window.scrollTo(0, 0); return; }
      if (action === 'draw') { button.disabled = true; button.textContent = '正在抽取…'; try { const entry = call('drawDaily'); refresh(); if (entry.pending) tell('正在获取日签图片…'); else openEntry(entry.id); } finally { if (button.isConnected) { button.disabled = false; button.textContent = '抽取今日日签'; } } return; }
      if (action === 'detail') return openEntry(id);
      if (action === 'close') { detail.close(); return; }
      if (action === 'favorite') { const e = call('getInspirationEntry', id); call('favoriteInspiration', id, !e.card.favorite); if (activeEntry && activeEntry.id === id) { activeEntry = call('getInspirationEntry', id); renderDetail(); } refresh(); tell(e.card.favorite ? '已取消收藏' : '已收藏'); return; }
      if (action === 'save' || action === 'share') { call(action === 'save' ? 'saveInspirationImage' : 'shareInspiration', id); tell('正在生成图片…'); return; }
      if (action === 'refresh') { call('refreshInspiration'); refresh(); return; }
      if (action === 'clean') { if (!window.confirm('清理未使用素材？已展示的图文和收藏会保留。')) return; const r = call('cleanInspirationPending'); refresh(); tell('已清理 ' + r.removed + ' 个未使用图片文件。'); return; }
      if (action === 'retry') refresh();
    });
  });
  document.addEventListener('submit', event => { if (event.target.id !== 'inspiration-search-form' || !bridge) return; event.preventDefault(); attempt(applyFilters); });
  document.addEventListener('input', event => { if (event.target.id === 'inspiration-query') pendingQuery = event.target.value; });
  document.addEventListener('change', event => { if (['inspiration-theme', 'inspiration-language'].includes(event.target.id) && bridge) { attempt(applyFilters); return; } if (event.target.id === 'inspiration-online' && bridge) { const enabled = event.target.checked; if (attempt(() => { call('setInspirationOnline', enabled); refresh(); tell(enabled ? '已开启联网准备' : '已关闭联网准备'); return true; }) === false) event.target.checked = !enabled; } });
  detail.addEventListener('click', event => { if (event.target === detail) { const box = detail.getBoundingClientRect(); if (event.clientY < box.top || event.clientY > box.bottom) detail.close(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !splash.hidden) dismissSplash(); });
  window.onInspirationChanged = () => { if (waitingStartup) pollStartup(); if (refresh) refresh(); };
  setInterval(() => { if (bridge && data && window.StudyModel.today() !== data.today && refresh) refresh(); }, 15000);
  window.InspirationUI = { init, view, dismiss: dismissSplash, background: () => { if (!splash.hidden) dismissSplash(); }, back: () => { if (!splash.hidden) { dismissSplash(); return true; } if (detail.open) { detail.close(); return true; } return false; }, restored: () => { if (detail.open) detail.close(); activeEntry = null; offset = 0; query = ''; pendingQuery = ''; theme = ''; language = ''; }, snapshot: () => ({ scope, offset, query, theme, language, startupShown, startupId: startupEntry && startupEntry.id, splashVisible: !splash.hidden, detailId: detail.open && activeEntry && activeEntry.id }) };

  // Browser preview does not invent replacement illustrations. Real fetching is Android-native.
  window.createInspirationPreview = async function () {
    return {
      getStartup: () => '{"show":false}', nextStartup: () => '{"show":false}', cancelStartup: () => '{"ok":true}',
      getInspiration: () => JSON.stringify({today:window.StudyModel.today(),daily:null,items:[],total:0,online:false,fetching:false,drawing:false,lastFetchMessage:'联网图片、相册和分享请在Android APK中验证。',favorites:0,ready:0,cached:0,mediaBytes:0}),
      searchInspiration: () => JSON.stringify({today:window.StudyModel.today(),daily:null,items:[],total:0,online:false,fetching:false,drawing:false,favorites:0,ready:0,cached:0,mediaBytes:0}),
      getInspirationFilters: () => '{"themes":[],"languages":[]}',
      drawDaily: () => '{"error":"请在Android APP中抽取日签。"}',
      getInspirationEntry: () => '{"error":"尚无图片记录"}', favoriteInspiration: () => '{"error":"尚无图片记录"}',
      setInspirationOnline: () => '{"ok":true}', refreshInspiration: () => '{"ok":true}', cleanInspirationPending: () => '{"ok":true,"removed":0}',
      saveInspirationImage: () => '{"error":"请在Android APK中保存图片。"}', shareInspiration: () => '{"error":"请在Android APK中分享图片。"}'
    };
  };
})();
