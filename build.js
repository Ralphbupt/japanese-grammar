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

// Comments: giscus (GitHub Discussions) was removed on 2026-11-23 — 12 comments
// from 3 readers in three months, none from the page since 09-18 (it needs a
// GitHub login). Readers use the 💬 feedback box; the old threads stay in the
// repo's Discussions.

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
// The flashcard deck's grammar points (the /{lv}-cards/ pages list them); main() only runs from the command line.
const { lessonIndex } = require("./build-anki");
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
// Experiments: a small script from ab.jpnotes.dev (its source is not in this
// repo). It may register hooks (window.jpQuizHooks) and reports its groups to
// GA (window.jpAB.up()). Loaded deferred, before quiz.js; if it fails to load,
// every page works as without it. AB_SRC= (empty) builds without it,
// AB_SRC=http://localhost:8767/ab.js tests a local copy.
// ?v= only to step past copies browsers cached before 2026-11-16 18:30, when the zone
// stretched ab.js's cache to 4 h; the Worker ignores the query.
const AB_SRC = process.env.AB_SRC !== undefined ? process.env.AB_SRC : "https://ab.jpnotes.dev/ab.js?v=2";
const AB_ORIGIN = AB_SRC ? " " + new URL(AB_SRC).origin : "";
const AB_LOADER = AB_SRC ? `<script src="${AB_SRC}" defer></script>` : "";
// Notes under grammar points and practice questions: a script from
// notes.jpnotes.dev (its source is not in this repo either). Lesson pages give
// it the "已掌握" buttons to hang a block under, practice pages an empty
// <div class="jp-nt" data-nt="q:<id>"> in each explanation (site/quiz.js).
// NOTES_SRC= (empty) builds without it; ?notes=local on a page talks to wrangler dev.
const NOTES_SRC = process.env.NOTES_SRC !== undefined ? process.env.NOTES_SRC : "https://notes.jpnotes.dev/notes.js?v=4";
const NOTES_ORIGIN = NOTES_SRC ? " " + new URL(NOTES_SRC).origin : "";
const NOTES_LOADER = NOTES_SRC ? `<script src="${NOTES_SRC}" defer></script>` : "";
// Content-Security-Policy connect-src allowlist: the browser itself refuses
// fetch/XHR/beacon to any origin not listed here, even if a script on the page
// were compromised. The AI host is parsed from site/ai-assistant.js (only the
// site's own relay since the own-key providers were removed, 2026-11-10);
// localhost/127.0.0.1 on any port covers the local relay and account worker.
// cloudflareinsights.com: Cloudflare Web Analytics, which the zone injects into
// every page (static.cloudflareinsights.com beacon script, allowed in script-src).
const AI_PROVIDER_HOSTS = [...new Set(
  [...AI_JS_SRC.matchAll(/(?:base|altBase): '(https?:\/\/[^'/]+)/g)]
    .map(m => m[1]).filter(h => !/localhost|127\.0\.0\.1/.test(h))
)];
const ADSENSE_PUB = "ca-pub-8454405576477743";
// The rest of the policy: scripts, styles, images, audio, frames only from
// this site (comments via giscus removed 2026-11-23); no plugins, no <base> or form tricks.
// Inline scripts stay allowed — the pages are built with many of them — but a
// script or image from any other host is refused, so an injected tag can't
// load code or leak data (an <img> beacon) elsewhere.
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://static.cloudflareinsights.com${AB_ORIGIN}${NOTES_ORIGIN}; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob:; media-src 'self' blob:${AUDIO_ORIGIN}; font-src 'self' data:; frame-src https://accounts.google.com/gsi/; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; connect-src 'self' ${ACCOUNT_API}${AB_ORIGIN}${NOTES_ORIGIN} https://cloudflareinsights.com https://accounts.google.com/gsi/ https://*.google-analytics.com https://*.analytics.google.com ${AI_PROVIDER_HOSTS.join(" ")} http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*">` +
  // Google AdSense site verification (applied 2026-11-18). Only this tag: no
  // ad script is loaded, so the CSP above stays as it is. dist/ads.txt names
  // the same publisher.
  `\n<meta name="google-adsense-account" content="${ADSENSE_PUB}">`;
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
    else if (t === 'light' || t === 'white' || t === 'sepia' || t === 'blue') c.add('theme-light');
    if (t === 'white' || t === 'sepia' || t === 'blue') c.add('tone-' + t);
  } catch (e) {}
  // Experiments (ab.jpnotes.dev) that change the look keep their classes and
  // CSS in jp_ab_early, put on here before the first paint. "pending" hides
  // what the experiment script will still rebuild, for at most 1.5 s.
  try {
    var x = JSON.parse(localStorage.getItem('jp_ab_early') || 'null'), h = document.documentElement;
    if (x && x.cls) {
      h.className += ' ' + x.cls;
      if (x.css) { var st = document.createElement('style'); st.id = 'ab-early'; st.textContent = x.css; document.head.appendChild(st); }
      if (x.wait) { h.classList.add('ab-pending'); setTimeout(function() { h.classList.remove('ab-pending'); }, 1500); }
    }
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
  function savePrefs(patch) { var p = loadPrefs(); for (var k in patch) p[k] = patch[k]; p.uiT = Date.now(); localStorage.setItem(STORE_KEY, JSON.stringify(p)); if (window.jpSync) window.jpSync.changed(); }
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
// Home page, first screen: a reader with no practice history gets one real
// question to answer in place (GA 2026-11: half of the new readers landing on
// the home page left without opening anything, while 41% of those landing on a
// practice page answered a question). One short grammar question per level,
// taken from the built bank so options and furigana match the practice page;
// filled in after buildQuiz() (HOME_TRY_SLOT → homeTryHtml()). Not recorded
// as progress. A reader with history keeps the example sentence, and
// 开始做题 takes them straight to their last level.
const HOME_TRY_SLOT = "<!--home-try-->";
const HOME_TRY_IDS = { N5: "n5-l08-007", N4: "n4-l31-016", N3: "n3-l58-023", N2: "n2-l59-001", N1: "n1-l83-011" };
const HOME_TRY_JS = `(function(){
  var box = document.getElementById('home-try'), note = document.getElementById('hero-note'), go = document.getElementById('home-start');
  if (!box) return;
  var S = null, last = null, lt = 0;
  try { S = JSON.parse(localStorage.getItem('jp_quiz_v1')); } catch (e) {}
  var A = (S && S.answers) || {};
  for (var id in A) { var a = A[id], x = a && a[a.length - 1], m = /^n([1-5])-/.exec(id); if (m && x && x.t > lt) { lt = x.t; last = 'n' + m[1]; } }
  if (last) { if (go) go.href = last + '-practice/'; return; }
  var Q = JSON.parse(document.getElementById('home-try-data').textContent), lv = null, done = false;
  try { lv = localStorage.getItem('jp_home_lv'); } catch (e) {}
  if (!Q[lv]) lv = Q.N5 ? 'N5' : Object.keys(Q)[0];
  var b = function (zh, en) { return '<span class="lang-zh">' + zh + '</span><span class="lang-en">' + en + '</span>'; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ev = function (n, p) { try { if (window.gaEvent) window.gaEvent(n, p); } catch (e) {} };
  var lines = function (s) { return String(s).split('\\n').filter(function (l) { return l.trim(); }); };
  var why = function (q) {
    var z = lines(q.why.zh), e = lines(q.why.en), h = '';
    var row = function (l, cls, re) { var m = l.match(re); return m ? '<span class="try-k ' + cls + '">' + esc(m[1]) + '</span><span class="' + cls + '">' + esc(m[2]) + '</span>' : '<span class="try-all ' + cls + '">' + esc(l) + '</span>'; };
    z.forEach(function (l) { h += row(l, 'lang-zh', /^([^：:「」，。\\s]{1,6})[：:]\\s*(.+)$/); });
    e.forEach(function (l) { h += row(l, 'lang-en', /^([A-Za-z][A-Za-z ]{1,13}):\\s*(.+)$/); });
    return '<div class="try-why">' + h + '</div>';
  };
  function draw(pick) {
    var q = Q[lv], lo = lv.toLowerCase(), h = '<div class="try-top"><span class="try-lead">' + b('先试一道', 'Try one') + '</span><span class="try-lvs">';
    for (var k in Q) h += '<button type="button" class="try-lv" data-lv="' + k + '" aria-pressed="' + (k === lv) + '">' + k + '</button>';
    h += '</span></div>';
    h += '<p class="try-stem" lang="ja">' + (pick == null ? q.stem.replace('（　）', '<span class="try-blank">（　　）</span>') : q.full) + '</p>';
    if (pick != null) h += '<p class="try-tr">' + b(esc(q.tr.zh), esc(q.tr.en)) + '</p>';
    var long = q.options.some(function (o) { return o.replace(/<rt>.*?<\\/rt>|<rp>.*?<\\/rp>|<[^>]+>/g, '').length > 5; });
    h += '<div class="try-opts' + (long ? ' try-opts-1' : '') + '">';
    q.options.forEach(function (o, i) {
      var c = pick == null ? '' : i === q.answer ? ' try-ok' : i === pick ? ' try-bad' : ' try-off';
      h += '<button type="button" class="try-opt' + c + '" data-i="' + i + '"' + (pick == null ? '' : ' disabled') + '><span class="try-num">' + (i + 1) + '</span><span lang="ja">' + o + '</span></button>';
    });
    h += '</div>';
    if (pick != null) {
      var ok = pick === q.answer;
      h += '<div class="try-res" aria-live="polite"><p class="try-verdict ' + (ok ? 'ok' : 'bad') + '">' + (ok ? b('答对了', 'Correct') : b('不对，答案是 ' + (q.answer + 1), 'Not quite — it’s ' + (q.answer + 1))) + '</p>';
      if (!ok && q.wrong[pick]) h += '<p class="try-mine"><b>' + b('你选的 ' + (pick + 1), 'Your pick, ' + (pick + 1)) + '</b>' + b(esc(q.wrong[pick].zh), esc(q.wrong[pick].en)) + '</p>';
      h += why(q);
      h += '<p class="try-next"><a class="btn-primary" id="try-go" href="' + lo + '-practice/#start=daily">' + b('再做一组 ' + lv + ' 题 →', 'Do a set of ' + lv + ' questions →') + '</a>' +
        (q.lesson ? '<a class="try-lesson" href="' + q.lesson + '/">' + b('第 ' + q.n + ' 课讲解', 'Lesson ' + q.n + ' explains it') + '</a>' : '') + '</p></div>';
    }
    box.innerHTML = h;
    if (go) go.href = lo + '-practice/';
  }
  box.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button,a') : null;
    if (!t) return;
    if (t.className.indexOf('try-lv') === 0) {
      if (t.getAttribute('data-lv') === lv) return;
      lv = t.getAttribute('data-lv'); done = false;
      try { localStorage.setItem('jp_home_lv', lv); } catch (e2) {}
      ev('home_try_level', { level: lv });
      draw(null);
    } else if (t.className.indexOf('try-opt') === 0 && !done) {
      done = true;
      var i = +t.getAttribute('data-i');
      ev('home_try', { level: lv, id: Q[lv].id, ok: i === Q[lv].answer });
      draw(i);
    } else if (t.id === 'try-go') ev('home_try_next', { level: lv });
  });
  draw(null);
  if (note) note.hidden = true;
  box.hidden = false;
})();`;
// bundles = buildQuiz()'s result
function homeTryHtml(bundles) {
  const data = {};
  for (const [lv, id] of Object.entries(HOME_TRY_IDS)) {
    const q = bundles[lv] && bundles[lv].practice.questions.find((x) => x.id === id);
    if (!q) { console.warn(`  ⚠ Home page: question ${id} is not in the ${lv} bank; that level is left out of the try-one card.`); continue; }
    const m = /^lesson(\d+)/.exec((q.refs || [])[0] || "");
    // The finished sentence with the filled-in part marked. The stem and the
    // sentence carry different furigana, so the blank is located in the text
    // without ruby and mapped back to a position in the HTML.
    const plain = (h) => h.replace(/<rp>.*?<\/rp>|<rt>.*?<\/rt>|<[^>]+>/g, "");
    const [pre, post = ""] = q.stem.split("（　）").map((x) => plain(x).trim()), text = plain(q.full);
    let full = q.full;
    if (text.startsWith(pre) && text.endsWith(post) && text.length > pre.length + post.length) {
      const at = [];   // HTML index of each character of `text`, and whether it sits inside a <ruby>
      for (let i = 0, inRuby = false; i < q.full.length;) {
        const m = /^(<rp>.*?<\/rp>|<rt>.*?<\/rt>|<[^>]+>)/.exec(q.full.slice(i));
        if (m) { if (m[0] === "<ruby>") inRuby = true; else if (m[0] === "</ruby>") inRuby = false; i += m[0].length; }
        else { at.push([i, inRuby]); i++; }
      }
      let from = pre.length, to = text.length - post.length;
      while (text[from] === " ") from++;
      while (text[to - 1] === " ") to--;
      const rubyStart = (k) => q.full.lastIndexOf("<ruby>", at[k][0]), rubyEnd = (k) => q.full.indexOf("</ruby>", at[k][0]) + 7;
      const i0 = at[from][1] ? rubyStart(from) : at[from][0], i1 = at[to - 1][1] ? rubyEnd(to - 1) : at[to - 1][0] + 1;
      full = `${q.full.slice(0, i0)}<strong class="try-fill">${q.full.slice(i0, i1)}</strong>${q.full.slice(i1)}`;
    }
    data[lv] = { id, stem: q.stem, options: q.options, answer: q.answer, full, tr: q.tr, why: q.why, wrong: q.wrong, lesson: m ? m[0] : "", n: m ? +m[1] : 0 };
  }
  if (!Object.keys(data).length) return "";
  return `<section class="home-try" id="home-try" hidden></section><script type="application/json" id="home-try-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script><script>${HOME_TRY_JS}</script>`;
}
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
  function savePrefs(patch) { var p = loadPrefs(); for (var k in patch) p[k] = patch[k]; p.uiT = Date.now(); localStorage.setItem(STORE_KEY, JSON.stringify(p)); if (window.jpSync) window.jpSync.changed(); }
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

const GTAG_DEFERRED = AB_LOADER + NOTES_LOADER + `<script>
(function() {
  var ua = navigator.userAgent || '';
  // Skip GA for automation / crawlers / SEO tools — they all match here.
  if (navigator.webdriver) return;
  if (/HeadlessChrome|Lighthouse|PhantomJS|Puppeteer|Playwright|crawler|spider|bot|Slurp|facebookexternalhit/i.test(ua)) return;
  // Headless renderers with a normal user agent: 800x600 is their default screen
  // (2026-11: ~170 "readers" in 28 days, 148 from China, all direct, 3 engaged
  // sessions, 0 answers), and 1366x1366 behaved the same. No real device today.
  var scr = screen.width + 'x' + screen.height;
  if (scr === '800x600' || scr === '1366x1366') return;

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
    // Apps that open links in their own browser (WeChat, Douyin, Doubao, LINE …) send
    // no referrer, so GA files those readers under "direct". Name the app as the
    // referrer instead (wechat.inapp …): GA then reports it as the source, and the
    // admin's channel table groups *.inapp. Only when nothing else names a source.
    // (No backslashes in these regexes: this script sits in a template literal.)
    else if (seq === 1 && !/[?&](utm_|gclid=|fbclid=)/.test(location.search)) {
      var ua = navigator.userAgent, app = [['doubao', /doubao/i], ['wecom', /wxwork/i], ['wechat', /MicroMessenger/], ['qq', /[ ;)]QQ[/]|MQQBrowser/],
        ['tiktok', /musical_ly|TikTok/], ['douyin', /aweme|BytedanceWebview|NewsArticle|TTWebView/], ['quark', /Quark[/]/], ['uc', /UCBrowser/],
        ['baidu', /baiduboxapp/], ['xiaohongshu', /xhsdiscover/], ['weibo', /Weibo/], ['zhihu', /ZhihuHybrid/], ['dingtalk', /DingTalk/], ['feishu', /Lark|Feishu/],
        ['line', / Line[/]/], ['facebook', /FBAN|FBAV|FB_IAB/], ['instagram', /Instagram/], ['threads', /Barcelona/], ['kakaotalk', /KAKAOTALK/i],
        ['naver', /NAVER[(]inapp/], ['zalo', /Zalo/], ['discord', /Discord/], ['telegram', /Telegram/], ['snapchat', /Snapchat/], ['google-app', /GSA[/]/]]
        .filter(function(a) { return a[1].test(ua); })[0];
      if (app) q.dr = 'https://' + app[0] + '.inapp/';
    }
    if (debug) q._dbg = 1;
    if (KEY_EVENTS.indexOf(name) >= 0) q._c = 1;
    // Which theme the page is actually shown in (auto resolved through the
    // system setting) and what the reader chose. GA custom dimensions theme / theme_pref.
    if (name === 'page_view') {
      var hc = document.documentElement.classList, pref = store('theme') || 'auto';
      q['ep.theme'] = hc.contains('theme-dark') ? 'dark' : hc.contains('tone-blue') ? 'blue' : hc.contains('tone-white') ? 'white' : hc.contains('tone-sepia') ? 'sepia' : hc.contains('theme-light') ? 'paper'
        : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'blue');
      q['ep.theme_pref'] = pref === 'light' ? 'paper' : pref;
    }
    // Experiment groups the reader has been shown (user property, GA dimension ab).
    try { var ab = window.jpAB && window.jpAB.up(); if (ab) q['up.ab'] = ab; } catch (e) {}
    // User properties: signed in, level last practised, streak band (quiz.js writes jp_up).
    try {
      q['up.signed_in'] = (JSON.parse(store('jp_acct')) || {}).token ? '1' : '0';
      // Device time zone (GA dimension tz): a reader in mainland China behind a
      // proxy shows up with a Japanese or US IP but keeps Asia/Shanghai here.
      var tz = window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz) q['up.tz'] = String(tz).slice(0, 36);
      var upv = JSON.parse(store('jp_up')) || {};
      if (upv.lv) q['up.level'] = upv.lv;
      if (upv.sk) q['up.streak'] = upv.sk;
    } catch (e) {}
    for (var k in extra) q[k] = extra[k];
    for (var p in params) {
      var v = params[p];
      if (v === undefined || v === null) continue;
      // GA4 reads an event param named source / medium / campaign as the visit's
      // traffic source (the AI panel's source: 'example' became a "referrer" until
      // 2026-11-02), and direct visits then inherit it for 90 days. Never send one.
      if (p === 'source' || p === 'medium' || p === 'campaign' || p === 'campaign_id') p = 'p_' + p;
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

  // ─── Quality signals (2026-11-16) ───
  var conn = navigator.connection || {}, net = function() { return conn.effectiveType || ''; };
  // Script errors: the kind, where, and the message with any page text taken
  // out (2026-11-23: Japanese / Chinese runs and long quoted strings → …), so
  // "Cannot read properties of null (reading 'x')" stays but nothing a reader
  // saw does. err_file: the script's name, (page) = an inline script of this
  // page, (none) = no file (another origin's script, an extension). 3 per page.
  var errs = 0;
  function clean(m) {
    // (inside a template string in build.js: backslashes doubled, no backtick)
    return String(m || '').replace(/https?:\\/\\/[^\\s'")]+/g, function(u) { return u.replace(/[?#].*$/, '').split('/').slice(-1)[0] || 'url'; })
      .replace(/[\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef]+/g, '…').replace(/(["'])[^"']{24,}\\1/g, '"…"').replace(/\\d{5,}/g, '#').slice(0, 90);
  }
  function jsErr(type, file, line, msg, col) {
    if (++errs > 3) return;
    var f = String(file || '').replace(/[?#].*$/, ''), page = location.href.replace(/[?#].*$/, '');
    window.gaEvent('js_error', { err_type: String(type || 'Error').slice(0, 40), err_file: !f ? '(none)' : f === page ? '(page)' : f.split('/').pop().slice(0, 60) || '(page)', err_line: line || 0, err_col: col || 0, err_msg: clean(msg) });
  }
  window.addEventListener('error', function(e) {
    if (e.target && e.target !== window) return;                 // resource errors: audio below
    jsErr(e.error && e.error.name, e.filename, e.lineno, e.message, e.colno);
  });
  window.addEventListener('unhandledrejection', function(e) {
    var r = e.reason;
    if (r && r.name === 'NotAllowedError') return;                 // autoplay blocked: not an error
    jsErr('rejection:' + ((r && r.name) || typeof r), '', 0, r && r.message, 0);
  });
  // Audio that didn't load or play: which kind of file (s sentence, q question,
  // p passage, c listening) and the media error code. 3 per page.
  var afails = 0, P = HTMLMediaElement.prototype, play0 = P.play;
  function audioFail(el, code) {
    if (++afails > 3) return;
    var f = String(el.currentSrc || el.src || '').split('/').pop();
    window.gaEvent('audio_fail', { src_kind: f.charAt(0) || '?', code: String(code), net: net() });
  }
  P.play = function() {
    var el = this;
    if (!el.__jpw) { el.__jpw = 1; el.addEventListener('error', function() { audioFail(el, el.error ? el.error.code : 0); }); }
    var p = play0.apply(el, arguments);
    if (p && p.catch) p.catch(function(err) { if (err && err.name === 'NotSupportedError') audioFail(el, 'nosupport'); });
    return p;
  };
  // Web vitals, sent once when the page is hidden: LCP and INP (ms), CLS ×1000.
  var lcp = 0, cls = 0, inp = 0, vitalsSent = false;
  function obs(type, fn) { try { new PerformanceObserver(function(l) { l.getEntries().forEach(fn); }).observe({ type: type, buffered: true, durationThreshold: 40 }); } catch (e) {} }
  obs('largest-contentful-paint', function(en) { lcp = Math.round(en.startTime); });
  obs('layout-shift', function(en) { if (!en.hadRecentInput) cls += en.value; });
  obs('event', function(en) { if (en.interactionId && en.duration > inp) inp = Math.round(en.duration); });
  function vitals() {
    if (vitalsSent || !lcp) return;
    vitalsSent = true;
    var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    window.gaEvent('web_vitals', { lcp: lcp, inp: inp, cls: Math.round(cls * 1000), net: net(), nav: nav.type || '' });
  }
  document.addEventListener('visibilitychange', function() { if (document.hidden) vitals(); });
  window.addEventListener('pagehide', vitals);
  // Sidebar, phone bar and the chips under a quiz page's title (el: head,
  // 2026-11-23): what readers open from the navigation, and from what kind of page.
  function kindOf(p) {
    var m;
    return /\\/lesson\\d+\\/$/.test(p) ? 'lesson' : (m = p.match(/\\/n[1-5]-(practice|listening|reading|vocabulary-list|vocabulary|kanji|mock-test|cards|grammar-audio)\\/$/)) ? m[1]
      : /\\/jlpt-n[1-5]-past-exam-grammar\\/$/.test(p) ? 'past-exam-grammar' : /^\\/(zh\\/)?(words|my-grammar|my-notes|review)\\/$/.test(p) ? p.replace(/^\\/(zh\\/)?|\\/$/g, '')
      : /\\/N[1-5]\\/$/.test(p) ? 'overview' : /_grammar_list\\/$/.test(p) ? 'checklist' : /^\\/(zh\\/)?(practice|listening|reading|vocabulary|mock-test|guides|grammar-audio)\\/$/.test(p) ? 'hub'
      : /^\\/(zh\\/)?$/.test(p) ? 'home' : 'other';
  }
  document.addEventListener('click', function(e) {
    var a = e.target.closest && e.target.closest('#sidebar a[href], #m-bar a[href], .quiz-nav a[href]');
    if (!a) return;
    var el = a.closest('.quiz-nav') ? 'head' : a.getAttribute('data-nav') || (a.classList.contains('nav-item') ? 'item' : 'link');
    window.gaEvent('nav_click', { to: kindOf(a.pathname || ''), el: el, from: kindOf(location.pathname) });
  }, true);
  // Lessons: how far down the reader got (25 / 50 / 75 / 100 %).
  if (/\\/lesson\\d+\\/$/.test(location.pathname)) {
    var marks = [25, 50, 75, 100], hit = 0;
    window.addEventListener('scroll', function() {
      var h = document.documentElement.scrollHeight - innerHeight;
      var d = h > 0 ? (scrollY / h) * 100 : 100;
      while (hit < marks.length && d >= marks[hit] - 2) window.gaEvent('lesson_read', { depth: marks[hit++] });
    }, { passive: true });
  }
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
  "jlpt-score-calculator": "JLPT 自己採点",
  "jlpt-n2-past-exam-grammar": "N2 過去問の文法",
  "jlpt-n3-past-exam-grammar": "N3 過去問の文法",
  "jlpt-n1-past-exam-grammar": "N1 過去問の文法",
  "jlpt-n4-past-exam-grammar": "N4 過去問の文法",
  "jlpt-n5-past-exam-grammar": "N5 過去問の文法",
  "jlpt-listening-tips": "JLPT 聴解のコツ",
  "jlpt-past-papers": "JLPT 過去問・公式問題集",
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
  "japanese-conjunctions": "接続詞 — だから・それで・そこで",
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
  // A lesson may open with a direct answer for searchers (see lesson53); its
  // label is for the page, not for the search snippet.
  s = s.replace(/^\s*\*\*(Quick answer:|一句话答案：)\*\*\s*/, "");
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

// ─── Lesson page presentation ───
// Last pass over a lesson's HTML before it is written: markup for layout only.
// Every visible character stays where it was (textContent is unchanged), so
// ids, search, cross-links, the AI panel's section reading and SEO see the
// same text; earlier passes (search index, cross-link index) already ran.

// Call fn(inner, lang) for each top-level <span class="lang-xx"> in `html`
// (nested spans inside are kept whole); with none, fn(html, null).
function mapLangSpans(html, fn) {
  const open = /<span class="lang-(zh|en)">/g;
  let out = "", i = 0, m, any = false;
  while ((m = open.exec(html))) {
    const tags = /<span\b[^>]*>|<\/span>/g;
    tags.lastIndex = m.index + m[0].length;
    let depth = 1, t;
    while (depth && (t = tags.exec(html))) depth += t[0][1] === "/" ? -1 : 1;
    if (depth) return any ? out + html.slice(i) : fn(html, null);
    const inner = html.slice(m.index + m[0].length, t.index);
    out += html.slice(i, m.index) + m[0] + fn(inner, m[1]) + "</span>";
    i = open.lastIndex = tags.lastIndex;
    any = true;
  }
  return any ? out + html.slice(i) : fn(html, null);
}

const plainOf = (h) => h.replace(/<(rt|rp)>[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, "");
const KANA_RE = /[぀-ゟ゠-ヿ]/;

// H1 "Lesson 61 – 程度・限定 — に過ぎない/にほかならない/…": a kicker line
// (第 61 课 · N2 / Lesson 61 · N2, outside the h1), the topic as the title and
// the patterns after " — " as chips. "Lesson NN – " and the " — " and "/"
// separators stay in the h1, visually hidden.
function presentLessonH1(html, lesson) {
  const num = (lesson.id.match(/^lesson(\d+)/) || [])[1];
  if (!num || !/^N[1-5]$/.test(lesson.level || "")) return html;
  return html.replace(/<h1>([\s\S]*?)<\/h1>/, (whole, content) => {
    if (!/^\s*(<span class="lang-zh">)?Lesson\s+\d+\s*[–—-]/.test(content)) return whole;
    const h1 = mapLangSpans(content, (inner) => {
      const pre = inner.match(/^Lesson\s+\d+\s*[–—-]\s*/);
      let rest = pre ? inner.slice(pre[0].length) : inner;
      const head = pre ? `<span class="visually-hidden">${pre[0]}</span>` : "";
      const sep = rest.indexOf(" — ");
      if (sep < 0 || !KANA_RE.test(plainOf(rest.slice(sep + 3)))) return `${head}<span class="h1-topic">${rest}</span>`;
      const topic = rest.slice(0, sep);
      let pats = rest.slice(sep + 3), sub = "";
      // "… — patterns — “Even If” in Japanese": the part after a second dash stays text.
      const sep2 = pats.indexOf(" — ");
      if (sep2 >= 0) { sub = `<span class="visually-hidden"> — </span><span class="h1-sub">${pats.slice(sep2 + 3)}</span>`; pats = pats.slice(0, sep2); }
      const chips = pats.split(/(\s*[/／]\s*)/).map((p, k) => (k % 2
        ? `<span class="visually-hidden">${p}</span>`
        : `<span class="h1-pat">${p}</span>`)).join("");
      return `${head}<span class="h1-topic">${topic}</span><span class="visually-hidden"> — </span><span class="h1-pats" lang="ja">${chips}</span>${sub}`;
    });
    const n = String(+num);
    const kicker = `<p class="lesson-kicker"><span class="lang-zh">第 ${n} 课 · ${lesson.level}</span><span class="lang-en">Lesson ${n} · ${lesson.level}</span></p>`;
    return `${kicker}<h1 class="lesson-h1">${h1}</h1>`;
  });
}

// "## N. 〜pattern（gloss）": number, pattern, gloss as separate pieces.
function presentPointHeadings(html) {
  return html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (whole, attrs, content) => {
    let hit = false;
    const out = mapLangSpans(content, (inner) => {
      const nm = inner.match(/^(\d+[.．、])(\s*)/);
      if (!nm) return inner;
      hit = true;
      let body = inner.slice(nm[0].length), gloss = "";
      const gm = body.match(/(\s*)(（[^（）]*）|\([^()]*\))\s*$/);
      if (gm && gm.index > 0) { gloss = body.slice(gm.index + gm[1].length); body = body.slice(0, gm.index + gm[1].length); }
      // English side: the build's romaji follows the pattern.
      const ri = body.indexOf('<span class="romaji">');
      let pat = ri >= 0 ? body.slice(0, ri) : body, tail = ri >= 0 ? body.slice(ri) : "";
      const ws = pat.match(/\s*$/)[0];
      pat = pat.slice(0, pat.length - ws.length);
      const ja = !hasSC(plainOf(pat)) && KANA_RE.test(plainOf(pat)) ? ' lang="ja"' : "";
      return `<span class="gp-num">${nm[1]}</span>${nm[2]}<span class="gp-pat"${ja}>${pat}</span>${ws}${tail}`
        + (gloss ? `<span class="gp-gloss">${gloss}</span>` : "");
    });
    return hit ? `<h2${attrs.includes("class=") ? attrs.replace(/class="/, 'class="gp-head ') : attrs + ' class="gp-head"'}>${out}</h2>` : whole;
  });
}

