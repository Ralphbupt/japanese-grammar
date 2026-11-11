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
// Optional sign-in + progress sync, on every page
// (site/sync.js → api.jpnotes.dev, worker/src/account.js). The Google client id
// is public; the same value is in worker/wrangler.account.toml.
const SYNC_JS_SRC = fs.readFileSync(path.join(__dirname, "site", "sync.js"), "utf-8");
const SYNC_JS_HASH = require("crypto").createHash("md5").update(SYNC_JS_SRC).digest("hex").slice(0, 8);
const GOOGLE_CLIENT_ID = "128997752412-49bo0pmc3ncp8n5esbvcgdsr7ifsg3l3.apps.googleusercontent.com";
const ACCOUNT_API = "https://api.jpnotes.dev";
// Sign-in by emailed code (Resend, via the account Worker). Open to everyone since
// 2026-11-11; delivery to QQ / 163 mailboxes was not tested first, so watch
// account_code_sent against email sign-ins (account-report.sh).
const EMAIL_LOGIN = true;
const FEEDBACK_JS_SRC = fs.readFileSync(path.join(__dirname, "site", "feedback.js"), "utf-8");
const FEEDBACK_JS_HASH = require("crypto").createHash("md5").update(FEEDBACK_JS_SRC).digest("hex").slice(0, 8);
// Practice / mock test / flashcard pages; QUIZ_PUBLIC and QUIZ_LINKS are set in build-quiz.js.
const { buildQuiz, loadLevel: loadQuizLevel, LEVELS: QUIZ_LEVELS, TYPES: QUIZ_TYPES, MOCK: QUIZ_MOCK, QUIZ_PUBLIC, QUIZ_LINKS, AUDIO_REQUESTS: QUIZ_AUDIO_REQUESTS, ABOVE_LEVEL, aboveLevel, CK_IMG_DIR: QUIZ_CK_IMG_DIR } = require("./build-quiz");
const SETTINGS_JS_HASH = require("crypto").createHash("md5").update(fs.readFileSync(path.join(__dirname, "site", "settings-modal.js"))).digest("hex").slice(0, 8);
// With it, on every page: sign-in and progress sync (site/sync.js), which fills
// the account part of the settings dialog.
const SETTINGS_SCRIPT = `<script src="${SITE_PATH}settings-modal.js?v=${SETTINGS_JS_HASH}" defer></script><script src="${SITE_PATH}sync.js?v=${SYNC_JS_HASH}" data-gclient="${GOOGLE_CLIENT_ID}"${EMAIL_LOGIN ? ' data-email="1"' : ""} defer></script>`;
// Where pages fetch mp3s from: the R2 bucket behind audio.jpnotes.dev (uploaded
// by tools/audio-sync.py; keys mirror audio/). AUDIO_BASE=/audio builds a site
// that plays the local copies instead (rsync audio/ into dist/audio/ first),
// for audio that isn't uploaded yet.
const AUDIO_BASE = (process.env.AUDIO_BASE || "https://audio.jpnotes.dev").replace(/\/$/, "");
const AUDIO_ORIGIN = /^https?:/.test(AUDIO_BASE) ? " " + new URL(AUDIO_BASE).origin : "";
// Content-Security-Policy connect-src allowlist: the browser itself refuses
// fetch/XHR/beacon to any origin not listed here, even if a script on the page
// were compromised. The AI host is parsed from site/ai-assistant.js (only the
// site's own relay since the own-key providers were removed, 2026-11-10);
// localhost/127.0.0.1 on any port covers the local relay and account worker.
const AI_PROVIDER_HOSTS = [...new Set(
  [...AI_JS_SRC.matchAll(/(?:base|altBase): '(https?:\/\/[^'/]+)/g)]
    .map(m => m[1]).filter(h => !/localhost|127\.0\.0\.1/.test(h))
)];
// The rest of the policy: scripts, styles, images, audio, frames only from
// this site (plus giscus for comments); no plugins, no <base> or form tricks.
// Inline scripts stay allowed — the pages are built with many of them — but a
// script or image from any other host is refused, so an injected tag can't
// load code or leak data (an <img> beacon) elsewhere.
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://giscus.app https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://giscus.app https://accounts.google.com/gsi/style; img-src 'self' data: blob:; media-src 'self' blob:${AUDIO_ORIGIN}; font-src 'self' data:; frame-src https://giscus.app https://accounts.google.com/gsi/; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; connect-src 'self' ${ACCOUNT_API} https://accounts.google.com/gsi/ https://*.google-analytics.com https://*.analytics.google.com ${AI_PROVIDER_HOSTS.join(" ")} http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*">`;
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

// Progress card on the home page and the level overviews: where the reader
// left off, how many missed questions are due, the streak and the days to the
// exam — all from quiz.js's localStorage jp_quiz_v1 (no request). Runs inline
// right after its empty <div>, before first paint; a first-time visitor (no
// jp_quiz_v1) gets nothing, so nothing moves. data-level limits it to one
// level; data-pages lists the practice pages that exist ("n3-reading" …).
const JLPT_EXAM_DATE = [2026, 12, 6];
const PROGRESS_JS = `(function(){
  var el = document.getElementById('jp-progress'), S;
  try { S = JSON.parse(localStorage.getItem('jp_quiz_v1')); } catch (e) {}
  if (!el || !S || S.v !== 1) return;
  var only = el.getAttribute('data-level'), pages = ' ' + el.getAttribute('data-pages') + ' ';
  var fl = document.documentElement.getAttribute('data-force-lang'), base = fl === 'zh' ? '${SITE_PATH}zh/' : '${SITE_PATH}';
  var now = Date.now() / 1000, last = null, lt = 0, A = S.answers || {}, M = S.mock || {};
  var lvOf = function (id) { var m = /^n([1-5])-/.exec(id); return m ? 'N' + m[1] : null; };
  for (var id in A) {
    var a = A[id], x = a && a[a.length - 1], l = lvOf(id);
    if (l && (!only || l === only) && x && x.t > lt) { lt = x.t; last = id; }
  }
  for (var k in M) {
    var c = M[k] && M[k].current, l2 = lvOf(k);
    if (c && c.start && l2 && (!only || l2 === only) && c.start / 1000 > lt && now - c.start / 1000 < 7 * 86400) { lt = c.start / 1000; last = k; }
  }
  if (!last) return;
  var lv = lvOf(last), lo = lv.toLowerCase();
  var kind = /-m(ock-)?\\d+(-|$)/.test(last) ? 'mock-test' : /-ck-/.test(last) ? 'listening' : /-mg-/.test(last) ? 'vocabulary' : /-dk-/.test(last) ? 'reading' : 'practice';
  if (pages.indexOf(' ' + lo + '-' + kind + ' ') < 0) kind = 'practice';
  var names = { practice: ['练习', 'practice'], listening: ['听力', 'listening'], reading: ['阅读', 'reading'], vocabulary: ['词汇', 'vocabulary'], 'mock-test': ['模拟题', 'mock test'] }[kind];
  var due = 0, R = S.review || {};
  for (var r in R) if (lvOf(r) === lv && R[r] && R[r].due <= now) due++;
  var day = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  var streak = 0, d = new Date(), D = S.days || {};
  if (!D[day(d)]) d.setDate(d.getDate() - 1);
  while (D[day(d)]) { streak++; d.setDate(d.getDate() - 1); }
  var t0 = new Date(); t0.setHours(0, 0, 0, 0);
  var left = Math.round((new Date(${JLPT_EXAM_DATE[0]}, ${JLPT_EXAM_DATE[1] - 1}, ${JLPT_EXAM_DATE[2]}) - t0) / 864e5);
  var b = function (zh, en) { return fl ? (fl === 'zh' ? zh : en) : '<span class="lang-zh">' + zh + '</span><span class="lang-en">' + en + '</span>'; };
  var h = '<a class="jp-prog-go" href="' + base + lo + '-' + kind + '/">' + b('继续 ' + lv + ' ' + names[0] + ' →', 'Continue ' + lv + ' ' + names[1] + ' →') + '</a>';
  if (due) h += '<a href="' + base + lo + '-practice/">' + b(due + ' 道错题待复习', due + ' to review') + '</a>';
  if (streak > 1) h += '<span>' + b('连续 ' + streak + ' 天', streak + '-day streak') + '</span>';
  if (left >= 0 && left <= 150) h += '<span>' + (left ? b('距 ${JLPT_EXAM_DATE[1]} 月 ${JLPT_EXAM_DATE[2]} 日考试 ' + left + ' 天', left + ' days to the ' + '${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][JLPT_EXAM_DATE[1] - 1]} ${JLPT_EXAM_DATE[2]}' + ' exam') : b('今天考试，加油！', 'Exam day — good luck!')) + '</span>';
  el.innerHTML = h;
  el.hidden = false;
})();`;
const progressCardHtml = (level, pageIds) => `<div id="jp-progress" class="jp-progress" hidden${level ? ` data-level="${level}"` : ""} data-pages="${pageIds.join(" ")}"></div><script>${PROGRESS_JS}</script>`;

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
      if (!ready) { ready = new Audio('${AUDIO_BASE}/' + audioId + '.mp3'); ready.preload = 'auto'; }
    });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (currentBtn === btn) { stopCurrent(); return; }
      stopCurrent();
      var audio = ready || new Audio('${AUDIO_BASE}/' + audioId + '.mp3');
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
// engagement time are tracked here (30-min idle session; _et = focused, non-idle time).
// The client id is reused from an existing gtag `_ga` cookie, so returning
// visitors are not counted as new users after the switch.
//
// Hits are still engagement-gated: nothing is sent until the first real
// scroll / pointer / key / touch, or ~3s of continuous foreground visibility.
// Headless crawlers that fake their UA and load-and-leave never trip it, so
// they don't inflate user / session / page_view counts. Add ?ga_debug to a
// URL to see its hits in GA4 DebugView.
// Practice pages for one part of the test: the same app on one group of question
// types, a page of its own because that's what people look for ("JLPT N3 reading
// practice"). To drop a level, take it out of `levels`.
const SUBSET_PAGES = [
  { id: "reading", group: "dokkai", levels: ["N5", "N4", "N3", "N2", "N1"] },
  { id: "vocabulary", group: "moji", levels: ["N5", "N4", "N3", "N2", "N1"] },
];

const GTAG_DEFERRED = `<script>
(function() {
  var ua = navigator.userAgent || '';
  // Skip GA for automation / crawlers / SEO tools — they all match here.
  if (navigator.webdriver) return;
  if (/HeadlessChrome|Lighthouse|PhantomJS|Puppeteer|Playwright|crawler|spider|bot|Slurp|facebookexternalhit/i.test(ua)) return;

  var TID = 'G-D1KNQTFN1R', URL_ = 'https://www.google-analytics.com/g/collect';
  // gtag flags key events itself with _c=1; this sender has to do the same, or
  // GA records them as ordinary events. Keep in step with the GA admin list.
  var KEY_EVENTS = ['quiz_finish', 'quiz_ai', 'share', 'account_login'];
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
  // Session: new after 30 min without a hit. s = { id, n (count), t (last hit, 0 = none yet), pv }.
  // Checked again on every hit, not just at page load: practice / listening /
  // mock pages stay open for hours without a reload, and a hit sent with a
  // session GA has already closed opens a session with no session_start, so
  // no source or landing page ("Unassigned"). A hit also picks up a session
  // another tab started meanwhile.
  var SESSION_MS = 30 * 60 * 1000;
  function readSess() { try { return JSON.parse(store('jp_ga_sess')); } catch (e) { return null; } }
  function fresh(s) { return s && s.id && now() - s.t <= SESSION_MS; }
  var sess = readSess();
  if (!fresh(sess)) sess = { id: Math.floor(now() / 1000), n: ((sess && sess.n) || 0) + 1, t: 0, pv: 0 };
  function syncSess() {
    var st = readSess();
    if (fresh(st)) { if (st.id !== sess.id) sess = st; return false; }
    if (sess.t && now() - sess.t > SESSION_MS) { sess = { id: Math.floor(now() / 1000), n: sess.n + 1, t: 0, pv: 0 }; return true; }
    return false;
  }

  var seq = 0, pageId = rnd(), started = false, queue = [];
  // Engagement time (_et): only while the tab is visible AND its window has
  // focus, and only up to IDLE after the last scroll / pointer / key / touch /
  // audio playback — a tab left open on a second screen no longer racks up
  // hours. One hit reports at most CAP.
  var IDLE = 10 * 60 * 1000, CAP = 30 * 60 * 1000, lastAct = now();
  function activeNow() { return !document.hidden && !document.prerendering && document.hasFocus(); }
  var visibleSince = activeNow() ? now() : 0, engagedMs = 0;
  function bank() {
    if (visibleSince) { var end = Math.min(now(), lastAct + IDLE); if (end > visibleSince) engagedMs += end - visibleSince; }
    visibleSince = activeNow() ? now() : 0;
  }
  function takeEngaged() { bank(); var e = Math.min(engagedMs, CAP); engagedMs = 0; return e; }
  function act() {
    if (visibleSince && now() - lastAct > IDLE) bank();
    lastAct = now();
    if (!visibleSince && activeNow()) visibleSince = now();
  }
  ['scroll', 'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'].forEach(function(t) { window.addEventListener(t, act, { passive: true, capture: true }); });
  document.addEventListener('play', act, true);
  document.addEventListener('timeupdate', act, true);
  window.addEventListener('focus', act);
  window.addEventListener('blur', bank);
  function send(name, params, extra) {
    // A session restarted mid-page opens with a page_view, as a reload would:
    // GA takes the landing page (and so the channel) from it.
    if (syncSess() && name !== 'page_view') send('page_view', {}, {});
    if (name === 'page_view') sess.pv++;
    var q = {
      v: 2, tid: TID, cid: cid, sid: sess.id, sct: sess.n, _p: pageId, _s: ++seq,
      seg: sess.pv > 1 || engagedMs + (visibleSince ? now() - visibleSince : 0) > 10000 ? 1 : 0,
      dl: location.href, dt: document.title, ul: (navigator.language || '').toLowerCase(),
      sr: screen.width + 'x' + screen.height, en: name
    };
    if (!sess.t) q._ss = 1;                       // first hit of the session
    if (document.referrer && seq === 1) q.dr = document.referrer;
    if (debug) q._dbg = 1;
    if (KEY_EVENTS.indexOf(name) >= 0) q._c = 1;
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
    var extra = {};
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
      if (document.hidden) flush(); else act();
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
      if (document.hidden) { stopTimer(); bank(); } else { act(); startTimer(); }
    });
    // A prerendered page (Speculation Rules) is only "viewed" once activated.
    document.addEventListener('prerenderingchange', function() { act(); startTimer(); });
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
  "jlpt-listening-tips": "JLPT 聴解のコツ",
  "jlpt-reading-tips": "JLPT 読解のコツ",
  "jlpt-vocabulary-grammar-tips": "JLPT 文字・語彙・文法のコツ",
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
// Links to the companion podcast (podcast.jpnotes.dev): the reader's language
// copy (English at /, Chinese at /zh/), optionally pre-filtered by level, and
// tagged so the podcast's GA shows what jpnotes sends and from where
// (utm_content). Returned HTML-escaped, ready for an href.
function podcastUrl(en, content, level, show) {
  const p = new URLSearchParams();
  if (level) p.set("level", level);
  p.set("utm_source", "jpnotes");
  p.set("utm_medium", "web");
  p.set("utm_campaign", "listening");
  p.set("utm_content", content);
  // show "nihongo" = the all-Japanese second show, 日本語で聞くニュース (N3–N2)
  return `https://podcast.jpnotes.dev/${en ? "" : "zh/"}${show === "nihongo" ? "nihongo/" : ""}?${p}`.replace(/&/g, "&amp;");
}

