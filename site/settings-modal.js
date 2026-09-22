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

  function syncThemeIcon(btn) {
    var html = document.documentElement;
    var c = html.classList.contains('theme-dark') ? 'dark'
      : html.classList.contains('theme-light') ? 'light' : 'auto';
    btn.textContent = c === 'dark' ? '🌙' : c === 'light' ? '☀️' : '🌓';
    btn.title = c === 'dark' ? '当前: 深色 (点击切浅色)' : c === 'light' ? '当前: 浅色 (点击切自动)' : '当前: 跟随系统 (点击切深色)';
  }

  function wireControls() {
    var themeBtn = overlay.querySelector('#theme-btn');
    var rubyToggle = overlay.querySelector('#ruby-toggle');
    var langBtn = overlay.querySelector('#lang-btn');
    var prefs = loadPrefs();

    syncThemeIcon(themeBtn);
    themeBtn.addEventListener('click', function () {
      var html = document.documentElement;
      var cur = html.classList.contains('theme-dark') ? 'dark'
        : html.classList.contains('theme-light') ? 'light' : 'auto';
      var next = { auto: 'dark', dark: 'light', light: 'auto' }[cur];
      html.classList.remove('theme-dark', 'theme-light');
      if (next === 'dark') html.classList.add('theme-dark');
      else if (next === 'light') html.classList.add('theme-light');
      try {
        if (next === 'auto') localStorage.removeItem('theme');
        else localStorage.setItem('theme', next);
      } catch (e) {}
      syncThemeIcon(themeBtn);
      if (window.gaEvent) window.gaEvent('theme_toggle', { to: next });
    });

    rubyToggle.checked = !prefs.hideRuby && !document.body.classList.contains('hide-ruby');
    rubyToggle.addEventListener('change', function () {
      var hide = !this.checked;
      document.body.classList.toggle('hide-ruby', hide);
      savePrefs({ hideRuby: hide });
      if (window.gaEvent) window.gaEvent('furigana_toggle', { visible: !hide });
    });

    langBtn.textContent = isEnUi() ? '中文' : 'EN';
    langBtn.addEventListener('click', function () {
      var isEn = !isEnUi();
      document.body.classList.toggle('lang-en', isEn);
      langBtn.textContent = isEn ? '中文' : 'EN';
      savePrefs({ isEn: isEn });
      if (window.gaEvent) window.gaEvent('language_toggle', { to: isEn ? 'en' : 'zh' });
    });
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
            '<div class="settings-control"><button type="button" id="theme-btn" aria-label="切换主题 / Toggle theme">🌓</button></div>' +
          '</li>' +
          '<li class="settings-row">' +
            '<div><div class="settings-label"><span class="lang-zh">汉字注音</span><span class="lang-en">Furigana</span></div>' +
            '<div class="settings-desc"><span class="lang-zh">在日语例句上方显示读音</span><span class="lang-en">Show readings above kanji</span></div></div>' +
            '<div class="settings-control"><label><input type="checkbox" id="ruby-toggle" checked> <span class="lang-zh">显示</span><span class="lang-en">Show</span></label></div>' +
          '</li>' +
          '<li class="settings-row">' +
            '<div><div class="settings-label"><span class="lang-zh">界面语言</span><span class="lang-en">UI language</span></div>' +
            '<div class="settings-desc"><span class="lang-zh">中文 / English</span><span class="lang-en">Chinese / English</span></div></div>' +
            '<div class="settings-control"><button type="button" id="lang-btn">EN</button></div>' +
          '</li>' +
        '</ul>' +
        '<div class="settings-preview">' +
          '<div class="settings-preview-title"><span class="lang-zh">注音预览</span><span class="lang-en">Furigana preview</span></div>' +
          '<p><ruby>朝<rp>(</rp><rt>あさ</rt><rp>)</rp></ruby>起きて、<ruby>顔<rp>(</rp><rt>かお</rt><rp>)</rp></ruby>を<ruby>洗<rp>(</rp><rt>あら</rt><rp>)</rp></ruby>います。</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    wireControls();
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

  if (document.readyState !== 'loading') bindBtn();
  else document.addEventListener('DOMContentLoaded', bindBtn);
})();