// The vocabulary table folds away under a one-line summary (closed by
// default), the heading itself inside the summary so its anchor still works.
function presentVocab(html) {
  return html.replace(/<h2([^>]*\bid="[^"]*单词表[^"]*"[^>]*)>([\s\S]*?)<\/h2>\s*(<div class="table-scroll"><table class="word-table">[\s\S]*?<\/table><\/div>)/,
    (whole, attrs, content, table) => {
      const n = (table.match(/<tbody>([\s\S]*?)<\/tbody>/) || ["", ""])[1].split("<tr>").length - 1;
      if (!n) return whole;
      const count = `<span class="vocab-count"><span class="lang-zh">（${n} 个词）</span><span class="lang-en"> (${n} words)</span></span>`;
      return `<details class="vocab-fold"><summary><h2${attrs}>${content}</h2>${count}</summary>\n${table}\n</details>`;
    });
}

// A short bold pattern in a model sentence (≤ 8 characters) never breaks
// across lines.
function presentExamples(html) {
  return html.replace(/<li data-ja data-ex[^>]*>[\s\S]*?<\/li>/g, (li) =>
    li.replace(/<strong>([\s\S]*?)<\/strong>/g, (m, inner) => {
      const len = [...plainOf(inner).trim()].length;
      return len && len <= 8 ? `<strong class="nobr">${inner}</strong>` : m;
    }));
}

function presentLesson(html, lesson) {
  return presentExamples(presentVocab(presentPointHeadings(presentLessonH1(html, lesson))));
}

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
  // notebook-pen: the 笔记 tab of the review bar (/my-notes/)
  "✎": ICO_SVG('<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>'),
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