// The two podcasts at the bottom of each listening page, easier show first
// for N5–N3, the all-Japanese one first for N2/N1.
function podcastBlock(L, level) {
  const lv = /^N[45]$/.test(level) ? "N5-N4" : "N4-N3", lvTxt = lv.replace("-", "–");
  const c = `listening-${level.toLowerCase()}`;
  const main = `<li>${L(`<a href="${podcastUrl(false, c, lv)}" target="_blank" rel="noopener"><b>Japanese Daily News</b></a>（${lvTxt}）：每天一则日语新闻，逐句讲解，附振假名和中文翻译。`, `<a href="${podcastUrl(true, c, lv)}" target="_blank" rel="noopener"><b>Japanese Daily News</b></a> (${lvTxt}): a Japanese news story every day, explained sentence by sentence, with furigana and a translation.`)}</li>`;
  const ja = `<li>${L(`<a href="${podcastUrl(false, c, null, "nihongo")}" target="_blank" rel="noopener"><b>日本語で聞くニュース</b></a>（N3–N2）：全日语播客，新闻用日语读一遍再用日语讲解，适合练整段听懂。${/^N[45]$/.test(level) ? "等你到了 N3 再来。" : ""}`, `<a href="${podcastUrl(true, c, null, "nihongo")}" target="_blank" rel="noopener"><b>日本語で聞くニュース</b></a> (N3–N2): an all-Japanese show — the news read and then talked through in Japanese, for following longer stretches.${/^N[45]$/.test(level) ? " One for when you reach N3." : ""}`)}</li>`;
  return `<ul>${/^N[12]$/.test(level) ? ja + main : main + ja}</ul>`;
}

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
// One icon set: the emoji that label practice kinds and dates in generated
// text become Lucide line icons (the toolbar's set). Only text between tags in
// <body> is touched, never attributes, <head>, scripts or styles.
const ICO_SVG = (d) => `<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  "✍": ICO_SVG('<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>'),
  "🎧": ICO_SVG('<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'),
  "⏱": ICO_SVG('<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>'),
  "📖": ICO_SVG('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'),
  "🔤": ICO_SVG('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  "🗂": ICO_SVG('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>'),
  "📅": ICO_SVG('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'),
};
const ICON_RE = new RegExp(`(${Object.keys(ICONS).join("|")})\\uFE0F?\\s?`, "gu");
function iconize(html) {
  const at = html.search(/<body[\s>]/i);
  if (at < 0) return html;
  const body = html.slice(at).replace(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>)|>([^<]+)</gi,
    (m, block, text) => (block ? block : ">" + text.replace(ICON_RE, (x, e) => ICONS[e]) + "<"));
  return html.slice(0, at) + body;
}

function writeLangPage(id, lang, html) {
  const dir = path.join(__dirname, "dist", lang.dir, id);
  fs.mkdirSync(dir, { recursive: true });
  // Bing mostly ignores hreflang and goes by the declared language, so every
  // copy also states it here (without this, Chinese queries landed on the
  // English /N2/ etc. in Bing, shown with a "Translate this result" link).
  if (!/http-equiv="Content-Language"/i.test(html)) {
    const meta = `<meta http-equiv="Content-Language" content="${lang.htmlLang}">`;
    html = /<meta charset="[^"]*">/i.test(html)
      ? html.replace(/<meta charset="[^"]*">/i, (m) => `${m}\n${meta}`)
      : html.replace(/<head>/i, `<head>\n${meta}`);
  }
  fs.writeFileSync(path.join(dir, "index.html"), iconize(html), "utf-8");
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
  // 2026-11-09 audit of every heading's romaji (kuromoji splits or misreads these):
  [/\(yo\) u(?= |$)/g, "(y)ou"], [/\(yo\) uto\b/g, "(y)ou to"], [/\(yo\) uni\b/g, "(y)ou ni"],
  [/\bzuku me\b/g, "zukume"], [/\bga tera\b/g, "gatera"], [/~tabakari\b/g, "~ta bakari"],
  [/\bteka ra\b/g, "te kara"], [/\btomo a rousha\b/g, "tomo arou mono"], [/\btari to mo\b/g, "taritomo"],
  [/\bni kotae/g, "ni tae"], [/\bsa seru\b/g, "saseru"], [/\bbekara zaru\b/g, "bekarazaru"],
  [/\bittaranai\b/g, "ittara nai"], [/\bnai demonai\b/g, "nai de mo nai"], [/\bshita tte\b/g, "shitatte"],
  [/\( /g, "("], [/ \)/g, ")"], [/\btosureba\b/g, "to sureba"], [/\bto mo naru\b/g, "tomo naru"],
  [/\bnara dewa\b/g, "nara de wa"], [/(^|[~ ])e nai\b/g, "$1enai"], [/\bkinji e nai\b/g, "kinji enai"],
  [/\bkoto to te\b/g, "koto tote"], [/~touri\b/g, "~toori"], [/\bsouinai\b/g, "soui nai"],
  [/\btomo nak/g, "tomonak"], [/\btomo nashi\b/g, "tomonashi"],
  [/\b(\w*e) ba\b/g, "$1ba"], // conditional: sureba, ieba, areba, nakereba
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
  // ── Lesson review (2026-11-09) ──
  { kanji: "長", from: /^た$/, after: /^ければ/, to: "なが" },                    // 長ければ (kuromoji: 長けれ)
  { kanji: "愛", from: /^め$/, after: /^で/, to: "あい" },                       // 母の愛でなくて (not 愛でる)
  { kanji: "堪", from: /^こた$/, to: "た" },                                     // 堪える on this site is always たえる
  // ── Mock tests 2 (2026-11-08): readings Gemini flagged in context ──
  { kanji: "分", from: /^ぶん$/, before: /[二五九]\s*$/, to: "ふん" },              // 五分 = ごふん
  { kanji: "間", from: /^(ま|かん)$/, before: /(その|この)\s*$/, after: /^\s*[、,]?\s*(私|わたし|僕|ぼく|連絡|に|は|、)/, to: "あいだ" },
  { kanji: "後", from: /^ご$/, before: /の\s*$/, to: "あと" },                      // テストの後, 仕事の後
  { kanji: "四", from: /^よん$/, after: /^(時|人)/, to: "よ" },                     // 四時間, 四人
  { kanji: "日", from: /^にち$/, before: /(ある|\]\])\s*$/, to: "ひ" },              // ある日 (also with the blank before it)
  { kanji: "月", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "げつ" },        // dates: (月)(火)…
  { kanji: "火", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "か" },
  { kanji: "水", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "すい" },
  { kanji: "木", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "もく" },
  { kanji: "金", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "きん" },
  { kanji: "土", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "ど" },
  { kanji: "行", from: /^こう$/, before: /[二三四五六七八九十何数]$/, to: "ぎょう" },   // 三行
  { kanji: "何人", from: /^なにびと$/, after: /^(?!たりとも)/, to: "なんにん" },
  { kanji: "国", from: /^こく$/, after: /^\s*[へに]\s*(帰|かえ)/, to: "くに" },
  { kanji: "表", from: /^おもて$/, after: /^計算/, to: "ひょう" },
  { kanji: "私", from: /^わたし$/, after: /^ども/, to: "わたくし" },
  { kanji: "本", from: /^ほん$/, before: /[三何]$/, to: "ぼん" },
  { kanji: "本", from: /^ほん$/, before: /[一六八十]$/, to: "ぽん" },
  { kanji: "方", from: /^ほう$/, before: /(る|ない)$/, after: /^(の多く|なんです)/, to: "かた" },
  { kanji: "箱", from: /^はこ$/, before: /十$/, to: "ぱこ" },
  { kanji: "八", from: /^はち$/, after: /^百/, to: "はっ" },
  { kanji: "空", from: /^あ$/, before: /(電車|バス|道|店)[がもは]?$/, to: "す" },
  { kanji: "夜市", from: /^.+$/, to: "よいち" },
  { kanji: "市", from: /^し$/, before: /夜$/, to: "いち" },
  { kanji: "夜", from: /^よる$/, after: /^市/, to: "よ" },
  { kanji: "札", from: /^さつ$/, before: /(番号|名|整理|値)の?$/, to: "ふだ" },
  { kanji: "山道", from: /^さんどう$/, to: "やまみち" },
  { kanji: "何", from: /^なに$/, after: /^であれ/, to: "なん" },
  { kanji: "市場", from: /^いちば$/, after: /^(を開拓|に参入|規模|調査|の拡大|経済|価格|シェア)/, to: "しじょう" },
  { kanji: "口", from: /^くち$/, before: /(入り|出|窓|改札|非常|裏)$/, to: "ぐち" },
  { kanji: "所", from: /^しょ$/, before: /(給水|印刷)$/, to: "じょ" },
  { kanji: "印刷所", from: /^いんさつしょ$/, to: "いんさつじょ" },
  { kanji: "場", from: /^じょう$/, before: /稽古$/, to: "ば" },
  { kanji: "一言", from: /^いちげん$/, after: /^(?!居士)/, to: "ひとこと" },
  { kanji: "帰", from: /^き$/, after: /^す/, to: "かえ" },
  { kanji: "軽", from: /^けい$/, after: /^め/, to: "かる" },
  { kanji: "年", from: /^とし$/, after: /^に[数一二三何]/, to: "ねん" },
  { kanji: "大", from: /^だい$/, after: /^ごと/, to: "おお" },
  // ── N1 lessons (76–92): context-specific readings; listed first so they win
  // over the general rules below. ──
  { kanji: "店", from: /^(てん|みせ)$/, before: /(号|人気|高級|飲食|専門|支|本|料理)$/, to: "てん" },
  { kanji: "階", from: /^かい$/, before: /([3３三]|何)$/, to: "がい" },   // 3階・何階 = さんがい・なんがい
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
  // 一日中外に: kuromoji reads 中外 (ちゅうがい) as one word.
  html = html.replace(new RegExp("(日<rp>\\(</rp><rt>[^<]*</rt><rp>\\)</rp></ruby>)" + ruby("中外", "ちゅうがい").replace(/[()]/g, "\\$&"), "g"), (m, d) => d + ruby("中", "じゅう") + ruby("外", "そと"));
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
      loadQuizLevel(level).qs.some((q) => q._kind === "choukai") && { href: `${SITE_PATH}${lv}-listening/`, zh: "🎧 听力练习", en: "🎧 Listening practice" },
      fs.existsSync(path.join(__dirname, "questions", level, "mock-1")) && { href: `${SITE_PATH}${lv}-mock-test/`, zh: "⏱ 模拟题", en: "⏱ Mock test" },
      ...SUBSET_PAGES.filter((p) => p.levels.includes(level)).map((p) => ({ href: `${SITE_PATH}${lv}-${p.id}/`, zh: p.id === "reading" ? "📖 阅读练习" : "🔤 词汇练习", en: p.id === "reading" ? "📖 Reading practice" : "🔤 Vocabulary practice" })),
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
      ${practiceItems.some((q) => q.href.endsWith("-listening/")) ? `<a class="nav-item nav-overview" href="${SITE_PATH}listening/"><span class="lang-zh">听力总览</span><span class="lang-en">Listening</span></a>` : ""}
      <a class="nav-item nav-overview" href="${SITE_PATH}reading/"><span class="lang-zh">阅读总览</span><span class="lang-en">Reading</span></a>
      <a class="nav-item nav-overview" href="${SITE_PATH}vocabulary/"><span class="lang-zh">词汇总览</span><span class="lang-en">Vocabulary</span></a>
      <a class="nav-item nav-overview" href="${SITE_PATH}mock-test/"><span class="lang-zh">模拟题总览</span><span class="lang-en">Mock tests</span></a>
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
  const ICON_USER = loadIcon("user.svg");

  // ─── Shared sidebar markup ───
  // Used on home, lesson, and level pages so the directory is reachable
  // from anywhere. Sidebar links are root-relative so they work from any
  // subpath (e.g. clicking from /day01/ correctly navigates to /day05/).
  // Page footer, last thing inside <main> on every page (so localizePage()
  // strips the other language and points 关于 at /zh/about/ on zh copies).
  const siteFooterHtml = `<footer class="site-footer">
    <nav aria-label="footer">
      <span class="lang-zh"><a href="${podcastUrl(false, "footer")}" target="_blank">播客</a></span><span class="lang-en"><a href="${podcastUrl(true, "footer")}" target="_blank">Podcast</a></span>
      <a href="${SITE_PATH}about/"><span class="lang-zh">关于</span><span class="lang-en">About</span></a>
      <a href="https://github.com/Ralphbupt" target="_blank">GitHub</a>
      <a href="https://liko.page/" target="_blank" rel="author">liko.page</a>
      <a href="#feedback" class="fb-open"><span class="lang-zh">💬 反馈</span><span class="lang-en">💬 Feedback</span></a>
    </nav>
    <p>© ${new Date().getFullYear()} <a href="https://jpnotes.dev/">jpnotes.dev</a> · <span class="lang-zh">内容采用 <a href="https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans" rel="license">CC BY-NC 4.0</a> 授权，转载请注明出处 jpnotes.dev，禁止商用</span><span class="lang-en">Content licensed <a href="https://creativecommons.org/licenses/by-nc/4.0/" rel="license">CC BY-NC 4.0</a> — credit jpnotes.dev, non-commercial use only</span></p>
  </footer>
  <script src="${SITE_PATH}feedback.js?v=${FEEDBACK_JS_HASH}" defer></script>`;
  // Phones: a top bar (☰ stays the sidebar's own button, at its left end) with
  // search / AI / account & settings (which holds share), so they don't hide inside the sidebar.
  const mobileBarHtml = `<div id="m-bar"><a id="m-title" href="${SITE_PATH}"></a>
    <button type="button" class="m-btn" data-m="search" aria-label="搜索 / Search">${ICON_SEARCH}</button>
    <button type="button" class="m-btn" data-m="ai" aria-label="问 AI / Ask AI" hidden>${ICON_CHAT}</button>
    <button type="button" class="m-btn" data-m="settings" aria-label="账号与设置 / Account & settings">${ICON_USER}</button>
  </div>`;
  const sidebarMarkupHtml = `${mobileBarHtml}
<nav id="sidebar" class="collapsed">
  <div class="nav-tools">
    <button id="menu-toggle" type="button" class="nav-tool-btn" aria-label="显示/收起侧栏 / Toggle sidebar" title="显示/收起侧栏 / Toggle sidebar">${ICON_SIDEBAR}</button>
    <button id="search-btn" type="button" class="nav-tool-btn nav-tool-extra" aria-label="搜索 / Search" title="搜索 / Search ( / )">${ICON_SEARCH}</button>
    <button id="ai-btn" type="button" class="nav-tool-btn nav-tool-extra nav-tool-ai" aria-label="问 AI / Ask AI" title="问 AI / Ask AI">${ICON_CHAT}</button>
    <button id="settings-btn" type="button" class="nav-tool-btn nav-tool-extra" aria-label="账号与设置 / Account & settings" title="账号与设置 / Account & settings">${ICON_USER}</button>
  </div>
  <div class="nav-scroll">
  <div class="nav-header"><a href="${SITE_PATH}" style="color:inherit;text-decoration:none;"><span class="seal-mark" aria-hidden="true" lang="ja">合格</span>jpnotes.dev</a></div>
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
  // A level's practice page (n3-reading, n3-cards …) lights up its hub in 做题.
  if (!item && /^n[1-5]-/.test(slug || '')) {
    var hub = slug.replace(/^n[1-5]-/, '');
    item = sidebar.querySelector('.nav-group-wrap[data-level="practice"] a[href$="/' + (hub === 'cards' ? 'vocabulary' : hub) + '/"]');
  }
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
  // Nowhere in particular (the home page): practice is what readers come for.
  if (!activeWrap && wraps.length) activeWrap = sidebar.querySelector('.nav-group-wrap[data-level="practice"]') || sidebar.querySelector('.nav-group-wrap[data-level="N5"]') || wraps[0];
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
      // Only this page's language: the item holds a lang-zh and a lang-en span.
      var fl = document.documentElement.getAttribute('data-force-lang');
      var span = fl && item.querySelector('.lang-' + fl);
      var label = (span || item).textContent.replace(/\\s+/g, ' ').trim().replace(/^(\\d+)(?=\\S)/, '$1 ');
      mt.textContent = (lvl && /^N[1-5]$/.test(lvl) && label.indexOf(lvl) !== 0 ? lvl + ' · ' : '') + label;
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
  // Practice first: what readers actually use (GA, 2026-11). One row per level
  // with its question / listening counts and the practice pages.
  const roundDown = (n) => (n >= 20 ? Math.floor(n / 10) * 10 + "+" : String(n));
  const practiceKinds = [["practice", "全部", "All"], ["listening", "听力", "Listen"], ["reading", "阅读", "Read"], ["vocabulary", "词汇", "Vocab"], ["mock-test", "模拟考", "Mock"], ["cards", "卡片", "Cards"]];
  const homePracticeHtml = !quizPages("N5").length ? "" : `
  <section class="home-practice">
    <h2><span class="lang-zh">做题备考</span><span class="lang-en">Practise for the JLPT</span></h2>
    <p class="home-practice-lead"><span class="lang-zh">按真题题型出的练习题、听力和计时模拟考。每题都讲清楚正确答案为什么对、每个错误选项错在哪；做错的题进错题本，过几天再考你。</span><span class="lang-en">Exam-style questions, listening and timed mock tests. Every question explains why the answer is right and what is wrong with each other option; missed ones come back a few days later.</span></p>
    <div class="table-scroll"><table class="practice-index">
      <thead><tr><th scope="col"><span class="visually-hidden">Level</span></th>${practiceKinds.map((k) => `<th scope="col"><span class="lang-zh">${k[1]}</span><span class="lang-en">${k[2]}</span></th>`).join("")}</tr></thead>
      <tbody>${QUIZ_LEVELS.filter((lv) => quizPages(lv).length).map((lv) => {
        const qs = loadQuizLevel(lv).qs, pages = quizPages(lv);
        // Each cell says how much is behind the link: questions, or test sets.
        const n = (kind) => qs.filter((q) => q._kind === kind).length;
        const mocks = fs.readdirSync(path.join(__dirname, "questions", lv)).filter((d) => /^mock-\d+$/.test(d) && fs.existsSync(path.join(__dirname, "questions", lv, d, "bunpou.json"))).length;
        const label = { practice: [qs.length, qs.length], listening: [n("choukai"), n("choukai")], reading: [n("dokkai"), n("dokkai")], vocabulary: [n("moji-goi"), n("moji-goi")],
          "mock-test": [`${mocks} 套`, String(mocks)], cards: ["开始", "Go"] };
        const cell = (kind) => { const pg = pages.find((q) => q.href.endsWith(`-${kind}/`)); return pg && label[kind][0] ? `<td><a href="${pg.href}"><span class="lang-zh">${label[kind][0]}</span><span class="lang-en">${label[kind][1]}</span></a></td>` : `<td class="none">–</td>`; };
        return `
        <tr><th scope="row"><span class="level-tag">${lv}</span></th>${practiceKinds.map((k) => cell(k[0])).join("")}</tr>`;
      }).join("")}
      </tbody>
    </table></div>
  </section>`;
  // The hero shows what the site is by being it: one sentence, marked the way
  // a teacher marks a notebook (the grammar point in red, a note beside it).
  const homeMainHtml = `<header class="home-hero">
    <div class="hero-copy">
      <h1><span class="lang-zh">jpnotes — JLPT N5 到 N1 语法讲解与题库</span><span class="lang-en">jpnotes — JLPT N5 to N1 grammar and practice</span></h1>
      <p class="home-intro">
        <span class="lang-zh">免费的 JLPT 语法笔记和题库：<strong>${totalLessons} 课、${totalPoints}+ 语法点</strong>，每个都有接续、例句和易混辨析；学完就做题，听力、阅读、模拟考都有。</span>
        <span class="lang-en">Free JLPT grammar notes and a question bank: <strong>${totalLessons} lessons, ${totalPoints}+ grammar points</strong>, each with its conjugation, example sentences and the patterns it gets confused with. Then practise: listening, reading and mock tests included.</span>
      </p>
      <div class="home-actions">${quizPages("N5").length ? `
        <a class="btn-primary" href="practice/"><span class="lang-zh">开始做题</span><span class="lang-en">Start practising</span></a>
        <a class="btn-secondary" href="lesson01/"><span class="lang-zh">从第 1 课学语法</span><span class="lang-en">Learn from lesson 1</span></a>` : `
        <a class="btn-primary" href="lesson01/"><span class="lang-zh">从第 1 课开始</span><span class="lang-en">Start with lesson 1</span></a>`}
        <a class="btn-quiet" href="anki/"><span class="lang-zh">Anki 卡组</span><span class="lang-en">Anki decks</span></a>
      </div>
    </div>
    <figure class="hero-note">
      <p class="hero-ja" lang="ja"><ruby>薬<rp>(</rp><rt>くすり</rt><rp>)</rp></ruby>を<ruby>飲<rp>(</rp><rt>の</rt><rp>)</rp></ruby>んだ<strong>のに</strong>、まだ<ruby>痛<rp>(</rp><rt>いた</rt><rp>)</rp></ruby>い。</p>
      <p class="hero-tr"><span class="lang-zh">明明吃了药，还是疼。</span><span class="lang-en">I took the medicine, and it still hurts.</span></p>
      <figcaption><b lang="ja">〜のに</b><span class="lang-zh">明明……却……：结果和预想的相反，带着意外或不满。</span><span class="lang-en">even though …: the result goes against what you expected, with surprise or complaint.</span> <a href="lesson15/"><span class="lang-zh">第 15 课</span><span class="lang-en">Lesson 15</span></a></figcaption>
    </figure>
  </header>${quizPages("N5").length ? progressCardHtml("", QUIZ_LEVELS.flatMap((lv) => quizPages(lv).map((q) => q.href.replace(SITE_PATH, "").replace(/\/$/, "")))) : ""}${homePracticeHtml}
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
      <span class="lang-zh">想练听力？试试 <a href="${podcastUrl(false, "home")}" target="_blank">Japanese Daily News 播客</a>——每天一则真实日语新闻（N5–N3），逐句讲解，附振假名和中文翻译，也能切到纯日语模式只听新闻。</span>
      <span class="lang-en">Want listening practice? Try the <a href="${podcastUrl(true, "home")}" target="_blank">Japanese Daily News podcast</a> — a real Japanese news story every day (N5–N3), explained sentence by sentence with furigana, plus a Japanese-only mode for plain listening.</span>
    </p>
  </section>`;

  // ─── Assemble ───
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>jpnotes — Free JLPT N5–N1 Grammar, Practice Tests & Listening</title>
<meta name="description" content="Free JLPT N5–N1 grammar lessons, listening practice and mock tests: examples with audio, explanations for every answer, Anki decks. No sign-up. 中文版免费。">
<meta name="keywords" content="Japanese grammar, JLPT N2, N5, N4, N3, 日语语法, 日本語文法, grammar notes, spaced repetition, 语法笔记">
<link rel="canonical" href="${SITE}">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="jpnotes — Free JLPT N5–N1 Grammar, Practice Tests & Listening">
<meta property="og:description" content="Free JLPT N5–N1 practice questions, listening with audio, timed mock tests and grammar lessons. Every answer explained, no sign-up.">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ja_JP">
<meta property="og:locale:alternate" content="zh_CN">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="jpnotes — Free JLPT N5–N1 Grammar, Practice Tests & Listening">
<meta name="twitter:description" content="Free JLPT N5–N1 practice questions, listening, mock tests and grammar lessons. Every answer explained.">
<meta name="twitter:image" content="${SITE}og-image.png">

