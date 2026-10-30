const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Marked } = require("marked");
const sharp = require("sharp");
const KuroshiroMod = require("kuroshiro");
const Kuroshiro = KuroshiroMod.default || KuroshiroMod;
const KuromojiMod = require("kuroshiro-analyzer-kuromoji");
const KuromojiAnalyzer = KuromojiMod.default || KuromojiMod;

// ─── Config ───
const GRAMMAR_DIRS = [
  { dir: "grammar/N5", label: "N5" },
  { dir: "grammar/N4", label: "N4" },
  { dir: "grammar/N3", label: "N3" },
  { dir: "grammar/N2", label: "N2" },
  { dir: "grammar/N1", label: "N1" },
  // Standalone topic pages (A vs B comparisons, exam guides). Served at the
  // site root like lessons (/wa-vs-ga/), with a hub at /guides/. Not a JLPT
  // level: build-anki.js only reads grammar/N*, so no flashcards come from here.
  { dir: "grammar/guides", label: "guides" },
];
// Display names for non-level groups (sidebar header, breadcrumb, hub page).
const GROUP_NAMES = { guides: { zh: "专题", en: "Guides" } };
const groupName = (label, lang) => (GROUP_NAMES[label] ? GROUP_NAMES[label][lang] : label);
// Hand-written per-page <title>s (and optional descriptions) — see seo-titles.js.
const SEO_TITLES = require("./seo-titles");
const OUT = "dist/index.html";
const SITE = "https://jpnotes.dev/";
// Derived from SITE — change SITE in one place to migrate domains.
const SITE_PATH = new URL(SITE).pathname;             // "/japanese-grammar/" or "/"
const SITE_HOST = SITE.replace(/^https?:\/\//, "").replace(/\/$/, ""); // "ralphbupt.github.io/japanese-grammar" or "jpnotes.dev"
// IndexNow key — proves domain ownership to Bing/Yandex/etc. MUST stay stable
// (changing it breaks verification). Kept in sync with indexnow.mjs (CI ping).
const INDEXNOW_KEY = "b5c13368abbfcdaf25ed104808caeca9";

// Conservative CSS minifier for the inline stylesheet: drops comments and
// collapses whitespace around { } ; , — never touches ':' or '>' (descendant
// selectors like ".a :not(.b)" depend on that space).
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

// Giscus comments — backed by this repo's GitHub Discussions. Replaces
// Disqus: no third-party cookies, no ads, and comments are stored in your own
// repo. giscus.app/client.js is only fetched once the comments section comes
// within ~800px of the viewport, so readers who never scroll that far make no
// third-party connection at all.
const GISCUS_ATTRS = {
  repo: "Ralphbupt/japanese-grammar",
  "repo-id": "R_kgDOR7OzbA",
  category: "Comments",
  "category-id": "DIC_kwDOR7OzbM4C9me3",
  mapping: "pathname",
  strict: "0",
  "reactions-enabled": "1",
  "emit-metadata": "0",
  "input-position": "top",
  lang: "zh-CN",
  loading: "lazy",
};
const GISCUS_SCRIPT = `<script>
(function() {
  var sec = document.currentScript.parentNode;
  // Match the site theme (settings → 主题), not just the OS: the paper and
  // sepia tones have their own giscus themes, served from this site.
  function giscusTheme() {
    var c = document.documentElement.classList;
    var dark = c.contains('theme-dark') ||
      (!c.contains('theme-light') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) return 'transparent_dark';
    if (c.contains('tone-white')) return 'light';
    return 'https://jpnotes.dev/giscus-' + (c.contains('tone-sepia') ? 'sepia' : 'paper') + '.css';
  }
  function retheme() {
    var f = sec.querySelector('iframe.giscus-frame');
    if (f) f.contentWindow.postMessage({ giscus: { setConfig: { theme: giscusTheme() } } }, 'https://giscus.app');
  }
  document.addEventListener('jpnotes:theme', retheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  function load() {
    var s = document.createElement('script');
    s.src = 'https://giscus.app/client.js';
    s.crossOrigin = 'anonymous';
    s.async = true;
    var a = ${JSON.stringify(GISCUS_ATTRS)};
    a.theme = giscusTheme();
    // The /zh/ copy of a page joins the thread of the bilingual page
    // (giscus' pathname term is the path without its leading slash).
    if (location.pathname.indexOf('/zh/') === 0) { a.mapping = 'specific'; a.term = location.pathname.slice(4); }
    for (var k in a) s.setAttribute('data-' + k, a[k]);
    sec.appendChild(s);
  }
  if (!('IntersectionObserver' in window)) return load();
  var io = new IntersectionObserver(function(es) {
    if (es[0].isIntersecting) { io.disconnect(); load(); }
  }, { rootMargin: '800px 0px' });
  io.observe(sec);
})();
</script>`;

// AI tutor side panel (问 AI / Ask AI) — reader-supplied API key, browser
// calls the provider directly. Source lives in site/ai-assistant.{js,css};
// the build prepends the CSS to the JS (as an injected <style>), so its ~16 KB
// ships once in the cached script instead of inline on every page. Loaded
// with defer on lesson pages only (the panel needs an article.lesson).
const AI_JS_SRC = fs.readFileSync(path.join(__dirname, "site", "ai-assistant.js"), "utf-8");
const AI_CSS = fs.readFileSync(path.join(__dirname, "site", "ai-assistant.css"), "utf-8");
const AI_JS_BUNDLE = `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(minifyCss(AI_CSS))};document.head.appendChild(s);})();\n` + AI_JS_SRC;
const AI_JS_HASH = require("crypto").createHash("md5").update(AI_JS_BUNDLE).digest("hex").slice(0, 8);
const AI_SCRIPT = `<script src="${SITE_PATH}ai-assistant.js?v=${AI_JS_HASH}" defer></script>`;  // ?v= busts browser caches on every change
const QUIZ_JS_SRC = fs.readFileSync(path.join(__dirname, "site", "quiz.js"), "utf-8");
const QUIZ_JS_HASH = require("crypto").createHash("md5").update(QUIZ_JS_SRC).digest("hex").slice(0, 8);
const QUIZ_CSS = fs.readFileSync(path.join(__dirname, "site", "quiz.css"), "utf-8");
const FEEDBACK_JS_SRC = fs.readFileSync(path.join(__dirname, "site", "feedback.js"), "utf-8");
const FEEDBACK_JS_HASH = require("crypto").createHash("md5").update(FEEDBACK_JS_SRC).digest("hex").slice(0, 8);
// Practice / mock test / flashcard pages; QUIZ_PUBLIC and QUIZ_LINKS are set in build-quiz.js.
const { buildQuiz, loadLevel: loadQuizLevel, LEVELS: QUIZ_LEVELS, TYPES: QUIZ_TYPES, MOCK: QUIZ_MOCK, QUIZ_PUBLIC, QUIZ_LINKS, AUDIO_REQUESTS: QUIZ_AUDIO_REQUESTS, ABOVE_LEVEL, aboveLevel, CK_IMG_DIR: QUIZ_CK_IMG_DIR } = require("./build-quiz");
const SETTINGS_JS_HASH = require("crypto").createHash("md5").update(fs.readFileSync(path.join(__dirname, "site", "settings-modal.js"))).digest("hex").slice(0, 8);
const SETTINGS_SCRIPT = `<script src="${SITE_PATH}settings-modal.js?v=${SETTINGS_JS_HASH}" defer></script>`;
// Content-Security-Policy connect-src allowlist. This is the technical
// guarantee behind the "your key never leaves your browser except to the
// provider you picked" promise: the browser itself refuses fetch/XHR/beacon
// to any origin not listed here, even if a script on the page were compromised.
// Provider hosts are parsed from site/ai-assistant.js so the two stay in sync;
// localhost/127.0.0.1 on any port covers Ollama, LM Studio and local relays.
const AI_PROVIDER_HOSTS = [...new Set(
  [...AI_JS_SRC.matchAll(/(?:base|altBase): '(https?:\/\/[^'/]+)/g)]
    .map(m => m[1]).filter(h => !/localhost|127\.0\.0\.1/.test(h))
)];
// The rest of the policy: scripts, styles, images, audio, frames only from
// this site (plus giscus for comments); no plugins, no <base> or form tricks.
// Inline scripts stay allowed — the pages are built with many of them — but a
// script or image from any other host is refused, so an injected tag can't
// load code or leak data (an <img> beacon) elsewhere.
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://giscus.app; style-src 'self' 'unsafe-inline' https://giscus.app; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; frame-src https://giscus.app; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com ${AI_PROVIDER_HOSTS.join(" ")} http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*">`;
// Copies of the site (someone rebuilding the repo on their own domain): the
// host is checked against jpnotes.dev itself — not SITE, which a copy changes —
// and a copy gets a banner pointing to the original, a canonical link back to
// it and noindex. Local and LAN previews are left alone.
const CLONE_GUARD = `<script>(function(){var h=location.hostname;if(/(^|\\.)jpnotes\\.dev$/.test(h)||/^(localhost|127\\.0\\.0\\.1|\\[::1\\]|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)|\\.(local|localhost|test)$/.test(h)||location.protocol==='file:')return;var u='https://jpnotes.dev'+location.pathname;var c=document.querySelector('link[rel=canonical]');if(c)c.href=u;else{c=document.createElement('link');c.rel='canonical';c.href=u;document.head.appendChild(c);}var r=document.createElement('meta');r.name='robots';r.content='noindex';document.head.appendChild(r);document.addEventListener('DOMContentLoaded',function(){var zh=/^\\/zh\\//.test(location.pathname),d=document.createElement('div');d.setAttribute('style','position:sticky;top:0;z-index:9999;padding:.55rem 1rem;background:#e94560;color:#fff;font:14px/1.5 sans-serif;text-align:center');d.innerHTML=(zh?'这是 jpnotes.dev 的副本，内容可能已过时。最新版：':'This is a copy of jpnotes.dev and may be out of date. The original: ')+'<a style="color:#fff;font-weight:700" href="'+u+'">jpnotes.dev'+location.pathname+'</a>';document.body.insertBefore(d,document.body.firstChild);});})();</script>`;

// Theme init script — runs synchronously in <head> before CSS evaluates,
// so the saved theme class is on <html> before paint (no flash of wrong theme).
// Default (no class) follows @media (prefers-color-scheme: dark).
const THEME_INIT_SCRIPT = `<script>
(function() {
  try {
    // 'light' is the paper theme; white and sepia are light themes with a tone.
    var t = localStorage.getItem('theme'), c = document.documentElement.classList;
    if (t === 'dark') c.add('theme-dark');
    else if (t === 'light' || t === 'white' || t === 'sepia') c.add('theme-light');
    if (t === 'white' || t === 'sepia') c.add('tone-' + t);
  } catch (e) {}
})();
</script>`;

// Theme toggle button + click handler. Three-state cycle:
// auto (no class, follows system) → dark → light → auto.
const THEME_TOGGLE_HTML = `<div id="theme-toggle"><button id="theme-btn" aria-label="切换主题 / Toggle theme">🌓</button></div>`;
const THEME_TOGGLE_JS = `(function(){
  var btn = document.getElementById('theme-btn');
  if (!btn) return;
  var html = document.documentElement;
  function current() {
    if (html.classList.contains('theme-dark')) return 'dark';
    if (html.classList.contains('theme-light')) return 'light';
    return 'auto';
  }
  function paintIcon() {
    var c = current();
    btn.textContent = c === 'dark' ? '🌙' : c === 'light' ? '☀️' : '🌓';
    btn.title = c === 'dark' ? '当前: 深色 (点击切浅色)' : c === 'light' ? '当前: 浅色 (点击切自动)' : '当前: 跟随系统 (点击切深色)';
  }
  paintIcon();
  btn.addEventListener('click', function() {
    var next = { auto: 'dark', dark: 'light', light: 'auto' }[current()];
    html.classList.remove('theme-dark', 'theme-light');
    if (next === 'dark') html.classList.add('theme-dark');
    else if (next === 'light') html.classList.add('theme-light');
    try {
      if (next === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', next);
    } catch (e) {}
    paintIcon();
    if (window.gaEvent) window.gaEvent('theme_toggle', { to: next });
  });
})();`;

// Language preference (zh/en) — applies the saved isEn pref and wires the
// EN/中 toggle button. Shared by lesson, level-overview and about pages so a
// language choice persists across every page. Stores under the same
// 'jp_grammar_prefs' key the homepage SPA uses.
const LANG_PREF_JS = `(function(){
  var langBtn = document.getElementById('lang-btn');
  var STORE_KEY = 'jp_grammar_prefs';
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) { return {}; } }
  function savePrefs(patch) { var p = loadPrefs(); for (var k in patch) p[k] = patch[k]; localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
  var prefs = loadPrefs();
  var isEn = ('isEn' in prefs) ? prefs.isEn : !/^zh/i.test(navigator.language || '');
  if (isEn) document.body.classList.add('lang-en');
  if (langBtn) {
    langBtn.textContent = isEn ? '中文' : 'EN';
    langBtn.addEventListener('click', function(){
      isEn = !isEn;
      document.body.classList.toggle('lang-en', isEn);
      langBtn.textContent = isEn ? '中文' : 'EN';
      savePrefs({ isEn: isEn });
      if (window.gaEvent) window.gaEvent('language_toggle', { to: isEn ? 'en' : 'zh' });
    });
  }
})();`;

// Apply saved furigana + language prefs without toggle UI (non-settings pages).
const APP_PREFS_JS = `(function(){
  var STORE_KEY = 'jp_grammar_prefs';
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) { return {}; } }
  var prefs = loadPrefs();
  if (prefs.hideRuby) document.body.classList.add('hide-ruby');
  var forced = document.documentElement.getAttribute('data-force-lang');  // /zh/ pages
  var isEn = forced ? forced === 'en' : ('isEn' in prefs) ? prefs.isEn : !/^zh/i.test(navigator.language || '');
  if (isEn) document.body.classList.add('lang-en');
})();`;

// <head> of single-language pages: a reader whose language is another one
// (saved preference, or a zh browser with none saved landing on the root
// English page) goes to that language's copy before anything paints. Only the
// root page follows the browser language, so a /zh/ link always shows
// Chinese. The language button (settings-modal.js) saves the choice and goes
// to the other copy.
const LANG_REDIRECT_JS = `(function(){
  var html = document.documentElement, page = html.getAttribute('data-force-lang');
  var prefs; try { prefs = JSON.parse(localStorage.getItem('jp_grammar_prefs')) || {}; } catch(e) { prefs = {}; }
  var want = ('isEn' in prefs) ? (prefs.isEn ? 'en' : 'zh')
    : (page === 'en' && /^zh/i.test(navigator.language || '')) ? 'zh' : page;
  var alt = want !== page && html.getAttribute('data-alt-' + want);
  if (alt) location.replace(alt + location.search + location.hash);   // keep ?utm_… for GA
})();`;

const RUBY_PREF_JS = `(function(){
  var rubyToggle = document.getElementById('ruby-toggle');
  if (!rubyToggle) return;
  var STORE_KEY = 'jp_grammar_prefs';
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) { return {}; } }
  function savePrefs(patch) { var p = loadPrefs(); for (var k in patch) p[k] = patch[k]; localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
  var prefs = loadPrefs();
  if (prefs.hideRuby) { rubyToggle.checked = false; document.body.classList.add('hide-ruby'); }
  rubyToggle.addEventListener('change', function(){
    var hide = !this.checked;
    document.body.classList.toggle('hide-ruby', hide);
    savePrefs({ hideRuby: hide });
    if (window.gaEvent) window.gaEvent('furigana_toggle', { visible: !hide });
  });
})();`;

function loadIcon(file) {
  return fs.readFileSync(path.join(__dirname, "assets/icons", file), "utf-8")
    .replace(/\s*class="[^"]*"/g, "")
    .replace(/\s*width="24"/g, "")
    .replace(/\s*height="24"/g, "");
}

// TTS for Japanese example sentences: adds a 🔊 button to every <li> that has
// a pre-generated Edge TTS mp3 (data-audio). The mp3 starts downloading when
// the pointer reaches the button (hover, or the touch itself), so playback
// starts almost as soon as the click lands.
const TTS_JS = `document.addEventListener('DOMContentLoaded', function(){
  // Only one sentence plays at a time. Clicking a second button stops the
  // first; clicking the button that is already playing stops it (toggle),
  // so repeated clicks never stack up overlapping playback.
  var current = null;      // the Audio currently playing
  var currentBtn = null;   // the button that started it

  function stopCurrent() {
    if (current) { current.pause(); current = null; }
    if (currentBtn) { currentBtn.classList.remove('playing'); currentBtn = null; }
  }

  // Inject 🔊 button ONLY on sentences with pre-generated Edge TTS audio.
  // No browser TTS fallback — quality is too poor to show.
  document.querySelectorAll('li[data-audio]').forEach(function(el) {
    var audioId = el.getAttribute('data-audio');
    var btn = document.createElement('button');
    btn.className = 'speak-btn';
    btn.textContent = '🔊';
    btn.title = '朗読';
    btn.setAttribute('aria-label', 'Read aloud');
    var ready = null;   // Audio already loading from a hover, consumed by the next click
    btn.addEventListener('pointerenter', function() {
      if (!ready) { ready = new Audio('/audio/' + audioId + '.mp3'); ready.preload = 'auto'; }
    });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (currentBtn === btn) { stopCurrent(); return; }
      stopCurrent();
      var audio = ready || new Audio('/audio/' + audioId + '.mp3');
      ready = null;
      current = audio;
      currentBtn = btn;
      btn.classList.add('playing');
      function done() { if (current === audio) stopCurrent(); }
      audio.addEventListener('ended', done);
      audio.addEventListener('error', done);
      var p = audio.play();
      if (p && p.catch) p.catch(done);
      if (window.gaEvent) window.gaEvent('audio_play', { audio_id: audioId, page_path: location.pathname });
    });
    // Loose-list items wrap their text in a <p>; appending to the <li> would
    // drop the inline button below that block. Append inside the trailing <p>
    // so the 🔊 sits inline at the end of the sentence.
    var last = el.lastElementChild;
    var box = last && last.tagName === 'P' ? last : el;
    // Glue the 🔊 to the sentence's last character, so a full line wraps the
    // two together instead of leaving the button alone on the next line. The
    // translation line (.ex-tr) comes after the button, so skip its text.
    var tw = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: function(n) {
      return /\\S/.test(n.data) && !n.parentNode.closest('rt, rp, .ex-tr') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    } });
    var tail = null, n;
    while ((n = tw.nextNode())) tail = n;
    if (!tail) { box.appendChild(btn); return; }
    var ruby = tail.parentNode.closest('ruby');
    if (ruby) tail = ruby;
    else {
      tail.data = tail.data.replace(/\\s+$/, '');
      if (tail.data.length > 1) tail = tail.splitText(tail.data.length - 1);
    }
    var glue = document.createElement('span');
    glue.style.whiteSpace = 'nowrap';
    tail.parentNode.insertBefore(glue, tail);
    glue.appendChild(tail);
    glue.appendChild(btn);
  });
});`;

// Lightweight GA4 hit sender — replaces gtag.js (~200 KB gzip / 600 KB of JS
// that every visitor used to download and parse). Hits go straight to GA4's
// /g/collect endpoint, the same one gtag.js uses, so page_view, referrer,
// custom events (window.gaEvent) and the GSC link keep working; sessions and
// engagement time are tracked here (30-min idle session, visible-time _et).
// The client id is reused from an existing gtag `_ga` cookie, so returning
// visitors are not counted as new users after the switch.
//
// Hits are still engagement-gated: nothing is sent until the first real
// scroll / pointer / key / touch, or ~3s of continuous foreground visibility.
// Headless crawlers that fake their UA and load-and-leave never trip it, so
// they don't inflate user / session / page_view counts. Add ?ga_debug to a
// URL to see its hits in GA4 DebugView.
const GTAG_DEFERRED = `<script>
(function() {
  var ua = navigator.userAgent || '';
  // Skip GA for automation / crawlers / SEO tools — they all match here.
  if (navigator.webdriver) return;
  if (/HeadlessChrome|Lighthouse|PhantomJS|Puppeteer|Playwright|crawler|spider|bot|Slurp|facebookexternalhit/i.test(ua)) return;

  var TID = 'G-D1KNQTFN1R', URL_ = 'https://www.google-analytics.com/g/collect';
  var debug = /[?&]ga_debug\\b/.test(location.search);
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  // Own visits stay out of the numbers: only the live host counts (localhost
  // previews don't, unless ?ga_debug), and ?ga_off opts this browser out for
  // good (?ga_on undoes it).
  if (location.hostname !== '${new URL(SITE).hostname}' && !debug) return;
  if (/[?&]ga_off\\b/.test(location.search)) store('jp_ga_off', '1');
  if (/[?&]ga_on\\b/.test(location.search)) store('jp_ga_off', '0');
  if (store('jp_ga_off') === '1') { if (/[?&]ga_off\\b/.test(location.search)) console.info('GA: this browser is opted out (?ga_on to undo)'); return; }
  function rnd() { return Math.floor(Math.random() * 2147483647); }
  var now = function() { return Date.now(); };

  // Client id: existing gtag cookie (GA1.1.<rand>.<ts>) → ours → new.
  var cid = store('jp_ga_cid'), firstVisit = false;
  if (!cid) {
    var m = document.cookie.match(/(?:^|; )_ga=GA\\d\\.\\d\\.(\\d+\\.\\d+)/);
    cid = m ? m[1] : rnd() + '.' + Math.floor(now() / 1000);
    firstVisit = !m;
    store('jp_ga_cid', cid);
  }
  // Session: new after 30 min without a hit. s = { id, n (count), t (last hit), pv }.
  var sess; try { sess = JSON.parse(store('jp_ga_sess')); } catch (e) {}
  var newSession = !sess || now() - sess.t > 30 * 60 * 1000;
  if (newSession) sess = { id: Math.floor(now() / 1000), n: ((sess && sess.n) || 0) + 1, t: 0, pv: 0 };

  var seq = 0, pageId = rnd(), started = false, queue = [];
  var visibleSince = document.hidden || document.prerendering ? 0 : now(), engagedMs = 0;
  function takeEngaged() {
    if (visibleSince) { engagedMs += now() - visibleSince; visibleSince = document.hidden ? 0 : now(); }
    var e = engagedMs; engagedMs = 0; return e;
  }
  function send(name, params, extra) {
    var q = {
      v: 2, tid: TID, cid: cid, sid: sess.id, sct: sess.n, _p: pageId, _s: ++seq,
      seg: sess.pv > 1 || engagedMs + (visibleSince ? now() - visibleSince : 0) > 10000 ? 1 : 0,
      dl: location.href, dt: document.title, ul: (navigator.language || '').toLowerCase(),
      sr: screen.width + 'x' + screen.height, en: name
    };
    if (document.referrer && seq === 1) q.dr = document.referrer;
    if (debug) q._dbg = 1;
    for (var k in extra) q[k] = extra[k];
    for (var p in params) {
      var v = params[p];
      if (v === undefined || v === null) continue;
      q[(typeof v === 'number' ? 'epn.' : 'ep.') + p] = typeof v === 'number' ? v : String(v);
    }
    var url = URL_ + '?' + Object.keys(q).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    sess.t = now(); store('jp_ga_sess', JSON.stringify(sess));
    if (!(navigator.sendBeacon && navigator.sendBeacon(url))) {
      try { fetch(url, { method: 'POST', keepalive: true, mode: 'no-cors' }).catch(function() {}); } catch (e) {}
    }
  }

  function start() {
    if (started) return;
    started = true;
    sess.pv++;
    var extra = {};
    if (newSession) extra._ss = 1;
    if (firstVisit) extra._fv = 1;
    send('page_view', {}, extra);
    queue.forEach(function(e) { send(e[0], e[1], { _et: takeEngaged() }); });
    queue = null;
    // Report foreground time when the page is hidden or left.
    function flush() {
      var et = takeEngaged();
      if (et > 0) send('user_engagement', {}, { _et: et });
    }
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) flush(); else visibleSince = now();
    });
    window.addEventListener('pagehide', flush);
  }

  // Engagement gate: arm interaction listeners + a foreground-visibility
  // timer; whichever fires first starts sending, then everything is torn down.
  function arm() {
    var opts = { once: true, passive: true };
    var timer = null;
    function stopTimer() { if (timer) { clearTimeout(timer); timer = null; } }
    function startTimer() { if (!document.hidden && !document.prerendering && !timer) timer = setTimeout(trigger, 3000); }
    function trigger() {
      if (started) return;
      window.removeEventListener('scroll', trigger, opts);
      window.removeEventListener('pointerdown', trigger, opts);
      window.removeEventListener('keydown', trigger, opts);
      window.removeEventListener('touchstart', trigger, opts);
      stopTimer();
      start();
    }
    window.addEventListener('scroll', trigger, opts);
    window.addEventListener('pointerdown', trigger, opts);
    window.addEventListener('keydown', trigger, opts);
    window.addEventListener('touchstart', trigger, opts);
    document.addEventListener('visibilitychange', function() {
      if (started) return;
      if (document.hidden) { stopTimer(); } else { if (!visibleSince) visibleSince = now(); startTimer(); }
    });
    // A prerendered page (Speculation Rules) is only "viewed" once activated.
    document.addEventListener('prerenderingchange', function() { visibleSince = now(); startTimer(); });
    startTimer();
  }
  if (document.readyState === 'complete') arm();
  else window.addEventListener('load', arm);

  // Event helper — callers don't need to guard their calls. Events fired
  // before the gate opens are queued and sent right after the page_view.
  window.gaEvent = function(name, params) {
    if (queue) queue.push([name, params || {}]);
    else send(name, params || {}, { _et: takeEngaged() });
  };
})();
</script>`;

// Speculation Rules (Chromium; ignored elsewhere): prefetch an internal page
// once the reader hovers a link for ~200ms, and prerender it on pointerdown,
// so the next lesson usually opens instantly. File URLs (audio, Anki decks,
// feed) are excluded — only directory-style pages are fetched.
// Service worker (site/sw.js → dist/sw.js): long-lived caching for audio and
// versioned scripts, plus offline reading of pages already visited.
const SW_REGISTER = `<script>
if ('serviceWorker' in navigator) window.addEventListener('load', function() {
  navigator.serviceWorker.register('/sw.js').catch(function() {});
});
</script>`;

const SPECULATION_RULES = `<script type="speculationrules">
{"prefetch":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/*.*"}}]},"eagerness":"moderate"}],
 "prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/*.*"}}]},"eagerness":"conservative"}]}
</script>`;

// Old /dayNN/ → new /lessonNN/ map for redirect stubs. Used to generate
// meta-refresh pages at the old URLs so previously-shared / Google-indexed
// /dayNN/ links continue to work after the rename. Google treats <meta
// http-equiv="refresh" content="0;url="> as a 301 equivalent.
const DAY_TO_LESSON = {
  day00:"lesson00",day01:"lesson01",day02:"lesson02",day03:"lesson03",
  day04:"lesson04",day05:"lesson05",day06:"lesson06",day07:"lesson07",
  day08:"lesson08",day09:"lesson09",day10:"lesson10",day11:"lesson11",
  day12:"lesson12",day13:"lesson13",day14:"lesson14",day15:"lesson15",
  day16:"lesson16",day17:"lesson17",day18:"lesson18",day19:"lesson19",
  day20:"lesson20",day21:"lesson21",day22:"lesson22",day23:"lesson23",
  day24:"lesson24",day25:"lesson25",day26:"lesson26",
  // N4 reordered: review moved to end, supplementary content gets sequential ids
  day27:"lesson34",day28:"lesson30",day29:"lesson31",day30:"lesson32",day31:"lesson33",
  // N3 shifted +3 to make room for new keigo lessons in N4
  day32:"lesson35",day33:"lesson36",day34:"lesson37",day35:"lesson38",
  day36:"lesson39",day37:"lesson40",day38:"lesson41",day39:"lesson42",
  day40:"lesson43",day41:"lesson44",day42:"lesson45",day43:"lesson46",
  day44:"lesson47",day45:"lesson48",day46:"lesson49",day47:"lesson50",
  day48:"lesson51",day49:"lesson52",day50:"lesson53",day51:"lesson54",
  day52:"lesson55",day53:"lesson56",day54:"lesson57",day55:"lesson58",
  // N2 shifted +3
  day56:"lesson59",day57:"lesson60",day58:"lesson61",day59:"lesson62",
  day60:"lesson63",day61:"lesson64",day62:"lesson65",day63:"lesson66",
  day64:"lesson67",day65:"lesson68",day66:"lesson69",day67:"lesson70",
  day68:"lesson71",day69:"lesson72",day70:"lesson73",day71:"lesson74",
  day72:"lesson75",
};

// Japanese sidebar titles (keyed by file id)
const JA_TITLES = {
  N5_grammar_list: "N5 文法チェックリスト",
  N4_grammar_list: "N4 文法チェックリスト",
  N3_grammar_list: "N3 文法チェックリスト",
  N2_grammar_list: "N2 文法チェックリスト",
  N1_grammar_list: "N1 文法チェックリスト",
  // guides (grammar/guides/)
  "wa-vs-ga": "は vs が",
  "jlpt-december-2026": "JLPT 12月 考前指南",
  "jlpt-n5-key-grammar": "N5 高频考点",
  "jlpt-n4-key-grammar": "N4 高频考点",
  "jlpt-n3-key-grammar": "N3 高频考点",
  "jlpt-n2-key-grammar": "N2 高频考点",
  "jlpt-n1-key-grammar": "N1 高频考点",
  "ni-vs-de": "に vs で",
  "kara-vs-node": "から vs ので",
  "to-ba-tara-nara": "と・ば・たら・なら",
  "you-da-rashii-sou-da-mitai": "ようだ・らしい・そうだ・みたいだ",
  "ageru-kureru-morau": "あげる・くれる・もらう",
  "teiru-vs-tearu": "ている・てある・ておく",
  "tame-ni-vs-you-ni": "ために vs ように",
  "hazu-vs-wake": "はずだ vs わけだ",
  "aida-ni-vs-uchi-ni": "あいだ vs あいだに vs うちに",
  lesson00: "五十音図（参考）",
  lesson01: "判断句・は/が・基礎助詞",
  lesson02: "核心助詞 — に・で・へ・と・から・まで",
  lesson03: "動詞分類とます形",
  lesson04: "て形（最重要な動詞活用）",
  lesson05: "て形応用 — ている・てください・てもいい",
  lesson06: "ない形と義務表現",
  lesson07: "た形・経験・列挙表現",
  lesson08: "形容詞活用と比較表現",
  lesson09: "条件表現 — と・ば",
  lesson10: "条件表現 — たら・なら",
  lesson11: "可能形と受身形",
  lesson12: "意向形と願望表現",
  lesson13: "推測 — でしょう・かもしれない・そうだ",
  lesson14: "様態 — ようだ・らしい・みたいだ・っぽい",
  lesson15: "N5補充文法 — ことができる・のだ・のに",
  lesson16: "N5補充文法＋総復習",
  lesson18: "使役形 — させる・させてあげる",
  lesson19: "受身形詳解・使役受身形",
  lesson20: "授受表現 — あげる/もらう/くれる",
  lesson21: "ように系列 — ようにする/ようになる",
  lesson22: "ことにする/ことになる/はずだ",
  lesson23: "ばかり/ところだ/てしまう",
  lesson24: "ておく/てある/て以来/にかけて",
  lesson25: "という/ということ/というより",
  lesson26: "わけだ/ものだ",
  lesson27: "敬語入門 — 尊敬語",
  lesson28: "敬語入門 — 謙譲語",
  lesson29: "敬語実用 — 商務シーン",
  lesson34: "N4文法総復習",
  lesson30: "〜ても/〜てほしい/〜ていく・てくる",
  lesson31: "〜すぎる/〜やすい・にくい/〜ことはない",
  lesson17: "N5補充文法② — がある・に行く・のが好き",
  lesson32: "引用・思考・比況 — と思う・かどうか・のように",
  lesson33: "時間と場面 — あいだ・までに・場合は",
  lesson35: "N3書面助詞 — において/に対して",
  lesson36: "書面助詞② — に関して/にとって/に基づいて",
  lesson37: "原因・理由 — おかげで/せいで/からには",
  lesson38: "逆接・譲歩① — にもかかわらず/くせに",
  lesson39: "逆接・譲歩② — ものの/とはいえ/どころか",
  lesson40: "程度・範囲① — ほど/さえ〜ば",
  lesson41: "程度・範囲② — ばかりか/に限らず",
  lesson42: "傾向・状態 — がちだ/つつある/一方だ",
  lesson43: "判断・推量 — に違いない/おそれがある",
  lesson44: "動作関連① — ようとする/ざるを得ない",
  lesson45: "動作関連② — きる/得る/っこない",
  lesson46: "並列・添加 — 上に/とともに/に伴い",
  lesson47: "話題・立場 — として/にしては/向け",
  lesson48: "時間 — たとたんに/次第/うちに/際に",
  lesson49: "状態・様態 — まま/だらけ/っぱなし",
  lesson50: "附加・対比 — 代わりに/たびに/て初めて",
  lesson51: "表現方式① — というより/といっても/とおり",
  lesson52: "表現方式② — こそ/ふりをする/ごとに",
  lesson53: "否定関連 — ずにはいられない/めったに〜ない",
  lesson54: "助言・複合① — たらいい/〜込む/〜合う",
  lesson55: "複合表現 — からこそ/とは限らない",
  lesson56: "常用文法① — べきだ/わけにはいかない",
  lesson57: "常用文法② — てたまらない/てならない",
  lesson58: "N3文法総復習",
  lesson59: "逆接 — からといって/つつも/にしろ",
  lesson60: "原因・理由 — あまり/ばこそ/だけに",
  lesson61: "程度・限定① — に過ぎない/にほかならない",
  lesson62: "程度・限定② — はもとより/のみならず",
  lesson63: "時間 — にあたって/に先立って/を機に",
  lesson64: "主張・判断① — わけがない/はずがない",
  lesson65: "主張・判断② — ということだ/ないものか",
  lesson66: "対比・関係 — に反して/一方で/につれて",
  lesson67: "話題・立場 — をめぐって/を問わず/に応じて",
  lesson68: "感情・不可抗 — てしょうがない/てはいられない",
  lesson69: "書面表現 — に沿って/を踏まえて/上で",
  lesson70: "仮定・条件 — ものなら/ことだ/に越したことはない",
  lesson71: "関係・結果 — あげくに/ところだった",
  lesson72: "強調・限定 — だけのことはある/まい",
  lesson73: "接続・転折 — それにしても/したがって",
  lesson74: "高頻出 — げ/抜く/次第/きり/ぶりに",
  lesson75: "N2文法総復習",
  lesson76: "時間・時点 — が早いか/や否や/なり/そばから",
  lesson77: "限定・範囲 — をおいて/ならでは/はおろか",
  lesson78: "例示・並列 — といい/といわず/であれ",
  lesson79: "強調・極限 — たりとも/すら/にして",
  lesson80: "逆接・譲歩 — ものを/といえども/ところを",
  lesson81: "条件・仮定 — なくして/ともなると/たら最後",
  lesson82: "目的・原因 — べく/んがため/ゆえ",
  lesson83: "関連・無関係 — いかんで/をよそに",
  lesson84: "付随・強制 — ずにはおかない/を余儀なくされる",
  lesson85: "評価・判断 — までもない/に足る/に堪えない",
  lesson86: "評価・判断 — べくもない/てしかるべきだ",
  lesson87: "感情・強調 — てやまない/極まりない",
  lesson88: "様子・状態 — ずくめ/まみれ/めく",
  lesson89: "並行・付帯 — かたがた/がてら/かたわら",
  lesson90: "書き言葉 — べからず/ごとき/んばかり",
  lesson91: "立場・対比 — にひきかえ/ともあろう/たる",
  lesson92: "N1文法総復習",
};

