(function () {
  var overlay, built = false;
  var STORE_KEY = 'jp_grammar_prefs';

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePrefs(patch) {
    var p = loadPrefs();
    for (var k in patch) p[k] = patch[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  }
  function isEnUi() {
    return document.body.classList.contains('lang-en');
  }

  function closeSearch() {
    var so = document.getElementById('search-overlay');
    if (so && !so.hidden) {
      so.hidden = true;
      document.body.classList.remove('search-open');
    }
  }

  function currentTheme() {
    var html = document.documentElement;
    return html.classList.contains('theme-dark') ? 'dark'
      : html.classList.contains('theme-light') ? 'light' : 'auto';
  }

  // The modal and the desktop top bar both render these three settings;
  // every change goes through here and repaints both.
  function sync() {
    var c = currentTheme();
    var hide = document.body.classList.contains('hide-ruby');
    var en = isEnUi();
    document.querySelectorAll('.js-theme-btn').forEach(function (b) {
      b.textContent = c === 'dark' ? '🌙' : c === 'light' ? '☀️' : '🌓';
      b.title = c === 'dark' ? '当前: 深色 (点击切浅色)' : c === 'light' ? '当前: 浅色 (点击切自动)' : '当前: 跟随系统 (点击切深色)';
    });
    document.querySelectorAll('.js-ruby-toggle').forEach(function (i) { i.checked = !hide; });
    document.querySelectorAll('.js-lang-btn').forEach(function (b) { b.textContent = en ? '中文' : 'EN'; });
  }

  function cycleTheme() {
    var next = { auto: 'dark', dark: 'light', light: 'auto' }[currentTheme()];
    var html = document.documentElement;
    html.classList.remove('theme-dark', 'theme-light');
    if (next === 'dark') html.classList.add('theme-dark');
    else if (next === 'light') html.classList.add('theme-light');
    try {
      if (next === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', next);
    } catch (e) {}
    sync();
    if (window.gaEvent) window.gaEvent('theme_toggle', { to: next });
  }

  function setRuby(show) {
    document.body.classList.toggle('hide-ruby', !show);
    savePrefs({ hideRuby: !show });
    sync();
    if (window.gaEvent) window.gaEvent('furigana_toggle', { visible: show });
  }

  function toggleLang() {
    var isEn = !isEnUi();
    document.body.classList.toggle('lang-en', isEn);
    savePrefs({ isEn: isEn });
    sync();
    // The home page's SPA script translates the active lesson's headings.
    document.dispatchEvent(new CustomEvent('jpnotes:lang', { detail: { isEn: isEn } }));
    if (window.gaEvent) window.gaEvent('language_toggle', { to: isEn ? 'en' : 'zh' });
  }

  function wireControls(root) {
    root.querySelectorAll('.js-theme-btn').forEach(function (b) { b.addEventListener('click', cycleTheme); });
    root.querySelectorAll('.js-ruby-toggle').forEach(function (i) {
      i.addEventListener('change', function () { setRuby(this.checked); });
    });
    root.querySelectorAll('.js-lang-btn').forEach(function (b) { b.addEventListener('click', toggleLang); });
    sync();
  }

  // Desktop only (CSS hides it at ≤768px, where the sidebar toolbar + modal
  // take over): one-click search / AI / theme / furigana / language, top right.
  function buildTopBar() {
    if (document.getElementById('top-controls')) return;
    var hasSearch = document.getElementById('search-btn');
    var hasAi = document.querySelector('article.lesson') && document.getElementById('ai-btn');
    var hasRuby = document.querySelector('.lesson, #content.home');
    var bar = document.createElement('div');
    bar.id = 'top-controls';
    bar.innerHTML =
      (hasSearch ? '<button type="button" class="tc-pill tc-icon" data-proxy="search-btn" aria-label="搜索 / Search" title="搜索 / Search ( / )">🔍</button>' : '') +
      (hasAi ? '<button type="button" class="tc-pill tc-icon" id="tc-ai" data-proxy="ai-btn" aria-label="问 AI / Ask AI" title="问 AI / Ask AI">🤖</button>' : '') +
      '<button type="button" class="tc-pill tc-icon js-theme-btn" aria-label="切换主题 / Toggle theme">🌓</button>' +
      (hasRuby ? '<label class="tc-pill"><input type="checkbox" class="js-ruby-toggle" checked> <span class="lang-zh">显示读音</span><span class="lang-en">Furigana</span></label>' : '') +
      '<button type="button" class="tc-pill tc-lang js-lang-btn">EN</button>';
    document.body.appendChild(bar);
    // Search and AI keep their single owner: forward the click to the sidebar button.
    bar.querySelectorAll('[data-proxy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = document.getElementById(b.getAttribute('data-proxy'));
        if (t) t.click();
      });
    });
    wireControls(bar);
  }

  function buildUI() {
    overlay = document.createElement('div');
    overlay.id = 'settings-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div id="settings-box" role="dialog" aria-modal="true" aria-label="设置 / Settings">' +
        '<div class="settings-head">' +
          '<h2><span class="lang-zh">设置</span><span class="lang-en">Settings</span></h2>' +
          '<p class="settings-lead"><span class="lang-zh">偏好保存在浏览器本地，不会上传到服务器。</span><span class="lang-en">Preferences are stored locally in your browser.</span></p>' +
        '</div>' +
        '<ul class="settings-list">' +
          '<li class="settings-row">' +
            '<div><div class="settings-label"><span class="lang-zh">主题</span><span class="lang-en">Theme</span></div>' +
            '<div class="settings-desc"><span class="lang-zh">自动 · 深色 · 浅色</span><span class="lang-en">Auto · dark · light</span></div></div>' +
            '<div class="settings-control"><button type="button" class="js-theme-btn" aria-label="切换主题 / Toggle theme">🌓</button></div>' +
          '</li>' +
          '<li class="settings-row">' +
            '<div><div class="settings-label"><span class="lang-zh">汉字注音</span><span class="lang-en">Furigana</span></div>' +
            '<div class="settings-desc"><span class="lang-zh">在日语例句上方显示读音</span><span class="lang-en">Show readings above kanji</span></div></div>' +
            '<div class="settings-control"><label><input type="checkbox" class="js-ruby-toggle" checked> <span class="lang-zh">显示</span><span class="lang-en">Show</span></label></div>' +
          '</li>' +
          '<li class="settings-row">' +
            '<div><div class="settings-label"><span class="lang-zh">界面语言</span><span class="lang-en">UI language</span></div>' +
            '<div class="settings-desc"><span class="lang-zh">中文 / English</span><span class="lang-en">Chinese / English</span></div></div>' +
            '<div class="settings-control"><button type="button" class="js-lang-btn">EN</button></div>' +
          '</li>' +
        '</ul>' +
        '<div class="settings-preview">' +
          '<div class="settings-preview-title"><span class="lang-zh">注音预览</span><span class="lang-en">Furigana preview</span></div>' +
          '<p><ruby>朝<rp>(</rp><rt>あさ</rt><rp>)</rp></ruby>起きて、<ruby>顔<rp>(</rp><rt>かお</rt><rp>)</rp></ruby>を<ruby>洗<rp>(</rp><rt>あら</rt><rp>)</rp></ruby>います。</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    wireControls(overlay);
    built = true;
  }

  function open() {
    closeSearch();
    if (!built) buildUI();
    overlay.hidden = false;
    document.body.classList.add('settings-open');
    if (window.gaEvent) window.gaEvent('settings_open', {});
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('settings-open');
  }

  window.jpnotesOpenSettings = open;
  window.jpnotesCloseSettings = close;

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay && !overlay.hidden) close();
  });

  function bindBtn() {
    document.querySelectorAll('#settings-btn, [data-open-settings]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        if (b.tagName === 'A') e.preventDefault();
        open();
      });
    });
  }

  function init() { bindBtn(); buildTopBar(); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
