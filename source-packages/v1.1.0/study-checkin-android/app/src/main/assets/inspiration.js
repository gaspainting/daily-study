/* All production card selection and storage belong to Native. This file only presents them. */
(function () {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const image = card => card.previewImage || 'https://study.local/media/' + card.imageKey;
  const detail = document.getElementById('inspiration-detail'), splash = document.getElementById('startup-screen');
  let bridge, refresh, tell, scope = 'daily', offset = 0, data = null, activeEntry = null;
  let initialized = false, startupEntry = null, startupShown = false, splashTimer, splashStarted = 0, splashLoadingTimeout;
  let waitingStartup = false, startupPoll, startupNetworkTimeout;
  const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
  function call(name, ...args) { const r = decode(bridge[name](...args)); if (r && r.error) throw new Error(r.error); return r; }
  function attempt(fn) { try { return fn(); } catch (e) { tell(e.message || '图文暂时无法打开'); return false; } }
  function time(at) { const d = new Date(at); return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
  function repeat(entry) { return entry.imageRepeat || entry.textRepeat ? '<span class="card-note">含曾展示内容</span>' : ''; }
  function copy(card, full) { return '<p class="card-text' + (full ? ' full' : '') + '" lang="' + esc(card.language) + '">' + esc(card.text) + '</p>' + (card.translation ? '<div class="card-translation"><span class="eyebrow">中文释义</span><p>' + esc(card.translation) + '</p></div>' : ''); }
  function controls(entry) { const c = entry.card; return '<div class="card-actions"><button data-inspire="favorite" data-id="' + esc(entry.id) + '" aria-pressed="' + c.favorite + '">' + icon('heart') + (c.favorite ? '已收藏' : '收藏') + '</button><button data-inspire="save" data-id="' + esc(entry.id) + '">' + icon('download') + '保存图片</button><button data-inspire="share" data-id="' + esc(entry.id) + '">' + icon('share') + '分享</button></div>'; }
  function source(card) {
    return '<details class="card-source"><summary>图文来源与说明</summary><p>文字：' + esc(card.textSource) + (card.textAuthor ? ' · ' + esc(card.textAuthor) : '') + '</p>' + (card.textPage ? '<p class="source-url">' + esc(card.textPage) + '</p>' : '') + '<p>图片：' + esc(card.imageSource) + (card.imageAuthor ? ' · ' + esc(card.imageAuthor) : '') + '</p><p>' + esc(card.imageTitle) + '</p>' + (card.imagePage ? '<p class="source-url">' + esc(card.imagePage) + '</p>' : '') + '<p>' + esc(card.imageLicense) + '</p>' + (card.translationSource ? '<p>释义：' + esc(card.translationSource) + '</p>' : '') + (card.ai ? '<p>包含AI辅助制作的原创内容。</p>' : '') + '<p>图文可以独立搭配；主题标签作内容提示。</p></details>';
  }
  function mainCard(entry) { const c = entry.card; return '<article class="daily-card"><div class="card-heading"><span>' + esc(entry.date.replaceAll('-', '.')) + '</span><span>' + esc(c.theme) + '</span></div><button class="card-art-button" data-inspire="detail" data-id="' + esc(entry.id) + '" aria-label="查看完整图文"><img class="card-art" src="' + esc(image(c)) + '" alt="' + esc(c.imageTitle || c.theme + '插图') + '"></button>' + copy(c, false) + '<button class="text-button card-read" data-inspire="detail" data-id="' + esc(entry.id) + '">阅读全文与释义 ' + icon('next') + '</button><div class="card-meta">' + ('联网图片已保存在本地') + ' · 当天固定 ' + repeat(entry) + '</div>' + controls(entry) + '</article>'; }
  function historyItem(entry) { const c = entry.card; return '<button class="inspiration-history-item" data-inspire="detail" data-id="' + esc(entry.id) + '"><img src="' + esc(image(c)) + '" alt="' + esc(c.imageTitle || '图文插图') + '" loading="lazy"><span class="history-copy"><span class="history-date">' + esc(entry.date.replaceAll('-', '.')) + (entry.kind === 'startup' ? ' · ' + time(entry.at) + ' 开屏' : ' 日签') + '</span><span class="history-text">' + esc(c.text) + '</span><span class="history-theme">' + esc(c.theme) + (c.favorite ? ' · 已收藏' : '') + (entry.imageRepeat || entry.textRepeat ? ' · 曾展示' : '') + '</span></span>' + icon('next') + '</button>'; }
  function load() { data = call('getInspiration', scope, offset, 20); return data; }
  function view() {
    try {
      load();
      let html = '<div class="page-intro inspiration-intro"><div class="eyebrow">A LITTLE EACH DAY / 每日激励</div><h1>留一句话给今天</h1><p>什么心情都可以。抽到的这一张，今天留在这里。</p></div><div class="inspiration-tabs" role="group" aria-label="图文分类">' + [['daily', '今日日签'], ['history', '日签历史'], ['favorites', '收藏'], ['startup', '开屏回看']].map(([s, text]) => '<button data-inspire="scope" data-scope="' + s + '" aria-pressed="' + (scope === s) + '">' + text + '</button>').join('') + '</div>';
      if (scope === 'daily') {
        html += data.daily ? mainCard(data.daily) : '<div class="undrawn-card"><span class="eyebrow">' + esc(data.today.replaceAll('-', '.')) + ' / 尚未抽取</span><svg class="undrawn-art" viewBox="0 0 160 110" aria-hidden="true"><path d="M22 87h116M40 85V29h80v56M46 76l28-28 22 18 17-15"/><circle cx="99" cy="40" r="6"/><path d="M19 21h13m-6-6v12m112-9 3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/></svg><h2>今天，会遇见什么？</h2><p>一幅插图，一段文字。每天一次，可一直回看。</p><button class="primary draw-button" data-inspire="draw"' + (data.drawing ? ' disabled' : '') + '>' + (data.drawing ? '正在获取图片…' : '抽取今日日签') + ' ' + icon('next') + '</button></div>';
        html += (data.drawMessage ? '<p class="inspiration-footnote" role="status">' + esc(data.drawMessage) + '</p>' : '') + '<p class="inspiration-footnote">以手机日期为一天。抽取成功后固定保存；断网可以使用已准备内容。图和文字分别尽量避开历史重复。</p>';
      } else {
        const items = data.items || [];
        html += '<div class="history-count">' + ({ history: '每日留存', favorites: '收藏的图文', startup: '每次开屏' }[scope]) + ' · ' + data.total + ' 条</div>' + (items.length ? '<div class="inspiration-history">' + items.map(historyItem).join('') + '</div>' : '<div class="empty">' + (scope === 'favorites' ? '喜欢的图文可以收藏，之后在这里回看。' : '还没有这类记录。') + '</div>');
        if (data.total > 20) html += '<div class="history-pagination"><button data-inspire="page" data-offset="' + Math.max(0, offset - 20) + '"' + (offset === 0 ? ' disabled' : '') + '>上一页</button><span>' + (Math.floor(offset / 20) + 1) + ' / ' + Math.ceil(data.total / 20) + '</span><button data-inspire="page" data-offset="' + (offset + 20) + '"' + (offset + 20 >= data.total ? ' disabled' : '') + '>下一页</button></div>';
      }
      html += '<div class="section inspiration-preparation"><div class="section-heading"><h2>把下一张准备好</h2><span class="section-number">MATERIALS</span></div><div class="settings-row"><div><h3>联网准备素材</h3><p class="hint">免费公开来源；学习记录保存在手机。</p></div><label class="switch" aria-label="联网准备素材"><input id="inspiration-online" type="checkbox"' + (data.online ? ' checked' : '') + '><span></span></label></div><p class="hint" id="inspiration-fetch-status" role="status">' + esc(data.fetching ? '正在联网准备图文，可以继续使用APP…' : data.lastFetchMessage || '优先联网获取真实照片和公开艺术图片；已取得图片保留在本地。') + '</p><div class="preparation-actions"><button data-inspire="refresh"' + (!data.online || data.fetching ? ' disabled' : '') + '>' + (data.fetching ? '正在准备…' : '准备新图文') + '</button><button class="text-button" data-inspire="clean"' + (data.fetching ? ' disabled' : '') + '>清理未使用素材</button></div><p class="inline-form-note">' + (data.mediaBytes / 1048576).toFixed(1) + ' MB 图文图片 · ' + data.favorites + ' 张收藏。清理会保留日签、开屏历史、收藏和去重记录。</p></div>';
      return html;
    } catch (e) { return '<div class="page-intro"><h1>每日激励</h1><p class="notice">' + esc(e.message) + '</p><p class="hint">学习记录仍可继续使用。可从设置导入完整图文备份恢复。</p><button data-inspire="retry">重新读取</button></div>'; }
  }
  function openEntry(id) { activeEntry = call('getInspirationEntry', id); renderDetail(); if (!detail.open) detail.showModal(); }
  function renderDetail() { if (!activeEntry) return; const e = activeEntry, c = e.card; detail.innerHTML = '<div class="sheet-heading"><div><span class="eyebrow">' + (e.kind === 'daily' ? '日签' : '开屏回看') + ' / ' + esc(e.date.replaceAll('-', '.')) + '</span><h2 id="inspiration-detail-title">' + esc(c.theme) + '</h2></div><button class="icon-button" data-inspire="close" aria-label="关闭完整图文">×</button></div><img class="card-art detail-art" src="' + esc(image(c)) + '" alt="' + esc(c.imageTitle || '插图') + '">' + copy(c, true) + '<div class="card-meta">' + ('联网图片，本地留存') + ' ' + repeat(e) + '</div>' + controls(e) + source(c); }
  function dismissSplash() { clearInterval(splashTimer); clearInterval(startupPoll); clearTimeout(startupNetworkTimeout); clearTimeout(splashLoadingTimeout); waitingStartup = false; if (bridge && bridge.cancelStartup) decode(bridge.cancelStartup()); splash.hidden = true; document.querySelector('.app-shell').inert = false; const main = document.getElementById('app'); if (main) main.focus({ preventScroll: true }); }
  function beginCountdown() { if (splashStarted || splash.hidden) return; clearTimeout(splashLoadingTimeout); splashStarted = performance.now(); splash.querySelector('.startup-content').classList.add('ready'); const tick = () => { const seconds = Math.max(0, Math.ceil((5000 - (performance.now() - splashStarted)) / 1000)); const count = document.getElementById('startup-countdown'); if (count) count.textContent = seconds + '秒'; if (seconds <= 0) dismissSplash(); }; tick(); splashTimer = setInterval(tick, 100); }
  function showStartup(entry) { clearInterval(startupPoll); clearTimeout(startupNetworkTimeout); waitingStartup = false; startupEntry = entry; startupShown = true; splashStarted = 0; const c = entry.card; const excerpt = c.text.length > 100 ? c.text.slice(0, 100) + '…' : c.text, translation = c.translation.length > 75 ? c.translation.slice(0, 75) + '…' : c.translation; const shortened = excerpt !== c.text || translation !== c.translation;
    splash.innerHTML = '<div class="startup-top"><span class="brand-mark">日</span><button id="skip-startup" data-inspire="skip">跳过 <span id="startup-countdown">5秒</span></button></div><div class="startup-content"><span class="eyebrow">留一点时间，也留一点余地</span><img id="startup-image" src="' + esc(image(c)) + '" alt="' + esc(c.imageTitle || '开屏插图') + '"><p class="startup-text" lang="' + esc(c.language) + '">' + esc(excerpt) + '</p>' + (translation ? '<p class="startup-translation">' + esc(translation) + '</p>' : '') + '<span class="startup-caption">' + esc(c.theme) + (shortened ? ' · 节选，全文保存在开屏回看' : ' · 已保存在开屏回看') + '</span></div><div class="startup-bottom"><span>每日学习</span><span>今天的心情，也有位置</span></div>';
    splash.hidden = false; document.querySelector('.app-shell').inert = true; document.getElementById('skip-startup').focus({ preventScroll: true });
    const img = document.getElementById('startup-image'); img.addEventListener('load', beginCountdown, { once: true }); img.addEventListener('error', () => { img.hidden = true; beginCountdown(); }, { once: true }); if (img.complete) beginCountdown(); else splashLoadingTimeout = setTimeout(beginCountdown, 1500);
  }
  function pollStartup() { if (!waitingStartup) return; attempt(() => { const next = call('nextStartup'); if (next.show && next.entry) showStartup(next.entry); else if (!next.waiting) dismissSplash(); }); }
  function showStartupWaiting() { waitingStartup = true; splash.innerHTML = '<div class="startup-top"><span class="brand-mark">日</span><button id="skip-startup" data-inspire="skip">跳过</button></div><div class="startup-content ready"><span class="eyebrow">每日激励 / 联网图片</span><h2 class="startup-wait-title">正在获取图文</h2><p class="hint startup-wait-copy">首次使用还没有图片缓存。取得完整图片后展示5秒，也可以立即进入APP。</p></div><div class="startup-bottom"><span>每日学习</span><span>图片未取得时保留抽签机会</span></div>'; splash.hidden = false; document.querySelector('.app-shell').inert = true; document.getElementById('skip-startup').focus({ preventScroll: true }); startupPoll = setInterval(pollStartup, 350); startupNetworkTimeout = setTimeout(() => { if (waitingStartup) { dismissSplash(); tell('图片尚未就绪，已进入APP；可稍后联网抽签。'); } }, 8000); }
  function init(adapter, rerender, notify, showOnInit = true) { bridge = adapter; refresh = rerender; tell = notify; if (initialized) return; initialized = true; if (showOnInit) attempt(() => { const result = call('getStartup'); if (result.waiting) showStartupWaiting(); else if (result.show && result.entry) showStartup(result.entry); }); }
  document.addEventListener('click', event => { const button = event.target.closest('[data-inspire]'); if (!button || button.disabled || !bridge) return;
    attempt(() => { const action = button.dataset.inspire, id = button.dataset.id;
      if (action === 'skip') return dismissSplash();
      if (action === 'scope') { scope = button.dataset.scope; offset = 0; refresh(); return; }
      if (action === 'page') { offset = Number(button.dataset.offset); refresh(); window.scrollTo(0, 0); return; }
      if (action === 'draw') { button.disabled = true; button.textContent = '正在抽取…'; try { const entry = call('drawDaily'); refresh(); if (entry.pending) tell('正在联网获取图片，成功后固定为今日日签；可以继续使用APP。'); else openEntry(entry.id); } finally { if (button.isConnected) { button.disabled = false; button.textContent = '抽取今日日签'; } } return; }
      if (action === 'detail') return openEntry(id);
      if (action === 'close') { detail.close(); return; }
      if (action === 'favorite') { const e = call('getInspirationEntry', id); call('favoriteInspiration', id, !e.card.favorite); if (activeEntry && activeEntry.id === id) { activeEntry = call('getInspirationEntry', id); renderDetail(); } refresh(); tell(e.card.favorite ? '已取消收藏，历史仍保留。' : '已收藏，离线也可以回看。'); return; }
      if (action === 'save' || action === 'share') { call(action === 'save' ? 'saveInspirationImage' : 'shareInspiration', id); tell('正在生成完整图文；长文可能分成多张图片。'); return; }
      if (action === 'refresh') { call('refreshInspiration'); refresh(); return; }
      if (action === 'clean') { if (!window.confirm('清理尚未展示的联网素材？日签、开屏历史、收藏和去重记录都会保留。')) return; const r = call('cleanInspirationPending'); refresh(); tell('已清理 ' + r.removed + ' 个未使用图片文件。'); return; }
      if (action === 'retry') refresh();
    });
  });
  document.addEventListener('change', event => { if (event.target.id === 'inspiration-online' && bridge) attempt(() => { call('setInspirationOnline', event.target.checked); refresh(); tell(event.target.checked ? '已开启联网素材，可准备新的图文。' : '已关闭联网准备，继续使用本地内容。'); }); });
  detail.addEventListener('click', event => { if (event.target === detail) { const box = detail.getBoundingClientRect(); if (event.clientY < box.top || event.clientY > box.bottom) detail.close(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !splash.hidden) dismissSplash(); });
  window.onInspirationChanged = () => { if (waitingStartup) pollStartup(); if (refresh) refresh(); };
  setInterval(() => { if (bridge && data && window.StudyModel.today() !== data.today && refresh) refresh(); }, 15000);
  window.InspirationUI = { init, view, background: () => { if (!splash.hidden) dismissSplash(); }, back: () => { if (!splash.hidden) { dismissSplash(); return true; } if (detail.open) { detail.close(); return true; } return false; }, restored: () => { if (detail.open) detail.close(); activeEntry = null; offset = 0; }, snapshot: () => ({ scope, offset, startupShown, startupId: startupEntry && startupEntry.id, splashVisible: !splash.hidden, detailId: detail.open && activeEntry && activeEntry.id }) };

  // Browser preview does not invent replacement illustrations. Real fetching is Android-native.
  window.createInspirationPreview = async function () {
    return {
      getStartup: () => '{"show":false}', nextStartup: () => '{"show":false}', cancelStartup: () => '{"ok":true}',
      getInspiration: () => JSON.stringify({today:window.StudyModel.today(),daily:null,items:[],total:0,online:false,fetching:false,drawing:false,lastFetchMessage:'联网图片、相册和分享请在Android APK中验证。',favorites:0,ready:0,cached:0,mediaBytes:0}),
      drawDaily: () => '{"error":"浏览器预览不生成替代插图，请在APK联网抽取真实图文。"}',
      getInspirationEntry: () => '{"error":"尚无图片记录"}', favoriteInspiration: () => '{"error":"尚无图片记录"}',
      setInspirationOnline: () => '{"ok":true}', refreshInspiration: () => '{"ok":true}', cleanInspirationPending: () => '{"ok":true,"removed":0}',
      saveInspirationImage: () => '{"error":"请在Android APK中保存图片。"}', shareInspiration: () => '{"error":"请在Android APK中分享图片。"}'
    };
  };
})();