// SEO keywords per lesson (Japanese, Chinese, English)
const LESSON_KEYWORDS = {
  N5_grammar_list: "N5文法一覧, N5语法列表, JLPT N5 grammar list, checklist, 文法チェックリスト",
  N4_grammar_list: "N4文法一覧, N4语法列表, JLPT N4 grammar list, checklist, 文法チェックリスト",
  N3_grammar_list: "N3文法一覧, N3语法列表, JLPT N3 grammar list, checklist, 文法チェックリスト",
  N2_grammar_list: "N2文法一覧, N2语法列表, JLPT N2 grammar list, checklist, 文法チェックリスト",
  lesson00: "五十音図, 五十音图, hiragana, katakana, Japanese alphabet, 平仮名, 片仮名, 日语入门",
  lesson01: "です, は, が, 助詞, 基础句型, Japanese particles, desu, basic sentence patterns, JLPT N5",
  lesson02: "に, で, へ, と, から, まで, 助词详解, core particles, JLPT N5",
  lesson03: "ます形, 动词分类, masu form, verb groups, 一类动词, 二类动词, 三类动词, JLPT N5",
  lesson04: "て形, te form, verb conjugation, 音便, te form rules, 动词变形, JLPT N5",
  lesson05: "ている, てください, てもいい, てはいけない, て形応用, te form usage, JLPT N5",
  lesson06: "ない形, なければならない, なくてもいい, negative form, obligation, JLPT N5",
  lesson07: "た形, たことがある, たり, たばかり, ta form, experience, JLPT N5",
  lesson08: "い形容词, な形容词, より, 一番, adjective conjugation, comparison, JLPT N5",
  lesson09: "と, ば, 条件表現, conditional と, conditional ば, JLPT N5",
  lesson10: "たら, なら, 条件表現, conditional たら, conditional なら, JLPT N5",
  lesson11: "可能形, 受身形, potential form, passive form, られる, JLPT N5",
  lesson12: "意向形, つもり, 予定, たい, volitional form, intention, desire, JLPT N5",
  lesson13: "でしょう, かもしれない, そうだ, 推測, conjecture, hearsay, JLPT N5",
  lesson14: "ようだ, らしい, みたいだ, っぽい, 様態, appearance, seems like, JLPT N5",
  lesson15: "ことができる, のだ, のに, ので, N5補充, supplementary grammar, JLPT N5",
  lesson16: "N5文法, N5 grammar review, 総復習, すぎる, やすい, にくい, ながら, JLPT N5",
  lesson18: "使役形, させる, させてあげる, させてもらう, causative, JLPT N4",
  lesson19: "受身形, 使役受身形, させられる, passive, causative passive, JLPT N4",
  lesson20: "あげる, もらう, くれる, 授受表現, てあげる, てもらう, てくれる, giving receiving, JLPT N4",
  lesson21: "ようにする, ようになる, ように, ないようにする, so that, JLPT N4",
  lesson22: "ことにする, ことになる, はずだ, decide to, expected to, JLPT N4",
  lesson23: "ばかり, ところだ, てしまう, ちゃう, just did, about to, regret, JLPT N4",
  lesson24: "ておく, てある, て以来, にかけて, advance preparation, result state, JLPT N4",
  lesson25: "という, ということ, というより, といえば, called, means that, JLPT N4",
  lesson26: "わけだ, ものだ, わけがない, わけではない, ものだから, JLPT N4",
  lesson27: "敬語, 尊敬語, いらっしゃる, 召し上がる, ご覧になる, お〜になる, られる, honorific Japanese, JLPT N4",
  lesson28: "敬語, 謙譲語, 参る, 申す, 拝見する, お〜する, 〜せていただく, humble Japanese, JLPT N4",
  lesson29: "敬語実用, 商務日本語, ビジネス敬語, 商务日语, business Japanese keigo, JLPT N4",
  lesson34: "N4文法, N4 grammar review, 総復習, JLPT N4 summary",
  lesson30: "ても, てほしい, ていく, てくる, がる, even if, want someone to, JLPT N4",
  lesson31: "すぎる, やすい, にくい, ことはない, 方, 出す, 始める, too much, easy to, JLPT N4",
  lesson17: "がある, がいる, に行く, のが好き, くらい, だけ, や, existence, JLPT N5",
  lesson32: "と思う, かどうか, のように, なさい, がする, 必要がある, I think, whether, JLPT N4",
  lesson33: "あいだ, までに, おきに, 場合は, たらどう, てよかった, during, by, in case, JLPT N4",
  lesson35: "において, に対して, について, によって, 書面助詞, formal particles, JLPT N3",
  lesson36: "に関して, にとって, に基づいて, にかけて, にわたって, 書面助詞, formal particles, JLPT N3",
  lesson37: "おかげで, せいで, ために, 以上は, からには, ことから, 原因理由, cause reason, JLPT N3",
  lesson38: "にもかかわらず, ながらも, くせに, としても, 逆接, 譲歩, concession, JLPT N3",
  lesson39: "にしても, ものの, とはいえ, どころか, 逆接, concession, nevertheless, JLPT N3",
  lesson40: "ほど, くらい, ば〜ほど, さえ〜ば, 程度, 範囲, degree extent, JLPT N3",
  lesson41: "だけ, しか〜ない, ばかりか, に限って, に限らず, 程度, 限定, only, not limited to, JLPT N3",
  lesson42: "がちだ, っぽい, 気味, つつある, 一方だ, かけ, 傾向, tendency, state, JLPT N3",
  lesson43: "に違いない, に決まっている, おそれがある, っけ, ものか, 判断, 推量, must be, JLPT N3",
  lesson44: "ようとする, ようがない, ざるを得ない, かねる, かねない, 動作, action, JLPT N3",
  lesson45: "きる, きれない, っこない, 得る, 得ない, 可能, possibility, completely, JLPT N3",
  lesson46: "上に, だけでなく, はもちろん, をはじめ, とともに, に伴い, 並列, addition, JLPT N3",
  lesson47: "として, にしては, 割に, 向け, 向き, 話題, 立場, as, considering, JLPT N3",
  lesson48: "たとたんに, 次第, うちに, 最中に, 際に, 時間, time, as soon as, JLPT N3",
  lesson49: "まま, だらけ, っぱなし, ずに, ように見える, 状態, 様態, state, appearance, JLPT N3",
  lesson50: "代わりに, ついでに, に比べて, によると, たびに, て初めて, 対比, comparison, JLPT N3",
  lesson51: "というより, といっても, というと, といえば, とおり, 表現, expression, rather than, JLPT N3",
  lesson52: "ふりをする, こそ, ことに, ごとに, 表現, emphasis, every, pretend, JLPT N3",
  lesson53: "ないことはない, ずにはいられない, そうもない, 決して〜ない, めったに〜ない, 否定, negation, JLPT N3",
  lesson54: "たらいい, ばいい, ばよかった, てごらん, 込む, 合う, 助言, advice, compound verb, JLPT N3",
  lesson55: "からこそ, ことは〜が, ことになっている, ような気がする, とは限らない, ところが, 複合, compound, JLPT N3",
  lesson56: "わけにはいかない, しかない, ことはない, べきだ, べきではない, ものだ, 義務, should, JLPT N3",
  lesson57: "ことか, てたまらない, てならない, てもかまわない, ことがある, 結果, feeling, JLPT N3",
  lesson58: "N3文法, N3 grammar review, 総復習, JLPT N3 summary",
  lesson59: "からといって, つつも, にしろ, にせよ, たところで, どころではない, たとえ〜ても, 逆接, concession, JLPT N2",
  lesson60: "あまり, ばこそ, だけに, だけあって, ものだから, ことだから, 原因, cause, precisely because, JLPT N2",
  lesson61: "に過ぎない, にほかならない, に限る, もかまわず, をものともせず, 程度, 限定, merely, JLPT N2",
  lesson62: "はもとより, のみならず, も〜ば〜も, でさえ, 程度, 限定, not only, let alone, JLPT N2",
  lesson63: "にあたって, に先立って, を機に, をきっかけに, 時間, occasion, prior to, JLPT N2",
  lesson64: "ないわけにはいかない, に相違ない, わけがない, はずがない, ほかない, よりほかない, 主張, 判断, impossible, JLPT N2",
  lesson65: "ということだ, ないものか, としては, としても, というものだ, というものではない, 主張, 判断, it means, JLPT N2",
  lesson66: "に反して, 一方で, かわりに, 反面, につれて, にしたがって, 対比, contrast, as, JLPT N2",
  lesson67: "にしても〜にしても, はともかく, をめぐって, を問わず, を中心に, に応じて, からすると, からすれば, にしたら, にすれば, のもとで, 話題, topic, JLPT N2",
  lesson68: "てしょうがない, てはいられない, ないことには, てからでないと, 感情, 不可抗, unbearable, JLPT N2",
  lesson69: "に沿って, を踏まえて, を除いて, に加えて, 上で, 末に, 書面, formal written, JLPT N2",
  lesson70: "ものなら, ようものなら, ことだ, に越したことはない, としたら, とすれば, とすると, 仮定, 条件, if, best to, JLPT N2",
  lesson71: "にかけては, に当たらない, あげくに, ことなく, ずに済む, ところだった, 結果, result, JLPT N2",
  lesson72: "だけのことはある, だけは, だけまし, まい, 強調, 限定, worth, at least, JLPT N2",
  lesson73: "それにしても, それなのに, しかも, したがって, すなわち, 接続, 転折, however, therefore, JLPT N2",
  lesson74: "げ, 抜く, 次第だ, 次第で, きり, ぶりに, つき, 高頻出, suffix, JLPT N2",
  lesson75: "N2文法, N2 grammar review, 総復習, JLPT N2 summary",
  N1_grammar_list: "N1文法一覧, N1语法列表, JLPT N1 grammar list, checklist, 文法チェックリスト",
  lesson76: "が早いか, や否や, なり, そばから, てからというもの, を皮切りに, に至って, 時間, as soon as, JLPT N1",
  lesson77: "をおいて, ならでは, にとどまらず, はおろか, もさることながら, に限ったことではない, を限りに, 限定, JLPT N1",
  lesson78: "といい〜といい, といわず〜といわず, なり〜なり, であれ〜であれ, だの〜だの, うが〜まいが, 例示, JLPT N1",
  lesson79: "たりとも, すら, ですら, にして, からある, からする, あっての, の極み, の至り, 強調, JLPT N1",
  lesson80: "ものを, といえども, ところを, ながらも, とはいうものの, うが, うと, にしたって, 逆接, 譲歩, JLPT N1",
  lesson81: "なくして, ともなると, ともなれば, とあれば, たら最後, が最後, ようでは, ないまでも, 条件, JLPT N1",
  lesson82: "べく, んがため, ゆえに, とあって, こととて, にかこつけて, 目的, 原因, JLPT N1",
  lesson83: "いかんで, いかんによっては, いかんにかかわらず, いかんによらず, をよそに, によらず, に即して, にかかわる, JLPT N1",
  lesson84: "なしに, なしには, ことなしに, ずにはおかない, ずにはすまない, を禁じ得ない, を余儀なくされる, JLPT N1",
  lesson85: "までもない, までだ, までのことだ, には及ばない, に足る, に足りない, に堪える, に堪えない, にかたくない, JLPT N1",
  lesson86: "べくもない, てしかるべきだ, でなくてなんだろう, ないではすまない, ないものでもない, ないでもない, ばそれまでだ, JLPT N1",
  lesson87: "てやまない, 極まりない, 極まる, といったらない, 限りだ, とは, てはばからない, 感情, JLPT N1",
  lesson88: "ずくめ, まみれ, ぐるみ, めく, ともなく, ともなしに, ながらに, 様子, JLPT N1",
  lesson89: "かたがた, がてら, かたわら, つ〜つ, なりに, とばかりに, 並行, JLPT N1",
  lesson90: "うにも〜ない, べからず, べからざる, ごとき, ごとく, ずとも, んばかり, をもって, 文語, JLPT N1",
  lesson91: "にひきかえ, ともあろう, たるもの, ではあるまいし, と相まって, に則って, JLPT N1",
  lesson92: "N1文法, N1 grammar review, 総復習, JLPT N1 summary",
};

// ─── Helpers ───
function gitLastMod(filePath) {
  const t = gitLastModTime(filePath);
  return t ? t.slice(0, 10) : null;
}

// Full ISO timestamp of the last commit. The sitemap uses this rather than the
// bare date so indexnow.mjs can tell a second edit on the same day apart from
// no edit at all when it diffs the new sitemap against the deployed one.
function gitLastModTime(filePath) {
  try {
    return execSync(`git log -1 --format=%aI -- "${filePath}"`, { encoding: "utf-8" }).trim() || null;
  } catch { return null; }
}

// First commit date for a file (when it was added). Used as datePublished
// for Schema.org Article — Google differentiates published vs modified.
function gitFirstMod(filePath) {
  try {
    const log = execSync(`git log --format=%aI -- "${filePath}"`, { encoding: "utf-8" }).trim();
    if (!log) return null;
    const dates = log.split("\n");
    return dates[dates.length - 1].slice(0, 10);
  } catch { return null; }
}

// Estimate reading time in minutes from HTML content. Counts CJK characters
// only (Chinese + hiragana + katakana + CJK ext) — Latin tokens contribute
// little to reading load on a Chinese-language Japanese grammar page.
// 250 chars/min is a conservative pace for educational content with kanji.
function computeReadingTime(html) {
  const text = html.replace(/<[^>]+>/g, "");
  const cjk = (text.match(/[一-鿿぀-ヿ㐀-䶿]/g) || []).length;
  return Math.max(1, Math.ceil(cjk / 250));
}

function discoverFiles() {
  const groups = [];
  for (const { dir, label } of GRAMMAR_DIRS) {
    const abs = path.join(__dirname, dir);
    if (!fs.existsSync(abs)) continue;
    const files = fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".md"))
      // Plain code-unit order (lessons, then N*_grammar_list), except that
      // exam guides (jlpt-*) lead the guides group.
      .sort((a, b) => (/^jlpt-/.test(b) - /^jlpt-/.test(a)) || (a < b ? -1 : a > b ? 1 : 0));
    if (files.length === 0) continue;
    groups.push({
      label,
      files: files.map((f) => ({
        id: f.replace(/\.md$/, "").replace(/^(lesson\d+).*/, "$1"),
        path: path.join(abs, f),
      })),
    });
  }
  return groups;
}