// Context-sensitive reading corrections (RUBY_FIXES, RUBY_MERGES, DAY_COUNTS)
// live in lib/ruby-fixes.js, shared with build-anki.js so the cards and the
// grammar-audio pages read the way the lesson pages do.
const { fixReadings } = require("./lib/ruby-fixes");

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
// Real-test sittings per lesson grammar point, from our own count of the past
// papers (questions/exam-grammar/{n1,n2,n3}.json, rows with lesson { id, no },
// `also` and years). Keyed "lessonNN#K" → { N2: Set(years), N3: … }: one point
// can be tested at several levels (〜うちに at N3 and N2); several rows on one
// point (〜ばかりか, 〜ばかりでなく) give the union of their sittings.
const EXAM_SEEN = (() => {
  const dir = path.join(__dirname, "questions", "exam-grammar"), out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => /^n\d\.json$/.test(f)).sort()) {
    const lv = f.slice(0, 2).toUpperCase();
    for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))) {
      if (!r.lesson) continue;
      for (const k of [`${r.lesson.id}#${r.lesson.no}`, ...(r.also || [])]) {
        const e = (out[k] = out[k] || {});
        e[lv] = e[lv] || new Set();
        r.years.forEach((y) => e[lv].add(y));
      }
    }
  }
  return out;
})();
// Sittings we have per level; under 30 the set is partial (N4 / N5) and the
// tags say "of the N tests we have".
const EXAM_TOTAL = (() => {
  const dir = path.join(__dirname, "questions", "exam-grammar"), out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => /^n\d\.json$/.test(f)))
    out[f.slice(0, 2).toUpperCase()] = new Set(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")).flatMap((r) => r.years)).size;
  return out;
})();
const examOf = (lv, en) => (EXAM_TOTAL[lv] < 30 ? (en ? ` (of the ${EXAM_TOTAL[lv]} tests we have)` : `（收录的 ${EXAM_TOTAL[lv]} 场里）`) : "");
// The levels a point was tested at, the reader's own level first, then the
// higher ones (N3 → N2 → N1), then lower: [{ lv, years (sorted) }].
const EXAM_ORDER = ["N5", "N4", "N3", "N2", "N1"];
function examLevels(seen, own) {
  if (!seen) return [];
  const o = EXAM_ORDER.indexOf(own), rank = (lv) => { const i = EXAM_ORDER.indexOf(lv); return i === o ? -1 : i > o ? i : 10 + (o - i); };
  return Object.keys(seen).sort((a, b) => rank(a) - rank(b)).map((lv) => ({ lv, years: [...seen[lv]].sort() }));
}
// Grammar-audio items carry lesson + term, not the point number: find the
// numbered heading of that lesson whose zh pattern is the term (or starts
// with it, "〜からすると／〜からすれば"), then take its EXAM_SEEN entry.
let LESSON_POINTS = null;
function examSeenFor(lesson, term) {
  if (!LESSON_POINTS) {
    LESSON_POINTS = {};
    for (const lv of ["N5", "N4", "N3", "N2", "N1"]) {
      const dir = path.join(__dirname, "grammar", lv);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const id = (f.match(/^(lesson\d+)/) || [])[1];
        if (!id) continue;
        LESSON_POINTS[id] = [...fs.readFileSync(path.join(dir, f), "utf-8").matchAll(/^## (\d+)\. (.+?)(?:\|\||$)/gm)]
          .map((m) => ({ no: m[1], term: m[2].split(/[（(]/)[0].trim() }));
      }
    }
  }
  const t = (term || "").trim(), pts = LESSON_POINTS[lesson] || [];
  const p = pts.find((x) => x.term === t) || pts.find((x) => x.term.split(/\s*[／\/]\s*/).includes(t));
  return p ? EXAM_SEEN[`${lesson}#${p.no}`] || null : null;
}
// The tag shows the page's own level when the point was tested there, else
// the nearest higher one (examLevels order).
// Tap-a-word on lesson pages (since 2026-11-23): example sentences carry
// data-wsp (audio pass), the vocabulary table's words are tappable with the
// table's own reading and meaning, and each lesson gets a dictionary per
// language (dist/quiz/w-lessonNN.{zh,en}.json) for site/word-tip.js. Words
// with no meaning yet are listed in dist/.lesson-words-todo.json (write them
// into questions/words/{level}.json, then rebuild).
const LESSON_WORDS = (() => {
  const lib = require("./build-words.js"), crypto = require("crypto"), todo = {};
  const WT_HASH = crypto.createHash("md5").update(fs.readFileSync(path.join(__dirname, "site", "word-tip.js"), "utf-8")).digest("hex").slice(0, 8);
  const vocab = (md) => {
    const sec = (md.split(/^## 本课单词表.*$/m)[1] || "").split(/^## /m)[0], out = {};
    for (const line of sec.split("\n")) {
      const c = line.split("|").map((x) => x.trim());
      if (c.length < 5 || !c[1] || /^-+$/.test(c[1]) || c[1] === "单词") continue;
      const w = c[1].replace(/[*`]/g, ""), [zhRaw, enRaw = ""] = c[3].split("//");
      if (!/[぀-ヿ一-鿿]/.test(w)) continue;
      out[w] = { r: c[2].replace(/[*`]/g, ""), zh: zhRaw.split(/（|——/)[0].trim(), en: enRaw.replace(/^\s*\([^)]*\)\s*/, "").split(/\s+—\s+/)[0].trim() };
    }
    return out;
  };
  const page = (id, level, md, html) => {
    const extra = vocab(md), key = `page:${id}`;
    // the table's word cell (no furigana there): a word button
    html = html.replace(/(<table class="word-table">[\s\S]*?<\/table>)/, (t) => t.replace(/<tr>\n<td>([^<]+)<\/td>/g, (m, w) =>
      extra[w.trim()] ? `<tr>\n<td><span class="q-w" data-k="${w.trim()}" role="button" tabindex="0">${w}</span></td>` : m));
    const d = lib.dictionary(key), seen = lib.SEEN[key] || new Map(), src = {};
    for (const code of ["zh", "en"]) {
      const out = {};
      for (const [k, v] of Object.entries(d)) out[k] = typeof v === "string" ? v : extra[k] ? [extra[k].r, extra[k][code]] : v[1] ? [v[0], v[1][code]] : [v[0]];
      for (const [k, x] of Object.entries(extra)) if (!out[k] || typeof out[k] === "string") out[k] = [x.r, x[code]];
      const file = `w-${id}.${code}.json`, body = JSON.stringify(out);
      fs.mkdirSync(path.join(__dirname, "dist", "quiz"), { recursive: true });
      fs.writeFileSync(path.join(__dirname, "dist", "quiz", file), body);
      src[code] = `${SITE_PATH}quiz/${file}?v=${crypto.createHash("md5").update(body).digest("hex").slice(0, 8)}`;
    }
    for (const [k, v] of Object.entries(d)) if (typeof v !== "string" && !v[1] && !extra[k]) {
      (todo[level] = todo[level] || {})[k] = todo[level][k] || { w: k, r: v[0], lesson: id, ctx: (seen.get(k) || {}).ctx || "" };
    }
    fs.writeFileSync(path.join(__dirname, "dist", ".lesson-words-todo.json"), JSON.stringify(Object.fromEntries(Object.entries(todo).map(([lv, m]) => [lv, Object.values(m)])), null, 1));
    return html + `\n<div id="wt" hidden data-src-zh="${src.zh}" data-src-en="${src.en}" data-lv="${level}" data-via="lesson"></div><script src="${SITE_PATH}word-tip.js?v=${WT_HASH}" defer></script>`;
  };
  return { lib, page };
})();

// Practice question id → grammar point, filled while the levels' banks are
// written, saved as quiz/qrefs.json for /my-grammar/.
const QREFS = {};

// Checklist items → lesson points (questions/grammar-list-map.json:
// { N5_grammar_list: { "<item zh text>": "lessonNN#K" } }).
const GL_MAP = (() => {
  const f = path.join(__dirname, "questions", "grammar-list-map.json");
  const raw = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf-8")) : {}, out = {};
  for (const [page, m] of Object.entries(raw)) out[page] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k.replace(/\s+/g, " ").trim(), v]));
  return out;
})();
// The id build.js gives a lesson h2 (zh side, marked-escaped, spaces → _,
// [<>"'&] dropped), for links to "lessonNN#K".
let POINT_SLUGS = null;
function pointSlug(ref) {
  if (!POINT_SLUGS) {
    POINT_SLUGS = {};
    for (const lv of ["N5", "N4", "N3", "N2", "N1"]) {
      const dir = path.join(__dirname, "grammar", lv);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const id = (f.match(/^(lesson\d+)/) || [])[1];
        if (!id) continue;
        for (const m of fs.readFileSync(path.join(dir, f), "utf-8").matchAll(/^## (\d+)\. (.+?)(?:\|\||$)/gm)) {
          const zh = `${m[1]}. ${m[2]}`.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
          POINT_SLUGS[`${id}#${m[1]}`] = zh.replace(/[\s　]+/g, "_").replace(/[<>"'&]/g, "");
        }
      }
    }
  }
  return POINT_SLUGS[ref] || "";
}
function gaExam(items, level) {
  for (const it of items) {
    const s = examSeenFor(it.lesson, it.term) || (it.key ? examSeenFor(it.lesson, it.key.slice(it.key.indexOf(":") + 1)) : null);
    const lvs = examLevels(s, level), top = lvs[0];
    it.exam = top ? top.years : [];
    if (top) { it.examLv = top.lv; it.examAll = lvs; }
  }
  return items;
}

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
      fs.existsSync(path.join(__dirname, "questions", "grammar-audio", `${lv}.json`)) && { href: `${SITE_PATH}${lv}-grammar-audio/`, zh: "🎧 语法听读", en: "🎧 Grammar audio" },
    ].filter(Boolean);
  };
  // Link text that says what the page is, the way people search for it
  // ("JLPT N5 listening practice"), for links outside the sidebar.
  const quizLinkText = (q, level, en) => {
    const kind = (q.href.match(/-([a-z-]+)\/$/) || [])[1];
    const T = { practice: ["✍ JLPT " + level + " 练习题", "✍ JLPT " + level + " practice test"], listening: ["🎧 JLPT " + level + " 听力练习", "🎧 JLPT " + level + " listening practice"],
      reading: ["📖 JLPT " + level + " 阅读练习", "📖 JLPT " + level + " reading practice"], vocabulary: ["🔤 JLPT " + level + " 词汇练习", "🔤 JLPT " + level + " vocabulary practice"],
      "mock-test": ["⏱ JLPT " + level + " 模拟题", "⏱ JLPT " + level + " mock test"], cards: ["🗂 " + level + " 语法卡片", "🗂 " + level + " grammar flashcards"],
      "grammar-audio": ["🎧 " + level + " 语法听读", "🎧 " + level + " grammar audio"] }[kind];
    return T ? T[en ? 1 : 0] : en ? q.en : q.zh;
  };
  // Grammar audio: lesson id → { level page, points } (questions/grammar-audio/{lv}.json).
  let gaLessonMap = null;
  const gaLesson = (id) => {
    if (!gaLessonMap) {
      gaLessonMap = {};
      for (const lv of ["n5", "n4", "n3", "n2", "n1"]) {
        const f = path.join(__dirname, "questions", "grammar-audio", `${lv}.json`);
        if (!fs.existsSync(f)) continue;
        for (const it of JSON.parse(fs.readFileSync(f, "utf-8")).items) {
          const e = gaLessonMap[it.lesson] = gaLessonMap[it.lesson] || { lv, n: 0 };
          e.n++;
        }
      }
    }
    return gaLessonMap[id];
  };
  const articlesHtml = [];
  const audioRequests = [];
  const audioSeen = new Set();
  const lessonPages = []; // for individual page generation
  await LESSON_WORDS.lib.init();   // kuromoji for the lessons' tap-a-word spans
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
      // clicking the text ticks it. Checklist pages (N5_grammar_list …): an item
      // that a lesson teaches (questions/grammar-list-map.json, keyed by the
      // item's zh text) ticks that grammar point — data-g, the same 'g:lessonNN#K'
      // state as the lesson's "got it" — and gets a → link to it.
      const glMap = GL_MAP[file.id];
      html = html.replace(/<li>(<input type="checkbox" data-lesson[^>]*>)([\s\S]*?)<\/li>/g, (m, input, body) => {
        const zh = ((body.match(/<span class="lang-zh">([\s\S]*?)<\/span>/) || [])[1] || body).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        const ref = glMap && glMap[zh];
        if (!ref) return `<li><label>${input}${body}</label></li>`;
        const slug = pointSlug(ref), [lid] = ref.split("#");
        return `<li><label>${input.replace("<input ", `<input data-g="${ref}" `)}${body}</label> <a class="gl-go" href="${SITE_PATH}${lid}/${slug ? "#" + encodeURI(slug) : ""}" aria-label="${lid}">→</a></li>`;
      });

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
      const lessonMetaHtml = `<div class="lesson-meta"><span class="lang-zh">📅 最后更新 <time datetime="${lessonLastMod}">${lessonLastMod}</time> · ⏱ 阅读约 ${readingMin} 分钟</span><span class="lang-en">📅 Updated <time datetime="${lessonLastMod}">${lessonLastMod}</time> · ⏱ ${readingMin} min read</span>` +
        // share this lesson (settings-modal.js handles [data-jp-share])
        (/^lesson\d/.test(file.id) ? ` <button type="button" class="lesson-share" data-jp-share="lesson"><span class="lang-zh">↗ 分享这一课</span><span class="lang-en">↗ Share this lesson</span></button></div>` : ` <button type="button" class="lesson-share" data-jp-share="page"><span class="lang-zh">↗ 分享这一页</span><span class="lang-en">↗ Share this page</span></button></div>`);
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

      // Grammar points the real test has asked (EXAM_SEEN): a line under the
      // numbered heading with the sittings and a link to the level's list.
      html = html.replace(/(<h2\b[^>]*>)([\s\S]*?)(<\/h2>)/g, (m, open, content) => {
        const no = (content.replace(/<[^>]+>/g, "").match(/^\s*(\d+)\./) || [])[1];
        const lvs = no ? examLevels(EXAM_SEEN[`${file.id}#${no}`], groupLevel) : [];
        if (!lvs.length) return m;
        const ZH = (ys) => ys.map((y) => `${y.slice(0, 4)}年${+y.slice(5)}月`).join("、");
        const EN = (ys) => ys.map((y) => `${+y.slice(5) === 7 ? "Jul" : "Dec"} ${y.slice(0, 4)}`).join(", ");
        const href = (lv) => `${SITE_PATH}jlpt-${lv.toLowerCase()}-past-exam-grammar/`;
        if (lvs.length === 1) {
          const { lv, years } = lvs[0];
          return `${m}\n<p class="exam-seen"><span class="lang-zh">📝 ${lv} 真题考过 ${years.length} 次${examOf(lv, false)}：${ZH(years)}（<a href="${href(lv)}">${lv} 历年真题语法</a>）</span><span class="lang-en">📝 On past JLPT ${lv} tests ${years.length === 1 ? "once" : `${years.length} times`}${examOf(lv, true)}: ${EN(years)} (<a href="${href(lv)}">${lv} grammar from past tests</a>)</span></p>`;
        }
        // tested at several levels: counts per level, the sittings on hover
        const zh = lvs.map(({ lv, years }) => `<a href="${href(lv)}" title="${ZH(years)}">${lv} 考过 ${years.length} 次${examOf(lv, false)}</a>`).join(" · ");
        const en = lvs.map(({ lv, years }) => `<a href="${href(lv)}" title="${EN(years)}">${lv} ${years.length}×${examOf(lv, true)}</a>`).join(" · ");
        return `${m}\n<p class="exam-seen"><span class="lang-zh">📝 真题：${zh}</span><span class="lang-en">📝 On past JLPT tests: ${en}</span></p>`;
      });
      // "Got it" on every numbered grammar point (not practice / comparison /
      // review headings), first in the exam line when there is one. State: the
      // gm script in the page (jp_grammar_checks 'g:lessonNN#K').
      if (/^lesson\d/.test(file.id)) {
        html = html.replace(/(<h2\b[^>]*>([\s\S]*?)<\/h2>)(\n<p class="exam-seen">)?/g, (m, h2, content, exam) => {
          const text = content.replace(/<[^>]+>/g, "");
          const no = (text.match(/^\s*(\d+)\./) || [])[1];
          // comparison tables and reviews are not points; "比较表达" (comparatives) is
          if (!no || PRACTICE_HEADING.test(text) || /比较表(?!达)|比較表(?!現)|对比表|辨析|复习|总结|\svs\s|Review|Summary/i.test(text)) return m;
          // + the "add to my grammar cards" toggle (/my-grammar/, 'gs:lessonNN#K')
          const btn = `<button type="button" class="gotit" data-g="${file.id}#${no}" aria-pressed="false"><span class="lang-zh">已掌握</span><span class="lang-en">Got it</span></button><button type="button" class="gotit gotit-add" data-ga="${file.id}#${no}" aria-pressed="false"><span class="lang-zh">语法卡</span><span class="lang-en">Grammar card</span></button>` +
            // share this grammar point: the link goes to its section (data-sec: the heading
            // just above; settings-modal.js reads its id when clicked)
            `<button type="button" class="gotit gotit-share" data-jp-share="point" data-sec="1" title="分享这个语法点 / Share this grammar point"><span class="lang-zh">↗ 分享</span><span class="lang-en">↗ Share</span></button>`;
          return exam ? `${h2}${exam}${btn}` : `${h2}\n<p class="exam-seen">${btn}</p>`;
        });
      }

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
        // Tap-a-word (site/word-tip.js): the sentence's [surface, lemma] pairs,
        // and the words go into this lesson's dictionary (LESSON_WORDS below).
        let wsp = "";
        if (/^lesson\d/.test(file.id)) {
          LESSON_WORDS.lib.wordsOf(`page:${file.id}`, [plain]);
          const sp = LESSON_WORDS.lib.spansOf(plain);
          if (sp.length) wsp = ` data-wsp="${JSON.stringify(sp).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
        }
        // Only show 🔊 once the mp3 exists (build-audio.py fills the gaps).
        if (!AUDIO_FILES.has(audioId)) return `<li data-ja data-ex${attrs}${wsp}>${content}</li>`;
        return `<li data-ja data-ex${attrs}${wsp} data-audio="${audioId}">${content}</li>`;
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
      // Lesson pages: the vocabulary table's words are tappable too (their own
      // reading and meaning win in the dictionary), and the page gets the
      // word-tip script with this lesson's dictionary (one per language).
      if (/^lesson\d/.test(file.id)) html = LESSON_WORDS.page(file.id, group.label, md, html);
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
      ${practiceItems.some((q) => q.href.endsWith("-grammar-audio/")) ? `<a class="nav-item nav-overview" href="${SITE_PATH}grammar-audio/"><span class="lang-zh">语法听读</span><span class="lang-en">Grammar audio</span></a>` : ""}
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
      <a href="${SITE_PATH}changelog/"><span class="lang-zh">更新日志</span><span class="lang-en">What's new</span></a>
      <a href="${SITE_PATH}privacy/"><span class="lang-zh">隐私政策</span><span class="lang-en">Privacy</span></a>
      <a href="${SITE_PATH}terms/"><span class="lang-zh">使用条款</span><span class="lang-en">Terms</span></a>
      <a href="${SITE_PATH}contact/"><span class="lang-zh">联系我们</span><span class="lang-en">Contact</span></a>
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
    <button type="button" class="m-btn js-ruby-btn" aria-label="汉字注音 / Furigana"><span class="ruby-ico" aria-hidden="true"><span>あ</span>漢</span></button>
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
  // Lesson 今日练习: which exercise's answers get opened (sec = the A / B / C of
  // the heading above), to see whether readers do the static exercises.
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d || d.tagName !== 'DETAILS' || !d.open || location.pathname.indexOf('/lesson') < 0) return;
    var s = d.querySelector('summary'), st = s ? s.textContent : '';
    if (st.indexOf('答案') < 0 && st.toLowerCase().indexOf('answer') < 0) return;
    var h = d.previousElementSibling;
    while (h && ['H2', 'H3', 'H4'].indexOf(h.tagName) < 0) h = h.previousElementSibling;
    var t = h ? h.textContent.trim() : '', sec = 'ABCDEFGH'.indexOf(t.charAt(0)) >= 0 && '.．'.indexOf(t.charAt(1)) >= 0 ? t.charAt(0) : '';
    if (window.gaEvent) window.gaEvent('lesson_answer_open', { sec: sec, page: location.pathname });
  }, true);

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
        const cell = (kind) => { const pg = pages.find((q) => q.href.endsWith(`-${kind}/`)); return pg && label[kind][0] ? `<td><a href="${pg.href}"><span class="visually-hidden"><span class="lang-zh">${quizLinkText(pg, lv, false).replace(/^\S+ /, "")}：</span><span class="lang-en">${quizLinkText(pg, lv, true).replace(/^\S+ /, "")}: </span></span><span class="lang-zh">${label[kind][0]}</span><span class="lang-en">${label[kind][1]}</span></a></td>` : `<td class="none">–</td>`; };
        return `
        <tr><th scope="row"><span class="level-tag">${lv}</span></th>${practiceKinds.map((k) => cell(k[0])).join("")}</tr>`;
      }).join("")}
      </tbody>
    </table></div>
  </section>`;
  const homeQuestionCount = (Math.floor(QUIZ_LEVELS.reduce((n, lv) => n + loadQuizLevel(lv).qs.length, 0) / 100) * 100).toLocaleString("en-US") + "+";
  // The hero shows what the site is by being it: one sentence, marked the way
  // a teacher marks a notebook (the grammar point in red, a note beside it).
  const homeMainHtml = `<header class="home-hero">
    <div class="hero-copy">
      <h1><span class="lang-zh">jpnotes — JLPT N5 到 N1 语法讲解与题库</span><span class="lang-en">jpnotes — JLPT N5 to N1 grammar and practice</span></h1>
      <p class="home-intro">
        <span class="lang-zh">免费 · <strong>${homeQuestionCount} 道题</strong>，每题都有解析 · 听力、阅读、模拟考 · <strong>${totalLessons} 课</strong>语法讲解</span>
        <span class="lang-en">Free · <strong>${homeQuestionCount} questions</strong>, each one explained · listening, reading, mock tests · <strong>${totalLessons} grammar lessons</strong></span>
      </p>
    </div>
    <div class="home-actions">${quizPages("N5").length ? `
        <a class="btn-primary" id="home-start" href="practice/"><span class="lang-zh">开始做题</span><span class="lang-en">Start practising</span></a>
        <a class="btn-secondary" href="lesson01/"><span class="lang-zh">从第 1 课学语法</span><span class="lang-en">Learn from lesson 1</span></a>` : `
        <a class="btn-primary" href="lesson01/"><span class="lang-zh">从第 1 课开始</span><span class="lang-en">Start with lesson 1</span></a>`}
        <a class="btn-quiet" href="anki/"><span class="lang-zh">Anki 卡组</span><span class="lang-en">Anki decks</span></a>
    </div>
    <figure class="hero-note" id="hero-note">
      <p class="hero-ja" lang="ja"><ruby>薬<rp>(</rp><rt>くすり</rt><rp>)</rp></ruby>を<ruby>飲<rp>(</rp><rt>の</rt><rp>)</rp></ruby>んだ<strong>のに</strong>、まだ<ruby>痛<rp>(</rp><rt>いた</rt><rp>)</rp></ruby>い。</p>
      <p class="hero-tr"><span class="lang-zh">明明吃了药，还是疼。</span><span class="lang-en">I took the medicine, and it still hurts.</span></p>
      <figcaption><b lang="ja">〜のに</b><span class="lang-zh">明明……却……：结果和预想的相反，带着意外或不满。</span><span class="lang-en">even though …: the result goes against what you expected, with surprise or complaint.</span> <a href="lesson15/"><span class="lang-zh">第 15 课</span><span class="lang-en">Lesson 15</span></a></figcaption>
    </figure>${HOME_TRY_SLOT}
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
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14141e" media="(prefers-color-scheme: dark)">
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
  // /cram/: a private page for invited Google accounts (noindex, not in the sitemap,
  // linked only from their account card). An empty shell; the content comes from
  // api.jpnotes.dev (worker/src/account.js, "Private extras").
  fs.mkdirSync(path.join(__dirname, "dist", "cram"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "site", "cram.html"), path.join(__dirname, "dist", "cram", "index.html"));
  // Real icon files: Google's result favicon needs a crawlable URL, not a data: URI
  for (const f of fs.readdirSync(path.join(__dirname, "site", "icons"))) {
    fs.copyFileSync(path.join(__dirname, "site", "icons", f), path.join(__dirname, "dist", f));
  }

  // ─── Generate individual lesson pages ───
  // Pages published once per language (PAGE_LANGS); links to them on a
  // non-root copy point at that language's copy.
  const localizedPageIds = new Set([...lessonPages.map(l => l.id), "N5", "N4", "N3", "N2", "N1", "guides", "grammar", "about", "changelog", "privacy", "terms", "contact", "practice", "listening", "reading", "vocabulary", "mock-test", "grammar-audio", "words", "my-grammar", "my-notes", "review", ...["n5", "n4", "n3", "n2", "n1"].flatMap((l) => [`${l}-practice`, `${l}-listening`, `${l}-mock-test`, `${l}-cards`, `${l}-grammar-audio`, `${l}-vocabulary-list`, ...(fs.existsSync(path.join(__dirname, "questions", "kanji", `${l}.json`)) ? [`${l}-kanji`] : [])]), ...SUBSET_PAGES.flatMap((p) => p.levels.map((l) => `${l.toLowerCase()}-${p.id}`))]);
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
    const gl = gaLesson(id);
    const audioLink = gl ? `<p class="quiz-link"><a href="${SITE_PATH}${gl.lv}-grammar-audio/#ga-${id}" data-ql="audio">🎧 <span class="lang-zh">听本课语法（${gl.n} 个语法点，带例句朗读）</span><span class="lang-en">Listen to this lesson's grammar (${gl.n} point${gl.n > 1 ? "s" : ""}, examples read aloud)</span></a></p>\n` : "";
    const lessonLink = audioLink + (!total ? "" : `<div class="quiz-cta"><p><span class="lang-zh">${hasEx ? "课里的练习做完了？" : "学完这一课？"}再做 ${total} 道 JLPT 题型的在线题${withVocab ? "（语法 + 词汇）" : ""}：点了就判分、每题有解析，错题会自动记下来。</span><span class="lang-en">${hasEx ? "Done with the exercises above?" : "Finished the lesson?"} Try ${total} JLPT-style questions online${withVocab ? " (grammar + vocabulary)" : ""}: marked as you go, each explained, and the ones you miss are saved for review.</span></p><a href="${lessonHref}" data-ql="end">✍ <span class="lang-zh">JLPT ${level} 在线练习题</span><span class="lang-en">JLPT ${level} practice questions</span> →</a>${(() => {
      const more = quizPages(level).filter((q) => /-(listening|vocabulary|reading|mock-test)\/$/.test(q.href));
      return more.length ? `<p class="quiz-cta-more"><span class="lang-zh">同级别还有：</span><span class="lang-en">More ${level} practice:</span> ${more.map((q) => `<a href="${q.href}" data-ql="more"><span class="lang-zh">${quizLinkText(q, level, false).replace(/^\S+ /, "")}</span><span class="lang-en">${quizLinkText(q, level, true).replace(/^\S+ /, "")}</span></a>`).join(" · ")}</p>` : "";
    })()}</div>\n`);
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
      // 今日练习: at the end of each opened answer, the lesson's online questions
      // (just checked your answers — here's the next thing to do).
      if (/^<h2[^>]*\bid="(练习|今日练|今日練)/.test(part)) {
        // Answers written out under the questions (N3–N1 lessons: a **答案** /
        // ### 答案 block at the end of each language block) are folded like the
        // N5/N4 ones, so they don't give the exercise away.
        part = part.replace(/(?:<p><strong>(答案|Answers)<\/strong><\/p>|<h3[^>]*>(答案|Answers)<\/h3>)\n?([\s\S]*?)(?=<\/div>)/g,
          (m, a, b, body) => `<details class="ans-fold"><summary>${a || b}</summary>\n${body}</details>\n`);
      }
      if (total && /^<h2[^>]*\bid="(练习|今日练|今日練)/.test(part)) {
        part = part.replace(/<\/details>/g, `<p class="quiz-link quiz-link-ans"><a href="${lessonHref}" data-ql="answers">✍ <span class="lang-zh">做本课的选择题（${total} 题，自动判分）</span><span class="lang-en">Try this lesson's multiple-choice questions (${total}, marked for you)</span> →</a></p></details>`);
      }
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
.back-link { display: block; margin-bottom: 1.5rem; color: var(--link); text-decoration: none; font-size: 0.9rem; }
.back-link:hover { text-decoration: underline; }
.breadcrumb { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.breadcrumb a { color: var(--text-muted); text-decoration: none; }
.breadcrumb a:hover { color: var(--link); text-decoration: underline; }
.breadcrumb .sep { margin: 0 0.4em; }
.prev-next { display: flex; justify-content: space-between; align-items: flex-start; margin: 2.5rem 0 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); gap: 1rem; }
.prev-next-top { margin: 0 0 1.75rem; padding: 0 0 1rem; border-top: none; border-bottom: 1px solid var(--border); }
.pn-link { font-size: 0.9rem; color: var(--link); text-decoration: none; max-width: 48%; }
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
  <article class="lesson active">${presentLesson(addQuizLinks(lesson.html, lesson.id, lessonLevel), lesson)}</article>
  <nav class="prev-next" aria-label="lesson navigation">
    ${prevHtml}
    ${nextHtml}
  </nav>
  <div id="quiz-feedback" data-fb="lesson"></div>
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
  // A link to something inside a folded <details> (the vocabulary table) opens it.
  function openHash() {
    var id = ''; try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    var el = id && document.getElementById(id), d = el && el.closest('details');
    if (d && !d.open) { d.open = true; el.scrollIntoView(); }
  }
  openHash();
  window.addEventListener('hashchange', openHash);
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
  // A value is the time of the tick (ms; 1 before 2026-11-18), negative once
  // unticked, so sync.js can merge two devices' boxes by whichever was later.
  // A checklist item a lesson teaches carries data-g: its state is that grammar
  // point's 'g:lessonNN#K' (the lessons' "got it"). Ticks saved before 2026-11-23
  // were by position ('N5_grammar_list:7'); they move to the point once.
  function keyOf(cb) { var g = cb.getAttribute('data-g'); return g ? 'g:' + g : cb.getAttribute('data-lesson') + ':' + cb.getAttribute('data-idx'); }
  (function migrate() {
    var c = loadChecks(), moved = false;
    boxes.forEach(function(cb){
      var g = cb.getAttribute('data-g'), old = cb.getAttribute('data-lesson') + ':' + cb.getAttribute('data-idx');
      if (g && c[old] && c['g:' + g] == null) { c['g:' + g] = c[old]; moved = true; }
    });
    if (moved) { saveChecks(c); if (window.jpSync) window.jpSync.changed(); }
  })();
  function applyChecks() {
    var checks = loadChecks();
    boxes.forEach(function(cb){
      var on = (checks[keyOf(cb)] || 0) > 0;
      cb.checked = on; cb.closest('li').classList.toggle('checked', on);
    });
    updateProgress();
  }
  boxes.forEach(function(cb){
    cb.addEventListener('change', function(){
      var c = loadChecks();
      var k = keyOf(this);
      c[k] = this.checked ? Date.now() : -Date.now();
      saveChecks(c);
      applyChecks();   // other items on the same grammar point follow
      if (window.jpSync) window.jpSync.changed();
    });
  });
  document.addEventListener('jp-checks', applyChecks);   // ticks from another device arrived
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
  applyChecks();
})();
// "Got it" per grammar point (button.gotit[data-g] under lesson headings and in
// the past-test grammar tables): the same jp_grammar_checks store as the boxes,
// key 'g:lessonNN#K' (or 'g:x:N2:pattern' for patterns without a lesson),
// value ±ms, so sync.js carries and merges it. #gotit-sum (past-test pages) shows
// how many are done and can hide the done rows.
(function(){
  var btns = document.querySelectorAll('button.gotit[data-g]');
  if (!btns.length) return;
  var K = 'jp_grammar_checks', zh = (document.documentElement.lang || '').indexOf('zh') === 0;
  function load() { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } }
  function save(c) { try { localStorage.setItem(K, JSON.stringify(c)); } catch (e) {} }
  var sum = document.getElementById('gotit-sum'), hide = false;
  try { hide = localStorage.getItem('jp_gm_hide') === '1'; } catch (e) {}
  function summary() {
    if (!sum) return;
    var all = 0, done = 0, hi = 0, hiDone = 0;
    btns.forEach(function (b) {
      var on = b.getAttribute('aria-pressed') === 'true', n = +b.getAttribute('data-n') || 0;
      all++; if (on) done++;
      if (n >= 3) { hi++; if (on) hiDone++; }
    });
    sum.innerHTML = '<span class="gotit-sum-t">' + (zh
        ? '已掌握 <b>' + done + '</b> / ' + all + (hi ? ' · 考过 3 次以上的 <b>' + hiDone + '</b> / ' + hi : '')
        : 'Got <b>' + done + '</b> of ' + all + (hi ? ' · tested 3+ times: <b>' + hiDone + '</b> of ' + hi : '')) +
      '</span><button type="button" class="gotit-hide" aria-pressed="' + hide + '">' + (zh ? '只看没掌握的' : 'Hide the ones I know') + '</button>';
    document.documentElement.classList.toggle('gotit-hiding', hide);
  }
  function apply() {
    var c = load();
    btns.forEach(function (b) {
      var on = (c['g:' + b.getAttribute('data-g')] || 0) > 0;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = on ? (zh ? '已掌握（再点一下取消）' : 'Got it (tap again to undo)') : (zh ? '标记为已掌握' : 'Mark as learned');
      var row = b.closest('tr'); if (row) row.classList.toggle('gotit-on', on);
    });
    // "＋ 语法卡" (button.gotit-add[data-ga]): in /my-grammar/'s review list ('gs:…' > 0)
    adds.forEach(function (b) {
      var on = (c['gs:' + b.getAttribute('data-ga')] || 0) > 0;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = on ? (zh ? '已在我的语法卡（再点一下移出）' : 'In my grammar cards (tap again to remove)') : (zh ? '加入我的语法卡，之后在「我的语法卡」页背' : 'Add to my grammar cards, to study on the grammar cards page');
    });
    summary();
  }
  var adds = document.querySelectorAll('button.gotit-add[data-ga]');
  document.addEventListener('click', function (e) {
    var h = e.target.closest && e.target.closest('.gotit-hide');
    if (h) { hide = !hide; try { localStorage.setItem('jp_gm_hide', hide ? '1' : '0'); } catch (x) {} summary(); return; }
    var ad = e.target.closest && e.target.closest('button.gotit-add[data-ga]');
    if (ad) {
      var c2 = load(), k2 = 'gs:' + ad.getAttribute('data-ga'), on2 = !((c2[k2] || 0) > 0);
      c2[k2] = on2 ? Date.now() : -Date.now();
      save(c2); apply();
      if (window.jpSync) window.jpSync.changed();
      if (window.gaEvent) window.gaEvent('grammar_card_add', { g: ad.getAttribute('data-ga'), on: on2 ? 1 : 0 });
      return;
    }
    var b = e.target.closest && e.target.closest('button.gotit[data-g]');
    if (!b) return;
    var c = load(), k = 'g:' + b.getAttribute('data-g'), on = !((c[k] || 0) > 0);
    c[k] = on ? Date.now() : -Date.now();
    save(c); apply();
    if (window.jpSync) window.jpSync.changed();
    if (window.gaEvent) window.gaEvent('grammar_mastered', { g: b.getAttribute('data-g'), on: on ? 1 : 0, page: location.pathname });
  });
  document.addEventListener('jp-checks', apply);   // ticks from another device arrived
  apply();
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
.overview-day { font-size: .75rem; font-weight: 700; color: var(--link); white-space: nowrap; }
.overview-title { font-size: .95rem; font-weight: 600; color: var(--text-strong); }
.overview-points { display: flex; flex-wrap: wrap; gap: .3rem; }
.grammar-pill { font-size: .75rem; background: var(--chip-bg); color: var(--text-muted); padding: .15rem .5rem; border-radius: var(--radius-sm); }
.overview-table { width: 100%; border-collapse: collapse; margin: 1rem 0 2rem; font-size: .9rem; }
.overview-table th { background: var(--word-bg); font-weight: 600; padding: .5rem .8rem; text-align: left; border: 1px solid var(--border); }
.overview-table td { padding: .4rem .8rem; border: 1px solid var(--border); }
.overview-table td:first-child { font-weight: 500; }
.overview-table a { color: var(--link); text-decoration: none; }
.overview-table a:hover { text-decoration: underline; }
.level-stats { display: flex; gap: 2rem; margin: 1rem 0; padding: 1rem 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.level-stat strong { display: block; font-size: 1.6rem; color: var(--text-strong); }
.level-stat span { font-size: .8rem; color: var(--text-muted); }
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
  <p class="ov-quiz">${quizPages(level).map((q) => `<a href="${q.href}"><span class="lang-zh">${quizLinkText(q, level, false)}</span><span class="lang-en">${quizLinkText(q, level, true)}</span></a>`).join("")}${fs.existsSync(path.join(__dirname, "questions", "kanji", `${level.toLowerCase()}.json`)) ? `<a href="${SITE_PATH}${level.toLowerCase()}-kanji/"><span class="lang-zh">漢 JLPT ${level} 汉字表</span><span class="lang-en">漢 JLPT ${level} kanji list</span></a>` : ""}</p>
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
    // Process :::zh / :::en bilingual blocks (same pattern as lesson md);
    // also used for pages/changelog.md below.
    var bilingualMdHtml = async (md) => {
      let html = await marked.parse(md.replace(
        /^:::(zh|en)\s*\n([\s\S]*?)^:::\s*$/gm,
        (_, lang, content) => `<!--lang:${lang}:start-->\n${content.trim()}\n\n<!--lang:${lang}:end-->`
      ));
      html = html.replace(/<!--lang:(zh|en):start-->/g, (_, lang) =>
        lang === "zh" ? '<div class="lang-zh" lang="zh-CN">' : '<div class="lang-en" lang="en">'
      );
      html = html.replace(/<!--lang:(zh|en):end-->/g, '</div>');
      // Bilingual headings: <h2>中文||English</h2>
      return html.replace(
        /(<h[1-6][^>]*>)(.+?)\|\|(.+?)(<\/h[1-6]>)/g,
        (_, open, zh, en, close) =>
          `${open}<span class="lang-zh">${zh.trim()}</span><span class="lang-en">${en.trim()}</span>${close}`
      );
    };
    const aboutHtml = await bilingualMdHtml(aboutMd);
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

    // `p` lets other markdown pages reuse this shell (changelog): html,
    // schema type, og image, breadcrumb label; nothing given = the About page.
    var renderAbout = (lang, m, lv, p = {}) => `<!DOCTYPE html>
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
<meta property="og:image" content="${p.og || aboutOgImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${m.title}">
<meta name="twitter:description" content="${m.desc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${p.og || aboutOgImage}">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "${p.type || "AboutPage"}",
  "name": "${m.name}",
  "description": "${m.desc.replace(/"/g, '\\"')}",
  "url": "${lv.url}",
  "inLanguage": "${lang.htmlLang}",
  "isPartOf": { "@type": "WebSite", "name": "${m.site}", "url": "${SITE}" }${p.type ? "" : `,
  "mainEntity": {
    "@type": "Person",
    "name": "Ralphbupt",
    "url": "https://github.com/Ralphbupt",
    "email": "hello@jpnotes.dev",
    "sameAs": ["https://github.com/Ralphbupt"]
  }`}
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
.about-content a { color: var(--link); text-decoration: none; }
.about-content a:hover { text-decoration: underline; }
.about-content code { background: var(--code-bg); padding: .1rem .3rem; border-radius: var(--radius-sm); font-size: .9em; }
.about-content strong { color: var(--text-strong); }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}">jpnotes.dev</a><span class="sep">›</span><span><span class="lang-zh">${p.crumbZh || "关于本站"}</span><span class="lang-en">${p.crumbEn || "About"}</span></span>
  </nav>
  <article class="about-content">${p.html || aboutHtml}</article>
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

  // ─── Changelog (/changelog/, pages/changelog.md): notable updates, newest first ───
  const changelogMdPath = path.join(__dirname, "pages/changelog.md");
  let changelogGenerated = false;
  if (aboutPageGenerated && fs.existsSync(changelogMdPath)) {
    const html = await bilingualMdHtml(fs.readFileSync(changelogMdPath, "utf-8"));
    const meta = {
      en: { title: "What's New on jpnotes.dev — Changelog", desc: "Notable updates to jpnotes.dev, newest first: new lessons and grammar points, practice questions, mock tests, listening and study tools for JLPT N5–N1.",
        keywords: "jpnotes.dev changelog, what's new, JLPT practice updates", name: "What's New on jpnotes.dev", site: "jpnotes.dev", crumb: "What's New" },
      zh: { title: "更新日志 | jpnotes.dev 最近更新了什么", desc: "jpnotes.dev 的重要更新记录（最新在前）：新增的语法课与语法点、练习题、模拟考、听力和学习工具，覆盖 JLPT N5–N1。",
        keywords: "jpnotes.dev 更新日志, 最近更新, JLPT 题库更新", name: "jpnotes.dev 更新日志", site: "jpnotes.dev", crumb: "更新日志" },
    };
    for (const lang of PAGE_LANGS) {
      writeLangPage("changelog", lang, localizePage(renderAbout(lang, meta[lang.code], langVariant("changelog", lang),
        { html, type: "WebPage", og: `${SITE}og-image.png`, crumbZh: "更新日志", crumbEn: "What's New" }), lang, localizedPageIds));
    }
    changelogGenerated = true;
    console.log("  Generated dist/changelog/index.html");
  }

  // ─── Privacy policy, terms of use, contact (pages/{id}.md; 2026-11-24, AdSense
  // trust pages): the same shell as About, linked from every page's footer. ───
  const policyPages = [];
  if (aboutPageGenerated) {
    const POLICY = {
      privacy: {
        en: { title: "Privacy Policy — jpnotes.dev", desc: "What jpnotes.dev collects, why, where it is kept and how to delete it: analytics, cookies, accounts and progress sync, notes, Ask AI, feedback and advertising.", keywords: "jpnotes.dev privacy policy, cookies", name: "Privacy Policy", site: "jpnotes.dev", crumb: "Privacy" },
        zh: { title: "隐私政策 | jpnotes.dev", desc: "jpnotes.dev 收集什么、为什么收集、存在哪里、怎么删除：访问统计、Cookie、登录与同步、笔记、问 AI、反馈和广告。", keywords: "jpnotes.dev 隐私政策, Cookie", name: "隐私政策", site: "jpnotes.dev", crumb: "隐私政策" },
        crumbZh: "隐私政策", crumbEn: "Privacy",
      },
      terms: {
        en: { title: "Terms of Use — jpnotes.dev", desc: "The terms for using jpnotes.dev: the CC BY-NC content licence, accuracy, accounts and public notes, and the service as is.", keywords: "jpnotes.dev terms of use", name: "Terms of Use", site: "jpnotes.dev", crumb: "Terms" },
        zh: { title: "使用条款 | jpnotes.dev", desc: "使用 jpnotes.dev 的条款：CC BY-NC 内容授权、内容准确性、账号与公开笔记的规则、服务说明。", keywords: "jpnotes.dev 使用条款", name: "使用条款", site: "jpnotes.dev", crumb: "使用条款" },
        crumbZh: "使用条款", crumbEn: "Terms",
      },
      contact: {
        en: { title: "Contact jpnotes.dev", desc: "How to reach jpnotes.dev: email hello@jpnotes.dev, the feedback box on every page, or GitHub issues for mistakes in the lessons.", keywords: "contact jpnotes.dev", name: "Contact", site: "jpnotes.dev", crumb: "Contact" },
        zh: { title: "联系我们 | jpnotes.dev", desc: "联系 jpnotes.dev：邮件 hello@jpnotes.dev、每页底部的反馈框，或在 GitHub 提交错误。", keywords: "jpnotes.dev 联系方式", name: "联系我们", site: "jpnotes.dev", crumb: "联系我们" },
        crumbZh: "联系我们", crumbEn: "Contact",
      },
    };
    for (const [id, pm] of Object.entries(POLICY)) {
      const md = path.join(__dirname, "pages", `${id}.md`);
      if (!fs.existsSync(md)) continue;
      const html = await bilingualMdHtml(fs.readFileSync(md, "utf-8"));
      for (const lang of PAGE_LANGS) {
        writeLangPage(id, lang, localizePage(renderAbout(lang, pm[lang.code], langVariant(id, lang),
          { html, type: id === "contact" ? "ContactPage" : "WebPage", og: `${SITE}og-image.png`, crumbZh: pm.crumbZh, crumbEn: pm.crumbEn }), lang, localizedPageIds));
      }
      policyPages.push(id);
      console.log(`  Generated dist/${id}/index.html`);
    }
  }

  // ─── Practice question pages (build-quiz.js → dist/quiz/*.json, site/quiz.js) ───
  const quizBundles = await buildQuiz(async (text) => fixReadings(await furiganaText(kuro, text)));
  {
    const homePath = path.join(__dirname, "dist", "index.html");
    fs.writeFileSync(homePath, fs.readFileSync(homePath, "utf-8").replace(HOME_TRY_SLOT, () => homeTryHtml(quizBundles)), "utf-8");
  }
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
  // Grammar audio pages (see "Grammar audio" in the level loop): the list is in the
  // HTML (readable without JS, and by search engines); each line carries data-l,
  // its index in the track's timing, which is the same order for both languages.
  const GA_JS = fs.readFileSync(path.join(__dirname, "site", "grammar-audio.js"), "utf-8");
  const GA_JS_HASH = require("crypto").createHash("md5").update(GA_JS).digest("hex").slice(0, 8);
  // Tap-a-word on the audio pages' example sentences (site/word-tip.js, the
  // practice pages' 生词本 card): each example gets its [surface, lemma] pairs
  // (`wsp`, build-words.js), and the page a small dictionary per language
  // (lemma → [reading, meaning] or → "部屋" alias), fetched on the first tap.
  // `extra` = { lemma: { r, zh, en } } that win (a vocabulary list's own words).
  const WORDS_LIB = require("./build-words.js");
  const WT_JS = fs.readFileSync(path.join(__dirname, "site", "word-tip.js"), "utf-8");
  const WT_JS_HASH = require("crypto").createHash("md5").update(WT_JS).digest("hex").slice(0, 8);
  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "dist", "word-tip.js"), WT_JS, "utf-8");
  const pageWords = async (page, items, extra = {}) => {
    await WORDS_LIB.init();
    const key = `page:${page}`, plainJa = (h) => h.replace(/<rt>.*?<\/rt>|<rp>.*?<\/rp>/g, "").replace(/<[^>]+>/g, "");
    for (const it of items) for (const e of it.ex || []) {
      const t = plainJa(e.ja);
      WORDS_LIB.wordsOf(key, [t]);
      const sp = WORDS_LIB.spansOf(t);
      if (sp.length) e.wsp = sp;
    }
    const d = WORDS_LIB.dictionary(key), src = {};
    for (const code of ["zh", "en"]) {
      const out = {};
      for (const [k, v] of Object.entries(d)) out[k] = typeof v === "string" ? v : extra[k] ? [extra[k].r, extra[k][code]] : v[1] ? [v[0], v[1][code]] : [v[0]];
      const file = `w-${page}.${code}.json`;
      fs.mkdirSync(path.join(__dirname, "dist", "quiz"), { recursive: true });
      fs.writeFileSync(path.join(__dirname, "dist", "quiz", file), JSON.stringify(out));
      src[code] = `${SITE_PATH}quiz/${file}?v=${require("crypto").createHash("md5").update(JSON.stringify(out)).digest("hex").slice(0, 8)}`;
    }
    return src;
  };
  const VL_JS = fs.readFileSync(path.join(__dirname, "site", "vocab-list.js"), "utf-8");
  const VL_JS_HASH = require("crypto").createHash("md5").update(VL_JS).digest("hex").slice(0, 8);
  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "dist", "vocab-list.js"), VL_JS, "utf-8");
  const gaEsc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // `o` (vocabulary list pages): group(it) → { id, label, sub } instead of lessons,
  // itemHead(it, g) for the item's first line, tocLabel / groupMode / note texts.
  const grammarAudioBody = (ga, code, page, o = {}) => {
    const zh = code === "zh", t = (a, b) => (zh ? a : b), tr = ga.tracks[code];
    // Grouped by lesson, with a row of lesson chips on top (tap = jump there and play).
    const lessonTitle = (id) => {
      for (const lvl of ["N5", "N4", "N3", "N2", "N1"]) {
        const dir = path.join(__dirname, "grammar", lvl), f = fs.existsSync(dir) && fs.readdirSync(dir).find((x) => x.startsWith(id + "_"));
        if (!f) continue;
        const h = fs.readFileSync(path.join(dir, f), "utf-8").split("\n")[0].replace(/^#\s*Lesson\s*\d+\s*[–-]\s*/, "").split("||");
        return (zh ? h[0] : h[1] || h[0]).split(/\s+—\s+/)[0].trim();
      }
      return "";
    };
    // Per point: pattern (+ N2 exam years), connection, meaning, the examples read
    // in the track (`read`, each with its translation as a line of its own), a
    // confusables line, and the lesson's other examples folded (own lesson mp3s).
    // Line order = the track's: g, m, then e, t per read example.
    let l = 0, lastLesson = "", no = 0;
    const toc = [];
    const exHtml = (e, ja, tr) => `<div class="ga-ex"><p${ja}><span lang="ja"${e.wsp ? ` data-wsp="${gaEsc(JSON.stringify(e.wsp))}"` : ""}>${e.ja}</span></p><p class="ga-tr"${tr}>${gaEsc(e[code])}</p></div>`;
    const rows = ga.items.map((it) => {
      const g = l++, m = l++;
      let head = "";
      if (it.lesson !== lastLesson) {
        lastLesson = it.lesson;
        const gr = o.group ? o.group(it) : null;
        const num = +it.lesson.replace(/\D/g, ""), title = gr ? gr.sub : lessonTitle(it.lesson);
        toc.push(`<a href="#ga-${it.lesson}" data-go="${g}">${gr ? gr.chip : num}</a>`);
        head = `<h2 class="ga-lh" id="ga-${it.lesson}" data-go="${g}">${gr ? gr.label : t(`第 ${num} 课`, `Lesson ${num}`)}<small>${gaEsc(title)}</small><span class="ga-pl" data-go="${g}" data-lesson="1">▶ ${gr ? t("播放本组", "Play group") : t("播放本课", "Play lesson")}</span></h2>`;
      }
      const more = it.ex.slice(it.read), vs = it.vs ? it.vs[code] : "", exam = it.exam || [];
      // Every level the point was tested at (the page's own first), the first
      // level's sittings written out (a tooltip is invisible on phones), and a
      // link to that level's past-test list. N4 / N5: "of the 7 tests we have".
      const all = it.examAll || (exam.length ? [{ lv: it.examLv || "", years: exam }] : []);
      const short = (lv) => (EXAM_TOTAL[lv] < 30 ? t(`（${EXAM_TOTAL[lv]} 场中）`, ` (of ${EXAM_TOTAL[lv]})`) : "");
      const ys = (y) => y.map((x) => (zh ? `${x.slice(0, 4)}.${+x.slice(5)}` : `${+x.slice(5) === 7 ? "Jul" : "Dec"} ${x.slice(0, 4)}`)).join(zh ? "、" : ", ");
      const examTag = all.length ? `<a class="ga-exam" href="${SITE_PATH}${zh ? "zh/" : ""}jlpt-${all[0].lv.toLowerCase()}-past-exam-grammar/" title="${gaEsc(all.map((x) => `${x.lv}: ${ys(x.years)}`).join(" / "))}">` +
        all.map((x, k) => k === 0 ? t(`${x.lv} 真题考过 ${x.years.length} 次${short(x.lv)}`, `On the real ${x.lv} test ${x.years.length}×${short(x.lv)}`) : t(`${x.lv} ${x.years.length} 次`, `${x.lv} ${x.years.length}×`)).join(" · ") +
        `</a><span class="ga-exam-y">${ys(all[0].years)}</span>` : "";
      return head + `<section class="ga-it"${o.itemAttr ? o.itemAttr(it) : ""}>` + (o.itemHead ? o.itemHead(it, g, ++no) : `<p class="ga-hd"><span class="ga-no">${++no}</span><span class="ga-ln ga-g" data-l="${g}" lang="ja">${gaEsc(it.term.replace(/^〜/, ""))}</span>${examTag}<a class="ga-ls" href="${SITE_PATH}${it.lesson}/">${t("讲解", "Lesson")} →</a></p>`) +
        (it.form && it.form[code] && it.form[code].length ? `<p class="ga-form">${it.form[code].map((f) => `<code>${gaEsc(f)}</code>`).join("")}</p>` : "") +
        // it.meanJa: a Japanese explanation with furigana (questions/grammar-audio/src/ja.json),
        // shown instead of the meaning when the reader picks 日本語 (#ga.ga-ja); not read aloud.
        `<p class="ga-ln ga-m${it.meanJa ? " ga-hasja" : ""}" data-l="${m}"><span class="ga-mn">${gaEsc(it.mean[code])}</span>${it.meanJa ? `<span class="ga-mj" lang="ja">${it.meanJa}</span>` : ""}</p>` +
        it.ex.slice(0, it.read).map((e) => { const a = l++, b = l++; return exHtml(e, ` class="ga-ln" data-l="${a}"`, ` data-l="${b}" data-k="t"`).replace('class="ga-tr" data-l', 'class="ga-tr ga-ln" data-l'); }).join("") +
        (vs ? `<p class="ga-vs"><span>${t("易混", "Don't confuse")}</span>${gaEsc(vs)}</p>` : "") +
        (more.length ? `<details class="ga-more"><summary>${t(`更多例句（${more.length}）`, `More examples (${more.length})`)}</summary>` +
          more.map((e) => exHtml(e, e.audio && fs.existsSync(path.join(__dirname, "audio", e.audio)) ? ` data-mp3="${AUDIO_BASE}/${e.audio}"` : "", "")).join("") + `</details>` : "") +
        `</section>`;
    });
    if (l !== tr.lines.length) throw new Error(`grammar audio ${page}: ${l} lines on the page, ${tr.lines.length} in the ${code} track — rerun tools/grammar-audio.py`);
    return `<style>
#ga-ctl{padding:.2rem 0 .6rem;border-bottom:1px solid var(--border,#ddd);margin-bottom:.4rem}
#ga-bar{position:fixed;left:0;right:0;bottom:0;z-index:60;background:var(--bg);border-top:1px solid var(--border,#ddd);box-shadow:0 -4px 16px rgba(0,0,0,.06);padding:.5rem max(1rem,calc((100vw - 760px) / 2)) calc(.5rem + env(safe-area-inset-bottom))}
#ga{padding-bottom:5rem}.ga-it,.ga-lh{scroll-margin-top:4rem}
.ga-row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.ga-row+.ga-row{margin-top:.45rem}
#ga-play{width:2.6rem;height:2.2rem;border-radius:8px;border:0;background:var(--ui);color:var(--ui-on);font-size:1rem;cursor:pointer}
#ga-play::before{content:"▶"}#ga-play.on::before{content:"❚❚"}
#ga-seek{flex:1;min-width:8rem;accent-color:var(--ui)}#ga-time{font-size:.8rem;color:var(--text-muted);font-variant-numeric:tabular-nums}
.ga-row button,.ga-row select{font:inherit;font-size:.82rem;padding:.25rem .6rem;border-radius:7px;border:1px solid var(--border,#ccc);background:var(--surface-2,transparent);color:inherit;cursor:pointer}
.ga-row button[aria-pressed=true]{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}
.ga-it{background:var(--surface-2,transparent);border:1px solid var(--border,#e5e5e5);border-radius:12px;padding:.8rem 1rem;margin:.6rem 0}
.ga-hd{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;margin:0}
.ga-no{color:var(--text-muted);font-size:.8rem}
.ga-ln{cursor:pointer;border-radius:6px;padding:.1rem .3rem;margin-left:-.3rem;margin-right:-.3rem}
.ga-ln:hover{background:var(--ui-soft)}.ga-ln.ga-cur{background:var(--chip-bg,#fff3c4);box-shadow:inset 3px 0 0 var(--ui)}
.ga-g{font-size:1.35rem;font-weight:700}.ga-ls{margin-left:auto;font-size:.8rem;white-space:nowrap}
.ga-groups{align-items:center}.ga-groups .ga-gl{font-size:.85rem;color:var(--text-muted)}.ga-groups button.on{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}.ga-groups .ga-gplay{font-weight:600}
#ga.ga-grouped h2.ga-lh,#ga-ctl.ga-grouped .ga-toc{display:none}#ga .ga-it[hidden]{display:none}
.ga-exam{font-size:.72rem;border-radius:10px;padding:.05rem .5rem;background:var(--accent);color:#fff;white-space:nowrap;text-decoration:none}.ga-exam:hover{color:#fff;opacity:.88}.ga-exam-y{font-size:.72rem;color:var(--text-muted)}
.ga-form{display:flex;flex-wrap:wrap;gap:.35rem;margin:.35rem 0 .1rem}.ga-form code{font:inherit;font-size:.85rem;background:var(--chip-bg);border-radius:6px;padding:.05rem .5rem}
.ga-m{margin:.4rem 0 .2rem}.ga-mj{display:none}#ga.ga-ja .ga-hasja .ga-mj{display:inline}#ga.ga-ja .ga-hasja .ga-mn{display:none}.ga-mj rt{font-size:.6em}
.ga-ex{margin:.55rem 0 0;padding-left:.6rem;border-left:3px solid var(--border,#ddd)}.ga-ex p{margin:0}
.ga-ex span[lang]{font-size:1.08rem}#ga b.cl{color:var(--accent);font-weight:700}
.ga-tr{font-size:.88rem;color:var(--text-muted)}
.ga-vs{font-size:.86rem;background:var(--chip-bg);border-radius:8px;padding:.4rem .6rem;margin:.7rem 0 0}.ga-vs span{color:var(--text-muted);margin-right:.5rem}
.ga-toc{display:flex;flex-wrap:wrap;gap:.3rem;margin:.45rem 0 0;font-size:.8rem;align-items:center}.ga-toc>span{color:var(--text-muted);margin-right:.2rem}
.ga-toc a{padding:.05rem .45rem;border:1px solid var(--border,#ccc);border-radius:6px;text-decoration:none;color:var(--ui)}.ga-toc a.on{background:var(--ui);color:var(--ui-on)}
.ga-lh{display:flex;align-items:baseline;gap:.6rem;font-size:1.1rem;margin:1.6rem 0 .3rem;scroll-margin-top:10rem}.ga-lh small{font-weight:400;color:var(--text-muted);font-size:.88rem}
.ga-pl{margin-left:auto;font-size:.8rem;font-weight:400;color:var(--ui);cursor:pointer;border:1px solid var(--border,#ccc);border-radius:14px;padding:.05rem .7rem;white-space:nowrap}
.ga-more{margin-top:.5rem}.ga-more summary{font-size:.82rem;color:var(--text-muted);cursor:pointer}
.ga-more .ga-ex{border-color:transparent}.ga-more p[data-mp3]{cursor:pointer;border-radius:6px}.ga-more p[data-mp3]:hover{background:var(--ui-soft)}.ga-more p.ga-cur{background:var(--chip-bg,#fff3c4)}
#ga.ga-notr .ga-tr[data-k]{opacity:.55}
#ga.ga-hidden .ga-m,#ga.ga-hidden .ga-tr{filter:blur(5px)}#ga.ga-hidden .ga-m:hover,#ga.ga-hidden .ga-tr:hover{filter:none}
.ga-note{color:var(--text-muted);font-size:.82rem;margin-top:1.2rem}
</style>
${(() => {
  const modes = `<button type="button" data-ga-mode="all" aria-pressed="true">${t("整体连播", "Play all")}</button><button type="button" data-ga-mode="one" aria-pressed="false">${t("一句一停", "One line")}</button><button type="button" data-ga-mode="loop" aria-pressed="false">${t("单句循环", "Loop line")}</button><button type="button" data-ga-mode="lesson" aria-pressed="false">${o.groupMode || t("本课连播", "This lesson")}</button>`;
  const trs = `<button type="button" id="ga-trs" aria-pressed="true">${t("念翻译", "Read translations")}</button>`, hide = `<button type="button" id="ga-hide" aria-pressed="false">${t("遮住意思", "Hide meanings")}</button>`;
  const tocNav = `<nav class="ga-toc" aria-label="${t("按课跳转", "Jump to a lesson")}"${o.settings ? " hidden" : ""}><span>${o.tocLabel || t("课：", "Lesson:")}</span>${toc.join("")}</nav>`;
  // A page with more controls (vocabulary list) keeps its own on top and folds the reading settings away
  if (o.settings) return `<div id="ga-ctl">${o.ctlExtra || ""}${o.settings({ modes, trs, hide })}${tocNav}</div>`;
  // Grammar audio (not the vocabulary list): what is read — everything, only the
  // Japanese (pattern + examples, no meaning / translation), or only the examples
  // (translations still follow 念翻译). site/grammar-audio.js data-ga-say.
  const say = o.itemHead ? "" : `<div class="ga-row ga-say" role="group" aria-label="${t("朗读内容", "What to read")}"><button type="button" data-ga-say="all" aria-pressed="true">${t("全部朗读", "Read everything")}</button><button type="button" data-ga-say="ja" aria-pressed="false">${t("只读日语", "Japanese only")}</button><button type="button" data-ga-say="ex" aria-pressed="false">${t("只读例句", "Examples only")}</button></div>`;
  // Ten points at a time (site/grammar-audio.js fills it): group chips, play
  // this group, next group, and back to the lesson view.
  const groups = o.itemHead ? "" : `<div class="ga-row ga-groups" id="ga-groups" data-zh="${zh ? 1 : 0}"></div>`;
  // 意思：中文 / 日本語 (English / 日本語): which meaning line shows. Text only — the
  // track still reads the page's language. Kept in localStorage ga_mja.
  const mja = ga.items.some((it) => it.meanJa) ? `<span class="ga-row ga-mjrow" role="group" aria-label="${t("意思用哪种语言", "Meaning in")}" style="display:inline-flex;margin-left:.2rem"><span class="sub" style="font-size:.82rem;color:var(--text-muted)">${t("意思：", "Meaning:")}</span><button type="button" data-ga-mja="0" aria-pressed="true">${t("中文", "English")}</button><button type="button" data-ga-mja="1" aria-pressed="false">日本語</button></span>
<script>(function(){var g=document.getElementById('ga'),on=false;try{on=localStorage.getItem('ga_mja')==='1'}catch(e){}
function set(v,user){on=v;var el=document.getElementById('ga');if(el)el.classList.toggle('ga-ja',v);document.querySelectorAll('[data-ga-mja]').forEach(function(b){b.setAttribute('aria-pressed',String((b.getAttribute('data-ga-mja')==='1')===v))});if(user){try{localStorage.setItem('ga_mja',v?'1':'0')}catch(e){}if(window.gaEvent)window.gaEvent('grammar_audio_ja',{on:v?1:0})}}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-ga-mja]');if(b)set(b.getAttribute('data-ga-mja')==='1',true)});
document.addEventListener('DOMContentLoaded',function(){set(on,false)});if(document.readyState!=='loading')set(on,false);})();</script>` : "";
  return `<div id="ga-ctl"><div class="ga-row">${modes}\n${trs}${hide}${mja}</div>\n${say}${groups}${tocNav}${o.ctlExtra || ""}</div>`;
})()}
<div id="ga-bar"><div class="ga-row"><button type="button" id="ga-play" aria-label="${t("播放", "Play")}" data-play="${t("播放", "Play")}" data-pause="${t("暂停", "Pause")}"></button>
<input id="ga-seek" type="range" min="0" max="1000" value="0" aria-label="${t("进度", "Position")}"><span id="ga-time">0:00 / ${Math.floor(tr.duration / 60)}:${String(Math.floor(tr.duration % 60)).padStart(2, "0")}</span>
<select id="ga-rate" aria-label="${t("语速", "Speed")}"><option value="0.8">0.8×</option><option value="1" selected>1×</option><option value="1.2">1.2×</option><option value="1.5">1.5×</option></select></div></div>
<audio id="ga-a" preload="none" src="${AUDIO_BASE}/${tr.src}"></audio>
<div id="ga" data-page="${page}" data-dur="${tr.duration}">${rows.join("\n")}</div>
<p class="ga-note">${o.note || t("点任意一行从那里开始听。空格键播放 / 暂停，← → 上一句 / 下一句。「念翻译」关掉后只听日语。朗读：Gemini TTS；「更多例句」是课程里的发音。", "Tap any line to start there. Space plays / pauses, ← → go to the previous / next line. Turn off “Read translations” to hear only the Japanese. Voices: Gemini TTS; “More examples” use the lessons’ audio.")}</p>${o.extra || ""}
<script type="application/json" id="ga-t">${JSON.stringify(tr.lines.map((x) => [x[1], x[2], x[0]]))}</script>
<script src="${SITE_PATH}grammar-audio.js?v=${GA_JS_HASH}" defer></script>` +
      (ga.words ? `<div id="wt" hidden data-src="${ga.words[code]}" data-en="${zh ? 0 : 1}" data-lv="${gaEsc(page.split("-")[0])}"></div><script src="${SITE_PATH}word-tip.js?v=${WT_JS_HASH}" defer></script>` : "");
  };
  fs.writeFileSync(path.join(__dirname, "dist", "grammar-audio.js"), GA_JS, "utf-8");
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
<meta name="description" content="${m.desc.replace(/"/g, '&quot;')}">${QUIZ_PUBLIC && !m.noindex ? "" : '\n<meta name="robots" content="noindex">'}
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
/* Sibling pages: a row of quiet chips; one scrollable line on phones. */
.quiz-head .quiz-nav { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .8rem; font-size: .8rem; line-height: 1.3; }
.quiz-head .quiz-nav a { display: inline-flex; align-items: center; flex: none; padding: .3rem .7rem; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--card-bg); color: var(--text); text-decoration: none; white-space: nowrap; }
.quiz-head .quiz-nav a:hover { border-color: var(--ui); color: var(--link); }
.quiz-head .quiz-nav .ico { margin-right: .3em; }
@media (max-width: 768px) {
  .quiz-head .quiz-nav { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin-right: -1rem; padding-right: 1rem; }
  .quiz-head .quiz-nav::-webkit-scrollbar { display: none; }
}
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
.qs-opts li { margin: .25rem 0; }
.qs-opt { font: inherit; color: inherit; text-align: left; background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius); padding: .3rem .8rem; cursor: pointer; min-width: 9rem; }
.qs-opt:hover:not(:disabled) { border-color: var(--ui); background: var(--ui-soft); }
.qs-opt:disabled { cursor: default; opacity: .75; }
.qs-opt.qs-right { opacity: 1; border-color: #1a7f4b; box-shadow: inset 0 0 0 1px #1a7f4b; }
.qs-opt.qs-wrong { opacity: 1; border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); text-decoration: line-through; }
.qs-verdict { font-weight: 700; margin: .3rem 0 .4rem; }
.qs-v-ok { color: #1a7f4b; } .qs-v-bad { color: var(--accent); }
@media (prefers-color-scheme: dark) { :root:not(.theme-light) .qs-v-ok { color: #4cc98a; } :root:not(.theme-light) .qs-opt.qs-right { border-color: #4cc98a; box-shadow: inset 0 0 0 1px #4cc98a; } }
html.theme-dark .qs-v-ok { color: #4cc98a; } html.theme-dark .qs-opt.qs-right { border-color: #4cc98a; box-shadow: inset 0 0 0 1px #4cc98a; }
.qs-next { margin: .6rem 0 0; font-weight: 600; }
.qs-slot { display: inline-block; min-width: 2.2em; border-bottom: 1px solid currentColor; text-align: center; margin: 0 .15em; }
.qs-passage, .qs-ck { font-size: .95rem; padding: .5rem .8rem; background: var(--surface-2); border-radius: var(--radius); margin: .4rem 0 .6rem; }
.qs-passage p, .qs-ck p { margin: .3rem 0; }
.qs-ck ul { list-style: none; padding: 0; margin: .3rem 0; }
.qs-nar, .qs-tr { color: var(--text-muted); }
.quiz-samples summary { cursor: pointer; color: var(--link); }
.quiz-samples details p { margin: .4rem 0; }
.quiz-about .lesson-list { columns: 2; column-gap: 2rem; padding-left: 1.2rem; }
@media (max-width: 600px) { .quiz-about .lesson-list { columns: 1; } }
.cards-index { columns: 2; column-gap: 2rem; }
.cards-index section { break-inside: avoid; margin-bottom: 1rem; }
.cards-index h3 { font-size: 1rem; margin: 0 0 .3rem; }
.cards-index ul { margin: 0; padding-left: 1.2rem; }
.cards-index li { margin: .15rem 0; }
@media (max-width: 600px) { .cards-index { columns: 1; } }
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
    // One line of technique per item type, and the guide that has the rest.
    // What the pages ranking above these had and ours didn't (2026-11-11).
    const TYPE_TIPS = {
      kanji: ["读画线汉字的读音。陷阱在长音和短音、促音「っ」、清音和浊音：先在心里读一遍，再看选项。", "Read the underlined kanji. The traps are long and short vowels, small っ and voiced sounds — say the word to yourself before you look at the options."],
      hyouki: ["给画线的假名选汉字。选项里是形近字或同音字，靠句子的意思来定。", "Pick the kanji for the underlined kana. The options are look-alike kanji or words with the same reading; the meaning of the sentence decides."],
      gokeisei: ["填前缀、后缀或复合词的一部分（再〜、〜化、〜的）。连同它常接的词一起记。", "Fill in a prefix, suffix or part of a compound (再〜, 〜化, 〜的). Learn each one together with the words it attaches to."],
      bunmyaku: ["选能填进空格的词。空格前后的词决定答案，所以背单词要连搭配的助词和动词一起背。", "Choose the word that fits the blank. The words right next to the blank decide it, so learn words with the particles and verbs they go with."],
      iikae: ["选和画线部分意思最接近的说法。看选项之前，先自己换一种说法。", "Choose the option closest in meaning to the underlined part. Put it in your own words before you read the options."],
      youhou: ["四个句子用了同一个词，只有一句自然。看它和什么搭配（主语、宾语、场合），不只看词典释义。", "Four sentences use the same word and one is natural. Check what the word combines with (subject, object, situation), not just its dictionary meaning."],
      short: ["一篇一问。先看问题；答案通常落在一句话上，多半靠近结尾。", "One question per text. Read the question first; the answer usually rests on a single sentence, often near the end."],
      mid: ["几道题按文章顺序出。画线部分和「これ・それ」指的是刚说过的内容，回到前一句去找。", "Several questions, in the order of the text. Underlined words and これ / それ point back to what was just said — reread the sentence before."],
      long: ["先扫一眼问题，再从头读一遍。题目顺着文章走，最后一题多半问作者最想说的话。", "Skim the questions, then read once from the top. The questions follow the text, and the last one usually asks for the writer's main point."],
      tougou: ["同一话题的两篇短文。先分别记下两人的立场，题目问的是相同点和不同点。", "Two texts on one topic. Note each writer's position first; the questions ask what they share and where they differ."],
      shuchou: ["一篇长的议论文。作者的主张多在最后一段，以及「しかし」这类转折词之后。", "A long opinion piece. The writer's claim tends to sit in the last paragraph and after contrast words such as しかし."],
      info: ["通知、时刻表或价目表。先看题目里的条件，只找符合条件的部分，不要通读；别漏掉「※」后面的注意事项。", "A notice, timetable or price list. Read the conditions in the question first and scan only for those — don't read the whole page, and check the notes marked ※."],
      kadai: ["对话前先播问题：这个人接下来（或最先）要做什么。计划会在对话里改变，最后定下来的才是答案。", "You hear the question before the talk: what will this person do next, or first? Plans change as they speak — the last decision is the answer."],
      point: ["先播问题，并留时间看选项。只听被问的那一点（多半是理由），其余的放过。", "The question comes first and you get time to read the options. Listen for that one thing — usually a reason — and let the rest go."],
      gaiyou: ["事先不播问题，试卷上什么都不印。抓整体的话题或说话人的看法，不追细节。", "No question beforehand and nothing printed. Follow the overall topic or the speaker's opinion, not the details."],
      hatsuwa: ["看图和箭头：箭头指的人是说话的人。三个选项播出之前，先想他是在请求、提议还是道歉。", "Look at the picture and the arrow: the person with the arrow is the one speaking. Before the three options play, decide whether they are asking, offering or apologising."],
      sokuji: ["一句短话、三个回应，试卷上不印。马上决定，然后放下这题；重复了原句里某个词的选项常常是陷阱。", "One short line and three replies, nothing printed. Decide at once and let it go — an option that repeats a word from the line is often the trap."],
      ctougou: ["较长的对话或说明，常常要比较几个选择。边听边用表格记下每个选择的特点。", "Longer talks, often comparing several choices. Note each choice's features in a grid as you listen."],
    };
    const typeTips = (keys, slug, zh, e) => {
      const li = keys.filter((k) => TYPE_TIPS[k]).map((k) => `<li><b>${tName(k)}</b> — ${L(...TYPE_TIPS[k])}</li>`).join("");
      const more = fs.existsSync(path.join(__dirname, "grammar/guides", `${slug}.md`)) ? `<p>${L("完整的做法和例子：", "The full method, with examples: ")}<a href="${SITE_PATH}${slug}/">${L(zh, e)}</a>${L("。", ".")}</p>` : "";
      return li ? `<h2>${L("每种题型怎么做", "How to answer each item type")}</h2>\n<ul>${li}</ul>${more}` : "";
    };
    const officialFaq = `<dt>${L("哪里有官方样题？", "Where are the official sample questions?")}</dt><dd>${L(`JLPT 官网免费提供每个级别的样题（含听力录音和答案）：<a href="https://www.jlpt.jp/cn/samples/forlearners.html" rel="noopener">jlpt.jp 样题</a>。量不大，适合考前按真考时间完整做一遍；平时的练习用这里的题。`, `The JLPT site has a free sample paper for each level, with listening audio and answers: <a href="https://www.jlpt.jp/e/samples/forlearners.html" rel="noopener">jlpt.jp sample questions</a>. It is short — keep it for one timed run before the exam, and use the questions here for everyday practice.`)}</dd>`;
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
${officialFaq}
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
      // The real test's count per type, from the mock (it follows the official layout).
      const onTest = {};
      for (const q of bundle.mocks[0]?.test.questions || []) if (keys.includes(q.type)) onTest[q.type] = (onTest[q.type] || 0) + 1;
      const sit = cfg.sections.find((x) => x.types.includes(keys[0])), alone = cfg.sections.length > 2 && !reading;
      const sitName = en ? sit.en : sit.zh;
      return `<section class="quiz-about">
<h2>${L(`JLPT ${level} ${reading ? "阅读" : "文字词汇"}考什么`, `What the JLPT ${level} ${reading ? "reading" : "vocabulary"} section tests`)}</h2>
<p>${reading
  ? L(`阅读在「${sitName}」这一场里，${cfg.sections.length > 2 ? "和语法一起" : "和文字词汇、语法一起"}共 ${sit.minutes} 分钟，时间自己分配，所以要给阅读留够时间。${split ? "阅读单独计分。" : "阅读和言语知识合并计分。"}真考的题型和题数：`,
      `Reading is part of the “${sitName}” sitting: ${sit.minutes} minutes shared with ${cfg.sections.length > 2 ? "grammar" : "vocabulary and grammar"}, and how you divide them is up to you — leave enough for the passages. ${split ? "Reading gets its own score." : "Reading is scored together with language knowledge."} The item types and how many of each are on the test:`)
  : L(`文字词汇${alone ? `是第一场，单独 ${sit.minutes} 分钟` : `在「${sitName}」这一场里，和语法、阅读共 ${sit.minutes} 分钟，排在最前面`}。每题只有一个词或一句话，做得快才能把时间留给后面。真考的题型和题数：`,
      `Vocabulary ${alone ? `is the first sitting, ${sit.minutes} minutes on its own` : `opens the “${sitName}” sitting, ${sit.minutes} minutes shared with grammar and reading`}. Each item is one word or one sentence; answering fast is what leaves time for the rest. The item types and how many of each are on the test:`)}</p>
<table><tr><th>${L("题型", "Item type")}</th><th>${L("真考题数", "On the test")}</th><th>${L("这里的题", "Questions here")}</th></tr>${keys.map((k) => `<tr><td>${tName(k)}</td><td>${onTest[k] || "—"}</td><td>${qs.filter((q) => q.type === k).length}</td></tr>`).join("")}</table>
<p>${reading
  ? L(`这里一共 ${qs.length} 道题、${nP} 篇原创文章，格式和真题一致，每题都有答案和解析。`, `Here: ${qs.length} questions on ${nP} original passages, laid out like the real test, each with its answer and an explanation.`)
  : L(`这里一共 ${qs.length} 道原创题，格式和真题一致，每题都有答案和解析。`, `Here: ${qs.length} original questions in the real format, each with its answer and an explanation.`)}</p>
${typeTips(keys, reading ? "jlpt-reading-tips" : "jlpt-vocabulary-grammar-tips", reading ? "JLPT 阅读做题技巧" : "JLPT 文字词汇・语法做题技巧", reading ? "JLPT reading tips" : "JLPT vocabulary and grammar tips")}
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
${officialFaq}
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
${typeTips(ckTypes, "jlpt-listening-tips", "JLPT 听力做题技巧", "JLPT listening tips")}
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
${officialFaq}
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
<h2>${L("怎么背：先回想，再打分", "How it works: recall first, then grade")}</h2>
<ol>
<li>${L("<b>先回想。</b>认卡只显示语法形式：先在心里说出它的意思、接在什么后面，再想一个例句。填空卡显示一个挖掉语法部分的例句和它的翻译：想空里该填什么。", "<b>Recall first.</b> A recognition card shows only the form: say what it means and what it attaches to, and think of an example. A fill-in card shows an example with the grammar blanked out, plus its translation: work out what goes in the gap.")}</li>
<li>${L("<b>再翻面核对。</b>背面是含义和用法说明、最多三个带振假名和发音的例句，以及到课文和这一课练习题的链接。", "<b>Then check.</b> The back has the meaning and usage notes, up to three examples with furigana and audio, and links to the lesson and to that lesson's practice questions.")}</li>
<li>${L("<b>最后打分：</b>忘了 / 难 / 记得 / 简单。每个按钮下面写着选它之后这张卡多久再出现。照实打分：回想不出来就选「忘了」。", "<b>Grade yourself:</b> Again / Hard / Good / Easy. Each button shows when the card would come back. Be honest — if nothing came to mind, press Again.")}</li>
</ol>
<h2>${L("一张卡什么时候再出现", "When a card comes back")}</h2>
<p>${L("和 Anki 一样：新卡先过两个短的学习步骤（1 分钟、10 分钟），之后按天复习，间隔由你的打分决定。", "As in Anki: a new card goes through two short learning steps (1 minute, 10 minutes), then moves to reviews measured in days, and your grade sets the next interval.")}</p>
<div class="table-scroll"><table><tr><th>${L("这张卡", "The card is")}</th><th>${L("忘了", "Again")}</th><th>${L("难", "Hard")}</th><th>${L("记得", "Good")}</th><th>${L("简单", "Easy")}</th></tr>
<tr><td>${L("新卡", "New")}</td><td>${L("1 分钟后", "1 min")}</td><td>${L("1.5 分钟后", "1.5 min")}</td><td>${L("10 分钟后", "10 min")}</td><td>${L("4 天后", "4 days")}</td></tr>
<tr><td>${L("学习中（第二步）", "Learning (second step)")}</td><td>${L("1 分钟后", "1 min")}</td><td>${L("15 分钟后", "15 min")}</td><td>${L("1 天后", "1 day")}</td><td>${L("4 天后", "4 days")}</td></tr>
<tr><td>${L("复习卡（间隔 d 天）", "In review (interval d days)")}</td><td>${L("回到学习步骤：10 分钟后重学，之后从 1 天重新开始", "Back to learning: relearn in 10 min, then start again from 1 day")}</td><td>${L("约 d × 1.2 天", "about d × 1.2 days")}</td><td>${L("d × 熟练度（初始 2.5）", "d × ease (2.5 to start)")}</td><td>${L("d × 熟练度 × 1.3 左右", "about d × ease × 1.3")}</td></tr></table></div>
<p>${L("每张卡有自己的熟练度（ease），从 2.5 开始：选「难」减 0.15，「忘了」减 0.2（最低 1.3），「简单」加 0.15。所以总觉得难的卡会出现得更勤，容易的卡间隔拉得更快。复习卡每次至少往后推 1 天（「简单」至少 2 天）。一直选「记得」的话，一张新卡会在 10 分钟后、然后 1、3、8、20、50 天后再出现；间隔达到 21 天算「熟记」。", "Every card has its own ease, starting at 2.5: Hard lowers it by 0.15 and Again by 0.2 (never below 1.3), Easy raises it by 0.15. So a card you keep finding hard comes back more often, and an easy one spreads out faster. A review always moves at least one day further out (Easy: two). Pressing Good every time, a new card returns after 10 minutes, then after 1, 3, 8, 20 and 50 days; once its interval reaches 21 days it counts as mature.")}</p>
<p>${L("每次开始背：先出到期的卡，没有到期的再出新卡；新卡按课的顺序，默认每天 10 张（设置里可选 5 / 10 / 15 / 20 / 30）。学习中的卡如果 20 分钟内到期，会接着出，不会提前结束。默认只有认卡；学过之后可以在设置里打开填空卡（例句里标出了语法部分的语法点才有填空卡）。进度和练习题记录存在这个浏览器里，登录后可以在各设备同步。", "Each session shows the cards that are due first, then new ones, in lesson order — 10 new cards a day by default (5, 10, 15, 20 or 30 in Settings). A learning card that falls due within 20 minutes is shown rather than ending the session early. Only recognition cards are on at first; turn on fill-in cards in Settings once you've met the points (a point has fill-in cards when its examples mark the grammar). Progress is kept in this browser with your practice record; sign in to sync it across devices.")}</p>
<p>${L(`更喜欢用 Anki？下载 <a href="${SITE_PATH}anki/">免费 Anki 卡组</a>（含例句音频）。想练题：<a href="${SITE_PATH}${lv}-practice/">${level} 练习题</a>。`, `Prefer Anki? Get the <a href="${SITE_PATH}anki/">free Anki decks</a> (with example audio). For questions: <a href="${SITE_PATH}${lv}-practice/">${level} practice</a>.`)}</p>
${(() => {
      // Every card's grammar point, by lesson, each linking to its section of the lesson.
      const groups = cardIndex(level), n = groups.reduce((a, g) => a + g.pts.length, 0);
      if (!n) return `<h2>${L(`${level} 语法课文`, `${level} grammar lessons`)}</h2>\n${lessonList}`;
      const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const item = ({ e, slug, head }) => {
        // Labelled as the lesson heading reads in the page's language (the card's
        // term is cut short on headings like "〜やすい（…）/ 〜にくい（…）");
        // the card's term and gloss when there is no heading text.
        const h = en ? head.en : head.zh;
        let term = h || (en ? e[4] : e[3]), desc = h ? "" : en ? e[6] : e[5];
        if (en && hasSC(desc)) desc = "";
        const gloss = desc && !term.includes(desc) ? ` — ${esc(desc)}` : "";
        return `<li><a href="${SITE_PATH}${e[2]}/${slug ? `#${encodeURIComponent(slug)}` : ""}">${esc(term)}</a>${gloss}</li>`;
      };
      return `<h2>${L(`这套卡片里的 ${n} 个 ${level} 语法点`, `The ${n} ${level} grammar points in this deck`)}</h2>
<p>${L(`按课排列，和卡片出现的顺序一致。点语法点跳到课文里讲它的那一节（接续、含义、例句、易混辨析）。`, `In lesson order, the order new cards come in. Click a point to open its section of the lesson: how it attaches, what it means, examples and look-alikes.`)}</p>
<div class="cards-index">${groups.map((g) => `<section><h3><a href="${SITE_PATH}${g.l.id}/">${g.l.id.replace("lesson", "Lesson ")} · <span lang="ja">${JA_TITLES[g.l.id] || g.l.id}</span></a></h3><ul>${g.pts.map(item).join("")}</ul></section>`).join("\n")}</div>`;
    })()}</section>`;
  };
  // The flashcard deck of a level, by lesson: build-anki.js lessonIndex() gives
  // the same entries as quiz/grammar-index.json ([id, "lessonNN#K", lesson,
  // term zh, term en, gloss zh, gloss en]); K is the lesson's "## K." heading,
  // whose id the link points at (as on the grammar list page).
  const cardIndex = (level) => lessonPages.filter((l) => l.level === level && /^lesson\d+_.*\.md$/.test(path.basename(l.filePath || ""))).map((l) => {
    const ids = {}, enHead = {}, zhHead = {};
    const unesc = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    for (const m of l.html.matchAll(/<h2[^>]*\sid="(\d+)\.([^"]*)"[^>]*>([\s\S]*?)<\/h2>/g)) {
      if (ids[m[1]]) continue;
      ids[m[1]] = unesc(`${m[1]}.${m[2]}`);
      // The heading's English side (no numbering, no romaji): the English page's label for a point the card data names in Chinese.
      const text = (h) => unesc(h.replace(/<span class="romaji">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim().replace(/^\d+[.．]\s*/, "");
      const i = m[3].indexOf('<span class="lang-en">'), j = m[3].indexOf('<span class="lang-zh">');
      if (i >= 0) enHead[m[1]] = text(m[3].slice(i));
      zhHead[m[1]] = text(j >= 0 ? m[3].slice(j, i > j ? i : undefined) : i >= 0 ? m[3].slice(0, i) : m[3]);
    }
    return { l, pts: lessonIndex(fs.readFileSync(l.filePath, "utf-8"), l.id.match(/^lesson(\d+)/)[1]).map((e) => { const k = e[1].split("#")[1]; return { e, slug: ids[k], head: { en: enHead[k], zh: zhHead[k] } }; }) };
  }).filter((g) => g.pts.length);
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
  // Sample questions: pick → right/wrong, explanation opens, a link to a set
  // of that type. GA: sample_try (id, type, ok, n = which sample), sample_open
  // (explanation opened without picking), sample_next (went on to the set).
  const QS_JS = (en) => `<script>(function(){var r=document.currentScript.parentNode;function ev(n,p){try{if(window.gaEvent)window.gaEvent(n,p)}catch(e){}}
r.addEventListener('click',function(e){var b=e.target.closest('.qs-opt');if(b){var it=b.closest('.qs-item');if(it.classList.contains('qs-done'))return;var i=+b.getAttribute('data-i'),a=+it.getAttribute('data-ans'),ok=i===a;it.classList.add('qs-done');
it.querySelectorAll('.qs-opt').forEach(function(x){var k=+x.getAttribute('data-i');x.disabled=true;if(k===a)x.classList.add('qs-right');else if(k===i)x.classList.add('qs-wrong');});
var v=it.querySelector('.qs-verdict');v.hidden=false;v.className='qs-verdict '+(ok?'qs-v-ok':'qs-v-bad');v.textContent=ok?${JSON.stringify(en ? "✓ Right" : "✓ 答对了")}:${JSON.stringify(en ? "✗ The answer is " : "✗ 正确答案是 ")}+(a+1);
var d=it.querySelector('details');if(d){d.open=true;d.setAttribute('data-auto','1');}var nx=it.querySelector('.qs-next');if(nx)nx.hidden=false;
ev('sample_try',{id:it.getAttribute('data-id'),type:it.getAttribute('data-type'),ok:ok,n:[].indexOf.call(r.querySelectorAll('.qs-item'),it)+1});return;}
var l=e.target.closest('.qs-next a');if(l){ev('sample_next',{type:l.getAttribute('data-type')});}});
r.addEventListener('toggle',function(e){var d=e.target;if(d.tagName!=='DETAILS'||!d.open||d.getAttribute('data-auto'))return;var it=d.closest('.qs-item');if(it&&!it.classList.contains('qs-done'))ev('sample_open',{id:it.getAttribute('data-id'),type:it.getAttribute('data-type')});},true);})();</script>`;
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
      // Options are buttons: pick one to see right/wrong and the explanation (QS_JS).
      body += `<ol class="qs-opts" lang="ja">${q.options.map((o, i) => `<li><button type="button" class="qs-opt" data-i="${i}">${o}</button></li>`).join("")}</ol>`;
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
      const next = `<p class="qs-next" hidden><a href="?from=sample#type=${sEsc(q.type)}" data-type="${sEsc(q.type)}">${L(`再做一组「${sEsc(ty.zh || "")}」题 →`, `A set of ${sEsc(ty.en || "")} questions →`)}</a></p>`;
      return `<div class="qs-item" data-id="${sEsc(q.id)}" data-type="${sEsc(q.type)}" data-ans="${q.answer}"><p class="qs-type">${n + 1}. ${sEsc(en ? ty.en : ty.zh)} · <span lang="ja">${sEsc(ty.ja)}</span></p>${body}<p class="qs-verdict" hidden></p><details><summary>${L("看答案和解析", "Answer and explanation")}</summary>${ans}</details>${next}</div>`;
    }).join("");
    return `<section class="quiz-about quiz-samples"><h2>${L("例题（附答案和解析）", "Sample questions with answers")}</h2><p>${L("从题库里抽的几道题：点一个选项，马上看对错和解析。完整的练习在上面开始。", "A few questions from the bank: pick an option to see if it's right and why. Start the full practice above.")}</p>${items}${QS_JS(en)}</section>`;
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
    const gaId = `${lv}-grammar-audio`, gaFile = path.join(__dirname, "questions", "grammar-audio", `${lv}.json`), hasGa = fs.existsSync(gaFile);
    const vlId = `${lv}-vocabulary-list`, vlFile = path.join(__dirname, "questions", "vocab-list", `${lv}.json`), hasVl = fs.existsSync(vlFile);
    const kjId = `${lv}-kanji`, kjFile = path.join(__dirname, "questions", "kanji", `${lv}.json`), hasKj = fs.existsSync(kjFile);
    // A language whose track isn't made yet (tools/vocab-audio.py --lang=…) gets no page and no link.
    const vlLangs = hasVl ? Object.keys(JSON.parse(fs.readFileSync(vlFile, "utf-8")).tracks) : [];
    // The pages link to each other (when the other one exists).
    const navLinks = (here, en) => [
      here !== practiceId && `<a href="${SITE_PATH}${practiceId}/">✍ ${en ? "Practice by question type" : "按题型练习"}</a>`,
      here !== listeningId && hasCk && `<a href="${SITE_PATH}${listeningId}/">🎧 ${en ? `${level} listening practice` : `${level} 听力练习`}</a>`,
      ...SUBSET_PAGES.filter((p) => p.levels.includes(level) && here !== `${lv}-${p.id}`).map((p) => (p.id === "reading"
        ? `<a href="${SITE_PATH}${lv}-reading/">📖 ${en ? `${level} reading practice` : `${level} 阅读练习`}</a>`
        : `<a href="${SITE_PATH}${lv}-vocabulary/">🔤 ${en ? `${level} vocabulary practice` : `${level} 词汇练习`}</a>`)),
      here !== mockId && mocks.length && `<a href="${SITE_PATH}${mockId}/">⏱ ${en ? `Timed ${level} mock test` : `${level} 模拟题（计时）`}</a>`,
      here !== cardsId && `<a href="${SITE_PATH}${cardsId}/">🗂 ${en ? "Grammar flashcards" : "语法卡片（在线背）"}</a>`,
      here !== gaId && hasGa && `<a href="${SITE_PATH}${gaId}/">🎧 ${en ? `${level} grammar audio` : `${level} 语法听读`}</a>`,
      here !== vlId && vlLangs.includes(en ? "en" : "zh") && `<a href="${SITE_PATH}${vlId}/">📚 ${en ? `${level} vocabulary list` : `${level} 高频词汇`}</a>`,
      here !== kjId && hasKj && `<a href="${SITE_PATH}${kjId}/">漢 ${en ? `${level} kanji list` : `${level} 汉字表`}</a>`,
    ].filter(Boolean).join(" ");
    // 生词本 dictionary (build-words.js) in its own file, fetched on the first
    // word tap; each page language's bundle carries its own copy's address.
    if (practice.words) { practice.wsrc = writeQuizDataByLang(`${lv}-words.json`, practice.words); delete practice.words; }
    const src = writeQuizDataByLang(`${lv}.json`, practice);
    // question id → its grammar point (first non-vocabulary ref), every level in
    // one small file: /my-grammar/ finds the points a reader keeps missing.
    for (const q of practice.questions) { const r = (q.refs || []).find((x) => !/#vocab$/.test(x)); if (r) QREFS[q.id] = r; }
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
          lead: `Every vocabulary item type of the ${level}: kanji readings, writing, word choice and more. Answer, then see why each option is right or wrong.${vlLangs.includes("en") ? ` Want the words themselves? The <a href="${SITE_PATH}${vlId}/">${level} vocabulary list</a> has every word the real ${level} tests asked, read aloud.` : ""}`, nav: navLinks(pageId, true) },
        zh: { title: `JLPT ${level} 词汇练习 - 文字词汇在线做题，附详细解析`,
          desc: `免费 JLPT ${level} 文字词汇在线练习：${subQs.length} 道仿真题，覆盖汉字读音、汉字写法和词语运用，每个选项都有解析。`,
          h1: `JLPT ${level} 词汇练习`, crumb: `${level} 词汇`,
          lead: `${level} 文字词汇的全部题型：汉字读音、汉字写法、选词填空等。答完马上看每个选项为什么对、为什么错。${vlLangs.includes("zh") ? `想先背词：<a href="${SITE_PATH}${vlId}/">${level} 高频词汇</a>收了历年真题考过的全部词，带朗读。` : ""}`, nav: navLinks(pageId, false) },
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
    // Grammar audio: every grammar point of the lessons read aloud — pattern,
    // meaning (in the page's language), two examples — as one mp3 per language on
    // the audio host. Text + timing: questions/grammar-audio/{lv}.json, written by
    // tools/grammar-audio.py from the flashcard data; player: site/grammar-audio.js.
    if (hasGa) {
      const ga = JSON.parse(fs.readFileSync(gaFile, "utf-8")), n = ga.items.length;
      gaExam(ga.items, level);
      // Japanese explanations of each point ({ key: text }, written by Claude
      // subagents 2026-11-24), shown by the 意思：日本語 switch, with furigana.
      const gaJaFile = path.join(__dirname, "questions", "grammar-audio", "src", "ja.json");
      const gaJa = fs.existsSync(gaJaFile) ? JSON.parse(fs.readFileSync(gaJaFile, "utf-8")) : {};
      // A key used by two points (two senses of 〜そうだ) takes "key#2" for the second.
      const gaSeen = {};
      for (const it of ga.items) {
        const n = (gaSeen[it.key] = (gaSeen[it.key] || 0) + 1), text = gaJa[n > 1 ? `${it.key}#${n}` : it.key] || gaJa[it.key];
        if (text) it.meanJa = fixReadings(await furiganaText(kuro, text));   // same corrections as the lessons
      }
      ga.words = await pageWords(gaId, ga.items);
      const gaMeta = {
        en: {
          title: `JLPT ${level} Grammar Audio — All ${n} Patterns with Example Sentences, Free`,
          desc: `Listen to every JLPT ${level} grammar point: the pattern, its meaning in English and two example sentences with translations, read aloud. Play it all like a podcast, or one sentence at a time.`,
          h1: `JLPT ${level} Grammar Audio`, crumb: `${level} Grammar audio`,
          lead: `All ${n} grammar points of the ${level} lessons, read aloud: pattern → meaning → example → translation, two examples each, with how it attaches and what it's confused with. Play it all on the way to work, or tap any line to hear just that one.`,
          nav: navLinks(gaId, true),
        },
        zh: {
          title: `JLPT ${level} 语法听读 - ${n} 个语法点带例句朗读，可整体播放`,
          desc: `JLPT ${level} 全部 ${n} 个语法点的朗读：语法、中文意思、两个例句和翻译，像播客一样整体连播，也可以一句一句听、单句循环。免费，无需注册。`,
          h1: `JLPT ${level} 语法听读`, crumb: `${level} 语法听读`,
          lead: `${level} 课程里的全部 ${n} 个语法点，按「语法 → 意思 → 例句 → 翻译」朗读，每个语法点两个例句，附接续和易混语法。通勤时整体连播，或者点任意一句只听那一句。`,
          nav: navLinks(gaId, false),
        },
      };
      for (const lang of PAGE_LANGS) {
        const code = lang.code === "zh" ? "zh" : "en", en = code === "en", m = gaMeta[lang.code], v = langVariant(gaId, lang), tr = ga.tracks[code];
        const body = grammarAudioBody(ga, code, gaId);
        const dur = Math.round(tr.duration), iso = `PT${Math.floor(dur / 60)}M${dur % 60}S`;
        const schema = JSON.stringify([
          { "@context": "https://schema.org", "@type": "LearningResource", name: m.h1, description: m.desc, url: v.url, inLanguage: en ? "en" : "zh-Hans",
            educationalLevel: `JLPT ${level}`, isAccessibleForFree: true, learningResourceType: "Audio", timeRequired: iso,
            teaches: ga.items.slice(0, 30).map((it) => it.term).join(", "),
            about: { "@type": "Thing", name: "Japanese grammar" }, provider: { "@type": "Organization", name: "jpnotes.dev", url: SITE },
            audio: { "@type": "AudioObject", name: m.h1, contentUrl: /^https?:/.test(AUDIO_BASE) ? `${AUDIO_BASE}/${tr.src}` : `${SITE}${AUDIO_BASE.replace(/^\//, "")}/${tr.src}`, encodingFormat: "audio/mpeg", duration: iso, inLanguage: ["ja", en ? "en" : "zh-Hans"] } },
          { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE },
            { "@type": "ListItem", position: 2, name: level, item: `${SITE}${level}/` },
            { "@type": "ListItem", position: 3, name: m.crumb, item: v.url }] },
        ]).replace(/</g, "\\u003c");
        const nav = `${m.nav} <a href="${SITE_PATH}grammar-audio/">🎧 ${en ? "Grammar audio for every level" : "各级别语法听读"}</a>`;
        writeLangPage(gaId, lang, localizePage(renderQuiz(lang, { ...m, nav, body, schema }, v, level, null), lang, localizedPageIds));
      }
      quizPageIds.push(gaId);
      console.log(`  Generated dist/${gaId}/ (${n} grammar points)`);
    }
    // Vocabulary list: the words the real JLPT tested at this level, most-tested
    // first (questions/vocab-list/{lv}.json from tools/vocab-audio.py: meaning,
    // an original example, timing), read aloud with the grammar-audio player;
    // ＋ puts a word into the reader's word list (jp_quiz_v1.words, synced).
    if (hasVl) {
      const vl = JSON.parse(fs.readFileSync(vlFile, "utf-8")), n = vl.items.length;
      const items = [];
      for (const w of vl.items) {
        const ja = fixReadings(await furiganaText(kuro, w.ex.ja.replace(/\*\*/g, "")));
        // mark the word: re-insert the bold around its first furigana'd occurrence
        const word = (w.ex.ja.match(/\*\*(.+?)\*\*/) || [])[1] || "";
        let html = ja;
        if (word) {
          const plainIdx = (h) => h.replace(/<rt>.*?<\/rt>|<rp>.*?<\/rp>|<\/?ruby>/g, "");
          const start = plainIdx(ja).indexOf(word);
          if (start >= 0) {   // walk the html, counting only visible base characters
            let vis = 0, i = 0, a = -1, b = -1;
            while (i < ja.length && b < 0) {
              if (ja.startsWith("<rt>", i)) { i = ja.indexOf("</rt>", i) + 5; continue; }
              if (ja.startsWith("<rp>", i)) { i = ja.indexOf("</rp>", i) + 5; continue; }
              if (ja[i] === "<") { i = ja.indexOf(">", i) + 1; continue; }
              if (vis === start && a < 0) a = i;
              vis++; i++;
              if (vis === start + word.length) b = i;
            }
            if (a >= 0 && b > a) {
              // widen to whole <ruby> elements so the tag doesn't cut one in half
              const ra = ja.lastIndexOf("<ruby>", a), rae = ja.lastIndexOf("</ruby>", a);
              if (ra > rae) a = ra;
              const rb = ja.indexOf("</ruby>", b - 1), rbs = ja.indexOf("<ruby>", b - 1);
              if (rb >= 0 && (rbs < 0 || rb < rbs) && ja.lastIndexOf("<ruby>", b - 1) > ja.lastIndexOf("</ruby>", b - 1)) b = rb + 7;
              html = `${ja.slice(0, a)}<b class="cl">${ja.slice(a, b)}</b>${ja.slice(b)}`;
            }
          }
        }
        items.push({ lesson: `g${w.group}`.replace("+", "p"), term: w.w, r: w.r, n: w.n, mean: w.mean, read: 1, exam: [],
          ex: [{ ja: html, zh: w.ex.zh, en: w.ex.en }] });
      }
      const ga = { items, tracks: vl.tracks };
      ga.words = await pageWords(vlId, items, Object.fromEntries(vl.items.map((w) => [w.w, { r: w.r, zh: w.mean.zh, en: w.mean.en }])));
      const gN = (g) => items.filter((x) => x.lesson === g).length;
      const groupOf = (en) => (it) => it.lesson === "g3p"
        ? { chip: en ? "3+×" : "3 次+", label: en ? "Tested 3+ times" : "真题考过 3 次以上", sub: en ? `${gN("g3p")} words` : `${gN("g3p")} 个词` }
        : it.lesson === "g2" ? { chip: en ? "2×" : "2 次", label: en ? "Tested twice" : "真题考过 2 次", sub: en ? `${gN("g2")} words` : `${gN("g2")} 个词` }
          : { chip: en ? "1×" : "1 次", label: en ? "Tested once" : "真题考过 1 次", sub: en ? `${gN("g1")} words` : `${gN("g1")} 个词` };
      const head = (en) => (it, g, no) => `<p class="ga-hd"><span class="ga-no">${no}</span><span class="ga-ln ga-g" data-l="${g}" lang="ja">${gaEsc(it.term)}</span><span class="vl-r" lang="ja">${gaEsc(it.r)}</span>` +
        `<span class="ga-exam">${en ? `${it.n}× on the test` : `考过 ${it.n} 次`}</span>` +
        `<button type="button" class="vl-add" data-w="${gaEsc(it.term)}" data-r="${gaEsc(it.r)}" data-m="${gaEsc(it.mean[en ? "en" : "zh"])}" aria-pressed="false">${en ? "＋ Word list" : "＋ 生词本"}</button></p>`;
      const vlMeta = {
        en: {
          title: `JLPT ${level} Vocabulary List — ${n} Words from Real Past Tests, with Audio`,
          desc: `The ${n} words real JLPT ${level} tests have asked in the vocabulary section (2010–2026), most-tested first: reading, meaning, an example sentence with translation, all read aloud. Add any word to your word list.`,
          h1: `JLPT ${level} Vocabulary List`, crumb: `${level} Vocabulary list`,
          lead: `Every word the ${level} vocabulary section has tested since 2010, ${n} in all, grouped by how often it came up. Each has its reading, meaning and an example sentence, all read aloud. Start with Quick sort: one card per word, the ones you don't know go into your word list. Then play only those, like a podcast, and review them with flashcards.`,
          nav: navLinks(vlId, true),
        },
        zh: {
          title: `JLPT ${level} 高频词汇表 - 历年真题考过的 ${n} 个词，带例句朗读`,
          desc: `JLPT ${level} 文字词汇部分 2010–2026 年真题考过的 ${n} 个词，按考过次数排序：读音、中文意思、例句和翻译，全部可以朗读连播，一键加入生词本背诵。`,
          h1: `JLPT ${level} 高频词汇`, crumb: `${level} 高频词汇`,
          lead: `2010 年以来 ${level} 文字词汇部分考过的全部 ${n} 个词，按考过的次数分组。每个词有读音、意思和例句，全部朗读。先用「快速筛词」一张卡一张卡过，不认识的自动进生词本；再只连播这些生词，像听播客一样，最后用背单词巩固。`,
          nav: navLinks(vlId, false),
        },
      };
      const vlCss = `<style>.vl-r{color:var(--text-muted);font-size:.95rem}.vl-add{margin-left:auto;font:inherit;font-size:.8rem;padding:.15rem .65rem;border-radius:14px;border:1px solid var(--border,#ccc);background:transparent;color:var(--ui);cursor:pointer;white-space:nowrap}.vl-add[aria-pressed=true]{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}
.vl-wl{font-size:.85rem;margin:.55rem 0 0;color:var(--text-muted)}#vl-pages select{flex:1;min-width:0}#vl-pages [data-pgt]{min-width:2.2rem;font-size:1rem;line-height:1}#vl-sort,#vl-mine{flex:1;white-space:nowrap}.vl-badge{display:inline-block;margin-left:.3rem;padding:0 .45rem;border-radius:10px;background:rgba(0,0,0,.14);font-weight:600}.ga-toc[hidden]{display:none}#vl-q-in,#vl-f,#vl-pages select,#vl-pages button,#vl-sort,#vl-mine{min-height:2.3rem}
.vl-set{margin:.6rem 0 0;border:1px solid var(--border,#ccc);border-radius:9px;padding:.15rem .7rem}.vl-set>summary{cursor:pointer;font-size:.85rem;color:var(--text-muted);padding:.4rem 0;list-style-position:inside}.vl-set[open]{padding-bottom:.6rem}.vl-set .ga-row{flex-wrap:wrap}.vl-lb{font-size:.78rem;color:var(--text-muted);width:2.4rem;flex:0 0 auto}#vl .ga-row{margin-top:.55rem}#vl-sort{background:var(--ui)!important;color:var(--ui-on)!important;border-color:var(--ui)!important;font-weight:600}
#vl-q-in{flex:1;min-width:8rem;font:inherit;font-size:.85rem;padding:.3rem .6rem;border-radius:7px;border:1px solid var(--border,#ccc);background:var(--surface-2,transparent);color:inherit}.ga-it.vl-hit{box-shadow:0 0 0 2px var(--ui)}#vl-pnav{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin:1rem 0}#vl-pnav[hidden]{display:none}#vl-pnav button{font:inherit;font-size:.9rem;padding:.45rem .9rem;border-radius:8px;border:1px solid var(--border,#ccc);background:var(--surface-2,transparent);color:var(--ui);cursor:pointer}#vl-pnav button:disabled{opacity:.4;cursor:default}#vl-pinfo{font-size:.85rem;color:var(--text-muted)}.ga-lh small{white-space:nowrap}
#vl-msg{font-size:.85rem;background:var(--chip-bg);border-radius:8px;padding:.4rem .6rem;margin:.5rem 0 0}#vl-empty{color:var(--text-muted);text-align:center;padding:2rem 0}
.ga-it.vl-kn{opacity:.6}.ga-it.vl-kn .ga-hd::after{content:"${"✓"}";color:var(--text-muted);font-size:.8rem;order:9}
#ga.vl-hr .vl-r,#ga.vl-hr .ga-ex rt{filter:blur(4px)}#ga.vl-hr .vl-r:hover,#ga.vl-hr .ga-ex:hover rt{filter:none}
html.vl-open{overflow:hidden}#vl-q{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem}#vl-q[hidden]{display:none}
#vl-qbox{background:var(--bg);border-radius:16px;width:100%;max-width:460px;padding:1rem 1.1rem 1.1rem;box-shadow:0 10px 40px rgba(0,0,0,.25)}
.vl-qtop{display:flex;align-items:center;gap:.6rem;font-size:.85rem;color:var(--text-muted)}.vl-qtop button{font:inherit;border:0;background:none;color:inherit;font-size:1.2rem;cursor:pointer}#vl-qp{margin-right:auto}#vl-qsay{display:none}.vl-flip:not(.vl-done) #vl-qsay{display:inline}
#vl-qcard{display:block;width:100%;min-height:15rem;margin:.6rem 0 .8rem;border:1px solid var(--border,#ddd);border-radius:12px;background:var(--surface-2,transparent);color:inherit;font:inherit;cursor:pointer;padding:1.2rem 1rem;text-align:center}
#vl-qcard{font-weight:400}#vl-qb b.cl{color:var(--accent);font-weight:700}#vl-qw{font-size:2.2rem;font-weight:700;margin:.6rem 0}.vl-done #vl-qw{font-size:1.3rem}#vl-qb{display:none;text-align:left}.vl-flip #vl-qb{display:block}.vl-flip .vl-qhint{display:none}
.vl-qhint{color:var(--text-muted);font-size:.85rem;margin-top:2.5rem}.vl-qr{text-align:center;font-size:1.15rem;margin:.2rem 0}.vl-qm{text-align:center;margin:.3rem 0 .6rem}
.vl-qbtn{display:flex;gap:.6rem}.vl-qbtn button{flex:1;font:inherit;font-size:1rem;padding:.7rem;border-radius:10px;border:1px solid var(--border,#ccc);background:var(--surface-2,transparent);color:inherit;cursor:pointer}
#vl-qno{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}.vl-done .vl-qbtn{display:none}#vl-qundo{flex:0 0 auto}.vl-qkeys{font-size:.75rem;color:var(--text-muted);text-align:center;margin:.6rem 0 0}</style>`;
      for (const lang of PAGE_LANGS) {
        const code = lang.code === "zh" ? "zh" : "en", en = code === "en", m = vlMeta[lang.code], v = langVariant(vlId, lang), tr = ga.tracks[code];
        if (!tr) continue;
        const t2 = (z, e) => (en ? e : z);
        const ctlExtra = `<div id="vl" data-lv="${lv}" data-en="${en ? 1 : 0}"><div class="ga-row"><button type="button" id="vl-sort">${t2("⚡ 快速筛词", "⚡ Quick sort")} <small class="vl-badge" title="${t2("还没筛过的词", "Words not sorted yet")}"><span id="vl-todo">${n}</span></small></button>` +
          `<button type="button" id="vl-mine" aria-pressed="false">${t2("只听我的生词", "Only my words")}</button></div>` +
          `<div class="ga-row"><input id="vl-q-in" type="search" placeholder="${t2("搜索词、读音、意思", "Search words")}" aria-label="${t2("搜索", "Search")}">` +
          `<select id="vl-f" aria-label="${t2("筛选", "Filter")}"><option value="all">${t2("全部词", "All words")}</option><option value="todo">${t2("没筛过的", "Not sorted yet")}</option><option value="in">${t2("生词本里的", "In my word list")}</option><option value="n2">${t2("考过 2 次以上", "Tested 2+ times")}</option></select></div>` +
          `<div class="ga-row" id="vl-pages"><button type="button" data-pgt="-1" aria-label="${t2("上一页", "Previous page")}">‹</button><select id="vl-pg" aria-label="${t2("分页", "Page")}">${Array.from({ length: Math.ceil(n / 50) }, (_, k) => `<option value="${k}">${k * 50 + 1}–${Math.min(n, k * 50 + 50)}</option>`).join("")}</select><button type="button" data-pgt="1" aria-label="${t2("下一页", "Next page")}">›</button>` +
          `<button type="button" id="vl-seg">${t2("▶ 播放本页", "▶ Play this page")}</button></div>` +
          `<p id="vl-msg" hidden></p><p class="vl-wl">${t2("生词本里：", "In your word list: ")}<b id="vl-n">0</b> · <a href="${SITE_PATH}${practiceId}/#words">${t2("去背单词 →", "Review them with flashcards →")}</a></p></div>`;
        const settings = ({ modes, trs, hide }) => `<details class="vl-set" id="vl-set"><summary>${t2("⚙ 朗读与显示", "⚙ Playback & display")}</summary>` +
          `<div class="ga-row"><span class="vl-lb">${t2("播放", "Play")}</span>${modes}</div>` +
          `<div class="ga-row"><span class="vl-lb">${t2("朗读", "Read")}</span><button type="button" id="ga-ms" aria-pressed="true">${t2("意思", "Meanings")}</button>${trs.replace(/>[^<]*<\/button>$/, `>${t2("例句翻译", "Translations")}</button>`)}${ga.tracks.ja ? `<button type="button" id="vl-jam" aria-pressed="false" title="${t2("意思换成日语解释，朗读也换成全日语（不念翻译）", "Meanings in Japanese, and an all-Japanese track (no translations)")}">${t2("日语释义", "Japanese definitions")}</button>` : ""}</div>` +
          `<div class="ga-row"><span class="vl-lb">${t2("自测", "Test")}</span>${hide}<button type="button" id="vl-hr" aria-pressed="false">${t2("遮住读音", "Hide readings")}</button></div></details>`;
        const dialog = `<p id="vl-pnav" hidden><button type="button" data-pgo="-1">${t2("← 上一页", "← Previous page")}</button><span id="vl-pinfo"></span><button type="button" data-pgo="1">${t2("下一页 →", "Next page →")}</button></p>
<p id="vl-empty" hidden>${t2("没有符合筛选的词。", "No words match this filter.")}</p>
<div id="vl-q" hidden role="dialog" aria-modal="true" aria-label="${t2("快速筛词", "Quick sort")}"><div id="vl-qbox"><div class="vl-qtop"><span id="vl-qp"></span><button type="button" id="vl-qsay" aria-label="${t2("再听一遍", "Play again")}">🔊</button><button type="button" id="vl-qx" aria-label="${t2("关闭", "Close")}">✕</button></div>
<button type="button" id="vl-qcard"><div id="vl-qw" lang="ja"></div><div class="vl-qhint">${t2("先想想读音和意思，点一下看答案", "Think of the reading and meaning, then tap to check")}</div><div id="vl-qb"></div></button>
<div class="vl-qbtn"><button type="button" id="vl-qundo" aria-label="${t2("撤销", "Undo")}">↶</button><button type="button" id="vl-qno">${t2("不认识 → 生词本", "Don’t know → list")}</button><button type="button" id="vl-qyes">${t2("认识", "Know it")}</button></div>
<p class="vl-qkeys">${t2("键盘：空格翻面 · ← 不认识 · → 认识 · Backspace 撤销", "Keys: space flips · ← don’t know · → know · Backspace undo")}</p></div></div>
${ga.tracks.ja ? `<script type="application/json" id="vl-ja">${JSON.stringify({ src: `${AUDIO_BASE}/${ga.tracks.ja.src}`, dur: ga.tracks.ja.duration, lines: ga.tracks.ja.lines.map((x) => [x[1], x[2], x[0]]), mean: items.map((it) => it.mean.ja || "") }).replace(/</g, "\\u003c")}</script>` : ""}
<script src="${SITE_PATH}vocab-list.js?v=${VL_JS_HASH}" defer></script>`;
        const body = vlCss +
          grammarAudioBody(ga, code, vlId, { group: groupOf(en), itemHead: head(en), tocLabel: en ? "Tested:" : "考过：", groupMode: en ? "This group" : "本组连播", ctlExtra, settings,
            itemAttr: (it) => ` data-w="${gaEsc(it.term)}" data-n="${it.n}"`,
            note: en ? "Tap any line to start there. Space plays / pauses, ← → previous / next line. Start with “Quick sort”: one card per word — the ones you don’t know go into your word list, the ones you know drop out — then turn on “Only my words” and the player skips everything else. “Hide meanings” / “Hide readings” blur them for self-testing. The words come from the vocabulary sections of the 2010–2026 JLPT papers; meanings and example sentences are ours. Voices: Gemini TTS." : "点任意一行从那里开始听。空格键播放 / 暂停，← → 上一句 / 下一句。建议先用「快速筛词」：一张卡一个词，不认识的进生词本，认识的不再出现；再打开「只听我的生词」，播放器会跳过其他词。「遮住意思」「遮住读音」可以自测。词表取自 2010–2026 年 JLPT 真题的文字词汇部分；释义和例句是本站编写的。朗读：Gemini TTS。",
            extra: dialog });
        const dur = Math.round(tr.duration), iso = `PT${Math.floor(dur / 60)}M${dur % 60}S`;
        const schema = JSON.stringify([
          { "@context": "https://schema.org", "@type": "LearningResource", name: m.h1, description: m.desc, url: v.url, inLanguage: en ? "en" : "zh-Hans",
            educationalLevel: `JLPT ${level}`, isAccessibleForFree: true, learningResourceType: "Vocabulary list", timeRequired: iso,
            teaches: items.slice(0, 30).map((it) => it.term).join(", "),
            about: { "@type": "Thing", name: "Japanese vocabulary" }, provider: { "@type": "Organization", name: "jpnotes.dev", url: SITE } },
          { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE },
            { "@type": "ListItem", position: 2, name: level, item: `${SITE}${level}/` },
            { "@type": "ListItem", position: 3, name: m.crumb, item: v.url }] },
        ]).replace(/</g, "\\u003c");
        writeLangPage(vlId, lang, localizePage(renderQuiz(lang, { ...m, body, schema }, v, level, null), lang, localizedPageIds));
      }
      if (PAGE_LANGS.every((l) => ga.tracks[l.code === "zh" ? "zh" : "en"])) quizPageIds.push(vlId);   // sitemap once every language has its page
      console.log(`  Generated dist/${vlId}/ (${n} words)`);
    }
    // Kanji list (questions/kanji/{lv}.json: the usual JLPT list for the level —
    // there is no official one since 2010 — with readings, meanings and example
    // words written for this site), each kanji marked with the past-test words
    // (questions/vocab-list/src, this level and below) it appeared in.
    if (hasKj) {
      const KJ = JSON.parse(fs.readFileSync(kjFile, "utf-8"));
      const ORDER5 = ["n5", "n4", "n3", "n2", "n1"], upTo = ORDER5.slice(0, ORDER5.indexOf(lv) + 1);
      const examWords = upTo.flatMap((l) => { const f = path.join(__dirname, "questions", "vocab-list", "src", `${l}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf-8")).map((w) => ({ ...w, lv: l.toUpperCase() })) : []; });
      const kjEsc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const rb = (w, r) => `<ruby>${kjEsc(w)}<rp>(</rp><rt>${kjEsc(r)}</rt><rp>)</rp></ruby>`;
      const rows = KJ.map((k) => { const ex = examWords.filter((w) => w.w.includes(k.k)).sort((a, b) => (b.n || 1) - (a.n || 1)); return { ...k, ex, exN: ex.reduce((t, w) => t + (w.n || 1), 0) }; });
      const n = rows.length, tested = rows.filter((r) => r.ex.length).length;
      const meta = {
        en: { title: `JLPT ${level} Kanji List — All ${n} Kanji with Readings, Meanings & Example Words`,
          desc: `The ${n} JLPT ${level} kanji: on'yomi and kun'yomi, meaning and three example words each, and which kanji appeared in real ${level} test vocabulary (2010–2026). Free, printable.`,
          h1: `JLPT ${level} Kanji List`, crumb: `${level} Kanji`,
          lead: `All ${n} kanji usually listed for ${level}, each with its readings, meaning and three everyday example words. ${tested} of them appear in words the real tests have asked since 2010 — marked with the words and how often. Learn those first.`,
          nav: navLinks(kjId, true) },
        zh: { title: `JLPT ${level} 汉字表 - 全部 ${n} 个汉字：音读训读、意思和例词`,
          desc: `JLPT ${level} 的 ${n} 个汉字：音读、训读、中文意思和三个常用例词，并标出哪些字出现在 2010–2026 年 ${level} 真题的词汇里。免费，可打印。`,
          h1: `JLPT ${level} 汉字表`, crumb: `${level} 汉字表`,
          lead: `通行 ${level} 汉字表里的全部 ${n} 个字，每个字有读音、意思和三个常用例词。其中 ${tested} 个字出现在 2010 年以来真题考过的词里，标出了是哪些词、考过几次，建议先背这些。`,
          nav: navLinks(kjId, false) },
      };
      const kjCss = `<style>.kj-tools{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}.kj-tools button{font:inherit;font-size:.85rem;padding:.3rem .8rem;border-radius:14px;border:1px solid var(--border,#ccc);background:transparent;color:var(--ui);cursor:pointer}.kj-tools button[aria-pressed=true]{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}
.kj-t td,.kj-t th{vertical-align:top}.kj-k{font-size:2.1rem;line-height:1.1;font-family:"Hiragino Mincho ProN","Yu Mincho",YuMincho,serif;text-align:center;white-space:nowrap}.kj-k a{color:inherit;text-decoration:none}.kj-rd{white-space:nowrap}.kj-rd span{display:block}.kj-on{color:var(--text-strong)}.kj-kun{color:var(--text-muted)}
.kj-w{margin:0;padding:0;list-style:none}.kj-w li{margin:.1rem 0}.kj-w small{color:var(--text-muted)}.kj-x{font-size:.82rem;color:var(--text-muted);margin:.35rem 0 0}.kj-x b{color:var(--text-strong);font-weight:600}.kj-t th:nth-child(1){width:4.6rem}.kj-b{display:flex;flex-direction:column;gap:.25rem;margin-top:.35rem;font-family:var(--font-sans,system-ui)}.kj-b button{font:inherit;font-size:.7rem;line-height:1.2;padding:.15rem .3rem;border-radius:10px;border:1px solid var(--border,#ccc);background:transparent;color:var(--ui);cursor:pointer;white-space:nowrap}.kj-b button[aria-pressed=true]{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}.kj-sum{font-size:.82rem;color:var(--text-muted);align-self:center}.kj-sum b{color:var(--text-strong)}.kj-idx a.kj-kn{opacity:.35}tr.kj-done .kj-k>a{opacity:.45}.kj-t th:nth-child(2){width:8.5rem}.kj-t th:nth-child(3){width:9rem}.kj-w li{white-space:nowrap}
#kj.kj-hr rt,#kj.kj-hr .kj-rd{filter:blur(4px)}#kj.kj-hm .kj-m,#kj.kj-hm .kj-w small{filter:blur(4px)}#kj.kj-only tr.kj-nt{display:none}
.kj-idx{display:flex;flex-wrap:wrap;gap:.25rem;margin:.6rem 0 1rem}.kj-idx a{display:inline-flex;align-items:center;justify-content:center;width:2.1rem;height:2.1rem;border-radius:6px;border:1px solid var(--border,#ccc);color:inherit;text-decoration:none;font-size:1.15rem;font-family:"Hiragino Mincho ProN","Yu Mincho",YuMincho,serif}.kj-idx a:hover{background:var(--ui-soft)}.kj-idx a.kj-cur{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}
.kj-pg{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem;margin:.6rem 0}.kj-pg[hidden]{display:none}.kj-pg button{font:inherit;font-size:.85rem;min-width:2.2rem;padding:.25rem .55rem;border-radius:7px;border:1px solid var(--border,#ccc);background:transparent;color:var(--ui);cursor:pointer}.kj-pg button[aria-current=page]{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}.kj-pg button:disabled{opacity:.4;cursor:default}.kj-pg span{font-size:.82rem;color:var(--text-muted);margin-left:.3rem}
.kj-idx{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(20rem,1fr));gap:.25rem .8rem}.kj-ir{display:flex;gap:.25rem;align-items:center;padding:.15rem .25rem;border-radius:8px;cursor:pointer}.kj-ir.kj-irc{background:var(--ui-soft)}.kj-ir a{flex:1 1 0;min-width:0;max-width:1.9rem;width:auto;height:1.9rem;font-size:1.05rem}.kj-ir .kj-in{width:1.6rem;flex:0 0 auto;text-align:right;font-size:.75rem;color:var(--text-muted);margin-right:.2rem}.kj-ir.kj-irc .kj-in{color:var(--ui);font-weight:700}#kj-find{font:inherit;font-size:.85rem;width:7.5rem;padding:.3rem .6rem;border-radius:14px;border:1px solid var(--border,#ccc);background:transparent;color:inherit}#kj.kj-paged tr.kj-off{display:none}tr.kj-hit td{background:var(--ui-soft)}
@media print{.kj-b,.kj-tools,.kj-idx,.kj-pg,.quiz-nav,#m-bar,.sidebar{display:none!important}.kj-t{font-size:10pt}#kj.kj-paged tr.kj-off{display:table-row!important}}</style>`;
      for (const lang of PAGE_LANGS) {
        const en = lang.code !== "zh", m = meta[lang.code], v = langVariant(kjId, lang), t2 = (z, e) => (en ? e : z);
        const tr = rows.map((r, i) => `<tr id="k-${r.k}"${r.ex.length ? "" : ' class="kj-nt"'}><td class="kj-k"><a href="#k-${r.k}" lang="ja">${r.k}</a><span class="kj-b"><button type="button" class="kj-got" data-k="${r.k}" aria-pressed="false">${t2("已掌握", "Got it")}</button><button type="button" class="kj-add" data-k="${r.k}" data-r="${kjEsc([...r.on, ...r.kun.map((x) => x.replace(/\./g, ""))].join("・"))}" data-m="${kjEsc(en ? r.en : r.zh)}" aria-pressed="false">${t2("＋生词本", "＋ Word list")}</button></span></td>` +
          `<td class="kj-rd" lang="ja">${r.on.length ? `<span class="kj-on">${r.on.map(kjEsc).join("・")}</span>` : ""}${r.kun.length ? `<span class="kj-kun">${r.kun.map(kjEsc).join("・")}</span>` : ""}</td>` +
          `<td class="kj-m">${kjEsc(en ? r.en : r.zh)}</td>` +
          `<td><ul class="kj-w">${r.words.map((w) => `<li><span lang="ja">${rb(w.w, w.r)}</span> <small>${kjEsc(en ? w.en : w.zh)}</small></li>`).join("")}</ul>` +
          (r.ex.length ? `<p class="kj-x">${t2("真题：", "On the test: ")}${r.ex.slice(0, 4).map((w) => `<span lang="ja">${kjEsc(w.w)}</span>${w.n > 1 ? `<b>×${w.n}</b>` : ""}`).join("、")}${r.ex.length > 4 ? t2(` 等 ${r.ex.length} 个词`, ` and ${r.ex.length - 4} more`) : ""}</p>` : "") + `</td></tr>`).join("\n");
        const body = kjCss + `<div class="kj-tools" id="kj-tools"><button type="button" data-kj="kj-only" aria-pressed="false">${t2(`只看真题出现过的（${tested}）`, `Only kanji seen on the test (${tested})`)}</button><button type="button" id="kj-hk" aria-pressed="false">${t2("隐藏已掌握的", "Hide the ones I know")}</button><span id="kj-sum" class="kj-sum"></span><button type="button" data-kj="kj-hr" aria-pressed="false">${t2("遮住读音", "Hide readings")}</button><button type="button" data-kj="kj-hm" aria-pressed="false">${t2("遮住意思", "Hide meanings")}</button><button type="button" onclick="print()">${t2("打印", "Print")}</button><input id="kj-find" type="search" maxlength="1" lang="ja" placeholder="${t2("查一个字", "Find a kanji")}" aria-label="${t2("查一个字", "Find a kanji")}"></div>
<div id="kj"><nav class="kj-idx" aria-label="${t2("汉字索引", "Kanji index")}">${rows.map((r) => `<a href="#k-${r.k}" lang="ja" title="${kjEsc(en ? r.en : r.zh)}">${r.k}</a>`).join("")}</nav>
<div class="kj-pg" hidden></div><div class="table-scroll"><table class="kj-t"><thead><tr><th>${t2("汉字", "Kanji")}</th><th>${t2("音读 / 训读", "On / kun")}</th><th>${t2("意思", "Meaning")}</th><th>${t2("例词", "Example words")}</th></tr></thead><tbody>
${tr}
</tbody></table></div><div class="kj-pg" hidden></div></div>
<script>(function(){
var b=document.getElementById('kj-tools'),k=document.getElementById('kj'),PER=10,page=0,EN=${en ? 1 : 0};
var rows=[].slice.call(k.querySelectorAll('tbody tr')),pgs=[].slice.call(k.querySelectorAll('.kj-pg'));
var HK=false;try{HK=localStorage.getItem('jp_kj_hk')==='1';}catch(x){}
function vis(){return rows.filter(function(r){return !(k.classList.contains('kj-only')&&r.classList.contains('kj-nt'))&&!(HK&&r.classList.contains('kj-done'));});}
// 已掌握: jp_grammar_checks 'k:<kanji>' (±ms, synced like the grammar points); ＋生词本: progress words (背单词).
var GK='jp_grammar_checks',QK='jp_quiz_v1';
function lj(key){try{return JSON.parse(localStorage.getItem(key))||null;}catch(x){return null;}}
function paint(){var c=lj(GK)||{},q=lj(QK)||{},w=(q&&q.words)||{},done=0;
rows.forEach(function(r){var ch=r.id.slice(2),on=(c['k:'+ch]||0)>0,inw=w[ch]&&w[ch].t>0;if(on)done++;r.classList.toggle('kj-done',on);
var g=r.querySelector('.kj-got'),a=r.querySelector('.kj-add');g.setAttribute('aria-pressed',on);g.textContent=on?(EN?'✓ Got it':'✓ 已掌握'):(EN?'Got it':'已掌握');a.setAttribute('aria-pressed',!!inw);a.textContent=inw?(EN?'✓ In list':'✓ 生词本'):(EN?'＋ Word list':'＋生词本');
var ia=k.querySelector('.kj-idx a[href="#k-'+ch+'"]');if(ia)ia.classList.toggle('kj-kn',on);});
document.getElementById('kj-sum').innerHTML=(EN?'Got ':'已掌握 ')+'<b>'+done+'</b> / '+rows.length;document.getElementById('kj-hk').setAttribute('aria-pressed',HK);}
k.addEventListener('click',function(e){var g=e.target.closest('.kj-got'),a=e.target.closest('.kj-add');if(!g&&!a)return;e.stopPropagation();var ch=(g||a).getAttribute('data-k'),n=Date.now();
if(g){var c=lj(GK)||{},on=(c['k:'+ch]||0)>0;c['k:'+ch]=on?-n:n;try{localStorage.setItem(GK,JSON.stringify(c));}catch(x){}if(window.jpSync)window.jpSync.changed();try{if(window.gaEvent)window.gaEvent(on?'kanji_unmastered':'kanji_mastered',{k:ch,level:'${level}'})}catch(x){}}
else{var q=lj(QK);if(!q||q.v!==1)q={v:1,answers:{},review:{},reported:[],session:null,days:{},prefs:{},mock:{},cards:{},cardDays:{},fav:{},words:{}};q.words=q.words||{};var inw=q.words[ch]&&q.words[ch].t>0;
q.words[ch]=inw?{t:-n,q:''}:{t:n,a:n,q:'',r:a.getAttribute('data-r'),m:a.getAttribute('data-m'),k:0,due:n};q.at=n;try{localStorage.setItem(QK,JSON.stringify(q));}catch(x){}if(window.jpSync)window.jpSync.changed();try{dispatchEvent(new Event('jp-words'));if(window.gaEvent)window.gaEvent(inw?'word_remove':'word_add',{via:'kanji_list',level:'${level}'})}catch(x){}}
paint();if(HK){draw();}},true);
document.getElementById('kj-hk').addEventListener('click',function(){HK=!HK;try{localStorage.setItem('jp_kj_hk',HK?'1':'0');}catch(x){}page=0;paint();draw();});
window.addEventListener('storage',function(e){if(e.key===GK||e.key===QK){paint();draw();}});
// Pages over the rows the filter shows; every row stays in the HTML (search engines, print).
function draw(){var v=vis(),n=Math.ceil(v.length/PER)||1;if(page>=n)page=n-1;
rows.forEach(function(r){r.classList.add('kj-off');});v.slice(page*PER,page*PER+PER).forEach(function(r){r.classList.remove('kj-off');});
var h='<button type="button" data-p="'+(page-1)+'"'+(page?'':' disabled')+' aria-label="'+(EN?'Previous page':'上一页')+'">‹</button>';
h+='<span>'+(EN?'Page ':'第 ')+(page+1)+(EN?' of '+n:' / '+n+' 页')+'</span>';
h+='<button type="button" data-p="'+(page+1)+'"'+(page<n-1?'':' disabled')+' aria-label="'+(EN?'Next page':'下一页')+'">›</button><span>'+(page*PER+1)+'–'+Math.min(v.length,page*PER+PER)+' / '+v.length+'</span>';
pgs.forEach(function(p){p.innerHTML=h;p.hidden=n<2;});k.classList.add('kj-paged');
// The index: one row per page (PER = kanji that fit on a row), this page's row tinted.
var idx=k.querySelector('.kj-idx'),all=[].slice.call(idx.querySelectorAll('a'));all.forEach(function(a){idx.appendChild(a);});
[].forEach.call(idx.querySelectorAll('.kj-ir'),function(x){x.remove();});
var shown=all.filter(function(a){return v.indexOf(document.getElementById(a.getAttribute('href').slice(1)))>=0;});
all.forEach(function(a){a.hidden=shown.indexOf(a)<0;});
for(var j=0;j<n;j++){var row=document.createElement('div');row.className='kj-ir'+(j===page?' kj-irc':'');row.setAttribute('data-p',j);row.innerHTML='<span class="kj-in">'+(j+1)+'</span>';shown.slice(j*PER,j*PER+PER).forEach(function(a){row.appendChild(a);});idx.appendChild(row);}}
function go(ch,scroll){var r=document.getElementById('k-'+ch);if(!r)return;var v=vis(),i=v.indexOf(r);if(i<0){k.classList.remove('kj-only');var o=b.querySelector('[data-kj=kj-only]');if(o)o.setAttribute('aria-pressed','false');v=vis();i=v.indexOf(r);}
page=Math.floor(i/PER);draw();rows.forEach(function(x){x.classList.remove('kj-hit');});r.classList.add('kj-hit');
[].forEach.call(k.querySelectorAll('.kj-idx a'),function(a){a.classList.toggle('kj-cur',a.getAttribute('href')==='#k-'+ch);});if(scroll)r.scrollIntoView({block:'center'});}
k.addEventListener('click',function(e){var p=e.target.closest('.kj-pg [data-p]')||(!e.target.closest('a')&&e.target.closest('.kj-ir'));if(p){page=+p.getAttribute('data-p');draw();var t=k.querySelector('.kj-pg');if(t&&e.target.closest('.kj-pg')!==t)t.scrollIntoView({block:'start'});return;}
var a=e.target.closest('.kj-idx a');if(a){e.preventDefault();var ch=a.getAttribute('href').slice(3);history.replaceState(null,'','#k-'+ch);go(ch,true);try{if(window.gaEvent)window.gaEvent('kanji_tool',{t:'index'})}catch(x){}}});
b.addEventListener('click',function(e){var t=e.target.closest('[data-kj]');if(!t)return;var on=t.getAttribute('aria-pressed')!=='true';t.setAttribute('aria-pressed',on);k.classList.toggle(t.getAttribute('data-kj'),on);if(t.getAttribute('data-kj')==='kj-only'){page=0;draw();}try{if(window.gaEvent)window.gaEvent('kanji_tool',{t:t.getAttribute('data-kj'),on:on})}catch(x){}});
function fit(){PER=10;}
paint();fit();var lw=window.innerWidth;window.addEventListener('resize',function(){if(Math.abs(window.innerWidth-lw)<40)return;lw=window.innerWidth;var first=vis()[page*PER];fit();if(first){var i=vis().indexOf(first);page=Math.floor(i/PER);}draw();});
var f=document.getElementById('kj-find');f.addEventListener('input',function(){var c=f.value.trim().slice(-1);if(!c)return;if(document.getElementById('k-'+c)){go(c,true);history.replaceState(null,'','#k-'+c);f.style.borderColor='';try{if(window.gaEvent)window.gaEvent('kanji_tool',{t:'find'})}catch(x){}}else f.style.borderColor='var(--accent)';});
draw();var hm=decodeURIComponent(location.hash).match(/^#k-(.)$/);if(hm)go(hm[1],true);
window.addEventListener('hashchange',function(){var m=decodeURIComponent(location.hash).match(/^#k-(.)$/);if(m)go(m[1],true);});
})();</script>
<section class="quiz-about"><h2>${t2("关于这份汉字表", "About this list")}</h2>
<p>${t2(`JLPT 从 2010 年起没有公布官方汉字表。这里按通行的 ${level} 汉字表收字（各家略有出入，比如 飲、駅、店、花、魚、口、手、言、会 等字，有的表放在 N5，这里和多数 80 字的 N5 表一样放在 N4），读音只列学习者常见的；释义和例词是本站编写的。「真题」一栏来自本站整理的 2010–2026 年 ${level} 及以下级别真题文字词汇部分考过的词，×2 表示这个词考过 2 次。`, `The JLPT has published no official kanji list since 2010. This page follows the commonly used ${level} list (lists differ slightly: some put 飲, 駅, 店, 花, 魚, 口, 手, 言, 会 and a few others at N5; here, as in the 80-kanji N5 lists, they are N4), with the readings learners actually meet; meanings and example words are written for this site. "On the test" lists words containing the kanji that the vocabulary section of real ${level}-and-below tests asked (2010–2026, collected by this site); ×2 means asked twice.`)}</p>
<p>${t2(`练汉字读音和写法：<a href="${SITE_PATH}${lv}-vocabulary/">${level} 词汇练习</a>（汉字读音、表记题）${hasVl ? ` · <a href="${SITE_PATH}${vlId}/">${level} 高频词汇</a>` : ""} · <a href="${SITE_PATH}${practiceId}/">${level} 练习题</a>。`, `Practise readings and spellings: <a href="${SITE_PATH}${lv}-vocabulary/">${level} vocabulary practice</a> (kanji reading and writing questions)${hasVl ? ` · <a href="${SITE_PATH}${vlId}/">${level} vocabulary list</a>` : ""} · <a href="${SITE_PATH}${practiceId}/">${level} practice test</a>.`)}</p></section>`;
        const schema = JSON.stringify([
          { "@context": "https://schema.org", "@type": "LearningResource", name: m.h1, description: m.desc, url: v.url, inLanguage: en ? "en" : "zh-Hans",
            educationalLevel: `JLPT ${level}`, isAccessibleForFree: true, learningResourceType: "Kanji list", teaches: rows.map((r) => r.k).join(""),
            about: { "@type": "Thing", name: "Kanji" }, provider: { "@type": "Organization", name: "jpnotes.dev", url: SITE } },
          { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE },
            { "@type": "ListItem", position: 2, name: level, item: `${SITE}${level}/` },
            { "@type": "ListItem", position: 3, name: m.crumb, item: v.url }] },
        ]).replace(/</g, "\\u003c");
        writeLangPage(kjId, lang, localizePage(renderQuiz(lang, { ...m, body, schema }, v, level, null), lang, localizedPageIds));
      }
      quizPageIds.push(kjId);
      console.log(`  Generated dist/${kjId}/ (${n} kanji, ${tested} seen on the test)`);
    }
    if (!mocks.length) continue;
    // Mock tests: the test file, and its answer key loaded only after submitting.
    const sets = mocks.map(({ test, key }) => ({ id: test.id, n: test.n, src: writeQuizDataByLang(`${test.id}.json`, test), key: writeQuizDataByLang(`${test.id}.key.json`, key) }));
    // sections: what each test is, for the mock list's one-line summary (setWhat() in quiz.js).
    // test.sections are the sittings actually written, so a listening sitting left out for missing audio isn't listed.
    const secsOf = mocks.map(({ test }) => test.sections.map((sec) => ({ ja: sec.ja, zh: sec.zh, en: sec.en, minutes: sec.minutes, n: sec.problems.reduce((a, p) => a + p.ids.length, 0) })));
    const setsFor = (code) => JSON.stringify(sets.map((x, i) => ({ ...x, src: x.src[code], key: x.key[code], sections: secsOf[i] }))).replace(/'/g, "\\u0027");
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
  // Readable text under the hubs (2026-11-24): what each level's pages hold,
  // counted from the bundles, and how to choose. GROUPS: the test's four parts.
  const HUB_GROUPS = [["moji", "文字词汇", "Vocabulary"], ["bunpou", "语法", "Grammar"], ["dokkai", "阅读", "Reading"], ["choukai", "听力", "Listening"]];
  const HUB_LEVELS = ["N5", "N4", "N3", "N2", "N1"].filter((l) => quizBundles[l]);
  // A type's levels, when it isn't on every level: "（N3 N2 N1）".
  const typeLevels = (k, L) => { const ls = HUB_LEVELS.filter((l) => quizBundles[l].practice.types[k]); return ls.length === HUB_LEVELS.length ? "" : L(`（${ls.join(" ")}）`, ` (${ls.join(" ")})`); };
  const LEVEL_CAN_DO = (L) => ({
    N5: L("能读懂用平假名、片假名和基础汉字写的常见句子；能听懂课堂和日常生活中说得很慢的简短对话。", "Reads typical phrases and sentences in hiragana, katakana and basic kanji; follows short, slowly spoken conversations about the classroom and daily life."),
    N4: L("能读懂用基础词汇和汉字写的、关于日常话题的文章；能基本听懂说得稍慢的日常对话。", "Reads passages on familiar daily topics in basic vocabulary and kanji; mostly follows everyday conversations spoken a little slowly."),
    N3: L("能在一定程度上理解日常场景里的日语：读懂日常话题的具体文章、报纸标题；听懂接近自然语速的日常对话。", "Understands everyday Japanese to a certain degree: concrete texts on daily topics, newspaper headlines, and conversations at near-natural speed."),
    N2: L("除日常场景外，也能在较广的场合理解日语：读懂报刊上各种话题的报道和评论；听懂自然语速的对话和新闻。", "Beyond everyday situations, understands Japanese in a wider range of settings: newspaper and magazine articles and commentary, conversations and news at natural speed."),
    N1: L("能理解各种场合的日语：读懂社论等逻辑较复杂、内容抽象的文章；听懂自然语速的深入对话、新闻和讲座。", "Understands Japanese in a broad range of circumstances: logically complex, abstract writing such as editorials, and in-depth conversations, news and lectures at natural speed."),
  });
  const practiceHubAbout = (en) => {
    const L = (zh, e) => (en ? e : zh);
    const cnt = (l, g) => quizBundles[l].practice.questions.filter((q) => (quizBundles[l].practice.types[q.type] || {}).g === g).length;
    const pre = HUB_LEVELS.some((l) => quizBundles[l].practice.questions.some((q) => q.pre));
    const allTypes = [...new Set(HUB_LEVELS.flatMap((l) => Object.keys(quizBundles[l].practice.types)))];
    const typesOf = (g) => allTypes.filter((k) => QUIZ_TYPES[k] && QUIZ_TYPES[k].g === g).map((k) => `${L(QUIZ_TYPES[k].zh, QUIZ_TYPES[k].en)}${typeLevels(k, L)}`).join(L("、", ", "));
    return `<section class="quiz-about">
<h2>${L("各级别的题库", "What each level has")}</h2>
<div class="table-scroll"><table><tr><th>${L("级别", "Level")}</th>${HUB_GROUPS.map(([, z, e]) => `<th>${L(z, e)}</th>`).join("")}<th>${L("合计", "Total")}</th></tr>${HUB_LEVELS.map((l) => `<tr><td><a href="${SITE_PATH}${l.toLowerCase()}-practice/">${l}</a></td>${HUB_GROUPS.map(([g]) => `<td>${cnt(l, g) || "—"}</td>`).join("")}<td>${quizBundles[l].practice.questions.length}</td></tr>`).join("")}</table></div>
<p>${L("表里是各级别练习页现有的题数，按真考的四个部分分开；阅读和听力按题算，一篇文章或一段录音常常带几道题。新题上线后数字自动更新。", "These are the questions on each level's practice page, split by the test's four parts. Reading and listening count questions, and one passage or recording often carries several. The numbers update as new questions go live.")}${pre ? L("低一级课文里提前教的语法，题目在高一级的题库里也有；在低一级的页面上标为「预习」，不计入进度。", " Grammar that a lower level's lessons teach early has its questions in the higher level's bank too; on the lower level's page they're marked as a preview and kept out of your progress.") : ""}</p>
<h2>${L("题型和真考一样", "The real test's item types")}</h2>
<ul>${HUB_GROUPS.map(([g, z, e]) => `<li><b>${L(z, e)}</b>${L("：", ": ")}${typesOf(g)}</li>`).join("")}</ul>
<p>${L("括号里是只在部分级别出现的题型。题目全部原创，格式、长度和难度按各级别真题设计。", "Brackets mark item types that only some levels have. Every question is original, written to each level's format, length and difficulty.")}</p>
<h2>${L("怎么用", "How it works")}</h2>
<p>${L("选好级别后，可以做「今日练习」（每天一组，各部分混合），也可以按题型专练。每题答完马上判分：正确答案为什么对、每个错误选项错在哪里都有解析，语法题还链到讲这个语法点的课。答错、点了「不会」或标为猜的题进错题本，当天、3 天后、7 天后再考你，答对才移出。进度保存在这个浏览器里；登录后可以在手机和电脑之间同步。", "Pick a level, then do the daily set (a short mix of every part) or drill one item type. Each answer is marked at once, with why the right option is right and where each wrong one goes wrong; grammar questions link to the lesson that teaches the point. Questions you miss, mark “I don’t know” or flag as a guess go to a review list and come back the same day, after 3 days and after 7 days, until you get them right. Progress stays in this browser; sign in to sync it between phone and computer.")}</p>
<h2>${L("选哪个级别", "Which level is yours")}</h2>
<p>${L("JLPT 官方对各级别的描述（概括）：", "How the JLPT describes each level (summarised):")}</p>
<ul>${HUB_LEVELS.map((l) => `<li><b>${l}</b> — ${LEVEL_CAN_DO(L)[l]}</li>`).join("")}</ul>
<p>${L("拿不准的话，先在比目标低一级的页面做一组今日练习：大部分都能答对，就往上一级。", "Not sure? Do a daily set one level below your goal; if you get most of it right, move up a level.")}</p>
</section>`;
  };
  for (const lang of PAGE_LANGS) {
    const en = lang.code === "en";
    const m = { ...hubMeta[lang.code], ogImage: "practice/og-image.png", body: `${hubIntro(en)}<div class="table-scroll"><table class="hub-table"><tbody>${["N5", "N4", "N3", "N2", "N1"].map((l) => hubRow(l, en)).join("")}</tbody></table></div>
      <script>${HUB_PROGRESS_JS}</script>
      <p class="hub-listen">${en
        ? ckLevels.length ? `🎧 <b><a href="${SITE_PATH}listening/">Listening practice for every level</a>.</b> For real Japanese, the <a href="${podcastUrl(true, "practice-hub")}" target="_blank">Japanese Daily News podcast</a> has a real Japanese news story every day, with transcripts.` : `🎧 <b>Listening questions are planned, not built yet.</b> If you want them, <a href="#feedback" class="fb-open">say so</a> — demand decides what comes first. Meanwhile the <a href="${podcastUrl(true, "practice-hub")}" target="_blank">Japanese Daily News podcast</a> has a real Japanese news story every day, with transcripts.`
        : ckLevels.length ? `🎧 <b><a href="${SITE_PATH}listening/">各级别的听力练习</a>。</b>想听真实的日语，可以用 <a href="${podcastUrl(false, "practice-hub")}" target="_blank">Japanese Daily News 播客</a>练听力（每天一则日语新闻，附原文和中文翻译）。` : `🎧 <b>听力题在规划中，还没做。</b>想要的话<a href="#feedback" class="fb-open">告诉我们</a>，想要的人多就先做。现在可以先用 <a href="${podcastUrl(false, "practice-hub")}" target="_blank">Japanese Daily News 播客</a>练听力（每天一则日语新闻，附原文和中文翻译）。`}</p>
      <p class="hub-listen">${en ? `By section: <a href="${SITE_PATH}listening/">listening</a> · <a href="${SITE_PATH}reading/">reading</a> · <a href="${SITE_PATH}vocabulary/">vocabulary</a> · <a href="${SITE_PATH}mock-test/">mock tests</a>. 💡 Tips: <a href="${SITE_PATH}jlpt-vocabulary-grammar-tips/">vocabulary &amp; grammar</a> · <a href="${SITE_PATH}jlpt-reading-tips/">reading</a> · <a href="${SITE_PATH}jlpt-listening-tips/">listening</a>. 📄 <a href="${SITE_PATH}jlpt-past-papers/">JLPT past papers (official, free)</a>.` : `按部分练：<a href="${SITE_PATH}listening/">听力</a> · <a href="${SITE_PATH}reading/">阅读</a> · <a href="${SITE_PATH}vocabulary/">词汇</a> · <a href="${SITE_PATH}mock-test/">模拟题</a>。💡 做题技巧：<a href="${SITE_PATH}jlpt-vocabulary-grammar-tips/">文字词汇与语法</a> · <a href="${SITE_PATH}jlpt-reading-tips/">阅读</a> · <a href="${SITE_PATH}jlpt-listening-tips/">听力</a>。📄 <a href="${SITE_PATH}jlpt-past-papers/">JLPT 真题（官方免费）</a>。`}</p>` };
    writeLangPage("practice", lang, localizePage(renderQuiz(lang, { ...m, about: practiceHubAbout(en) }, langVariant("practice", lang), "", null), lang, localizedPageIds));
  }
  quizPageIds.push("practice");

  const tipsLink = (slug, L, zh, en) => fs.existsSync(path.join(__dirname, "grammar/guides", `${slug}.md`)) ? `<p class="hub-listen">💡 <b><a href="${SITE_PATH}${slug}/">${L(zh, en)}</a></b></p>` : "";
  // /listening/: the one page for "jlpt listening practice" with no level in the
  // query. The level pages stay the ones with the questions.
  if (ckLevels.length) {
    const ckStats = (level) => {
      const b = quizBundles[level], types = Object.keys(b.practice.types).filter((k) => b.practice.types[k].g === "choukai");
      const qs = b.practice.questions.filter((q) => types.includes(q.type));
      return { types, qs: qs.length, recs: new Set(qs.map((q) => q.passage || q.id)).size, minutes: QUIZ_MOCK[level].sections.find((x) => x.listening).minutes, min: QUIZ_MOCK[level].listening.min, max: QUIZ_MOCK[level].listening.max, mock: b.mocks.length > 0 };
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
    const about = (L) => `${tipsLink("jlpt-listening-tips", L, "听力做题技巧：每种题型先看什么、听什么，常见陷阱", "Listening tips: what to read first and listen for in each item type, and the usual traps")}<p class="hub-listen">🎧 <b><a href="${SITE_PATH}grammar-audio/">${L("语法听读：N5–N1 每个语法点带例句朗读，可以当播客连播", "Grammar audio: every N5–N1 grammar point read aloud with examples, playable like a podcast")}</a></b></p><section class="quiz-about">
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
<div class="table-scroll"><table><tr><th>${L("级别", "Level")}</th><th>${L("语速", "Speed")}</th><th>${L("考试时长", "Time on the test")}</th><th>${L("听力最低分", "Minimum score")}</th><th>${L("这里的录音", "Recordings here")}</th></tr>${ORDER.map((l) => `<tr><td>${l}</td><td>${listeningPace(L)[l]}</td><td>${L(`约 ${stats[l].minutes} 分钟`, `about ${stats[l].minutes} min`)}</td><td>${stats[l].min} / ${stats[l].max}</td><td><a href="${SITE_PATH}${l.toLowerCase()}-listening/">${L(`${stats[l].recs} 段 · ${stats[l].qs} 题`, `${stats[l].recs} · ${stats[l].qs} questions`)}</a></td></tr>`).join("")}</table></div>
<p>${L("总分过线还不够，听力低于最低分同样不合格，所以听力要单独准备。", "A passing total isn't enough: scoring below the listening minimum fails the test, so listening needs its own practice.")}</p>
<h2>${L("适合谁", "Who it's for")}</h2>
<p>${L("主要是准备 JLPT 的人：选你要考的级别，把每种听力题型都练到，再用模拟题按真考节奏做一遍。也适合想提高听力、但还听不太懂日剧和新闻的人：N4、N3 的对话语速稍慢、说得清楚，答完能对着原文逐句重听，比直接听原声材料容易起步。级别拿不准，就从低一级开始：大部分能听懂再往上。", "Mainly for people preparing for the JLPT: pick the level you're taking, cover every listening item type, then sit a mock test at the real pace. It also suits anyone who wants better listening but can't yet follow dramas or the news: the N4 and N3 dialogues are a little slower and clearly spoken, and after answering you can replay them line by line against the transcript — an easier start than native material. Unsure of your level? Start one below and move up once you follow most of it.")}</p>
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
  // /words/: the reader's word list on its own page, all levels (site/words.js;
  // the same jp_quiz_v1 words every page adds to). word-levels.json: lemma → the
  // lowest level whose meanings file has it, for words saved without a level.
  {
    const order = ["N5", "N4", "N3", "N2", "N1"], levels = {};
    for (const lv of order) {
      const f = path.join(__dirname, "questions", "words", `${lv}.json`);
      if (!fs.existsSync(f)) continue;
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(f, "utf-8")))) if (v && !v.skip && !levels[k]) levels[k] = lv;
    }
    const levelsSrc = writeQuizData("word-levels.json", levels);
    // The 复习 pages' tab bar: 错题 | 生词本 | 语法卡, the current one filled.
    const wbSwitch = (cur, en) => `<nav class="wb-switch" aria-label="${en ? "Review" : "复习"}">${[["review", "✍", en ? "Mistakes" : "错题"], ["words", "📖", en ? "Word list" : "生词本"], ["my-grammar", "🗂", en ? "Grammar cards" : "语法卡"], ...(NOTES_SRC ? [["my-notes", "✎", en ? "Notes" : "笔记"]] : [])].map(([id, ico, l]) =>
      id === cur ? `<b aria-current="page"><span aria-hidden="true">${ico}</span>${l}</b>` : `<a href="${SITE_PATH}${en ? "" : "zh/"}${id}/"><span aria-hidden="true">${ico}</span>${l}</a>`).join("")}</nav>`;
    const WB_JS = fs.readFileSync(path.join(__dirname, "site", "words.js"), "utf-8");
    fs.writeFileSync(path.join(__dirname, "dist", "words.js"), WB_JS, "utf-8");
    const wbHash = require("crypto").createHash("md5").update(WB_JS).digest("hex").slice(0, 8);
    const wbCss = `<style>#wb-app,#mg-app{margin-top:1rem}
.wb-switch{display:inline-flex;gap:4px;margin:1.2rem 0 .2rem;padding:4px;border:1px solid var(--border);border-radius:14px;background:var(--card-bg)}
.wb-switch a,.wb-switch b{display:inline-flex;align-items:center;gap:.4rem;padding:.55rem 1.5rem;border-radius:10px;font-size:1.05rem;font-weight:600;text-decoration:none;color:var(--ui)}
.wb-switch b{background:var(--ui);color:var(--ui-on)}.wb-switch a:hover{background:var(--ui-soft)}.wb-switch small{font-weight:400;opacity:.75;font-size:.8em}
@media (max-width:600px){.wb-switch{display:flex}.wb-switch a,.wb-switch b{flex:1;justify-content:center;padding:.55rem .6rem}}.wb-tabs{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 1rem}.wb-tabs button{font:inherit;font-size:.9rem;padding:.3rem .85rem;border-radius:var(--radius-pill,16px);border:1px solid var(--border);background:var(--card-bg);color:var(--ui);cursor:pointer}.wb-tabs button small{color:var(--text-muted)}.wb-tabs button[aria-selected=true]{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}.wb-tabs button[aria-selected=true] small{color:inherit;opacity:.8}
.wb-sum{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.6rem;padding:.7rem .9rem;border-radius:var(--radius);background:var(--chip-bg);margin:0 0 1rem}
.wb-btn{font:inherit;font-size:.88rem;padding:.35rem .8rem;border-radius:8px;border:1px solid var(--border);background:var(--card-bg);color:var(--ui);cursor:pointer;white-space:nowrap}.wb-primary{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}.wb-big{font-size:1.05rem;padding:.6rem 1.6rem}
.wb-list{list-style:none;padding:0;margin:0}.wb-list li{display:grid;grid-template-columns:minmax(6rem,auto) 1fr auto;gap:.3rem 1rem;align-items:center;padding:.65rem .2rem;border-bottom:1px solid var(--border)}
.wb-w{font-size:1.25rem;font-weight:600}.wb-w rt{font-size:.55em;font-weight:400}.wb-meta{font-size:.8rem;color:var(--text-muted);margin-top:.15rem}.wb-lv{display:inline-block;font-size:.72rem;padding:0 .4rem;margin-right:.45rem;border:1px solid var(--border);border-radius:6px}
.wb-acts{display:flex;gap:.35rem}.wb-pages{display:flex;flex-wrap:wrap;gap:.35rem;margin:1rem 0}.wb-pages button:disabled{opacity:.4;cursor:default}.wb-pg.on{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}.wb-done{margin-top:1.4rem}.wb-done summary{cursor:pointer;font-weight:600;margin-bottom:.4rem}.wb-muted{color:var(--text-muted)}.wb-empty{padding:1.2rem 1rem;border:1px dashed var(--border);border-radius:var(--radius)}
.wb-top{display:flex;gap:1rem;align-items:center;margin-bottom:1rem;color:var(--text-muted)}.wb-link{font:inherit;border:0;background:none;color:var(--ui);cursor:pointer;padding:0}
.wb-card{text-align:center;padding:2rem 1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card-bg)}.wb-card-w{font-size:2.4rem;font-weight:700;margin:.4rem 0 1rem}.wb-card-w rt{font-size:.45em;font-weight:400}.wb-card-m{font-size:1.1rem;margin:0 0 1.2rem}.wb-card-acts{display:flex;justify-content:center;gap:.6rem;flex-wrap:wrap}.wb-card kbd{font-size:.7rem;opacity:.6}
@media (max-width:600px){.wb-list li{grid-template-columns:1fr auto}.wb-acts{grid-column:1/-1}}</style>`;
    const meta = {
      en: { title: "My Japanese Word List — Review Saved Words with Flashcards", desc: "Every Japanese word you saved on jpnotes.dev, from lessons, practice questions and audio pages, sorted by JLPT level, with spaced-repetition flashcards.", h1: "My word list", crumb: "Word list",
        lead: "Every word you added anywhere on the site — lesson examples, practice questions, grammar audio, vocabulary lists — in one place, sorted by JLPT level. Study the ones due today with flashcards; a word you keep remembering moves to “learned”." },
      zh: { title: "我的生词本 - 全站收藏的日语单词，按级别背", desc: "你在 jpnotes.dev 课文、练习题、语法听读页加入的所有日语单词，按 JLPT 级别分开，用间隔重复的单词卡背。", h1: "我的生词本", crumb: "生词本",
        lead: "你在全站加入的单词都在这里：课文例句、练习题、语法听读、高频词汇……按 JLPT 级别分开。每天背到期的词，一直记得的会移到「已掌握」。登录后在各设备同步。" },
    };
    for (const lang of PAGE_LANGS) {
      const en = lang.code === "en", v = langVariant("words", lang), m = meta[lang.code];
      writeLangPage("words", lang, localizePage(renderQuiz(lang, {
        ...m, nav: "", ogImage: "og-image.png", noindex: true,   // personal: empty for a crawler (2026-11-24, AdSense thin pages)
        body: `${wbCss}${wbSwitch("words", en)}<div id="wb-app" data-levels="${levelsSrc}"><p class="wb-muted">${en ? "Loading…" : "加载中…"}</p></div><script src="${SITE_PATH}words.js?v=${wbHash}" defer></script>`,
        about: "",
        schema: JSON.stringify([{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE }, { "@type": "ListItem", position: 2, name: m.crumb, item: v.url }] }]).replace(/</g, "\\u003c"),
      }, v, "", null), lang, localizedPageIds));
    }
    console.log("  Generated dist/words/ (word list)");

    // /my-grammar/: the reader's grammar cards (site/my-grammar.js): points added
    // on lesson pages or missed in practice (quiz/qrefs.json), learned = "got it";
    // the card index and card files come from build-anki.js (run after this in CI).
    const qrefsSrc = writeQuizData("qrefs.json", QREFS);
    const MG_JS = fs.readFileSync(path.join(__dirname, "site", "my-grammar.js"), "utf-8");
    fs.writeFileSync(path.join(__dirname, "dist", "my-grammar.js"), MG_JS, "utf-8");
    const mgHash = require("crypto").createHash("md5").update(MG_JS).digest("hex").slice(0, 8);
    const mgCss = `<style>.mg-term{font-size:1.1rem}.mg-card-lv{font-size:.8rem;color:var(--text-muted);margin:0}.mg-back{text-align:left;max-width:40rem;margin:0 auto 1.2rem;line-height:1.75}.mg-back table{border-collapse:collapse;font-size:.9rem}.mg-back td,.mg-back th{border:1px solid var(--border);padding:.25rem .5rem}.mg-ex{padding-left:1.2rem}.mg-ex li{margin:.5rem 0}.mg-muted{color:var(--text-muted)}
.mg-plan{margin:1rem 0 1.6rem;padding:1rem 1.1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card-bg)}.mg-plan h2,.mg-h{font-size:1.15rem;margin:0 0 .7rem}.mg-h{margin-top:1.4rem}
.mg-plan-row{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .5rem;margin-bottom:.8rem}.mg-lv.on{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}.mg-lv small{opacity:.7}.mg-newsel{margin-left:auto}.mg-newsel select{font:inherit;padding:.2rem .4rem;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:inherit}
.mg-prog{display:grid;gap:.4rem;margin:0 0 .8rem}.mg-prog-r{display:grid;grid-template-columns:auto 1fr auto;gap:.6rem;align-items:center;font-size:.85rem}.mg-bar{height:8px;border-radius:4px;background:var(--chip-bg);overflow:hidden}.mg-bar span{display:block;height:100%;background:var(--ui)}
.mg-plan .wb-sum{margin:0}</style>`;
    const mgMeta = {
      en: { title: "My Japanese Grammar Cards — Review the Points You Miss", desc: "The grammar points you saved or keep missing in practice on jpnotes.dev, sorted by JLPT level, with flashcards; the ones you've learned in a list of their own.", h1: "My grammar cards", crumb: "Grammar cards",
        lead: "The grammar points you added from the lessons, plus the ones you keep missing in practice, sorted by JLPT level — study them with flashcards. Points you ticked “Got it” are listed as learned." },
      zh: { title: "我的语法卡 - 收藏和做错的日语语法，按级别背", desc: "你在 jpnotes.dev 课文里加入的语法点、练习里常做错的语法点，按 JLPT 级别分开，用卡片背；标了已掌握的单独列出。", h1: "我的语法卡", crumb: "语法卡",
        lead: "你从课文里加入的语法点，加上练习里做错的语法点，按 JLPT 级别分开，用卡片背。标了「已掌握」的单独列在下面。登录后在各设备同步。" },
    };
    const switcher = wbSwitch;
    for (const lang of PAGE_LANGS) {
      const en = lang.code === "en", v = langVariant("my-grammar", lang), m = mgMeta[lang.code];
      writeLangPage("my-grammar", lang, localizePage(renderQuiz(lang, {
        ...m, nav: "", ogImage: "og-image.png", noindex: true,   // personal: empty for a crawler (2026-11-24, AdSense thin pages)
        body: `${wbCss}${mgCss}${switcher("my-grammar", en)}<div id="mg-app" data-index="${SITE_PATH}quiz/grammar-index.json" data-cards="${SITE_PATH}quiz/{lv}-cards.json" data-qrefs="${qrefsSrc}"><p class="mg-muted">${en ? "Loading…" : "加载中…"}</p></div><script src="${SITE_PATH}my-grammar.js?v=${mgHash}" defer></script>`,
        about: "",
        schema: JSON.stringify([{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE }, { "@type": "ListItem", position: 2, name: m.crumb, item: v.url }] }]).replace(/</g, "\\u003c"),
      }, v, "", null), lang, localizedPageIds));
    }
    console.log("  Generated dist/my-grammar/ (grammar cards)");

    // /my-notes/: every note the reader wrote under lesson grammar points and
    // practice questions. An empty shell: the notes script (NOTES_SRC, not in
    // this repo) fills #jp-my-notes, using the grammar index and the level's
    // question file for what each note belongs to.
    if (NOTES_SRC) {
      const mnMeta = {
        en: { title: "My Japanese Study Notes — Grammar Points and Practice Questions", desc: "The notes you wrote on jpnotes.dev under lesson grammar points and practice questions, private or shared, in one list you can search.", h1: "My notes", crumb: "Notes",
          lead: "Every note you wrote under a lesson grammar point or a practice question, newest first. Private ones only you can see; public ones others can read once approved. Open one to go back to its grammar point or question." },
        zh: { title: "我的笔记 - 课文语法点和练习题下写的笔记", desc: "你在 jpnotes.dev 课文语法点和练习题下面写的笔记，私有和公开的都在这里，可以搜索。", h1: "我的笔记", crumb: "笔记",
          lead: "你在课文语法点、练习题下面写的所有笔记，新的在前。私有的只有你看得到，公开的审核后大家都能看到。点一条回到原来的语法点或那道题。" },
      };
      for (const lang of PAGE_LANGS) {
        const en = lang.code === "en", v = langVariant("my-notes", lang), m = mnMeta[lang.code];
        writeLangPage("my-notes", lang, localizePage(renderQuiz(lang, {
          ...m, nav: "", ogImage: "og-image.png", noindex: true,   // personal: empty for a crawler (2026-11-24, AdSense thin pages)
          body: `${wbCss}${wbSwitch("my-notes", en)}<div id="jp-my-notes" data-index="${SITE_PATH}quiz/grammar-index.json" data-quiz="${SITE_PATH}quiz/{lv}.{lang}.json"><p class="wb-muted">${en ? "Loading…" : "加载中…"}</p></div>`,
          about: "",
          schema: JSON.stringify([{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE }, { "@type": "ListItem", position: 2, name: m.crumb, item: v.url }] }]).replace(/</g, "\\u003c"),
        }, v, "", null), lang, localizedPageIds));
      }
      console.log("  Generated dist/my-notes/ (notes)");
    }

    // /review/: 复习 › 错题 — every level's review list (site/review.js); the
    // questions are done on the practice pages (#review / #reviewlist).
    const RV_JS = fs.readFileSync(path.join(__dirname, "site", "review.js"), "utf-8");
    fs.writeFileSync(path.join(__dirname, "dist", "review.js"), RV_JS, "utf-8");
    const rvHash = require("crypto").createHash("md5").update(RV_JS).digest("hex").slice(0, 8);
    const rvMeta = {
      en: { title: "Review — Your JLPT Mistakes, Word List and Grammar Cards", desc: "Everything to review on jpnotes.dev in one place: the practice questions you missed, by level and due date, plus your word list and grammar cards.", h1: "Review", crumb: "Review",
        lead: "The practice questions you missed, by level — each comes back at growing intervals until you have it. Your word list, grammar cards and notes are in the tabs." },
      zh: { title: "复习 - 错题、生词本、语法卡一页看完", desc: "jpnotes.dev 上所有要复习的东西：各级别练习里做错的题（按到期时间）、生词本和语法卡。", h1: "复习", crumb: "复习",
        lead: "各级别练习里做错的题，按间隔提醒你再做一遍，直到真的会了。生词本、语法卡和笔记在上面的标签里。登录后在各设备同步。" },
    };
    const rvCss = `<style>.rv-list li{grid-template-columns:4rem 1fr auto}.rv-lv{font-size:.9rem;padding:.1rem .5rem}.rv-note{font-size:.85rem;margin-top:1rem}a.wb-btn{text-decoration:none;display:inline-block}</style>`;
    for (const lang of PAGE_LANGS) {
      const en = lang.code === "en", v = langVariant("review", lang), m = rvMeta[lang.code];
      writeLangPage("review", lang, localizePage(renderQuiz(lang, {
        ...m, nav: "", ogImage: "og-image.png", noindex: true,   // personal: empty for a crawler (2026-11-24, AdSense thin pages)
        body: `${wbCss}${rvCss}${wbSwitch("review", en)}<div id="rv-app"><p class="wb-muted">${en ? "Loading…" : "加载中…"}</p></div><script src="${SITE_PATH}review.js?v=${rvHash}" defer></script>`,
        about: "",
        schema: JSON.stringify([{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: en ? "Japanese Grammar Notes" : "日语语法笔记", item: SITE }, { "@type": "ListItem", position: 2, name: m.crumb, item: v.url }] }]).replace(/</g, "\\u003c"),
      }, v, "", null), lang, localizedPageIds));
    }
    console.log("  Generated dist/review/ (review hub)");
  }
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
<h2>${L("各级别的阅读有什么不同", "How reading differs by level")}</h2>
<div class="table-scroll"><table><tr><th>${L("级别", "Level")}</th><th>${L("考试时间", "Time on the test")}</th><th>${L("振假名", "Furigana")}</th><th>${L("计分", "Scored")}</th><th>${L("这里的题", "Here")}</th></tr>${ORDER5.map((l) => {
      const cfg = QUIZ_MOCK[l], sit = cfg.sections.find((x) => x.types.includes("short")) || cfg.sections[cfg.sections.length - 2];
      const fu = l === "N5" || l === "N4" ? L("有", "Yes") : l === "N3" ? L("只标基础汉字以外的词", "Only on less common kanji") : L("没有", "None");
      return `<tr><td>${l}</td><td>${L(`和${cfg.sections.length > 2 ? "语法" : "文字词汇、语法"}共用 ${sit.minutes} 分钟`, `${sit.minutes} min shared with ${cfg.sections.length > 2 ? "grammar" : "vocabulary and grammar"}`)}</td><td>${fu}</td><td>${cfg.scoring.length > 1 ? L("单独一科", "On its own") : L("和言语知识合并", "With language knowledge")}</td><td><a href="${SITE_PATH}${l.toLowerCase()}-reading/">${L(`${st[l].passages} 篇 · ${st[l].qs} 题`, `${st[l].passages} passages · ${st[l].qs} questions`)}</a></td></tr>`;
    }).join("")}</table></div>
<p>${L("阅读和语法在同一场考，时间要自己分配；文章越往上越长、越抽象。练习时可以先不计时，把每种题型的读法练熟，再用模拟题按真考时间做。答完一篇的最后一题后看全文翻译，对照找出读错的句子；短文、中篇和长篇还能听全文朗读。", "Reading shares its sitting with grammar, so you divide the time yourself, and the passages grow longer and more abstract at each level. Practise untimed at first until each item type feels familiar, then take a mock test at the real pace. After the last question on a passage, read the full translation to find the sentences you misread; short, mid-length and long passages can also be played aloud.")}</p>
<p>${L("适合准备 JLPT 的人，也适合想用短文章练阅读的人：从 N5、N4 带振假名的短文开始，能读懂大部分再往上。", "For JLPT candidates, and for anyone who wants short texts to build reading: start with the furigana passages of N5 and N4, and move up once you follow most of them.")}</p>
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
      ${(() => {   // the level's vocabulary list (words the real tests asked) when its track in this language exists
        const f = path.join(__dirname, "questions", "vocab-list", `${lv}.json`), vl = fs.existsSync(f) && JSON.parse(fs.readFileSync(f, "utf-8"));
        return vl && vl.tracks[L("zh", "en")]
          ? `<td><a class="hub-go" href="${SITE_PATH}${lv}-vocabulary-list/"><b>${L("📚 高频词汇", "📚 Vocabulary list")}</b><span>${L(`真题考过的 ${vl.items.length} 个词 · 朗读`, `${vl.items.length} words from real tests · audio`)}</span></a></td>`
          : `<td><a class="hub-go" href="${SITE_PATH}${lv}-cards/"><b>${L("语法卡片", "Grammar flashcards")}</b><span>${L("每个语法点一张", "one per grammar point")}</span></a></td>`;
      })()}</tr>`; },
    (L) => `${tipsLink("jlpt-vocabulary-grammar-tips", L, "文字词汇与语法做题技巧：读音陷阱、用法题、排序题★", "Vocabulary & grammar tips: reading traps, usage items, sentence order ★")}<section class="quiz-about">
<h2>${L("这里能练什么", "What you get")}</h2>
<ul>
<li>${L(`${total} 道原创文字词汇题，题型和真考一致：汉字读音、汉字写法、构词、选词填空、近义替换、用法。`, `${total} original vocabulary questions in the real test's item types: kanji reading, writing, word formation, word in context, paraphrase and usage.`)}</li>
<li>${L("和真考一样，题目不标振假名。答完看每个选项为什么对、为什么错。", "As on the real test, no furigana on the questions. After answering, see why each option is right or wrong.")}</li>
<li>${L("语法题在各级别的「练习题」里；语法卡片按课复习每个语法点。", "Grammar questions are in each level's practice page; the flashcards drill every grammar point by lesson.")}</li>
</ul>
<h2>${L("各级别有哪些题", "Questions per level and item type")}</h2>
${(() => {
      const keys = Object.keys(QUIZ_TYPES).filter((k) => QUIZ_TYPES[k].g === "moji" && ORDER5.some((l) => st[l].types.includes(k)));
      const n = (l, k) => quizBundles[l].practice.questions.filter((q) => q.type === k).length;
      return `<div class="table-scroll"><table><tr><th>${L("题型", "Item type")}</th>${ORDER5.map((l) => `<th><a href="${SITE_PATH}${l.toLowerCase()}-vocabulary/">${l}</a></th>`).join("")}</tr>${keys.map((k) => `<tr><td>${L(QUIZ_TYPES[k].zh, QUIZ_TYPES[k].en)} · <span lang="ja">${QUIZ_TYPES[k].ja}</span></td>${ORDER5.map((l) => `<td>${st[l].types.includes(k) ? n(l, k) : "—"}</td>`).join("")}</tr>`).join("")}</table></div>`;
    })()}
<p>${L("「—」表示这个级别的真考没有这种题型。汉字读音和写法考的是认字；选词填空、同义句和用法考的是词的意思和搭配，越往上占比越大。", "“—” means the level's real test has no such item. Kanji reading and writing test whether you know the characters; word in context, paraphrase and usage test meaning and collocation, and weigh more at higher levels.")}</p>
<h2>${L("怎么用", "How it works")}</h2>
<p>${L("每天做一组，或者只练一种题型（比如只练汉字读音）。答完马上看每个选项为什么对、为什么错。题目里不认识的词可以点开看读音和意思，加入生词本；生词本用单词卡按 1、3、7、14、30 天的间隔复习。答错的题进错题本，过几天再考你。", "Do a daily set, or drill one item type — kanji readings only, say. After each answer, see why every option is right or wrong. Tap a word you don't know in the question to see its reading and meaning and add it to your word list, which you review with flashcards at 1, 3, 7, 14 and 30 days. Questions you miss come back a few days later.")}</p>
<p>${L("适合考前补文字词汇的人：这部分题多、每题只有一个词或一句话，做得快才能把时间留给阅读。也适合想检验自己某个级别词汇量的人。", "For anyone shoring up vocabulary before the exam: it's many short items, and answering them quickly leaves time for reading. It also works as a check on your vocabulary at a level.")}</p>
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
<p>${L(`各部分的做题技巧：<a href="${SITE_PATH}jlpt-vocabulary-grammar-tips/">文字词汇与语法</a> · <a href="${SITE_PATH}jlpt-reading-tips/">阅读</a> · <a href="${SITE_PATH}jlpt-listening-tips/">听力</a>。考试安排：<a href="${SITE_PATH}jlpt-december-2026/">12 月 JLPT 考前指南</a>。官方真题：<a href="${SITE_PATH}jlpt-past-papers/">JLPT 真题与官方样题（N5–N1 免费下载）</a>。`, `Tips for each part: <a href="${SITE_PATH}jlpt-vocabulary-grammar-tips/">vocabulary &amp; grammar</a> · <a href="${SITE_PATH}jlpt-reading-tips/">reading</a> · <a href="${SITE_PATH}jlpt-listening-tips/">listening</a>. Exam day: <a href="${SITE_PATH}jlpt-december-2026/">December JLPT guide</a>. Official tests: <a href="${SITE_PATH}jlpt-past-papers/">JLPT past papers and official sample tests (N5–N1, free)</a>.`)}</p>
<h2>${L("各级别的模拟题", "The mock tests by level")}</h2>
<div class="table-scroll"><table><tr><th>${L("级别", "Level")}</th><th>${L("套数", "Sets")}</th><th>${L("言语知识・阅读", "Vocabulary, grammar, reading")}</th><th>${L("听力", "Listening")}</th><th>${L("合格线", "Pass mark")}</th><th>${L("各科最低分", "Section minimums")}</th></tr>${withMock.map((l) => {
      const b = quizBundles[l], cfg = QUIZ_MOCK[l], t = b.mocks[0].test;
      const nl = t.sections.filter((x) => x.listening).reduce((a, x) => a + x.problems.reduce((c, p) => c + p.ids.length, 0), 0);
      const mr = t.sections.filter((x) => !x.listening), mMin = mr.reduce((a, x) => a + x.minutes, 0), lMin = t.sections.filter((x) => x.listening).reduce((a, x) => a + x.minutes, 0);
      const mins = [...cfg.scoring.map((x) => `${L(x.zh, x.en)} ${x.min}/${x.max}`), `${L("听力", "Listening")} ${cfg.listening.min}/${cfg.listening.max}`].join(L("；", "; "));
      return `<tr><td><a href="${SITE_PATH}${l.toLowerCase()}-mock-test/">${l}</a></td><td>${b.mocks.length}</td><td>${L(`${t.questions.length - nl} 题 · ${mMin} 分钟`, `${t.questions.length - nl} questions · ${mMin} min`)}</td><td>${nl ? L(`${nl} 题 · ${lMin} 分钟`, `${nl} questions · ${lMin} min`) : L("不含", "Not included")}</td><td>${cfg.pass}/180</td><td>${mins}</td></tr>`;
    }).join("")}</table></div>
<p>${L("题数和时间按每级的第一套算，结构和真考一致。合格要同时满足两条：总分达到合格线，并且每一科都不低于最低分——总分够了、某一科没过最低分，照样不合格。", "Question counts and times are for each level's first set, laid out like the real test. To pass you need both: a total at or above the pass mark, and every section at or above its minimum — a good total with one section under its minimum still fails.")}</p>
<p>${L("可以整套做，也可以只做其中一节。每节单独计时，时间到自动结束；作答中能前后翻题、改答案、给拿不准的题做标记，但不显示对错。听力和真考一样每段只放一次。可以暂停，离开页面超过 1 分钟也会自动暂停，暂停过的成绩记为“非正式”。适合考前几周、已经按题型练过一轮的人，用来检查时间够不够、哪一科最危险。还没开始系统练习的话，先去各级别的练习题。", "Take the whole test or a single section. Each section has its own clock and ends when time is up; meanwhile you can move back and forth, change answers and flag the ones you're unsure of, but nothing is marked. Listening plays each recording once, as on the day. You can pause, and leaving the page for over a minute pauses too; a paused attempt is marked informal. Best a few weeks before the exam, once you've worked through the item types in practice — to see whether your time holds out and which section is most at risk. If you haven't practised yet, start with the level's practice questions.")}</p>
<h2>${L("常见问题", "Questions")}</h2>
<dl>${faqFree(L)}
<dt>${L("估分准吗？", "How accurate is the score?")}</dt><dd>${L("只是粗略估计。真考用等化计分，不是按答对题数直接换算。", "It's a rough estimate. The real test uses scaled scoring, not a straight count of correct answers.")}</dd>
</dl>
</section>`, "Practice test");
  }

  // /grammar-audio/: the level-less page for "japanese grammar audio" searches;
  // the level pages (questions/grammar-audio/{lv}.json) hold the player.
  {
    const gaStats = Object.fromEntries(ORDER5.map((l) => {
      const f = path.join(__dirname, "questions", "grammar-audio", `${l.toLowerCase()}.json`);
      if (!fs.existsSync(f)) return [l, null];
      const ga = JSON.parse(fs.readFileSync(f, "utf-8"));
      gaExam(ga.items, l);
      return [l, { n: ga.items.length, lessons: new Set(ga.items.map((it) => it.lesson)).size, exam: ga.items.filter((it) => (it.exam || []).length).length, min: { en: Math.round(ga.tracks.en.duration / 60), zh: Math.round(ga.tracks.zh.duration / 60) } }];
    }));
    const gaLevels = ORDER5.filter((l) => gaStats[l]);
    const gaJaOn = fs.existsSync(path.join(__dirname, "questions", "grammar-audio", "src", "ja.json"));   // the 意思：日本語 switch on the level pages
    const total = gaLevels.reduce((a, l) => a + gaStats[l].n, 0);
    if (gaLevels.length) hubPage("grammar-audio", {
      en: { title: "JLPT Grammar Audio — Free N5 to N1 Grammar Read Aloud with Examples", desc: `Listen to all ${total} JLPT grammar points from N5 to N1: each pattern, its meaning in English and two example sentences with translations, read aloud. Free, no sign-up, works on your phone.`, h1: "JLPT Grammar Audio", crumb: "Grammar audio", lead: "Choose your level. Every grammar point is read as pattern → meaning → example → translation; play a whole level like a podcast, or one lesson or one line at a time." },
      zh: { title: "JLPT 语法听读 - N5 到 N1 语法朗读，带例句和翻译，免费", desc: `免费 JLPT 语法朗读：N5 到 N1 共 ${total} 个语法点，每个都按「语法 → 中文意思 → 例句 → 翻译」读出来，可以像播客一样连播，也能单句循环，无需注册。`, h1: "JLPT 语法听读", crumb: "语法听读", lead: "选择你的级别。每个语法点按「语法 → 意思 → 例句 → 翻译」朗读；可以整级连播，也可以只听一课、一句。" },
    }, (level, L) => { const x = gaStats[level], lv = level.toLowerCase();
      if (!x) return "";
      return `<tr><th scope="row"><span class="level-tag">${level}</span></th>
      <td><a class="hub-go" href="${SITE_PATH}${lv}-grammar-audio/"><b>${L("语法听读", "Grammar audio")}</b><span>${L(`${x.n} 个语法点 · ${x.lessons} 课 · 约 ${x.min.zh} 分钟`, `${x.n} grammar points · ${x.lessons} lessons · about ${x.min.en} min`)}</span></a></td>
      <td class="hub-types"><a href="${SITE_PATH}${lv}-cards/">${L("语法卡片", "Flashcards")}</a> · <a href="${SITE_PATH}${lv}-practice/">${L("练习题", "Practice")}</a></td></tr>`; },
    (L) => `<section class="quiz-about">
<h2>${L("每个语法点读什么", "What each grammar point sounds like")}</h2>
<ol>
<li>${L("语法本身（日语）", "The pattern, in Japanese")}</li>
<li>${L("意思：一句话说清楚，中文页用中文，英文页用英文", "Its meaning in one sentence, in the page's language")}</li>
<li>${L("两个例句（日语），每句后面跟它的翻译", "Two example sentences in Japanese, each followed by its translation")}</li>
</ol>
<p>${L("页面上同时列出接续方式和易混语法，还有课程里的更多例句。每个语法点都链接到详细讲解的课。", "The page also shows how each pattern attaches and what it gets confused with, plus more examples from the lessons. Every point links to the lesson that explains it.")}</p>
<h2>${L("怎么用", "How to use it")}</h2>
<ul>
<li>${L("通勤、散步时整级连播，当播客听，熟悉每个语法的声音。", "On the commute or a walk, play a whole level like a podcast to get used to how each pattern sounds.")}</li>
<li>${L("关掉「念翻译」只听日语，检查自己能不能马上听懂。", "Turn off the translations and listen to the Japanese alone, to check you understand it straight away.")}</li>
<li>${L("「遮住意思」后先自己说出意思，再点开核对。", "Hide the meanings, say each one yourself, then reveal it to check.")}</li>
<li>${L("听不熟的那一句用单句循环，跟着读几遍。", "Loop a line you don't know yet and shadow it a few times.")}</li>
</ul>
${((ex) => ex.length ? `<p>${L(`标着「真题考过 N 次」的语法在往年真题里出现过（${ex.map((l) => `${l} ${gaStats[l].exam} 个`).join("、")}），考前可以优先听。`, `Patterns marked "on the real test N×" have appeared on past tests (${ex.map((l) => `${l}: ${gaStats[l].exam}`).join(", ")}) — worth hearing first before the exam.`)}</p>` : "")(gaLevels.filter((l) => gaStats[l] && gaStats[l].exam))}
<h2>${L("播放器能做什么", "What the player does")}</h2>
<ul>
<li>${L("<b>播放方式：</b>整体连播、一句一停、单句循环、本课连播；点任意一行从那里开始。", "<b>Play modes:</b> play all, one line at a time, loop a line, or this lesson only; tap any line to start there.")}</li>
<li>${L("<b>朗读内容：</b>全部朗读、只读日语（语法和例句，不念意思和翻译）、只读例句；「念翻译」可以单独关掉。", "<b>What is read:</b> everything, Japanese only (patterns and examples, no meanings or translations), or examples only; “Read translations” switches off on its own.")}</li>
<li>${L("<b>自测：</b>「遮住意思」把意思和翻译模糊掉，鼠标移上去才显示。", "<b>Self-test:</b> “Hide meanings” blurs the meanings and translations until you point at them.")}</li>
${gaJaOn ? `<li>${L("<b>日语释义：</b>「意思：日本語」把每个语法点的意思换成一句简短的日语解释，带振假名（朗读不变）。", "<b>Japanese definitions:</b> “Meaning: 日本語” swaps each meaning for a short Japanese explanation with furigana (the audio stays the same).")}</li>` : ""}
<li>${L("<b>语速：</b>0.8× 到 1.5×；空格键播放 / 暂停，← → 上一句 / 下一句。播放时页面跟着当前这一句滚动。", "<b>Speed:</b> 0.8× to 1.5×; Space plays / pauses, ← → go to the previous / next line. The page scrolls along with the line being read.")}</li>
</ul>
<div class="table-scroll"><table><tr><th>${L("级别", "Level")}</th><th>${L("语法点", "Grammar points")}</th><th>${L("课", "Lessons")}</th><th>${L("时长", "Length")}</th><th>${L("真考出现过的", "Seen on past tests")}</th></tr>${gaLevels.map((l) => { const x = gaStats[l]; return `<tr><td><a href="${SITE_PATH}${l.toLowerCase()}-grammar-audio/">${l}</a></td><td>${x.n}</td><td>${x.lessons}</td><td>${L(`约 ${x.min.zh} 分钟`, `about ${x.min.en} min`)}</td><td>${x.exam || "—"}</td></tr>`; }).join("")}</table></div>
<p>${L("适合已经学过、想反复复习语法的人：碎片时间听一遍，比翻笔记省事；也适合考前快速过一遍整个级别。第一次学某个语法，最好先看课文里的接续说明和辨析，再用这里巩固。", "For learners who have met the grammar and want to keep it fresh: a run-through in spare minutes is easier than rereading notes, and a whole level makes a quick pre-exam review. Meeting a pattern for the first time? Read its lesson first — how it attaches, and how it differs from look-alikes — then use this to keep it.")}</p>
<h2>${L("常见问题", "Questions")}</h2>
<dl>
<dt>${L("免费吗？要注册吗？", "Is it free? Do I need an account?")}</dt><dd>${L("完全免费，没有广告，不用注册，用手机浏览器打开就能听。", "It's free, with no ads and no sign-up. Open it in your phone's browser.")}</dd>
<dt>${L("是谁读的？", "Who is reading?")}</dt><dd>${L("AI 语音合成（Google Gemini）。每个日语例句都转写回文字核对过读音。", "AI speech (Google Gemini). Every Japanese example was transcribed back to text to check its reading.")}</dd>
<dt>${L("可以下载吗？", "Can I download it?")}</dt><dd>${L("目前只能在线播放。想离线复习可以用 <a href=\"" + SITE_PATH + "anki/\">Anki 卡组</a>。", "Not for now; it plays online. To review offline, use the <a href=\"" + SITE_PATH + "anki/\">Anki decks</a>.")}</dd>
</dl>
</section>`, "Audio");
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
  if (changelogGenerated) pushLangUrls("changelog", gitLastModTime("pages/changelog.md") || today, "weekly", "0.4");
  for (const id of policyPages) pushLangUrls(id, gitLastModTime(`pages/${id}.md`) || today, "yearly", "0.2");
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
- [JLPT grammar audio](${SITE}grammar-audio/): Every N5 to N1 grammar point read aloud: pattern, meaning, two examples with translations.
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
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 0 16px; background: #f6f4ef; color: #2b2a27; }
  @media (prefers-color-scheme: dark) { body { background: #14141e; color: #d4d4dc; } }
  .box { text-align: center; max-width: 30rem; }
  h1 { font-size: 3.5rem; margin: 0; }
  p { font-size: 1.1rem; margin: .8rem 0; }
  ul { list-style: none; padding: 0; margin: 1.2rem 0 0; line-height: 2; }
  a { color: #1f3d63; text-decoration: none; }
  @media (prefers-color-scheme: dark) { a { color: #a9c7ee; } }
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
    { slug: "grammar-audio", topLabel: "JLPT Grammar Audio · 语法听读", mainTitle: "JLPT 文法 音声", sub: "N5 → N1 · Every pattern read aloud · Free", accent: "#b8283f" },
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

  // Cloudflare (deploy/wrangler.site.toml serves dist/ as static assets) reads
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
    // Pages say UTF-8 in the header too: Cloudflare sends a bare "text/html", and
    // crawlers that don't read <meta charset> (OER Commons' tag import, ad
    // previews) then decode as Latin-1 — 日本語 and emoji came out as mojibake / "??".
    // Pages live at /, /x/ and /x/y/; a placeholder never matches a file with an extension.
    const HTML_UTF8 = ["/", "/:a/", "/:a/:b/"].map((p) => `${p}\n  Content-Type: text/html; charset=utf-8\n`).join("\n");
    fs.writeFileSync(path.join(dist, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n\n" + HTML_UTF8 + "\n/anki/*.apkg\n  Content-Type: application/octet-stream\n  Content-Disposition: attachment\n\n/cram/*\n  X-Robots-Tag: noindex, nofollow\n", "utf-8");
    // AdSense: the publisher authorised to sell ads on this site (the head meta tag is the verification).
    fs.writeFileSync(path.join(dist, "ads.txt"), `google.com, ${ADSENSE_PUB.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`, "utf-8");
    console.log(`  Generated dist/_redirects (${rules.length} rules), dist/_headers, dist/ads.txt`);
  }
  console.log(`Done! Output: ${OUT}, sitemap.xml, robots.txt, feed.xml, llms.txt, manifest.json, 404.html, og-image.png`);
}

// ─── CSS ───
// Dark theme tokens ("sumi": warm ink black, paper text, vermilion pen).
// Contrast on --bg / --card-bg: text ≥ 11:1, muted ≥ 6:1, accent ≥ 4.9:1.
const DARK_VARS = `
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
  --row-alt: rgba(255,255,255,.025);
  --panel-bg: #1b1b28;
  --chip-bg: #25253a;
  --chip-text: #e4e4ec;
  --word-border: #3a3a55;
  --code-bg: #1f1f2e;
  --ruby-color: #a8a8b8;
  --accent: #e94560;
  --accent-soft: rgba(233,69,96,.14);
  --ui: #a9c7ee; --ui-on: #10131c; --ui-soft: rgba(169,199,238,.14);
  --link: #a9c7ee;
  --selection-bg: #3b6fd6;
  --selection-fg: #fff;
  --shadow-sm: 0 1px 3px rgba(0,0,0,.3);
  --shadow-md: 0 2px 12px rgba(0,0,0,.35);
  --shadow-hover: 0 4px 18px rgba(0,0,0,.4);
`;
// The few dark rules tokens can't express, for one theme selector prefix.
function darkRules(p) {
  return `
${p} .breadcrumb { color: var(--text-muted) !important; }
${p} blockquote { background: rgba(233, 69, 96, 0.08); }
`;
}
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
/* Blue-white: cool white with blue ink. The auto theme on a light system uses
   it (A/B "look", launched 2026-11-18), and it can be chosen as a tone. Paper
   stays available as 纸张. */
html.tone-blue {
  --bg: #fff; --card-bg: #fff; --surface-2: #eaf2fe; --word-bg: #f1f6fd; --code-bg: #f1f6fd; --row-alt: #f6f9fe; --panel-bg: #f1f6fd; --chip-bg: #eef4fd;
  --border: #dfe7f3; --word-border: #cfdbee; --text: #16203a; --text-strong: #16203a; --text-muted: #55607a; --text-subtle: #7a849b; --ruby-color: #55607a;
  --ui: #2463d6; --ui-on: #fff; --ui-soft: #e6effd; --link: #1f5bc8; --sidebar-bg: #eaf2fe; --sidebar-text: #55607a; --sidebar-heading: #16203a; --sidebar-border: #dfe7f3; --sidebar-hover-bg: #e2ecfc; --sidebar-hover-text: #16203a; --selection-bg: #cfe1ff; --selection-fg: #16203a;
}
@media (prefers-color-scheme: light) {
  html:not(.theme-dark):not(.theme-light) {
    --bg: #fff; --card-bg: #fff; --surface-2: #eaf2fe; --word-bg: #f1f6fd; --code-bg: #f1f6fd; --row-alt: #f6f9fe; --panel-bg: #f1f6fd; --chip-bg: #eef4fd;
    --border: #dfe7f3; --word-border: #cfdbee; --text: #16203a; --text-strong: #16203a; --text-muted: #55607a; --text-subtle: #7a849b; --ruby-color: #55607a;
    --ui: #2463d6; --ui-on: #fff; --ui-soft: #e6effd; --link: #1f5bc8; --sidebar-bg: #eaf2fe; --sidebar-text: #55607a; --sidebar-heading: #16203a; --sidebar-border: #dfe7f3; --sidebar-hover-bg: #e2ecfc; --sidebar-hover-text: #16203a; --selection-bg: #cfe1ff; --selection-fg: #16203a;
  }
  html:not(.theme-dark):not(.theme-light) .td-card { background: #f1f6fd; border-color: transparent; }
}
html.tone-blue .td-card { background: #f1f6fd; border-color: transparent; }
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
  flex: 1; height: 6px; background: var(--border); border-radius: var(--radius-sm); overflow: hidden;
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
.exam-seen { font-size: .88rem; color: var(--text-muted); margin: -.3rem 0 .9rem; }
.gotit { font: inherit; font-size: .8rem; line-height: 1.4; padding: .1rem .6rem .1rem .45rem; margin-right: .5rem; border-radius: 12px; border: 1px solid var(--border, #ccc); background: transparent; color: var(--ui); cursor: pointer; white-space: nowrap; vertical-align: baseline; }
.gotit::before { content: "○ "; }
.gotit-add::before { content: "＋ "; }
.gotit-share::before { content: none; }
.gotit-add[aria-pressed="true"]::before { content: "✓ "; }
.gl-go { text-decoration: none; color: var(--text-muted); font-size: .9em; padding: 0 .25rem; }
.gl-go:hover { color: var(--ui); }
.gotit[aria-pressed="true"] { background: var(--ui); color: var(--ui-on); border-color: var(--ui); }
.gotit[aria-pressed="true"]::before { content: "✓ "; }
td .gotit { margin: 0; padding: .1rem .45rem; }
td .gotit::before { content: "○"; }
td .gotit[aria-pressed="true"]::before { content: "✓"; }
tr.gotit-on td { opacity: .55; }
html.gotit-hiding tr.gotit-on { display: none; }
#gotit-sum { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; margin: .8rem 0 1.2rem; padding: .55rem .8rem; border-radius: 10px; background: var(--chip-bg); font-size: .92rem; }
.gotit-hide { font: inherit; font-size: .85rem; padding: .2rem .7rem; border-radius: 14px; border: 1px solid var(--border, #ccc); background: transparent; color: var(--ui); cursor: pointer; }
.gotit-hide[aria-pressed="true"] { background: var(--ui); color: var(--ui-on); border-color: var(--ui); }
.seo-lead strong { color: var(--text-strong); font-weight: 600; }

.lesson-share { font: inherit; font-size: .8rem; margin-left: .6rem; padding: .1rem .6rem; border-radius: 12px; border: 1px solid var(--border, #ccc); background: transparent; color: var(--ui); cursor: pointer; }
.lesson-share:hover, .gotit-share:hover { background: var(--ui-soft); }
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
.quiz-cta .quiz-cta-more { margin: .8rem 0 0; font-size: .88rem; color: var(--text-muted); }
.quiz-cta .quiz-cta-more a { display: inline; padding: 0; border-radius: 0; background: none; color: var(--link); font-weight: 400; text-decoration: underline; }
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
.cross-link:hover .cross-link-level { color: inherit; opacity: .85; background: none; border-color: currentColor; }
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

/* Lesson header (presentLessonH1): a small kicker, the topic as the title,
   the lesson's patterns as a row of chips. */
.lesson-kicker { margin: 0 0 .3rem; font-size: .78rem; font-weight: 600; letter-spacing: .06em; color: var(--text-muted); }
.h1-topic { display: block; }
.h1-pats { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .7rem; font-size: .9rem; font-weight: 500; line-height: 1.4; }
.h1-sub { display: block; margin-top: .45rem; font-size: .9rem; font-weight: 400; color: var(--text-muted); }
.h1-pat { display: inline-block; padding: .2rem .65rem; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--card-bg); color: var(--text-strong); }
/* Grammar point headings (presentPointHeadings): number in red pen, the
   pattern at heading size, its gloss smaller and muted. */
.gp-num { color: var(--accent); font-variant-numeric: tabular-nums; }
.gp-pat { font-weight: 700; }
.gp-gloss { font-size: .66em; font-weight: 400; color: var(--text-muted); margin-left: .25em; letter-spacing: 0; }
@media (max-width: 768px) {
  .gp-gloss { display: block; margin: .15rem 0 0; line-height: 1.5; }
}
/* Vocabulary folded under one quiet row (presentVocab) */
details.vocab-fold { background: none; border-radius: 0; padding: 0; margin: 1.4rem 0 1rem; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
details.vocab-fold > summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 .3rem; padding: .55rem .15rem; list-style: none; font-weight: 400; color: var(--text-muted); }
details.vocab-fold > summary::-webkit-details-marker { display: none; }
details.vocab-fold > summary::before { content: "›"; display: inline-block; width: .9em; color: var(--text-muted); transition: transform var(--transition); }
details.vocab-fold[open] > summary::before { transform: rotate(90deg); }
details.vocab-fold > summary h2 { display: inline; margin: 0; font-size: .95rem; font-weight: 600; color: var(--text-strong); }
details.vocab-fold > summary:hover h2 { color: var(--link); }
.vocab-count { font-size: .85rem; }
details.vocab-fold > .table-scroll { margin-top: 0; }
/* A short taught pattern in an example never splits across lines */
li[data-ex] strong.nobr { white-space: nowrap; }

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
.site-footer a:hover { color: var(--link); }
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
  display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); grid-template-areas: "copy note" "actions note"; grid-template-rows: auto 1fr; gap: 0 2.6rem; align-items: start;
  padding: 2.2rem 0 2.4rem; border-bottom: 1px solid var(--border); margin-bottom: 2.2rem;
}
.home-hero h1 { font-size: 1.75rem; line-height: 1.35; margin: 0 0 .9rem; border: none; padding: 0; color: var(--text-strong); }
.home-intro { font-size: .98rem; color: var(--text-muted); margin: 0 0 1.4rem; line-height: 1.75; }
.home-intro strong { color: var(--text-strong); font-weight: 600; }
.hero-copy { grid-area: copy; }
.hero-note, .home-try { grid-area: note; }
.hero-note[hidden], .home-try[hidden] { display: none; }
.home-try { --try-ok: #1a7f4b; --try-ok-bg: rgba(26,127,75,.10); --try-bad: #c0263e; --try-bad-bg: rgba(192,38,62,.08); padding: 1rem 1.2rem 1.1rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card-bg); }
html.theme-dark .home-try { --try-ok: #4cc98a; --try-ok-bg: rgba(76,201,138,.14); --try-bad: #ff6b81; --try-bad-bg: rgba(255,107,129,.12); }
@media (prefers-color-scheme: dark) { :root:not(.theme-light) .home-try { --try-ok: #4cc98a; --try-ok-bg: rgba(76,201,138,.14); --try-bad: #ff6b81; --try-bad-bg: rgba(255,107,129,.12); } }
.try-top { display: flex; align-items: center; justify-content: space-between; gap: .8rem; margin-bottom: .7rem; }
.try-lead { font-size: .85rem; color: var(--text-muted); white-space: nowrap; }
.try-fill { color: var(--accent); font-weight: 700; }
.try-lvs { display: flex; gap: .25rem; }
.try-lv { min-width: 2.3rem; min-height: 2rem; padding: 0 .4rem; border: 1px solid transparent; border-radius: var(--radius); background: none; color: var(--text-muted); font: inherit; font-size: .82rem; font-weight: 600; cursor: pointer; }
.try-lv:hover { color: var(--ui); }
.try-lv[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.try-stem { margin: 0 0 .2rem; font-family: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", "Source Han Serif JP", serif; font-size: 1.3rem; line-height: 2.5rem; color: var(--text-strong); }
.try-stem rt { font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; font-size: .45em; }
.try-blank { color: var(--accent); white-space: nowrap; }
.try-tr { margin: 0 0 .5rem; font-size: .92rem; color: var(--text-muted); }
.try-opts { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin-top: .6rem; }
.try-opts-1 { grid-template-columns: 1fr; }
.try-opt { display: flex; align-items: center; gap: .6rem; min-height: 46px; padding: .4rem .7rem; border: 1.5px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text); font: inherit; font-size: 1.02rem; text-align: left; cursor: pointer; }
.try-opt:hover:not(:disabled) { border-color: var(--ui); }
.try-opt:disabled { cursor: default; }
.try-num { flex: none; width: 1.5rem; height: 1.5rem; border: 1px solid var(--border); border-radius: 50%; font-size: .78rem; line-height: 1.45rem; text-align: center; color: var(--text-muted); }
.try-opt.try-ok { border-color: var(--try-ok); background: var(--try-ok-bg); }
.try-opt.try-ok .try-num { background: var(--try-ok); border-color: var(--try-ok); color: var(--card-bg); }
.try-opt.try-bad { border-color: var(--try-bad); background: var(--try-bad-bg); }
.try-opt.try-bad .try-num { background: var(--try-bad); border-color: var(--try-bad); color: var(--card-bg); }
.try-opt.try-off { opacity: .6; }
.try-res { margin-top: .9rem; font-size: .92rem; line-height: 1.7; }
.try-verdict { margin: 0 0 .4rem; font-weight: 700; }
.try-verdict.ok { color: var(--try-ok); }
.try-verdict.bad { color: var(--try-bad); }
.try-mine { margin: 0 0 .6rem; padding: .5rem .7rem; border-left: 3px solid var(--try-bad); background: var(--try-bad-bg); border-radius: 0 var(--radius) var(--radius) 0; }
.try-mine b { margin-right: .6em; font-weight: 600; }
.try-why { display: grid; grid-template-columns: max-content 1fr; gap: .35rem .8rem; margin: 0 0 .9rem; }
.try-k { color: var(--text-muted); font-size: .85em; padding-top: .12em; white-space: nowrap; }
.try-all { grid-column: 1 / -1; }
.try-next { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem 1rem; margin: 0; }
.try-next .btn-primary { display: inline-block; padding: .55rem 1.1rem; border-radius: var(--radius); background: var(--ui); color: var(--ui-on); font-weight: 600; text-decoration: none; }
.try-next .btn-primary:hover { opacity: .9; }
.try-lesson { color: var(--link); text-underline-offset: 3px; }
.home-actions { grid-area: actions; display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; }
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
  .home-hero { grid-template-columns: 1fr; grid-template-areas: "copy" "note" "actions"; gap: 1rem; padding: .6rem 0 1.6rem; margin-bottom: 1.6rem; }
  .home-hero h1 { margin-bottom: .5rem; }
  .home-try { padding: .8rem .9rem 1rem; }
  .try-stem { font-size: 1.18rem; line-height: 2.3rem; }
  .home-hero h1 { font-size: 1.4rem; }
  .home-intro { font-size: .9rem; margin-bottom: 0; }
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
  /* Word tables stack: word + reading on one line, the meaning below it. */
  table.word-table, table.word-table tbody { display: block; }
  table.word-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  table.word-table tr { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: .7rem; align-items: baseline; padding: .55rem .15rem; border-bottom: 1px solid var(--border); background: none; }
  table.word-table td { border: 0; padding: 0; min-width: 0; }
  table.word-table td:nth-child(2) { white-space: normal; }
  table.word-table td:nth-child(3) { grid-column: 1 / -1; margin-top: .15rem; }
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
  color: var(--link); text-decoration: underline;
  text-underline-offset: 2px;
}
.home-howto a:hover { text-decoration: underline; text-decoration-thickness: 2px; }

/* ─── Dark mode: "sumi" ───
   Ink-black paper, paper-coloured text, the same vermilion pen and an ink
   that turns into paper: primary buttons are paper on ink, links a washed
   indigo so they still read apart from body text. Everything else follows
   from the tokens, so the rules below stay few. Written once (DARK_VARS /
   darkRules) for both the OS preference and the manual choice. */
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) {${DARK_VARS}}
${darkRules(':root:not(.theme-light)')}
}
html.theme-dark {${DARK_VARS}}
${darkRules('html.theme-dark')}

/* ─── Search (command palette) ─── */
#search-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.45); display: flex; align-items: flex-start; justify-content: center; padding: 12vh 1rem 1rem; }
#search-overlay[hidden] { display: none; }
#search-box { width: 100%; max-width: 560px; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; background: var(--card-bg); color: inherit; border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); }
#search-input { border: none; outline: none; background: transparent; color: inherit; font-size: 1.05rem; padding: 1rem 1.2rem; border-bottom: 1px solid var(--border); }
#search-results { list-style: none; margin: 0; padding: .4rem; overflow-y: auto; }
#search-results a { display: flex; align-items: baseline; gap: .6rem; padding: .55rem .7rem; border-radius: var(--radius-lg); text-decoration: none; color: inherit; }
#search-results a.sel, #search-results a:hover { background: var(--ui); color: var(--ui-on); }
#search-results a.sel .sr-lvl, #search-results a:hover .sr-lvl { background: color-mix(in srgb, var(--ui-on) 25%, transparent); color: var(--ui-on); }
.sr-lvl { flex-shrink: 0; font-size: .7rem; font-weight: 700; background: var(--ui); color: var(--ui-on); padding: .1rem .4rem; border-radius: var(--radius-sm); }
.sr-title { font-weight: 600; }
.sr-pts { font-size: .8rem; opacity: .6; margin-left: auto; text-align: right; }
.search-empty { padding: 1rem 1.2rem; opacity: .6; }
#search-hint { font-size: .72rem; opacity: .55; padding: .5rem 1.2rem; border-top: 1px solid var(--border); }
@media (max-width: 600px) { #search-hint { display: none; } #search-overlay { padding: 6vh .6rem 1rem; } }

/* Desktop top-right quick controls (injected by settings-modal.js). On
   mobile the sidebar toolbar + settings modal take over, so the bar hides and
   the toolbar's search / AI / settings buttons only show there. */
/* The cluster sits on its own frosted backing so page text scrolling under
   it never shows through between the pills. */
#top-controls {
  position: fixed; top: .5rem; right: 1rem;
  display: flex; align-items: center; gap: .4rem; z-index: 200;
  padding: .3rem; border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border: 1px solid var(--border); box-shadow: var(--shadow-sm);
}
#top-controls .tc-pill { box-shadow: none; }
.tc-pill {
  background: var(--card-bg); color: inherit; font: inherit; font-size: .8rem;
  padding: .4rem .8rem; border-radius: var(--radius);
  border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  cursor: pointer; line-height: 1.2;
}
.tc-pill:hover { border-color: var(--ui); }
/* 生词本 entry (settings-modal.js wordsLink): icon + label; the phone bar shows the icon only */
a.tc-words { display: inline-flex; align-items: center; gap: .3rem; text-decoration: none; color: inherit; }
.m-words { text-decoration: none; }
.m-words .tc-words-l { display: none; }
.tc-pill input { margin: 0 .3rem 0 0; vertical-align: -1px; }
.tc-icon { padding: .38rem .55rem; display: inline-flex; align-items: center; }
.tc-icon svg, #settings-box .js-theme-btn svg { width: 17px; height: 17px; display: block; }
/* Furigana button: the word itself in the top bar, a kana over a kanji in the phone bar. Off = struck through / kana faded. */
.tc-ruby[aria-pressed="true"] { color: var(--ui); border-color: var(--ui); }
.tc-ruby[aria-pressed="false"] { color: var(--text-muted); text-decoration: line-through; }
.ruby-ico { display: inline-flex; flex-direction: column; align-items: center; font-size: 15px; line-height: 1; font-weight: 600; }
.ruby-ico > span { font-size: 9px; line-height: 1; margin-bottom: 1px; font-weight: 400; }
.m-btn.js-ruby-btn[aria-pressed="true"] { color: var(--ui); }
.m-btn.js-ruby-btn[aria-pressed="false"] .ruby-ico > span { opacity: .2; }
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
.sw-auto { background: linear-gradient(135deg, #eaf2fe 50%, #14141e 50%); }
.sw-blue { background: linear-gradient(135deg, #ffffff 50%, #2463d6 50%); }
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
.settings-switch input:checked + span::after { transform: translateX(1.1rem); background: var(--ui-on); }
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
.acct a:hover, .acct-link:hover { color: var(--link); }
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
.acct-levels b { flex: none; min-width: 2.2em; white-space: nowrap; color: var(--text-strong); }
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