<!-- Structured Data -->
<meta http-equiv="Content-Language" content="en, zh-CN">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "Course",
  "name": "jpnotes – JLPT N5 to N1",
  "description": "Free structured Japanese grammar notes covering JLPT N5 to N1, with bilingual explanations, example sentences, and spaced repetition.",
  "provider": { "@type": "Person", "name": "Ralphbupt" },
  "inLanguage": ["en", "zh-CN"],
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
  "name": "jpnotes",
  "alternateName": ["jpnotes.dev", "jp notes", "JPNotes", "Japanese Grammar Notes", "日语语法笔记"],
  "url": "${SITE}",
  "inLanguage": ["en", "zh-CN"]
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
<meta name="apple-mobile-web-app-title" content="jpnotes">

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
  fs.writeFileSync(path.join(__dirname, OUT), iconize(fullHtml), "utf-8");

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
  const localizedPageIds = new Set([...lessonPages.map(l => l.id), "N5", "N4", "N3", "N2", "N1", "guides", "grammar", "about", "practice", "listening", "reading", "vocabulary", "mock-test", ...["n5", "n4", "n3", "n2", "n1"].flatMap((l) => [`${l}-practice`, `${l}-listening`, `${l}-mock-test`, `${l}-cards`]), ...SUBSET_PAGES.flatMap((p) => p.levels.map((l) => `${l.toLowerCase()}-${p.id}`))]);
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
  "isPartOf": { "@type": "Course", "name": "jpnotes – JLPT N5 to N1", "url": "${SITE}" }
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
.back-link { display: block; margin-bottom: 1.5rem; color: var(--ui); text-decoration: none; font-size: 0.9rem; }
.back-link:hover { text-decoration: underline; }
.breadcrumb { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.breadcrumb a { color: var(--text-muted); text-decoration: none; }
.breadcrumb a:hover { color: var(--ui); text-decoration: underline; }
.breadcrumb .sep { margin: 0 0.4em; }
.prev-next { display: flex; justify-content: space-between; align-items: flex-start; margin: 2.5rem 0 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); gap: 1rem; }
.prev-next-top { margin: 0 0 1.75rem; padding: 0 0 1rem; border-top: none; border-bottom: 1px solid var(--border); }
.pn-link { font-size: 0.9rem; color: var(--ui); text-decoration: none; max-width: 48%; }
.pn-link:hover { text-decoration: underline; }
.pn-prev { text-align: left; }
.pn-next { text-align: right; margin-left: auto; }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}">jpnotes.dev</a><span class="sep">›</span><a href="${SITE}${lesson.level}/">${GROUP_NAMES[lesson.level] ? `<span class="lang-zh">${groupName(lesson.level, "zh")}</span><span class="lang-en">${groupName(lesson.level, "en")}</span>` : `JLPT ${lesson.level}`}</a><span class="sep">›</span><span class="breadcrumb-current" title="${lesson.jaTitle.replace(/"/g, '&quot;')}">${lesson.jaTitle}</span>
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
      en: { title: lessonTitle, desc: lessonDesc, keywords: lessonKeywords, heading: h1En, home: "jpnotes.dev", points: cleanPointsEn },
      zh: { title: zhTitle, desc: zhDesc, keywords: zhKeywords, heading: h1Zh, home: "jpnotes.dev", points: cleanPoints },
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
.overview-card:hover { border-color: var(--ui); box-shadow: var(--shadow-hover); transform: translateY(-1px); }
.overview-card-head { display: flex; align-items: baseline; gap: .6rem; margin-bottom: .5rem; }
.overview-day { font-size: .75rem; font-weight: 700; color: var(--ui); white-space: nowrap; }
.overview-title { font-size: .95rem; font-weight: 600; color: var(--text-strong); }
.overview-points { display: flex; flex-wrap: wrap; gap: .3rem; }
.grammar-pill { font-size: .75rem; background: #f4f4f4; color: var(--text-muted); padding: .15rem .5rem; border-radius: var(--radius-sm); }
.overview-table { width: 100%; border-collapse: collapse; margin: 1rem 0 2rem; font-size: .9rem; }
.overview-table th { background: var(--word-bg); font-weight: 600; padding: .5rem .8rem; text-align: left; border: 1px solid var(--border); }
.overview-table td { padding: .4rem .8rem; border: 1px solid var(--border); }
.overview-table td:first-child { font-weight: 500; }
.overview-table a { color: var(--ui); text-decoration: none; }
.overview-table a:hover { text-decoration: underline; }
.level-stats { display: flex; gap: 2rem; margin: 1rem 0; padding: 1rem 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.level-stat strong { display: block; font-size: 1.6rem; color: var(--text-strong); }
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
        desc: `Every JLPT ${level} grammar point in ${lessons.length} free lessons: conjugation, meaning, examples with audio, comparisons of confusable grammar, and practice questions.`,
        name: `JLPT ${level} Grammar`, home: "jpnotes.dev", keywords: `JLPT ${level} grammar, ${level} grammar list, JLPT ${level} grammar points, ${level} Japanese grammar lessons`,
      },
      zh: {
        title: `JLPT ${level} 语法清单 | ${lessons.length} 课 ${totalPoints}+ 语法点速查 - 日语 ${level} 语法总结`,
        desc: `日语 JLPT ${level} 全部语法点速查清单，系统覆盖 ${lessons.length} 课、${totalPoints}+ 语法点的接续规则、含义用法、例句与易错辨析。免费 JLPT ${level} 备考笔记，适合零基础系统学习与考前冲刺复习，每课均含练习题与答案。`,
        name: `JLPT ${level} 语法清单`, home: "jpnotes.dev", keywords: LEVEL_KEYWORDS[level],
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
  "isPartOf": { "@type": "Course", "name": "jpnotes – JLPT N5 to N1", "url": "${SITE}" },
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
    <a href="${SITE}">jpnotes.dev</a><span class="sep">›</span><span>JLPT ${level}</span>
  </nav>
  <h1><span class="lang-zh">JLPT ${level} 语法清单 - ${lessons.length} 课 ${totalPoints}+ 语法点速查</span><span class="lang-en">JLPT ${level} Grammar — ${lessons.length} Lessons, ${totalPoints}+ Grammar Points</span></h1>
  <p class="overview-intro"><span class="lang-zh">${LEVEL_INTRO[level]}</span><span class="lang-en">${LEVEL_INTRO_EN[level]}</span></p>${quizPages(level).length ? `
  <p class="ov-quiz">${quizPages(level).map((q) => `<a href="${q.href}"><span class="lang-zh">${q.zh}</span><span class="lang-en">${q.en}</span></a>`).join("")}</p>
  ${progressCardHtml(level, quizPages(level).map((q) => q.href.replace(SITE_PATH, "").replace(/\/$/, "")))}` : ""}
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
      en: { title: `Japanese Grammar List — All ${total} JLPT N5 to N1 Grammar Points`, desc: `Every Japanese grammar point from JLPT N5 to N1 on one page: ${total} patterns with romaji and meaning, by level, each linking to a full lesson with audio.`, h1: "Japanese Grammar List: JLPT N5 to N1", crumb: "Grammar list", home: "jpnotes.dev",
        lead: `All ${total} grammar points taught on this site, from N5 to N1, one row each. Click a pattern for its lesson: how it attaches, what it means, examples with audio and how it differs from look-alikes. For one level as a printable checklist, use the level's checklist page.` },
      zh: { title: `日语语法大全 — JLPT N5 到 N1 全部 ${total} 个语法点总结`, desc: `日语语法大全：JLPT N5、N4、N3、N2、N1 全部 ${total} 个语法点一页看完，按级别分组，每个语法点附意思并链接到详细讲解（接续、例句带发音、易混辨析）。`, h1: "日语语法大全：JLPT N5 到 N1", crumb: "语法大全", home: "jpnotes.dev",
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
    isPartOf: { "@type": "Course", name: "jpnotes – JLPT N5 to N1", url: SITE } },
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
    <a href="${SITE}">jpnotes.dev</a><span class="sep">›</span><span><span class="lang-zh">语法大全</span><span class="lang-en">Grammar list</span></span>
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
      const tag = seo.level && !/^JLPT/.test(seo.level) ? `JLPT ${seo.level}` : seo.level || "JLPT";
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
        desc: `Free side-by-side guides to the Japanese grammar learners mix up most (は vs が, に vs で, から vs ので …) plus a JLPT December exam guide. ${compareGuides.length} comparisons.`,
        name: "Guides", home: "jpnotes.dev",
      },
      zh: {
        title: "日语易混语法对比（は和が、に和で的区别…）& JLPT 考试指南",
        desc: `把最容易混的日语语法放在同一页对比：は和が、に和で、から和ので、ように和ために……每页有判断口诀和自测题，另附 12 月 JLPT 考前指南。共 ${compareGuides.length} 篇对比，免费。`,
        name: "专题", home: "jpnotes.dev",
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
  "isPartOf": { "@type": "Course", "name": "jpnotes – JLPT N5 to N1", "url": "${SITE}" },
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
    <a href="${SITE}">jpnotes.dev</a><span class="sep">›</span><span><span class="lang-zh">专题</span><span class="lang-en">Guides</span></span>
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
    // {{LESSONS}} / {{POINTS}}: the same counts the home page shows.
    const aboutMd = fs.readFileSync(aboutMdPath, "utf-8")
      .replace(/\{\{LESSONS\}\}/g, totalLessons).replace(/\{\{POINTS\}\}/g, totalPoints);
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
        title: "About jpnotes.dev — Who Makes It, Sources & License",
        desc: "Who makes jpnotes.dev, why, which references it uses, and how to report a mistake or contribute. Free JLPT N5–N1 notes and practice under CC BY-NC 4.0.",
        keywords: "about jpnotes.dev, Japanese grammar notes, JLPT self-study, open source",
        name: "About jpnotes.dev", site: "jpnotes.dev", crumb: "About",
      },
      zh: {
        title: "关于 jpnotes.dev | 作者、内容来源与开源协议",
        desc: "了解 jpnotes.dev 是谁做的、为什么做、参考了哪些资料、如何反馈错误与参与贡献。免费、开源、采用 CC BY-NC 4.0 许可的 JLPT N5–N1 语法讲解和题库，含接续规则、例句、辨析、练习题、听力与模拟考。",
        keywords: "jpnotes.dev, 关于, 作者, 日语学习, JLPT 自学, 中文母语者",
        name: "关于 jpnotes.dev", site: "jpnotes.dev", crumb: "关于本站",
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
.about-content h1 { font-size: var(--text-2xl); margin: 0 0 1.2rem; }
.about-content h2 { font-size: var(--text-xl); margin: 2.2rem 0 .9rem; color: var(--text-strong); }
.about-content p, .about-content li { line-height: 1.85; }
.about-content ul { margin: .6rem 0 .6rem 1.4rem; }
.about-content li { margin: .3rem 0; }
.about-content blockquote { background: var(--card-bg); border-left: 3px solid var(--word-border); padding: .7rem 1.1rem; margin: 1rem 0; color: var(--text-muted); }
.about-content a { color: var(--ui); text-decoration: none; }
.about-content a:hover { text-decoration: underline; }
.about-content code { background: var(--code-bg); padding: .1rem .3rem; border-radius: var(--radius-sm); font-size: .9em; }
.about-content strong { color: var(--text-strong); }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .about-content h2 { color: #e4e4ec; }
  :root:not(.theme-light) .about-content strong { color: #f0f0f5; }
  :root:not(.theme-light) .about-content blockquote { background: var(--ui-soft); color: #b8b8c4; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark .about-content h2 { color: #e4e4ec; }
html.theme-dark .about-content strong { color: #f0f0f5; }
html.theme-dark .about-content blockquote { background: var(--ui-soft); color: #b8b8c4; }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}">jpnotes.dev</a><span class="sep">›</span><span><span class="lang-zh">关于本站</span><span class="lang-en">About</span></span>
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
  fs.writeFileSync(path.join(__dirname, "dist", "sync.js"), SYNC_JS_SRC, "utf-8");
  fs.writeFileSync(path.join(__dirname, "dist", "feedback.js"), FEEDBACK_JS_SRC, "utf-8");
  // Each data file gets a content-hash ?v= (the service worker caches it for good).
  const writeQuizData = (name, obj) => {
    const json = JSON.stringify(obj);
    fs.writeFileSync(path.join(__dirname, "dist", "quiz", name), json, "utf-8");
    return `${SITE_PATH}quiz/${name}?v=${require("crypto").createHash("md5").update(json).digest("hex").slice(0, 8)}`;
  };
  // One copy per page language: every { zh, en } text pair keeps only that
  // language (a page shows one language, data-force-lang), so /n3-practice/
  // doesn't download the Chinese explanations too. Ids and shape are unchanged.
  const langOnly = (o, code) => {
    if (Array.isArray(o)) return o.map((x) => langOnly(x, code));
    if (!o || typeof o !== "object") return o;
    const pair = "zh" in o && "en" in o, out = {};
    for (const [k, v] of Object.entries(o)) if (!(pair && k !== code && PAGE_LANGS.some((l) => l.code === k))) out[k] = langOnly(v, code);
    return out;
  };
  // name "n3.json" → { en: "/quiz/n3.en.json?v=…", zh: "/quiz/n3.zh.json?v=…" }
  const writeQuizDataByLang = (name, obj) => Object.fromEntries(PAGE_LANGS.map((l) => [l.code, writeQuizData(name.replace(/\.json$/, `.${l.code}.json`), langOnly(obj, l.code))]));
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
<meta property="og:locale" content="${lang.ogLocale}">${level || m.ogImage ? `\n<meta property="og:image" content="${SITE}${level ? `${level}/og-image.png` : m.ogImage}">\n<meta name="twitter:card" content="summary_large_image">` : ""}${m.schema ? `\n<script type="application/ld+json">${m.schema}</script>` : ""}
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
.qs-item { margin: 1rem 0; padding: .8rem 1rem; border: 1px solid var(--border); border-radius: var(--radius); }
.qs-type { font-size: .85rem; color: var(--text-muted); margin: 0 0 .4rem; }
.qs-stem { font-size: 1.05rem; margin: .4rem 0; }
.qs-opts { margin: .4rem 0 .5rem; padding-left: 1.6rem; }
.qs-slot { display: inline-block; min-width: 2.2em; border-bottom: 1px solid currentColor; text-align: center; margin: 0 .15em; }
.qs-passage, .qs-ck { font-size: .95rem; padding: .5rem .8rem; background: var(--surface-2); border-radius: var(--radius); margin: .4rem 0 .6rem; }
.qs-passage p, .qs-ck p { margin: .3rem 0; }
.qs-ck ul { list-style: none; padding: 0; margin: .3rem 0; }
.qs-nar, .qs-tr { color: var(--text-muted); }
.quiz-samples summary { cursor: pointer; color: var(--link); }
.quiz-samples details p { margin: .4rem 0; }
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
    <a href="${SITE}">jpnotes.dev</a><span class="sep">›</span>${level ? `<a href="${SITE_PATH}${level}/">${level}</a><span class="sep">›</span>` : ""}<span>${m.crumb}</span>
  </nav>
  <header class="quiz-head"><h1>${m.h1}</h1><p>${m.lead}</p><p class="quiz-nav">${m.nav}</p></header>
  ${appAttrs === null ? m.body : `<div id="quiz-app" data-level="${level}" data-audio="${AUDIO_BASE}" ${appAttrs}></div>`}${m.about || ""}
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
  const listeningPace = (L) => ({ N5: L("比平时说话慢，一字一句很清楚", "slower than everyday speech, every word clear"), N4: L("稍慢、清楚", "a little slow and clear"), N3: L("接近自然语速，发音清楚", "close to natural speed, clearly spoken"), N2: L("自然语速，口语缩略多", "natural speed, with everyday contractions"), N1: L("自然语速，内容更长更抽象", "natural speed, longer and more abstract") });
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
<li>${L("进度保存在这个浏览器里，不用注册；想在手机和电脑之间同步，可以在右上角登录。", "Progress stays in this browser, no account needed; sign in (top right) to sync it across your devices.")}</li>
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
    if (kind === "reading" || kind === "vocabulary") {
      const reading = kind === "reading", group = reading ? "dokkai" : "moji", t = bundle.practice.types;
      const qs = bundle.practice.questions.filter((q) => t[q.type] && t[q.type].g === group);
      const keys = Object.keys(t).filter((k) => t[k].g === group && qs.some((q) => q.type === k));
      const nP = new Set(qs.map((q) => q.passage).filter(Boolean)).size;
      const easy = level === "N5" || level === "N4";
      const others = SUBSET_PAGES.find((p) => p.id === kind).levels.filter((l) => l !== level).map((l) => `<a href="${SITE_PATH}${l.toLowerCase()}-${kind}/">${l}</a>`).join(" · ");
      return `<section class="quiz-about">
<h2>${L(`这里有哪些题（${qs.length} 道）`, `What's here (${qs.length} questions)`)}</h2>
<p>${reading
  ? L(`${nP} 篇原创文章，覆盖 ${level} 阅读的全部题型，格式和真题一致：`, `${nP} original passages in every ${level} reading format, laid out like the real test:`)
  : L(`${level} 文字词汇的全部题型，题目原创，格式和真题一致：`, `Every ${level} vocabulary item type, written from scratch in the real format:`)}</p>
<ul>${keys.map((k) => `<li>${tName(k)} — ${qs.filter((q) => q.type === k).length}</li>`).join("")}</ul>
<h2>${L("怎么用", "How it works")}</h2>
<ul>
<li>${L(reading ? "每天一组，或者按题型专练。一篇文章的题连在一起做。" : "每天一组，或者按题型专练，比如只练汉字读音。", reading ? "A daily set, or drill one format. All the questions on a passage come together." : "A daily set, or drill one format, such as kanji readings.")}</li>
<li>${L("答完马上看正确答案为什么对、每个错误选项为什么错，还可以让 AI 针对你选的选项讲解。", "After each answer, see why the right option is right and why each wrong one is wrong, and ask the AI about the option you picked.")}</li>
${reading ? `<li>${L("做完一篇的最后一题后，可以看全文翻译。短文、中篇和长篇还能听全文朗读。", "After the last question on a passage, read the full translation. Most passages can also be played aloud.")}</li>` : ""}
<li>${L("答错或点了「不会」的题会进错题本，过几天再考你。", "Questions you miss or mark “I don’t know” come back a few days later.")}</li>
<li>${L("进度保存在这个浏览器里，不用注册；想在手机和电脑之间同步，可以在右上角登录。", "Progress stays in this browser, no account needed; sign in (top right) to sync it across your devices.")}</li>
</ul>
<h2>${L("常见问题", "Questions")}</h2>
<dl>
<dt>${L("免费吗？", "Is it free?")}</dt><dd>${L("完全免费，没有广告，也不用注册。", "Yes — no ads and no sign-up.")}</dd>
<dt>${L("是真题吗？", "Are these past papers?")}</dt><dd>${L(`不是。题目全部原创，题型和难度按 ${level} 真题设计。`, `No. Every question is original, written to the real ${level}'s formats and difficulty.`)}</dd>
<dt>${L("有振假名吗？", "Is there furigana?")}</dt><dd>${reading
  ? (easy ? L("有，和真考一样。", "Yes, as on the real test.") : level === "N3" ? L("只给基础汉字以外的词加，和真考的做法接近。", "Only on words with less common kanji, close to the real test.") : L("没有，和真考一样。", "No, as on the real test."))
  : L("词汇题没有，和真考一样。", "No, as on the real test.")}</dd>
<dt>${L("想计时考一次？", "Want a timed run?")}</dt><dd>${bundle.mocks.length ? L(`做 <a href="${SITE_PATH}${lv}-mock-test/">${level} 模拟题</a>：按真考的结构和时间，交卷后估分。`, `Take the <a href="${SITE_PATH}${lv}-mock-test/">${level} mock test</a>: the real structure and timing, with an estimated score.`) : L("模拟题还在准备中。", "A mock test is on its way.")}</dd>
</dl>
<h2>${L("相关", "More")}</h2>
<p>${L(`全部题型混合练：<a href="${SITE_PATH}${lv}-practice/">${level} 练习题</a>。${others ? `其他级别：${others}。` : ""}考试安排和备考计划：<a href="${SITE_PATH}jlpt-december-2026/">12 月 JLPT 考前指南</a>。`, `All item types mixed: <a href="${SITE_PATH}${lv}-practice/">${level} practice questions</a>. ${others ? `Other levels: ${others}. ` : ""}Exam day and a study plan: <a href="${SITE_PATH}jlpt-december-2026/">December JLPT guide</a>.`)}</p>
</section>`;
    }
    if (kind === "listening") {
      const ckTypes = Object.entries(bundle.practice.types).filter(([, t]) => t.g === "choukai").map(([k]) => k);
      const qs = bundle.practice.questions.filter((q) => ckTypes.includes(q.type));
      const recs = (k) => new Set(qs.filter((q) => q.type === k).map((q) => q.passage || q.id)).size;
      const onTest = {};
      for (const q of bundle.mocks[0]?.test.questions || []) if (ckTypes.includes(q.type)) onTest[q.type] = (onTest[q.type] || 0) + 1;
      const pace = listeningPace(L)[level];
      const others = ckLevels.filter((l) => l !== level).map((l) => `<a href="${SITE_PATH}${l.toLowerCase()}-listening/">${l}</a>`).join(" · ");
      return `<section class="quiz-about">
<h2>${L(`JLPT ${level} 听力考什么`, `What the JLPT ${level} listening section tests`)}</h2>
<p>${L(`听力是单独一场，约 ${ckSec.minutes} 分钟，单独计分（0–${cfg.listening.max} 分，最低 ${cfg.listening.min} 分）。每段录音只放一次，题目和选项大多不印在试卷上，要边听边记。真考的题型和题数：`, `Listening is its own sitting, about ${ckSec.minutes} minutes, scored on its own (0–${cfg.listening.max}, minimum ${cfg.listening.min}). Each recording plays once, and most questions and options aren't printed, so you take notes as you listen. The item types and how many of each are on the test:`)}</p>
<table><tr><th>${L("题型", "Item type")}</th><th>${L("真考题数", "On the test")}</th><th>${L("这里的录音", "Recordings here")}</th></tr>${ckTypes.map((k) => `<tr><td>${tName(k)}</td><td>${onTest[k] || "—"}</td><td>${recs(k)}</td></tr>`).join("")}</table>
<h2>${L("怎么练", "How it works")}</h2>
<ul>
<li>${L("点播放听录音，练习时可以重听；想模拟真考，就只听一遍再作答。", "Play the recording; in practice you can replay it — to train for the real thing, listen once and answer.")}</li>
<li>${L(`语速：${pace}。`, `Speed: ${pace}.`)}</li>
<li>${L("答完显示原文：日语带振假名，附中文翻译，每一句都能单独重播，听不出来的地方对着原文再听。", "After answering, the transcript appears: Japanese with furigana and a translation, and any line can be replayed on its own, so you can match what you missed to the text.")}</li>
<li>${L("每个选项都有解析：为什么对，错的选项错在哪里（常见的陷阱是先说的答案被后面推翻）。", "Every option is explained: why the answer is right and where each wrong one goes wrong (a favourite trap is an answer given first and changed later).")}</li>
<li>${L("答错或猜对的题进错题本，过几天再考你。进度保存在这个浏览器里，不用注册。", "Questions you miss or guess come back in a review list a few days later. Progress stays in this browser; no account needed.")}</li>
</ul>
<h2>${L("常见问题", "Questions")}</h2>
<dl>
<dt>${L("免费吗？", "Is it free?")}</dt><dd>${L("完全免费，没有广告，也不用注册。", "Yes — no ads and no sign-up.")}</dd>
<dt>${L("录音是真题吗？", "Are these past-paper recordings?")}</dt><dd>${L(`不是。剧本全部原创，题型、长度、语速按 ${level} 真题设计；声音由 AI 语音合成（Google Gemini），每段都逐句检查过读音和说话人。`, `No. Every script is original, written to the real ${level}'s formats, length and speed; the voices are AI speech (Google Gemini), and every recording was checked line by line for readings and speakers.`)}</dd>
<dt>${L("可以下载 MP3 吗？", "Can I download the MP3s?")}</dt><dd>${L("目前只能在线播放；页面打开过的录音会缓存，之后网络不好也能放。", "Not for now — they play online, and recordings you've opened are cached so they still play on a weak connection.")}</dd>
<dt>${L("想按真考计时做一遍？", "Want a timed run like the real test?")}</dt><dd>${bundle.mocks.length ? L(`<a href="${SITE_PATH}${lv}-mock-test/">${level} 模拟题</a>的最后一场就是听力：每段只放一次，题间留作答时间，交卷后和其他科目一起估分。`, `The last sitting of the <a href="${SITE_PATH}${lv}-mock-test/">${level} mock test</a> is listening: each recording once, time to answer after it, scored with the other parts.`) : L("模拟题准备中。", "A mock test is on the way.")}</dd>
</dl>
<h2>${L("做完题，多听真实的日语", "After the questions: real Japanese to listen to")}</h2>
${podcastBlock(L, level)}
<h2>${L("相关", "More")}</h2>
<p>${L(`全部题型混合练：<a href="${SITE_PATH}${lv}-practice/">${level} 练习题</a>。${others ? `其他级别的听力：${others}（<a href="${SITE_PATH}listening/">JLPT 听力总览</a>）。` : ""}考试安排和备考计划：<a href="${SITE_PATH}jlpt-december-2026/">12 月 JLPT 考前指南</a>。`, `All item types mixed: <a href="${SITE_PATH}${lv}-practice/">${level} practice questions</a>.${others ? ` Listening at other levels: ${others} (<a href="${SITE_PATH}listening/">all JLPT listening practice</a>).` : ""} Exam day and a study plan: <a href="${SITE_PATH}jlpt-december-2026/">December JLPT guide</a>.`)}</p>
</section>`;
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
  // A few real questions written into the page, under the app: a crawler (or a
  // reader without JS) gets actual questions and answers, not just the shell.
  // In the page's language only; answers folded in <details>. Mock pages show
  // practice questions, never the mock's own. Furigana as in the quiz data.
  const SAMPLE_TYPES = {
    practice: ["kanji", "bunpou", "narabe", "short", "kadai|point|sokuji"],
    vocabulary: ["kanji", "hyouki", "bunmyaku", "iikae", "youhou"],
    reading: ["short", "mid", "info"],
    listening: ["kadai", "point", "sokuji", "hatsuwa|gaiyou"],
    mock: ["bunmyaku", "bunpou", "narabe", "iikae", "short"],
  };
  const quizSamples = (kind, bundle) => {
    const pr = bundle.practice, used = new Set(), out = [];
    const ok = (q) => !q.pre && q.why && Array.isArray(q.options) && q.answer != null && !(q.pic && q.pic.opts) && !(q.ck && q.ck.questions)
      && (!q.passage || (pr.passages[q.passage] && pr.passages[q.passage].html.length <= 1800 && !/\[\[\d+\]\]/.test(pr.passages[q.passage].html)));
    for (const spec of SAMPLE_TYPES[kind] || []) {
      if (out.length >= 5) break;
      for (const type of spec.split("|")) {
        const list = pr.questions.filter((q) => q.type === type && ok(q) && !used.has(q.passage || q.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
        if (!list.length) continue;
        const q = list[Math.floor(list.length * (kind === "mock" ? 0.71 : 0.37))];
        used.add(q.passage || q.id); out.push(q); break;
      }
    }
    return out;
  };
  const sEsc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sText = (o, code) => (o && typeof o === "object" ? o[code] : o) || "";
  const sExpl = (s) => sEsc(s).replace(/「[^「」\n]*」/g, (m) => `<span lang="ja">${m}</span>`).replace(/\n/g, "<br>");
  const sPlain = (h) => String(h || "").replace(/<rt>[\s\S]*?<\/rt>|<rp>[\s\S]*?<\/rp>/g, "").replace(/<u>([\s\S]*?)<\/u>/g, "「$1」").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/\[★\]/g, "＿★＿").replace(/\[_\]/g, "＿＿").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const sTextHtml = (src) => {
    let rows = [], out = "";
    const flush = () => { if (rows.length) out += `<div class="table-scroll"><table class="q-table">${rows.map((r, i) => `<tr>${r.map((c) => `<${i ? "td" : "th"}>${c.trim()}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table></div>`; rows = []; };
    for (const line of String(src).split("\n")) {
      if (/^\|/.test(line)) { rows.push(line.replace(/^\||\|$/g, "").split("|")); continue; }
      flush(); if (line) out += `<p>${line}</p>`;
    }
    flush();
    return out;
  };
  const quizSamplesHtml = (qs, en, bundle) => {
    if (!qs.length) return "";
    const L = (zh, e) => (en ? e : zh), code = en ? "en" : "zh", pr = bundle.practice;
    const items = qs.map((q, n) => {
      const ty = QUIZ_TYPES[q.type] || pr.types[q.type] || {};
      let body = "";
      if (q.ck) {
        const who = (s) => (en ? s : s.replace(/^M/, "男").replace(/^F/, "女"));
        body += `<div class="qs-ck" lang="ja">${q.ck.scene ? `<p class="qs-nar">${q.ck.scene}</p>` : ""}${q.ck.question ? `<p class="qs-nar">${q.ck.question}</p>` : ""}<ul>${q.ck.lines.map((l) => `<li><b>${sEsc(who(l[0]))}</b> ${l[1]}</li>`).join("")}</ul></div>`;
      } else {
        const P = q.passage && pr.passages[q.passage];
        if (P) body += `<div class="qs-passage" lang="ja">${P.intro ? `<p class="qs-nar">${P.intro}</p>` : ""}${sTextHtml(P.html)}</div>`;
        const stem = q.stem ? q.stem.replace(/\n/g, "<br>").replace(/\[★\]/g, '<span class="qs-slot">★</span>').replace(/\[_\]/g, '<span class="qs-slot"></span>') : q.q || "";
        if (stem) body += `<p class="qs-stem" lang="ja">${stem}</p>`;
      }
      body += `<ol class="qs-opts" lang="ja">${q.options.map((o) => `<li>${o}</li>`).join("")}</ol>`;
      const okj = (i) => (q.okj && q.okj[i] ? `（${q.okj[i]}）` : "");
      let ans = q.type === "narabe"
        ? `<p><b>${L("★ 处：", "★ is ")}${q.answer + 1}</b> <span lang="ja">${q.options[q.answer]}</span></p>${q.order ? `<p lang="ja">${L("顺序：", "Order: ")}${q.order.map((i) => q.options[i]).join(" → ")}</p>` : ""}`
        : `<p><b>${L("答案：", "Answer: ")}${q.answer + 1}</b> <span lang="ja">${q.options[q.answer]}${okj(q.answer)}</span></p>`;
      if (q.full) ans += `<p class="qs-full" lang="ja">${q.full}</p>`;
      const tr = q.ck ? "" : typeof sText(q.tr, code) === "string" ? sText(q.tr, code) : "";
      if (tr) ans += `<p class="qs-tr">${sEsc(tr)}</p>`;
      ans += `<p>${sExpl(sText(q.why, code))}</p>`;
      const wrong = (q.wrong || []).map((w, i) => (w && sText(w, code) ? `<li><b lang="ja">${i + 1} ${q.options[i]}</b> — ${sExpl(sText(w, code))}</li>` : "")).join("");
      if (wrong && q.type !== "narabe") ans += `<ul>${wrong}</ul>`;
      return `<div class="qs-item"><p class="qs-type">${n + 1}. ${sEsc(en ? ty.en : ty.zh)} · <span lang="ja">${sEsc(ty.ja)}</span></p>${body}<details><summary>${L("看答案和解析", "Answer and explanation")}</summary>${ans}</details></div>`;
    }).join("");
    return `<section class="quiz-about quiz-samples"><h2>${L("例题", "Sample questions")}</h2><p>${L("从题库里抽的几道题，答案和解析折叠在下面。完整的练习在上面开始。", "A few questions from the bank, with the answers folded underneath. Start the full practice above.")}</p>${items}</section>`;
  };
  // schema.org Question for each sample (plain text, no furigana).
  const quizSampleSchema = (qs, en) => qs.map((q) => {
    const code = en ? "en" : "zh", text = q.ck ? sPlain(q.ck.question || "") || (en ? "Choose the right reply." : "选出合适的回应。") : sPlain(q.stem || q.q || "");
    const ans = (i) => ({ "@type": "Answer", position: i, text: sPlain(q.options[i]) });
    return { "@type": "Question", eduQuestionType: "Multiple choice", text: text || sPlain(q.options.join(" / ")),
      suggestedAnswer: q.options.map((_, i) => i).filter((i) => i !== q.answer).map(ans),
      acceptedAnswer: { ...ans(q.answer), answerExplanation: { "@type": "Comment", text: sText(q.why, code).replace(/\s+/g, " ").trim() } } };
  });
  // Schema: what the page is, and where it sits (Home › level › page).
  const quizSchema = (level, kind, m, url, samples) => JSON.stringify([
    { "@context": "https://schema.org", "@type": kind === "cards" ? "LearningResource" : "Quiz", name: m.h1, description: m.desc, url, inLanguage: m.lang,
      educationalLevel: `JLPT ${level}`, isAccessibleForFree: true, learningResourceType: kind === "mock" ? "Practice test" : kind === "cards" ? "Flashcards" : kind === "listening" ? "Listening practice" : "Practice questions",
      about: { "@type": "Thing", name: "Japanese language" }, provider: { "@type": "Organization", name: "jpnotes.dev", url: SITE }, ...(samples && samples.length ? { hasPart: samples } : {}) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: m.home, item: SITE },
      { "@type": "ListItem", position: 2, name: level, item: `${SITE}${level}/` },
      { "@type": "ListItem", position: 3, name: m.crumb, item: url }] },
  ]).replace(/</g, "\\u003c");
  const withAbout = (m, level, kind, en, bundle, url) => {
    const qs = quizSamples(kind, bundle);
    return { ...m, about: quizSamplesHtml(qs, en, bundle) + quizAbout(level, kind, en, bundle), schema: quizSchema(level, kind, { ...m, lang: en ? "en" : "zh-Hans", home: en ? "Japanese Grammar Notes" : "日语语法笔记" }, url, quizSampleSchema(qs, en)) };
  };
  for (const [level, { practice, mocks }] of Object.entries(quizBundles)) {
    const lv = level.toLowerCase();
    const practiceId = `${lv}-practice`, mockId = `${lv}-mock-test`, cardsId = `${lv}-cards`, listeningId = `${lv}-listening`;
    const hasCk = ckLevels.includes(level);
    // The pages link to each other (when the other one exists).
    const navLinks = (here, en) => [
      here !== practiceId && `✍ <a href="${SITE_PATH}${practiceId}/">${en ? "Practice by question type" : "按题型练习"}</a>`,
      here !== listeningId && hasCk && `🎧 <a href="${SITE_PATH}${listeningId}/">${en ? `${level} listening practice` : `${level} 听力练习`}</a>`,
      ...SUBSET_PAGES.filter((p) => p.levels.includes(level) && here !== `${lv}-${p.id}`).map((p) => (p.id === "reading"
        ? `📖 <a href="${SITE_PATH}${lv}-reading/">${en ? `${level} reading practice` : `${level} 阅读练习`}</a>`
        : `🔤 <a href="${SITE_PATH}${lv}-vocabulary/">${en ? `${level} vocabulary practice` : `${level} 词汇练习`}</a>`)),
      here !== mockId && mocks.length && `⏱ <a href="${SITE_PATH}${mockId}/">${en ? `Timed ${level} mock test` : `${level} 模拟题（计时）`}</a>`,
      here !== cardsId && `🗂 <a href="${SITE_PATH}${cardsId}/">${en ? "Grammar flashcards" : "语法卡片（在线背）"}</a>`,
    ].filter(Boolean).join(" · ");
    const src = writeQuizDataByLang(`${lv}.json`, practice);
    const count = practice.questions.length;
    const meta = {
      en: {
        title: `JLPT ${level} Practice Test — Free Questions with Answers & Explanations`,
        desc: `Free JLPT ${level} practice: ${count} exam-style questions — ${ckLevels.includes(level) ? "listening with audio, " : ""}kanji, vocabulary, grammar and reading — with an explanation for every option.`,
        h1: `JLPT ${level} Practice Test`, crumb: `${level} Practice`,
        lead: `Exam-style ${level} questions in every format of the test${ckLevels.includes(level) ? ", listening included" : " except listening"}. Answer, see why each option is right or wrong, and the ones you miss come back a few days later.`,
        nav: navLinks(practiceId, true),
      },
      zh: {
        title: `JLPT ${level} 练习题在线做（免费）- 题型同真题${ckLevels.includes(level) ? "，含听力" : ""}，每题有解析`,
        desc: `免费 JLPT ${level} 练习：${count} 道仿真题，覆盖${ckLevels.includes(level) ? "听力（带音频）、" : ""}汉字读音、词汇、语法、句子排序和阅读，即时判分，每个错误选项都有解析，错题本按间隔重复自动复习。`,
        h1: `JLPT ${level} 练习题`, crumb: `${level} 练习`,
        lead: `${ckLevels.includes(level) ? "覆盖" : "除听力外覆盖 "}${level} 考试的全部题型${ckLevels.includes(level) ? "（含听力）" : ""}。答完马上看每个选项为什么对、为什么错，答错的题过几天会再考你一次。`,
        nav: navLinks(practiceId, false),
      },
    };
    for (const lang of PAGE_LANGS) {
      writeLangPage(practiceId, lang, localizePage(renderQuiz(lang, withAbout(meta[lang.code], level, "practice", lang.code === "en", quizBundles[level], langVariant(practiceId, lang).url), langVariant(practiceId, lang), level, `data-src="${src[lang.code]}"`, src[lang.code]), lang, localizedPageIds));
    }
    quizPageIds.push(practiceId);
    console.log(`  Generated dist/${practiceId}/ (${count} questions${QUIZ_PUBLIC ? "" : ", not public"})`);
    // Listening practice: the same app on the listening questions only, a page of
    // its own because "JLPT N5 listening" is what people search for.
    if (hasCk) {
      const ckTypes = Object.fromEntries(Object.entries(practice.types).filter(([, t]) => t.g === "choukai"));
      const ckQs = practice.questions.filter((q) => ckTypes[q.type]);
      const ckIds = new Set(ckQs.map((q) => q.passage).filter(Boolean));
      const ckSrc = writeQuizDataByLang(`${lv}-listening.json`, { ...practice, types: ckTypes, questions: ckQs,
        passages: Object.fromEntries(Object.entries(practice.passages || {}).filter(([id]) => ckIds.has(id))) });
      const recs = new Set(ckQs.map((q) => q.passage || q.id)).size;
      const ckMeta = {
        en: {
          title: `JLPT ${level} Listening Practice — Free Audio Questions with Transcripts`,
          desc: `Free JLPT ${level} listening practice: ${recs} recordings in every test format, with replayable audio, transcripts with furigana, and every option explained. No sign-up.`,
          h1: `JLPT ${level} Listening Practice`, crumb: `${level} Listening`,
          lead: `Every listening format of the ${level}, in original recordings. Play, answer, then read the transcript and see why each option is right or wrong.`,
          nav: navLinks(listeningId, true),
        },
        zh: {
          title: `JLPT ${level} 听力练习 - 在线听力题，带音频、原文和解析`,
          desc: `免费 JLPT ${level} 听力在线练习：${recs} 段录音，覆盖真考的全部听力题型，可反复播放，答完看带振假名和翻译的原文，每个选项都有解析。`,
          h1: `JLPT ${level} 听力练习`, crumb: `${level} 听力`,
          lead: `${level} 听力的全部题型，录音原创。听完作答，再看原文和每个选项为什么对、为什么错。`,
          nav: navLinks(listeningId, false),
        },
      };
      for (const lang of PAGE_LANGS) {
        writeLangPage(listeningId, lang, localizePage(renderQuiz(lang, withAbout(ckMeta[lang.code], level, "listening", lang.code === "en", quizBundles[level], langVariant(listeningId, lang).url), langVariant(listeningId, lang), level, `data-src="${ckSrc[lang.code]}"`, ckSrc[lang.code]), lang, localizedPageIds));
      }
      quizPageIds.push(listeningId);
      console.log(`  Generated dist/${listeningId}/ (${ckQs.length} listening questions)`);
    }
    for (const p of SUBSET_PAGES.filter((x) => x.levels.includes(level))) {
      const pageId = `${lv}-${p.id}`, reading = p.id === "reading";
      const subTypes = Object.fromEntries(Object.entries(practice.types).filter(([, t]) => t.g === p.group));
      const subQs = practice.questions.filter((q) => subTypes[q.type]);
      const pIds = new Set(subQs.map((q) => q.passage).filter(Boolean));
      const subSrc = writeQuizDataByLang(`${pageId}.json`, { ...practice, page: p.id, types: subTypes, questions: subQs,
        passages: Object.fromEntries(Object.entries(practice.passages || {}).filter(([id]) => pIds.has(id))) });
      const pageMeta = reading ? {
        en: { title: `JLPT ${level} Reading Practice — Free Passages with Translations`,
          desc: `Free JLPT ${level} reading practice: ${pIds.size} original passages in every test format, with full translations and every option explained. No sign-up.`,
          h1: `JLPT ${level} Reading Practice`, crumb: `${level} Reading`,
          lead: `Every reading format of the ${level}, in original passages. Answer, see why each option is right or wrong, then read the full translation.`, nav: navLinks(pageId, true) },
        zh: { title: `JLPT ${level} 阅读练习 - 在线阅读题，带全文翻译和解析`,
          desc: `免费 JLPT ${level} 阅读在线练习：${pIds.size} 篇原创文章，覆盖真考的全部阅读题型，答完看全文翻译，每个选项都有解析。`,
          h1: `JLPT ${level} 阅读练习`, crumb: `${level} 阅读`,
          lead: `${level} 阅读的全部题型，文章原创。答完看每个选项为什么对、为什么错，再看全文翻译。`, nav: navLinks(pageId, false) },
      } : {
        en: { title: `JLPT ${level} Vocabulary Practice — Free Kanji & Word Questions`,
          desc: `Free JLPT ${level} vocabulary practice: ${subQs.length} exam-style questions on kanji readings, writing and word use, with every option explained. No sign-up.`,
          h1: `JLPT ${level} Vocabulary Practice`, crumb: `${level} Vocabulary`,
          lead: `Every vocabulary item type of the ${level}: kanji readings, writing, word choice and more. Answer, then see why each option is right or wrong.`, nav: navLinks(pageId, true) },
        zh: { title: `JLPT ${level} 词汇练习 - 文字词汇在线做题，附详细解析`,
          desc: `免费 JLPT ${level} 文字词汇在线练习：${subQs.length} 道仿真题，覆盖汉字读音、汉字写法和词语运用，每个选项都有解析。`,
          h1: `JLPT ${level} 词汇练习`, crumb: `${level} 词汇`,
          lead: `${level} 文字词汇的全部题型：汉字读音、汉字写法、选词填空等。答完马上看每个选项为什么对、为什么错。`, nav: navLinks(pageId, false) },
      };
      for (const lang of PAGE_LANGS) {
        writeLangPage(pageId, lang, localizePage(renderQuiz(lang, withAbout(pageMeta[lang.code], level, p.id, lang.code === "en", quizBundles[level], langVariant(pageId, lang).url), langVariant(pageId, lang), level, `data-src="${subSrc[lang.code]}"`, subSrc[lang.code]), lang, localizedPageIds));
      }
      quizPageIds.push(pageId);
      console.log(`  Generated dist/${pageId}/ (${subQs.length} questions)`);
    }
    // Flashcards: the data is written by build-anki.js (it runs after this).
    const cardsMeta = {
      en: {
        title: `JLPT ${level} Grammar Flashcards Online — Spaced Repetition, Free`,
        desc: `Free JLPT ${level} grammar flashcards: meaning, examples with furigana and audio, and Anki-style spaced repetition in your browser. No app or account.`,
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
    const sets = mocks.map(({ test, key }) => ({ id: test.id, n: test.n, src: writeQuizDataByLang(`${test.id}.json`, test), key: writeQuizDataByLang(`${test.id}.key.json`, key) }));
    const setsFor = (code) => JSON.stringify(sets.map((x) => ({ ...x, src: x.src[code], key: x.key[code] })));
    const mockMeta = {
      en: {
        title: `JLPT ${level} Mock Test — Free Timed Sample Exam with Score`,
        desc: `Free timed JLPT ${level} mock test in the real format${hasCk ? ", listening included" : ""}: an estimated score against the pass marks and every question explained.`,
        h1: `JLPT ${level} Mock Test`, crumb: `${level} Mock test`,
        lead: `Original questions in the real test's order and timing, not in the practice bank. No answers until you submit; then an estimated score, where the time went, and an explanation for every question.`,
        nav: navLinks(mockId, true),
      },
      zh: {
        title: `JLPT ${level} 模拟题在线测试（免费）- 计时估分${hasCk ? "，含听力" : ""}`,
        desc: `免费 JLPT ${level} 在线模拟考：按真题结构和时间出题（文字词汇、语法、阅读${hasCk ? "、听力" : ""}），交卷后估算分数、对照合格线，按题型分析，每道题都有解析。`,
        h1: `JLPT ${level} 模拟题`, crumb: `${level} 模拟题`,
        lead: `原创题目，按真考的顺序和时间作答，和练习题不重复。交卷前不显示答案；交卷后估算分数、看时间花在哪里、逐题看解析。`,
        nav: navLinks(mockId, false),
      },
    };
    for (const lang of PAGE_LANGS) {
      writeLangPage(mockId, lang, localizePage(renderQuiz(lang, withAbout(mockMeta[lang.code], level, "mock", lang.code === "en", quizBundles[level], langVariant(mockId, lang).url), langVariant(mockId, lang), level, `data-mode="mock" data-sets='${setsFor(lang.code)}'`), lang, localizedPageIds));
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
    if (!b) return `<tr class="hub-soon"><th scope="row"><span class="level-tag">${level}</span></th><td colspan="3">${L("准备中", "Coming soon")}</td></tr>`;
    const n = b.practice.questions.length, types = Object.keys(b.practice.types).length;
    const minutes = b.mocks.length ? b.mocks[0].test.sections.reduce((a, x) => a + x.minutes, 0) : 0;
    return `<tr><th scope="row"><span class="level-tag">${level}</span></th>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-practice/"><b>${L("练习题", "Practice")}</b><span>${L(`${n} 题 · ${types} 种题型`, `${n} questions · ${types} types`)}<span class="hub-done" data-lv="${lv}" data-t="${L(" · 已做 N", " · N done")}" hidden></span></span></a></td>
      ${ckLevels.length ? `<td>${ckLevels.includes(level) ? `<a class="hub-go" href="${SITE_PATH}${lv}-listening/"><b>${L("听力", "Listening")}</b><span>${L(`${new Set(b.practice.questions.filter((q) => b.practice.types[q.type].g === "choukai").map((q) => q.passage || q.id)).size} 段录音`, `${new Set(b.practice.questions.filter((q) => b.practice.types[q.type].g === "choukai").map((q) => q.passage || q.id)).size} recordings`)}</span></a>` : ""}</td>` : ""}
      <td>${b.mocks.length ? `<a class="hub-go" href="${SITE_PATH}${lv}-mock-test/"><b>${L("模拟题", "Mock test")}</b><span>${L(`${b.mocks.length} 套 · ${minutes} 分钟`, `${b.mocks.length} test${b.mocks.length > 1 ? "s" : ""} · ${minutes} min`)}</span></a>` : ""}</td>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-cards/"><b>${L("语法卡片", "Flashcards")}</b><span>${L("每个语法点一张", "one per grammar point")}</span></a></td></tr>`;
  };
  const hubIntro = (en) => {
    const L = (zh, e) => (en ? e : zh);
    return `<ul class="hub-modes">
      <li><b>✍ ${L("练习题", "Practice")}</b>${ckLevels.length === 5 ? L("全部题型（含听力）。今日练习、按题型练、错题本；每题答完马上看解析。", "Every item type, listening included. Daily sets, by type, a review list; explanations after each answer.") : ckLevels.length ? L(`全部题型；听力目前有 ${ckLevels.join("、")}。今日练习、按题型练、错题本；每题答完马上看解析。`, `Every item type; listening so far at ${ckLevels.join(", ")}. Daily sets, by type, a review list; explanations after each answer.`) : L("除听力外的全部题型。今日练习、按题型练、错题本；每题答完马上看解析。", "Every item type but listening. Daily sets, by type, a review list; explanations after each answer.")}</li>
      ${ckLevels.length ? `<li><b>🎧 ${L("听力", "Listening")}</b>${L("只练听力：每级全部听力题型，可重听，答完看带振假名和翻译的原文。", "Listening only: every listening item type, replay as often as you like, then a transcript with furigana and translation.")}</li>` : ""}
      <li><b>⏱ ${L("模拟题", "Mock test")}</b>${L("按真考的结构和时间计时，交卷后估分、对照合格线。", "The real test's structure and timing; an estimated score against the pass marks.")}</li>
      <li><b>🗂 ${L("语法卡片", "Flashcards")}</b>${L("每个语法点一张卡，间隔复习，认卡和填空卡两种。", "A card per grammar point with spaced repetition, recognition or fill-in.")}</li>
    </ul>`;
  };
  // Answered-question counts per level, from this browser's localStorage.
  const HUB_PROGRESS_JS = `(function(){try{var a=(JSON.parse(localStorage.getItem('jp_quiz_v1'))||{}).answers||{},c={};Object.keys(a).forEach(function(id){var l=id.slice(0,2);c[l]=(c[l]||0)+1;});document.querySelectorAll('.hub-done').forEach(function(el){var n=c[el.getAttribute('data-lv')];if(n){el.textContent=el.getAttribute('data-t').replace('N',n);el.hidden=false;}});}catch(e){}})();`;
  const hubMeta = {
    en: {
      title: "JLPT Practice Tests Online — N5 to N1 Questions, Mock Tests & Flashcards",
      desc: "Free JLPT practice in your browser: exam-style questions with listening, timed mock tests with estimated scores, and grammar flashcards. No sign-up.",
      h1: "Practice", crumb: "Practice", nav: "",
      lead: "Everything on this site you do rather than read. Pick your level; progress stays in this browser.",
    },
    zh: {
      title: "JLPT 在线练习题 - N5 到 N1 练习、模拟题、语法卡片",
      desc: "免费在线做 JLPT 题：含听力的全部题型仿真练习题、计时模拟题（交卷估分）、语法卡片间隔复习，打开即用，无需注册。",
      h1: "做题", crumb: "做题", nav: "",
      lead: "这里是本站所有“动手”的部分：练习、模拟、背卡。选你的级别开始，进度保存在这个浏览器里。",
    },
  };
  for (const lang of PAGE_LANGS) {
    const en = lang.code === "en";
    const m = { ...hubMeta[lang.code], ogImage: "practice/og-image.png", body: `${hubIntro(en)}<div class="table-scroll"><table class="hub-table"><tbody>${["N5", "N4", "N3", "N2", "N1"].map((l) => hubRow(l, en)).join("")}</tbody></table></div>
      <script>${HUB_PROGRESS_JS}</script>
      <p class="hub-listen">${en
        ? ckLevels.length ? `🎧 <b><a href="${SITE_PATH}listening/">Listening practice for every level</a>.</b> For real Japanese, the <a href="${podcastUrl(true, "practice-hub")}" target="_blank">Japanese Daily News podcast</a> has a real Japanese news story every day, with transcripts.` : `🎧 <b>Listening questions are planned, not built yet.</b> If you want them, <a href="#feedback" class="fb-open">say so</a> — demand decides what comes first. Meanwhile the <a href="${podcastUrl(true, "practice-hub")}" target="_blank">Japanese Daily News podcast</a> has a real Japanese news story every day, with transcripts.`
        : ckLevels.length ? `🎧 <b><a href="${SITE_PATH}listening/">各级别的听力练习</a>。</b>想听真实的日语，可以用 <a href="${podcastUrl(false, "practice-hub")}" target="_blank">Japanese Daily News 播客</a>练听力（每天一则日语新闻，附原文和中文翻译）。` : `🎧 <b>听力题在规划中，还没做。</b>想要的话<a href="#feedback" class="fb-open">告诉我们</a>，想要的人多就先做。现在可以先用 <a href="${podcastUrl(false, "practice-hub")}" target="_blank">Japanese Daily News 播客</a>练听力（每天一则日语新闻，附原文和中文翻译）。`}</p>
      <p class="hub-listen">${en ? `By section: <a href="${SITE_PATH}listening/">listening</a> · <a href="${SITE_PATH}reading/">reading</a> · <a href="${SITE_PATH}vocabulary/">vocabulary</a> · <a href="${SITE_PATH}mock-test/">mock tests</a>. 💡 Tips: <a href="${SITE_PATH}jlpt-vocabulary-grammar-tips/">vocabulary &amp; grammar</a> · <a href="${SITE_PATH}jlpt-reading-tips/">reading</a> · <a href="${SITE_PATH}jlpt-listening-tips/">listening</a>.` : `按部分练：<a href="${SITE_PATH}listening/">听力</a> · <a href="${SITE_PATH}reading/">阅读</a> · <a href="${SITE_PATH}vocabulary/">词汇</a> · <a href="${SITE_PATH}mock-test/">模拟题</a>。💡 做题技巧：<a href="${SITE_PATH}jlpt-vocabulary-grammar-tips/">文字词汇与语法</a> · <a href="${SITE_PATH}jlpt-reading-tips/">阅读</a> · <a href="${SITE_PATH}jlpt-listening-tips/">听力</a>。`}</p>` };
    writeLangPage("practice", lang, localizePage(renderQuiz(lang, m, langVariant("practice", lang), "", null), lang, localizedPageIds));
  }
  quizPageIds.push("practice");

  const tipsLink = (slug, L, zh, en) => fs.existsSync(path.join(__dirname, "grammar/guides", `${slug}.md`)) ? `<p class="hub-listen">💡 <b><a href="${SITE_PATH}${slug}/">${L(zh, en)}</a></b></p>` : "";
  // /listening/: the one page for "jlpt listening practice" with no level in the
  // query. The level pages stay the ones with the questions.
  if (ckLevels.length) {
    const ckStats = (level) => {
      const b = quizBundles[level], types = Object.keys(b.practice.types).filter((k) => b.practice.types[k].g === "choukai");
      const qs = b.practice.questions.filter((q) => types.includes(q.type));
      return { types, recs: new Set(qs.map((q) => q.passage || q.id)).size, minutes: QUIZ_MOCK[level].sections.find((x) => x.listening).minutes, min: QUIZ_MOCK[level].listening.min, max: QUIZ_MOCK[level].listening.max, mock: b.mocks.length > 0 };
    };
    const stats = Object.fromEntries(ckLevels.map((l) => [l, ckStats(l)]));
    const total = Object.values(stats).reduce((a, x) => a + x.recs, 0);
    const allTypes = [...new Set(ckLevels.flatMap((l) => stats[l].types))];
    const ORDER = ["N5", "N4", "N3", "N2", "N1"].filter((l) => stats[l]);
    const row = (level, L) => {
      const x = stats[level], lv = level.toLowerCase();
      return `<tr><th scope="row"><span class="level-tag">${level}</span></th>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-listening/"><b>${L("听力练习", "Listening practice")}</b><span>${L(`${x.recs} 段录音 · ${x.types.length} 种题型`, `${x.recs} recordings · ${x.types.length} item types`)}</span></a></td>
      <td>${x.mock ? `<a class="hub-go" href="${SITE_PATH}${lv}-mock-test/"><b>${L("模拟题", "Mock test")}</b><span>${L("听力在最后一场", "Listening is the last sitting")}</span></a>` : ""}</td></tr>`;
    };
    const about = (L) => `${tipsLink("jlpt-listening-tips", L, "听力做题技巧：每种题型先看什么、听什么，常见陷阱", "Listening tips: what to read first and listen for in each item type, and the usual traps")}<section class="quiz-about">
<h2>${L("这里能练什么", "What you get")}</h2>
<ul>
<li>${L(`${total} 段原创录音，覆盖 N5 到 N1 的全部听力题型。`, `${total} original recordings, covering every listening item type from N5 to N1.`)}</li>
<li>${L("答完看带振假名和翻译的原文，每一句都能单独重播。", "After answering, read a transcript with furigana and a translation, and replay any line on its own.")}</li>
<li>${L("每个选项都有解析：为什么对，错的选项错在哪里。", "Every option is explained: why the answer is right and where each wrong one goes wrong.")}</li>
<li>${L("完全免费，没有广告，不用注册，打开网页就能练。", "Completely free, with no ads and no sign-up. It runs in your browser.")}</li>
</ul>
<h2>${L("JLPT 听力有哪些题型", "JLPT listening item types")}</h2>
<table><tr><th>${L("题型", "Item type")}</th><th>${L("级别", "Levels")}</th></tr>${allTypes.map((k) => `<tr><td>${L(QUIZ_TYPES[k].zh, QUIZ_TYPES[k].en)} · ${QUIZ_TYPES[k].ja}</td><td>${ORDER.filter((l) => stats[l].types.includes(k)).join(" ")}</td></tr>`).join("")}</table>
<h2>${L("各级别的听力有什么不同", "How listening differs by level")}</h2>
<table><tr><th>${L("级别", "Level")}</th><th>${L("语速", "Speed")}</th><th>${L("考试时长", "Time on the test")}</th><th>${L("听力最低分", "Minimum score")}</th></tr>${ORDER.map((l) => `<tr><td>${l}</td><td>${listeningPace(L)[l]}</td><td>${L(`约 ${stats[l].minutes} 分钟`, `about ${stats[l].minutes} min`)}</td><td>${stats[l].min} / ${stats[l].max}</td></tr>`).join("")}</table>
<p>${L("总分过线还不够，听力低于最低分同样不合格，所以听力要单独准备。", "A passing total isn't enough: scoring below the listening minimum fails the test, so listening needs its own practice.")}</p>
<h2>${L("怎么练", "How to practise")}</h2>
<ol>
<li>${L("选你要考的级别。听一遍就作答，和真考一样。", "Pick the level you're taking. Listen once and answer, as on the real test.")}</li>
<li>${L("看原文，找出没听出来的地方，单句重播，跟着读。", "Read the transcript, find what you missed, replay those lines and read along.")}</li>
<li>${L("答错或猜对的题进错题本，过几天再练一次。", "Questions you miss or guess come back in a review list a few days later.")}</li>
<li>${L("考前用模拟题完整做一遍，练习时间分配和作答节奏。", "Before the exam, take a full mock test to practise timing and pacing.")}</li>
</ol>
<h2>${L("常见问题", "Questions")}</h2>
<dl>
<dt>${L("免费吗？要注册吗？", "Is it free? Do I need an account?")}</dt><dd>${L("完全免费，没有广告，不用注册。进度保存在这个浏览器里。", "It's free, with no ads and no sign-up. Progress stays in this browser.")}</dd>
<dt>${L("录音是真题吗？", "Are these past-paper recordings?")}</dt><dd>${L("不是。剧本全部原创，题型、长度和语速按各级别真题设计；声音由 AI 语音合成（Google Gemini），每段都检查过读音和说话人。", "No. Every script is original, written to each level's formats, length and speed; the voices are AI speech (Google Gemini), and every recording was checked for readings and speakers.")}</dd>
<dt>${L("手机上能用吗？", "Does it work on a phone?")}</dt><dd>${L("可以，用手机浏览器打开就行，不用下载 App。", "Yes. Open it in your phone's browser; there's no app to install.")}</dd>
<dt>${L("可以下载 MP3 吗？", "Can I download the MP3s?")}</dt><dd>${L("目前只能在线播放；打开过的录音会缓存，之后网络不好也能放。", "Not for now. They play online, and recordings you've opened are cached so they still play on a weak connection.")}</dd>
<dt>${L("想听真实的日语？", "Want real-world Japanese too?")}</dt><dd>${L(`可以配合两档播客：<a href="${podcastUrl(false, "listening-hub")}" target="_blank">Japanese Daily News</a>（N5–N3），每天一则日语新闻，逐句讲解，附原文和翻译；<a href="${podcastUrl(false, "listening-hub", null, "nihongo")}" target="_blank">日本語で聞くニュース</a>（N3–N2），全日语，新闻读一遍再用日语讲解。`, `Pair it with two podcasts: <a href="${podcastUrl(true, "listening-hub")}" target="_blank">Japanese Daily News</a> (N5–N3), a Japanese news story every day explained sentence by sentence, with a transcript and translation; and <a href="${podcastUrl(true, "listening-hub", null, "nihongo")}" target="_blank">日本語で聞くニュース</a> (N3–N2), all in Japanese: the news read and then talked through.`)}</dd>
</dl>
</section>`;
    const ckHubMeta = {
      en: {
        title: "JLPT Listening Practice Online — Free N5 to N1 Audio Questions with Transcripts",
        desc: `Free JLPT listening practice website: ${total} original recordings from N5 to N1, every item type, with transcripts, translations and explanations. No sign-up.`,
        h1: "JLPT Listening Practice", crumb: "Listening", nav: "",
        lead: "Choose your level. Listen, answer, then read the transcript and see why each option is right or wrong.",
      },
      zh: {
        title: "JLPT 听力练习网站 - N5 到 N1 免费在线听力题，带音频和原文",
        desc: `免费 JLPT 听力练习网站：N5 到 N1 共 ${total} 段原创录音，覆盖全部听力题型，带原文、翻译和解析，打开即用，无需注册。`,
        h1: "JLPT 听力练习", crumb: "听力", nav: "",
        lead: "选择你的级别。听完作答，再看原文和每个选项为什么对、为什么错。",
      },
    };
    for (const lang of PAGE_LANGS) {
      const en = lang.code === "en", L = (zh, e) => (en ? e : zh), v = langVariant("listening", lang);
      const m = ckHubMeta[lang.code];
      writeLangPage("listening", lang, localizePage(renderQuiz(lang, {
        ...m, ogImage: "listening/og-image.png",
        body: `<div class="table-scroll"><table class="hub-table"><tbody>${ORDER.map((l) => row(l, L)).join("")}</tbody></table></div>`,
        about: about(L),
        schema: JSON.stringify([
          { "@context": "https://schema.org", "@type": "LearningResource", name: m.h1, description: m.desc, url: v.url, inLanguage: en ? "en" : "zh-Hans", educationalLevel: "JLPT N5–N1", isAccessibleForFree: true, learningResourceType: "Listening practice", about: { "@type": "Thing", name: "Japanese language" }, provider: { "@type": "Organization", name: "jpnotes.dev", url: SITE } },
          { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE }, { "@type": "ListItem", position: 2, name: m.crumb, item: v.url }] },
        ]).replace(/</g, "\\u003c"),
      }, v, "", null), lang, localizedPageIds));
    }
    quizPageIds.push("listening");
  }

  // /reading/, /vocabulary/, /mock-test/: level-less hubs like /listening/, for
  // "jlpt reading practice" style searches and the sidebar's 做题 group.
  const ORDER5 = ["N5", "N4", "N3", "N2", "N1"].filter((l) => quizBundles[l]);
  const typeNames = (types, L) => types.map((k) => L(QUIZ_TYPES[k].zh, QUIZ_TYPES[k].en)).join(L("、", ", "));
  const subStats = (level, group) => {
    const b = quizBundles[level], types = Object.keys(b.practice.types).filter((k) => b.practice.types[k].g === group);
    const qs = b.practice.questions.filter((q) => types.includes(q.type));
    return { types, qs: qs.length, passages: new Set(qs.map((q) => q.passage).filter(Boolean)).size };
  };
  const hubPage = (id, metaBy, rowsFor, aboutFor, resourceType) => {
    for (const lang of PAGE_LANGS) {
      const en = lang.code === "en", L = (zh, e) => (en ? e : zh), v = langVariant(id, lang), m = metaBy[lang.code];
      writeLangPage(id, lang, localizePage(renderQuiz(lang, {
        ...m, nav: "", ogImage: `${id}/og-image.png`,
        body: `<div class="table-scroll"><table class="hub-table"><tbody>${ORDER5.map((l) => rowsFor(l, L)).join("")}</tbody></table></div>`,
        about: aboutFor(L),
        schema: JSON.stringify([
          { "@context": "https://schema.org", "@type": "LearningResource", name: m.h1, description: m.desc, url: v.url, inLanguage: en ? "en" : "zh-Hans", educationalLevel: "JLPT N5–N1", isAccessibleForFree: true, learningResourceType: resourceType, about: { "@type": "Thing", name: "Japanese language" }, provider: { "@type": "Organization", name: "jpnotes.dev", url: SITE } },
          { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE }, { "@type": "ListItem", position: 2, name: m.crumb, item: v.url }] },
        ]).replace(/</g, "\\u003c"),
      }, v, "", null), lang, localizedPageIds));
    }
    quizPageIds.push(id);
    console.log(`  Generated dist/${id}/ (hub)`);
  };
  const faqFree = (L) => `<dt>${L("免费吗？要注册吗？", "Is it free? Do I need an account?")}</dt><dd>${L("完全免费，没有广告，不用注册。进度保存在这个浏览器里。", "It's free, with no ads and no sign-up. Progress stays in this browser.")}</dd>
<dt>${L("是真题吗？", "Are these past-paper questions?")}</dt><dd>${L("不是。题目全部原创，按各级别真题的题型和难度设计。", "No. Every question is original, written to each level's formats and difficulty.")}</dd>`;

  {
    const st = Object.fromEntries(ORDER5.map((l) => [l, subStats(l, "dokkai")]));
    const total = ORDER5.reduce((a, l) => a + st[l].passages, 0);
    hubPage("reading", {
      en: { title: "JLPT Reading Practice Online — Free N5 to N1 Passages with Translations", desc: `Free JLPT reading practice: ${total} original passages from N5 to N1 in every test format, with full translations and every option explained. No sign-up.`, h1: "JLPT Reading Practice", crumb: "Reading", lead: "Choose your level. Read, answer, then see why each option is right or wrong and read the full translation." },
      zh: { title: "JLPT 阅读练习 - N5 到 N1 免费在线阅读题，带全文翻译", desc: `免费 JLPT 阅读在线练习：N5 到 N1 共 ${total} 篇原创文章，覆盖全部阅读题型，带全文翻译和逐项解析，打开即用，无需注册。`, h1: "JLPT 阅读练习", crumb: "阅读", lead: "选择你的级别。读完作答，再看每个选项为什么对、为什么错，以及全文翻译。" },
    }, (level, L) => { const x = st[level], lv = level.toLowerCase(); return `<tr><th scope="row"><span class="level-tag">${level}</span></th>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-reading/"><b>${L("阅读练习", "Reading practice")}</b><span>${L(`${x.passages} 篇文章 · ${x.qs} 题`, `${x.passages} passages · ${x.qs} questions`)}</span></a></td>
      <td class="hub-types">${typeNames(x.types, L)}</td></tr>`; },
    (L) => `${tipsLink("jlpt-reading-tips", L, "阅读做题技巧：每篇花多少时间、先看题还是先看文章", "Reading tips: time per passage, and whether to read the question first")}<section class="quiz-about">
<h2>${L("这里能练什么", "What you get")}</h2>
<ul>
<li>${L(`${total} 篇原创文章，覆盖 N5 到 N1 的全部阅读题型：短文、中文、长文、综合理解、论点理解、信息检索。`, `${total} original passages covering every reading format from N5 to N1: short, mid-length and long passages, comparison, argument and information retrieval.`)}</li>
<li>${L("答完看每个选项的解析和全文翻译。", "After answering, every option is explained and the whole passage is translated.")}</li>
<li>${L("答错的题进错题本，过几天再练。", "Questions you miss come back in a review list a few days later.")}</li>
</ul>
<h2>${L("常见问题", "Questions")}</h2>
<dl>${faqFree(L)}
<dt>${L("阅读有最低分吗？", "Is there a minimum score for reading?")}</dt><dd>${L("N3 到 N1 的阅读单独计分，低于 19/60 即使总分过线也不合格；N4、N5 的阅读和文字词汇、语法合在一起计分。", "From N3 to N1 reading is scored on its own, and below 19/60 fails the test even with a passing total; at N4 and N5 it shares a score with vocabulary and grammar.")}</dd>
</dl>
</section>`, "Reading practice");
  }

  {
    const st = Object.fromEntries(ORDER5.map((l) => [l, subStats(l, "moji")]));
    const total = ORDER5.reduce((a, l) => a + st[l].qs, 0);
    hubPage("vocabulary", {
      en: { title: "JLPT Vocabulary Practice Online — Free N5 to N1 Kanji & Word Questions", desc: `Free JLPT vocabulary practice: ${total} exam-style questions from N5 to N1 on kanji readings, writing, word choice and usage, every option explained. No sign-up.`, h1: "JLPT Vocabulary Practice", crumb: "Vocabulary", lead: "Choose your level. Kanji readings, writing, word choice and usage, each with an explanation for every option." },
      zh: { title: "JLPT 词汇练习 - N5 到 N1 文字词汇在线做题，附解析", desc: `免费 JLPT 文字词汇在线练习：N5 到 N1 共 ${total} 道仿真题，覆盖汉字读音、汉字写法、选词和用法，每个选项都有解析，无需注册。`, h1: "JLPT 词汇练习", crumb: "词汇", lead: "选择你的级别。汉字读音、写法、选词、用法，每个选项都有解析。" },
    }, (level, L) => { const x = st[level], lv = level.toLowerCase(); return `<tr><th scope="row"><span class="level-tag">${level}</span></th>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-vocabulary/"><b>${L("词汇练习", "Vocabulary practice")}</b><span>${L(`${x.qs} 题 · ${x.types.length} 种题型`, `${x.qs} questions · ${x.types.length} types`)}</span></a></td>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-cards/"><b>${L("语法卡片", "Grammar flashcards")}</b><span>${L("每个语法点一张", "one per grammar point")}</span></a></td></tr>`; },
    (L) => `${tipsLink("jlpt-vocabulary-grammar-tips", L, "文字词汇与语法做题技巧：读音陷阱、用法题、排序题★", "Vocabulary & grammar tips: reading traps, usage items, sentence order ★")}<section class="quiz-about">
<h2>${L("这里能练什么", "What you get")}</h2>
<ul>
<li>${L(`${total} 道原创文字词汇题，题型和真考一致：汉字读音、汉字写法、构词、选词填空、近义替换、用法。`, `${total} original vocabulary questions in the real test's item types: kanji reading, writing, word formation, word in context, paraphrase and usage.`)}</li>
<li>${L("和真考一样，题目不标振假名。答完看每个选项为什么对、为什么错。", "As on the real test, no furigana on the questions. After answering, see why each option is right or wrong.")}</li>
<li>${L("语法题在各级别的「练习题」里；语法卡片按课复习每个语法点。", "Grammar questions are in each level's practice page; the flashcards drill every grammar point by lesson.")}</li>
</ul>
<h2>${L("常见问题", "Questions")}</h2>
<dl>${faqFree(L)}</dl>
</section>`, "Practice questions");
  }

  {
    const withMock = ORDER5.filter((l) => quizBundles[l].mocks.length);
    if (withMock.length) hubPage("mock-test", {
      en: { title: "JLPT Mock Test Online — Free Timed N5 to N1 Practice Tests with Scores", desc: "Free timed JLPT mock tests from N5 to N1 in the real format, listening included: an estimated score against the pass marks and every question explained. No sign-up.", h1: "JLPT Mock Tests", crumb: "Mock tests", lead: "A full test in the real order and timing. No answers until you submit; then an estimated score per section against the pass marks." },
      zh: { title: "JLPT 模拟题在线测试 - N5 到 N1 免费计时模考，交卷估分", desc: "免费 JLPT 在线模拟考：N5 到 N1，按真题结构和时间计时，含听力，交卷后估算分数、对照合格线，每道题都有解析，无需注册。", h1: "JLPT 模拟题", crumb: "模拟题", lead: "按真考的顺序和时间完整做一套。交卷前不显示答案；交卷后按科目估分，对照合格线。" },
    }, (level, L) => { const b = quizBundles[level], lv = level.toLowerCase(), cfg = QUIZ_MOCK[level];
      if (!b.mocks.length) return `<tr class="hub-soon"><th scope="row"><span class="level-tag">${level}</span></th><td colspan="2">${L("准备中", "Coming soon")}</td></tr>`;
      const minutes = b.mocks[0].test.sections.reduce((a, x) => a + x.minutes, 0);
      return `<tr><th scope="row"><span class="level-tag">${level}</span></th>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-mock-test/"><b>${L("模拟题", "Mock test")}</b><span>${L(`${b.mocks.length} 套 · ${minutes} 分钟`, `${b.mocks.length} test${b.mocks.length > 1 ? "s" : ""} · ${minutes} min`)}</span></a></td>
      <td class="hub-types">${L(`合格线 ${cfg.pass}/180`, `Pass mark ${cfg.pass}/180`)}</td></tr>`; },
    (L) => `<section class="quiz-about">
<h2>${L("模拟题和练习题有什么不同", "How a mock test differs from practice")}</h2>
<ul>
<li>${L("题目不在练习题库里，按真考的科目顺序出题，每一科单独计时，听力在最后一场。", "The questions aren't in the practice bank. Sections come in the real order, each timed on its own, with listening last.")}</li>
<li>${L("交卷后才显示答案：估算各科得分，对照总分合格线和每科最低分，再逐题看解析。", "Answers appear only after you submit: an estimated score per section against the pass mark and each section's minimum, then every question explained.")}</li>
<li>${L("新的一套审完、录好音后会加在这里。", "New sets are added here once they have been reviewed and recorded.")}</li>
</ul>
<h2>${L("考前怎么用", "How to use them before the exam")}</h2>
<ol>
<li>${L("先用练习题按题型把薄弱的地方补上，再做模拟题。", "Shore up weak item types in practice first, then take a mock.")}</li>
<li>${L("一次做完整套，不暂停、不查词典，练时间分配。", "Do a whole set in one go, without pausing or a dictionary, to practise timing.")}</li>
<li>${L("交卷后看哪一科离最低分最近，回去专练那一科。", "After submitting, see which section is closest to its minimum and practise that.")}</li>
</ol>
<p>${L(`各部分的做题技巧：<a href="${SITE_PATH}jlpt-vocabulary-grammar-tips/">文字词汇与语法</a> · <a href="${SITE_PATH}jlpt-reading-tips/">阅读</a> · <a href="${SITE_PATH}jlpt-listening-tips/">听力</a>。考试安排：<a href="${SITE_PATH}jlpt-december-2026/">12 月 JLPT 考前指南</a>。`, `Tips for each part: <a href="${SITE_PATH}jlpt-vocabulary-grammar-tips/">vocabulary &amp; grammar</a> · <a href="${SITE_PATH}jlpt-reading-tips/">reading</a> · <a href="${SITE_PATH}jlpt-listening-tips/">listening</a>. Exam day: <a href="${SITE_PATH}jlpt-december-2026/">December JLPT guide</a>.`)}</p>
<h2>${L("常见问题", "Questions")}</h2>
<dl>${faqFree(L)}
<dt>${L("估分准吗？", "How accurate is the score?")}</dt><dd>${L("只是粗略估计。真考用等化计分，不是按答对题数直接换算。", "It's a rough estimate. The real test uses scaled scoring, not a straight count of correct answers.")}</dd>
</dl>
</section>`, "Practice test");
  }

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
  const homeMod = gitLastModTime("build.js") || today;  // the home page is generated by build.js
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

> jpnotes.dev is a free site for learning Japanese grammar for the JLPT, N5 to N1: ${totalLessons} lessons and ${totalPoints}+ grammar points, each with how it attaches, what it means, example sentences with furigana and audio, and how it differs from look-alike patterns — plus practice questions, timed mock tests and grammar flashcards. English pages at ${SITE}; Chinese copies of each page under ${SITE}zh/ (for example ${SITE}zh/practice/ or ${SITE}zh/n2-listening/).

Key facts:
- Free, no ads, no sign-up; progress (review checklists, practice history) stays in the browser.
- Lessons: N5 (lessons 0–17), N4 (18–34), N3 (35–58), N2 (59–75), N1 (76–92). Every example sentence has furigana and a 🔊 recording.
- Practice: ${Object.entries(quizBundles).map(([l, b]) => `${l} ${b.practice.questions.length}`).join(", ")} exam-style questions covering every JLPT item type, listening included, each option explained; a review list brings back missed questions. Timed full mock tests (${Object.entries(quizBundles).map(([l, b]) => `${l} ${b.mocks.length}`).join(", ")}), structured like the real test, with an estimated score against the pass marks. Listening questions (recording, then a transcript with translation): ${ckLevels.length ? ckLevels.join(", ") + " so far" : "not built yet"}.
- Ask AI: a side panel on every lesson and after every practice question answers questions about that page; free without setup, or with the reader's own API key (kept in the browser).
- Anki decks (.apkg with audio, and TSV) per level at ${SITE}anki/.

Site: ${SITE}
Author: Ralphbupt (https://github.com/Ralphbupt)
License: content CC BY-NC 4.0 (attribution, non-commercial); code MIT

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
- [N4 grammar list / N4 文法チェックリスト](${SITE}N4_grammar_list/): All ~79 N4 grammar points (excluding N5 overlap).
- [N3 grammar list / N3 文法チェックリスト](${SITE}N3_grammar_list/): All 120+ N3 grammar points.
- [N2 grammar list / N2 文法チェックリスト](${SITE}N2_grammar_list/): All ~130 N2 grammar points.${levelCounts.N1 ? `
- [N1 grammar list / N1 文法チェックリスト](${SITE}N1_grammar_list/): All ~100 N1 grammar points.` : ""}

## Practice, mock tests and flashcards

- [Practice hub](${SITE}practice/): Every level's practice questions, mock test and flashcards.
- [JLPT listening practice](${SITE}listening/): Free N5 to N1 listening questions with audio, transcripts and explanations.
- [JLPT reading practice](${SITE}reading/): Free N5 to N1 reading passages with translations and explanations.
- [JLPT vocabulary practice](${SITE}vocabulary/): Free N5 to N1 kanji and vocabulary questions with explanations.
- [JLPT mock tests](${SITE}mock-test/): Free timed N5 to N1 mock tests with estimated scores.
${Object.entries(quizBundles).map(([l, b]) => { const v = l.toLowerCase(); return `- [JLPT ${l} practice questions](${SITE}${v}-practice/): ${b.practice.questions.length} questions by item type, with explanations.${SUBSET_PAGES.filter((p) => p.levels.includes(l)).map((p) => `\n- [JLPT ${l} ${p.id} practice](${SITE}${v}-${p.id}/): ${p.id} questions only, with explanations.`).join("")}${ckLevels.includes(l) ? `\n- [JLPT ${l} listening practice](${SITE}${v}-listening/): listening questions with audio, transcripts and explanations.` : ""}${b.mocks.length ? `\n- [JLPT ${l} mock test](${SITE}${v}-mock-test/): timed, real format, estimated score.` : ""}\n- [JLPT ${l} grammar flashcards](${SITE}${v}-cards/): one card per grammar point, spaced repetition.`; }).join("\n")}

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
    name: "jpnotes – JLPT N5→N1",
    short_name: "jpnotes",
    start_url: SITE_PATH,
    scope: SITE_PATH,
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#1a1a2e",
    icons: [
      { src: `${SITE_PATH}favicon-192.png`, sizes: "192x192", type: "image/png" }
    ]
  }, null, 2), "utf-8");

  // 404: first try to fix the URL (AI tools and people type /n2/ for /N2/, or
  // /zh/ for the Chinese home), then offer the pages readers actually look for.
  fs.writeFileSync(path.join(__dirname, "dist/404.html"), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Page not found – jpnotes.dev</title>
<script>
(function() {
  var p = location.pathname, q = location.search + location.hash;
  if (/^\/zh\/?$/.test(p)) {
    try { var pr = JSON.parse(localStorage.getItem('jp_grammar_prefs')) || {}; pr.isEn = false; localStorage.setItem('jp_grammar_prefs', JSON.stringify(pr)); } catch (e) {}
    return location.replace('${SITE_PATH}' + q);
  }
  // Level overviews are /N1/…/N5/ (also under /zh/); every other path is lower case.
  var fixed = p.toLowerCase().replace(/^(\/zh)?\/n([1-5])(\/|$)/, '$1/N$2$3');
  if (!/\/$/.test(fixed) && !/\.[a-z0-9]+$/.test(fixed)) fixed += '/';
  if (fixed !== p) location.replace(fixed + q);
})();
</script>
<style>
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 0 16px; background: #fafaf8; color: #333; }
  @media (prefers-color-scheme: dark) { body { background: #16161d; color: #ddd; } }
  .box { text-align: center; max-width: 30rem; }
  h1 { font-size: 3.5rem; margin: 0; }
  p { font-size: 1.1rem; margin: .8rem 0; }
  ul { list-style: none; padding: 0; margin: 1.2rem 0 0; line-height: 2; }
  a { color: #c0303f; text-decoration: none; }
  @media (prefers-color-scheme: dark) { a { color: #e94560; } }
</style>
</head>
<body>
<div class="box">
  <h1>404</h1>
  <p>Page not found · 页面不存在</p>
  <ul>
    <li><a href="${SITE_PATH}practice/">JLPT practice questions · 练习题</a></li>
    <li><a href="${SITE_PATH}listening/">Listening practice · 听力练习</a></li>
    <li><a href="${SITE_PATH}">Home · 首页</a></li>
  </ul>
</div>
</body>
</html>`, "utf-8");

  // ─── OG Image (SVG → PNG via sharp) ───
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f6f4ef"/>
      <stop offset="100%" style="stop-color:#ece8de"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="#b8283f" stroke-width="2" opacity="0.3"/>
  <text x="600" y="220" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="96" fill="#1a1a2e" font-weight="bold">jpnotes.dev</text>
  <text x="600" y="320" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="42" fill="#4a4740">JLPT grammar &amp; practice</text>
  <text x="600" y="400" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="36" fill="#b8283f">N5 → N4 → N3 → N2 → N1</text>
  <text x="600" y="470" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="24" fill="#605c55">Free · Bilingual · N5 → N1 · Audio</text>
  <text x="600" y="550" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="20" fill="#605c55">${SITE_HOST}</text>
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
      <stop offset="0%" style="stop-color:#f6f4ef"/>
      <stop offset="100%" style="stop-color:#ece8de"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="#b8283f" stroke-width="2" opacity="0.3"/>
  <text x="600" y="180" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="48" fill="#b8283f" font-weight="bold">JLPT ${level}</text>
  <text x="600" y="310" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="64" fill="#1a1a2e" font-weight="bold">${escJaTitle}</text>
  <text x="600" y="430" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="32" fill="#4a4740">JLPT grammar &amp; practice</text>
  <text x="600" y="550" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="20" fill="#605c55">${SITE_HOST}</text>
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
    { slug: "N5", topLabel: "JLPT N5", mainTitle: "N5 文法チェックリスト", sub: `${ogLevelCounts.N5} 课 · 53+ 语法点`, accent: "#b8283f" },
    { slug: "N4", topLabel: "JLPT N4", mainTitle: "N4 文法チェックリスト", sub: `${ogLevelCounts.N4} 课 · 54+ 语法点`, accent: "#b8283f" },
    { slug: "N3", topLabel: "JLPT N3", mainTitle: "N3 文法チェックリスト", sub: `${ogLevelCounts.N3} 课 · 100+ 语法点`, accent: "#b8283f" },
    { slug: "N2", topLabel: "JLPT N2", mainTitle: "N2 文法チェックリスト", sub: `${ogLevelCounts.N2} 课 · 75+ 语法点`, accent: "#b8283f" },
    ...(ogLevelCounts.N1 ? [{ slug: "N1", topLabel: "JLPT N1", mainTitle: "N1 文法チェックリスト", sub: `${ogLevelCounts.N1} 课 · 100+ 语法点`, accent: "#b8283f" }] : []),
    { slug: "about", topLabel: "About · 关于", mainTitle: "jpnotes.dev", sub: "N5 → N1 · Free · Bilingual", accent: "#b8283f" },
    { slug: "anki", topLabel: "Anki Decks", mainTitle: "JLPT 文法 卡组", sub: "N5 · N4 · N3 · N2 · N1", accent: "#b8283f" },
    { slug: "practice", topLabel: "JLPT Practice · 做题", mainTitle: "JLPT 練習問題", sub: "N5 → N1 · Listening · Mock tests · Free", accent: "#b8283f" },
    { slug: "listening", topLabel: "JLPT Listening · 听力", mainTitle: "JLPT 聴解練習", sub: "N5 → N1 · 650+ questions · Transcripts", accent: "#b8283f" },
    { slug: "reading", topLabel: "JLPT Reading · 阅读", mainTitle: "JLPT 読解練習", sub: "N5 → N1 · Every format · Translations", accent: "#b8283f" },
    { slug: "vocabulary", topLabel: "JLPT Vocabulary · 词汇", mainTitle: "JLPT 文字・語彙", sub: "N5 → N1 · Kanji · Words · Usage", accent: "#b8283f" },
    { slug: "mock-test", topLabel: "JLPT Mock Tests · 模拟题", mainTitle: "JLPT 模擬試験", sub: "N5 → N1 · Timed · Estimated score", accent: "#b8283f" },
    { slug: "guides", topLabel: "Guides · 专题", mainTitle: "易混語法 対比", sub: "は vs が · から vs ので · JLPT 12月", accent: "#b8283f" },
  ];
  for (const p of indexOgPages) {
    const dir = path.join(__dirname, "dist", p.slug);
    fs.mkdirSync(dir, { recursive: true });
    const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f6f4ef"/>
      <stop offset="100%" style="stop-color:#ece8de"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="${p.accent}" stroke-width="2" opacity="0.3"/>
  <text x="600" y="200" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="48" fill="${p.accent}" font-weight="bold">${esc(p.topLabel)}</text>
  <text x="600" y="330" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="80" fill="#1a1a2e" font-weight="bold">${esc(p.mainTitle)}</text>
  <text x="600" y="430" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="32" fill="#4a4740">${esc(p.sub)}</text>
  <text x="600" y="550" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans CJK SC, sans-serif" font-size="20" fill="#605c55">${SITE_HOST}</text>
</svg>`;
    await sharp(Buffer.from(svg))
      .resize(1200, 630)
      .png()
      .toFile(path.join(dir, "og-image.png"));
  }
  console.log(`  Generated ${indexOgPages.length} index-page OG images (N5/N4/N3/N2/about/anki)`);

  // Cloudflare (worker/wrangler.site.toml serves dist/ as static assets) reads
  // these two files and does not publish them.
  // _redirects, answered before any file is looked up:
  //   - the old /dayNN/ addresses as real 301s (the meta-refresh stubs above
  //     only matter on hosts without redirect rules, i.e. the mirror);
  //   - every page without its trailing slash, as a 301 like GitHub Pages gave
  //     (Cloudflare's own redirect for that is a temporary 307).
  // _headers: nothing may be sniffed as another type, and the Anki packages
  // (an extension Cloudflare has no type for) download as files. Caching stays
  // at Cloudflare's default, revalidating with an ETag on every request, which
  // is always fresh; long-lived caching of ?v= files is the service worker's job.
  {
    const dist = path.join(__dirname, "dist"), rules = [], moved = new Set(Object.keys(DAY_TO_LESSON));
    for (const [oldId, newId] of Object.entries(DAY_TO_LESSON)) rules.push(`/${oldId} /${newId}/ 301`, `/${oldId}/ /${newId}/ 301`);
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(dist, rel), { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const sub = rel ? `${rel}/${e.name}` : e.name;
        if (!moved.has(sub) && fs.existsSync(path.join(dist, sub, "index.html"))) rules.push(`/${sub} /${sub}/ 301`);
        walk(sub);
      }
    };
    walk("");
    if (!rules.includes("/anki /anki/ 301")) rules.push("/anki /anki/ 301");   // written later, by build-anki.js
    // The home page is one bilingual page at /; there is no /zh/ copy of it, but
    // people trim a /zh/… address down to /zh/ and should not land on the 404.
    rules.push("/zh / 302", "/zh/ / 302");
    if (rules.length > 2000) throw new Error(`_redirects: ${rules.length} rules, Cloudflare allows 2,000 static ones`);
    fs.writeFileSync(path.join(dist, "_redirects"), rules.join("\n") + "\n", "utf-8");
    fs.writeFileSync(path.join(dist, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n\n/anki/*.apkg\n  Content-Type: application/octet-stream\n  Content-Disposition: attachment\n", "utf-8");
    console.log(`  Generated dist/_redirects (${rules.length} rules), dist/_headers`);
  }
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
  /* Red is the teacher's pen: the grammar point being taught, right/wrong
     marks, the seal. Everything you can click is ink instead: blue-black,
     the fountain-pen colour, with --ui-on for text set on it. */
  --ui: #1f3d63;
  --ui-on: #ffffff;
  --ui-soft: rgba(31,61,99,.10);
  --card-bg: #fbfaf7;
  --border: #e3dfd5;
  /* Furigana is a reading aid, not emphasis: muted, so red stays on the
     grammar point itself. */
  --ruby-color: var(--text-muted);
  --link: var(--ui);
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
  --shadow-hover: 0 4px 18px rgba(31,61,99,.14);

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
  --ui: #2a3f5f;
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
  outline: 2px solid var(--ui);
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
  color: var(--ui);
  background: var(--ui-soft);
}
body.ai-open #ai-btn {
  color: var(--ui);
  background: var(--ui-soft);
  filter: drop-shadow(0 0 3px var(--ui));
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
.nav-group:hover { color: var(--ui); }
.nav-caret { font-size: .65rem; opacity: .75; transition: transform var(--transition); }
.nav-group-wrap.expanded .nav-caret { transform: rotate(90deg); }
.nav-group-items { display: none; }
.nav-group-wrap.expanded .nav-group-items { display: block; }
/* Overview entries: italic in English only — CJK fonts have no italic, the browser just slants them */
.nav-overview .lang-en { font-style: italic; }
.nav-overview.active .lang-en, .nav-overview:hover .lang-en { font-style: normal; }
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
  color: var(--sidebar-hover-text); background: var(--ui-soft);
  border-left-color: var(--ui);
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
h1 { font-size: var(--text-2xl); line-height: 1.35; margin: 0 0 1.1rem; color: var(--text-strong); }
/* Prose keeps to about 42 characters a line; tables and diagrams may run the full column. */
.lesson > p, .lesson > ul, .lesson > ol, .lesson > blockquote, .lesson > h2, .lesson > h3, .lesson > h4 { max-width: 42em; }
h2 { font-size: var(--text-xl); margin: 2.2rem 0 .9rem; color: var(--text-strong); }
/* Arriving from a practice question's 📖 link: the grammar point clears the
   phone top bar and flashes once so the eye finds it. */
h2[id], h3[id] { scroll-margin-top: 4.5rem; }
h2:target { animation: target-flash 2.4s ease-out; border-radius: 4px; }
@keyframes target-flash { 0%, 30% { background: color-mix(in srgb, var(--ui) 18%, transparent); } 100% { background: transparent; } }
@media (prefers-reduced-motion: reduce) { h2:target { animation: none; background: color-mix(in srgb, var(--ui) 12%, transparent); } }
h3 { font-size: var(--text-lg); margin: 1.6rem 0 .6rem; }
h4 { font-size: var(--text-md); margin: 1.3rem 0 .5rem; }
p { margin: .6rem 0; }
ul, ol { margin: .5rem 0 .5rem 1.5rem; }
li { margin: .2rem 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
/* A note in the margin: quiet, so the red in the examples around it keeps its meaning */
blockquote {
  border-left: 3px solid var(--word-border);
  background: var(--card-bg);
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
table.word-table td { padding-top: .3rem; padding-bottom: .3rem; vertical-align: top; }
table.word-table td:first-child { font-size: 1.1rem; font-weight: 500; white-space: nowrap; }
table.word-table td:nth-child(2) { color: var(--text-muted); }
table.word-table .pos { font-size: .75em; color: var(--text-muted); border: 1px solid currentColor; border-radius: 3px; padding: 0 .3em; white-space: nowrap; }
table.word-table .gloss-note { display: block; font-size: .85em; color: var(--text-muted); margin-top: .15em; }
table.word-table .collocs { display: block; margin-top: .25em; }
table.word-table .colloc { display: block; font-size: .85em; color: var(--text-muted); line-height: 1.7; }
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
  height: 100%; background: var(--ui); border-radius: var(--radius-sm); transition: width .3s;
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
ul:has(input[type="checkbox"]) li.checked input[type="checkbox"] { accent-color: var(--ui); }
input[type="checkbox"] {
  width: 1.1em; height: 1.1em; margin-right: .5em; cursor: pointer;
  vertical-align: middle; accent-color: var(--ui);
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
.seo-lead { font-size: 1rem; color: var(--text-muted); margin: 0 0 1.6rem; line-height: 1.75; max-width: 42em; }
.seo-lead strong { color: var(--text-strong); font-weight: 600; }

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
.speak-btn:hover { opacity: 1; border-color: var(--ui); }
.speak-btn.playing { opacity: 1; border-color: var(--ui); }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .speak-btn { border-color: #3a3a55; }
  :root:not(.theme-light) .speak-btn:hover { border-color: var(--ui); }
}
html.theme-dark .speak-btn { border-color: #3a3a55; }
html.theme-dark .speak-btn:hover { border-color: var(--ui); }

/* Cross-links */
.related-grammar {
  background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: .6rem 1rem; margin: 1.5rem 0; font-size: .85rem;
}
.related-label { font-weight: 600; color: var(--text-muted); margin-right: .5rem; }
.quiz-link { margin: 1.4rem 0 .4rem; }
.level-note { margin: .2rem 0 1rem; font-size: .9em; color: var(--text-muted); }
.quiz-cta { margin: 2rem 0 1rem; padding: 1rem 1.2rem; border: 1px solid var(--ui); border-radius: var(--radius-lg); background: rgba(127,127,127,.07); }
.quiz-cta p { margin: 0 0 .7rem; }
.quiz-cta a { display: inline-block; padding: .45em 1.2em; border-radius: 999px; background: var(--ui); color: var(--ui-on); text-decoration: none; font-weight: 700; }
.quiz-cta a:hover { filter: brightness(1.1); }
.nav-hub { margin: .2rem .6rem .6rem; font-weight: 600; }
.quiz-link a, .ov-quiz a { display: inline-block; padding: .35em .95em; border: 1px solid var(--ui); border-radius: 999px; color: var(--ui); text-decoration: none; font-size: .92em; }
.quiz-link a:hover, .ov-quiz a:hover { background: var(--ui); color: var(--ui-on); }
.ov-quiz { display: flex; flex-wrap: wrap; gap: .5rem; margin: .8rem 0 1.2rem; }
.jp-progress { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem 1rem; margin: 1rem 0; padding: .7rem 1rem; border: 1px solid var(--border); border-left: 3px solid var(--ui); border-radius: var(--radius); font-size: .92rem; color: var(--text-muted); }
.jp-progress[hidden] { display: none; }
.jp-progress a { color: var(--text-muted); }
.jp-progress .jp-prog-go { color: var(--link); font-weight: 700; text-decoration: none; }
.jp-progress .jp-prog-go:hover { text-decoration: underline; }
.cross-link {
  display: inline-block; background: var(--chip-bg); color: var(--chip-text);
  padding: .15rem .55rem; border-radius: var(--radius-sm); margin: .15rem .2rem;
  text-decoration: none; font-size: .82rem;
  line-height: 1.5;
}
.cross-link:hover { background: var(--ui); color: var(--ui-on); }
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

summary::marker { color: var(--ui); }
summary:hover { color: var(--link); }

/* Page footer */
.site-footer {
  margin-top: 3rem; padding-top: 1.2rem;
  border-top: 1px solid var(--border);
  text-align: center; font-size: .8rem; color: var(--text-muted);
}
.site-footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: .3rem 1.2rem; }
.site-footer a { color: inherit; text-decoration: none; white-space: nowrap; }
.site-footer a:hover { color: var(--ui); }
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
  body.ai-open .m-btn[data-m="ai"] { color: var(--ui); }
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
  display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: 2.6rem; align-items: center;
  padding: 2.2rem 0 2.4rem; border-bottom: 1px solid var(--border); margin-bottom: 2.2rem;
}
.home-hero h1 { font-size: 1.75rem; line-height: 1.35; margin: 0 0 .9rem; border: none; padding: 0; color: var(--text-strong); }
.home-intro { font-size: .98rem; color: var(--text-muted); margin: 0 0 1.4rem; line-height: 1.75; }
.home-intro strong { color: var(--text-strong); font-weight: 600; }
.home-actions { display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; }
.home-actions a { display: inline-block; padding: .55rem 1.25rem; border-radius: var(--radius); font-size: .95rem; font-weight: 600; text-decoration: none; border: 1px solid transparent; }
.home-actions .btn-primary { background: var(--ui); border-color: var(--ui); color: var(--ui-on); }
.home-actions .btn-primary:hover { opacity: .9; }
.home-actions .btn-secondary { border-color: var(--border); color: var(--text-strong); }
.home-actions .btn-secondary:hover { border-color: var(--ui); }
.home-actions .btn-quiet { padding-left: .4rem; padding-right: .4rem; color: var(--link); font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
/* The sentence, on ruled paper, marked in red pen */
.hero-note { margin: 0; padding: 1.1rem 1.5rem 1.2rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card-bg); }
.hero-ja, .hero-tr { margin: 0; background-image: linear-gradient(to bottom, transparent calc(100% - 1px), var(--border) calc(100% - 1px)); background-repeat: repeat-y; }
.hero-ja { font-family: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", "Source Han Serif JP", serif; font-size: 1.45rem; line-height: 3.1rem; background-size: 100% 3.1rem; color: var(--text-strong); }
.hero-ja rt { font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; font-size: .42em; }
.hero-ja strong { color: var(--accent); font-weight: 700; text-decoration: underline wavy var(--accent); text-decoration-thickness: 1.5px; text-underline-offset: .3em; }
.hero-tr { font-size: .95rem; line-height: 2.3rem; background-size: 100% 2.3rem; color: var(--text-muted); }
.hero-note figcaption { margin-top: .9rem; font-size: .88rem; line-height: 1.65; color: var(--text); }
.hero-note figcaption b { color: var(--accent); margin-right: .5em; font-size: 1.05em; }
@media (max-width: 860px) {
  .home-hero { grid-template-columns: 1fr; gap: 1.4rem; padding: 1rem 0 1.6rem; margin-bottom: 1.6rem; }
  .home-hero h1 { font-size: 1.4rem; }
  .home-intro { font-size: .92rem; margin-bottom: 1.1rem; }
  .hero-note { padding: .8rem 1.1rem 1rem; }
  .hero-ja { font-size: 1.18rem; line-height: 2.7rem; background-size: 100% 2.7rem; }
  table.practice-index { font-size: .86rem; table-layout: fixed; width: 100%; }
  table.practice-index th, table.practice-index td { padding: .55rem .15rem; }
  table.practice-index thead th { font-size: .68rem; }
  table.practice-index tbody th, table.practice-index thead th:first-child { width: 2.9rem; }
}
/* Phones, every page: the top bar already says where you are */
@media (max-width: 768px) {
  h1 { font-size: 1.45rem; margin-bottom: .8rem; }
  h2 { font-size: 1.25rem; margin-top: 1.8rem; }
  .breadcrumb, .prev-next-top { display: none !important; }
  .seo-lead { font-size: .95rem; margin-bottom: 1.2rem; }
  table.word-table { font-size: .85rem; }
  table.word-table td:first-child { font-size: 1rem; }
  table.word-table td:nth-child(2) { white-space: nowrap; font-size: .8rem; }
  table.word-table th, table.word-table td { padding-left: .45rem; padding-right: .45rem; }
}
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.home-practice h2 { font-size: 1.35rem; margin: 0 0 .5rem; color: var(--text-strong); }
.home-practice-lead { color: var(--text-muted); margin: 0 0 1rem; line-height: 1.7; max-width: 46em; }
/* Practice as the contents page of a workbook: levels down, kinds across */
table.practice-index { margin: 0 0 2.4rem; font-size: .92rem; border: 0; }
table.practice-index th, table.practice-index td { border: 0; border-bottom: 1px solid var(--border); padding: .6rem .8rem; background: none !important; text-align: left; white-space: nowrap; }
table.practice-index thead th { font-size: .8rem; font-weight: 500; color: var(--text-muted); border-bottom-color: var(--text-muted); }
table.practice-index tbody th { width: 1%; padding-left: 0; }
table.practice-index .num { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-muted); }
table.practice-index td a { text-decoration: none; font-weight: 500; }
table.practice-index td a:hover { text-decoration: underline; text-underline-offset: 3px; }
table.practice-index td.none { color: var(--text-subtle); }
table.practice-index .level-tag { margin: 0; }
table.practice-index tbody tr:hover td, table.practice-index tbody tr:hover th { background: var(--ui-soft) !important; }
.home-levels h2, .home-howto h2 {
  font-size: 1.35rem; margin: 2rem 0 1rem; color: var(--text-strong);
}
/* Levels: the next page of the same index, a line each */
.level-grid { display: grid; grid-template-columns: 1fr; margin: .6rem 0 2.4rem; border-top: 1px solid var(--text-muted); }
.level-card { display: grid; grid-template-columns: 10.5rem 1fr; gap: .1rem 1.2rem; align-items: baseline; padding: 1rem .2rem; border-bottom: 1px solid var(--border); text-decoration: none; color: inherit; }
.level-card:hover { background: var(--ui-soft); }
.level-card:hover h3 { text-decoration: underline; text-underline-offset: 3px; }
.level-head { grid-row: 1 / span 2; display: flex; align-items: center; gap: .6rem; }
.level-head .level-tag { margin-bottom: 0; }
.level-range { font-size: .8rem; color: var(--text-muted); white-space: nowrap; }
@media (max-width: 640px) {
  .level-card { grid-template-columns: 1fr; }
  .level-head { grid-row: auto; margin-bottom: .2rem; }
}
/* The seal: a level, stamped in vermilion. The one loud mark on a page. */
.level-tag, .seal-mark {
  display: inline-block; border: 1.5px solid var(--accent); color: var(--accent); background: none;
  border-radius: 3px; font-weight: 700; line-height: 1;
}
.level-tag { padding: .22rem .42rem .2rem; font-size: .8rem; letter-spacing: .04em; margin-bottom: .9rem; }
.seal-mark {
  writing-mode: vertical-rl; margin-right: .55rem; padding: .22rem .16rem; font-size: .62rem; letter-spacing: .08em; vertical-align: -.5em;
  font-family: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", serif;
}
.ico { width: 1em; height: 1em; vertical-align: -.13em; margin-right: .35em; color: var(--text-muted); flex: none; }

.level-card h3 { font-size: 1.05rem; margin: 0; color: var(--link); }
.level-card p { font-size: .9rem; color: var(--text-muted); line-height: 1.6; margin: 0; }
.home-howto p {
  color: var(--text-muted); line-height: 1.75;
  margin: .6rem 0;
}
.home-howto a {
  color: var(--ui); text-decoration: underline;
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
    --ui: #a9c7ee; --ui-on: #10131c; --ui-soft: rgba(169,199,238,.14);
    --link: #a9c7ee;
    --selection-bg: #3b6fd6;
    --selection-fg: #fff;
  }
  /* Accent-colored strong text fails 4.5:1 on dark card surfaces; brighten. */
  :root:not(.theme-light) .seo-lead strong, :root:not(.theme-light) .home-intro strong { color: var(--text-strong); }
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
  :root:not(.theme-light) .seo-lead { color: #b4b4c2; }
  :root:not(.theme-light) .lesson-meta { color: #a8a8b8; }
  :root:not(.theme-light) .lesson-meta time { color: #b8b8c4; }
  :root:not(.theme-light) .related-grammar { background: #1b1b28; border-color: var(--border); }
  :root:not(.theme-light) .cross-link { background: #25253a; color: #e4e4ec; }
  :root:not(.theme-light) .cross-link:hover { background: var(--ui); color: var(--ui-on); }
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
    --ui: #a9c7ee; --ui-on: #10131c; --ui-soft: rgba(169,199,238,.14);
    --link: #a9c7ee;
    --selection-bg: #3b6fd6;
    --selection-fg: #fff;
  }
/* Accent-colored strong text fails 4.5:1 on dark card surfaces; brighten. */
html.theme-dark .seo-lead strong, html.theme-dark .home-intro strong { color: var(--text-strong); }
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
html.theme-dark .seo-lead { color: #b4b4c2; }
html.theme-dark .lesson-meta { color: #a8a8b8; }
html.theme-dark .lesson-meta time { color: #b8b8c4; }
html.theme-dark .related-grammar { background: #1b1b28; border-color: var(--border); }
html.theme-dark .cross-link { background: #25253a; color: #e4e4ec; }
html.theme-dark .cross-link:hover { background: var(--ui); color: var(--ui-on); }
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
#search-results a.sel, #search-results a:hover { background: var(--ui); color: var(--ui-on); }
#search-results a.sel .sr-lvl, #search-results a:hover .sr-lvl { background: rgba(255,255,255,.25); }
.sr-lvl { flex-shrink: 0; font-size: .7rem; font-weight: 700; background: var(--ui); color: var(--ui-on); padding: .1rem .4rem; border-radius: var(--radius-sm); }
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
.tc-pill:hover { border-color: var(--ui); }
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
.theme-choice:hover { border-color: var(--ui); }
.theme-choice[aria-checked="true"] { border-color: var(--ui); box-shadow: 0 0 0 1px var(--ui); }
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
#theme-menu .theme-choice[aria-checked="true"] { border-color: var(--ui); box-shadow: none; }
.tc-lang { font-weight: 700; }
/* Share menu (settings-modal.js jpShare): copy link + a few networks; on
   touch devices the system share sheet is used instead. */
#share-menu { position: fixed; z-index: 1100; min-width: 11rem; background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); padding: .35rem; display: flex; flex-direction: column; }
#share-menu button, #share-menu a { display: block; text-align: left; padding: .45rem .7rem; border-radius: var(--radius); font: inherit; font-size: .88rem; color: inherit; background: none; border: 0; cursor: pointer; text-decoration: none; }
#share-menu button:hover, #share-menu a:hover { background: rgba(127,127,127,.16); }
#share-menu .sm-ok { color: var(--ui); }
#share-menu .sm-hint { font-size: .8rem; color: var(--text-muted); padding: .45rem .7rem; max-width: 15rem; line-height: 1.5; }
#share-menu .sm-qr { width: 13rem; margin: .5rem auto .2rem; padding: .4rem; background: #fff; border-radius: var(--radius); }
#share-menu .sm-qr svg { display: block; width: 100%; height: auto; }
#share-menu .sm-manual { font: inherit; font-size: .8rem; margin: .3rem; padding: .3rem; width: 15rem; }
body.ai-open #tc-ai { border-color: var(--ui); box-shadow: 0 0 0 2px var(--ui-soft); }
@media (min-width: 769px) { .nav-tool-extra { display: none; } }
@media (max-width: 768px) { #top-controls { display: none; } }

/* Settings modal */
#settings-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.45); display: flex; align-items: flex-start; justify-content: center; padding: 10vh 1rem 1rem; }
#settings-overlay[hidden] { display: none; }
#settings-box { width: 100%; max-width: 500px; max-height: 84vh; overflow-y: auto; background: var(--card-bg); color: inherit; border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: 1.1rem 1.2rem 1.1rem; }
.settings-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .9rem; }
.settings-head h2 { margin: 0; font-size: 1.15rem; border: none; padding: 0; color: var(--text-strong); }
.settings-x { flex: none; width: 2rem; height: 2rem; border: 0; border-radius: 50%; background: none; color: var(--text-muted); font-size: .95rem; cursor: pointer; }
.settings-x:hover { background: var(--word-bg); color: var(--text-strong); }
/* Display: a card like the account ones, its rows separated by hairlines */
.settings-card { margin-top: .8rem; }
#settings-box .settings-list { list-style: none; margin: .5rem 0 0; padding: 0; }
#settings-box .settings-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 0; padding: .75rem 0; border-radius: 0; background: none; border-top: 1px solid var(--border); }
#settings-box .settings-row:last-child { padding-bottom: .1rem; }
#settings-box .settings-row-theme { display: block; }
#settings-box .theme-choices { display: grid; grid-template-columns: repeat(5, 1fr); gap: .35rem; }
#settings-box .theme-choice { justify-content: center; padding: .38rem .2rem; font-size: .82rem; gap: .35rem; min-width: 0; }
#settings-box .acct-levels li, #settings-box .acct-versions li { margin: 0; }
.settings-label { font-weight: 600; color: var(--text-strong); font-size: .9rem; }
.settings-desc { font-weight: 400; font-size: .78rem; color: var(--text-muted); margin-left: .6em; }
.settings-demo { margin-top: .35rem; font-size: .95rem; line-height: 2; color: var(--text-muted); }
.settings-switch { flex: none; position: relative; width: 2.6rem; height: 1.5rem; cursor: pointer; }
.settings-switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.settings-switch span { position: absolute; inset: 0; border-radius: 999px; background: var(--border); transition: background .15s; }
.settings-switch span::after { content: ""; position: absolute; top: 2px; left: 2px; width: calc(1.5rem - 4px); height: calc(1.5rem - 4px); border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .15s; }
.settings-switch input:checked + span { background: var(--ui); }
.settings-switch input:checked + span::after { transform: translateX(1.1rem); }
.settings-switch input:focus-visible + span { outline: 2px solid var(--ui); outline-offset: 2px; }
.settings-seg { flex: none; display: inline-flex; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card-bg); }
.settings-seg button { border: 0; background: none; color: var(--text-muted); padding: .3rem .8rem; border-radius: calc(var(--radius) - 2px); font: inherit; font-size: .85rem; cursor: pointer; }
.settings-seg button[aria-pressed="true"] { background: var(--word-bg); color: var(--text-strong); font-weight: 600; box-shadow: 0 0 0 1px var(--border); }
.settings-more { display: flex; justify-content: center; margin-top: .9rem; }
.settings-more button { display: inline-flex; align-items: center; gap: .45rem; border: 1px solid var(--border); border-radius: 999px; background: none; color: inherit; padding: .4rem 1rem; font: inherit; font-size: .88rem; cursor: pointer; }
.settings-more button:hover { border-color: var(--ui); }
.settings-more svg { width: 15px; height: 15px; }
@media (max-width: 600px) { #settings-overlay { padding: 5vh .6rem 1rem; } }
/* Account and progress cards at the top of the settings dialog (filled by site/sync.js) */
.acct { margin: 0; display: grid; gap: .8rem; }
.acct-card { padding: 1rem 1.1rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--word-bg); }
.acct-title { font-weight: 700; font-size: 1rem; color: var(--text-strong); margin: 0; }
.acct-card p { margin: .25rem 0 0; font-size: .88rem; line-height: 1.55; }
.acct-card p.acct-title { font-size: 1rem; margin: 0; }
.acct-muted { color: var(--text-muted); }
.acct-fine { color: var(--text-muted); font-size: .8rem !important; margin-top: .8rem !important; }
.acct-err { color: var(--accent); }
.acct-ok { color: #3fb950; font-weight: 700; }
.acct a { color: var(--text-muted); text-decoration: underline; text-underline-offset: 2px; }
.acct a:hover, .acct-link:hover { color: var(--ui); }
.acct-link { background: none; border: 0; padding: 0; color: var(--text-muted); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font: inherit; }
/* Sign in: Google's button, a rule with "or", then one field with its button inside */
.acct-g { margin-top: .9rem; min-height: 40px; color-scheme: light; }
.acct-wide { width: 100%; }
.acct-or { display: flex; align-items: center; gap: .7rem; margin: .8rem 0; color: var(--text-muted); font-size: .8rem; }
.acct-or::before, .acct-or::after { content: ""; flex: 1; height: 1px; background: var(--border); }
.acct-field { display: flex; margin-top: .5rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card-bg); overflow: hidden; }
.acct-field:focus-within { border-color: var(--ui); }
.acct-field input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; padding: .6rem .8rem; font: inherit; font-size: .92rem; }
.acct-field input.acct-code { letter-spacing: .25em; font-variant-numeric: tabular-nums; }
.acct-field button { flex: none; border: 0; border-left: 1px solid var(--border); background: none; color: var(--text-strong); padding: 0 1rem; font: inherit; font-size: .88rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.acct-field button:hover { color: var(--ui); }
.acct-field button.acct-primary { background: var(--ui); color: var(--ui-on); border-left-color: var(--ui); }
.acct-field button[disabled] { opacity: .55; cursor: default; }
/* Signed in */
.acct-id { display: flex; align-items: center; gap: .8rem; }
.acct-id > div { min-width: 0; }
.acct-id .acct-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-avatar { flex: none; width: 2.4rem; height: 2.4rem; border-radius: 50%; display: grid; place-items: center; background: var(--card-bg); border: 1px solid var(--border); font-weight: 700; color: var(--text-strong); }
.acct-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .8rem; }
.acct-btn, .settings-control button { background: var(--card-bg); border: 1px solid var(--border); color: inherit; border-radius: var(--radius); padding: .42rem .85rem; cursor: pointer; font: inherit; font-size: .88rem; }
.acct-btn:hover, .settings-control button:hover { border-color: var(--ui); }
.acct-btn[disabled] { opacity: .5; cursor: default; }
.acct-sm { padding: .25rem .65rem; font-size: .82rem; }
.acct-danger:hover { color: var(--accent); }
.settings-foot { margin: .8rem 0 0; font-size: .78rem; line-height: 1.6; color: var(--text-muted); text-align: center; }
.settings-foot a { color: var(--link); }
/* Progress */
.acct-head { display: flex; align-items: baseline; justify-content: space-between; gap: .8rem; }
.acct-head .acct-muted { font-size: .82rem; }
.acct-levels { list-style: none; margin: .6rem 0 0; padding: 0; font-size: .9rem; }
.acct-levels li { display: flex; align-items: baseline; gap: .8rem; padding: .32rem 0; border-top: 1px solid var(--border); }
.acct-levels li:first-child { border-top: 0; }
.acct-levels b { flex: none; width: 2.2em; color: var(--text-strong); }
.acct-levels span { color: var(--text-muted); }
/* (#settings-box: the site-wide details and checklist styles must not reach in here) */
#settings-box .acct-manage { margin: .7rem 0 0; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: none; padding: .6rem 0 0; }
.acct-manage summary { cursor: pointer; font-size: .85rem; font-weight: 400; color: var(--text-muted); list-style: none; background: none; border: 0; padding: 0; margin: 0; }
.acct-manage summary::-webkit-details-marker { display: none; }
.acct-manage summary::after { content: " ›"; }
.acct-manage[open] summary::after { content: " ⌄"; }
.acct-manage summary:hover { color: var(--ui); }
.acct-versions { margin-top: .7rem; }
.acct-versions ul { list-style: none; margin: .4rem 0 0; padding: 0; }
.acct-versions li { display: flex; align-items: center; justify-content: space-between; gap: .8rem; padding: .35rem 0; border-top: 1px solid var(--border); font-size: .86rem; }
.acct-clear { display: flex; align-items: center; gap: .5rem; margin-top: .8rem; font-size: .85rem; }
.acct-scope { background: var(--card-bg); color: inherit; border: 1px solid var(--border); border-radius: var(--radius); padding: .25rem .4rem; font: inherit; font-size: .82rem; }
/* The account buttons carry a dot only when syncing has failed (html.acct-warn,
   set by sync.js): signed in and working shows nothing, so it never nags. */
html.acct-warn #tc-acct, html.acct-warn #settings-btn, html.acct-warn .m-btn[data-m="settings"] { position: relative; }
html.acct-warn #tc-acct::after, html.acct-warn #settings-btn::after, html.acct-warn .m-btn[data-m="settings"]::after { content: ""; position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%; background: #d29922; }
`);

// ─── JS ───

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