// Extract title from first heading
function extractTitle(md) {
  const m = md.match(/^#\s+(.+)/m);
  return m ? m[1].replace(/[#*]/g, "").trim() : "Untitled";
}

// Extract top-of-file :::zh block (before any ## heading).
// Used as the unique per-lesson SEO lead + meta description, replacing the
// templated "本课讲解 X 的接续规则…" boilerplate that triggers Google's
// "已抓取-未编入索引" judgement.
function extractTopLead(md) {
  const beforeH2 = md.split(/^## /m)[0];
  const m = beforeH2.match(/^:::zh\s*\n([\s\S]*?)^:::\s*$/m);
  if (!m) return null;
  return m[1].trim();
}

// For lessons without a hand-written top :::zh, fall back to the first
// prose :::zh block inside the first real grammar-point section. Each
// grammar point has a "接续/Conjugation" subsection with bullet-point
// rules — we skip those since they make awful meta descriptions. We
// also skip "本课单词表"-style vocabulary headings. What remains is
// usually the meaning/usage paragraph, which is unique per lesson.
function extractFirstMeaningZh(md) {
  const sections = md.split(/^## /m);
  for (let i = 1; i < sections.length; i++) {
    const sec = sections[i];
    const headerLine = sec.split("\n")[0];
    if (/单词表|単語表|Vocabulary/i.test(headerLine)) continue;
    const subSections = sec.split(/^### /m);
    for (let j = 1; j < subSections.length; j++) {
      const sub = subSections[j];
      const subHeader = sub.split("\n")[0];
      if (/^(接[续続]|Conjugation)/i.test(subHeader)) continue;
      const m = sub.match(/^:::zh\s*\n([\s\S]*?)^:::\s*$/m);
      if (m) return m[1].trim();
    }
  }
  return null;
}

// English counterparts of the two extractors above. The site targets English
// learners for SEO, so the meta description hook is taken from the lesson's
// :::en lead (or the first grammar point's :::en meaning) rather than :::zh.
function extractTopLeadEn(md) {
  const beforeH2 = md.split(/^## /m)[0];
  const m = beforeH2.match(/^:::en\s*\n([\s\S]*?)^:::\s*$/m);
  if (!m) return null;
  return m[1].trim();
}

function extractFirstMeaningEn(md) {
  const sections = md.split(/^## /m);
  for (let i = 1; i < sections.length; i++) {
    const sec = sections[i];
    const headerLine = sec.split("\n")[0];
    if (/单词表|単語表|Vocabulary/i.test(headerLine)) continue;
    const subSections = sec.split(/^### /m);
    for (let j = 1; j < subSections.length; j++) {
      const sub = subSections[j];
      const subHeader = sub.split("\n")[0];
      if (/^(接[续続]|Conjugation)/i.test(subHeader)) continue;
      const m = sub.match(/^:::en\s*\n([\s\S]*?)^:::\s*$/m);
      if (m) return m[1].trim();
    }
  }
  return null;
}

// Strip markdown formatting from extracted lead text for meta description use.
// Strips a leading "接续：…" line that some lessons put inside their first
// :::zh block before the actual examples/meaning.
function leadToPlainText(text, maxLen = 160) {
  let s = text;
  s = s.replace(/^\s*接[续続][:：][^\n]*\n+/, "");
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s;
}

// Build a unique, keyword-bearing supplement from a lesson's actual grammar
// points + level. Used to lengthen meta descriptions that would otherwise be
// too short for SEO (Bing flags very short descriptions). Stays unique per
// page because every lesson covers different grammar points.
function buildDescSupplement(cleanPoints, level) {
  if (cleanPoints.length >= 2) {
    return `This lesson covers JLPT ${level} grammar ${cleanPoints.slice(0, 4).join(", ")}: conjugation, meaning, example sentences, and how to tell similar forms apart, with practice questions.`;
  }
  if (cleanPoints.length === 1) {
    return `This lesson explains the JLPT ${level} grammar point ${cleanPoints[0]} — its conjugation, meaning, and usage with example sentences, plus practice questions and answers.`;
  }
  return `Free JLPT ${level} Japanese grammar notes covering conjugation rules, meaning, usage, example sentences, and commonly confused points, with practice questions and answers.`;
}

// Generic, keyword-rich tail appended only when the combined description is
// still too short for SEO (Bing flags short descriptions). Leads with site
// features (单词表 / TTS 音频 / 间隔复习 / 在线学习) and the level so even lessons
// with one or two short grammar points reach Bing's recommended length. The
// unique hook + per-lesson supplement still carry the page's uniqueness.
function buildDescTail(level) {
  return `Includes a vocabulary list, native TTS audio on every example, and a spaced-repetition review plan — study JLPT ${level} Japanese grammar online for free.`;
}

// Combine a (possibly short) hand-written hook with the templated supplement so
// the final meta description is descriptive enough for SEO without losing the
// unique lead. A hook already long enough is kept as-is; otherwise the
// supplement is appended. If the result is still below targetMin (Bing flags
// short meta descriptions), a keyword-rich tail is appended. Capped at maxLen
// with an ellipsis.
function buildLessonDesc(hook, cleanPoints, level, minLen = 110, maxLen = 158, targetMin = 135) {
  const cap = (s) => (s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s);
  // English-first separator: add ". " unless the hook already ends with
  // sentence-ending punctuation (English or CJK, since hooks may quote 日本語).
  const join = (a, b) => a + (/[.!?。！？…:：]$/.test(a) ? " " : ". ") + b;
  const supp = buildDescSupplement(cleanPoints, level);
  let out;
  if (!hook) out = supp;
  else if (hook.length >= minLen) out = hook;
  else out = join(hook, supp);
  if (out.length < targetMin) out = join(out, buildDescTail(level));
  return cap(out);
}

// Chinese <title> for a /zh/ page that has no hand-written seo-titles.js entry.
function buildLessonTitleZh(lesson, cleanPoints, level) {
  if (cleanPoints.length >= 2) return `${cleanPoints.slice(0, 2).join("・")} 用法与区别 | JLPT ${level} 日语语法`;
  if (cleanPoints.length === 1) return `${cleanPoints[0]} 用法详解 | JLPT ${level} 日语语法`;
  const zh = lesson.title.split("||")[0].replace(/^Lesson\s+\d+\s*[–—-]\s*/i, "").trim();
  return `${zh} | JLPT ${level} 日语语法笔记`;
}

// Chinese meta description: the lesson's own :::zh lead (or first meaning
// paragraph), topped up with a templated sentence when it runs short.
function buildLessonDescZh(lesson, cleanPoints, level) {
  const src = lesson.topLead || lesson.firstMeaningZh || "";
  let out = src ? leadToPlainText(src, 110) : "";
  if (out.length < 60) {
    const pts = cleanPoints.slice(0, 4).join("、");
    const supp = pts
      ? `本课讲解 JLPT ${level} 语法 ${pts} 的接续、含义、例句与易混辨析，附练习题和答案。`
      : `JLPT ${level} 日语语法笔记：接续规则、例句、辨析与练习题，免费在线学习。`;
    out = out ? out.replace(/[。.]?$/, "。") + supp : supp;
  }
  return out.length > 120 ? out.slice(0, 119) + "…" : out;
}

// Remove every element whose class list has `lang-<lang>`, matching nested
// tags of the same name so a <div class="lang-en"> takes its inner <div>s
// with it. Only call it on content markup, not on <script> bodies.
function stripLangBlocks(html, lang) {
  const open = new RegExp(`<(span|div|p)\\b[^>]*\\bclass="(?:[^"]*\\s)?lang-${lang}(?:\\s[^"]*)?"[^>]*>`, "g");
  let out = "", i = 0, m;
  while ((m = open.exec(html))) {
    const tags = new RegExp(`<${m[1]}\\b[^>]*>|</${m[1]}>`, "g");
    tags.lastIndex = m.index + m[0].length;
    let depth = 1, t;
    while (depth && (t = tags.exec(html))) depth += t[0][1] === "/" ? -1 : 1;
    if (depth) break; // unbalanced markup: leave the rest untouched
    out += html.slice(i, m.index);
    i = open.lastIndex = tags.lastIndex;
  }
  return out + html.slice(i);
}

// Languages a lesson / checklist / guide is published in, one page each. The
// first is the default and lives at the root (/lessonNN/); the others at
// /<dir>lessonNN/. A page keeps only its own :::xx blocks (lang-xx), and the
// pages are tied together with hreflang. Adding a language: an entry here,
// :::xx blocks in the markdown, and its lang-xx CSS + preference handling.
const PAGE_LANGS = [
  { code: "en", dir: "", htmlLang: "en", hreflang: "en", ogLocale: "en_US" },
  { code: "zh", dir: "zh/", htmlLang: "zh-CN", hreflang: "zh-Hans", ogLocale: "zh_CN" },
];

// Turn a rendered multilingual page into its `lang` copy: drop the other
// languages' blocks inside <main>, and (outside the root language) point
// links to pages that have a copy in this language at /<dir>… so readers and
// crawlers stay on the same side.
function localizePage(html, lang, ids) {
  const a = html.indexOf('<main id="content">');
  const b = html.indexOf("</main>", a);
  if (a >= 0 && b > a) {
    let main = html.slice(a, b);
    for (const other of PAGE_LANGS) if (other.code !== lang.code) main = stripLangBlocks(main, other.code);
    html = html.slice(0, a) + main + html.slice(b);
  }
  if (!lang.dir) return html;
  const origin = SITE.replace(/^(https?:\/\/[^/]+).*$/, "$1").replace(/[.]/g, "\\.");
  const link = new RegExp(`(<a\\b[^>]*?\\bhref=")(?:${origin})?${SITE_PATH}([A-Za-z0-9_-]+)/(?=[#"])`, "g");
  return html.replace(link, (m, pre, id) => (ids.has(id) ? `${pre}${SITE_PATH}${lang.dir}${id}/` : m));
}

// URL bits for page `id` in language `lang`: canonical url, the <html>
// attributes (data-force-lang pins the UI language, data-alt-xx is where
// switching to xx goes) and hreflang links.
function langVariant(id, lang) {
  const others = PAGE_LANGS.filter(o => o !== lang);
  const at = (o) => `${SITE}${o.dir}${id}/`;
  return {
    url: at(lang),
    htmlAttrs: ` data-force-lang="${lang.code}"` + others.map(o => ` data-alt-${o.code}="${SITE_PATH}${o.dir}${id}/"`).join(""),
    hreflang: PAGE_LANGS.map(o => `\n<link rel="alternate" hreflang="${o.hreflang}" href="${at(o)}">`).join("")
      + `\n<link rel="alternate" hreflang="x-default" href="${at(PAGE_LANGS[0])}">`,
  };
}

// Write a page's copy in `lang` to dist/<dir><id>/index.html.
function writeLangPage(id, lang, html) {
  const dir = path.join(__dirname, "dist", lang.dir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf-8");
}

// ─── Furigana via kuroshiro ───
async function initKuroshiro() {
  const k = new Kuroshiro();
  await k.init(new KuromojiAnalyzer());
  return k;
}

// ─── Furigana via element-level tagging ───

// Simplified Chinese chars that never appear in Japanese text.
// Simplified Chinese characters not used in Japanese (JP has different kanji).
// Shared chars like 点画声断残温条礼 are NOT here.
const SC_CHARS = new Set(
  "词讲语调证试诉该详请谢议论识记设访许评读书" +
  "买卖贵费资质购赢赶够辑辩辨边达远连运" +
  "闪闭闻间阅队阳阶际陆险难须频颜飘馆驾验骑" +
  "问题马头车东两关门见贝页鱼鸟齿风飞鞋韩" +
  "进发现实应虽选择认输环让错绝谓释练确义务" +
  "则规变对赞类纯陈简罗辑处叹做并" +
  "组细网终编继续绍纷绕缘缺缩织" +
  "获奖妆庄严丧" +
  "从给过还这为说" +
  "们它哪怎谁吗呢吧啊哦嘛呀嗯啦么" +
  "举护坏态惯样欢决热经结动听观传师预报转" +
  "离单复图场园约计长换历办银铁镇脑较亲价" +
  "强录厅婴宽异弯张扬杂笔脸构标灭虑综级" +
  "岁带怀戏执坚杀产仅优储兰创势华币" +
  "响团块奋妇宁宪审岛帐广庆恼悬惊愿战" +
  "扩拟拥拨择损摇撑权枪" +
  "另啤" +
  "吃刚觉满别开时个种习气负况针划于也掉罚适跑步过后只译搭填或看很"
);

function hasSC(text) {
  for (const ch of text) {
    if (SC_CHARS.has(ch)) return true;
  }
  return false;
}

// Japanese = has kana and no simplified-Chinese chars. A Chinese note that
// only quotes Japanese — 常与「たとえ」搭配 — has its kana inside 「」 and
// kanji (but no kana) outside them, so it doesn't count.
function isJapaneseText(text) {
  const kana = /[\u3040-\u309f\u30a0-\u30ff]/;
  if (!kana.test(text) || hasSC(text)) return false;
  const outsideQuotes = text.replace(/「[^」]*」|『[^』]*』/g, "");
  return !(/[\u4e00-\u9fff]/.test(outsideQuotes) && !kana.test(outsideQuotes));
}

// Tag block elements as data-ja if their content (outside parens) is Japanese.
// Japanese = has kana + no SC chars (after removing parenthetical Chinese).
function tagElements(html) {
  // Match block elements: li, p, td, th, blockquote, summary, dt, dd
  return html.replace(
    /(<(li|p|td|th|blockquote|summary|dt|dd)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (match, openTag, tagName, content, closeTag) => {
      // Extract plain text, stripping HTML tags
      const plain = content.replace(/<[^>]+>/g, "");
      // Remove text inside （…） for language detection
      const outsideParens = plain.replace(/（[^）]*）/g, "");
      // Japanese if any =/→/： segment is Japanese: 「これはつまらないだった。
      // → ❌ 错！…」 keeps its furigana; stripChineseSegments later drops the
      // readings from the Chinese segment.
      if (outsideParens.split(/[=＝→：—]/).some(isJapaneseText)) {
        // Japanese element → tag it
        const tagged = openTag.replace(/^<(\w+)/, '<$1 data-ja');
        return tagged + content + closeTag;
      }
      return match;
    }
  );
}

// Romaji the way English-speaking learners type it in a search box: no
// long-vowel macrons (shou, saichuu), を as "wo", particles split off
// (ni taishite, koto ni) but conjugated endings kept on their word
// (mashou, kamoshirenai, kagirazu). A kana gloss after kanji is its reading
// (方（かた） → kata); other kana in （） is optional (以上（は） → ijou (wa)).
const ROMAJI_PARTICLES = new Set(["wa", "ga", "wo", "o", "ni", "de", "to", "mo", "ka", "no", "ya", "ba", "e", "yori", "kara", "made", "koso", "dake"]);
const ROMAJI_FIXES = [
  [/\btoyuu\b/g, "to iu"], [/\bkotoni\b/g, "koto ni"], [/\btotomoni\b/g, "to tomo ni"],
  [/\bkaraniwa\b/g, "kara ni wa"], [/\batode\b/g, "ato de"], [/\bwarini\b/g, "wari ni"],
  [/\bkano you\b/g, "ka no you"], [/\bo sore\b/g, "osore"], [/\bni kui\b/g, "nikui"],
  [/\bbetsuni\b/g, "betsu ni"], [/\bsorenishitemo\b/g, "sore ni shite mo"], [/\bsorenanoni\b/g, "sore na no ni"],
  [/datsuta/g, "datta"], // the converter spells out the っ of だった
];
async function romajiOf(kuro, ja) {
  ja = ja.replace(/[一-鿿]+（([ぁ-ゟ]{2,})）/g, "$1");
  const parts = [];
  for (const seg of ja.split(/(（[ぁ-ゟ]+）|を|[〜～]|\s*[\/／・]\s*|\s+vs\s+)/).filter(s => s && s.trim())) {
    const opt = seg.match(/^（(.+)）$/);
    if (opt) parts.push(`(${await romajiOf(kuro, opt[1])})`);
    else if (seg === "を") parts.push("wo");
    else if (/^[〜～]$/.test(seg)) parts.push("~");
    else if (/^\s*[\/／・]\s*$/.test(seg)) parts.push("/");
    else if (/vs/.test(seg)) parts.push("vs");
    else {
      const sokuon = seg.startsWith("っ");
      let r = await kuro.convert(sokuon ? seg.slice(1) : seg, { to: "romaji", mode: "spaced", romajiSystem: "hepburn" });
      if (sokuon) r = r[0] + r;
      r = r.replace(/ō/g, "ou").replace(/ū/g, "uu").replace(/ā/g, "aa").replace(/ē/g, "ee").replace(/ī/g, "ii");
      // Glue conjugation endings back onto their stem unless it is a particle.
      const toks = r.split(/\s+/);
      const out = [];
      for (const t of toks) {
        const prev = out[out.length - 1];
        if (prev && !ROMAJI_PARTICLES.has(prev) && /^(te|ta|tara|tari|nai|zu|n|u|masu|mase|rare|reru|se)$/.test(t)) out[out.length - 1] = prev + t;
        else out.push(t);
      }
      r = out.join(" ");
      if (/^に/.test(seg) && /^ni\S/.test(r)) r = "ni " + r.slice(2);
      parts.push(r);
    }
  }
  let r = parts.join(" ").replace(/\s+/g, " ").replace(/~\s+/g, "~").trim();
  for (const [re, to] of ROMAJI_FIXES) r = r.replace(re, to);
  return r;
}

// English side of a numbered grammar-point heading ("3. 〜だけに (Precisely
// because…)") gets the pattern's romaji after it — learners search
// "dake ni grammar", not だけに. Only when the heading starts with the
// Japanese pattern and it ends at "(", "—" or the end of the heading.
async function addRomaji(kuro, html) {
  const JA = "[〜～ぁ-ゟ゠-ヿ一-鿿（）①-⑩]";
  const re = new RegExp(`(<h2\\b[^>]*>.*?<span class="lang-en">)(\\d+\\.\\s*)(${JA}+(?:\\s*(?:[\\/／・]|vs)\\s*${JA}+)*)(?=\\s*(?:\\(|—|</span>))`, "g");
  const pats = [];
  html.replace(re, (m, pre, num, pat) => { pats.push(pat); return m; });
  const out = [];
  for (const pat of pats) out.push(/[ぁ-ゟ゠-ヿ]/.test(pat) ? await romajiOf(kuro, pat) : "");
  let i = 0;
  return html.replace(re, (m, pre, num, pat) => {
    const r = out[i++];
    return r ? `${pre}${num}${pat} <span class="romaji">${r}</span>` : m;
  });
}

// Core: add furigana to a text node via kuroshiro
async function furiganaText(kuro, text) {
  if (!/[\u4e00-\u9faf\u3400-\u4dbf]/.test(text)) return text;
  try {
    return await kuro.convert(text, { to: "hiragana", mode: "furigana" });
  } catch {
    return text;
  }
}

// Context-sensitive reading corrections.
//
// kuromoji picks the wrong reading for a handful of words even with the whole
// sentence for context — 行った as おこなった, 後で as のちで, 来られる as
// きたられる. Each entry rewrites one <ruby> whose kanji, current reading and
// surrounding plain text all match; `before`/`after` see the text with tags
// and readings stripped, so a neighbouring ruby reads as its bare kanji.
const RUBY_FIXES = [
  // ── N1 lessons (76–92): context-specific readings; listed first so they win
  // over the general rules below. ──
  { kanji: "店", from: /^(てん|みせ)$/, before: /(号|人気|高級|飲食|専門|支|本)$/, to: "てん" },
  { kanji: "今", from: /^(いま|こん)$/, after: /^(シーズン|大会|年度|世紀|学期|週|期)/, to: "こん" },
  { kanji: "形", from: /^(がた|かたち|けい)$/, before: /(といい|といわず)$/, to: "かたち" },
  { kanji: "手", from: /^しゅ$/, after: /^といい/, to: "て" },
  { kanji: "人", from: /^じん$/, after: /^に譲/, to: "ひと" },
  { kanji: "人", from: /^(じん|にん)$/, before: /(料理|依頼)$/, to: "にん" },
  // 何人（なんぴと）たりとも
  { kanji: "人", from: /^(にん|じん|ひと)$/, before: /何$/, after: /^(たりとも|\s*[（(]なんぴと|」 is read)/, to: "ぴと" },
  { kanji: "来", from: /^(き|きた|く)$/, after: /^(よう|ず|（　+）)/, to: "こ" },
  { kanji: "中", from: /^ちゅう$/, before: /(部屋|会社|今夜|世界|日本|町|家|学校|体)$/, to: "じゅう" },
  { kanji: "方", from: /^ほう$/, before: /(立派な|あろう)$/, to: "かた" },
  { kanji: "物", from: /^ぶつ$/, after: /^も言/, to: "もの" },
  { kanji: "入", from: /^にゅう$/, after: /^ろう/, to: "はい" },
  { kanji: "降", from: /^(くだ|お)$/, before: /[雨雪][がはも]$/, after: /^ろう/, to: "ふ" },
  { kanji: "然", from: /^しか$/, after: /^る」/, to: "さ" },
  { kanji: "付", from: /^づ$/, before: /盛り$/, to: "つ" },
  { kanji: "日当", from: /^ひなた$/, after: /^たり/, to: "ひあ" },
  { kanji: "額", from: /^がく$/, after: /^が汗/, to: "ひたい" },
  { kanji: "我", from: /^わが$/, after: /^ながら/, to: "われ" },
  { kanji: "故", from: /^こ$/, after: /^(（に）|に|の)/, to: "ゆえ" },
  { kanji: "得", from: /^う$/, after: /^ん/, to: "え" },
  { kanji: "如何", from: /^いか$/, to: "いかん" },
  { kanji: "堪", from: /^こた$/, before: /に$/, to: "た" },
  { kanji: "愛", from: /^め$/, before: /の$/, to: "あい" },
  { kanji: "皆", from: /^かい$/, after: /^(独立|そろ|で|が|、)/, to: "みな" },
  { kanji: "剥", from: /^へ$/, after: /^が/, to: "は" },
  { kanji: "遣", from: /^や$/, before: /気を$/, to: "つか" },
  { kanji: "謝", from: /^しゃ$/, after: /^ろう/, to: "あやま" },
  { kanji: "一目", from: /^いちもく$/, after: /^(見|で)/, to: "ひとめ" },
  // 一 + counter: 一歩 いっぽ, 一着 いっちゃく, 一回戦 いっかいせん …; 一駅 ひとえき.
  { kanji: "一", from: /^いち$/, after: /^(歩|球|着|戸|泊|本|冊|軒|国|点|回|滴|杯|切|発|家)/, to: "いっ" },
  { kanji: "一", from: /^いち$/, after: /^駅/, to: "ひと" },
  { kanji: "歩", from: /^ほ$/, before: /一$/, to: "ぽ" },
  { kanji: "本", from: /^ほん$/, before: /一$/, to: "ぽん" },
  { kanji: "泊", from: /^はく$/, before: /一$/, to: "ぱく" },
  { kanji: "杯", from: /^はい$/, before: /一$/, to: "ぱい" },
  { kanji: "発", from: /^はつ$/, before: /一$/, to: "ぱつ" },
  // 行って/行った is いって/いった — except after を (調査を行った = おこなった).
  { kanji: "行", from: /^(おこな|くだり|ゆ)$/, after: /^っ[たて]/, before: /[^を]$/, to: "い" },
  // 〜た後で / 〜の後で is あとで, never のちで.
  { kanji: "後", from: /^のち$/, after: /^で/, to: "あと" },
  // 来られる = こられる, 来る = くる.
  { kanji: "来", from: /^きた$/, after: /^られ/, to: "こ" },
  { kanji: "来", from: /^きた$/, after: /^る/, to: "く" },
  // 勝てる/勝った is か-, not かち-.
  { kanji: "勝", from: /^かち$/, after: /^[てた]/, to: "か" },
  // 割る is わる (kuromoji gives 割(われ)る).
  { kanji: "割", from: /^われ$/, after: /^る/, to: "わ" },
  // 電車が空いている = すいている (uncrowded), not あいている.
  { kanji: "空", from: /^あ$/, before: /(電車|バス|道|店)が$/, after: /^い/, to: "す" },
  // 〜分 after 1/3/4/6/8/10 (and 0-ending numbers) is ぷん: 10分 = じゅっぷん.
  { kanji: "分", from: /^ふん$/, before: /[134680]$/, to: "ぷん" },
  // 雨/雪が降る is ふる (kuromoji reaches for 降りる).
  { kanji: "降", from: /^お$/, before: /[雨雪]が$/, after: /^[りるら]/, to: "ふ" },
  // 〜方がいい is ほうがいい (the comparative), …
  { kanji: "方", from: /^かた$/, after: /^が(いい|よ|良)/, to: "ほう" },
  // …while the honorific 方 = "person" is かた. Restricted to 方 followed by
  // a non-が particle: every comparative 方 in these lessons takes が, and a
  // topic-contrast 「〜の方は」(ほう) would need an exception here.
  { kanji: "方", from: /^ほう$/, after: /^[はをにもで、。]/, to: "かた" },
  // Grammar-term 〜形 is けい (ますけい, てけい, ないけい). kuromoji offers
  // がた or かたち; the real 「形」 (shape) keeps かたち because no form name
  // precedes it — 星の形, した。形.
  {
    kanji: "形",
    from: /^(がた|かたち)$/,
    before: /(ます|ない|たり|辞[書书]|可能|使役|受身|受け身|命令|意[向志]|普通|丁寧|仮定|条件|連用|基本|否定|原|ている|でいる|[VＶ]|[たてばないなイい])$/,
    to: "けい",
  },
  // 来させる/来させられる is こさせる.
  { kanji: "来", from: /^きた$/, after: /^させ/, to: "こ" },
  { kanji: "雨", from: /^う$/, to: "あめ" },
  { kanji: "薬", from: /^やく$/, to: "くすり" },
  { kanji: "水", from: /^すい$/, to: "みず" },
  { kanji: "店", from: /^てん$/, to: "みせ" },
  { kanji: "際", from: /^きわ$/, to: "さい" },
  { kanji: "嫌", from: /^ぎら$/, to: "きら" },
  // お腹/店が空く is すく; 席が空く (あく) would need an exception here.
  { kanji: "空", from: /^あ$/, before: /[腹店]/, after: /^い[たてる]/, to: "す" },
  // 〜た後だ / 〜の後に is あと. 後ほど (のちほど) is left alone.
  { kanji: "後", from: /^のち$/, after: /^[だにで、。]/, to: "あと" },
  { kanji: "熱", from: /^ねっ$/, after: /^そう/, to: "あつ" },
  { kanji: "難", from: /^かた$/, after: /^し/, to: "むずか" },
  { kanji: "書", from: /^が$/, before: /お$/, to: "か" },
  { kanji: "話", from: /^ばなし$/, after: /^[さしすせ]/, to: "はな" },
  // ピアノを弾く is ひく.
  { kanji: "弾", from: /^はじ$/, after: /^[けい]/, to: "ひ" },
  // A digit in front makes 時/歳 a counter: 10時 = じゅうじ, 18歳 = じゅうはっさい.
  { kanji: "時", from: /^とき$/, before: /[0-9０-９]\s*$/, to: "じ" },
  { kanji: "歳", from: /^とし$/, before: /[0-9０-９]\s*$/, to: "さい" },
  { kanji: "帰", from: /^き$/, after: /^[てた]/, to: "かえ" },
  { kanji: "美味", from: /^うま$/, to: "おい" },
  { kanji: "買", from: /^がい$/, to: "か" },
  { kanji: "見", from: /^みる$/, to: "み" },
  // Every 辛 in these lessons means "spicy" (からい), never つらい.
  { kanji: "辛", from: /^(つら|からし)$/, to: "から" },
  // 日本 is にほん in ordinary speech (日本語/日本人 already are).
  { kanji: "日本", from: /^にっぽん$/, to: "にほん" },
  { kanji: "日本人", from: /^にっぽんじん$/, to: "にほんじん" },
  // Month names: 3月 / 何月 = さんがつ / なんがつ.
  { kanji: "月", from: /^つき$/, before: /[0-9０-９何〇○]$/, to: "がつ" },
  { kanji: "何", from: /^なに$/, after: /^(月|の|て|って)/, to: "なん" },
  { kanji: "何時", from: /^いつ$/, to: "なんじ" },
  // 絵を描く = かく (the lessons' vocab lists give かく).
  { kanji: "描", from: /^えが$/, to: "か" },
  { kanji: "夜中", from: /^やちゅう$/, to: "よなか" },
  { kanji: "怒", from: /^いか$/, after: /^り[っ（]/, to: "おこ" },
  { kanji: "今", from: /^こん$/, to: "いま" },
  { kanji: "手数", from: /^てかず$/, to: "てすう" },
  { kanji: "召", from: /^めし$/, after: /^し/, to: "め" },
  // Grammar terms: 疑問詞, 数量詞, 助詞 … are 〜し.
  { kanji: "詞", from: /^ことば$/, to: "し" },
  // Suffix 〜気味 is ぎみ; 気味が悪い keeps きみ.
  { kanji: "気味", from: /^きみ$/, after: /^(?![がの悪])/, to: "ぎみ" },
  // 間に = あいだに ("during"); 間に合う stays まにあう.
  { kanji: "間", from: /^ま$/, after: /^に(?![合あ])/, to: "あいだ" },
  { kanji: "間", from: /^ま$/, before: /長い$/, to: "あいだ" },
  { kanji: "末", from: /^まつ$/, after: /^に/, to: "すえ" },
  { kanji: "大事", from: /^だいじ$/, after: /^にならず/, to: "おおごと" },
  { kanji: "角", from: /^かく$/, after: /^を曲/, to: "かど" },
  { kanji: "杯", from: /^はい$/, before: /[3３]$/, to: "ばい" },
  { kanji: "世論", from: /^せろん$/, to: "よろん" },
  // 来（く）れば / 来（こ）ない: the reading is spelled out right after.
  { kanji: "来", from: /^き$/, after: /^（く）/, to: "く" },
  { kanji: "来", from: /^き$/, after: /^（こ）/, to: "こ" },
  { kanji: "名", from: /^な$/, after: /^・な/, to: "めい" },
  { kanji: "長", from: /^ちょう$/, after: /^＿/, to: "なが" },
  { kanji: "出", from: /^で$/, after: /^さ（/, to: "だ" },
  { kanji: "刃", from: /^は$/, before: /鬼滅の$/, to: "やいば" },
  // A door/window opening by itself is あく.
  { kanji: "開", from: /^ひら$/, before: /(ドア|窓|戸|扉|門|店|鍵|開け|押すと|押せば|押したら)(?![^。]*を$)[^。]*$/, after: /^[かきくけい]/, to: "あ" },
  // Chinese 去 ("drop") in conjugation notes — 去る+ます, ます去ます — isn't
  // Japanese at all: no reading.
  { kanji: "去", from: /^さ$/, after: /^(る|い)?\s*[+＋]|^ます/, to: "" },
  { kanji: "去", from: /^さ$/, before: /ます$/, to: "" },
  // ひとし is a name reading; 等 in these notes is Chinese "etc.".
  { kanji: "等", from: /^ひとし$/, to: "" },
  // Rain/snow 降り続ける, 降りそう — ふる, not おりる.
  { kanji: "降", from: /^お$/, before: /[雨雪][がはも][^。]*$/, after: /^[りるら]/, to: "ふ" },
];

// Runs of adjacent rubies kuromoji should have read as one word. Each part is
// "kanji" or "kanji:reading" (the reading must match too).
const RUBY_MERGES = [
  [["彼", "女"], "かのじょ"],
  [["一", "人"], "ひとり"],
  [["二", "人"], "ふたり"],
  [["一", "日", "中"], "いちにちじゅう"],
  [["一", "晩", "中"], "ひとばんじゅう"],
  [["今日", "中"], "きょうじゅう"],
  [["今年", "中"], "ことしじゅう"],
  [["一", "回"], "いっかい"],
  [["一", "週間"], "いっしゅうかん"],
  [["一", "匹"], "いっぴき"],
  [["一", "通:つう"], "いっつう"],
  [["一", "泊", "二", "日"], "いっぱくふつか"],
  [["夜", "更"], "よふ"],
  [["疑問", "詞"], "ぎもんし"],
  [["空", "所"], "くうしょ"],
  [["鬼", "滅"], "きめつ"],
];

// 3日 / 3日間: kuromoji reads the digit and 日 separately (にち).
const DAY_COUNTS = { 2: "ふつか", 3: "みっか", 4: "よっか", 5: "いつか", 6: "むいか", 7: "なのか", 8: "ようか", 9: "ここのか", 10: "とおか", 20: "はつか" };

const RUBY_TAG = /<ruby>([^<]*)<rp>\(<\/rp><rt>([^<]*)<\/rt><rp>\)<\/rp><\/ruby>/g;
const RUBY_KANA = /^[ぁ-んァ-ヶーゔ・]+$/;

function ruby(kanji, reading) {
  return `<ruby>${kanji}<rp>(</rp><rt>${reading}</rt><rp>)</rp></ruby>`;
}

// Plain text (no tags, no readings) around a position, for fix context.
function plainAround(str, start, end) {
  const strip = (s) => s.replace(/<rp>[^<]*<\/rp>|<rt>[^<]*<\/rt>/g, "").replace(/<[^>]+>/g, "");
  return {
    before: strip(str.slice(Math.max(0, start - 200), start)).slice(-16),
    after: strip(str.slice(end, end + 80)).slice(0, 16),
  };
}

function fixReadings(html) {
  for (const [parts, reading] of RUBY_MERGES) {
    const kanji = parts.map((p) => p.split(":")[0]).join("");
    const re = new RegExp(
      parts.map((p) => { const [k, r] = p.split(":"); return ruby(k, r || "[^<]*"); }).join("").replace(/[()]/g, "\\$&"),
      "g"
    );
    html = html.replace(re, ruby(kanji, reading));
  }
  // 昔々 = むかしむかし (kuromoji leaves 々 bare).
  html = html.replace(new RegExp(ruby("昔", "むかし").replace(/[()]/g, "\\$&") + "々", "g"), ruby("昔々", "むかしむかし"));
  // Digit + 日 / 日間 counts days: 3日 = みっか, 3日間 = みっかかん.
  html = html.replace(
    /(^|[^0-9０-９])([0-9０-９]{1,2})<ruby>(日|日間)<rp>\(<\/rp><rt>にち(?:かん)?<\/rt><rp>\)<\/rp><\/ruby>/g,
    (m, pre, num, kanji) => {
      const n = Number(num.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
      const r = DAY_COUNTS[n];
      if (!r) return m;
      return pre + ruby(num + kanji, r + (kanji === "日間" ? "かん" : ""));
    }
  );
  // A date's 1日 (3月1日) is ついたち; elsewhere (1日で, 1日おきに) it stays いちにち.
  html = html.replace(/(<ruby>月<rp>\(<\/rp><rt>がつ<\/rt><rp>\)<\/rp><\/ruby>)([1１])<ruby>日<rp>\(<\/rp><rt>にち<\/rt><rp>\)<\/rp><\/ruby>/g,
    (m, month, one) => month + ruby(one + "日", "ついたち"));
  // kuroshiro echoes text it cannot read — a Chinese gloss that slipped into a
  // data-ja element comes back annotated with itself (刚(刚)). Keep the text,
  // drop the ruby.
  html = html.replace(RUBY_TAG, (m, kanji, reading) => (RUBY_KANA.test(reading) ? m : kanji));

  return html.replace(RUBY_TAG, (m, kanji, reading, offset, str) => {
    const ctx = plainAround(str, offset, offset + m.length);
    for (const f of RUBY_FIXES) {
      if (f.kanji !== kanji || !f.from.test(reading)) continue;
      if (f.after && !f.after.test(ctx.after)) continue;
      if (f.before && !f.before.test(ctx.before)) continue;
      return f.to ? ruby(kanji, f.to) : kanji;
    }
    return m;
  });
}

// Strip ruby from Chinese text inside full-width parens （…）
function stripParensChinese(html) {
  return html.replace(/（([\s\S]*?)）/g, (match, inner) => {
    const stripped = inner.replace(
      /<ruby>([\u4e00-\u9fff]+)<rp>\(<\/rp><rt>[^<]*<\/rt><rp>\)<\/rp><\/ruby>/g,
      "$1"
    );
    return "（" + stripped + "）";
  });
}

// Split on =, →, ： outside （…）/(…) and outside tags. Delimiters are kept
// as their own (odd-index) entries.
function splitGloss(str) {
  const out = [];
  let depth = 0, inTag = false, cur = "";
  for (const ch of str) {
    if (cur.endsWith("<rp>")) { cur += ch; continue; }  // ruby's own (…)
    if (ch === "<") inTag = true;
    else if (ch === ">") inTag = false;
    else if (!inTag && (ch === "（" || ch === "(")) depth++;
    else if (!inTag && (ch === "）" || ch === ")")) depth = Math.max(0, depth - 1);
    else if (!inTag && depth === 0 && "=＝→：—".includes(ch)) {
      out.push(cur, ch);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// Strip ruby from Chinese glosses inside a Japanese element: a segment after
// =, →, ： or — that is Chinese (〜ものを — 本来就好了，可是却) (ようにしている = 一直在注意, → ❌ 错！…).
// Quoted 「…」 Japanese doesn't count as kana.
function stripChineseSegments(html) {
  return html.replace(/(<(li|p|td|th|dd|dt|blockquote|summary)\b[^>]*\bdata-ja\b[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (m, open, tag, content, close) => open + content.split(/(<\/span>\s*<span class="lang-(?:zh|en)"[^>]*>)/).map((piece, k) => (k % 2 ? piece : stripPiece(piece))).join("") + close);
}
// One language's half of an element (「中文 // English」 items are two spans).
function stripPiece(content) {
      const parts = splitGloss(content);
      if (parts.length === 1) return content;
      const out = parts.map((seg, i) => {
        if (i % 2) return seg;
        const plain = seg
          .replace(/<rt>[^<]*<\/rt>|<rp>[^<]*<\/rp>/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/（[^）]*）|\([^)]*\)|「[^」]*」|『[^』]*』/g, "");
        if (/[\u4e00-\u9fff]/.test(plain) && (hasSC(plain) || !/[\u3040-\u309f\u30a0-\u30ff]/.test(plain))) {
          return seg.replace(/<ruby>([^<]*)<rp>\(<\/rp><rt>[^<]*<\/rt><rp>\)<\/rp><\/ruby>/g, "$1");
        }
        return seg;
      });
      return out.join("");
}

// Process HTML:
//  1. Tag elements as data-ja (Japanese) based on content analysis
//  2. Add furigana only inside data-ja elements
//  3. Strip ruby from parenthetical Chinese
async function addFurigana(kuro, html) {
  // Step 1: tag elements
  html = tagElements(html);

  // Step 2: add furigana only inside data-ja elements.
  //
  // Text nodes and <strong> tags are buffered into "runs" and converted as a
  // single unit, then the bold ranges are re-applied on top of the result.
  // Converting each fragment separately would let a bold marker split a word
  // from its okurigana — 話**せます** tokenizes as the noun 話（はなし）plus
  // せます, instead of the verb 話せます（はなせます）. Any other tag (<br>,
  // <a>, <em>, a nested list) ends the current run, so nothing is reordered
  // or dropped.
  const parts = html.split(/(<[^>]+>)/);
  const result = [];
  let jaDepth = 0;    // > 0 = inside a data-ja element
  let skipDepth = 0;  // > 0 = inside code/pre/rt/word-table/heading
  let inColloc = false; // inside a word table's <span class="colloc-ja">
  let run = [];       // buffered text nodes + <strong> tags

  // Convert the buffered run as one unit and re-apply its bold ranges.
  async function flushRun() {
    if (!run.length) return;
    const chunk = run;
    run = [];

    // Flatten to plain text, remembering which character offsets were bold.
    // Offsets are UTF-16 units throughout (here and in the walker below) so
    // surrogate pairs stay intact.
    let plain = "";
    const boldChars = new Set();
    let inBold = false;
    for (const p of chunk) {
      if (/^<strong\b/i.test(p)) { inBold = true; continue; }
      if (/^<\/strong>/i.test(p)) { inBold = false; continue; }
      for (let c = 0; c < p.length; c++) {
        if (inBold) boldChars.add(plain.length + c);
      }
      plain += p;
    }

    // No kanji → nothing to annotate, keep the original markup untouched.
    if (!/[一-龯㐀-䶿]/.test(plain)) {
      result.push(...chunk);
      return;
    }

    const furiganaHtml = await furiganaText(kuro, plain);

    // Walk the furigana HTML and wrap the bold ranges in <strong> again.
    // A ruby whose kanji overlaps a bold range is bolded as a whole.
    let finalHtml = "";
    let srcIdx = 0;
    let fi = 0;
    while (fi < furiganaHtml.length) {
      const rubyMatch = furiganaHtml.slice(fi).match(/^<ruby>([\s\S]*?)<rp>\(<\/rp><rt>([\s\S]*?)<\/rt><rp>\)<\/rp><\/ruby>/);
      if (rubyMatch) {
        const kanji = rubyMatch[1];
        const reading = rubyMatch[2];
        let anyBold = false;
        for (let k = 0; k < kanji.length; k++) {
          if (boldChars.has(srcIdx + k)) anyBold = true;
        }
        if (anyBold) {
          finalHtml += `<strong><ruby>${kanji}<rp>(</rp><rt>${reading}</rt><rp>)</rp></ruby></strong>`;
        } else {
          finalHtml += rubyMatch[0];
        }
        srcIdx += kanji.length;
        fi += rubyMatch[0].length;
      } else if (furiganaHtml[fi] === "<") {
        // Some other tag, pass through
        const tagEnd = furiganaHtml.indexOf(">", fi);
        finalHtml += furiganaHtml.slice(fi, tagEnd + 1);
        fi = tagEnd + 1;
      } else if (boldChars.has(srcIdx)) {
        // Collect consecutive bold chars
        let boldRun = "";
        while (fi < furiganaHtml.length && furiganaHtml[fi] !== "<" && boldChars.has(srcIdx)) {
          boldRun += furiganaHtml[fi];
          srcIdx++; fi++;
        }
        finalHtml += `<strong>${boldRun}</strong>`;
      } else {
        finalHtml += furiganaHtml[fi];
        srcIdx++; fi++;
      }
    }
    // Each bolded ruby gets its own wrapper above; collapse the seams.
    result.push(finalHtml.replace(/<\/strong><strong>/g, ""));
  }

  for (const part of parts) {
    const isTag = /^</.test(part);

    // Skip zones
    if (isTag && /^<(code|pre|rt|h[1-6])\b/i.test(part)) {
      await flushRun(); skipDepth++; result.push(part);
    } else if (isTag && /^<\/(code|pre|rt|h[1-6])>/i.test(part)) {
      await flushRun(); skipDepth--; result.push(part);
    } else if (isTag && /^<table\b[^>]*class="word-table"/i.test(part)) {
      await flushRun(); skipDepth++; result.push(part);
    } else if (isTag && skipDepth > 0 && /^<\/table>/i.test(part)) {
      await flushRun(); skipDepth--; result.push(part);
    }
    // data-ja zones
    else if (isTag && /\bdata-ja\b/.test(part) && /^<(li|p|td|th|blockquote|summary|dt|dd)\b/i.test(part)) {
      await flushRun(); jaDepth++; result.push(part);
    } else if (isTag && jaDepth > 0 && /^<\/(li|p|td|th|blockquote|summary|dt|dd)>/i.test(part)) {
      await flushRun(); jaDepth--; result.push(part);
    }
    // <strong> inside a data-ja zone: buffer it with the surrounding text
    else if (isTag && jaDepth > 0 && skipDepth === 0 && /^<\/?strong\b/i.test(part)) {
      run.push(part);
    }
    // Word-table collocations are annotated although the table is skipped
    else if (isTag && /^<span class="colloc-ja"/.test(part)) {
      await flushRun(); inColloc = true; result.push(part);
    } else if (isTag && inColloc && /^<\/span>/.test(part)) {
      await flushRun(); inColloc = false; result.push(part);
    }
    // Any other tag ends the current run
    else if (isTag) {
      await flushRun(); result.push(part);
    }
    // Text nodes
    else if (inColloc || (jaDepth > 0 && skipDepth === 0)) {
      run.push(part);
    } else {
      result.push(part);
    }
  }
  await flushRun();

  // Step 3: patch known kuromoji misreadings, then strip ruby from
  // parenthetical Chinese
  return stripChineseSegments(stripParensChinese(fixReadings(result.join(""))));
}

// ─── Audio eligibility ───

// Audio files are named after a hash of the sentence they speak, so editing
// or reordering examples never points a 🔊 at the wrong mp3, and a sentence
// shared by the zh and en blocks has one file.
function audioIdFor(text) {
  return "s" + require("crypto").createHash("sha1").update(text).digest("hex").slice(0, 12);
}
const AUDIO_FILES = new Set(
  (fs.existsSync(path.join(__dirname, "audio")) ? fs.readdirSync(path.join(__dirname, "audio")) : [])
    .filter((f) => f.endsWith(".mp3"))
    .map((f) => f.slice(0, -4))
);

// h2/h3 titles of practice/answer sections: their items get no audio.
const PRACTICE_HEADING = /练习|練習|Practice|Quiz|测验|改错|Error Correction|填空|Fill in|翻译|Translat|答案|Answers|选择|(?<!How to )Choose/i;

// The text to speak for an example <li>, or "" if it isn't a model Japanese
// sentence. Translations in （…）/(…) are dropped.
function audioText(content) {
  const raw = content
    .replace(/<ruby>([^<]*)<rp>[^<]*<\/rp><rt>[^<]*<\/rt><rp>[^<]*<\/rp><\/ruby>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  // Fill-in blanks.
  if (/（[\s　]*）|\([\s　]*\)|＿|_{2,}/.test(raw)) return "";
  const outside = raw
    .replace(/（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/^\s*[A-Za-z][A-Za-z ]*[:：]\s*/, "");  // "Plain past: …"
  if (
    /[❌✗✕×△]/.test(outside) ||               // wrong / questionable examples
    /[→⇒=＝+＋]/.test(outside) ||              // glosses, answers, formulas
    /[a-z]{3,}/.test(outside) ||               // English notes (ABC, SNS are fine)
    /(^|\s)[a-dａ-ｄ][.．)）]/.test(outside) || // a. b. c. options
    /，/.test(outside) ||                       // Chinese comma (Japanese uses 、)
    /^[^：:぀-ヿ]*[、…"“][^：:぀-ヿ]*[：:]/.test(outside) || // Chinese list label 手段、方法：
    hasSC(outside)                            // Chinese
  ) return "";
  const plain = outside
    .replace(/(^|\s)[A-ZＡ-Ｚ][：:]\s*/g, "$1")  // dialogue labels A： B：
    .replace(/^[\u4e00-\u9fff]{1,4}[：:]\s*/, "")  // scene labels 面接：
    .replace(/[→❌✓✗⚠️📖↑↓←→●■□▶︎•·…✅⭕○◯]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // A real sentence: ends in 。！？ and has kana.
  if (plain.length < 2 || !/[。！？]/.test(plain)) return "";
  if (!/[぀-ゟ゠-ヿ]/.test(plain)) return "";
  return plain;
}

// ─── Build ───
async function main() {
  console.log("Initializing kuroshiro...");
  const kuro = await initKuroshiro();
  console.log("Kuroshiro ready.");

  const today = new Date().toISOString().slice(0, 10);
  const groups = discoverFiles();
  const marked = new Marked({ gfm: true, breaks: false });
  // No strikethrough: the notes write ranges as 越~越~ / 别说~就连~也, which GFM
  // would turn into <del>. Put the tildes back.
  marked.use({ renderer: { del(token) { const t = token.raw.startsWith("~~") ? "~~" : "~"; return t + this.parser.parseInline(token.tokens) + t; } } });

  const sidebarHtml = [];
  // Practice / mock test / flashcard links for a level that has questions.
  const quizPages = (level) => {
    if (!QUIZ_LINKS || !/^N[1-5]$/.test(level) || !loadQuizLevel(level).qs.length) return [];
    const lv = level.toLowerCase();
    return [
      { href: `${SITE_PATH}${lv}-practice/`, zh: "✍ 练习题", en: "✍ Practice questions" },
      fs.existsSync(path.join(__dirname, "questions", level, "mock-1")) && { href: `${SITE_PATH}${lv}-mock-test/`, zh: "⏱ 模拟题", en: "⏱ Mock test" },
      { href: `${SITE_PATH}${lv}-cards/`, zh: "🗂 语法卡片", en: "🗂 Grammar flashcards" },
    ].filter(Boolean);
  };
  const articlesHtml = [];
  const audioRequests = [];
  const audioSeen = new Set();
  const lessonPages = []; // for individual page generation
  let firstId = null;

  for (const group of groups) {
    const groupItems = [];
    for (const file of group.files) {
      const md = fs.readFileSync(file.path, "utf-8");
      const title = extractTitle(md);
      const shortTitle = title.length > 40 ? title.slice(0, 38) + "…" : title;
      const topLead = extractTopLead(md);
      const firstMeaningZh = topLead ? null : extractFirstMeaningZh(md);
      // English equivalents, used for the English-first SEO meta description.
      const topLeadEn = extractTopLeadEn(md);
      const firstMeaningEn = topLeadEn ? null : extractFirstMeaningEn(md);
      if (!firstId) firstId = file.id;

      // Pre-process bilingual blocks: :::zh ... ::: / :::en ... :::
      // Use HTML comments to avoid markdown parser issues, then replace after parsing
      const bilingualMd = md.replace(
        /^:::(zh|en)\s*\n([\s\S]*?)^:::\s*$/gm,
        (_, lang, content) => `<!--lang:${lang}:start-->\n${content.trim()}\n\n<!--lang:${lang}:end-->`
      );

      // Parse markdown to HTML
      let html = await marked.parse(bilingualMd);

      // Convert language markers to divs (with lang attribute for SEO)
      html = html.replace(/<!--lang:(zh|en):start-->/g, (_, lang) =>
        lang === "zh" ? '<div class="lang-zh" lang="zh-CN">' : '<div class="lang-en" lang="en">'
      );
      html = html.replace(/<!--lang:(zh|en):end-->/g, '</div>');

      // Bilingual headings: <h2>中文||English</h2>
      html = html.replace(
        /(<h[1-6][^>]*>)(.+?)\|\|(.+?)(<\/h[1-6]>)/g,
        (_, open, zh, en, close) =>
          `${open}<span class="lang-zh">${zh.trim()}</span><span class="lang-en">${en.trim()}</span>${close}`
      );

      // Bilingual table cells and list items: 中文//English. Inline markup is
      // fine on either side as long as it doesn't straddle the //; a "://"
      // (URL) never splits, and a task-list checkbox stays in front.
      html = html.replace(
        /(<(td|th|li)\b[^>]*>(?:<input[^>]*>\s*)?)([\s\S]*?)(<\/\2>)/g,
        (m, open, tag, body, close) => {
          if (tag === "li" && /<(ul|ol|li)\b/.test(body)) return m;
          const re = /(?<!:)\/\//g;
          let hit;
          while ((hit = re.exec(body))) {
            const before = body.slice(0, hit.index);
            if (before.lastIndexOf("<") <= before.lastIndexOf(">")) break;
          }
          if (!hit) return m;
          const zh = body.slice(0, hit.index).trim(), en = body.slice(hit.index + 2).trim();
          return `${open}<span class="lang-zh">${zh}</span><span class="lang-en">${en}</span>${close}`;
        }
      );

      // Add class to word tables (tables whose first row has 单词)
      html = html.replace(
        /(<table>[\s\S]*?<th>单词<\/th>[\s\S]*?<\/table>)/g,
        (match) => match.replace("<table>", '<table class="word-table">')
          .replace(/<th>单词<\/th>/, '<th><span class="lang-zh">单词</span><span class="lang-en">Word</span></th>')
          .replace(/<th>读音<\/th>/, '<th><span class="lang-zh">读音</span><span class="lang-en">Reading</span></th>')
          .replace(/<th>含义<\/th>/, '<th><span class="lang-zh">含义</span><span class="lang-en">Meaning</span></th>')
          // Meaning cells: "(POS) senses — note; 「搭配」 gloss; 「搭配」 gloss"
          // (zh: "senses（POS）——note；「搭配」gloss"). The part of speech gets
          // a tag, the note a muted line, and each 「…」 collocation its own
          // line; 「…」 becomes a colloc-ja span, which addFurigana annotates
          // even though the rest of the word table is skipped.
          .replace(/(<span class="lang-(?:zh|en)">)([^<]*)(<\/span>)/g, (m, open, text, close) => {
            const ja = (s) => s.replace(/「([^」]+)」/g, '<span class="colloc-ja" lang="ja">$1</span>');
            const note = text.match(/^(.*?)\s*(?: — |——)\s*(.+)$/);
            let head = note ? note[1] : text;
            head = head.replace(/^\(([^)]+)\)\s*/, '<span class="pos">$1</span> ')
              .replace(/（([^）]*(?:词|语|名)[^）]*)）$/, ' <span class="pos">$1</span>');
            if (!note) return `${open}${head}${close}`;
            const parts = note[2].split(/\s*[;；]\s*(?=「)/);
            const gloss = /^「/.test(parts[0]) ? "" : parts.shift();
            const collocs = parts.map((p) => `<span class="colloc">${ja(p.replace(/」\s*/, "」 "))}</span>`).join("");
            return open + head
              + (gloss ? `<span class="gloss-note">${ja(gloss)}</span>` : "")
              + (collocs ? `<span class="collocs">${collocs}</span>` : "") + close;
          })
      );
      // Answer toggles: "答案 / Answers" → one label per language; a bare
      // "答案" gets the English one.
      html = html.replace(/<summary>([^<\/]*?)\s*\/\s*([A-Za-z][^<]*)<\/summary>/g,
        (_, zh, en) => `<summary><span class="lang-zh">${zh.trim()}</span><span class="lang-en">${en.trim()}</span></summary>`);
      html = html.replace(/<summary>答案<\/summary>/g,
        '<summary><span class="lang-zh">答案</span><span class="lang-en">Answers</span></summary>');

      // a11y: marked emits <th> without scope, which Lighthouse flags on
      // large tables. All lesson tables are column-major (header row),
      // so scope="col" is always correct.
      html = html.replace(/<th(\s[^>]*)?>/g, (m, attrs) =>
        attrs && /\bscope=/.test(attrs) ? m : `<th${attrs || ""} scope="col">`
      );

      // a11y: dual-header tables — when the first <th> in <thead> is empty,
      // the first <td> in each <tbody> row is actually a row label
      // (e.g. "现在"/"过去" in conjugation tables). Promote those to
      // <th scope="row"> so screen readers can associate body cells with
      // both the column and row header.
      html = html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/g, (tableHtml) => {
        const thead = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/);
        if (!thead) return tableHtml;
        const firstTh = thead[1].match(/<th[^>]*>([\s\S]*?)<\/th>/);
        if (!firstTh || firstTh[1].trim() !== "") return tableHtml;
        return tableHtml.replace(/<tbody>([\s\S]*?)<\/tbody>/, (m, body) => {
          const newBody = body.replace(
            /<tr>(\s*)<td(\s[^>]*)?>([\s\S]*?)<\/td>/g,
            (mm, ws, attrs, content) => `<tr>${ws}<th scope="row"${attrs || ""}>${content}</th>`
          );
          return `<tbody>${newBody}</tbody>`;
        });
      });
      // Wide tables scroll sideways inside their own box on phones instead of
      // widening the whole page.
      html = html.replace(/<table\b[\s\S]*?<\/table>/g, (t) => `<div class="table-scroll">${t}</div>`);

      // Enable checklist checkboxes (remove disabled, add data attributes)
      let checkIdx = 0;
      html = html.replace(
        /<input (checked="" )?disabled="" type="checkbox">/g,
        (match, checked) => {
          const idx = checkIdx++;
          return `<input type="checkbox" data-lesson="${file.id}" data-idx="${idx}"${checked ? ' checked' : ''}>`;
        }
      );
      // Wrap each item in a <label> so the text names its checkbox (a11y) and
      // clicking the text ticks it.
      html = html.replace(/<li>(<input type="checkbox" data-lesson[^>]*>)([\s\S]*?)<\/li>/g, "<li><label>$1$2</label></li>");

      // Extract grammar points from h2 headings — feeds the per-level 速查表,
      // lesson pills, RSS descriptions, and SEO titles/descriptions.
      //
      // A heading "## N. <name>（中文释义）||English" becomes a grammar point
      // when its <name> (numbering + （…） gloss stripped) is one of:
      //   (a) a 〜/～ tilde pattern — the canonical grammar-pattern marker;
      //   (b) a standard conjugation-form name written in kanji
      //       (使役形 / 受身形 / 可能形 …) — these carry no kana of their own,
      //       so the old tilde/kana test silently dropped whole lessons
      //       (N4 18–20, N5 11, …) from the 速查表;
      //   (c) a kana 文型 tucked inside the （…） gloss
      //       (e.g. 动作的授受（〜てあげる/てもらう/てくれる）);
      //   (d) a short kana-dominant pattern like て形 / ます形.
      // Boilerplate / non-grammar sections (单词表・练习・复习计划・辨析・对比・
      // 图解・模板 …) are rejected via SECTION_NOISE. Tilde patterns are kept
      // unconditionally so a noise word in their gloss never drops them.
      const FORM_TERMS = /(使役受身形|使役形|受身形|受動形|可能形|意向形|意志形|命令形|禁止形|形容词副词化|形容詞副詞化)/;
      const SECTION_NOISE = /(单词表|本课单词|今日|练习|練習|复习计划|复习|总复习|总復習|总结|总览|総覧|辨析|对照表|对照|对比|三者|\bvs\b|图解|常见错误|整理|汇总|卡片|模板|套路|清单|策略|过渡指南|考点|考试策略|切换规则|不同表达|完整活用表|高頻)/i;
      const grammarPoints = [];
      const cleanPoints = [];
      // Same points for English pages: a label with Chinese in it
      // (形容词副词化, 〜そうだ ①— "看起来……") takes the heading's English
      // side instead, minus its numbering, (…) gloss and "— …" tail.
      const cleanPointsEn = [];
      const mdH2Regex = /^##\s+(.+)$/gm;
      let mdH2Match;
      while ((mdH2Match = mdH2Regex.exec(md)) !== null) {
        const headingText = mdH2Match[1].replace(/[#*`]/g, "").trim();
        // Use text before || on bilingual headings, then strip "1. " numbering.
        const rawName = (headingText.includes("||") ? headingText.split("||")[0] : headingText).trim();
        const name = rawName.replace(/^\d+[.、．]\s*/, "").trim();
        if (!name) continue;
        const outside = name.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
        const parenKana = name.match(/[（(]\s*([^（）()]*[〜～][^（）()]*?)\s*[）)]/);
        let label = null;
        if (/[〜～]/.test(outside)) {
          label = outside;                                  // (a) tilde pattern
        } else if (SECTION_NOISE.test(name)) {
          continue;                                         // boilerplate / non-grammar section
        } else if (FORM_TERMS.test(outside)) {
          label = outside;                                  // (b) kanji conjugation-form name
        } else if (parenKana) {
          label = parenKana[1].trim();                      // (c) kana 文型 lifted from （…）
        } else if (outside.length <= 8) {                   // (d) short kana-dominant pattern
          const kanaCount = (outside.match(/[぀-ゟ゠-ヿ]/g) || []).length;
          if (kanaCount >= 1 && kanaCount >= outside.length / 2 &&
              !/[的与和及或]/.test(outside) && !/(用法|应用|基本|形式)/.test(outside)) {
            label = outside;
          }
        }
        if (!label) continue;
        grammarPoints.push(name);
        cleanPoints.push(label);
        const enName = headingText.includes("||") ? headingText.split("||").pop() : "";
        const enLabel = enName.replace(/^\d+[.、．]\s*/, "").replace(/（[^）]*）|\([^)]*\)/g, "").split(/\s*[—–:]\s*/)[0].trim();
        cleanPointsEn.push(hasSC(label) && enLabel ? enLabel : label);
      }

      // Lesson meta line: last-updated date + reading time. Inserted right
      // after H1 so the freshness signal is visible to readers and Google
      // can extract it for the SERP snippet. Also fuels datePublished /
      // dateModified in the Article schema below.
      const lessonLastMod = gitLastMod(file.path) || today;
      const lessonFirstMod = gitFirstMod(file.path) || lessonLastMod;
      const readingMin = computeReadingTime(html);
      const lessonMetaHtml = `<div class="lesson-meta"><span class="lang-zh">📅 最后更新 <time datetime="${lessonLastMod}">${lessonLastMod}</time> · ⏱ 阅读约 ${readingMin} 分钟</span><span class="lang-en">📅 Updated <time datetime="${lessonLastMod}">${lessonLastMod}</time> · ⏱ ${readingMin} min read</span></div>`;
      html = html.replace(/(<\/h1>)/, `$1\n${lessonMetaHtml}`);

      // SEO lead paragraph: keyword-rich summary inserted after h1.
      // If the lesson markdown has its own top-of-file :::zh / :::en block,
      // mark those rendered divs with the seo-lead class instead of adding
      // a templated paragraph — this prevents lesson pages from starting with
      // near-identical "本课讲解 X 的接续规则…" boilerplate, which is what
      // makes Google flag pages as 已抓取-未编入索引.
      const groupLevel = group.label;
      if (topLead) {
        html = html.replace(
          /(<div class=")lang-zh(" lang="zh-CN">)/,
          "$1lang-zh seo-lead$2"
        );
        html = html.replace(
          /(<div class=")lang-en(" lang="en">)/,
          "$1lang-en seo-lead$2"
        );
      } else if (cleanPoints.length > 0) {
        const pointsZh = cleanPoints.slice(0, 6).map(p => `<strong>${p}</strong>`).join("、");
        const pointsEn = cleanPointsEn.slice(0, 6).map(p => `<strong>${p}</strong>`).join(", ");
        const seoLead = `<p class="seo-lead"><span class="lang-zh">本课讲解 ${groupLevel} 语法 ${pointsZh} 的接续规则、含义、例句辨析与易错点对比，配套练习题与 JLPT ${groupLevel} 备考要点。</span><span class="lang-en">This lesson covers the ${groupLevel} grammar points ${pointsEn}: how they conjugate, what they mean, example sentences, comparisons and common mistakes, plus practice questions for the JLPT ${groupLevel}.</span></p>`;
        html = html.replace(/(<\/h1>)/, `$1\n${seoLead}`);
      }

      // Add id attributes to h2 elements for direct linking (#5)
      html = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (match, attrs, content) => {
        // If bilingual (has lang-zh span), use only the zh text for slug
        const zhMatch = content.match(/<span class="lang-zh">([\s\S]*?)<\/span>/);
        let slugSource;
        if (zhMatch) {
          slugSource = zhMatch[1].replace(/<[^>]+>/g, "").trim();
        } else {
          slugSource = content.replace(/<[^>]+>/g, "").trim();
        }
        // Generate a clean id from the text
        const slug = slugSource.replace(/[\s\u3000]+/g, "_").replace(/[<>"'&]/g, "");
        return `<h2${attrs} id="${slug}">${content}</h2>`;
      });

      // Add furigana (kana-based detection)
      console.log(`  Processing ${file.id}...`);
      html = await addRomaji(kuro, html);
      html = await addFurigana(kuro, html);

      // Tag <li data-ja> example sentences with audio IDs. Practice sections
      // (and anything that isn't a model sentence: blanks, ❌ examples,
      // options, glosses, formulas, English) get no audio.
      let practiceH2 = false, practiceH3 = false;
      html = html.replace(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>|<li data-ja([^>]*)>([\s\S]*?)<\/li>/g, (match, hLevel, hContent, attrs, content) => {
        if (hLevel) {
          const isPractice = PRACTICE_HEADING.test(hContent.replace(/<[^>]+>/g, ""));
          if (hLevel === "2") { practiceH2 = isPractice; practiceH3 = false; }
          else practiceH3 = isPractice;
          return match;
        }
        if (/word-table/.test(attrs) || practiceH2 || practiceH3) return match;
        const plain = audioText(content);
        if (!plain) return match;
        const audioId = audioIdFor(plain);
        if (!audioSeen.has(audioId)) {
          audioSeen.add(audioId);
          audioRequests.push({ id: audioId, text: plain });
        }
        // The trailing (translation) goes on its own line under the sentence;
        // the brackets stay in the text (copy, AI quote cleaning) but are hidden.
        content = content.replace(/\s*([（(])([^（()）]+)([)）])\s*$/, (m, open, inner, close) =>
          `<span class="ex-tr"><span class="ex-p">${open}</span>${inner}<span class="ex-p">${close}</span></span>`);
        // Only show 🔊 once the mp3 exists (build-audio.py fills the gaps).
        if (!AUDIO_FILES.has(audioId)) return `<li data-ja data-ex${attrs}>${content}</li>`;
        return `<li data-ja data-ex${attrs} data-audio="${audioId}">${content}</li>`;
      });

      const lessonMatch = file.id.match(/^lesson(\d+)/);
      const lessonNum = lessonMatch ? lessonMatch[1] : "";
      const jaTitle = JA_TITLES[file.id];
      // Lessons: the number in its own column, so titles align and wrap
      // under themselves instead of under "Lesson".
      const sidebarTitle = jaTitle
        ? (lessonNum ? `<span class="nav-num">${lessonNum}</span><span class="nav-title">${jaTitle}</span>` : jaTitle)
        : shortTitle;
      groupItems.push(
        `<a class="nav-item" href="${SITE_PATH}${file.id}/" data-target="${file.id}">${sidebarTitle}</a>`
      );
      articlesHtml.push(
        `<article id="${file.id}" class="lesson">${html}</article>`
      );
      lessonPages.push({ id: file.id, title, sidebarTitle, html, jaTitle: jaTitle || shortTitle, filePath: file.path, grammarPoints, cleanPoints, cleanPointsEn, level: group.label, md, topLead, firstMeaningZh, topLeadEn, firstMeaningEn, lastMod: lessonLastMod, firstMod: lessonFirstMod, readingMin });
    }
    // Accordion group: clickable level header toggles its lesson list. The
    // first item is an "overview" link to the per-level /N{level}/ page (the
    // direct level link the old flat nav-group used to be).
    sidebarHtml.push(
      `<div class="nav-group-wrap" data-level="${group.label}">
    <button type="button" class="nav-group" aria-expanded="false"><span class="nav-group-label">${GROUP_NAMES[group.label] ? `<span class="lang-zh">${groupName(group.label, "zh")}</span><span class="lang-en">${groupName(group.label, "en")}</span>` : group.label}</span><span class="nav-caret" aria-hidden="true">▸</span></button>
    <div class="nav-group-items">
      <a class="nav-item nav-overview" href="${SITE_PATH}${group.label}/"><span class="lang-zh">${groupName(group.label, "zh")} 总览</span><span class="lang-en">${groupName(group.label, "en")} Overview</span></a>
      ${groupItems.join("\n      ")}
    </div>
  </div>`
    );
  }
  // 做题 group, like 专题: the practice hub, then each level's practice, mock test and flashcards.
  const practiceItems = QUIZ_LINKS ? QUIZ_LEVELS.flatMap((lv) => quizPages(lv).map((q) => ({ ...q, lv }))) : [];
  // 做题 and 专题 go first: they're the most-used entries, and collapsed each is one row.
  const guidesGroup = sidebarHtml.findIndex((g) => g.includes('data-level="guides"'));
  if (guidesGroup >= 0) sidebarHtml.unshift(...sidebarHtml.splice(guidesGroup, 1));
  if (practiceItems.length) sidebarHtml.unshift(`<div class="nav-group-wrap" data-level="practice">
    <button type="button" class="nav-group" aria-expanded="false"><span class="nav-group-label"><span class="lang-zh">做题</span><span class="lang-en">Practice</span></span><span class="nav-caret" aria-hidden="true">▸</span></button>
    <div class="nav-group-items">
      <a class="nav-item nav-overview" href="${SITE_PATH}practice/"><span class="lang-zh">做题总览</span><span class="lang-en">Practice hub</span></a>
      ${practiceItems.map((q) => `<a class="nav-item" href="${q.href}"><span class="lang-zh">${q.lv} ${q.zh.replace(/^\S+\s/, "")}</span><span class="lang-en">${q.lv} ${q.en.replace(/^\S+\s/, "")}</span></a>`).join("\n      ")}
    </div>
  </div>`);

  // ─── Cross-link related grammar points between lessons ───
  // Build an index: grammar term → { lessonId, slug }
  const grammarIndex = new Map(); // term → [{ id, slug }]
  const searchPoints = [];        // one entry per grammar-point section (for search)
  for (const lesson of lessonPages) {
    // Extract h2 ids from the lesson HTML
    const h2Regex = /<h2[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h2>/gi;
    let h2Match;
    let lessonPointCount = 0;
    while ((h2Match = h2Regex.exec(lesson.html)) !== null) {
      const slug = h2Match[1];
      // Prefer Chinese variant when bilingual heading (<span class="lang-zh">).
      let rawContent = h2Match[2];
      const zhSpan = rawContent.match(/<span class="lang-zh">([\s\S]*?)<\/span>/);
      const content = (zhSpan ? zhSpan[1] : rawContent).replace(/<[^>]+>/g, "").trim();
      // Description: first parenthesized note, used as anchor text suffix.
      const descMatch = content.match(/[（(]([^）)]+)[）)]/);
      const description = descMatch ? descMatch[1].trim() : null;
      const enSpan = rawContent.match(/<span class="lang-en">([\s\S]*?)<\/span>/);
      const descEnMatch = enSpan && enSpan[1].replace(/<[^>]+>/g, "").match(/[（(]([^）)]+)[）)]/);
      const descriptionEn = descEnMatch ? descEnMatch[1].trim() : null;
      // Grammar-point sections start with "N." per the lesson template.
      // Index each as one searchable point that deep-links to its anchor.
      if (/^\d+[.\．、]/.test(content)) {
        searchPoints.push({
          id: lesson.id,
          s: slug,
          t: content.replace(/^\d+[.\．、]\s*/, ""),
          l: lesson.level || "",
          c: lesson.jaTitle || "",
        });
        lessonPointCount++;
      }
      // Extract the grammar pattern (〜xxx or Japanese term)
      const patterns = content.match(/[〜～]?[\u3040-\u309f\u30a0-\u30ffー\u4e00-\u9fff]+/g) || [];
      for (const pat of patterns) {
        const hadTilde = /^[〜～]/.test(pat);
        const term = pat.replace(/^[〜～]/, "");
        if (term.length < 2) continue;
        // "て形应用" — a Japanese term run into the Chinese words after it.
        if (hasSC(term)) continue;
        // Filter to actual grammar terms: must have 〜 OR contain kana.
        // Pure-kanji words like "辨析" / "将来" / "状态" are noise — they're
        // Chinese vocabulary the page happens to use, not Japanese grammar.
        const hasKana = /[぀-ゟ゠-ヿ]/.test(term);
        if (!hadTilde && !hasKana) continue;
        // Skip generic section labels that show up across every lesson.
        if (/^(辨析|含义|用法|接続|接续|例句|練習|练习|本课|总结|计划|易错点)$/.test(term)) continue;
        // In an N1 heading, a bit in brackets (〜を皮切りに（して）, （よ）うが) is an optional part, not a pattern.
        if (lesson.level === "N1" && (/[（(]$/.test(content.slice(0, content.indexOf(pat))) || term.length < 2 || /^(して|うが|うと|よう)$/.test(term))) continue;
        if (!grammarIndex.has(term)) grammarIndex.set(term, []);
        // N1 patterns are often short kana (なり, べく, うが, して from 〜を皮切りに（して）)
        // that turn up in ordinary sentences, so links to them need the
        // pattern written as a pattern on the citing page (「なり」, 〜なり).
        grammarIndex.get(term).push({ id: lesson.id, slug, description, descriptionEn, level: lesson.level, strict: lesson.level === "N1" });
      }
    }
    // Lessons with no numbered points (checklists, 五十音, 总复习) stay
    // findable as a single lesson-level entry that jumps to the page top.
    if (lessonPointCount === 0) {
      searchPoints.push({ id: lesson.id, s: "", t: lesson.jaTitle || lesson.id, l: lesson.level || "", c: "" });
    }
  }

  // Guide pages link a pattern to its lesson ([〜たとたん](/lesson48/)); point
  // the link at that grammar point's heading when the lesson has one by that name.
  for (const g of lessonPages.filter((l) => l.level === "guides")) {
    g.html = g.html.replace(/<a href="\/(lesson\d+)\/">([^<]+)<\/a>/g, (m, id, text) => {
      const names = text.replace(/^[〜～]/, "").replace(/[（(][^）)]*[）)]/g, "").split(/[／/・、]/).map((t) => t.replace(/^[〜～]/, "").trim()).filter(Boolean);
      for (const n of names) {
        const loc = (grammarIndex.get(n) || []).find((l) => l.id === id);
        if (loc) return `<a href="/${id}/#${loc.slug}">${text}</a>`;
      }
      return m;
    });
  }

  // Insert cross-links: for each lesson, find references to grammar in other
  // lessons. Cap at 25 per lesson (up from 8) for denser internal linking —
  // Google's SEO guide treats internal links as a primary discovery signal.
  for (let li = 0; li < lessonPages.length; li++) {
    let html = lessonPages[li].html;
    const relatedLinks = new Set();
    const seenTerms = new Set();
    const candidates = [];
    for (const [term, locations] of grammarIndex) {
      if (seenTerms.has(term)) continue;
      const otherLocs = locations.filter(l => l.id !== lessonPages[li].id);
      if (otherLocs.length === 0) continue;
      const plainText = html.replace(/<h2[\s\S]*?<\/h2>/g, "").replace(/<(rt|rp)>[^<]*<\/\1>/g, "").replace(/<\/(td|th|li|p)>/g, " ").replace(/<[^>]+>/g, "");
      const loc = otherLocs[0];
      // A lesson that teaches a same-looking pattern itself (N3 〜といい) doesn't link to the N1 one.
      if (loc.strict && locations.some(l => l.id === lessonPages[li].id && !l.strict)) continue;
      const cited = loc.strict ? new RegExp(`(?:^|[「〜～\\s])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[」〜～、／/（(\\s]|$)`).test(plainText) : plainText.includes(term);
      if (cited) { candidates.push({ term, loc }); seenTerms.add(term); }
    }
    // Up to 25, nearest level first (an N1 page links N1/N2 grammar before
    // N5 basics; otherwise long pages fill up with だ・て・に); index order breaks ties.
    const LV = { N5: 5, N4: 4, N3: 3, N2: 2, N1: 1 }, here = LV[lessonPages[li].level];
    const dist = (c) => (here && LV[c.loc.level] ? Math.abs(here - LV[c.loc.level]) : 0);
    for (const { term, loc } of candidates.map((c, i) => ({ ...c, i, d: dist(c) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, 25)) {
      {
        // Descriptive anchor: pattern + (description + level tag) so the
        // link text tells readers and Google what the target page contains.
        const levelTag = loc.level ? `<span class="cross-link-level">${loc.level}</span>` : "";
        const short = (d, max) => (d && d.length > max ? d.slice(0, max - 1) + "…" : d || "");
        const descZh = short(loc.description, 14), descEn = short(loc.descriptionEn, 28);
        const descPart = (descZh ? `<span class="cross-link-desc lang-zh">${descZh}</span>` : "")
          + (descEn ? `<span class="cross-link-desc lang-en">${descEn}</span>` : "");
        const titleAttr = (loc.description
          ? `${loc.description} — ${loc.level || ""} ${loc.id}`
          : `${loc.level || ""} ${loc.id}`).trim();
        relatedLinks.add(`<a href="${SITE}${loc.id}/#${loc.slug}" class="cross-link" data-target="${loc.id}" data-scroll="${loc.slug}" title="${titleAttr.replace(/"/g, "&quot;")}"><span class="cross-link-term">${term}</span>${descPart}${levelTag}</a>`);
      }
    }
    if (relatedLinks.size > 0) {
      const relatedHtml = `<div class="related-grammar"><span class="related-label">関連文法:</span> ${[...relatedLinks].join(" ")}</div>`;
      // Insert before the last section (review schedule) or at the end
      const reviewIdx = html.lastIndexOf('<h2');
      if (reviewIdx > 0) {
        html = html.slice(0, reviewIdx) + relatedHtml + html.slice(reviewIdx);
      } else {
        html += relatedHtml;
      }
    }
    lessonPages[li].html = html;
    articlesHtml[li] = `<article id="${lessonPages[li].id}" class="lesson">${html}</article>`;
  }

  // ─── Site search (command palette) ───
  // The #search-btn in the sidebar toolbar and the "/" shortcut open a modal
  // that lazy-fetches search-index.json and filters lessons by title /
  // grammar-point term / level. Self-contained; relies only on window.gaEvent
  // (optional) and the prebuilt index.
  const SEARCH_JS = `<script>
(function() {
  var PATH = ${JSON.stringify(SITE_PATH)};
  var idx = null, loading = false, overlay, input, results, sel = -1;
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function ensureIndex() {
    if (idx || loading) return;
    loading = true;
    fetch(PATH + 'search-index.json').then(function(r){ return r.json(); })
      .then(function(d){ idx = d; loading = false; if (overlay && !overlay.hidden) render(input.value); })
      .catch(function(){ loading = false; });
  }
  function buildUI() {
    overlay = document.createElement('div');
    overlay.id = 'search-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div id="search-box" role="dialog" aria-modal="true" aria-label="搜索课程">' +
      '<input id="search-input" type="search" autocomplete="off" spellcheck="false" placeholder="搜索语法点或课程… / Search grammar or lessons…" aria-label="搜索">' +
      '<ul id="search-results"></ul>' +
      '<div id="search-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</div></div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('#search-input');
    results = overlay.querySelector('#search-results');
    overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
    input.addEventListener('input', function(){ render(input.value); });
    input.addEventListener('keydown', onKey);
    results.addEventListener('click', function(e){
      var a = e.target.closest && e.target.closest('a');
      if (a && window.gaEvent) window.gaEvent('search_select', { to: new URL(a.href).pathname });
    });
  }
  function render(q) {
    q = (q || '').trim().toLowerCase();
    sel = -1;
    if (!idx) { results.innerHTML = '<li class="search-empty">加载中… / Loading…</li>'; return; }
    var m;
    if (!q) { m = idx.slice(0, 12); }
    else {
      // Rank point-title (and level) hits above parent-lesson-context hits,
      // so the exact grammar point leads and its siblings follow.
      var inT = [], inC = [];
      for (var i = 0; i < idx.length; i++) {
        var r = idx[i];
        if ((r.t + ' ' + r.l).toLowerCase().indexOf(q) !== -1) inT.push(r);
        else if ((r.c || '').toLowerCase().indexOf(q) !== -1) inC.push(r);
      }
      m = inT.concat(inC).slice(0, 40);
    }
    if (!m.length) { results.innerHTML = '<li class="search-empty">无结果 / No results</li>'; return; }
    results.innerHTML = m.map(function(r){
      return '<li><a href="' + PATH + r.id + '/' + (r.s ? '#' + r.s : '') + '">' +
        '<span class="sr-lvl">' + esc(r.l) + '</span>' +
        '<span class="sr-title">' + esc(r.t) + '</span>' +
        (r.c ? '<span class="sr-pts">' + esc(r.c) + '</span>' : '') + '</a></li>';
    }).join('');
  }
  function setSel(n) {
    var as = results.querySelectorAll('a');
    if (!as.length) return;
    sel = (n + as.length) % as.length;
    for (var i=0;i<as.length;i++) as[i].classList.toggle('sel', i===sel);
    as[sel].scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(sel+1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(sel-1); }
    else if (e.key === 'Enter') { var as = results.querySelectorAll('a'); var a = sel >= 0 ? as[sel] : as[0]; if (a) location.href = a.href; }
  }
  function open() {
    if (window.jpnotesCloseSettings) window.jpnotesCloseSettings();
    if (!overlay) buildUI();
    ensureIndex();
    overlay.hidden = false;
    document.body.classList.add('search-open');
    input.value = ''; render('');
    setTimeout(function(){ input.focus(); }, 0);
    if (window.gaEvent) window.gaEvent('search_open', {});
  }
  function close() { if (overlay) { overlay.hidden = true; document.body.classList.remove('search-open'); } }
  document.addEventListener('keydown', function(e) {
    if (e.key === '/' && !/^(input|textarea|select)$/i.test(e.target.tagName || '') && !e.target.isContentEditable) { e.preventDefault(); open(); }
  });
  function bindBtn() {
    var b = document.getElementById('search-btn');
    if (!b) return;
    b.addEventListener('click', open);
    b.addEventListener('pointerenter', ensureIndex);
  }
  if (document.readyState !== 'loading') bindBtn();
  else document.addEventListener('DOMContentLoaded', bindBtn);
})();
</script>`;

  const ICON_SIDEBAR = loadIcon("sidebar.svg");
  const ICON_SEARCH = loadIcon("search.svg");
  const ICON_SHARE = loadIcon("share.svg");
  const ICON_CHAT = loadIcon("chat.svg");
  const ICON_SETTINGS = loadIcon("settings.svg");

  // ─── Shared sidebar markup ───
  // Used on home, lesson, and level pages so the directory is reachable
  // from anywhere. Sidebar links are root-relative so they work from any
  // subpath (e.g. clicking from /day01/ correctly navigates to /day05/).
  // Page footer, last thing inside <main> on every page (so localizePage()
  // strips the other language and points 关于 at /zh/about/ on zh copies).
  const siteFooterHtml = `<footer class="site-footer">
    <nav aria-label="footer">
      <a href="https://podcast.jpnotes.dev/" target="_blank">Podcast</a>
      <a href="${SITE_PATH}about/"><span class="lang-zh">关于</span><span class="lang-en">About</span></a>
      <a href="https://github.com/Ralphbupt" target="_blank">GitHub</a>
      <a href="https://liko.page/" target="_blank" rel="author">liko.page</a>
      <a href="#feedback" class="fb-open"><span class="lang-zh">💬 反馈</span><span class="lang-en">💬 Feedback</span></a>
    </nav>
    <p>© ${new Date().getFullYear()} <a href="https://jpnotes.dev/">jpnotes.dev</a> · <span class="lang-zh">内容采用 <a href="https://creativecommons.org/licenses/by/4.0/deed.zh-hans" rel="license">CC BY 4.0</a> 授权，转载请注明出处 jpnotes.dev</span><span class="lang-en">Content licensed <a href="https://creativecommons.org/licenses/by/4.0/" rel="license">CC BY 4.0</a> — please credit jpnotes.dev when you reuse it</span></p>
  </footer>
  <script src="${SITE_PATH}feedback.js?v=${FEEDBACK_JS_HASH}" defer></script>`;
  // Phones: a top bar (☰ stays the sidebar's own button, at its left end) with
  // search / AI / share / settings, so they don't hide inside the sidebar.
  const mobileBarHtml = `<div id="m-bar"><a id="m-title" href="${SITE_PATH}"></a>
    <button type="button" class="m-btn" data-m="search" aria-label="搜索 / Search">${ICON_SEARCH}</button>
    <button type="button" class="m-btn" data-m="ai" aria-label="问 AI / Ask AI" hidden>${ICON_CHAT}</button>
    <button type="button" class="m-btn" data-m="share" aria-label="分享 / Share">${ICON_SHARE}</button>
    <button type="button" class="m-btn" data-m="settings" aria-label="设置 / Settings">${ICON_SETTINGS}</button>
  </div>`;
  const sidebarMarkupHtml = `${mobileBarHtml}
<nav id="sidebar" class="collapsed">
  <div class="nav-tools">
    <button id="menu-toggle" type="button" class="nav-tool-btn" aria-label="显示/收起侧栏 / Toggle sidebar" title="显示/收起侧栏 / Toggle sidebar">${ICON_SIDEBAR}</button>
    <button id="search-btn" type="button" class="nav-tool-btn nav-tool-extra" aria-label="搜索 / Search" title="搜索 / Search ( / )">${ICON_SEARCH}</button>
    <button id="share-btn" type="button" class="nav-tool-btn nav-tool-extra" aria-label="分享 / Share" title="分享 / Share">${ICON_SHARE}</button>
    <button id="ai-btn" type="button" class="nav-tool-btn nav-tool-extra nav-tool-ai" aria-label="问 AI / Ask AI" title="问 AI / Ask AI">${ICON_CHAT}</button>
    <button id="settings-btn" type="button" class="nav-tool-btn nav-tool-extra" aria-label="设置 / Settings" title="设置 / Settings">${ICON_SETTINGS}</button>
  </div>
  <div class="nav-scroll">
  <div class="nav-header"><a href="${SITE_PATH}" style="color:inherit;text-decoration:none;"><span class="lang-zh">日语语法笔记</span><span class="lang-en">Japanese Grammar Notes</span></a></div>
  ${sidebarHtml.join("\n  ")}
  </div>
</nav>
<script>
// Shared sidebar behaviour (runs on every page): level accordion, active-item
// highlight + auto-scroll, and the menu toggle.
(function() {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Initial state: expanded on wide screens (>=1100px); collapsed on the home
  // page (its hero owns the layout) and on narrower screens. A manual toggle
  // is remembered across pages. HTML ships collapsed, so this only ever opens.
  try {
    var sbPref = localStorage.getItem('sb');          // '1' = collapsed, '0' = open
    var isHome = location.pathname === '${SITE_PATH}';   // <main> isn't parsed yet here
    // Phones (<=768px, where it overlays the page) always start closed.
    var startCollapsed = window.innerWidth <= 768 || (sbPref === null
      ? (isHome || window.innerWidth < 1100)
      : sbPref === '1');
    // Open it without the width animation: animating on load re-wraps every
    // item as the sidebar grows, which counts as layout shift (CLS).
    if (!startCollapsed) {
      sidebar.style.transition = 'none';
      requestAnimationFrame(function () { requestAnimationFrame(function () { sidebar.style.transition = ''; }); });
    }
    sidebar.classList.toggle('collapsed', startCollapsed);
    document.body.classList.toggle('sidebar-collapsed', startCollapsed);
  } catch (e) {}

  var wraps = sidebar.querySelectorAll('.nav-group-wrap');
  var path = location.pathname.replace(/\\/$/, '');
  var slug = path.split('/').pop();

  // Mark the current lesson/level entry active.
  var item = slug ? (sidebar.querySelector('a[data-target="' + slug + '"]')
          || sidebar.querySelector('.nav-group-wrap a[href$="/' + slug + '/"]')
          || sidebar.querySelector('a[href$="/' + slug + '/"]')) : null;
  if (item) item.classList.add('active');

  function setExpanded(w, on) {
    w.classList.toggle('expanded', on);
    var btn = w.querySelector('.nav-group');
    if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  // Open the group holding the active item; else the level named in the URL
  // (/N5/ or N5_grammar_list); else N5.
  var activeWrap = item ? item.closest('.nav-group-wrap') : null;
  if (!activeWrap) {
    var lvl = (path.match(/\\/(N[1-5])(?=\\b|\\/|_)/) || [])[1] || (slug && (slug.match(/^(N[1-5])/) || [])[1]);
    if (lvl) activeWrap = sidebar.querySelector('.nav-group-wrap[data-level="' + lvl + '"]');
  }
  if (!activeWrap && wraps.length) activeWrap = sidebar.querySelector('.nav-group-wrap[data-level="N5"]') || wraps[0];
  wraps.forEach(function(w){ setExpanded(w, w === activeWrap); });
  wraps.forEach(function(w){
    var btn = w.querySelector('.nav-group');
    if (btn) btn.addEventListener('click', function(){ setExpanded(w, !w.classList.contains('expanded')); });
  });

  // Menu toggle: expand/collapse sidebar + toolbar (same on desktop and mobile).
  var toggle = document.getElementById('menu-toggle');
  // On phones it works as a drawer: a backdrop that closes it, closed again
  // when a link is followed, no remembered state, and the back button closes
  // it (opening pushes a history entry).
  var phone = window.matchMedia ? matchMedia('(max-width: 768px)') : { matches: false };
  var backdrop = document.createElement('div');
  backdrop.id = 'sb-backdrop';
  document.body.appendChild(backdrop);
  function setOpen(open) {
    sidebar.classList.toggle('collapsed', !open);
    document.body.classList.toggle('sidebar-collapsed', !open);
    document.documentElement.classList.toggle('sb-lock', open && phone.matches);
  }
  function closeDrawer() {
    if (history.state && history.state.sb) history.back();   // popstate closes it
    else setOpen(false);
  }
  if (toggle) toggle.addEventListener('click', function(){
    var collapse = !sidebar.classList.contains('collapsed');
    if (phone.matches) {
      if (collapse) return closeDrawer();
      setOpen(true);
      try { history.pushState({ sb: 1 }, ''); } catch (e) {}
      return;
    }
    setOpen(!collapse);
    try { localStorage.setItem('sb', collapse ? '1' : '0'); } catch (e) {}
  });
  backdrop.addEventListener('click', closeDrawer);
  window.addEventListener('popstate', function () { if (phone.matches && !sidebar.classList.contains('collapsed')) setOpen(false); });
  window.addEventListener('pageshow', function (e) { if (e.persisted && phone.matches) setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && phone.matches && !sidebar.classList.contains('collapsed')) closeDrawer(); });
  // Following a link: replace the drawer's history entry, so Back from the
  // next page goes straight to this one.
  sidebar.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a || !phone.matches || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    if (history.state && history.state.sb) { e.preventDefault(); location.replace(a.href); }
    else setOpen(false);
  });

  // Lesson → practice links: which one gets clicked (top / point / end).
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-ql]');
    if (a && window.gaEvent) window.gaEvent('quiz_link', { where: a.getAttribute('data-ql'), page: location.pathname });
  });

  // Phone top bar: where you are (links to the level overview), the tool
  // buttons, and it slides away while scrolling down.
  var mbar = document.getElementById('m-bar');
  if (mbar) {
    var mt = document.getElementById('m-title'), head = sidebar.querySelector('.nav-header a');
    var lvl = activeWrap && activeWrap.getAttribute('data-level');
    if (item) {
      var label = item.textContent.replace(/\\s+/g, ' ').trim().replace(/^(\\d+)(?=\\S)/, '$1 ');
      mt.textContent = (lvl && label.indexOf(lvl) !== 0 ? lvl + ' · ' : '') + label;
      var over = activeWrap && activeWrap.querySelector('a[href]');
      mt.href = over && over !== item ? over.getAttribute('href') : (head ? head.getAttribute('href') : mt.href);
    } else if (head) { mt.innerHTML = head.innerHTML; mt.href = head.getAttribute('href'); }
    // The AI script tag comes later in the page than this one.
    document.addEventListener('DOMContentLoaded', function () {
      if (document.querySelector('script[src*="ai-assistant.js"]') && document.getElementById('ai-btn')) mbar.querySelector('[data-m="ai"]').hidden = false;
    });
    mbar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]');
      if (!b) return;
      var m = b.getAttribute('data-m');
      if (m === 'share') { e.stopPropagation(); if (window.jpShare) window.jpShare({ src: 'mbar', anchor: b }); return; }
      var target = document.getElementById({ search: 'search-btn', ai: 'ai-btn', settings: 'settings-btn' }[m]);
      if (target) target.click();
    });
    var lastY = window.scrollY;
    window.addEventListener('scroll', function () {
      var y = window.scrollY, dy = y - lastY;
      if (Math.abs(dy) < 6) return;
      lastY = y;
      var hide = phone.matches && dy > 0 && y > 120 && sidebar.classList.contains('collapsed') && !document.body.classList.contains('ai-open');
      document.documentElement.classList.toggle('mbar-hidden', hide);
    }, { passive: true });
  }

  // Center the active item so the user lands on their place in a long list.
  if (item) {
    var scroll = sidebar.querySelector('.nav-scroll');
    if (scroll) {
      (function centerItem() {
        var navH = scroll.clientHeight;
        if (navH <= 0) { requestAnimationFrame(centerItem); return; }
        var top = item.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
        scroll.scrollTop = Math.max(0, top - navH * 0.4 + item.offsetHeight / 2);
      })();
    }
  }
})();
${TTS_JS}
</script>
${SEARCH_JS}
${SETTINGS_SCRIPT}`;

  // ─── Home page main content ───
  // Don't inline every lesson article into index.html (3.98MB → ~50KB).
  // Replace with a landing-page layout: hero + level cards + how-to.
  // Sidebar links already point to standalone /dayXX/ pages.
  const levelCounts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0 };
  const levelRange = { N5: {}, N4: {}, N3: {}, N2: {}, N1: {} };
  let totalPoints = 0;
  let totalLessons = 0;
  for (const l of lessonPages) {
    totalPoints += (l.cleanPoints || []).length;
    if (/^lesson\d+/.test(l.id) && levelCounts.hasOwnProperty(l.level)) {
      levelCounts[l.level]++;
      totalLessons++;
      const n = l.id.match(/^lesson(\d+)/)[1];
      const r = levelRange[l.level];
      if (!r.first || n < r.first) r.first = n;
      if (!r.last || n > r.last) r.last = n;
    }
  }
  const rangeLabel = (lv, lang) => lang === "zh"
    ? `第 ${levelRange[lv].first}–${levelRange[lv].last} 课`
    : `Lessons ${levelRange[lv].first}–${levelRange[lv].last}`;
  const homeMainHtml = `<header class="home-hero">
    <h1><span class="lang-zh">日语语法笔记 — JLPT N5 到 N1 全部语法</span><span class="lang-en">Japanese Grammar Notes — JLPT N5 to N1</span></h1>
    <p class="home-intro">
      <span class="lang-zh">免费、双语（中文 + 日语）的日语语法笔记，从 N5 到 N1 共 <strong>${totalLessons} 课、${totalPoints}+ 语法点</strong>，每课配接续规则、例句、辨析、练习题与间隔复习勾选清单。</span>
      <span class="lang-en">Free Japanese grammar notes in plain English, covering JLPT N5 → N1 in <strong>${totalLessons} lessons, ${totalPoints}+ grammar points</strong>. Each lesson has conjugation rules, example sentences, side-by-side comparisons of confusable patterns, practice questions, and a spaced-repetition checklist.</span>
    </p>
    <div class="home-actions">
      <a class="btn-primary" href="lesson01/"><span class="lang-zh">从第 1 课开始</span><span class="lang-en">Start with lesson 1</span></a>
      <a class="btn-secondary" href="anki/"><span class="lang-zh">下载 Anki 卡组</span><span class="lang-en">Get the Anki decks</span></a>${quizPages("N5").length ? `
      <a class="btn-secondary" href="practice/"><span class="lang-zh">做题 · 模拟 · 卡片</span><span class="lang-en">Practice, mock tests &amp; flashcards</span></a>` : ""}
    </div>
  </header>
  <section class="home-levels">
    <h2><span class="lang-zh">按级别学习</span><span class="lang-en">Browse by JLPT level</span></h2>
    <div class="level-grid">
      <a class="level-card" href="N5/">
        <span class="level-head"><span class="level-tag">N5</span><span class="level-range"><span class="lang-zh">${rangeLabel("N5", "zh")}</span><span class="lang-en">${rangeLabel("N5", "en")}</span></span></span>
        <h3><span class="lang-zh">入门基础</span><span class="lang-en">Beginner foundations</span></h3>
        <p>
          <span class="lang-zh">判断句、助词、动词分类、て形、ない形、た形、形容词、条件、可能/受身。共 ${levelCounts.N5} 课。</span>
          <span class="lang-en">Copula sentences, particles, verb groups, て-form, ない-form, た-form, adjectives, conditionals, potential/passive. ${levelCounts.N5} lessons.</span>
        </p>
      </a>
      <a class="level-card" href="N4/">
        <span class="level-head"><span class="level-tag">N4</span><span class="level-range"><span class="lang-zh">${rangeLabel("N4", "zh")}</span><span class="lang-en">${rangeLabel("N4", "en")}</span></span></span>
        <h3><span class="lang-zh">日常进阶</span><span class="lang-en">Everyday intermediate</span></h3>
        <p>
          <span class="lang-zh">使役、受身、授受表现、ように系列、ことにする/なる、わけだ/ものだ 等核心日常语法。共 ${levelCounts.N4} 课。</span>
          <span class="lang-en">Causative, passive, giving/receiving, ように patterns, ことにする/なる, わけだ/ものだ, and other daily-use grammar. ${levelCounts.N4} lessons.</span>
        </p>
      </a>
      <a class="level-card" href="N3/">
        <span class="level-head"><span class="level-tag">N3</span><span class="level-range"><span class="lang-zh">${rangeLabel("N3", "zh")}</span><span class="lang-en">${rangeLabel("N3", "en")}</span></span></span>
        <h3><span class="lang-zh">书面分水岭</span><span class="lang-en">Written-Japanese watershed</span></h3>
        <p>
          <span class="lang-zh">书面助词、原因理由、逆接让步、程度范围、状态样态、否定与复合表达。共 ${levelCounts.N3} 课。</span>
          <span class="lang-en">Formal particles, cause/reason, concession, degree/range, state/appearance, negation, and compound expressions. ${levelCounts.N3} lessons.</span>
        </p>
      </a>
      <a class="level-card" href="N2/">
        <span class="level-head"><span class="level-tag">N2</span><span class="level-range"><span class="lang-zh">${rangeLabel("N2", "zh")}</span><span class="lang-en">${rangeLabel("N2", "en")}</span></span></span>
        <h3><span class="lang-zh">商务・学术</span><span class="lang-en">Business · academic</span></h3>
        <p>
          <span class="lang-zh">高阶逆接、程度限定、判断主张、对比关系、感情表达、书面专用语法。共 ${levelCounts.N2} 课。</span>
          <span class="lang-en">Advanced concession, degree/limit, assertion, contrast, emotional expressions, and written-only grammar. ${levelCounts.N2} lessons.</span>
        </p>
      </a>${levelCounts.N1 ? `
      <a class="level-card" href="N1/">
        <span class="level-head"><span class="level-tag">N1</span><span class="level-range"><span class="lang-zh">${rangeLabel("N1", "zh")}</span><span class="lang-en">${rangeLabel("N1", "en")}</span></span></span>
        <h3><span class="lang-zh">报刊・论说文</span><span class="lang-en">News · essays · literature</span></h3>
        <p>
          <span class="lang-zh">时点、限定、强调极限、文语与书面表达、评价判断、感情强调——报刊和论说文里的高阶语法。共 ${levelCounts.N1} 课。</span>
          <span class="lang-en">Timing, limits, extremes, classical and written forms, evaluation, emphatic emotion — the grammar of newspapers, essays and literature. ${levelCounts.N1} lessons.</span>
        </p>
      </a>` : ""}
    </div>
  </section>
  <section class="home-howto">
    <h2><span class="lang-zh">使用方法</span><span class="lang-en">How to use</span></h2>
    <p>
      <span class="lang-zh">每节课包含 <strong>接续 / 含义 / 例句 / 辨析 / 易错点</strong> 五个部分，配套练习题与按间隔复习的勾选清单（当天 → 1 天 → 4 天 → 7 天 → 14 天 → 30 天）。</span>
      <span class="lang-en">Each lesson covers <strong>conjugation / meaning / examples / comparisons / common mistakes</strong>, plus practice questions and a spaced-repetition checklist (day 0 → 1 → 4 → 7 → 14 → 30).</span>
    </p>
    <p>
      <span class="lang-zh">从级别概览页（<a href="N5/">N5</a> · <a href="N4/">N4</a> · <a href="N3/">N3</a> · <a href="N2/">N2</a>${levelCounts.N1 ? ` · <a href="N1/">N1</a>` : ""}）查看完整语法清单，在 <a href="grammar/">日语语法大全</a> 一页看全部语法点，或从侧栏直接进入任意一课。</span>
      <span class="lang-en">Browse the per-level index pages (<a href="N5/">N5</a> · <a href="N4/">N4</a> · <a href="N3/">N3</a> · <a href="N2/">N2</a>${levelCounts.N1 ? ` · <a href="N1/">N1</a>` : ""}), see every grammar point on one page in the <a href="grammar/">Japanese grammar list</a>, or jump to any lesson via the sidebar.</span>
    </p>
    <p>
      <span class="lang-zh">总分不清 <a href="wa-vs-ga/">は和が</a>、<a href="kara-vs-node/">から和ので</a>？<a href="guides/">专题页</a>把最容易混的语法放在一起对比；12 月考试前看 <a href="jlpt-december-2026/">JLPT 考前指南</a>。</span>
      <span class="lang-en">Mixing up <a href="wa-vs-ga/">は vs が</a> or <a href="kara-vs-node/">から vs ので</a>? The <a href="guides/">guides</a> put confusable patterns side by side; sitting the December exam? See the <a href="jlpt-december-2026/">JLPT exam guide</a>.</span>
    </p>
    <p>
      <span class="lang-zh">用 Anki 复习？下载 <a href="anki/">免费 JLPT N5–N1 文法卡组</a>（共 {{ANKI_CARDS}} 张，原生 TSV 一键导入）。</span>
      <span class="lang-en">Use Anki for review? Download the <a href="anki/">free JLPT N5–N1 grammar decks</a> ({{ANKI_CARDS}} cards, native TSV one-click import).</span>
    </p>
    <p>
      <span class="lang-zh">想练听力？试试 <a href="https://podcast.jpnotes.dev/" target="_blank">Japanese Daily News 播客</a>——慢速日语新闻 + 英语解说，配套逐句精听与 transcript。</span>
      <span class="lang-en">Want listening practice? Try the <a href="https://podcast.jpnotes.dev/" target="_blank">Japanese Daily News podcast</a> — slow Japanese news with English commentary, plus sentence-by-sentence listening and transcripts.</span>
    </p>
  </section>`;

  // ─── Assemble ───
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Japanese Grammar Notes — Free JLPT N5 to N1 Grammar Lessons | 日语语法笔记</title>
<meta name="description" content="Free JLPT N5–N1 Japanese grammar lessons: every grammar point with conjugation rules, example sentences with audio, comparisons of confusable patterns, practice questions and Anki decks. 中文版：免费日语语法笔记，N5 到 N1。">
<meta name="keywords" content="Japanese grammar, JLPT N2, N5, N4, N3, 日语语法, 日本語文法, grammar notes, spaced repetition, 语法笔记">
<link rel="canonical" href="${SITE}">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="Japanese Grammar Notes | 日语语法笔记 – N5→N1">
<meta property="og:description" content="Free JLPT N5–N1 Japanese grammar lessons with conjugation rules, example sentences with audio, comparisons and Anki decks.">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ja_JP">
<meta property="og:locale:alternate" content="zh_CN">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Japanese Grammar Notes | 日语语法笔记 – N5→N1">
<meta name="twitter:description" content="Free JLPT N5–N1 Japanese grammar lessons with examples, audio, comparisons and Anki decks.">
<meta name="twitter:image" content="${SITE}og-image.png">

<!-- Structured Data -->
<meta http-equiv="Content-Language" content="ja, zh-CN">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "Course",
  "name": "Japanese Grammar Notes – N5 to N1",
  "description": "Free structured Japanese grammar notes covering JLPT N5 to N1, with bilingual explanations, example sentences, and spaced repetition.",
  "provider": { "@type": "Person", "name": "Ralphbupt" },
  "inLanguage": ["ja", "zh-CN"],
  "educationalLevel": "Beginner to Intermediate",
  "about": { "@type": "Thing", "name": "Japanese Language Grammar" },
  "isAccessibleForFree": true,
  "image": "${SITE}og-image.png",
  "url": "${SITE}",
  "hasCourseInstance": {
    "@type": "CourseInstance",
    "courseMode": "online",
    "courseWorkload": "P8W"
  },
  "numberOfLessons": ${lessonPages.length}
},
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "日语语法笔记 – Japanese Grammar Notes",
  "url": "${SITE}",
  "inLanguage": ["ja", "zh-CN"]
}]
</script>

<link rel="icon" href="${SITE_PATH}favicon.ico" sizes="32x32">
<link rel="icon" href="${SITE_PATH}favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${SITE_PATH}favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${SITE_PATH}apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="Japanese Grammar Notes RSS" href="${SITE}feed.xml">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#1a1a2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="日语文法">

${CSP_META}
${CLONE_GUARD}
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
${SPECULATION_RULES}
${SW_REGISTER}
<style>
${CSS}
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content" class="home">
  ${homeMainHtml}
  ${siteFooterHtml}
</main>
<script>
${APP_PREFS_JS}
</script>
${AI_SCRIPT}
</body>
</html>`;

  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, OUT), fullHtml, "utf-8");

  // Write audio request list for build-audio.py
  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "dist", ".audio-requests.json"),
    JSON.stringify(audioRequests),
    "utf-8"
  );
  console.log(`  Tagged ${audioRequests.length} sentences with audio IDs.`);

  // ─── Search index ───
  // Lazy-fetched by the search modal on first open (keeps every page light).
  // One record per grammar point: id + slug (deep-link anchor), point title,
  // level, and the parent lesson title as context. Built in the h2 loop above.
  fs.writeFileSync(
    path.join(__dirname, "dist", "search-index.json"),
    JSON.stringify(searchPoints),
    "utf-8"
  );
  console.log(`  Wrote search-index.json (${searchPoints.length} grammar points).`);
  fs.writeFileSync(path.join(__dirname, "dist", "ai-assistant.js"), AI_JS_BUNDLE, "utf-8");
  fs.copyFileSync(path.join(__dirname, "site", "settings-modal.js"), path.join(__dirname, "dist", "settings-modal.js"));
  // QR codes for the share menu's 微信扫一扫 (loaded only when it's opened).
  fs.copyFileSync(require.resolve("qrcode-generator/qrcode.js"), path.join(__dirname, "dist", "qrcode.js"));
  fs.copyFileSync(path.join(__dirname, "site", "sw.js"), path.join(__dirname, "dist", "sw.js"));
  for (const f of ["giscus-paper.css", "giscus-sepia.css"]) {
    fs.copyFileSync(path.join(__dirname, "site", f), path.join(__dirname, "dist", f));
  }
  // Real icon files: Google's result favicon needs a crawlable URL, not a data: URI
  for (const f of fs.readdirSync(path.join(__dirname, "site", "icons"))) {
    fs.copyFileSync(path.join(__dirname, "site", "icons", f), path.join(__dirname, "dist", f));
  }

  // ─── Generate individual lesson pages ───
  // Pages published once per language (PAGE_LANGS); links to them on a
  // non-root copy point at that language's copy.
  const localizedPageIds = new Set([...lessonPages.map(l => l.id), "N5", "N4", "N3", "N2", "N1", "guides", "grammar", "about", "practice", ...["n5", "n4", "n3", "n2", "n1"].flatMap((l) => [`${l}-practice`, `${l}-mock-test`, `${l}-cards`])]);
  // "Practice this point" at the end of every grammar point that has practice
  // questions (questions/N*/lessonNN.json refs), linking to the practice page.
  const quizRefCount = {};
  if (QUIZ_LINKS) for (const lv of QUIZ_LEVELS) {
    for (const q of loadQuizLevel(lv).qs) for (const r of q.refs || []) if (/#\d+$/.test(r)) quizRefCount[`${lv}:${r}`] = (quizRefCount[`${lv}:${r}`] || 0) + 1;
  }
  const quizLessonCount = {};
  if (QUIZ_LINKS) for (const lv of QUIZ_LEVELS) {
    for (const q of loadQuizLevel(lv).qs) {
      // Grammar questions, and vocabulary questions on a word from the lesson's table.
      const ref = q._kind === "lesson" ? q.refs[0] : (q.refs || []).find((r) => /#vocab$/.test(r));
      if (ref) { const l = ref.split("#")[0]; quizLessonCount[`${lv}:${l}`] = (quizLessonCount[`${lv}:${l}`] || 0) + 1; if (q._kind !== "lesson") quizLessonCount[`${lv}:${l}:vocab`] = 1; }
      // Also practice questions of the level its grammar belongs to (ABOVE_LEVEL).
      const up = q._kind === "lesson" && aboveLevel(lv, q);
      if (up) { const l = q.refs[0].split("#")[0]; quizLessonCount[`${up}:${l}`] = (quizLessonCount[`${up}:${l}`] || 0) + 1; }
    }
  }
  const mockLevels = QUIZ_LEVELS.filter((lv) => fs.existsSync(path.join(__dirname, "questions", lv, "mock-1")));
  const addQuizLinks = (html, id, level) => {
    if (!QUIZ_LINKS) return html;
    // JLPT guide: after "时间分配", a pointer to the timed mock tests.
    if (/^jlpt-/.test(id) && mockLevels.length) {
      return html.split(/(?=<h2[\s>])/).map((part) => {
        if (!/^<h2[^>]*\bid="时间分配/.test(part)) return part;
        const links = mockLevels.map((lv) => `<a href="${SITE_PATH}${lv.toLowerCase()}-mock-test/">⏱ ${lv} <span class="lang-zh">模拟题</span><span class="lang-en">mock test</span></a>`).join(" ");
        const link = `<p class="quiz-link"><span class="lang-zh">用计时模拟题练时间分配：</span><span class="lang-en">Practise your timing with a timed mock test:</span> ${links}</p>\n`;
        const hr = part.match(/<hr\s*\/?>\s*$/);
        return hr ? part.slice(0, hr.index) + link + hr[0] : part + link;
      }).join("");
    }
    if (!/^N[1-5]$/.test(level)) return html;
    // Whole lesson: before 复习计划 (or at the end).
    const total = quizLessonCount[`${level}:${id}`];
    const lessonHref = `${SITE_PATH}${level.toLowerCase()}-practice/#lesson=${id}`;
    const withVocab = quizLessonCount[`${level}:${id}:vocab`];
    const hasEx = /<h2[^>]*\bid="(练习|今日练|今日練)/.test(html);
    // At the end of the lesson, a card after the last point (the owner chose
    // the end over a button under the title, 2026-10-30); each point also gets
    // its own link. data-ql says which one was clicked (GA quiz_link).
    const lessonLink = total ? `<div class="quiz-cta"><p><span class="lang-zh">${hasEx ? "课里的练习做完了？" : "学完这一课？"}再做 ${total} 道 JLPT 题型的在线题${withVocab ? "（语法 + 词汇）" : ""}：点了就判分、每题有解析，错题会自动记下来。</span><span class="lang-en">${hasEx ? "Done with the exercises above?" : "Finished the lesson?"} Try ${total} JLPT-style questions online${withVocab ? " (grammar + vocabulary)" : ""}: marked as you go, each explained, and the ones you miss are saved for review.</span></p><a href="${lessonHref}" data-ql="end">✍ <span class="lang-zh">在线做题</span><span class="lang-en">Practise online</span> →</a></div>\n` : "";
    // Lessons that teach a higher level's grammar early (ABOVE_LEVEL in
    // build-quiz.js) say so, and point to that level's practice, which has
    // these questions as ordinary ones.
    const above = ABOVE_LEVEL[level] || {};
    const byLevel = {};
    if (above[id]) byLevel[above[id]] = ["all"];
    for (const [ref, lv] of Object.entries(above)) {
      const [lid, k] = ref.split("#");
      if (lid === id && k && lv !== above[id]) (byLevel[lv] = byLevel[lv] || []).push(k);
    }
    const notes = Object.entries(byLevel).map(([lv, ks]) => {
      const href = `${SITE_PATH}${lv.toLowerCase()}-practice/#lesson=${id}`;
      const zh = ks[0] === "all" ? `本课的语法在 JLPT 里属于 ${lv}，这里提前学` : `本课第 ${ks.join("、")} 点在 JLPT 里属于 ${lv}，这里提前学`;
      const en = ks[0] === "all" ? `This lesson's grammar is JLPT ${lv} level, taught early here` : `Point${ks.length > 1 ? "s" : ""} ${ks.join(", ")} of this lesson ${ks.length > 1 ? "are" : "is"} JLPT ${lv} level, taught early here`;
      return `<span class="lang-zh">${zh}${quizLessonCount[`${lv}:${id}`] ? `，<a href="${href}">${lv} 练习题</a>里也有本课的题` : ""}。</span><span class="lang-en">${en}${quizLessonCount[`${lv}:${id}`] ? `; its questions are in the <a href="${href}">${lv} practice</a> too` : ""}.</span>`;
    });
    if (notes.length) html = html.replace(/(<div class="lesson-meta">[\s\S]*?<\/div>\n?)/, `$1<p class="level-note">${notes.join(" ")}</p>\n`);
    let lessonLinkPlaced = !lessonLink;
    const out = html.split(/(?=<h2[\s>])/).map((part) => {
      if (!lessonLinkPlaced && /^<h2[^>]*\bid="复习计划/.test(part)) { lessonLinkPlaced = true; return lessonLink + part; }
      const k = (part.match(/^<h2[^>]*\bid="(\d+)\._/) || [])[1];
      const n = k && quizRefCount[`${level}:${id}#${k}`];
      if (!n) return part;
      // Before the section's closing <hr>, so it reads as part of the point.
      const link = `<p class="quiz-link"><a href="${SITE_PATH}${level.toLowerCase()}-practice/#ref=${id}.${k}" data-ql="point">✍ <span class="lang-zh">练这个语法点（${n} 题）</span><span class="lang-en">Practice this point (${n} questions)</span></a></p>\n`;
      const hr = part.match(/<hr\s*\/?>\s*$/);
      return hr ? part.slice(0, hr.index) + link + hr[0] : part + link;
    }).join("");
    return lessonLinkPlaced ? out : out + lessonLink;
  };
  for (let li = 0; li < lessonPages.length; li++) {
    const lesson = lessonPages[li];
    // Prev/next stay inside the course or inside the guides, never across.
    const sameKind = (l) => l && (l.level === "guides") === (lesson.level === "guides");
    const prevLesson = sameKind(lessonPages[li - 1]) ? lessonPages[li - 1] : null;
    const nextLesson = sameKind(lessonPages[li + 1]) ? lessonPages[li + 1] : null;
    // SEO-friendly English-first title & description targeting English-speaking
    // JLPT learners. The Japanese grammar terms (cleanPoints) are kept verbatim
    // since learners search them directly (e.g. "おかげで grammar"); the wrapper
    // copy around them is English.
    const lessonLevel = lesson.level || "";
    const cleanPoints = lesson.cleanPoints || [];
    const cleanPointsEn = lesson.cleanPointsEn || cleanPoints;
    // English side of the bilingual "日本語||English" H1, for the no-points title.
    const enTitle = (lesson.title.includes("||")
      ? lesson.title.split("||").pop()
      : lesson.jaTitle).replace(/^Lesson\s+\d+\s*[–—-]\s*/i, "").trim();
    const seo = SEO_TITLES[lesson.id] || {};
    // Guides aren't a JLPT level; their seo entry may name the level they target.
    const schemaLevel = seo.level || (GROUP_NAMES[lessonLevel] ? "N5–N1" : lessonLevel);
    let lessonTitle, lessonDesc;
    if (seo.en) {
      lessonTitle = seo.en;
    } else if (cleanPointsEn.length >= 2) {
      const titlePoints = cleanPointsEn.slice(0, 2).join(", ");
      lessonTitle = `${titlePoints} — JLPT ${lessonLevel} Japanese Grammar | Usage & Examples`;
    } else if (cleanPointsEn.length === 1) {
      lessonTitle = `${cleanPointsEn[0]} — JLPT ${lessonLevel} Japanese Grammar Explained with Examples`;
    } else {
      lessonTitle = `${enTitle} | JLPT ${lessonLevel} Japanese Grammar Notes`;
    }
    // Prefer the lesson's hand-written :::en lead as the unique hook, then
    // fall back to the first Meaning section's :::en content. Whichever we get is
    // lengthened with a per-lesson templated supplement when it would be too
    // short for SEO — Bing flags very short meta descriptions.
    const descHook = lesson.topLeadEn
      ? leadToPlainText(lesson.topLeadEn, 158)
      : lesson.firstMeaningEn
      ? leadToPlainText(lesson.firstMeaningEn, 158)
      : "";
    lessonDesc = seo.desc || buildLessonDesc(descHook, cleanPointsEn, schemaLevel);

    // Auto-generate English-first keywords (override hardcoded LESSON_KEYWORDS).
    // Japanese grammar terms are retained as keywords — learners search them.
    const autoKeywords = [
      `JLPT ${schemaLevel} grammar`,
      `${schemaLevel} grammar`,
      `JLPT ${schemaLevel}`,
      `learn Japanese ${schemaLevel}`,
      ...cleanPointsEn.slice(0, 4).flatMap(p => [`${p} grammar`, `${p} meaning`, `${p} examples`]),
      cleanPointsEn.length >= 2 ? `${cleanPointsEn[0]} vs ${cleanPointsEn[1]}` : null,
      "Japanese grammar",
      "Japanese grammar notes",
    ].filter(Boolean);
    // Append any hand-curated English keywords for extra coverage.
    const existingKw = LESSON_KEYWORDS[lesson.id] || "";
    const lessonKeywords = [...autoKeywords, existingKw].filter(Boolean).join(", ");

    const ogImageUrl = `${SITE}${lesson.id}/og-image.png`;

    // Prev/next navigation HTML
    const prevHtml = prevLesson
      ? `<a class="pn-link pn-prev" href="${SITE}${prevLesson.id}/">← ${prevLesson.jaTitle}</a>`
      : `<span class="pn-link pn-prev"></span>`;
    const nextHtml = nextLesson
      ? `<a class="pn-link pn-next" href="${SITE}${nextLesson.id}/">${nextLesson.jaTitle} →</a>`
      : `<span class="pn-link pn-next"></span>`;

    // #3: rel prev/next links
    const prevLink = prevLesson ? `\n<link rel="prev" href="${SITE}${prevLesson.id}/">` : "";
    const nextLink = nextLesson ? `\n<link rel="next" href="${SITE}${nextLesson.id}/">` : "";

    const renderLessonPage = (v) => `<!DOCTYPE html>
<html lang="${v.htmlLang}"${v.htmlAttrs}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>${LANG_REDIRECT_JS}</script>
<title>${v.title}</title>
<meta name="description" content="${v.desc.replace(/"/g, '&quot;')}">
<meta name="keywords" content="${v.keywords.replace(/"/g, '&quot;')}">
<link rel="canonical" href="${v.url}">${v.headLinks}
<meta property="og:type" content="article">
<meta property="og:title" content="${v.title.replace(/"/g, '&quot;')}">
<meta property="og:description" content="${v.desc.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${v.url}">
<meta property="og:image" content="${ogImageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${v.ogLocale}">
<meta property="og:locale:alternate" content="${v.ogLocaleAlt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${v.title.replace(/"/g, '&quot;')}">
<meta name="twitter:description" content="${v.desc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${ogImageUrl}">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": ["Article", "LearningResource"],
  "name": "${v.heading.replace(/"/g, '\\"')}",
  "headline": "${v.title.replace(/"/g, '\\"')}",
  "description": "${v.desc.replace(/"/g, '\\"')}",
  "inLanguage": ${v.inLanguage},
  "isAccessibleForFree": true,
  "url": "${v.url}",
  "image": "${ogImageUrl}",
  "datePublished": "${lesson.firstMod}",
  "dateModified": "${lesson.lastMod}",
  "timeRequired": "PT${lesson.readingMin}M",
  "learningResourceType": "Lesson",
  "educationalLevel": "JLPT ${schemaLevel}",
  "educationalAlignment": {
    "@type": "AlignmentObject",
    "alignmentType": "educationalLevel",
    "educationalFramework": "JLPT",
    "targetName": "${schemaLevel}"
  },
  "teaches": [${v.points.slice(0, 5).map(p => `"${p.replace(/"/g, '\\"')}"`).join(", ") || '""'}],
  "audience": { "@type": "EducationalAudience", "educationalRole": "student" },
  "author": { "@type": "Person", "name": "Ralphbupt", "url": "https://github.com/Ralphbupt" },
  "isPartOf": { "@type": "Course", "name": "Japanese Grammar Notes – N5 to N1", "url": "${SITE}" }
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "${v.home}", "item": "${SITE}" },
    { "@type": "ListItem", "position": 2, "name": "${v.heading.replace(/"/g, '\\"')}", "item": "${v.url}" }
  ]
}]
</script>
<link rel="alternate" type="application/rss+xml" title="Japanese Grammar Notes RSS" href="${SITE}feed.xml">
<link rel="icon" href="${SITE_PATH}favicon.ico" sizes="32x32">
<link rel="icon" href="${SITE_PATH}favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${SITE_PATH}favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${SITE_PATH}apple-touch-icon.png">
${CSP_META}
${CLONE_GUARD}
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
${SPECULATION_RULES}
${SW_REGISTER}
<style>
${CSS}
/* Hide chrome that requires JS (menu toggle, settings overlay) but
   keep the sidebar — it works on hover via pure CSS and links are root-
   relative so they navigate from any standalone page. */
#content { --col: 1000px; margin: 0 auto !important; max-width: var(--col); }
/* Wide screens: a little more room for tables; prose stays readable. */
@media (min-width: 1500px) { #content { --col: 1120px; } }
/* Sidebar open: centre in the space to its right, so it never covers the text. */
@media (min-width: 769px) {
  body:not(.sidebar-collapsed) #content {
    margin-left: calc(var(--sidebar-w) + max(0px, (100vw - var(--sidebar-w) - var(--col)) / 2)) !important;
  }
}
.back-link { display: block; margin-bottom: 1.5rem; color: var(--accent); text-decoration: none; font-size: 0.9rem; }
.back-link:hover { text-decoration: underline; }
.breadcrumb { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.breadcrumb a { color: var(--text-muted); text-decoration: none; }
.breadcrumb a:hover { color: var(--accent); text-decoration: underline; }
.breadcrumb .sep { margin: 0 0.4em; }
.prev-next { display: flex; justify-content: space-between; align-items: flex-start; margin: 2.5rem 0 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); gap: 1rem; }
.prev-next-top { margin: 0 0 1.75rem; padding: 0 0 1rem; border-top: none; border-bottom: 1px solid var(--border); }
.pn-link { font-size: 0.9rem; color: var(--accent); text-decoration: none; max-width: 48%; }
.pn-link:hover { text-decoration: underline; }
.pn-prev { text-align: left; }
.pn-next { text-align: right; margin-left: auto; }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}"><span class="lang-zh">日语语法笔记</span><span class="lang-en">Japanese Grammar Notes</span></a><span class="sep">›</span><a href="${SITE}${lesson.level}/">${GROUP_NAMES[lesson.level] ? `<span class="lang-zh">${groupName(lesson.level, "zh")}</span><span class="lang-en">${groupName(lesson.level, "en")}</span>` : `JLPT ${lesson.level}`}</a><span class="sep">›</span><span class="breadcrumb-current" title="${lesson.jaTitle.replace(/"/g, '&quot;')}">${lesson.jaTitle}</span>
  </nav>
  <nav class="prev-next prev-next-top" aria-label="lesson navigation top">
    ${prevHtml}
    ${nextHtml}
  </nav>
  <article class="lesson active">${addQuizLinks(lesson.html, lesson.id, lessonLevel)}</article>
  <nav class="prev-next" aria-label="lesson navigation">
    ${prevHtml}
    ${nextHtml}
  </nav>
  <div id="quiz-feedback" data-fb="lesson"></div>
  <section class="comments-section" aria-label="评论">
    <h2 class="comments-heading"><span class="lang-zh">评论</span><span class="lang-en">Comments</span></h2>
    ${GISCUS_SCRIPT}
  </section>
  ${siteFooterHtml}
</main>
${AI_SCRIPT}
<script>
${APP_PREFS_JS}
(function(){
  // Learning-progression events: prev/next lesson + cross-link clicks.
  document.addEventListener('click', function(e) {
    var prev = e.target.closest && e.target.closest('.pn-prev');
    var next = e.target.closest && e.target.closest('.pn-next');
    var cross = e.target.closest && e.target.closest('.cross-link');
    if (next && next.href && window.gaEvent) window.gaEvent('next_lesson', { from: location.pathname, to: new URL(next.href).pathname });
    else if (prev && prev.href && window.gaEvent) window.gaEvent('prev_lesson', { from: location.pathname, to: new URL(prev.href).pathname });
    else if (cross && cross.href && window.gaEvent) window.gaEvent('cross_link_click', { from: location.pathname, to: new URL(cross.href).pathname, term: (cross.querySelector('.cross-link-term') || {}).textContent || '' });
  });
})();
// Checklist persistence — the spaced-repetition / mastery checkboxes are
// keyed by 'lesson:idx' and stored under CHECK_KEY so a tick survives page
// reloads and navigation. A small progress bar shows how many are ticked.
(function(){
  var CHECK_KEY = 'jp_grammar_checks';
  function loadChecks() { try { return JSON.parse(localStorage.getItem(CHECK_KEY)) || {}; } catch(e) { return {}; } }
  function saveChecks(data) { try { localStorage.setItem(CHECK_KEY, JSON.stringify(data)); } catch(e) {} }
  var boxes = document.querySelectorAll('input[type="checkbox"][data-lesson]');
  if (!boxes.length) return;
  function updateProgress() {
    var bar = document.querySelector('.progress-fill');
    var text = document.querySelector('.progress-text');
    if (!bar || !text) return;
    var done = 0;
    boxes.forEach(function(cb){ if (cb.checked) done++; });
    var pct = boxes.length ? Math.round(done / boxes.length * 100) : 0;
    bar.style.width = pct + '%';
    text.textContent = done + ' / ' + boxes.length + ' (' + pct + '%)';
  }
  var checks = loadChecks();
  boxes.forEach(function(cb){
    var key = cb.getAttribute('data-lesson') + ':' + cb.getAttribute('data-idx');
    if (checks[key]) { cb.checked = true; cb.closest('li').classList.add('checked'); }
    cb.addEventListener('change', function(){
      var c = loadChecks();
      var k = this.getAttribute('data-lesson') + ':' + this.getAttribute('data-idx');
      if (this.checked) { c[k] = 1; this.closest('li').classList.add('checked'); }
      else { delete c[k]; this.closest('li').classList.remove('checked'); }
      saveChecks(c);
      updateProgress();
    });
  });
  // Lessons: the boxes are the review schedule at the bottom, so the bar sits
  // just above that list. Checklist pages: it tracks the whole page, under the H1.
  var lesson = /^lesson\\d/.test(boxes[0].getAttribute('data-lesson'));
  var anchor = lesson ? boxes[0].closest('ul') : document.querySelector('#content h1');
  if (anchor && !document.querySelector('.checklist-progress')) {
    var div = document.createElement('div');
    div.className = 'checklist-progress';
    div.innerHTML = '<span class="progress-label">' + (lesson
        ? '<span class="lang-zh">复习进度</span><span class="lang-en">Reviews done</span>'
        : '<span class="lang-zh">已掌握</span><span class="lang-en">Learned</span>') +
      '</span><div class="progress-bar"><div class="progress-fill"></div></div><span class="progress-text">0 / 0</span>';
    if (lesson) anchor.before(div); else anchor.after(div);
  }
  updateProgress();
})();
</script>
</body>
</html>`;

    // One URL per language (PAGE_LANGS): /lessonNN/ in English with an
    // English <title> for Google, /zh/lessonNN/ in Chinese with a Chinese
    // <title> for Bing China, tied together with hreflang. Each copy keeps only
    // its own language's blocks, so they are genuinely different documents.
    const zhTitle = seo.zh || buildLessonTitleZh(lesson, cleanPoints, schemaLevel);
    const zhDesc = seo.descZh || buildLessonDescZh(lesson, cleanPoints, schemaLevel);
    const zhKeywords = [...cleanPoints.slice(0, 4).flatMap(p => [`${p} 用法`, `${p} 意思`]),
      cleanPoints.length >= 2 ? `${cleanPoints[0]}和${cleanPoints[1]}的区别` : null,
      `JLPT ${schemaLevel} 语法`, `日语 ${schemaLevel} 语法总结`, "日语语法笔记"].filter(Boolean).join(", ");
    // The H1's two sides ("中文||English"), minus the "Lesson NN –" prefix:
    // a page's name in its JSON-LD and breadcrumb schema.
    const [h1Zh, h1En = h1Zh] = lesson.title.split("||").map(t => t.replace(/^Lesson\s+\d+\s*[–—-]\s*/i, "").trim());
    const pageMeta = {
      en: { title: lessonTitle, desc: lessonDesc, keywords: lessonKeywords, heading: h1En, home: "Japanese Grammar Notes", points: cleanPointsEn },
      zh: { title: zhTitle, desc: zhDesc, keywords: zhKeywords, heading: h1Zh, home: "日语语法笔记", points: cleanPoints },
    };
    for (const lang of PAGE_LANGS) {
      const lv = langVariant(lesson.id, lang);
      const rel = (r, l) => (l ? `\n<link rel="${r}" href="${SITE}${lang.dir}${l.id}/">` : "");
      writeLangPage(lesson.id, lang, localizePage(renderLessonPage({
        ...pageMeta[lang.code], htmlLang: lang.htmlLang, url: lv.url, htmlAttrs: lv.htmlAttrs,
        headLinks: rel("prev", prevLesson) + rel("next", nextLesson) + lv.hreflang,
        ogLocale: lang.ogLocale, ogLocaleAlt: PAGE_LANGS.find(o => o !== lang).ogLocale, inLanguage: `["${lang.htmlLang}", "ja"]`,
      }), lang, localizedPageIds));
    }
  }

  // ─── Level overview pages (/N5/, /N4/, /N3/, /N2/) ───
  const LEVEL_INTRO = {
    N5: "JLPT N5 是日语入门级别，覆盖基础句型、助词、动词三类、ます形/て形/ない形/た形、形容词活用、条件表达、可能/受身/意向形与基础推测样态。",
    N4: "JLPT N4 在 N5 基础上深化使役、受身、使役受身、授受表现、ように系列、ことにする/なる、ばかり/ところ/てしまう、ておく/てある、わけだ/ものだ 等核心日常语法。",
    N3: "JLPT N3 是日语进阶分水岭，覆盖书面助词（において/に対して/について）、原因理由、逆接让步、程度范围、动作相关、并列添加、状态样态、否定与复合表达等核心语法点。",
    N1: "JLPT N1 是最高级别，语法多见于报刊社论、论说文和文学作品：时点（が早いか/や否や）、限定范围（をおいて/ならでは）、强调极限（たりとも/すら）、文语书面表达（べく/ごとき/んばかり）、评价判断（までもない/に足る）与感情强调（てやまない/極まりない）。",
    N2: "JLPT N2 是商务/学术级别语法，覆盖高阶逆接（からといって/つつも）、程度限定（に過ぎない/はもとより）、判断主张（わけがない/ということだ）、对比关系、感情不可抗、书面表达、仮定条件等高频考点。",
  };
  const LEVEL_INTRO_EN = {
    N5: "JLPT N5 is the beginner level — basic sentence patterns, particles, the three verb groups, ます/て/ない/た forms, adjective conjugation, conditionals, and the potential/passive/volitional forms plus basic conjecture and appearance expressions.",
    N4: "Building on N5, JLPT N4 deepens causative, passive, causative-passive, giving/receiving expressions, the ように series, ことにする/なる, ばかり/ところ/てしまう, ておく/てある, and わけだ/ものだ — the core grammar of everyday Japanese.",
    N3: "JLPT N3 is the watershed into advanced Japanese — written-language particles (において/に対して/について), cause and reason, concession, degree and range, action-related patterns, addition, state and appearance, negation, and compound expressions.",
    N1: "JLPT N1 is the top level, and its grammar lives in editorials, essays and literature — timing (が早いか/や否や), limits and scope (をおいて/ならでは), extremes (たりとも/すら), classical and written forms (べく/ごとき/んばかり), evaluation (までもない/に足る) and emphatic emotion (てやまない/極まりない).",
    N2: "JLPT N2 is business/academic-level grammar — advanced concession (からといって/つつも), degree and limitation (に過ぎない/はもとより), judgment and assertion (わけがない/ということだ), contrast, involuntary emotion, written expression, and hypothetical conditionals — all high-frequency exam points.",
  };
  const LEVEL_KEYWORDS = {
    N5: "JLPT N5 语法清单, 日语 N5 语法总结, N5 文法一覧, N5 grammar list, 日语入门语法, JLPT N5 备考",
    N4: "JLPT N4 语法清单, 日语 N4 语法总结, N4 文法一覧, N4 grammar list, JLPT N4 备考, 日语进阶语法",
    N3: "JLPT N3 语法清单, 日语 N3 语法总结, N3 文法一覧, N3 grammar list, JLPT N3 备考, 日语进阶语法, N3 语法速查",
    N1: "JLPT N1 语法清单, 日语 N1 语法总结, N1 文法一覧, N1 grammar list, JLPT N1 备考, 日语高级语法, N1 语法速查",
    N2: "JLPT N2 语法清单, 日语 N2 语法总结, N2 文法一覧, N2 grammar list, JLPT N2 备考, 日语商务语法, N2 语法速查",
  };
  // Shared by the level overview pages and the /guides/ hub.
  const OVERVIEW_CSS = `/* Keep sidebar (pure-CSS hover navigation); hide other JS-dependent chrome. */
#content { --col: 1100px; margin: 0 auto !important; max-width: var(--col); padding: 2rem 1.5rem 4rem; }
/* Sidebar open: centre in the space to its right, as on the lessons. */
@media (min-width: 769px) {
  body:not(.sidebar-collapsed) #content {
    margin-left: calc(var(--sidebar-w) + max(0px, (100vw - var(--sidebar-w) - var(--col)) / 2)) !important;
  }
}
.breadcrumb { font-size: .85rem; color: var(--text-muted); margin-bottom: 1rem; }
.breadcrumb a { color: var(--text-muted); text-decoration: none; }
.breadcrumb .sep { margin: 0 .4em; }
.overview-intro { font-size: 1rem; line-height: 1.8; color: var(--text); margin: 1rem 0 2rem; padding: 1rem 1.2rem; background: var(--card-bg); border-left: 3px solid var(--word-border); border-radius: 0 var(--radius) var(--radius) 0; }
.overview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; margin: 1.5rem 0 2.5rem; }
.overview-card { display: block; padding: 1rem 1.2rem; background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius-lg); text-decoration: none; color: inherit; transition: all var(--transition); }
.overview-card:hover { border-color: var(--accent); box-shadow: var(--shadow-hover); transform: translateY(-1px); }
.overview-card-head { display: flex; align-items: baseline; gap: .6rem; margin-bottom: .5rem; }
.overview-day { font-size: .75rem; font-weight: 700; color: var(--accent); white-space: nowrap; }
.overview-title { font-size: .95rem; font-weight: 600; color: var(--text-strong); }
.overview-points { display: flex; flex-wrap: wrap; gap: .3rem; }
.grammar-pill { font-size: .75rem; background: #f4f4f4; color: var(--text-muted); padding: .15rem .5rem; border-radius: var(--radius-sm); }
.overview-table { width: 100%; border-collapse: collapse; margin: 1rem 0 2rem; font-size: .9rem; }
.overview-table th { background: var(--word-bg); font-weight: 600; padding: .5rem .8rem; text-align: left; border: 1px solid var(--border); }
.overview-table td { padding: .4rem .8rem; border: 1px solid var(--border); }
.overview-table td:first-child { font-weight: 500; }
.overview-table a { color: var(--accent); text-decoration: none; }
.overview-table a:hover { text-decoration: underline; }
.level-stats { display: flex; gap: 2rem; margin: 1rem 0; padding: 1rem 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.level-stat strong { display: block; font-size: 1.6rem; color: var(--accent); }
.level-stat span { font-size: .8rem; color: var(--text-muted); }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .overview-intro { background: #1f1f2e; color: #c8c8d4; }
  :root:not(.theme-light) .overview-card { background: #1f1f2e; }
  :root:not(.theme-light) .overview-day { color: #ff7088; }
  :root:not(.theme-light) .overview-title { color: #f0f0f5; }
  :root:not(.theme-light) .grammar-pill { background: #25253a; color: #c8c8d4; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark .overview-intro { background: #1f1f2e; color: #c8c8d4; }
html.theme-dark .overview-card { background: #1f1f2e; }
html.theme-dark .overview-day { color: #ff7088; }
html.theme-dark .overview-title { color: #f0f0f5; }
html.theme-dark .grammar-pill { background: #25253a; color: #c8c8d4; }
`;
  // A lesson's i-th grammar point, one label per language when they differ.
  const pointLabel = (l, i) => {
    const zh = l.cleanPoints[i], en = (l.cleanPointsEn || [])[i] || zh;
    return zh === en ? zh : `<span class="lang-zh">${zh}</span><span class="lang-en">${en}</span>`;
  };
  const lessonsByLevel = { N5: [], N4: [], N3: [], N2: [], N1: [] };
  for (const lesson of lessonPages) {
    if (lessonsByLevel[lesson.level]) lessonsByLevel[lesson.level].push(lesson);
  }
  const levelPageIds = [];
  for (const level of ["N5", "N4", "N3", "N2", "N1"]) {
    const lessons = lessonsByLevel[level].filter(l => /^lesson\d+/.test(l.id));
    if (lessons.length === 0) continue;
    const totalPoints = lessons.reduce((sum, l) => sum + (l.cleanPoints || []).length, 0);
    const ovMeta = {
      en: {
        title: `JLPT ${level} Grammar — ${lessons.length} Free Lessons, ${totalPoints}+ Grammar Points with Examples`,
        desc: `Every JLPT ${level} grammar point in ${lessons.length} free lessons: how each pattern conjugates, what it means, example sentences with audio, side-by-side comparisons of confusable grammar, and practice questions with answers.`,
        name: `JLPT ${level} Grammar`, home: "Japanese Grammar Notes", keywords: `JLPT ${level} grammar, ${level} grammar list, JLPT ${level} grammar points, ${level} Japanese grammar lessons`,
      },
      zh: {
        title: `JLPT ${level} 语法清单 | ${lessons.length} 课 ${totalPoints}+ 语法点速查 - 日语 ${level} 语法总结`,
        desc: `日语 JLPT ${level} 全部语法点速查清单，系统覆盖 ${lessons.length} 课、${totalPoints}+ 语法点的接续规则、含义用法、例句与易错辨析。免费 JLPT ${level} 备考笔记，适合零基础系统学习与考前冲刺复习，每课均含练习题与答案。`,
        name: `JLPT ${level} 语法清单`, home: "日语语法笔记", keywords: LEVEL_KEYWORDS[level],
      },
    };
    const ovOgImage = `${SITE}${level}/og-image.png`;

    // Lesson cards: each shows day, title, grammar points, link
    const cardsHtml = lessons.map(l => {
      const lessonMatch = l.id.match(/^lesson(\d+)/);
      const dayLabel = lessonMatch ? `Lesson ${lessonMatch[1]}` : l.id;
      const points = (l.cleanPoints || []).slice(0, 4);
      const pointsHtml = points.length > 0
        ? `<div class="overview-points">${points.map((p, i) => `<span class="grammar-pill">${pointLabel(l, i)}</span>`).join("")}</div>`
        : "";
      return `<a class="overview-card" href="${SITE}${l.id}/">
        <div class="overview-card-head">
          <span class="overview-day">${dayLabel}</span>
          <span class="overview-title">${l.jaTitle}</span>
        </div>
        ${pointsHtml}
      </a>`;
    }).join("\n");

    // Full grammar points table for fast lookup
    const tableRows = [];
    for (const l of lessons) {
      const lessonMatch = l.id.match(/^lesson(\d+)/);
      const dayLabel = lessonMatch ? `Lesson ${lessonMatch[1]}` : l.id;
      for (let i = 0; i < (l.cleanPoints || []).length; i++) {
        tableRows.push(`<tr><td><a href="${SITE}${l.id}/">${pointLabel(l, i)}</a></td><td>${dayLabel}</td><td>${l.jaTitle}</td></tr>`);
      }
    }
    const tableHtml = tableRows.length > 0
      ? `<h2 id="grammar-index"><span class="lang-zh">${level} 全部语法点速查表</span><span class="lang-en">All ${level} grammar points</span></h2>
<table class="overview-table">
<thead><tr><th scope="col"><span class="lang-zh">语法点</span><span class="lang-en">Grammar point</span></th><th scope="col"><span class="lang-zh">课次</span><span class="lang-en">Lesson</span></th><th scope="col"><span class="lang-zh">课题</span><span class="lang-en">Topic</span></th></tr></thead>
<tbody>${tableRows.join("\n")}</tbody>
</table>`
      : "";

    const renderOv = (lang, m, lv) => `<!DOCTYPE html>
<html lang="${lang.htmlLang}"${lv.htmlAttrs}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>${LANG_REDIRECT_JS}</script>
<title>${m.title}</title>
<meta name="description" content="${m.desc.replace(/"/g, '&quot;')}">
<meta name="keywords" content="${m.keywords}">
<link rel="canonical" href="${lv.url}">${lv.hreflang}
<meta property="og:type" content="website">
<meta property="og:title" content="${m.title.replace(/"/g, '&quot;')}">
<meta property="og:description" content="${m.desc.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${lv.url}">
<meta property="og:locale" content="${lang.ogLocale}">
<meta property="og:image" content="${ovOgImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${m.title.replace(/"/g, '&quot;')}">
<meta name="twitter:description" content="${m.desc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${ovOgImage}">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "${m.name}",
  "description": "${m.desc.replace(/"/g, '\\"')}",
  "url": "${lv.url}",
  "inLanguage": ["${lang.htmlLang}", "ja"],
  "isPartOf": { "@type": "Course", "name": "Japanese Grammar Notes – N5 to N1", "url": "${SITE}" },
  "hasPart": [${lessons.map(l => `{"@type": "Article", "name": "${l.jaTitle.replace(/"/g, '\\"')}", "url": "${SITE}${l.id}/"}`).join(",")}]
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "${m.home}", "item": "${SITE}" },
    { "@type": "ListItem", "position": 2, "name": "JLPT ${level}", "item": "${lv.url}" }
  ]
}]
</script>
<link rel="alternate" type="application/rss+xml" title="Japanese Grammar Notes RSS" href="${SITE}feed.xml">
<link rel="icon" href="${SITE_PATH}favicon.ico" sizes="32x32">
<link rel="icon" href="${SITE_PATH}favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${SITE_PATH}favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${SITE_PATH}apple-touch-icon.png">
${CSP_META}
${CLONE_GUARD}
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
${SPECULATION_RULES}
${SW_REGISTER}
<style>
${CSS}
${OVERVIEW_CSS}
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}"><span class="lang-zh">日语语法笔记</span><span class="lang-en">Japanese Grammar Notes</span></a><span class="sep">›</span><span>JLPT ${level}</span>
  </nav>
  <h1><span class="lang-zh">JLPT ${level} 语法清单 - ${lessons.length} 课 ${totalPoints}+ 语法点速查</span><span class="lang-en">JLPT ${level} Grammar — ${lessons.length} Lessons, ${totalPoints}+ Grammar Points</span></h1>
  <p class="overview-intro"><span class="lang-zh">${LEVEL_INTRO[level]}</span><span class="lang-en">${LEVEL_INTRO_EN[level]}</span></p>${quizPages(level).length ? `
  <p class="ov-quiz">${quizPages(level).map((q) => `<a href="${q.href}"><span class="lang-zh">${q.zh}</span><span class="lang-en">${q.en}</span></a>`).join("")}</p>` : ""}
  <div class="level-stats">
    <div class="level-stat"><strong>${lessons.length}</strong><span><span class="lang-zh">课</span><span class="lang-en">lessons</span></span></div>
    <div class="level-stat"><strong>${totalPoints}+</strong><span><span class="lang-zh">语法点</span><span class="lang-en">points</span></span></div>
    <div class="level-stat"><strong><span class="lang-zh">免费</span><span class="lang-en">Free</span></strong><span><span class="lang-zh">双语笔记</span><span class="lang-en">bilingual</span></span></div>
  </div>
  <h2><span class="lang-zh">分课目录</span><span class="lang-en">Lessons</span></h2>
  <div class="overview-grid">${cardsHtml}</div>
  ${tableHtml}
  ${siteFooterHtml}
</main>
<script>
${APP_PREFS_JS}
</script>
${AI_SCRIPT}
</body>
</html>`;
    for (const lang of PAGE_LANGS) {
      writeLangPage(level, lang, localizePage(renderOv(lang, ovMeta[lang.code], langVariant(level, lang)), lang, localizedPageIds));
    }
    levelPageIds.push(level);
  }
  console.log(`  Generated ${levelPageIds.length} level overview pages: ${levelPageIds.join(", ")}`);

  // ─── All grammar on one page (/grammar/) ───
  // Every numbered grammar point of every N5–N1 lesson in one table per level
  // (pattern · meaning · lesson), for "日语语法大全 / Japanese grammar list"
  // searches and as one page that links to every point. Built from the lesson
  // headings, so it never drifts from the lessons.
  {
    const esc = (t) => (t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const strip = (h) => h.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const rows = { N5: [], N4: [], N3: [], N2: [], N1: [] };
    // "〜なり（一……就（出人意料地）……）" → ["〜なり", "一……就（出人意料地）……"]: the last balanced bracket group.
    const gloss = (t) => {
      if (!/[）)]$/.test(t)) return null;
      for (let i = t.length - 1, d = 0; i >= 0; i--) {
        if (/[）)]/.test(t[i])) d++;
        else if (/[（(]/.test(t[i]) && --d === 0) return i > 0 ? [t.slice(0, i).trim(), t.slice(i + 1, -1)] : null;
      }
      return null;
    };
    for (const l of lessonPages) {
      if (!rows[l.level] || !/^lesson\d+/.test(l.id) || /总复习|総復習|五十音/.test(l.jaTitle || "")) continue;
      for (const m of l.html.matchAll(/<h2[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h2>/g)) {
        const zh = (m[2].match(/<span class="lang-zh">([\s\S]*?)<\/span>/) || [])[1];
        const i = m[2].indexOf('<span class="lang-en">'), enRaw = i < 0 ? "" : m[2].slice(i);
        if (!zh || !/^\d+[.．]/.test(strip(zh))) continue;
        // 「は — 主题助词」 and 「〜に過ぎない（只不过是……）」: pattern, then its gloss.
        const z = strip(zh).replace(/^\d+[.．]\s*/, ""), pz = gloss(z) || z.match(/^(.+?) — (.+)$/)?.slice(1);
        const pattern = (pz ? pz[0] : z).trim();
        // Section headings that aren't a pattern (「初学者常见错误」, 「い形容词 完整活用表」) have Chinese in them.
        if (hasSC(pattern) || !/[\u3040-\u30ff]/.test(pattern) || /用法|速览|汇总|対比|模板|区分|\bvs\b/.test(pattern)) continue;
        const romaji = strip((enRaw.match(/<span class="romaji">([\s\S]*?)<\/span>/) || [])[1] || "");
        const e = strip(enRaw.replace(/<span class="romaji">[\s\S]*?<\/span>/, "")).replace(/^\d+[.．]\s*/, ""), pe = gloss(e) || e.match(/^(.+?) — (.+)$/)?.slice(1);
        rows[l.level].push({ id: l.id, slug: m[1], pattern, zh: pz ? pz[1] : "", en: pe ? pe[1] : "", romaji, lesson: l.id.replace("lesson", "") });
      }
    }
    const levels = Object.keys(rows).filter((k) => rows[k].length);
    const total = levels.reduce((a, k) => a + rows[k].length, 0);
    const table = (k) => `<div class="table-scroll"><table class="gl-table"><thead><tr><th><span class="lang-zh">语法</span><span class="lang-en">Pattern</span></th><th><span class="lang-zh">意思</span><span class="lang-en">Meaning</span></th><th><span class="lang-zh">课</span><span class="lang-en">Lesson</span></th></tr></thead><tbody>${rows[k].map((r) =>
      `<tr><td><a href="${SITE}${r.id}/#${encodeURIComponent(r.slug)}" lang="ja">${esc(r.pattern)}</a>${r.romaji ? `<span class="gl-romaji lang-en">${esc(r.romaji)}</span>` : ""}</td><td><span class="lang-zh">${esc(r.zh)}</span><span class="lang-en">${esc(r.en)}</span></td><td><a href="${SITE}${r.id}/">${r.lesson}</a></td></tr>`).join("")}</tbody></table></div>`;
    const glMeta = {
      en: { title: `Japanese Grammar List — All ${total} JLPT N5 to N1 Grammar Points`, desc: `Every Japanese grammar point from JLPT N5 to N1 on one page: ${total} patterns with romaji and meaning, grouped by level, each linking to a lesson with conjugation rules, examples with audio and comparisons.`, h1: "Japanese Grammar List: JLPT N5 to N1", crumb: "Grammar list", home: "Japanese Grammar Notes",
        lead: `All ${total} grammar points taught on this site, from N5 to N1, one row each. Click a pattern for its lesson: how it attaches, what it means, examples with audio and how it differs from look-alikes. For one level as a printable checklist, use the level's checklist page.` },
      zh: { title: `日语语法大全 — JLPT N5 到 N1 全部 ${total} 个语法点总结`, desc: `日语语法大全：JLPT N5、N4、N3、N2、N1 全部 ${total} 个语法点一页看完，按级别分组，每个语法点附意思并链接到详细讲解（接续、例句带发音、易混辨析）。`, h1: "日语语法大全：JLPT N5 到 N1", crumb: "语法大全", home: "日语语法笔记",
        lead: `本站 N5 到 N1 的全部 ${total} 个语法点，一行一个。点语法名进入对应课文：接续、含义、带发音的例句和易混辨析。想按级别打勾复习，用各级的语法清单。` },
    };
    const renderGl = (lang, m, lv) => `<!DOCTYPE html>
<html lang="${lang.htmlLang}"${lv.htmlAttrs}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>${LANG_REDIRECT_JS}</script>
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.desc)}">
<link rel="canonical" href="${lv.url}">${lv.hreflang}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.desc)}">
<meta property="og:url" content="${lv.url}">
<meta property="og:locale" content="${lang.ogLocale}">
<meta property="og:image" content="${SITE}og-image.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify([
  { "@context": "https://schema.org", "@type": "CollectionPage", name: m.h1, description: m.desc, url: lv.url, inLanguage: lang.htmlLang,
    isPartOf: { "@type": "Course", name: "Japanese Grammar Notes – N5 to N1", url: SITE } },
  { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: m.home, item: SITE },
    { "@type": "ListItem", position: 2, name: m.crumb, item: lv.url }] },
]).replace(/</g, "\\u003c")}</script>
<link rel="icon" href="${SITE_PATH}favicon.ico" sizes="32x32">
<link rel="icon" href="${SITE_PATH}favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${SITE_PATH}favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${SITE_PATH}apple-touch-icon.png">
${CSP_META}
${CLONE_GUARD}
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
${SPECULATION_RULES}
${SW_REGISTER}
<style>
${CSS}
${OVERVIEW_CSS}
.gl-jump { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin: 0 0 1.5rem; }
.gl-table { width: 100%; border-collapse: collapse; font-size: .92rem; margin: .5rem 0 2rem; }
.gl-table th, .gl-table td { border: 1px solid var(--border); padding: .35rem .6rem; text-align: left; vertical-align: top; }
.gl-table th { background: var(--word-bg); }
.gl-table td:first-child { width: 45%; }
.gl-table td:last-child { text-align: center; width: 3.5rem; }
.gl-table .gl-romaji { display: block; font-size: .78rem; color: var(--text-muted); }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}"><span class="lang-zh">日语语法笔记</span><span class="lang-en">Japanese Grammar Notes</span></a><span class="sep">›</span><span><span class="lang-zh">语法大全</span><span class="lang-en">Grammar list</span></span>
  </nav>
  <h1><span class="lang-zh">${zhOr(glMeta, "h1")}</span><span class="lang-en">${glMeta.en.h1}</span></h1>
  <p class="overview-intro"><span class="lang-zh">${glMeta.zh.lead}</span><span class="lang-en">${glMeta.en.lead}</span></p>
  <p class="gl-jump">${levels.map((k) => `<a href="#${k}">${k}（${rows[k].length}）</a>`).join("")}</p>
  ${levels.map((k) => `<h2 id="${k}">JLPT ${k} <span class="lang-zh">语法（${rows[k].length} 个）</span><span class="lang-en">grammar (${rows[k].length})</span></h2>
  <p><a href="${SITE}${k}/"><span class="lang-zh">${k} 总览</span><span class="lang-en">${k} overview</span></a> · <a href="${SITE}${k}_grammar_list/"><span class="lang-zh">${k} 语法清单（可打勾）</span><span class="lang-en">${k} checklist</span></a>${quizPages(k).length ? ` · <a href="${SITE_PATH}${k.toLowerCase()}-practice/"><span class="lang-zh">${k} 练习题</span><span class="lang-en">${k} practice</span></a>` : ""}${fs.existsSync(path.join(__dirname, "grammar", "guides", `jlpt-${k.toLowerCase()}-key-grammar.md`)) ? ` · <a href="${SITE}jlpt-${k.toLowerCase()}-key-grammar/"><span class="lang-zh">${k} 高频考点</span><span class="lang-en">${k} key grammar</span></a>` : ""}</p>
  ${table(k)}`).join("\n  ")}
  ${siteFooterHtml}
</main>
<script>
${APP_PREFS_JS}
</script>
${AI_SCRIPT}
</body>
</html>`;
    const zhOr = (o, k) => o.zh[k];
    for (const lang of PAGE_LANGS) writeLangPage("grammar", lang, localizePage(renderGl(lang, glMeta[lang.code], langVariant("grammar", lang)), lang, localizedPageIds));
    levelPageIds.push("grammar");
    console.log(`  Generated /grammar/ (${total} grammar points)`);
  }

  // ─── Guides hub (/guides/) ───
  // Cards for every page in grammar/guides/, exam guides first, then the
  // A-vs-B comparison pages. Card copy comes from the seo-titles.js entry.
  const guidePages = lessonPages.filter(l => l.level === "guides");
  if (guidePages.length > 0) {
    const esc = (t) => (t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const card = (l) => {
      const seo = SEO_TITLES[l.id] || {};
      const tag = seo.level ? `JLPT ${seo.level}` : "JLPT";
      return `<a class="overview-card" href="${SITE}${l.id}/">
        <div class="overview-card-head"><span class="overview-day">${tag}</span><span class="overview-title">${l.jaTitle}</span></div>
        <p class="guide-card-desc"><span class="lang-zh">${esc(seo.descZh)}</span><span class="lang-en">${esc(seo.desc)}</span></p>
      </a>`;
    };
    const examGuides = guidePages.filter(l => /^jlpt-/.test(l.id));
    const compareGuides = guidePages.filter(l => !/^jlpt-/.test(l.id));
    const guidesMeta = {
      en: {
        title: "Confusing Japanese Grammar Pairs Explained (は vs が, に vs で …) & JLPT Exam Guide",
        desc: `Side-by-side guides to the Japanese grammar pairs learners mix up most (は vs が, に vs で, から vs ので, ように vs ために …) plus a JLPT December exam-day guide. ${compareGuides.length} comparison pages, free.`,
        name: "Guides", home: "Japanese Grammar Notes",
      },
      zh: {
        title: "日语易混语法对比（は和が、に和で的区别…）& JLPT 考试指南",
        desc: `把最容易混的日语语法放在同一页对比：は和が、に和で、から和ので、ように和ために……每页有判断口诀和自测题，另附 12 月 JLPT 考前指南。共 ${compareGuides.length} 篇对比，免费。`,
        name: "专题", home: "日语语法笔记",
      },
    };
    const renderGuides = (lang, m, lv) => `<!DOCTYPE html>
<html lang="${lang.htmlLang}"${lv.htmlAttrs}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>${LANG_REDIRECT_JS}</script>
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.desc)}">
<link rel="canonical" href="${lv.url}">${lv.hreflang}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.desc)}">
<meta property="og:url" content="${lv.url}">
<meta property="og:locale" content="${lang.ogLocale}">
<meta property="og:image" content="${SITE}guides/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "${m.title.replace(/"/g, '\\"')}",
  "description": "${m.desc.replace(/"/g, '\\"')}",
  "url": "${lv.url}",
  "inLanguage": ["${lang.htmlLang}", "ja"],
  "isPartOf": { "@type": "Course", "name": "Japanese Grammar Notes – N5 to N1", "url": "${SITE}" },
  "hasPart": [${guidePages.map(l => `{"@type": "Article", "name": "${l.jaTitle.replace(/"/g, '\\"')}", "url": "${SITE}${l.id}/"}`).join(",")}]
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "${m.home}", "item": "${SITE}" },
    { "@type": "ListItem", "position": 2, "name": "${m.name}", "item": "${lv.url}" }
  ]
}]
</script>
<link rel="icon" href="${SITE_PATH}favicon.ico" sizes="32x32">
<link rel="icon" href="${SITE_PATH}favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${SITE_PATH}favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${SITE_PATH}apple-touch-icon.png">
${CSP_META}
${CLONE_GUARD}
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
${SPECULATION_RULES}
${SW_REGISTER}
<style>
${CSS}
${OVERVIEW_CSS}
.guide-card-desc { font-size: .85rem; line-height: 1.6; color: var(--text-muted); margin: .3rem 0 0; }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}"><span class="lang-zh">日语语法笔记</span><span class="lang-en">Japanese Grammar Notes</span></a><span class="sep">›</span><span><span class="lang-zh">专题</span><span class="lang-en">Guides</span></span>
  </nav>
  <h1><span class="lang-zh">专题：易混语法对比 &amp; JLPT 考试指南</span><span class="lang-en">Guides: Confusable Grammar Pairs &amp; the JLPT Exam</span></h1>
  <p class="overview-intro"><span class="lang-zh">课程是按级别一课一课讲的；这里换个角度——把最容易混的几组语法放在同一页里对比，配判断口诀和自测题，再加一份 12 月 JLPT 考前指南。</span><span class="lang-en">The lessons go level by level; these pages cut across them. Each puts one set of easily confused patterns side by side with a rule of thumb and a self-test, plus a guide to the December JLPT.</span></p>
  ${examGuides.length ? `<h2><span class="lang-zh">考试指南</span><span class="lang-en">Exam guide</span></h2>
  <div class="overview-grid">${examGuides.map(card).join("\n")}</div>` : ""}
  <h2><span class="lang-zh">易混语法对比</span><span class="lang-en">Grammar comparisons</span></h2>
  <div class="overview-grid">${compareGuides.map(card).join("\n")}</div>
  ${siteFooterHtml}
</main>
<script>
${APP_PREFS_JS}
</script>
${AI_SCRIPT}
</body>
</html>`;
    for (const lang of PAGE_LANGS) {
      writeLangPage("guides", lang, localizePage(renderGuides(lang, guidesMeta[lang.code], langVariant("guides", lang)), lang, localizedPageIds));
    }
    levelPageIds.push("guides");
    console.log(`  Generated /guides/ hub (${guidePages.length} pages)`);
  }

  // ─── About page (E-E-A-T signal: who built this and why) ───
  const aboutMdPath = path.join(__dirname, "pages/about.md");
  let aboutPageGenerated = false;
  if (fs.existsSync(aboutMdPath)) {
    const aboutMd = fs.readFileSync(aboutMdPath, "utf-8");
    // Process :::zh / :::en bilingual blocks (same pattern as lesson md).
    const aboutMdBilingual = aboutMd.replace(
      /^:::(zh|en)\s*\n([\s\S]*?)^:::\s*$/gm,
      (_, lang, content) => `<!--lang:${lang}:start-->\n${content.trim()}\n\n<!--lang:${lang}:end-->`
    );
    let aboutHtml = await marked.parse(aboutMdBilingual);
    aboutHtml = aboutHtml.replace(/<!--lang:(zh|en):start-->/g, (_, lang) =>
      lang === "zh" ? '<div class="lang-zh" lang="zh-CN">' : '<div class="lang-en" lang="en">'
    );
    aboutHtml = aboutHtml.replace(/<!--lang:(zh|en):end-->/g, '</div>');
    // Bilingual headings: <h2>中文||English</h2>
    aboutHtml = aboutHtml.replace(
      /(<h[1-6][^>]*>)(.+?)\|\|(.+?)(<\/h[1-6]>)/g,
      (_, open, zh, en, close) =>
        `${open}<span class="lang-zh">${zh.trim()}</span><span class="lang-en">${en.trim()}</span>${close}`
    );
    const aboutMeta = {
      en: {
        title: "About Japanese Grammar Notes — Who Makes It, Sources & License",
        desc: "Who makes jpnotes.dev, why, which references it draws on, and how to report a mistake or contribute. Free, open-source JLPT N5–N1 grammar notes under CC BY 4.0, with conjugation rules, examples, comparisons and practice.",
        keywords: "about jpnotes.dev, Japanese grammar notes, JLPT self-study, open source",
        name: "About Japanese Grammar Notes", site: "Japanese Grammar Notes", crumb: "About",
      },
      zh: {
        title: "关于本站 - 日语语法笔记 | 作者、内容来源与开源协议",
        desc: "了解 jpnotes.dev 日语语法笔记是谁做的、为什么做、参考了哪些资料、如何反馈错误与参与贡献。这是一份免费、开源、采用 CC BY 4.0 许可的 JLPT N5–N1 语法学习笔记，含接续规则、例句、辨析与练习。",
        keywords: "日语语法笔记关于, 作者, jpnotes.dev, 日语学习, JLPT 自学, 中文母语者",
        name: "关于日语语法笔记", site: "日语语法笔记", crumb: "关于本站",
      },
    };
    const aboutOgImage = `${SITE}about/og-image.png`;

    const renderAbout = (lang, m, lv) => `<!DOCTYPE html>
<html lang="${lang.htmlLang}"${lv.htmlAttrs}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>${LANG_REDIRECT_JS}</script>
<title>${m.title}</title>
<meta name="description" content="${m.desc.replace(/"/g, '&quot;')}">
<meta name="keywords" content="${m.keywords}">
<link rel="canonical" href="${lv.url}">${lv.hreflang}
<meta property="og:type" content="website">
<meta property="og:title" content="${m.title}">
<meta property="og:description" content="${m.desc.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${lv.url}">
<meta property="og:locale" content="${lang.ogLocale}">
<meta property="og:image" content="${aboutOgImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${m.title}">
<meta name="twitter:description" content="${m.desc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${aboutOgImage}">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "name": "${m.name}",
  "description": "${m.desc.replace(/"/g, '\\"')}",
  "url": "${lv.url}",
  "inLanguage": "${lang.htmlLang}",
  "isPartOf": { "@type": "WebSite", "name": "${m.site}", "url": "${SITE}" },
  "mainEntity": {
    "@type": "Person",
    "name": "Ralphbupt",
    "url": "https://github.com/Ralphbupt",
    "email": "pengcheng199@gmail.com",
    "sameAs": ["https://github.com/Ralphbupt"]
  }
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "${m.site}", "item": "${SITE}" },
    { "@type": "ListItem", "position": 2, "name": "${m.crumb}", "item": "${lv.url}" }
  ]
}]
</script>
<link rel="alternate" type="application/rss+xml" title="Japanese Grammar Notes RSS" href="${SITE}feed.xml">
<link rel="icon" href="${SITE_PATH}favicon.ico" sizes="32x32">
<link rel="icon" href="${SITE_PATH}favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${SITE_PATH}favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${SITE_PATH}apple-touch-icon.png">
${CSP_META}
${CLONE_GUARD}
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
${SPECULATION_RULES}
${SW_REGISTER}
<style>
${CSS}
/* Keep sidebar (pure-CSS hover); hide other JS-dependent chrome. */
#content { margin: 0 auto !important; max-width: 800px; padding: 2rem 2rem 4rem; }
.breadcrumb { font-size: .85rem; color: var(--text-muted); margin-bottom: 1rem; }
.breadcrumb a { color: var(--text-muted); text-decoration: none; }
.breadcrumb .sep { margin: 0 .4em; }
.about-content h1 { font-size: var(--text-2xl); margin: 0 0 1.5rem; border-bottom: 2px solid var(--accent); padding-bottom: .6rem; }
.about-content h2 { font-size: var(--text-xl); margin: 2.2rem 0 .9rem; color: var(--text-strong); }
.about-content p, .about-content li { line-height: 1.85; }
.about-content ul { margin: .6rem 0 .6rem 1.4rem; }
.about-content li { margin: .3rem 0; }
.about-content blockquote { background: rgba(233,69,96,.04); border-left: 3px solid var(--accent); padding: .7rem 1.1rem; margin: 1rem 0; color: var(--text-muted); }
.about-content a { color: var(--accent); text-decoration: none; }
.about-content a:hover { text-decoration: underline; }
.about-content code { background: var(--code-bg); padding: .1rem .3rem; border-radius: var(--radius-sm); font-size: .9em; }
.about-content strong { color: var(--text-strong); }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .about-content h2 { color: #e4e4ec; }
  :root:not(.theme-light) .about-content strong { color: #f0f0f5; }
  :root:not(.theme-light) .about-content blockquote { background: rgba(233,69,96,.08); color: #b8b8c4; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark .about-content h2 { color: #e4e4ec; }
html.theme-dark .about-content strong { color: #f0f0f5; }
html.theme-dark .about-content blockquote { background: rgba(233,69,96,.08); color: #b8b8c4; }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}"><span class="lang-zh">日语语法笔记</span><span class="lang-en">Japanese Grammar Notes</span></a><span class="sep">›</span><span><span class="lang-zh">关于本站</span><span class="lang-en">About</span></span>
  </nav>
  <article class="about-content">${aboutHtml}</article>
  ${siteFooterHtml}
</main>
<script>
${APP_PREFS_JS}
</script>
${AI_SCRIPT}
</body>
</html>`;
    for (const lang of PAGE_LANGS) {
      writeLangPage("about", lang, localizePage(renderAbout(lang, aboutMeta[lang.code], langVariant("about", lang)), lang, localizedPageIds));
    }
    aboutPageGenerated = true;
    console.log("  Generated dist/about/index.html");
  }

  // ─── Practice question pages (build-quiz.js → dist/quiz/*.json, site/quiz.js) ───
  const quizBundles = await buildQuiz(async (text) => fixReadings(await furiganaText(kuro, text)));
  // Reading passages' read-aloud audio goes in the same request list as the examples.
  {
    const reqPath = path.join(__dirname, "dist", ".audio-requests.json");
    const reqs = JSON.parse(fs.readFileSync(reqPath, "utf-8"));
    fs.writeFileSync(reqPath, JSON.stringify(reqs.concat(QUIZ_AUDIO_REQUESTS)), "utf-8");
    console.log(`  Requested audio for ${QUIZ_AUDIO_REQUESTS.length} reading passages and question sentences.`);
  }
  // Levels whose practice has listening (choukai) questions.
  const ckLevels = Object.keys(quizBundles).filter((l) => Object.values(quizBundles[l].practice.types).some((t) => t.g === "choukai"));
  // Listening pictures (tools/choukai-images.py): the ones the questions use. Their
  // mp3s are in audio/choukai/, which CI copies with the rest of audio/.
  {
    const files = new Set();
    for (const { practice, mocks } of Object.values(quizBundles)) for (const q of [...practice.questions, ...mocks.flatMap((m) => m.test.questions)]) {
      if (q.pic) for (const f of q.pic.opts || [q.pic.scene]) files.add(f);
    }
    const out = path.join(__dirname, "dist", "images", "choukai");
    fs.mkdirSync(out, { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(QUIZ_CK_IMG_DIR, f), path.join(out, f));
    if (files.size) console.log(`  Copied ${files.size} listening pictures.`);
  }
  const quizPageIds = [];
  fs.mkdirSync(path.join(__dirname, "dist", "quiz"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "dist", "quiz.js"), QUIZ_JS_SRC, "utf-8");
  fs.writeFileSync(path.join(__dirname, "dist", "feedback.js"), FEEDBACK_JS_SRC, "utf-8");
  // Each data file gets a content-hash ?v= (the service worker caches it for good).
  const writeQuizData = (name, obj) => {
    const json = JSON.stringify(obj);
    fs.writeFileSync(path.join(__dirname, "dist", "quiz", name), json, "utf-8");
    return `${SITE_PATH}quiz/${name}?v=${require("crypto").createHash("md5").update(json).digest("hex").slice(0, 8)}`;
  };
  const renderQuiz = (lang, m, lv, level, appAttrs, preload) => `<!DOCTYPE html>
<html lang="${lang.htmlLang}"${lv.htmlAttrs}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>${LANG_REDIRECT_JS}</script>
<title>${m.title}</title>
<meta name="description" content="${m.desc.replace(/"/g, '&quot;')}">${QUIZ_PUBLIC ? "" : '\n<meta name="robots" content="noindex">'}
<link rel="canonical" href="${lv.url}">${lv.hreflang}
<meta property="og:type" content="website">
<meta property="og:title" content="${m.title}">
<meta property="og:description" content="${m.desc.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${lv.url}">
<meta property="og:locale" content="${lang.ogLocale}">${level ? `\n<meta property="og:image" content="${SITE}${level}/og-image.png">\n<meta name="twitter:card" content="summary_large_image">` : ""}${m.schema ? `\n<script type="application/ld+json">${m.schema}</script>` : ""}
<link rel="icon" href="${SITE_PATH}favicon.ico" sizes="32x32">
<link rel="icon" href="${SITE_PATH}favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${SITE_PATH}favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${SITE_PATH}apple-touch-icon.png">${preload ? `\n<link rel="preload" href="${preload}" as="fetch" crossorigin>` : ""}
${CSP_META}
${CLONE_GUARD}
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
${SPECULATION_RULES}
${SW_REGISTER}
<style>
${CSS}
/* Same column as the lessons, so the site doesn't narrow when you start practising. */
#content { --col: 1000px; margin: 0 auto !important; max-width: var(--col); padding: 2rem 1.5rem 4rem; }
@media (min-width: 1500px) { #content { --col: 1120px; } }
@media (min-width: 769px) {
  body:not(.sidebar-collapsed) #content {
    margin-left: calc(var(--sidebar-w) + max(0px, (100vw - var(--sidebar-w) - var(--col)) / 2)) !important;
  }
}
.breadcrumb { font-size: .85rem; color: var(--text-muted); margin-bottom: 1rem; }
.breadcrumb a { color: var(--text-muted); text-decoration: none; }
.breadcrumb .sep { margin: 0 .4em; }
.quiz-head h1 { font-size: var(--text-2xl); margin: 0 0 .6rem; }
.quiz-head p { color: var(--text-muted); line-height: 1.7; margin: 0; }
.quiz-head .quiz-nav { margin-top: .6rem; font-size: .92rem; }
.quiz-head .quiz-nav a { color: var(--link); }
.quiz-about { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); line-height: 1.75; }
.quiz-about h2 { font-size: var(--text-xl); margin: 1.8rem 0 .6rem; }
.quiz-about table { border-collapse: collapse; margin: .6rem 0 1rem; font-size: .92rem; }
.quiz-about th, .quiz-about td { border: 1px solid var(--border); padding: .35rem .7rem; text-align: left; }
.quiz-about dt { font-weight: 600; margin-top: .9rem; }
.quiz-about dd { margin: .2rem 0 0; color: var(--text-muted); }
.quiz-about .lesson-list { columns: 2; column-gap: 2rem; padding-left: 1.2rem; }
@media (max-width: 600px) { .quiz-about .lesson-list { columns: 1; } }
@media (max-width: 600px) { #content { padding: 1.2rem 1rem 3rem; } }
${minifyCss(QUIZ_CSS)}
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}"><span class="lang-zh">日语语法笔记</span><span class="lang-en">Japanese Grammar Notes</span></a><span class="sep">›</span>${level ? `<a href="${SITE_PATH}${level}/">${level}</a><span class="sep">›</span>` : ""}<span>${m.crumb}</span>
  </nav>
  <header class="quiz-head"><h1>${m.h1}</h1><p>${m.lead}</p><p class="quiz-nav">${m.nav}</p></header>
  ${appAttrs === null ? m.body : `<div id="quiz-app" data-level="${level}" ${appAttrs}></div>`}${m.about || ""}
  <div id="quiz-feedback"></div>
  ${siteFooterHtml}
</main>
<script>
${APP_PREFS_JS}
</script>
${appAttrs === null ? "" : `<script src="${SITE_PATH}quiz.js?v=${QUIZ_JS_HASH}" defer></script>`}
${AI_SCRIPT}
</body>
</html>`;
  // Readable text under each practice / mock / flashcard page (like a game
  // page's "how to play" + FAQ): what the level's exam tests, how the page
  // works, and links to every lesson of the level. Without it the pages are an
  // empty app shell to a search engine. Figures come from MOCK and the bundles.
  const quizAbout = (level, kind, en, bundle) => {
    const L = (zh, e) => (en ? e : zh), cfg = QUIZ_MOCK[level], lv = level.toLowerCase();
    const tName = (k) => `${en ? QUIZ_TYPES[k].en : QUIZ_TYPES[k].zh} · ${QUIZ_TYPES[k].ja}`;
    const lessons = lessonPages.filter((l) => l.level === level && /^lesson\d+/.test(l.id));
    const lessonList = `<ul class="lesson-list">${lessons.map((l) => `<li><a href="${SITE_PATH}${l.id}/">${l.id.replace("lesson", "Lesson ")} — ${JA_TITLES[l.id] || l.id}</a></li>`).join("")}</ul>`;
    const minutes = cfg.sections.filter((x) => !x.listening).reduce((a, x) => a + x.minutes, 0);
    const ck = ckLevels.includes(level), ckSec = cfg.sections.find((x) => x.listening);
    const scoreRows = cfg.scoring.map((x) => `<tr><td>${en ? x.en : x.zh}</td><td>0–${x.max}</td><td>${x.min}</td></tr>`).join("")
      + `<tr><td>${L("听力", "Listening")}</td><td>0–${cfg.listening.max}</td><td>${cfg.listening.min}</td></tr>`;
    const split = cfg.scoring.length > 1;
    const format = `<h2>${L(`JLPT ${level} 考什么`, `What the JLPT ${level} tests`)}</h2>
<p>${L(`${level} 考言语知识（文字・词汇・语法）、阅读和听力。${split ? "计分分三科：言语知识、阅读、听力" : "计分分两科：言语知识和阅读合为一科，听力一科"}。言语知识和阅读${cfg.sections.length > 2 ? `分两场，共 ${minutes} 分钟` : `在同一场考，${minutes} 分钟`}，之后是听力。总分 180，合格要同时满足总分 ≥ ${cfg.pass}，以及每科不低于最低分：`,
  `The ${level} tests language knowledge (vocabulary and grammar), reading and listening. ${split ? "They are scored as three parts" : "They are scored as two parts: language knowledge and reading together, and listening"}. Language knowledge and reading ${cfg.sections.length > 2 ? `are two sittings, ${minutes} minutes in all` : `are one ${minutes}-minute sitting`}, then comes listening. Out of 180, you pass with a total of at least ${cfg.pass} and every part at or above its minimum:`)}</p>
<table><tr><th>${L("科目", "Part")}</th><th>${L("分数", "Score")}</th><th>${L("最低分", "Minimum")}</th></tr>${scoreRows}</table>`;
    if (kind === "practice") {
      const types = Object.entries(bundle.practice.types).map(([k]) => ({ k, n: bundle.practice.questions.filter((q) => q.type === k).length }));
      return `<section class="quiz-about">${format}
<h2>${L(`这里有哪些题（${bundle.practice.questions.length} 道）`, `What's here (${bundle.practice.questions.length} questions)`)}</h2>
<p>${ck ? L("考试的全部题型（含听力），题目原创，格式和真题一致：", "Every item type on the test, listening included, written from scratch in the real format:") : L("除听力外的全部题型，题目原创，格式和真题一致：", "Every item type on the test except listening, written from scratch in the real format:")}</p>
<ul>${types.map((t) => `<li>${tName(t.k)} — ${t.n}</li>`).join("")}</ul>
<h2>${L("怎么用", "How it works")}</h2>
<ul>
<li>${L("<b>今日练习</b>：每天一组，词汇、语法、阅读混着来。", "<b>Daily set</b>: a short mixed set of vocabulary, grammar and reading each day.")}</li>
<li>${L("<b>按题型练</b>：专攻一种题型，比如排序题（★）或信息检索。", "<b>By question type</b>: drill one format, such as sentence order (★) or information retrieval.")}</li>
<li>${L("<b>解析</b>：答完立刻看正确答案为什么对、每个错误选项为什么错，并链到讲这个语法点的课文；还可以让 AI 针对你选的选项讲解。", "<b>Explanations</b>: after each answer, why the right option is right and why each wrong one is wrong, with a link to the lesson that teaches the point — and an AI explanation of the option you picked.")}</li>
<li>${L("<b>错题本</b>：答错、点了「不会」或答对后点「其实是猜的」的题，当天、3 天后、7 天后再考你，答对才移出。", "<b>Review list</b>: questions you miss, mark “I don’t know”, or flag “I guessed” after getting right come back the same day, after 3 days and after 7 days, until you get them right.")}</li>
<li>${L("进度只保存在这个浏览器里，不用注册。", "Progress stays in this browser; no account needed.")}</li>
</ul>
<h2>${L("常见问题", "Questions")}</h2>
<dl>
<dt>${L("免费吗？", "Is it free?")}</dt><dd>${L("完全免费，没有广告，也不用注册。", "Yes — no ads and no sign-up.")}</dd>
<dt>${L("和真题有多像？", "How close is it to the real JLPT?")}</dt><dd>${L(`题型、题干格式和难度按 ${level} 真题设计，${level === "N5" || level === "N4" ? "语法和阅读带振假名" : "和真考一样不带振假名"}。题目全部原创，不是真题。`, `Item types, layout and difficulty follow the real ${level}; ${level === "N5" || level === "N4" ? "grammar and reading carry furigana, as on the test" : "there's no furigana, as on the test"}. All questions are original, not past papers.`)}</dd>
<dt>${L("有听力吗？", "Is there listening?")}</dt><dd>${ck ? L("有。点播放听一段录音（可以重听），答完看带振假名和翻译的原文，每句都能单独重播。", "Yes. Play the recording (as often as you like), answer, then read the transcript with furigana and a translation, and replay any line on its own.") : L("还没有，听力题在规划中。", "Not yet; listening questions are planned.")}</dd>
<dt>${L("想计时考一次？", "Want a timed run?")}</dt><dd>${bundle.mocks.length ? L(`做 <a href="${SITE_PATH}${lv}-mock-test/">${level} 模拟题</a>：按真考的结构和时间，交卷后估分。`, `Take the <a href="${SITE_PATH}${lv}-mock-test/">${level} mock test</a>: the real structure and timing, with an estimated score.`) : L("模拟题准备中。", "A mock test is on the way.")}</dd>
</dl>
<h2>${L(`${level} 语法课文`, `${level} grammar lessons`)}</h2>
<p>${L(`每道语法题都对应下面某一课的一个语法点。完整清单见 <a href="${SITE_PATH}${level}/">${level} 总览</a>。`, `Every grammar question is tied to a grammar point in one of these lessons. Full list: <a href="${SITE_PATH}${level}/">${level} overview</a>.`)}</p>
${lessonList}${(() => {
      // Lower-level lessons that teach this level's grammar early (ABOVE_LEVEL): their questions are here too.
      const early = Object.keys(bundle.practice.lessons || {}).filter((id) => !lessons.some((l) => l.id === id)).sort();
      if (!early.length) return "";
      const li = early.map((id) => `<li><a href="${SITE_PATH}${id}/">${id.replace("lesson", "Lesson ")} — ${JA_TITLES[id] || id}</a></li>`).join("");
      return `<p>${L(`另外，下面这几课在更早的阶段提前教了 ${level} 的语法，它们的题也在这里：`, `These earlier lessons teach some ${level} grammar ahead of time; their questions are here too:`)}</p><ul class="lesson-list">${li}</ul>`;
    })()}</section>`;
    }
    if (kind === "mock") {
      const t = bundle.mocks[0].test, n = {};
      for (const k of cfg.sections.flatMap((x) => x.types)) n[k] = 0;   // the real test's order
      for (const q of t.questions) n[q.type] = (n[q.type] || 0) + 1;
      for (const k of Object.keys(n)) if (!n[k]) delete n[k];
      return `<section class="quiz-about">${format}
<h2>${L("模拟题的结构", "How the mock test is laid out")}</h2>
<table><tr><th>${L("题型", "Item type")}</th><th>${L("题数", "Questions")}</th></tr>${Object.keys(n).map((k) => `<tr><td>${tName(k)}</td><td>${n[k]}</td></tr>`).join("")}</table>
${(() => {
      const nl = t.sections.filter((x) => x.listening).reduce((a, x) => a + x.problems.reduce((b, p) => b + p.ids.length, 0), 0);
      return nl ? `<p>${L(`言语知识和阅读 ${t.questions.length - nl} 道，限时 ${minutes} 分钟；之后是听力 ${nl} 道（${ckSec.minutes} 分钟），像真考一样每段只播一次，题与题之间留作答时间。题目顺序和真考一致。`, `${t.questions.length - nl} language knowledge and reading questions in ${minutes} minutes, then ${nl} listening questions (${ckSec.minutes} minutes), each recording played once with time to answer after it, as on the day. In the real test's order.`)}</p>`
        : `<p>${L(`一共 ${t.questions.length} 道，限时 ${minutes} 分钟，题目顺序和真考一致。听力不在其中。`, `${t.questions.length} questions in ${minutes} minutes, in the real test's order. Listening isn't included.`)}</p>`;
    })()}
<h2>${L("交卷后", "After you submit")}</h2>
<ul>
<li>${t.sections.some((x) => x.listening) ? L("每科（含听力）的估算分数，和最低分、合格线对照，估计能不能合格。", "An estimated score for each part, listening included, against its minimum and the pass mark — and whether that would pass.") : L("每科的估算分数，和最低分、合格线对照；还会算出听力至少要拿几分才能合格。", "An estimated score for each part against its minimum and the pass mark, and the listening score you'd still need to pass.")}</li>
<li>${L("按题型的正确率，以及时间花在哪里。", "Accuracy by item type, and where your time went.")}</li>
<li>${L("每道题的解析，可以只看错题。", "An explanation for every question, or just the ones you missed.")}</li>
</ul>
<p>${L("估分按答对比例换算。真考是等化计分，实际分数会有出入。离开页面超过 1 分钟会自动暂停，成绩标为“非正式”。", "Scores are estimated from the share of questions right; the real test is equated, so your actual score will differ. Leaving the page for over a minute pauses the clock and marks the attempt informal.")}</p>
<h2>${L("相关", "More")}</h2>
<p>${L(`想按题型慢慢练：<a href="${SITE_PATH}${lv}-practice/">${level} 练习题</a>。背语法：<a href="${SITE_PATH}${lv}-cards/">${level} 语法卡片</a>。考试安排和备考计划：<a href="${SITE_PATH}jlpt-december-2026/">12 月 JLPT 考前指南</a>。`, `Drill by item type: <a href="${SITE_PATH}${lv}-practice/">${level} practice questions</a>. Learn the grammar: <a href="${SITE_PATH}${lv}-cards/">${level} grammar flashcards</a>. Exam day and a study plan: <a href="${SITE_PATH}jlpt-december-2026/">December JLPT guide</a>.`)}</p>
${lessonList}</section>`;
    }
    return `<section class="quiz-about">
<h2>${L("卡片上有什么", "What's on the cards")}</h2>
<p>${L(`${level} 课文里的每个语法点一张卡：语法形式、含义、带振假名和发音的例句。有两种卡：<b>认卡</b>（看语法形式，回想意思）和<b>填空卡</b>（看挖空的例句，回想该填什么）。`, `One card for every grammar point in the ${level} lessons: the form, its meaning, and example sentences with furigana and audio. Two kinds: <b>recognition</b> (see the form, recall the meaning) and <b>fill-in</b> (see an example with a gap, recall what goes there).`)}</p>
<h2>${L("怎么复习", "How the reviews work")}</h2>
<p>${L("翻卡后给自己打分（忘了 / 难 / 记得 / 简单），下次复习的间隔随之变长或缩短，和 Anki 的间隔重复是同一个思路。进度保存在这个浏览器里。", "After turning a card, rate yourself (Again / Hard / Good / Easy) and the next review moves further out or comes sooner — the same spaced-repetition idea as Anki. Progress stays in this browser.")}</p>
<p>${L(`更喜欢用 Anki？下载 <a href="${SITE_PATH}anki/">免费 Anki 卡组</a>（含例句音频）。想练题：<a href="${SITE_PATH}${lv}-practice/">${level} 练习题</a>。`, `Prefer Anki? Get the <a href="${SITE_PATH}anki/">free Anki decks</a> (with example audio). For questions: <a href="${SITE_PATH}${lv}-practice/">${level} practice</a>.`)}</p>
<h2>${L(`${level} 语法课文`, `${level} grammar lessons`)}</h2>
${lessonList}</section>`;
  };
  // Schema: what the page is, and where it sits (Home › level › page).
  const quizSchema = (level, kind, m, url) => JSON.stringify([
    { "@context": "https://schema.org", "@type": kind === "cards" ? "LearningResource" : "Quiz", name: m.h1, description: m.desc, url, inLanguage: m.lang,
      educationalLevel: `JLPT ${level}`, isAccessibleForFree: true, learningResourceType: kind === "mock" ? "Practice test" : kind === "cards" ? "Flashcards" : "Practice questions",
      about: { "@type": "Thing", name: "Japanese language" }, provider: { "@type": "Organization", name: "jpnotes.dev", url: SITE } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: m.home, item: SITE },
      { "@type": "ListItem", position: 2, name: level, item: `${SITE}${level}/` },
      { "@type": "ListItem", position: 3, name: m.crumb, item: url }] },
  ]).replace(/</g, "\\u003c");
  const withAbout = (m, level, kind, en, bundle, url) => ({ ...m, about: quizAbout(level, kind, en, bundle), schema: quizSchema(level, kind, { ...m, lang: en ? "en" : "zh-Hans", home: en ? "Japanese Grammar Notes" : "日语语法笔记" }, url) });
  for (const [level, { practice, mocks }] of Object.entries(quizBundles)) {
    const lv = level.toLowerCase();
    const practiceId = `${lv}-practice`, mockId = `${lv}-mock-test`, cardsId = `${lv}-cards`;
    // The three pages link to each other (when the other one exists).
    const navLinks = (here, en) => [
      here !== practiceId && `✍ <a href="${SITE_PATH}${practiceId}/">${en ? "Practice by question type" : "按题型练习"}</a>`,
      here !== mockId && mocks.length && `⏱ <a href="${SITE_PATH}${mockId}/">${en ? `Timed ${level} mock test` : `${level} 模拟题（计时）`}</a>`,
      here !== cardsId && `🗂 <a href="${SITE_PATH}${cardsId}/">${en ? "Grammar flashcards" : "语法卡片（在线背）"}</a>`,
    ].filter(Boolean).join(" · ");
    const src = writeQuizData(`${lv}.json`, practice);
    const count = practice.questions.length;
    const meta = {
      en: {
        title: `JLPT ${level} Practice Questions — ${ckLevels.includes(level) ? "Listening, " : ""}Vocabulary, Grammar & Reading, with Explanations`,
        desc: `Free JLPT ${level} practice: ${count} exam-style questions — ${ckLevels.includes(level) ? "listening with audio, " : ""}kanji reading, vocabulary, grammar, sentence order and reading — with instant answers, an explanation for every wrong option, and a review list that brings back what you missed.`,
        h1: `JLPT ${level} Practice Questions`, crumb: `${level} Practice`,
        lead: `Exam-style ${level} questions in every format of the test${ckLevels.includes(level) ? ", listening included" : " except listening"}. Answer, see why each option is right or wrong, and the ones you miss come back a few days later.`,
        nav: navLinks(practiceId, true),
      },
      zh: {
        title: `JLPT ${level} 练习题 - ${ckLevels.includes(level) ? "听力・" : ""}文字词汇・语法・阅读在线做题，附详细解析`,
        desc: `免费 JLPT ${level} 练习：${count} 道仿真题，覆盖${ckLevels.includes(level) ? "听力（带音频）、" : ""}汉字读音、词汇、语法、句子排序和阅读，即时判分，每个错误选项都有解析，错题本按间隔重复自动复习。`,
        h1: `JLPT ${level} 练习题`, crumb: `${level} 练习`,
        lead: `${ckLevels.includes(level) ? "覆盖" : "除听力外覆盖 "}${level} 考试的全部题型${ckLevels.includes(level) ? "（含听力）" : ""}。答完马上看每个选项为什么对、为什么错，答错的题过几天会再考你一次。`,
        nav: navLinks(practiceId, false),
      },
    };
    for (const lang of PAGE_LANGS) {
      writeLangPage(practiceId, lang, localizePage(renderQuiz(lang, withAbout(meta[lang.code], level, "practice", lang.code === "en", quizBundles[level], langVariant(practiceId, lang).url), langVariant(practiceId, lang), level, `data-src="${src}"`, src), lang, localizedPageIds));
    }
    quizPageIds.push(practiceId);
    console.log(`  Generated dist/${practiceId}/ (${count} questions${QUIZ_PUBLIC ? "" : ", not public"})`);
    // Flashcards: the data is written by build-anki.js (it runs after this).
    const cardsMeta = {
      en: {
        title: `JLPT ${level} Grammar Flashcards Online — Spaced Repetition, Free`,
        desc: `Learn every JLPT ${level} grammar point with free online flashcards: meaning, examples with furigana and audio, and Anki-style spaced repetition in your browser — no app or account.`,
        h1: `JLPT ${level} Grammar Flashcards`, crumb: `${level} Flashcards`,
        lead: `One card per grammar point in the lessons. Recall it, check the meaning and examples, rate yourself — cards come back just before you'd forget them.`,
        nav: navLinks(cardsId, true),
      },
      zh: {
        title: `JLPT ${level} 语法卡片在线背 - 间隔重复，免费`,
        desc: `在线背 JLPT ${level} 全部语法点：含义、带振假名和发音的例句，按 Anki 式间隔重复安排复习，浏览器里直接用，无需下载 App、无需注册。`,
        h1: `JLPT ${level} 语法卡片`, crumb: `${level} 卡片`,
        lead: `课文里每个语法点一张卡。先回想，再看含义和例句，给自己打分——快忘的时候它会再出现。`,
        nav: navLinks(cardsId, false),
      },
    };
    for (const lang of PAGE_LANGS) {
      writeLangPage(cardsId, lang, localizePage(renderQuiz(lang, withAbout(cardsMeta[lang.code], level, "cards", lang.code === "en", quizBundles[level], langVariant(cardsId, lang).url), langVariant(cardsId, lang), level, `data-mode="cards" data-src="${SITE_PATH}quiz/${lv}-cards.json"`), lang, localizedPageIds));
    }
    quizPageIds.push(cardsId);
    if (!mocks.length) continue;
    // Mock tests: the test file, and its answer key loaded only after submitting.
    const sets = mocks.map(({ test, key }) => ({ id: test.id, n: test.n, src: writeQuizData(`${test.id}.json`, test), key: writeQuizData(`${test.id}.key.json`, key) }));
    const mockMeta = {
      en: {
        title: `JLPT ${level} Mock Test Online — Timed, with Scores and Explanations`,
        desc: `Free timed JLPT ${level} mock test in the real format (vocabulary, grammar and reading), with an estimated score against the pass marks, a breakdown by question type, and explanations for every question.`,
        h1: `JLPT ${level} Mock Test`, crumb: `${level} Mock test`,
        lead: `Original questions in the real test's order and timing, not in the practice bank. No answers until you submit; then an estimated score, where the time went, and an explanation for every question.`,
        nav: navLinks(mockId, true),
      },
      zh: {
        title: `JLPT ${level} 模拟题在线测试 - 计时、估分、逐题解析`,
        desc: `免费 JLPT ${level} 在线模拟考：按真题结构和时间出题（文字词汇、语法、阅读），交卷后估算分数、对照合格线，按题型分析，每道题都有解析。`,
        h1: `JLPT ${level} 模拟题`, crumb: `${level} 模拟题`,
        lead: `原创题目，按真考的顺序和时间作答，和练习题不重复。交卷前不显示答案；交卷后估算分数、看时间花在哪里、逐题看解析。`,
        nav: navLinks(mockId, false),
      },
    };
    for (const lang of PAGE_LANGS) {
      writeLangPage(mockId, lang, localizePage(renderQuiz(lang, withAbout(mockMeta[lang.code], level, "mock", lang.code === "en", quizBundles[level], langVariant(mockId, lang).url), langVariant(mockId, lang), level, `data-mode="mock" data-sets='${JSON.stringify(sets)}'`), lang, localizedPageIds));
    }
    quizPageIds.push(mockId);
    console.log(`  Generated dist/${mockId}/ (${mocks.length} sets${QUIZ_PUBLIC ? "" : ", not public"})`);
  }

  // Hub for everything you can do rather than read: /practice/, one card per
  // level (practice, mock tests, flashcards), levels without questions yet greyed out.
  // One row per level (practice · mock test · flashcards); what each mode is,
  // said once above the table. "已做" comes from this browser's progress.
  const hubRow = (level, en) => {
    const b = quizBundles[level], lv = level.toLowerCase(), L = (zh, e) => (en ? e : zh);
    if (!b) return `<tr class="hub-soon"><th scope="row">${level}</th><td colspan="3">${L("准备中", "Coming soon")}</td></tr>`;
    const n = b.practice.questions.length, types = Object.keys(b.practice.types).length;
    const minutes = b.mocks.length ? b.mocks[0].test.sections.reduce((a, x) => a + x.minutes, 0) : 0;
    return `<tr><th scope="row">${level}</th>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-practice/"><b>${L("练习题", "Practice")}</b><span>${L(`${n} 题 · ${types} 种题型`, `${n} questions · ${types} types`)}<span class="hub-done" data-lv="${lv}" data-t="${L(" · 已做 N", " · N done")}" hidden></span></span></a></td>
      <td>${b.mocks.length ? `<a class="hub-go" href="${SITE_PATH}${lv}-mock-test/"><b>${L("模拟题", "Mock test")}</b><span>${L(`${b.mocks.length} 套 · ${minutes} 分钟`, `${b.mocks.length} test${b.mocks.length > 1 ? "s" : ""} · ${minutes} min`)}</span></a>` : ""}</td>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-cards/"><b>${L("语法卡片", "Flashcards")}</b><span>${L("每个语法点一张", "one per grammar point")}</span></a></td></tr>`;
  };
  const hubIntro = (en) => {
    const L = (zh, e) => (en ? e : zh);
    return `<ul class="hub-modes">
      <li><b>✍ ${L("练习题", "Practice")}</b>${ckLevels.length ? L(`全部题型；听力目前有 ${ckLevels.join("、")}。今日练习、按题型练、错题本；每题答完马上看解析。`, `Every item type; listening so far at ${ckLevels.join(", ")}. Daily sets, by type, a review list; explanations after each answer.`) : L("除听力外的全部题型。今日练习、按题型练、错题本；每题答完马上看解析。", "Every item type but listening. Daily sets, by type, a review list; explanations after each answer.")}</li>
      <li><b>⏱ ${L("模拟题", "Mock test")}</b>${L("按真考的结构和时间计时，交卷后估分、对照合格线。", "The real test's structure and timing; an estimated score against the pass marks.")}</li>
      <li><b>🗂 ${L("语法卡片", "Flashcards")}</b>${L("每个语法点一张卡，间隔复习，认卡和填空卡两种。", "A card per grammar point with spaced repetition, recognition or fill-in.")}</li>
    </ul>`;
  };
  // Answered-question counts per level, from this browser's localStorage.
  const HUB_PROGRESS_JS = `(function(){try{var a=(JSON.parse(localStorage.getItem('jp_quiz_v1'))||{}).answers||{},c={};Object.keys(a).forEach(function(id){var l=id.slice(0,2);c[l]=(c[l]||0)+1;});document.querySelectorAll('.hub-done').forEach(function(el){var n=c[el.getAttribute('data-lv')];if(n){el.textContent=el.getAttribute('data-t').replace('N',n);el.hidden=false;}});}catch(e){}})();`;
  const hubMeta = {
    en: {
      title: "JLPT Practice Tests Online — N5 to N1 Questions, Mock Tests & Flashcards",
      desc: "Free JLPT practice in your browser: exam-style questions for every section except listening, timed mock tests with estimated scores, and grammar flashcards with spaced repetition. No sign-up.",
      h1: "Practice", crumb: "Practice", nav: "",
      lead: "Everything on this site you do rather than read. Pick your level; progress stays in this browser.",
    },
    zh: {
      title: "JLPT 在线练习题 - N5 到 N1 练习、模拟题、语法卡片",
      desc: "免费在线做 JLPT 题：除听力外全部题型的仿真练习题、计时模拟题（交卷估分）、语法卡片间隔复习，打开即用，无需注册。",
      h1: "做题", crumb: "做题", nav: "",
      lead: "这里是本站所有“动手”的部分：练习、模拟、背卡。选你的级别开始，进度保存在这个浏览器里。",
    },
  };
  for (const lang of PAGE_LANGS) {
    const en = lang.code === "en";
    const m = { ...hubMeta[lang.code], body: `${hubIntro(en)}<div class="table-scroll"><table class="hub-table"><tbody>${["N5", "N4", "N3", "N2", "N1"].map((l) => hubRow(l, en)).join("")}</tbody></table></div>
      <script>${HUB_PROGRESS_JS}</script>
      <p class="hub-listen">${en
        ? ckLevels.length ? `🎧 <b>Listening questions: ${ckLevels.join(", ")} so far</b>, other levels on the way. Meanwhile the <a href="https://podcast.jpnotes.dev/" target="_blank">Japanese Daily News podcast</a> has slow news with transcripts.` : `🎧 <b>Listening questions are planned, not built yet.</b> If you want them, <a href="#feedback" class="fb-open">say so</a> — demand decides what comes first. Meanwhile the <a href="https://podcast.jpnotes.dev/" target="_blank">Japanese Daily News podcast</a> has slow news with transcripts.`
        : ckLevels.length ? `🎧 <b>听力题目前有 ${ckLevels.join("、")}</b>，其他级别在做。现在也可以用 <a href="https://podcast.jpnotes.dev/" target="_blank">Japanese Daily News 播客</a>练听力（慢速新闻 + 原文）。` : `🎧 <b>听力题在规划中，还没做。</b>想要的话<a href="#feedback" class="fb-open">告诉我们</a>，想要的人多就先做。现在可以先用 <a href="https://podcast.jpnotes.dev/" target="_blank">Japanese Daily News 播客</a>练听力（慢速新闻 + 原文）。`}</p>` };
    writeLangPage("practice", lang, localizePage(renderQuiz(lang, m, langVariant("practice", lang), "", null), lang, localizedPageIds));
  }
  quizPageIds.push("practice");

  // Settings used to be a standalone page; it is now a modal on every page.
  const settingsStubDir = path.join(__dirname, "dist", "settings");
  fs.mkdirSync(settingsStubDir, { recursive: true });
  fs.writeFileSync(path.join(settingsStubDir, "index.html"), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=${SITE}">
<link rel="canonical" href="${SITE}">
<meta name="robots" content="noindex">
<title>设置已移至弹窗 — ${SITE}</title>
</head>
<body>
<p>设置已改为页面内弹窗，正在跳转到 <a href="${SITE}">首页</a>…</p>
<script>location.replace(${JSON.stringify(SITE)})</script>
</body>
</html>`, "utf-8");

  // After renaming day → lesson, previously-indexed /dayNN/ URLs would 404.
  // After renaming day → lesson, previously-indexed /dayNN/ URLs would 404.
  // Generate a tiny page at each /dayNN/ that meta-refreshes to /lessonNN/.
  // Google's docs explicitly call <meta http-equiv="refresh" content="0;url=">
  // a 301-equivalent — old links and search results transition cleanly.
  let stubCount = 0;
  for (const [oldId, newId] of Object.entries(DAY_TO_LESSON)) {
    const newUrl = `${SITE}${newId}/`;
    const stubDir = path.join(__dirname, "dist", oldId);
    fs.mkdirSync(stubDir, { recursive: true });
    fs.writeFileSync(path.join(stubDir, "index.html"), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=${newUrl}">
<link rel="canonical" href="${newUrl}">
<meta name="robots" content="noindex">
<title>已移动 — ${newUrl}</title>
</head>
<body>
<p>本页已迁移至 <a href="${newUrl}">${newUrl}</a></p>
<script>location.replace(${JSON.stringify(newUrl)})</script>
</body>
</html>`, "utf-8");
    stubCount++;
  }
  console.log(`  Generated ${stubCount} day → lesson redirect stubs`);

  // ─── Sitemap ───
  const homeMod = gitLastModTime("schedule.md") || today;
  const sitemapUrls = [`  <url>
    <loc>${SITE}</loc>
    <lastmod>${homeMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`];
  // A page published once per language (PAGE_LANGS): one <url> per copy,
  // each listing all of them (hreflang).
  const pushLangUrls = (id, lastmod, changefreq, priority) => {
    const alternates = PAGE_LANGS.map(lang => `
    <xhtml:link rel="alternate" hreflang="${lang.hreflang}" href="${SITE}${lang.dir}${id}/"/>`).join("") + `
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${id}/"/>`;
    for (const lang of PAGE_LANGS) {
      sitemapUrls.push(`  <url>
    <loc>${SITE}${lang.dir}${id}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>${alternates}
  </url>`);
    }
  };
  // About page (E-E-A-T page, lower priority since not browsed often)
  if (aboutPageGenerated) pushLangUrls("about", gitLastModTime("pages/about.md") || today, "yearly", "0.5");
  if (QUIZ_PUBLIC) for (const id of quizPageIds) pushLangUrls(id, gitLastModTime("questions") || today, "weekly", "0.8");
  // Anki landing page (downloadable flashcards). Decks are derived from lesson
  // content, so the page effectively changes when any lesson last changed.
  sitemapUrls.push(`  <url>
    <loc>${SITE}anki/</loc>
    <lastmod>${gitLastModTime("grammar") || today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
  // Level overview pages and the guides hub (major landing pages). Each
  // aggregates its lessons, so its lastmod is the directory's last commit.
  for (const level of levelPageIds) {
    pushLangUrls(level, gitLastModTime(`grammar/${level}`) || today, "weekly", "0.9");
  }
  for (const lesson of lessonPages) {
    pushLangUrls(lesson.id, gitLastModTime(lesson.filePath) || today, "monthly", "0.8");
  }
  fs.writeFileSync(path.join(__dirname, "dist/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemapUrls.join("\n")}
</urlset>
`, "utf-8");

  // The /anki/ download assets are data files, not pages: crawlers fetch the
  // text/plain TSVs, find no <title>, and report them as broken HTML pages.
  // The TSV content also duplicates the lesson pages, so there is nothing to
  // gain from having them indexed.
  fs.writeFileSync(path.join(__dirname, "dist/robots.txt"), `User-agent: *
Allow: /
Disallow: /anki/*.txt$
Disallow: /anki/*.apkg$

Sitemap: ${SITE}sitemap.xml
# A summary for language models: ${SITE}llms.txt
`, "utf-8");

  // IndexNow ownership key — must be reachable at https://<host>/<key>.txt and
  // contain exactly the key. CI (indexnow.mjs) submits URLs referencing it.
  fs.writeFileSync(path.join(__dirname, `dist/${INDEXNOW_KEY}.txt`), INDEXNOW_KEY + "\n", "utf-8");

  // CNAME for GitHub Pages custom domain. Skipped while SITE points at
  // *.github.io (no custom domain in use); written automatically once
  // SITE is changed to e.g. https://jpnotes.dev/.
  const cnameHost = new URL(SITE).hostname;
  if (!cnameHost.endsWith(".github.io")) {
    fs.writeFileSync(path.join(__dirname, "dist/CNAME"), cnameHost + "\n", "utf-8");
  }

  // ─── RSS Feed ───
  const rssItems = lessonPages.map(lesson => {
    const mod = gitLastMod(lesson.filePath) || today;
    const pubDate = new Date(mod + "T00:00:00Z").toUTCString();
    const lessonDescRss = lesson.grammarPoints && lesson.grammarPoints.length > 0
      ? `Learn ${lesson.grammarPoints.slice(0, 4).join(", ")} – Japanese grammar lesson with examples.`
      : `${lesson.title} – Japanese grammar lesson with conjugation rules and examples.`;
    return `    <item>
      <title>${lesson.jaTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>
      <link>${SITE}${lesson.id}/</link>
      <description>${lessonDescRss.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</description>
      <pubDate>${pubDate}</pubDate>
      <guid>${SITE}${lesson.id}/</guid>
    </item>`;
  });
  fs.writeFileSync(path.join(__dirname, "dist/feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Japanese Grammar Notes | 日语语法笔记</title>
    <link>${SITE}</link>
    <description>Free structured Japanese grammar notes from N5 to N1. Bilingual with examples and spaced repetition.</description>
    <language>ja</language>
    <atom:link href="${SITE}feed.xml" rel="self" type="application/rss+xml"/>
${rssItems.join("\n")}
  </channel>
</rss>
`, "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/llms.txt"), `# Japanese Grammar Notes / 日语语法笔记

> jpnotes.dev is a free site for learning Japanese grammar for the JLPT, N5 to N1: ${totalLessons} lessons and ${totalPoints}+ grammar points, each with how it attaches, what it means, example sentences with furigana and audio, and how it differs from look-alike patterns — plus practice questions, timed mock tests and grammar flashcards. English pages at ${SITE}, Chinese at ${SITE}zh/.

Key facts:
- Free, no ads, no sign-up; progress (review checklists, practice history) stays in the browser.
- Lessons: N5 (lessons 0–17), N4 (18–34), N3 (35–58), N2 (59–75), N1 (76–92). Every example sentence has furigana and a 🔊 recording.
- Practice: ${Object.entries(quizBundles).map(([l, b]) => `${l} ${b.practice.questions.length}`).join(", ")} exam-style questions covering every non-listening JLPT item type, each option explained; a review list brings back missed questions. One timed mock test per level with an estimated score against the pass marks. Listening questions (recording, then a transcript with translation): ${ckLevels.length ? ckLevels.join(", ") + " so far" : "not built yet"}.
- Ask AI: a side panel on every lesson and after every practice question answers questions about that page; free without setup, or with the reader's own API key (kept in the browser).
- Anki decks (.apkg with audio, and TSV) per level at ${SITE}anki/.

Site: ${SITE}
Author: Ralphbupt (https://github.com/Ralphbupt)
License: CC BY 4.0 — attribution required, no full-site mirroring

## Main pages

- [Home / 主页](${SITE}): Site overview, level cards, getting started.
- [About / 关于](${SITE}about/): Author bio, content sources, methodology, contact, license details.

## JLPT levels (lesson groups)

- [N5 overview / N5 级别概览](${SITE}N5/): Basic sentence patterns, particles, verb groups, て-form, ない-form, た-form, adjectives, conditionals, potential, passive, volitional, conjecture. ${levelCounts.N5} lessons.
- [N4 overview / N4 级别概览](${SITE}N4/): Causative, passive, giving/receiving, ように, ことにする/なる, わけだ/ものだ. ${levelCounts.N4} lessons.
- [N3 overview / N3 级别概览](${SITE}N3/): Formal particles, cause/reason, concession, degree/extent, state, negation, compound expressions. ${levelCounts.N3} lessons.
- [N2 overview / N2 级别概览](${SITE}N2/): Advanced concession, degree/limitation, judgment, contrast, written-formal grammar. ${levelCounts.N2} lessons.${levelCounts.N1 ? `
- [N1 overview / N1 级别概览](${SITE}N1/): Timing, limits, extremes, classical and written forms, evaluation, emphatic emotion. ${levelCounts.N1} lessons.` : ""}

## Grammar checklists (full point-by-point listings)

- [N5 grammar list / N5 文法チェックリスト](${SITE}N5_grammar_list/): All ~70 N5 grammar points with progress checkboxes.
- [N4 grammar list / N4 文法チェックリスト](${SITE}N4_grammar_list/): All ~74 N4 grammar points (excluding N5 overlap).
- [N3 grammar list / N3 文法チェックリスト](${SITE}N3_grammar_list/): All ~150 N3 grammar points.
- [N2 grammar list / N2 文法チェックリスト](${SITE}N2_grammar_list/): All ~130 N2 grammar points.${levelCounts.N1 ? `
- [N1 grammar list / N1 文法チェックリスト](${SITE}N1_grammar_list/): All ~100 N1 grammar points.` : ""}

## Practice, mock tests and flashcards

- [Practice hub](${SITE}practice/): Every level's practice questions, mock test and flashcards.
${Object.entries(quizBundles).map(([l, b]) => { const v = l.toLowerCase(); return `- [JLPT ${l} practice questions](${SITE}${v}-practice/): ${b.practice.questions.length} questions by item type, with explanations.${b.mocks.length ? `\n- [JLPT ${l} mock test](${SITE}${v}-mock-test/): timed, real format, estimated score.` : ""}\n- [JLPT ${l} grammar flashcards](${SITE}${v}-cards/): one card per grammar point, spaced repetition.`; }).join("\n")}

## Guides (comparisons and exam prep)

- [Guides hub / 专题](${SITE}guides/): All comparison pages and the JLPT exam guide.
${lessonPages.filter(l => l.level === "guides").map(l => `- [${l.jaTitle}](${SITE}${l.id}/): ${(SEO_TITLES[l.id] || {}).desc || ""}`).join("\n")}

## Chinese-only copies

Every lesson, checklist, guide and practice page has an English page at \`${SITE}<page>/\` and a Chinese one at \`${SITE}zh/<page>/\` (hreflang en / zh-Hans).

## Feeds and metadata

- [RSS feed](${SITE}feed.xml): Lesson update feed.
- [Sitemap](${SITE}sitemap.xml): Full list of indexable URLs.
- [Source code](https://github.com/Ralphbupt/japanese-grammar): Markdown content and build scripts (Node.js + marked + kuroshiro).

## Lesson page structure

Each \`/lessonNN/\` page contains:
- Conjugation rules (接続)
- Meaning / usage (含义 / 用法)
- 3+ example sentences with furigana (例句)
- Comparison with similar grammar (辨析)
- Common mistakes for Chinese-native speakers (易错点)
- Spaced-repetition checklist (复习计划)
`, "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/manifest.json"), JSON.stringify({
    name: "日语语法笔记 – N5→N1",
    short_name: "日语文法",
    start_url: SITE_PATH,
    scope: SITE_PATH,
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#1a1a2e",
    icons: [
      { src: `${SITE_PATH}favicon-192.png`, sizes: "192x192", type: "image/png" }
    ]
  }, null, 2), "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/404.html"), `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 – 日语语法笔记</title>
<style>
  body { font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #fafaf8; color: #333; }
  .box { text-align: center; }
  h1 { font-size: 4rem; margin: 0; }
  p { font-size: 1.2rem; margin: 1rem 0; }
  a { color: #e94560; text-decoration: none; }
</style>
</head>
<body>
<div class="box">
  <h1>404</h1>
  <p>ページが見つかりません</p>
  <a href="${SITE_PATH}">← ホームに戻る</a>
</div>
</body>
</html>`, "utf-8");

  // ─── OG Image (SVG → PNG via sharp) ───
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="#e94560" stroke-width="2" opacity="0.3"/>
  <text x="600" y="220" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="96" fill="#ffffff" font-weight="bold">日语语法笔记</text>
  <text x="600" y="320" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="42" fill="#c8c8d8">Japanese Grammar Notes</text>
  <text x="600" y="400" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="36" fill="#e94560">N5 → N4 → N3 → N2 → N1</text>
  <text x="600" y="470" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#888888">Free · Bilingual · N5 → N1 · Audio</text>
  <text x="600" y="550" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666666">${SITE_HOST}</text>
