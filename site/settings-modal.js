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

  // Themes: auto follows the system (paper by day, dark at night); 'light'
  // is the stored name for paper. White and sepia are light-theme tones.
  var THEMES = [
    ['auto', '自动', 'Auto'], ['white', '白', 'White'], ['light', '纸张', 'Paper'],
    ['sepia', '米黄', 'Sepia'], ['dark', '深色', 'Dark']
  ];
  function currentTheme() {
    var c = document.documentElement.classList;
    return c.contains('theme-dark') ? 'dark'
      : c.contains('tone-white') ? 'white'
      : c.contains('tone-sepia') ? 'sepia'
      : c.contains('theme-light') ? 'light' : 'auto';
  }
  function themeChoicesHtml() {
    return '<div class="theme-choices" role="radiogroup" aria-label="主题 / Theme">' + THEMES.map(function (t) {
      return '<button type="button" role="radio" class="theme-choice" data-theme="' + t[0] + '">' +
        '<span class="theme-swatch sw-' + t[0] + '" aria-hidden="true"></span>' +
        '<span class="lang-zh">' + t[1] + '</span><span class="lang-en">' + t[2] + '</span></button>';
    }).join('') + '</div>';
  }

  // The modal and the desktop top bar both render these three settings;
  // every change goes through here and repaints both.
  // Lucide line icons, the same set as the sidebar toolbar (assets/icons).
  var SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var THEME_ICONS = {
    dark: SVG + '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    light: SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
    auto: SVG + '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/></svg>'
  };

  function sync() {
    var c = currentTheme();
    var hide = document.body.classList.contains('hide-ruby');
    var en = isEnUi();
    document.querySelectorAll('.js-theme-btn').forEach(function (b) {
      b.innerHTML = THEME_ICONS[c === 'auto' || c === 'dark' ? c : 'light'];
      b.title = '主题 / Theme';
    });
    document.querySelectorAll('.theme-choice').forEach(function (b) {
      b.setAttribute('aria-checked', b.getAttribute('data-theme') === c ? 'true' : 'false');
    });
    document.querySelectorAll('.js-ruby-toggle').forEach(function (i) { i.checked = !hide; });
    document.querySelectorAll('.js-lang-btn').forEach(function (b) { b.textContent = en ? '中文' : 'EN'; });
  }

  function setTheme(next) {
    var c = document.documentElement.classList;
    c.remove('theme-dark', 'theme-light', 'tone-white', 'tone-sepia');
    if (next === 'dark') c.add('theme-dark');
    else if (next !== 'auto') c.add('theme-light');
    if (next === 'white' || next === 'sepia') c.add('tone-' + next);
    try {
      if (next === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', next);
    } catch (e) {}
    sync();
    document.dispatchEvent(new CustomEvent('jpnotes:theme', { detail: { theme: next } }));
    if (window.gaEvent) window.gaEvent('theme_toggle', { to: next });
  }

  // Top bar: the theme button opens a small menu of the five themes.
  function toggleThemeMenu(btn) {
    var menu = document.getElementById('theme-menu');
    if (menu) { menu.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    menu = document.createElement('div');
    menu.id = 'theme-menu';
    menu.innerHTML = themeChoicesHtml();
    btn.parentNode.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    wireChoices(menu);
    sync();
    setTimeout(function () {
      document.addEventListener('click', function off(e) {
        if (menu.contains(e.target) && !e.target.closest('.theme-choice')) return;
        if (document.getElementById('theme-menu')) { menu.remove(); btn.setAttribute('aria-expanded', 'false'); }
        document.removeEventListener('click', off);
      });
    }, 0);
  }

  function wireChoices(root) {
    root.querySelectorAll('.theme-choice').forEach(function (b) {
      b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme')); });
    });
  }

  function setRuby(show) {
    document.body.classList.toggle('hide-ruby', !show);
    savePrefs({ hideRuby: !show });
    sync();
    if (window.gaEvent) window.gaEvent('furigana_toggle', { visible: show });
  }

  function toggleLang() {
    var isEn = !isEnUi();
    savePrefs({ isEn: isEn });
    // Lesson pages carry one language each: switching goes to the other
    // language's copy (data-alt-xx).
    var to = isEn ? 'en' : 'zh';
    var alt = document.documentElement.getAttribute('data-alt-' + to);
    if (alt) {
      if (window.gaEvent) window.gaEvent('language_toggle', { to: to });
      location.href = alt;
      return;
    }
    document.body.classList.toggle('lang-en', isEn);
    sync();
    // The home page's SPA script translates the active lesson's headings.
    document.dispatchEvent(new CustomEvent('jpnotes:lang', { detail: { isEn: isEn } }));
    if (window.gaEvent) window.gaEvent('language_toggle', { to: isEn ? 'en' : 'zh' });
  }

  function wireControls(root) {
    root.querySelectorAll('.js-theme-btn').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); toggleThemeMenu(b); });
    });
    wireChoices(root);
    root.querySelectorAll('.js-ruby-toggle').forEach(function (i) {
      i.addEventListener('change', function () { setRuby(this.checked); });
    });
    root.querySelectorAll('.js-lang-btn').forEach(function (b) { b.addEventListener('click', toggleLang); });
    sync();
  }

  // Desktop only (CSS hides it at ≤768px, where the sidebar toolbar + modal
  // take over): one-click search / AI / theme / furigana / language, top right.
  // ─── Share ───
  // jpShare({ url, title, text, src, anchor }): the system share sheet on touch
  // devices, otherwise a small menu (copy link, X, Weibo, Facebook, LINE) under
  // `anchor`. Shared links carry utm_source=share so visits show up in GA.
  function track(n, p) { if (window.gaEvent) window.gaEvent(n, p); }
  function pageUrl() {
    var c = document.querySelector('link[rel="canonical"]');
    return c ? c.href : location.origin + location.pathname;
  }
  function closeShare() { var m = document.getElementById('share-menu'); if (m) m.remove(); }
  function jpShare(o) {
    o = o || {};
    var en = isEnUi(), base = o.url || pageUrl();
    var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'utm_source=share';
    var title = o.title || document.title, text = o.text || '';
    var src = o.src || 'page', page = location.pathname;
    if (navigator.share && window.matchMedia && matchMedia('(pointer: coarse)').matches) {
      track('share_open', { src: src, how: 'native', page: page });
      navigator.share({ title: title, text: text, url: url })
        .then(function () { track('share', { src: src, method: 'native', page: page }); })
        .catch(function () {});
      return;
    }
    if (document.getElementById('share-menu')) { closeShare(); return; }
    track('share_open', { src: src, how: 'menu', page: page });
    var msg = (text ? text + ' ' : '') + url, e = encodeURIComponent;
    var nets = [
      ['x', 'X', 'https://x.com/intent/post?text=' + e(text || title) + '&url=' + e(url)],
      ['weibo', '微博', 'https://service.weibo.com/share/share.php?url=' + e(url) + '&title=' + e(text || title)],
      ['facebook', 'Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + e(url)],
      ['line', 'LINE', 'https://social-plugins.line.me/lineit/share?url=' + e(url)]
    ];
    if (!en) nets = [nets[1], nets[0], nets[3], nets[2]];
    var m = document.createElement('div');
    m.id = 'share-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = '<button type="button" data-net="copy">🔗 ' + (en ? 'Copy link' : '复制链接') + '</button>' +
      nets.map(function (n) { return '<a href="' + n[2] + '" target="_blank" rel="noopener" data-net="' + n[0] + '">' + n[1] + '</a>'; }).join('');
    document.body.appendChild(m);
    var r = (o.anchor || document.body).getBoundingClientRect(), w = m.offsetWidth;
    m.style.top = Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 8) + 'px';
    m.style.left = Math.max(8, r.left + w <= window.innerWidth - 8 ? r.left : r.right - w) + 'px';
    m.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-net]');
      if (!b) return;
      var net = b.getAttribute('data-net');
      track('share', { src: src, method: net, page: page });
      if (net !== 'copy') { setTimeout(closeShare, 0); return; }
      var done = function () { b.textContent = '✓ ' + (en ? 'Copied' : '已复制'); b.classList.add('sm-ok'); setTimeout(closeShare, 900); };
      // Clipboard API, then the old execCommand route, then show the link to copy by hand.
      var legacy = function () {
        var ta = document.createElement('textarea'), ok = false;
        ta.value = msg; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch (x) {}
        ta.remove();
        if (ok) return done();
        b.outerHTML = '<input readonly value="' + msg.replace(/"/g, '&quot;') + '" style="font:inherit;font-size:.8rem;margin:.2rem;padding:.3rem">';
        var inp = m.querySelector('input'); inp.focus(); inp.select();
      };
      if (navigator.clipboard) navigator.clipboard.writeText(msg).then(done, legacy); else legacy();
    });
    setTimeout(function () {
      document.addEventListener('click', function off(ev) {
        if (!m.contains(ev.target)) { closeShare(); document.removeEventListener('click', off); }
      });
    }, 0);
  }
  window.jpShare = jpShare;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeShare(); });

  function buildTopBar() {
    if (document.getElementById('top-controls')) return;
    var hasSearch = document.getElementById('search-btn');
    // Any page that loads the AI panel (lessons, practice pages, and a general mode elsewhere).
    var hasAi = document.querySelector('script[src*="ai-assistant.js"]') && document.getElementById('ai-btn');
    var hasRuby = document.querySelector('.lesson, #content.home');
    var bar = document.createElement('div');
    bar.id = 'top-controls';
    bar.innerHTML =
      (hasSearch ? '<button type="button" class="tc-pill tc-icon" data-proxy="search-btn" aria-label="搜索 / Search" title="搜索 / Search ( / )">' + hasSearch.innerHTML + '</button>' : '') +
      (document.getElementById('share-btn') ? '<button type="button" class="tc-pill tc-icon js-share" aria-label="分享 / Share" title="分享 / Share">' + document.getElementById('share-btn').innerHTML + '</button>' : '') +
      (hasAi ? '<button type="button" class="tc-pill tc-icon" id="tc-ai" data-proxy="ai-btn" aria-label="问 AI / Ask AI" title="问 AI / Ask AI">' + document.getElementById('ai-btn').innerHTML + '</button>' : '') +
      '<button type="button" class="tc-pill tc-icon js-theme-btn" aria-label="主题 / Theme" aria-haspopup="true" aria-expanded="false"></button>' +
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
    var sb = bar.querySelector('.js-share');
    if (sb) sb.addEventListener('click', function (e) { e.stopPropagation(); jpShare({ src: 'top', anchor: sb }); });
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
          '<li class="settings-row settings-row-theme">' +
            '<div><div class="settings-label"><span class="lang-zh">主题</span><span class="lang-en">Theme</span></div>' +
            '<div class="settings-desc"><span class="lang-zh">自动：白天纸张、夜间深色，跟随系统</span><span class="lang-en">Auto: paper by day, dark at night, following your system</span></div>' +
            themeChoicesHtml() + '</div>' +
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

  function init() {
    bindBtn(); buildTopBar();
    var sb = document.getElementById('share-btn');
    if (sb) sb.addEventListener('click', function (e) { e.stopPropagation(); jpShare({ src: 'toolbar', anchor: sb }); });
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