</svg>`;
  fs.writeFileSync(path.join(__dirname, "dist/og-image.svg"), ogSvg, "utf-8");

  // Convert main OG SVG to PNG using sharp (#1)
  await sharp(Buffer.from(ogSvg))
    .resize(1200, 630)
    .png()
    .toFile(path.join(__dirname, "dist/og-image.png"));
  console.log("  Generated dist/og-image.png (1200x630)");

  // ─── Per-lesson OG Images (#7) ───
  console.log("Generating per-lesson OG images...");
  for (const lesson of lessonPages) {
    const lessonDir = path.join(__dirname, "dist", lesson.id);
    fs.mkdirSync(lessonDir, { recursive: true });
    // Escape special XML characters in text
    const escJaTitle = (lesson.jaTitle || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ogSeo = SEO_TITLES[lesson.id] || {};
    const level = GROUP_NAMES[lesson.level] ? (ogSeo.level || "Guide") : (lesson.level || "N5");
    const lessonOgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="#e94560" stroke-width="2" opacity="0.3"/>
  <text x="600" y="180" text-anchor="middle" font-family="sans-serif" font-size="48" fill="#e94560" font-weight="bold">JLPT ${level}</text>
  <text x="600" y="310" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="64" fill="#ffffff" font-weight="bold">${escJaTitle}</text>
  <text x="600" y="430" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="32" fill="#c8c8d8">Japanese Grammar Notes</text>
  <text x="600" y="550" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666666">${SITE_HOST}</text>
</svg>`;
    await sharp(Buffer.from(lessonOgSvg))
      .resize(1200, 630)
      .png()
      .toFile(path.join(lessonDir, "og-image.png"));
  }
  console.log(`  Generated ${lessonPages.length} per-lesson OG images`);

  // ─── Index-page OG Images (N5–N1 level pages, about, anki) ───
  // Each shareable index page gets a tailored 1200×630 social preview so a
  // share to XHS / X / Threads / WeChat surfaces a distinctive image rather
  // than the generic site-wide one.
  const ogLevelCounts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0 };
  for (const lp of lessonPages) {
    if (lp.level && ogLevelCounts.hasOwnProperty(lp.level)) ogLevelCounts[lp.level]++;
  }
  const indexOgPages = [
    { slug: "N5", topLabel: "JLPT N5", mainTitle: "N5 文法チェックリスト", sub: `${ogLevelCounts.N5} 课 · 53+ 语法点`, accent: "#e94560" },
    { slug: "N4", topLabel: "JLPT N4", mainTitle: "N4 文法チェックリスト", sub: `${ogLevelCounts.N4} 课 · 54+ 语法点`, accent: "#e94560" },
    { slug: "N3", topLabel: "JLPT N3", mainTitle: "N3 文法チェックリスト", sub: `${ogLevelCounts.N3} 课 · 100+ 语法点`, accent: "#e94560" },
    { slug: "N2", topLabel: "JLPT N2", mainTitle: "N2 文法チェックリスト", sub: `${ogLevelCounts.N2} 课 · 75+ 语法点`, accent: "#e94560" },
    ...(ogLevelCounts.N1 ? [{ slug: "N1", topLabel: "JLPT N1", mainTitle: "N1 文法チェックリスト", sub: `${ogLevelCounts.N1} 课 · 100+ 语法点`, accent: "#e94560" }] : []),
    { slug: "about", topLabel: "About · 关于", mainTitle: "日语语法笔记", sub: "N5 → N1 · Free · Bilingual", accent: "#e94560" },
    { slug: "anki", topLabel: "Anki Decks", mainTitle: "JLPT 文法 卡组", sub: "N5 · N4 · N3 · N2 · N1", accent: "#e94560" },
    { slug: "guides", topLabel: "Guides · 专题", mainTitle: "易混語法 対比", sub: "は vs が · から vs ので · JLPT 12月", accent: "#e94560" },
  ];
  for (const p of indexOgPages) {
    const dir = path.join(__dirname, "dist", p.slug);
    fs.mkdirSync(dir, { recursive: true });
    const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="${p.accent}" stroke-width="2" opacity="0.3"/>
  <text x="600" y="200" text-anchor="middle" font-family="sans-serif" font-size="48" fill="${p.accent}" font-weight="bold">${esc(p.topLabel)}</text>
  <text x="600" y="330" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="80" fill="#ffffff" font-weight="bold">${esc(p.mainTitle)}</text>
  <text x="600" y="430" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#c8c8d8">${esc(p.sub)}</text>
  <text x="600" y="550" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666666">${SITE_HOST}</text>
</svg>`;
    await sharp(Buffer.from(svg))
      .resize(1200, 630)
      .png()
      .toFile(path.join(dir, "og-image.png"));
  }
  console.log(`  Generated ${indexOgPages.length} index-page OG images (N5/N4/N3/N2/about/anki)`);

  console.log(`Done! Output: ${OUT}, sitemap.xml, robots.txt, feed.xml, llms.txt, manifest.json, 404.html, og-image.png`);
}

// ─── CSS ───
const CSS = minifyCss(`
:root {
  --sidebar-w: 230px;
  /* Light theme is "paper": a warm off-white instead of screen white, about
     91% luminance; body text stays ~13:1. */
  --bg: #f6f4ef;
  --sidebar-bg: #efece5;
  --sidebar-text: #5a5a6a;
  --sidebar-heading: var(--text-strong);
  --sidebar-border: var(--border);
  --sidebar-hover-bg: rgba(0,0,0,.05);
  --sidebar-hover-text: var(--text-strong);
  /* Light themes use a deeper red so red text passes 4.5:1 on every light
     surface; dark mode switches back to the brighter #e94560. */
  --accent: #b8283f;
  --accent-soft: rgba(233,69,96,.12);
  --card-bg: #fbfaf7;
  --border: #e3dfd5;
  /* Furigana is a reading aid, not emphasis: muted, so red stays on the
     grammar point itself. */
  --ruby-color: var(--text-muted);
  --link: var(--accent);
  --selection-bg: #b8d4fb;
  --selection-fg: #1a1a2e;
  --word-bg: var(--surface-2);
  --word-border: #cfc8ba;   /* warm grey rule beside lead paragraphs (no yellow) */
  --code-bg: #efece5;
  --surface-2: #efece5;   /* table heads, details, hovered checklist rows */
  --row-alt: #f9f8f4;     /* zebra rows */
  --panel-bg: #f0ede5;    /* related-grammar box */
  --chip-bg: #e8e3d7;     /* cross-link chips */
  --chip-text: var(--text-strong);
  --text: #2b2a27;
  --text-strong: #1a1a2e;
  --text-muted: #605c55;
  --text-subtle: #7a7a7a;

  /* ── Design tokens ──────────────────────────────────────────────
     A small, fixed vocabulary for spacing, type, radius, shadow and
     motion. Prefer these over ad-hoc px/rem so the UI stays consistent. */
  --space-1: .25rem;
  --space-2: .5rem;
  --space-3: .75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-8: 3rem;

  --text-xs: .75rem;
  --text-sm: .85rem;
  --text-base: 1rem;
  --text-lg: 1.2rem;
  --text-xl: 1.5rem;
  --text-md: 1.05rem;
  --text-2xl: 2rem;

  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-pill: 999px;

  --shadow-sm: 0 1px 3px rgba(0,0,0,.06);
  --shadow-md: 0 2px 12px rgba(0,0,0,.08);
  --shadow-lg: 0 12px 40px rgba(0,0,0,.3);
  --shadow-hover: 0 4px 18px rgba(233,69,96,.14);

  --transition: .15s ease;
  --transition-slow: .25s ease;
}
/* Light theme tones (settings → 主题). Paper is the default light theme;
   these ride on .theme-light so every dark-mode rule keeps excluding them. */
html.tone-white {
  --bg: #ffffff; --card-bg: #ffffff; --sidebar-bg: #f7f7f8; --border: #e4e4e7;
  --text: #2d2d2d; --word-bg: #f2f2f3; --word-border: #d4d4d8; --code-bg: #f4f4f5;
  --surface-2: #f2f2f3; --row-alt: #fafafa; --panel-bg: #f4f6f8; --chip-bg: #eceef1;
}
html.tone-sepia {
  --bg: #ece3cf; --card-bg: #f3ecdd; --sidebar-bg: #e3d8c0; --border: #d8ccb2;
  --text: #3a3025; --text-strong: #2a2118; --text-muted: #665846; --text-subtle: #6e604c;
  --sidebar-text: #594c39; --word-bg: #e3d8c0; --word-border: #c2b393; --code-bg: #e3d8c0;
  --surface-2: #e3d8c0; --row-alt: #f0e8d7; --panel-bg: #e6dcc6; --chip-bg: #e0d4ba;
  --accent: #a52238;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 19px; }
body {
  font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", "PingFang SC", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.9;
}

/* Breadcrumb current page: keep it short per Arco's guidance — truncate long
   lesson titles with an ellipsis; the full title shows in the title tooltip. */
.breadcrumb-current {
  display: inline-block; max-width: 34ch;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  vertical-align: bottom;
}
@media (max-width: 768px) { .breadcrumb-current { max-width: 16ch; } }

/* Visible keyboard-focus ring for all interactive controls (complete states,
   accessibility). Mouse clicks don't trigger :focus-visible, so this only
   shows for keyboard users. */
a:focus-visible, button:focus-visible,
input:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* Sidebar */
#sidebar {
  position: fixed; top: 0; left: 0; bottom: 0;
  width: var(--sidebar-w);
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  overflow: hidden;
  display: flex; flex-direction: column;
  z-index: 100;
  transition: width var(--transition-slow);
}
.nav-tools {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 201;
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
  height: 48px;
  padding: 4px;
  width: var(--sidebar-w);
  box-sizing: border-box;
  transition: width var(--transition-slow);
}
#sidebar:not(.collapsed) .nav-tools {
  background: var(--sidebar-bg);
}
#sidebar.collapsed .nav-tools {
  width: 48px;
}
.nav-tool-extra {
  overflow: hidden;
  max-width: 40px;
  opacity: 1;
  transition: max-width var(--transition-slow), opacity var(--transition-slow);
}
#sidebar.collapsed .nav-tool-extra {
  max-width: 0;
  opacity: 0;
  pointer-events: none;
}
#menu-toggle {
  background: var(--sidebar-bg);
  box-shadow: var(--shadow-md);
}
#sidebar:not(.collapsed) #menu-toggle {
  background: transparent;
  box-shadow: none;
}
.nav-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--sidebar-text);
  cursor: pointer;
  text-decoration: none;
  flex-shrink: 0;
  line-height: 0;
}
.nav-tool-btn svg {
  width: 20px;
  height: 20px;
}
.nav-tool-btn:hover,
.nav-tool-btn.active {
  color: var(--sidebar-hover-text);
  background: var(--sidebar-hover-bg);
}
body.settings-open #settings-btn {
  color: var(--accent);
  background: rgba(233,69,96,.15);
}
body.ai-open #ai-btn {
  color: var(--accent);
  background: rgba(233,69,96,.15);
  filter: drop-shadow(0 0 3px var(--accent));
}
/* Shown once ai-assistant.js has run on the page (it adds .has-ai). */
body:not(.has-ai) .nav-tool-ai {
  display: none;
}
#sidebar .nav-scroll {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding-top: 48px;
}
#sidebar.collapsed {
  width: 0;
  min-width: 0;
  overflow: hidden;
}
#sidebar.collapsed .nav-scroll {
  pointer-events: none;
}
.nav-header {
  font-size: 1.2rem; font-weight: 700; color: var(--sidebar-heading);
  padding: .8rem 1.2rem 1rem;
  border-bottom: 1px solid var(--sidebar-border);
  margin-bottom: .5rem;
  white-space: nowrap;
}
/* Accordion level header (a <button> spanning the row) */
.nav-group {
  display: flex; align-items: center; justify-content: space-between; gap: .5rem;
  width: 100%; box-sizing: border-box;
  background: none; border: none; text-align: left; cursor: pointer;
  font-family: inherit;
  font-size: .75rem; text-transform: uppercase; letter-spacing: .08em;
  color: var(--sidebar-heading); padding: .8rem 1.2rem .4rem;
  font-weight: 700; white-space: nowrap;
}
.nav-group:hover { color: var(--accent); }
.nav-caret { font-size: .65rem; opacity: .75; transition: transform var(--transition); }
.nav-group-wrap.expanded .nav-caret { transform: rotate(90deg); }
.nav-group-items { display: none; }
.nav-group-wrap.expanded .nav-group-items { display: block; }
.nav-overview { font-style: italic; }
.nav-overview.active, .nav-overview:hover { font-style: normal; }
.nav-item {
  display: block; padding: .3rem 1rem;
  color: var(--sidebar-text); text-decoration: none;
  font-size: .75rem; border-left: 3px solid transparent;
  transition: all var(--transition);
  line-height: 1.4;
}
.nav-item:hover { color: var(--sidebar-hover-text); background: var(--sidebar-hover-bg); }
.nav-item:has(.nav-num) { display: flex; gap: .55rem; }
.nav-num { flex: none; width: 1.3rem; text-align: right; font-variant-numeric: tabular-nums; }
.nav-item.active {
  color: var(--sidebar-hover-text); background: rgba(233,69,96,.15);
  border-left-color: var(--accent);
}

/* Main */
#content {
  margin-left: var(--sidebar-w);
  margin-right: 220px;
  padding: 2rem 3rem 4rem;
  max-width: 1050px;
  transition: margin-left var(--transition-slow);
}
body.sidebar-collapsed #content {
  margin-left: 0;
  padding-top: 3.5rem;
}
.lesson { display: none; content-visibility: auto; contain-intrinsic-size: 0 500px; }
.lesson.active { display: block; content-visibility: visible; }
.comments-section { margin-top: 3rem; padding-top: 2rem; border-top: 2px solid var(--border); }
.comments-heading { font-size: var(--text-lg); margin: 0 0 1rem; color: var(--text-muted); font-weight: 600; }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .comments-heading { color: #999; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark .comments-heading { color: #999; }

/* Bilingual toggle */
:not(body).lang-en { display: none; }
body.lang-en .lang-zh { display: none; }
body.lang-en span.lang-en { display: inline; }
body.lang-en div.lang-en { display: block; }

/* Typography */
h1 { font-size: var(--text-2xl); margin: 0 0 1.4rem; border-bottom: 2px solid var(--accent); padding-bottom: .6rem; }
h2 { font-size: var(--text-xl); margin: 2.2rem 0 .9rem; color: var(--text-strong); }
h3 { font-size: var(--text-lg); margin: 1.6rem 0 .6rem; }
h4 { font-size: var(--text-md); margin: 1.3rem 0 .5rem; }
p { margin: .6rem 0; }
ul, ol { margin: .5rem 0 .5rem 1.5rem; }
li { margin: .2rem 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
blockquote {
  border-left: 3px solid var(--accent);
  background: rgba(233,69,96,.04);
  padding: .6rem 1rem; margin: .8rem 0;
  font-size: .95rem;
}

/* Ruby / Furigana */
ruby { ruby-align: center; }
rt {
  font-size: .6em; color: var(--ruby-color);
  font-weight: 400;
  /* Furigana is decoration, not content: keep it out of text selection so
     highlighting a sentence paints one clean bar instead of a row of detached
     boxes floating above the kanji. Copied text stays reading-free too. */
  -webkit-user-select: none; user-select: none;
}
rp { -webkit-user-select: none; user-select: none; }
/* Chrome paints a selected ruby base as tall as base + annotation, but plain
   text only as tall as the line box, so the bar stepped up over every kanji.
   Give furigana lines enough line-height for the annotation to fit inside the
   line box; then both rects share one top edge. rt line-height: 1 keeps the
   annotation box tight so 2.2 is enough. */
li[data-ja], p[data-ja], td[data-ja], th[data-ja], blockquote[data-ja], dt[data-ja], dd[data-ja], summary[data-ja] { line-height: 2.2; }
rt { line-height: 1; }
/* Model sentences are set in Mincho, like a textbook's example lines, so the
   Japanese being studied reads apart from the explanation around it. System
   fonts only (Mac/iOS, Windows, Android/Linux): nothing to download. */
li[data-ex] {
  font-family: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", "Source Han Serif JP", serif;
  font-size: 1.05em;
}
li[data-ex] strong { color: var(--accent); }
li[data-ex] button { font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", "PingFang SC", sans-serif; }
li .ex-tr {
  display: block; line-height: 1.6; margin: -.15rem 0 .55rem;
  font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", "PingFang SC", sans-serif;
  font-size: .78em; color: var(--text-muted);
}
li .ex-tr .ex-p { display: none; }
/* Opaque selection colour: Chrome's translucent default double-paints where
   the ruby rect and its neighbour overlap, leaving a bright 1px seam. */
::selection { background: var(--selection-bg); color: var(--selection-fg); }
body.hide-ruby rt { visibility: hidden; }
body.hide-ruby ruby:hover rt { visibility: visible; }

/* Tables */
table {
  border-collapse: collapse; width: 100%;
  margin: .8rem 0; font-size: .9rem;
}
th, td {
  border: 1px solid var(--border);
  padding: .4rem .7rem; text-align: left;
}
th { background: var(--surface-2); font-weight: 600; font-size: .85rem; }
tr:nth-child(even) { background: var(--row-alt); }
/* Plain links in page content: the theme's link colour, not browser blue. */
:where(#content a:not([class])) { color: var(--link); text-underline-offset: 2px; }
/* Long URLs / inline code break instead of widening the page on phones. */
#content { overflow-wrap: break-word; }
.table-scroll { overflow-x: auto; margin: .8rem 0; }
.table-scroll > table { margin: 0; }
/* Phones: tighter cells, but never narrower than a two-character word, so
   知る / 进入 / 动词 don't break one character per line. */
@media (max-width: 640px) {
  th, td { padding: .4rem .45rem; min-width: 2.9em; }
}

/* Word table highlight */
table.word-table th { background: var(--word-bg); }
table.word-table td:first-child { font-size: 1.2rem; font-weight: 500; white-space: nowrap; }
table.word-table td:nth-child(2) { color: var(--text-muted); }
table.word-table .pos { font-size: .75em; color: var(--text-muted); border: 1px solid currentColor; border-radius: 3px; padding: 0 .3em; white-space: nowrap; }
table.word-table .gloss-note { display: block; font-size: .85em; color: var(--text-muted); margin-top: .15em; }
table.word-table .collocs { display: block; margin-top: .25em; }
table.word-table .colloc { display: block; font-size: .85em; color: var(--text-muted); line-height: 1.9; }
table.word-table .colloc-ja { font-size: 1.1em; color: var(--text); margin-right: .2em; }

/* Checklist */
.checklist-progress {
  background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: .8rem 1.2rem; margin: 1rem 0 1.5rem; display: flex; align-items: center; gap: 1rem;
  font-size: .85rem; color: var(--text-muted);
}
.checklist-progress .progress-label { white-space: nowrap; }
.checklist-progress .progress-bar {
  flex: 1; height: 6px; background: #e3dfd5; border-radius: var(--radius-sm); overflow: hidden;
}
.checklist-progress .progress-fill {
  height: 100%; background: var(--accent); border-radius: var(--radius-sm); transition: width .3s;
}
.checklist-progress .progress-text { white-space: nowrap; font-weight: 500; min-width: 80px; text-align: right; }
ul:has(input[type="checkbox"]) {
  list-style: none; padding-left: 0;
}
ul:has(input[type="checkbox"]) li {
  padding: .4rem .6rem; border-radius: var(--radius); margin: .2rem 0;
  transition: background .2s;
}
ul:has(input[type="checkbox"]) li > label { display: block; cursor: pointer; }
ul:has(input[type="checkbox"]) li:hover { background: var(--surface-2); }
ul:has(input[type="checkbox"]) li.checked {
  text-decoration: line-through; color: var(--text-subtle);
}
ul:has(input[type="checkbox"]) li.checked input[type="checkbox"] { accent-color: var(--accent); }
input[type="checkbox"] {
  width: 1.1em; height: 1.1em; margin-right: .5em; cursor: pointer;
  vertical-align: middle; accent-color: var(--accent);
}

/* Code */
pre {
  background: var(--code-bg); padding: 1rem; border-radius: var(--radius);
  overflow-x: auto; margin: .8rem 0; font-size: .85rem;
  line-height: 1.6;
}
code {
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", monospace;
  background: var(--code-bg); padding: .1rem .3rem; border-radius: var(--radius-sm);
  font-size: .88em;
}
pre code { background: none; padding: 0; }

/* SEO lead paragraph (keyword-rich summary after h1) */
.seo-lead {
  font-size: .95rem; color: var(--text-muted);
  background: var(--card-bg); border-left: 3px solid var(--word-border);
  padding: .7rem 1rem; margin: 0 0 1.5rem;
  border-radius: 0 var(--radius) var(--radius) 0;
  line-height: 1.7;
}
.seo-lead strong { color: var(--accent); font-weight: 600; }

/* Lesson meta line (last-updated, reading time) — sits between h1 and seo-lead */
.lesson-meta {
  font-size: .82rem; color: var(--text-muted);
  margin: -.6rem 0 1.2rem;
}
.lesson-meta time { color: var(--text-muted); }

/* TTS speak button on example sentences */
.speak-btn {
  display: inline-block;
  background: none; border: 1px solid var(--border);
  border-radius: 50%; width: 1.6em; height: 1.6em;
  font-size: .75rem; line-height: 1.5em;
  cursor: pointer; margin-left: .4em;
  vertical-align: middle; padding: 0;
  opacity: .5; transition: opacity .2s, border-color .2s;
  -webkit-user-select: none; user-select: none;  /* keep 🔊 out of selections and copies */
}
.speak-btn:hover { opacity: 1; border-color: var(--accent); }
.speak-btn.playing { opacity: 1; border-color: var(--accent); }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .speak-btn { border-color: #3a3a55; }
  :root:not(.theme-light) .speak-btn:hover { border-color: var(--accent); }
}
html.theme-dark .speak-btn { border-color: #3a3a55; }
html.theme-dark .speak-btn:hover { border-color: var(--accent); }

/* Cross-links */
.related-grammar {
  background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: .6rem 1rem; margin: 1.5rem 0; font-size: .85rem;
}
.related-label { font-weight: 600; color: var(--text-muted); margin-right: .5rem; }
.quiz-link { margin: 1.4rem 0 .4rem; }
.level-note { margin: .2rem 0 1rem; font-size: .9em; color: var(--text-muted); }
.quiz-cta { margin: 2rem 0 1rem; padding: 1rem 1.2rem; border: 1px solid var(--accent); border-radius: var(--radius-lg); background: rgba(127,127,127,.07); }
.quiz-cta p { margin: 0 0 .7rem; }
.quiz-cta a { display: inline-block; padding: .45em 1.2em; border-radius: 999px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 700; }
.quiz-cta a:hover { filter: brightness(1.1); }
.nav-hub { margin: .2rem .6rem .6rem; font-weight: 600; }
.quiz-link a, .ov-quiz a { display: inline-block; padding: .35em .95em; border: 1px solid var(--accent); border-radius: 999px; color: var(--accent); text-decoration: none; font-size: .92em; }
.quiz-link a:hover, .ov-quiz a:hover { background: var(--accent); color: #fff; }
.ov-quiz { display: flex; flex-wrap: wrap; gap: .5rem; margin: .8rem 0 1.2rem; }
.cross-link {
  display: inline-block; background: var(--chip-bg); color: var(--chip-text);
  padding: .15rem .55rem; border-radius: var(--radius-sm); margin: .15rem .2rem;
  text-decoration: none; font-size: .82rem;
  line-height: 1.5;
}
.cross-link:hover { background: var(--accent); color: #fff; }
.cross-link:hover .cross-link-desc,
.cross-link:hover .cross-link-level { color: rgba(255,255,255,.9); background: none; border-color: rgba(255,255,255,.5); }
.cross-link-term { font-weight: 600; }
.cross-link-desc { font-size: .88em; margin-left: .35em; color: var(--text-muted); font-weight: 400; }
h2 .romaji { font-weight: 400; font-size: .7em; color: var(--text-muted); letter-spacing: .01em; }
.cross-link-desc::before { content: "· "; opacity: .55; }
.cross-link-level {
  display: inline-block; margin-left: .4em;
  font-size: .68em; font-weight: 700; letter-spacing: .03em;
  border: 1px solid var(--border); color: var(--text-muted);
  padding: 0 .35em; border-radius: var(--radius-sm);
  vertical-align: 1px;
}

/* Details */
details {
  background: var(--surface-2); border-radius: var(--radius);
  padding: .5rem 1rem; margin: .8rem 0;
}
summary {
  cursor: pointer; font-weight: 600; color: var(--text-strong);
  padding: .2rem 0;
}

summary::marker { color: var(--accent); }
summary:hover { color: var(--link); }

/* Page footer */
.site-footer {
  margin-top: 3rem; padding-top: 1.2rem;
  border-top: 1px solid var(--border);
  text-align: center; font-size: .8rem; color: var(--text-muted);
}
.site-footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: .3rem 1.2rem; }
.site-footer a { color: inherit; text-decoration: none; white-space: nowrap; }
.site-footer a:hover { color: var(--accent); }
.site-footer p { margin: .5rem 0 0; }

/* Narrow screens: no right margin on content */
@media (max-width: 900px) {
  #content { margin-right: 0; }
}

/* Mobile: sidebar expands as overlay; content stays full width. */
#sb-backdrop, #m-bar { display: none; }
@media (max-width: 768px) {
  #m-bar {
    display: flex; align-items: center; gap: 2px;
    position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 90;
    padding: 4px 6px 4px 54px; background: var(--bg); border-bottom: 1px solid var(--border);
    transition: transform var(--transition-slow);
  }
  #m-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-strong); font-size: .78rem; font-weight: 700; text-decoration: none; }
  .m-btn { display: flex; align-items: center; justify-content: center; flex: none; width: 38px; height: 40px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); cursor: pointer; }
  .m-btn[hidden] { display: none; }
  .m-btn svg { width: 20px; height: 20px; }
  .m-btn:active { background: var(--chip-bg); }
  body.ai-open .m-btn[data-m="ai"] { color: var(--accent); }
  /* ☰ sits in the bar's left end: flat, and slides away with it. */
  #sidebar.collapsed #menu-toggle { background: transparent; box-shadow: none; }
  .nav-tools { transition: width var(--transition-slow), transform var(--transition-slow); }
  .nav-tool-extra { display: none !important; }
  html.mbar-hidden #m-bar, html.mbar-hidden #sidebar.collapsed .nav-tools { transform: translateY(-100%); }
  html .q-mockbar { transition: top var(--transition-slow); }
  html:not(.mbar-hidden) .q-mockbar { top: 48px; }
  #sidebar:not(.collapsed) {
    box-shadow: 2px 0 16px rgba(0,0,0,.25);
  }
  body:not(.sidebar-collapsed) #sb-backdrop { display: block; position: fixed; inset: 0; z-index: 99; background: rgba(0,0,0,.35); }
  html.sb-lock, html.sb-lock body { overflow: hidden; }
  #content { margin-left: 0 !important; margin-right: 0; padding: 3.5rem 1rem 4rem; }
}

/* Home page landing layout (no lesson articles inlined).
   Hide the right-hand TOC panel (no lessons to navigate within) and
   center the directory horizontally. Sidebar is position: fixed and
   doesn't occupy flow, so margin: 0 auto centers cleanly across the
   viewport on wide screens. */
#content.home,
body.sidebar-collapsed #content.home {
  max-width: 1100px;
  margin-left: auto;
  margin-right: auto;
}
.home-hero {
  text-align: center;
  padding: 2.5rem 1rem 1.8rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 2.2rem;
}
.home-hero h1 {
  font-size: 2rem; margin: 0 0 1rem;
  border: none; padding: 0; color: var(--text-strong);
}
.home-intro {
  font-size: 1rem; color: var(--text-muted);
  max-width: 680px; margin: 0 auto 1.6rem;
  line-height: 1.75;
}
.home-intro strong { color: var(--accent); font-weight: 600; }
@media (max-width: 640px) {
  .home-hero { padding-top: 1.5rem; }
  .home-hero h1 { font-size: 1.45rem; line-height: 1.5; }
  .home-intro { font-size: .9rem; }
}
.home-actions {
  display: flex; justify-content: center; gap: .8rem; flex-wrap: wrap;
  margin: 1.4rem 0 .4rem;
}
.home-actions a {
  display: inline-block; padding: .55rem 1.3rem; border-radius: var(--radius);
  font-size: .95rem; font-weight: 600; text-decoration: none;
  border: 1px solid var(--accent);
}
/* Same darker red as .level-tag so white text passes AA. */
.home-actions .btn-primary { background: #d6354c; border-color: #d6354c; color: #fff; }
.home-actions .btn-primary:hover { background: #c02a40; }
.home-actions .btn-secondary { color: var(--accent); }
.home-actions .btn-secondary:hover { background: var(--accent-soft); }
.home-levels h2, .home-howto h2 {
  font-size: 1.35rem; margin: 2rem 0 1rem; color: var(--text-strong);
}
.level-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.2rem;
  margin: 1rem 0 2.4rem;
}
@media (max-width: 640px) {
  .level-grid { grid-template-columns: 1fr; }
}
.level-card {
  display: block;
  padding: 1.4rem 1.6rem;
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  text-decoration: none; color: inherit;
  transition: all .2s;
}
.level-card:hover { border-color: var(--accent); }
.level-head { display: flex; align-items: center; gap: .7rem; margin-bottom: .9rem; }
.level-head .level-tag { margin-bottom: 0; }
.level-range { font-size: .82rem; color: var(--text-muted); }
.level-tag {
  display: inline-block;
  padding: .2rem .65rem;
  /* Slightly darker than --accent so #fff text passes AA 4.5:1 contrast. */
  background: #d6354c; color: #fff;
  font-size: .82rem; font-weight: 700;
  border-radius: var(--radius-sm); letter-spacing: .05em;
  margin-bottom: .9rem;
}
.level-card h3 {
  font-size: 1.25rem; margin: .2rem 0 .6rem;
  color: var(--text-strong);
}
.level-card p {
  font-size: 1rem; color: var(--text-muted);
  line-height: 1.65; margin: 0;
}
.home-howto p {
  color: var(--text-muted); line-height: 1.75;
  margin: .6rem 0;
}
.home-howto a {
  color: var(--accent); text-decoration: underline;
  text-underline-offset: 2px;
}
.home-howto a:hover { text-decoration: underline; text-decoration-thickness: 2px; }

/* ─── Dark mode (follows OS preference) ───
   The site already uses CSS variables for most colors, so overriding
   them here flips the palette without touching individual rules. The
   accent red (#e94560) and ruby furigana color stay — they read well
   on both light and dark backgrounds. */
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) {
    --bg: #14141e;
    --sidebar-bg: #0a0a14;
    --sidebar-text: #b8b8c4;
    --sidebar-heading: #f0f0f5;
    --sidebar-border: rgba(255,255,255,.08);
    --sidebar-hover-bg: rgba(255,255,255,.06);
    --sidebar-hover-text: #fff;
    --card-bg: #1f1f2e;
    --border: #2d2d44;
    --text: #d4d4dc;
    --text-strong: #f0f0f5;
    --text-muted: #a8a8b8;
    --text-subtle: #888;
    --word-bg: #25253a;
    --surface-2: #25253a;
    --word-border: #3a3a55;
    --code-bg: #1f1f2e;
    --ruby-color: #a8a8b8;
    --accent: #e94560;
    --link: #ff7088;
    --selection-bg: #3b6fd6;
    --selection-fg: #fff;
  }
  /* Accent-colored strong text fails 4.5:1 on dark card surfaces; brighten. */
  :root:not(.theme-light) .seo-lead strong, :root:not(.theme-light) .home-intro strong { color: #ff7088; }
  /* .breadcrumb is defined on each page; override gray contrast for dark. */
  :root:not(.theme-light) .breadcrumb { color: #999 !important; }
  /* .related-label gray on the (red-tinted) related-grammar box was 4.46
     in dark mode (just under AA 4.5). Lighten to clear the bar. */
  :root:not(.theme-light) .related-label { color: #a8a8b8; }
  :root:not(.theme-light) body { color: #d4d4dc; }
  :root:not(.theme-light) h1 { color: #f0f0f5; }
  :root:not(.theme-light) h2 { color: #e4e4ec; }
  :root:not(.theme-light) h3, :root:not(.theme-light) h4 { color: #d8d8e0; }
  :root:not(.theme-light) th { background: #25253a; color: #e4e4ec; }
  :root:not(.theme-light) tr:nth-child(even) { background: rgba(255, 255, 255, 0.025); }
  :root:not(.theme-light) blockquote { background: rgba(233, 69, 96, 0.08); }
  :root:not(.theme-light) details { background: #1f1f2e; }
  :root:not(.theme-light) ul:has(input[type="checkbox"]) li:hover { background: #1f1f2e; }
  :root:not(.theme-light) ul:has(input[type="checkbox"]) li.checked { color: #6a6a78; }
  :root:not(.theme-light) .seo-lead { background: #1f1f2e; color: #c8c8d4; }
  :root:not(.theme-light) .lesson-meta { color: #a8a8b8; }
  :root:not(.theme-light) .lesson-meta time { color: #b8b8c4; }
  :root:not(.theme-light) .related-grammar { background: #1b1b28; border-color: var(--border); }
  :root:not(.theme-light) .cross-link { background: #25253a; color: #e4e4ec; }
  :root:not(.theme-light) .cross-link:hover { background: var(--accent); color: #fff; }
  :root:not(.theme-light) .checklist-progress { background: #1f1f2e; color: #b8b8c4; }
  :root:not(.theme-light) .checklist-progress .progress-bar { background: #2d2d44; }
  /* Home page */
  :root:not(.theme-light) .home-hero h1 { color: #f0f0f5; }
  :root:not(.theme-light) .home-intro { color: #b8b8c4; }
  :root:not(.theme-light) .home-levels h2, :root:not(.theme-light) .home-howto h2 { color: #e4e4ec; }
  :root:not(.theme-light) .level-card { background: #1f1f2e; }
  :root:not(.theme-light) .level-card h3 { color: #f0f0f5; }
  :root:not(.theme-light) .level-card p { color: #b8b8c4; }
  :root:not(.theme-light) .home-howto p { color: #b8b8c4; }
  /* Code */
  :root:not(.theme-light) code { color: #f0a0b0; }
  :root:not(.theme-light) pre code { color: #d4d4dc; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark {
    --bg: #14141e;
    --sidebar-bg: #0a0a14;
    --sidebar-text: #b8b8c4;
    --sidebar-heading: #f0f0f5;
    --sidebar-border: rgba(255,255,255,.08);
    --sidebar-hover-bg: rgba(255,255,255,.06);
    --sidebar-hover-text: #fff;
    --card-bg: #1f1f2e;
    --border: #2d2d44;
    --text: #d4d4dc;
    --text-strong: #f0f0f5;
    --text-muted: #a8a8b8;
    --text-subtle: #888;
    --word-bg: #25253a;
    --surface-2: #25253a;
    --word-border: #3a3a55;
    --code-bg: #1f1f2e;
    --ruby-color: #a8a8b8;
    --accent: #e94560;
    --link: #ff7088;
    --selection-bg: #3b6fd6;
    --selection-fg: #fff;
  }
/* Accent-colored strong text fails 4.5:1 on dark card surfaces; brighten. */
html.theme-dark .seo-lead strong, html.theme-dark .home-intro strong { color: #ff7088; }
/* .breadcrumb is defined on each page; override gray contrast for dark. */
html.theme-dark .breadcrumb { color: #999 !important; }
/* .related-label gray on the (red-tinted) related-grammar box was 4.46
     in dark mode (just under AA 4.5). Lighten to clear the bar. */
html.theme-dark .related-label { color: #a8a8b8; }
html.theme-dark body { color: #d4d4dc; }
html.theme-dark h1 { color: #f0f0f5; }
html.theme-dark h2 { color: #e4e4ec; }
html.theme-dark h3, html.theme-dark h4 { color: #d8d8e0; }
html.theme-dark th { background: #25253a; color: #e4e4ec; }
html.theme-dark tr:nth-child(even) { background: rgba(255, 255, 255, 0.025); }
html.theme-dark blockquote { background: rgba(233, 69, 96, 0.08); }
html.theme-dark details { background: #1f1f2e; }
html.theme-dark ul:has(input[type="checkbox"]) li:hover { background: #1f1f2e; }
html.theme-dark ul:has(input[type="checkbox"]) li.checked { color: #6a6a78; }
html.theme-dark .seo-lead { background: #1f1f2e; color: #c8c8d4; }
html.theme-dark .lesson-meta { color: #a8a8b8; }
html.theme-dark .lesson-meta time { color: #b8b8c4; }
html.theme-dark .related-grammar { background: #1b1b28; border-color: var(--border); }
html.theme-dark .cross-link { background: #25253a; color: #e4e4ec; }
html.theme-dark .cross-link:hover { background: var(--accent); color: #fff; }
html.theme-dark .checklist-progress { background: #1f1f2e; color: #b8b8c4; }
html.theme-dark .checklist-progress .progress-bar { background: #2d2d44; }
/* Home page */
html.theme-dark .home-hero h1 { color: #f0f0f5; }
html.theme-dark .home-intro { color: #b8b8c4; }
html.theme-dark .home-levels h2, html.theme-dark .home-howto h2 { color: #e4e4ec; }
html.theme-dark .level-card { background: #1f1f2e; }
html.theme-dark .level-card h3 { color: #f0f0f5; }
html.theme-dark .level-card p { color: #b8b8c4; }
html.theme-dark .home-howto p { color: #b8b8c4; }
/* Code */
html.theme-dark code { color: #f0a0b0; }
html.theme-dark pre code { color: #d4d4dc; }

/* ─── Search (command palette) ─── */
#search-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.45); display: flex; align-items: flex-start; justify-content: center; padding: 12vh 1rem 1rem; }
#search-overlay[hidden] { display: none; }
#search-box { width: 100%; max-width: 560px; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; background: var(--card-bg); color: inherit; border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); }
#search-input { border: none; outline: none; background: transparent; color: inherit; font-size: 1.05rem; padding: 1rem 1.2rem; border-bottom: 1px solid var(--border); }
#search-results { list-style: none; margin: 0; padding: .4rem; overflow-y: auto; }
#search-results a { display: flex; align-items: baseline; gap: .6rem; padding: .55rem .7rem; border-radius: var(--radius-lg); text-decoration: none; color: inherit; }
#search-results a.sel, #search-results a:hover { background: var(--accent); color: #fff; }
#search-results a.sel .sr-lvl, #search-results a:hover .sr-lvl { background: rgba(255,255,255,.25); }
.sr-lvl { flex-shrink: 0; font-size: .7rem; font-weight: 700; background: var(--accent); color: #fff; padding: .1rem .4rem; border-radius: var(--radius-sm); }
.sr-title { font-weight: 600; }
.sr-pts { font-size: .8rem; opacity: .6; margin-left: auto; text-align: right; }
.search-empty { padding: 1rem 1.2rem; opacity: .6; }
#search-hint { font-size: .72rem; opacity: .55; padding: .5rem 1.2rem; border-top: 1px solid var(--border); }
@media (max-width: 600px) { #search-hint { display: none; } #search-overlay { padding: 6vh .6rem 1rem; } }
html.theme-dark #search-box { background: #1f1f2e; }

/* Desktop top-right quick controls (injected by settings-modal.js). On
   mobile the sidebar toolbar + settings modal take over, so the bar hides and
   the toolbar's search / AI / settings buttons only show there. */
#top-controls {
  position: fixed; top: .8rem; right: 1.2rem;
  display: flex; align-items: center; gap: .5rem; z-index: 200;
}
.tc-pill {
  background: var(--card-bg); color: inherit; font: inherit; font-size: .8rem;
  padding: .4rem .8rem; border-radius: var(--radius);
  border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  cursor: pointer; line-height: 1.2;
}
.tc-pill:hover { border-color: var(--accent); }
.tc-pill input { margin: 0 .3rem 0 0; vertical-align: -1px; }
.tc-icon { padding: .38rem .55rem; display: inline-flex; align-items: center; }
.tc-icon svg, #settings-box .js-theme-btn svg { width: 17px; height: 17px; display: block; }
/* Theme picker: five swatch buttons, in the settings modal and in the
   top-bar menu. Swatches show each theme's own page and text colours. */
.settings-row-theme > div { flex: 1; }
.theme-choices { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .6rem; }
.theme-choice {
  display: inline-flex; align-items: center; gap: .4rem;
  padding: .3rem .65rem .3rem .4rem; font: inherit; font-size: .82rem; color: inherit;
  background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius-pill); cursor: pointer;
}
.theme-choice:hover { border-color: var(--accent); }
.theme-choice[aria-checked="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.theme-swatch { width: 1.05rem; height: 1.05rem; border-radius: 50%; border: 1px solid rgba(0,0,0,.25); flex: none; }
.sw-auto { background: linear-gradient(135deg, #f6f4ef 50%, #14141e 50%); }
.sw-white { background: #ffffff; }
.sw-light { background: #f6f4ef; }
.sw-sepia { background: #ece3cf; }
.sw-dark { background: #14141e; }
#theme-menu {
  position: absolute; top: calc(100% + .4rem); right: 0;
  background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md); padding: .5rem;
}
#theme-menu .theme-choices { flex-direction: column; margin: 0; }
#theme-menu .theme-choice { border-color: transparent; border-radius: var(--radius); }
#theme-menu .theme-choice[aria-checked="true"] { border-color: var(--accent); box-shadow: none; }
.tc-lang { font-weight: 700; }
/* Share menu (settings-modal.js jpShare): copy link + a few networks; on
   touch devices the system share sheet is used instead. */
#share-menu { position: fixed; z-index: 1100; min-width: 11rem; background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); padding: .35rem; display: flex; flex-direction: column; }
#share-menu button, #share-menu a { display: block; text-align: left; padding: .45rem .7rem; border-radius: var(--radius); font: inherit; font-size: .88rem; color: inherit; background: none; border: 0; cursor: pointer; text-decoration: none; }
#share-menu button:hover, #share-menu a:hover { background: rgba(127,127,127,.16); }
#share-menu .sm-ok { color: var(--accent); }
#share-menu .sm-hint { font-size: .8rem; color: var(--text-muted); padding: .45rem .7rem; max-width: 15rem; line-height: 1.5; }
#share-menu .sm-qr { width: 13rem; margin: .5rem auto .2rem; padding: .4rem; background: #fff; border-radius: var(--radius); }
#share-menu .sm-qr svg { display: block; width: 100%; height: auto; }
#share-menu .sm-manual { font: inherit; font-size: .8rem; margin: .3rem; padding: .3rem; width: 15rem; }
body.ai-open #tc-ai { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
@media (min-width: 769px) { .nav-tool-extra { display: none; } }
@media (max-width: 768px) { #top-controls { display: none; } }

/* Settings modal */
#settings-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.45); display: flex; align-items: flex-start; justify-content: center; padding: 10vh 1rem 1rem; }
#settings-overlay[hidden] { display: none; }
#settings-box { width: 100%; max-width: 520px; max-height: 80vh; overflow-y: auto; background: var(--card-bg); color: inherit; border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: 1.2rem 1.4rem 1rem; }
.settings-head h2 { margin: 0 0 .35rem; font-size: var(--text-xl); border: none; padding: 0; color: var(--text-strong); }
.settings-lead { margin: 0 0 1.2rem; color: var(--text-muted); font-size: .9rem; line-height: 1.6; }
.settings-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; background: var(--bg); }
.settings-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .9rem 1rem; border-bottom: 1px solid var(--border); }
.settings-row:last-child { border-bottom: none; }
.settings-label { font-weight: 600; color: var(--text-strong); font-size: .95rem; }
.settings-desc { font-size: .8rem; color: var(--text-muted); margin-top: .2rem; line-height: 1.45; }
.settings-control label { cursor: pointer; display: flex; align-items: center; gap: .35rem; white-space: nowrap; }
#settings-box .js-theme-btn, #settings-box .js-lang-btn { background: var(--card-bg); border: 1px solid var(--border); color: inherit; border-radius: var(--radius); padding: .4rem .85rem; cursor: pointer; font-size: .9rem; min-width: 5rem; }
#settings-box .js-theme-btn { font-size: 1.05rem; min-width: 2.8rem; }
.settings-preview { margin-top: 1.2rem; padding: .9rem 1rem; background: var(--word-bg); border-radius: var(--radius-lg); border: 1px solid var(--border); line-height: 2.2; }
.settings-preview-title { font-size: .72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: .5rem; }
@media (max-width: 600px) { #settings-overlay { padding: 5vh .6rem 1rem; } }
`);

// ─── JS ───

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
