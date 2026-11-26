/* jpnotes.dev — optional sign-in and progress sync (practice, mock tests, flashcards).
 *
 * A signed-in reader's jp_quiz_v1 (site/quiz.js) is kept on api.jpnotes.dev
 * (worker/src/account.js) and merged with the copy in this browser, so a
 * phone and a laptop end up with the same history. Readers who don't sign in
 * never reach that server: nothing below runs a request without a token.
 *
 *   merge(local, remote)   pure; unit-tested by tools/sync-test.js
 *   window.jpSync          { changed(), now() } — quiz.js calls changed() on every save
 *
 *   window.jpAccount       { mount(el) } — settings-modal.js hands over the account
 *                          block of its dialog each time it opens
 *
 * Loaded on every page (the account button is in the top bar everywhere). On
 * practice pages the state is quiz.js's (window.jpQuizState); elsewhere it is
 * read from and written to localStorage directly.
 * This browser keeps: localStorage jp_acct = { token, email, version, at }
 * and, from just before the first merge, jp_quiz_v1_backup.
 */
(function (root) {
  'use strict';
  var SCRIPT = typeof document !== 'undefined' ? document.currentScript : null;
  var KEEP_ANSWERS = 5;   // as in quiz.js

  function keys() {
    var seen = {}, out = [];
    for (var i = 0; i < arguments.length; i++) for (var k in (arguments[i] || {})) if (!seen[k]) { seen[k] = 1; out.push(k); }
    return out;
  }
  function lastT(s, q) { var a = (s.answers || {})[q]; return a && a.length ? a[a.length - 1].t : 0; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // quiz.js's today(): the local date of an answer's time (seconds).
  function day(t) { var d = new Date(t * 1000); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // Two copies of the state → one. Nothing either device recorded is lost:
  //   answers   per question, both histories by time, the last few kept
  //   review    the list entry (or its absence) from the side that answered the
  //             question last; a tie goes to the side changed more recently
  //   days      per date the larger count (the same answers are in both, so not the
  //             sum), raised to the number of answers the merged history has for it
  //   mock      every submitted attempt (by start time); the unfinished one that
  //             started later, unless it has been submitted since
  //   cards     per card the copy graded most recently
  //   fav       saved questions: per question whichever happened later, saving or removing
  //   session   this browser's unfinished practice set, never the other device's
  // `local` wins ties where there is no time to compare and it changed last.
  //
  // `epoch` is the exception to "nothing is lost": clearing progress, restoring
  // an earlier copy or importing a backup replaces the state and raises it. A
  // copy from a lower epoch is then dropped whole instead of merged back in.
  function merge(local, remote) {
    if (!remote) return local;
    if ((local.epoch || 0) !== (remote.epoch || 0)) {
      var win = (local.epoch || 0) > (remote.epoch || 0) ? local : remote, o = {};
      for (var key in win) o[key] = win[key];
      o.session = local.session || null;
      o.fbRids = rids(local, remote);   // replacing progress doesn't lose the way replies to feedback come back
      if (!o.fbRids.length) delete o.fbRids;
      lessonState(o, local, remote);    // nor the lesson ticks and display prefs, which live outside jp_quiz_v1
      return o;
    }
    var a = local, b = remote, prim = (a.at || 0) >= (b.at || 0) ? a : b, sec = prim === a ? b : a;
    var out = { v: 1 };
    out.answers = {};
    keys(a.answers, b.answers).forEach(function (q) {
      // The same answer on both sides is one answer. A reason picked after
      // answering (y, quiz.js 为什么错了) may be on either copy: keep the copy
      // that has one, the side changed last if both do.
      var seen = {}, all = [];
      ((prim.answers || {})[q] || []).concat((sec.answers || {})[q] || []).forEach(function (r) {
        var k = r.t + ':' + r.c, o = seen[k];
        if (!o) { seen[k] = r; all.push(r); }
        else if (r.y && !o.y) { all[all.indexOf(o)] = r; seen[k] = r; }
      });
      all.sort(function (x, y) { return x.t - y.t; });
      out.answers[q] = all.slice(-KEEP_ANSWERS);
    });
    out.review = {};
    keys(a.review, b.review).forEach(function (q) {
      var ta = lastT(a, q), tb = lastT(b, q), src = ta > tb ? a : tb > ta ? b : prim;
      if ((src.review || {})[q]) out.review[q] = src.review[q];
    });
    out.reported = keys.apply(null, [a.reported, b.reported].map(function (l) { var o = {}; (l || []).forEach(function (id) { o[id] = 1; }); return o; }));
    // Saved questions: per question the later of saving (+ms) and removing (−ms).
    out.fav = {};
    keys(a.fav, b.fav).forEach(function (q) {
      var x = (a.fav || {})[q] || 0, y = (b.fav || {})[q] || 0;
      out.fav[q] = Math.abs(x) >= Math.abs(y) ? x : y;
    });
    out.session = a.session || null;
    out.days = {};
    // … and at least the answers the merged history holds for that date, which
    // counts both devices when each did different questions that day.
    var seenDay = {};
    for (var qid in out.answers) out.answers[qid].forEach(function (r) { var d = day(r.t); seenDay[d] = (seenDay[d] || 0) + 1; });
    keys(a.days, b.days).forEach(function (d) { out.days[d] = Math.max((a.days || {})[d] || 0, (b.days || {})[d] || 0, seenDay[d] || 0); });
    out.prefs = {};
    [sec.prefs, prim.prefs].forEach(function (p) { for (var k in (p || {})) out.prefs[k] = p[k]; });
    out.mock = {};
    keys(a.mock, b.mock).forEach(function (id) {
      var x = (a.mock || {})[id] || {}, y = (b.mock || {})[id] || {}, seen = {};
      // One attempt on both sides: miss reasons picked in its review (answers[id].y) on either are kept.
      var atts = (x.attempts || []).concat(y.attempts || []).filter(function (t) {
        var o = seen[t.start];
        if (!o) { seen[t.start] = t; return true; }
        for (var k in (t.answers || {})) {
          var ta = t.answers[k], oa;
          if (!ta || !ta.y) continue;
          o.answers = o.answers || {}; oa = o.answers[k];
          if (!oa) o.answers[k] = ta; else if (!oa.y) oa.y = ta.y;
        }
        return false;
      });
      atts.sort(function (p, r) { return p.start - r.start; });
      var cur = x.current && y.current ? (x.current.start >= y.current.start ? x.current : y.current) : (x.current || y.current || null);
      if (cur && seen[cur.start]) cur = null;
      out.mock[id] = { current: cur, attempts: atts };
    });
    out.cards = {};
    keys(a.cards, b.cards).forEach(function (k) {
      var x = (a.cards || {})[k], y = (b.cards || {})[k];
      out.cards[k] = !x ? y : !y ? x : (x.t || 0) > (y.t || 0) ? x : (y.t || 0) > (x.t || 0) ? y : ((prim.cards || {})[k] || x);
    });
    out.cardDays = {};
    keys(a.cardDays, b.cardDays).forEach(function (d) {
      var x = (a.cardDays || {})[d] || {}, y = (b.cardDays || {})[d] || {};
      out.cardDays[d] = { n: Math.max(x.n || 0, y.n || 0), r: Math.max(x.r || 0, y.r || 0) };
    });
    // 生词本: per word the later of adding (t > 0) and removing (t < 0).
    out.words = {};
    keys(a.words, b.words).forEach(function (w) {
      var x = (a.words || {})[w], y = (b.words || {})[w];
      out.words[w] = !x ? y : !y ? x : Math.abs(x.t || 0) >= Math.abs(y.t || 0) ? x : y;
    });
    var r = rids(a, b); if (r.length) out.fbRids = r;
    lessonState(out, a, b);
    out.at = Math.max(a.at || 0, b.at || 0);
    // Fields a newer quiz.js may add: the more recent side's.
    keys(prim, sec).forEach(function (k) { if (!(k in out)) out[k] = k in prim ? prim[k] : sec[k]; });
    return out;
  }

  // Lesson review ticks and "got it" per grammar point ('g:lesson48#3'; build.js
  // gm script) (gchecks: 'lesson05:2' → +ms ticked / −ms unticked,
  // per box the later) and the furigana / language choice (ui: { hideRuby,
  // isEn, t }, the one chosen later). They live in their own localStorage keys
  // (jp_grammar_checks, jp_grammar_prefs); withLesson() / putLesson() carry
  // them in and out of the synced copy.
  function lessonState(out, a, b) {
    var g = {};
    keys(a.gchecks, b.gchecks).forEach(function (k) {
      var x = (a.gchecks || {})[k] || 0, y = (b.gchecks || {})[k] || 0;
      g[k] = Math.abs(x) >= Math.abs(y) ? x : y;
    });
    if (Object.keys(g).length) out.gchecks = g; else delete out.gchecks;
    var ua = a.ui, ub = b.ui, u = !ua ? ub : !ub ? ua : (ub.t || 0) > (ua.t || 0) ? ub : ua;
    if (u) out.ui = u; else delete out.ui;
  }

  // The ids feedback.js gave the notes sent from each device (a reply to any
  // of them shows on every device): both sides', newest last, at most 20.
  function rids(a, b) {
    var seen = {}, out = [];
    (a.fbRids || []).concat(b.fbRids || []).forEach(function (r) { if (typeof r === 'string' && !seen[r]) { seen[r] = 1; out.push(r); } });
    return out.slice(-20);
  }

  // Same content? Key order, `at` and the per-browser `session` don't count.
  function canon(o) {
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).sort().filter(function (k) { return o[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canon(o[k]); }).join(',') + '}';
    return JSON.stringify(o);
  }
  function strip(s) { var o = {}; for (var k in s) if (k !== 'session' && k !== 'at') o[k] = s[k]; return o; }
  function same(x, y) { return !!x && !!y && canon(strip(x)) === canon(strip(y)); }

  // Which JLPT level a question, mock set or flashcard belongs to ('n5' … 'n1'):
  // question and set ids start with it; a card key starts with its lesson number.
  var LESSON_LEVELS = [[17, 'n5'], [34, 'n4'], [58, 'n3'], [75, 'n2'], [92, 'n1']];
  function levelOf(id) {
    var m = /^(n[1-5])-/.exec(id);
    if (m) return m[1];
    var n = parseInt(id, 10);
    if (isNaN(n)) return '';
    for (var i = 0; i < LESSON_LEVELS.length; i++) if (n <= LESSON_LEVELS[i][0]) return LESSON_LEVELS[i][1];
    return '';
  }
  // The state without one level's answers, review entries, mock tests and cards
  // ('all': without any; settings and reported questions stay).
  function without(s, level) {
    var out = {}, k;
    for (k in s) out[k] = s[k];
    ['answers', 'review', 'mock', 'cards'].forEach(function (part) {
      out[part] = {};
      for (var id in (s[part] || {})) if (level !== 'all' && levelOf(id) !== level) out[part][id] = s[part][id];
    });
    if (level === 'all') { out.days = {}; out.cardDays = {}; out.session = null; }
    return out;
  }
  // What the state holds, per level: { n5: { answers, review, mocks, cards }, … } and the days practised.
  function summary(s) {
    var by = {}, add = function (id, what, n) { var l = levelOf(id); if (!l) return; (by[l] || (by[l] = { answers: 0, review: 0, mocks: 0, cards: 0 }))[what] += n; };
    for (var q in (s.answers || {})) if (s.answers[q].length) add(q, 'answers', 1);
    for (var r in (s.review || {})) add(r, 'review', 1);
    for (var m in (s.mock || {})) add(m, 'mocks', (s.mock[m].attempts || []).length);
    for (var c in (s.cards || {})) add(c, 'cards', 1);
    return { levels: by, days: Object.keys(s.days || {}).length };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { merge: merge, same: same, without: without, summary: summary, levelOf: levelOf }; return; }

  // ─── Browser ───
  if (!root.fetch) return;
  function EN() { return document.body.classList.contains('lang-en'); }
  function t(zh, en) { return EN() ? en : zh; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(name, p) { try { if (root.gaEvent) root.gaEvent(name, p); } catch (e) {} }
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };

  var q = new URLSearchParams(location.search);
  var LOCAL = q.get('acct') === 'local' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = LOCAL ? 'http://localhost:8788' : 'https://api.jpnotes.dev';
  var CLIENT_ID = SCRIPT && SCRIPT.getAttribute('data-gclient');
  // Sign-in by emailed code: on when the build says so; ?emaillogin=1 shows it before that, for testing.
  if (q.get('emaillogin') === '1') ls.set('jp_acct_email', '1');          // remembered, so it survives following a link
  var EMAIL_ON = !!(SCRIPT && SCRIPT.getAttribute('data-email') === '1') || ls.get('jp_acct_email') === '1';
  var mailState = { email: '', code: '', sent: false, busy: false, msg: '' };

  // ─── Which way in is offered first: Google's button or the email code ───
  // Google refuses sign-in inside apps' own browsers (embedded WebViews), and
  // mainland China can't reach it at all. There the email code comes first:
  //   • an app's built-in browser (WeChat, QQ, Douyin …; Android "; wv)", an iOS
  //     WebView = no "Safari/" in the UA): Google's script isn't even loaded;
  //   • a mainland-China time zone (Asia/Shanghai …): readers in Japan with a
  //     zh-CN browser keep Google first, which the language alone would not;
  //   • Google's script failed in this browser within the last 14 days (jp_gsi_bad);
  //   • a zh-CN / zh-Hans browser whose Google script hasn't loaded after 2.5 s
  //     (everyone else keeps the 4 s "isn't loading" notice and Google first).
  // Testing: ?inapp=1 acts as an app browser, ?tzcn=1 as a China time zone.
  var UA = (root.navigator && navigator.userAgent) || '';
  var INAPP_APPS = [['企业微信', 'WeCom', /wxwork/i], ['微信', 'WeChat', /MicroMessenger/], ['QQ', 'QQ', /[ ;)]QQ\//], ['抖音', 'Douyin', /aweme|BytedanceWebview|TTWebView|NewsArticle/],
    ['TikTok', 'TikTok', /musical_ly|TikTok/], ['豆包', 'Doubao', /doubao/i], ['夸克', 'Quark', /Quark\//], ['小红书', 'Xiaohongshu', /xhsdiscover/], ['微博', 'Weibo', /Weibo/],
    ['知乎', 'Zhihu', /ZhihuHybrid/], ['钉钉', 'DingTalk', /DingTalk/], ['飞书', 'Lark', /Lark|Feishu/], ['百度', 'Baidu', /baiduboxapp/], ['支付宝', 'Alipay', /AlipayClient/],
    ['LINE', 'LINE', / Line\//], ['Facebook', 'Facebook', /FBAN|FBAV|FB_IAB/], ['Instagram', 'Instagram', /Instagram/], ['Threads', 'Threads', /Barcelona/]];
  var INAPP = (function () {
    if (q.get('inapp') === '1') return ['微信', 'WeChat'];
    for (var i = 0; i < INAPP_APPS.length; i++) if (INAPP_APPS[i][2].test(UA)) return INAPP_APPS[i];
    if (/; wv\)/.test(UA)) return ['App', 'app'];
    if (/(iPhone|iPad|iPod)/.test(UA) && /AppleWebKit/.test(UA) && !/Safari\//.test(UA) && !(root.navigator && navigator.standalone)) return ['App', 'app'];
    return null;
  })();
  var TZ = ''; try { TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  var TZ_CN = q.get('tzcn') === '1' || /^(Asia\/(Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar)|PRC)$/.test(TZ);
  var ZH_CN = /^zh-(cn|hans|sg)/i.test(((root.navigator && (navigator.languages || [])[0]) || (root.navigator && navigator.language) || ''));
  var GSI_BAD = 'jp_gsi_bad', gsiSlow = false;
  function gsiBadRecently() { var t = +ls.get(GSI_BAD) || 0; return Date.now() - t < 14 * 864e5; }
  function emailFirst() { return EMAIL_ON && !!(INAPP || TZ_CN || gsiFailed || gsiBadRecently() || (ZH_CN && gsiSlow)); }
  function firstWay() { return emailFirst() ? 'email' : 'google'; }

  function acct() { try { return JSON.parse(ls.get('jp_acct')) || {}; } catch (e) { return {}; } }
  function setAcct(a) {
    if (a) ls.set('jp_acct', JSON.stringify(a)); else { ls.del('jp_acct'); document.documentElement.classList.remove('acct-warn'); }
  }

  function api(method, path, body) {
    var a = acct(), head = {};
    if (a.token) head.Authorization = 'Bearer ' + a.token;
    if (body) head['Content-Type'] = 'application/json';
    return fetch(API + path, { method: method, headers: head, body: body ? JSON.stringify(body) : undefined }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && a.token) { setAcct(null); render(); }
        if (!res.ok && res.status !== 409) { var e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; e.detail = data.detail; e.op = method + ' ' + path; throw e; }
        return { status: res.status, data: data };
      });
    });
  }

  // ─── Sync ───
  // The state: quiz.js's on a practice page (it runs after this file, hence the
  // lookup on every use); on other pages nothing changes it, so localStorage will do.
  var QUIZ_KEY = 'jp_quiz_v1';
  var stored = {
    get: function () {
      var s = null;
      try { s = JSON.parse(ls.get(QUIZ_KEY)); } catch (e) {}
      return s && s.v === 1 ? s : { v: 1, answers: {}, review: {}, reported: [], session: null, days: {}, prefs: {}, mock: {}, cards: {}, cardDays: {} };
    },
    set: function (s) { ls.set(QUIZ_KEY, JSON.stringify(s)); }
  };
  function state() { return root.jpQuizState || stored; }
  function lsJson(k) { try { return JSON.parse(ls.get(k)) || {}; } catch (e) { return {}; } }
  // The synced copy = jp_quiz_v1 + the lesson ticks and display prefs (lessonState()).
  function withLesson(s) {
    var o = {}; for (var k in s) o[k] = s[k];
    var c = lsJson('jp_grammar_checks'), p = lsJson('jp_grammar_prefs');
    if (Object.keys(c).length) o.gchecks = c; else delete o.gchecks;
    if ('isEn' in p || 'hideRuby' in p) o.ui = { hideRuby: !!p.hideRuby, isEn: 'isEn' in p ? !!p.isEn : null, t: p.uiT || 0 }; else delete o.ui;
    return o;
  }
  function putLesson(s) {
    var o = {}; for (var k in s) if (k !== 'gchecks' && k !== 'ui') o[k] = s[k];
    if (s.gchecks && canon(s.gchecks) !== canon(lsJson('jp_grammar_checks'))) {
      ls.set('jp_grammar_checks', JSON.stringify(s.gchecks));
      document.dispatchEvent(new CustomEvent('jp-checks'));     // an open lesson page re-ticks its boxes
    }
    var p = lsJson('jp_grammar_prefs'), u = s.ui;
    if (u && u.t > (p.uiT || 0)) {
      p.hideRuby = !!u.hideRuby; if (u.isEn != null) p.isEn = !!u.isEn; p.uiT = u.t;
      ls.set('jp_grammar_prefs', JSON.stringify(p));
      document.body.classList.toggle('hide-ruby', !!u.hideRuby);   // the language takes effect on the next page
    }
    return o;
  }
  var remote = null;                            // { version, data } as last seen on the server
  var busy = false, again = false, timer = null, status = { kind: 'idle' };
  function setStatus(kind, msg) {
    status = { kind: kind, msg: msg, at: Date.now() };
    document.documentElement.classList.toggle('acct-warn', kind === 'error' && !!acct().token);   // the only mark on the account button
    render();
  }

  // One round: fetch the server's copy if we don't have it, merge, show the
  // result here, and send it back if the server's differs. A 409 means another
  // device wrote in between: merge with what it wrote and try again.
  function sync(pull) {
    if (!acct().token) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    busy = true; again = false;
    setStatus('busy');
    var tries = 0, st = state(), moved = false;      // moved: something actually came down or went up
    function step() {
      var mine = withLesson(st.get()), merged = merge(mine, remote.data && clone(remote.data));   // a copy: quiz.js will change what it is given
      if (remote.data && !same(merged, mine)) {
        var a = acct();
        if (!a.backup) { ls.set('jp_quiz_v1_backup', JSON.stringify({ at: Date.now(), data: mine })); a.backup = 1; setAcct(a); }
        st.set(putLesson(merged)); moved = true;
        // Progress from another device arrived here: the thing accounts are for.
        track('account_merge', { answers: Object.keys(merged.answers || {}).length - Object.keys(mine.answers || {}).length });
      }
      var cur = withLesson(st.get());
      if (remote.data && same(cur, remote.data)) return;
      var send = strip(cur); send.at = cur.at || Date.now();
      // The server takes only { v: 1, answers: {…} } on an integer version (400 "Not a
      // progress file" otherwise, GA 11-20…26: one reader 13 times in a row, never
      // syncing again). Mend the shape here; an unknown version means fetch it first.
      if (send.v !== 1) send.v = 1;
      if (!send.answers || typeof send.answers !== 'object' || Array.isArray(send.answers)) send.answers = {};
      if (!(remote.version >= 0 && remote.version % 1 === 0)) {
        if (++tries > 4) throw new Error(t('同步失败，请稍后再试', 'Sync failed — try again later'));
        return api('GET', '/sync').then(function (r) { remote = r.data; return step(); });
      }
      return api('PUT', '/sync', { version: remote.version, data: send }).then(function (r) {
        if (r.status === 409) { remote = r.data; if (++tries > 4) throw new Error(t('同步冲突，请稍后再试', 'Sync conflict — try again later')); return step(); }
        remote = { version: r.data.version, data: clone(send) }; moved = true;
      });
    }
    var first = pull || !remote ? api('GET', '/sync').then(function (r) { remote = r.data; }) : Promise.resolve();
    return first.then(step).then(function () {
      // `at`: last check; `moved`: last time progress was transferred, which is what the panel shows.
      var a = acct(); if (a.token) { a.version = remote.version; a.at = Date.now(); if (moved || !a.moved) a.moved = Date.now(); setAcct(a); }
      setStatus('ok');
    }).catch(function (e) {
      if (acct().token) setStatus('error', e.message);
      // why: the server's message, or the browser's (Failed to fetch / Load failed = no
      // network or the page went away; a TypeError = a bug here); op: the request.
      // No HTTP status = the request never got an answer (offline, the page went
      // away): its own event, so account_sync_error is the server saying no or a bug.
      track(e.status ? 'account_sync_error' : 'account_sync_net', { status: e.status || 0, why: String(e.detail || (e && e.message) || e).slice(0, 80), op: e.op || '' });
    }).then(function () { busy = false; if (again) return sync(); });
  }
  var lastPull = 0;
  function pull() { lastPull = Date.now(); return sync(true); }

  root.jpSync = {
    // quiz.js saved something: send it a few seconds later (an answer every few seconds is one request).
    changed: function () { if (!acct().token) return; clearTimeout(timer); timer = setTimeout(function () { sync(); }, 4000); },
    now: pull
  };
  document.addEventListener('visibilitychange', function () {
    if (!acct().token) return;
    if (document.hidden) { if (timer) { clearTimeout(timer); timer = null; sync(); } }
    // Back on a practice tab after a while: the other device may have moved on.
    else if (root.jpQuizState && Date.now() - lastPull > 300000) pull();
  });

  // ─── Managing progress: replace it (clear, restore, import), export it ───
  // Replacing can't go through merge(), which would bring everything back: the
  // new state gets a higher epoch, so every device takes it whole. Signed in,
  // the latest copy is fetched first so answers from another device that
  // already reached the server are not thrown away by accident.
  function replaceWith(make, what) {
    var before = acct().token ? pull() : Promise.resolve();
    return before.then(function () {
      var st = state(), cur = st.get(), next = make(cur);
      ls.set('jp_quiz_v1_backup', JSON.stringify({ at: Date.now(), data: cur }));
      next.v = 1;
      next.epoch = Math.max(cur.epoch || 0, (remote && remote.data && remote.data.epoch) || 0) + 1;
      next.at = Date.now();
      st.set(next);
      track('account_progress', { action: what });
      render();
      if (acct().token) return sync();
    });
  }
  function exportFile() {
    var d = new Date(), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state().get())], { type: 'application/json' }));
    a.download = 'jpnotes-progress-' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + '.json';
    a.click();
    track('account_progress', { action: 'export' });
  }
  function importFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var s;
      try { s = JSON.parse(fr.result); if (!s || s.v !== 1 || typeof s.answers !== 'object') throw 0; }
      catch (e) { root.alert(t('这不是有效的进度文件。', 'That isn’t a valid progress file.')); return; }
      if (!root.confirm(t('用这个文件里的进度替换现在的进度？' + (acct().token ? '你所有设备上的进度都会换成它。' : '') + '现在的进度会在这个浏览器里留一份备份。',
        'Replace your current progress with the one in this file? ' + (acct().token ? 'All your devices will get it. ' : '') + 'A backup of the current progress is kept in this browser.'))) return;
      replaceWith(function () { s.session = null; return s; }, 'import');
    };
    fr.readAsText(file);
  }
  var LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'];
  var versions = null;       // restore points from the server, while that list is open
  var manageOpen = false;    // the "manage" fold stays as the reader left it across redraws
  function progressHtml() {
    var sum = summary(state().get()), rows = [];
    LEVELS.forEach(function (l) {
      var x = sum.levels[l]; if (!x) return;
      var bits = [];
      if (x.answers) bits.push(t(x.answers + ' 题', x.answers + ' questions'));
      if (x.review) bits.push(t('错题本 ' + x.review, x.review + ' to review'));
      if (x.mocks) bits.push(t('模拟考 ' + x.mocks + ' 场', x.mocks + ' mock test' + (x.mocks > 1 ? 's' : '')));
      if (x.cards) bits.push(t('卡片 ' + x.cards, x.cards + ' cards'));
      if (bits.length) rows.push('<li><b>' + l.toUpperCase() + '</b><span>' + bits.join(' · ') + '</span></li>');
    });
    // 生词本: its own page, every level (/words/, site/words.js).
    var W = state().get().words || {}, live = Object.keys(W).filter(function (k) { return W[k] && W[k].t > 0; }), wn = live.length, wok = live.filter(function (k) { return W[k].ok; }).length;
    if (wn) {
      rows.push('<li><b>' + t('生词本', 'Words') + '</b><span><a href="' + (EN() ? '/' : '/zh/') + 'words/">' + t('在学 ' + (wn - wok) + (wok ? ' · 已掌握 ' + wok : '') + ' · 查看', (wn - wok) + ' learning' + (wok ? ' · ' + wok + ' learned' : '') + ' · open') + '</a></span></li>');
    }
    var has = rows.length > 0;
    var h = '<div class="acct-head"><p class="acct-title">' + t('学习进度', 'Your progress') + '</p>' + (sum.days ? '<span class="acct-muted">' + t('练习过 ' + sum.days + ' 天', sum.days + (sum.days === 1 ? ' day' : ' days') + ' practised') + '</span>' : '') + '</div>' +
      (has ? '<ul class="acct-levels">' + rows.join('') + '</ul>' : '<p class="acct-muted">' + t('还没有做题记录。', 'No practice recorded yet.') + '</p>');
    var m = '<div class="acct-actions"><button type="button" class="acct-btn" data-acct="export"' + (has ? '' : ' disabled') + '>' + t('导出备份', 'Export backup') + '</button>' +
      '<label class="acct-btn">' + t('导入备份', 'Import backup') + '<input type="file" accept="application/json" data-acct-file hidden></label>' +
      (acct().token ? '<button type="button" class="acct-btn" data-acct="history">' + t('恢复旧版本', 'Restore earlier copy') + '</button>' : '') + '</div>';
    if (versions) {
      m += '<div class="acct-versions">' + (versions === 'loading' ? '<p class="acct-muted">' + t('读取中…', 'Loading…') + '</p>' :
        !versions.length ? '<p class="acct-muted">' + t('云端还没有更早的版本。', 'No earlier copies are stored yet.') + '</p>' :
        '<p class="acct-fine">' + t('云端保留最近几次同步前的版本，以及过去 14 天每天最后一份。', 'Kept online: the copies before your last few syncs, and the last one of each of the past 14 days.') + '</p><ul>' +
        versions.map(function (v) {
          return '<li><span>' + esc(new Date(v.saved).toLocaleString(EN() ? 'en' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + ' · ' + t(v.answers + ' 题有记录', v.answers + ' questions answered') + '</span>' +
            '<button type="button" class="acct-btn acct-sm" data-acct="restore" data-v="' + v.version + '">' + t('恢复', 'Restore') + '</button></li>';
        }).join('') + '</ul>') + '</div>';
    }
    if (has) {
      m += '<div class="acct-clear"><span class="acct-muted">' + t('清空进度', 'Clear progress') + '</span><select class="acct-scope" aria-label="' + t('要清空的范围', 'What to clear') + '">' +
        LEVELS.filter(function (l) { return sum.levels[l]; }).map(function (l) { return '<option value="' + l + '">' + t('只清空 ' + l.toUpperCase(), l.toUpperCase() + ' only') + '</option>'; }).join('') +
        '<option value="all">' + t('全部', 'Everything') + '</option></select>' +
        '<button type="button" class="acct-btn acct-sm acct-danger" data-acct="clear">' + t('清空', 'Clear') + '</button></div>';
    }
    return '<section class="acct-card">' + h + '<details class="acct-manage"' + (manageOpen ? ' open' : '') + '><summary>' + t('备份与管理', 'Backup & manage') + '</summary>' + m + '</details></section>';
  }

  // ─── The account block of the settings dialog ───
  var box = null;
  function time(ms) {
    var d = new Date(ms), hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return d.toDateString() === new Date().toDateString() ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }
  function about() { return '<a href="/' + (EN() ? '' : 'zh/') + 'about/#account-privacy">' + t('保存了什么、怎么删除', 'What is stored and how to delete it') + '</a>'; }
  function render() {
    if (!box) return;
    box.hidden = false;
    var a = acct();
    if (!a.token) {
      var ef = emailFirst(), ways;
      if (!ef) ways = '<div class="acct-g"></div>' + mailHtml(false);
      else if (INAPP) {
        // An app's own browser: Google can't work here, so it isn't loaded; say why and how to get out.
        var dev = LOCAL && q.get('devlogin');
        ways = mailHtml(true) + '<details class="acct-manage acct-alt"><summary>' + t('其他登录方式', 'Other ways to sign in') + '</summary>' +
          '<p class="acct-muted">' + (INAPP[0] === 'App' ? t('在 App 内置的浏览器里无法用 Google 登录', 'Google sign-in doesn’t work inside an app’s built-in browser') : t('在' + INAPP[0] + '里无法用 Google 登录', 'Google sign-in doesn’t work inside ' + INAPP[1] + '’s built-in browser')) +
          t('（Google 不允许）。想用 Google 登录：点右上角「···」选「在浏览器打开」，或复制链接到浏览器打开。', ' (Google blocks it). To use Google, open this page in your browser: the ··· menu → “Open in browser”, or copy the link.') + '</p>' +
          '<div class="acct-actions"><button type="button" class="acct-btn" data-acct="copy-link">' + t('复制链接', 'Copy link') + '</button></div>' +
          (dev ? '<div class="acct-g"></div>' : '') + '</details>';
      } else ways = mailHtml(true) + '<div class="acct-or"><span>' + t('或用 Google', 'or with Google') + '</span></div><div class="acct-g" style="margin-top:0"></div>';
      box.setAttribute('data-first', ef ? 'email' : 'google');
      box.innerHTML = '<section class="acct-card"><p class="acct-title">' + t('登录', 'Sign in') + '</p>' +
        '<p class="acct-muted">' + t('在手机和电脑之间同步做题进度，不登录也能用。', 'Sync your practice progress across devices. Optional: everything works without it.') + '</p>' +
        ways + (status.kind === 'error' ? '<p class="acct-err">' + esc(status.msg) + '</p>' : '') +
        '<p class="acct-fine">' + t('只保存你的邮箱和进度。', 'Only your email address and progress are stored. ') + about() + '</p></section>' + progressHtml();
      google();
      return;
    }
    var line = status.kind === 'busy' ? t('同步中…', 'Syncing…') :
      status.kind === 'error' ? '<span class="acct-err">' + t('同步失败：', 'Sync failed: ') + esc(status.msg) + '</span>' :
      a.at ? '<span class="acct-ok">✓</span> ' + t('进度已是最新', 'Progress is up to date') + (a.moved ? t(' · 上次更新 ', ' · last change ') + time(a.moved) : '') : '';
    box.innerHTML = '<section class="acct-card"><div class="acct-id"><span class="acct-avatar" aria-hidden="true">' + esc((a.email || '?').charAt(0).toUpperCase()) + '</span>' +
      '<div><p class="acct-title">' + esc(a.email) + '</p><p class="acct-muted">' + line + '</p></div></div>' +
      extrasHtml(a) +
      '<div class="acct-actions"><button type="button" class="acct-btn" data-acct="sync">' + t('立即同步', 'Sync now') + '</button><button type="button" class="acct-btn" data-acct="out">' + t('退出登录', 'Sign out') + '</button></div>' +
      '<p class="acct-fine">' + about() + ' · <button type="button" class="acct-link" data-acct="delete">' + t('删除账号和云端数据', 'Delete account and synced data') + '</button></p></section>' + progressHtml();
  }
  // Pages open only to invited Google accounts (account Worker, "Private extras").
  // Asked once a day per sign-in; the answer is kept in jp_acct.x and dies with it.
  var EXTRAS = { cram: ['/cram/', 'N2 真题语法突击（受邀）', 'N2 grammar cram (invited)'], past: ['/past/', 'JLPT 真题模考（受邀）', 'JLPT past papers (invited)'] }, extrasBusy = false;
  function extrasHtml(a) {
    var x = a.x;
    if (!x || !(Date.now() - x.t < 864e5)) {
      if (!extrasBusy) {
        extrasBusy = true;
        api('GET', '/extras').then(function (r) {
          var b = acct();
          if (b.token === a.token) { b.x = { t: Date.now(), l: (r.data && r.data.extras) || [] }; setAcct(b); render(); }
        }).catch(function () {}).then(function () { extrasBusy = false; });
      }
      return '';
    }
    return (x.l || []).filter(function (k) { return EXTRAS[k]; }).map(function (k) {
      var e = EXTRAS[k];
      return '<p class="acct-muted"><a href="' + e[0] + '">' + esc(t(e[1], e[2])) + ' →</a></p>';
    }).join('');
  }
  // The other way in, for readers who can't reach Google: a 6-digit code by email.
  // first: the email code is the main way in (emailFirst()), so no "or" rule above it and a filled button.
  function mailHtml(first) {
    if (!EMAIL_ON) return '';
    var m = mailState;
    return (first ? '<p class="acct-muted" style="margin:.8rem 0 0">' + t('用邮箱验证码登录：', 'Sign in with a code sent to your email:') + '</p>' : '<div class="acct-or"><span>' + t('或', 'or') + '</span></div>') +
      '<div class="acct-field"><input type="email" data-mail="email" autocomplete="email" placeholder="' + t('邮箱地址', 'Email address') + '" aria-label="' + t('邮箱地址', 'Email address') + '" value="' + esc(m.email) + '">' +
      '<button type="button" data-acct="mail-send"' + (first && !m.sent ? ' class="acct-primary"' : '') + (m.busy ? ' disabled' : '') + '>' + (m.sent ? t('重新发送', 'Send again') : t('发送验证码', 'Send code')) + '</button></div>' +
      (m.sent ? '<div class="acct-field"><input type="text" class="acct-code" data-mail="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="' + t('6 位验证码', '6-digit code') + '" aria-label="' + t('6 位验证码', '6-digit code') + '" value="' + esc(m.code) + '">' +
        '<button type="button" class="acct-primary" data-acct="mail-verify"' + (m.busy ? ' disabled' : '') + '>' + t('登录', 'Sign in') + '</button></div>' : '') +
      (m.msg ? '<p class="' + (m.err ? 'acct-err' : 'acct-muted') + '">' + esc(m.msg) + '</p>' : '');
  }
  function mailSend() {
    var m = mailState;
    if (!/^\S+@\S+\.\S+$/.test(m.email.trim())) { m.msg = t('请输入邮箱地址。', 'Enter your email address.'); m.err = true; return render(); }
    m.busy = true; m.msg = ''; render();
    api('POST', '/auth/email/start', { email: m.email.trim(), lang: EN() ? 'en' : 'zh' }).then(function (r) {
      m.busy = false; m.sent = true; m.err = false; m.code = r.data.dev_code || '';
      m.msg = t('验证码已发到 ' + m.email.trim() + '，10 分钟内有效。没收到的话看看垃圾邮件箱。', 'Code sent to ' + m.email.trim() + ', valid for 10 minutes. Check the spam folder if it doesn’t arrive.');
      track('account_code_sent', { first: firstWay() });
      render();
      var c = box && box.querySelector('[data-mail="code"]'); if (c) c.focus();
    }).catch(function (e) { m.busy = false; m.err = true; m.msg = e.message; track('account_login_error', { status: e.status || 0, method: 'email_start', first: firstWay() }); render(); });
  }
  function mailVerify() {
    var m = mailState;
    m.busy = true; m.msg = ''; render();
    api('POST', '/auth/email/verify', { email: m.email.trim(), code: m.code }).then(function (r) {
      mailState = { email: '', code: '', sent: false, busy: false, msg: '' };
      signedIn(r, 'email');
    }).catch(function (e) { m.busy = false; m.err = true; m.msg = e.status === 401 ? t('验证码不对或已过期。', 'That code is wrong or has expired.') : e.message; track('account_login_error', { status: e.status || 0, method: 'email', first: firstWay() }); render(); });
  }
  function signedIn(r, method) {
    setAcct({ token: r.data.token, email: r.data.email });
    // `from`: what sent the reader to sign in, when something said so (the notes script sets jp_login_from).
    var from = ''; try { from = sessionStorage.getItem('jp_login_from') || ''; sessionStorage.removeItem('jp_login_from'); } catch (e) {}
    track('account_login', { method: method || 'google', local_answers: Object.keys(state().get().answers || {}).length, from: from.slice(0, 20), first: firstWay(), inapp: INAPP ? 1 : 0 });
    status = { kind: 'idle' };
    pull();
  }
  function onClick(e) {
    var el = e.target.closest('[data-acct]'), act = el && el.getAttribute('data-acct');
    if (act === 'sync') pull();
    else if (act === 'mail-send') mailSend();
    else if (act === 'mail-verify') mailVerify();
    else if (act === 'copy-link') copyLink(el);
    else if (act === 'export') exportFile();
    else if (act === 'history') {
      if (versions) { versions = null; render(); return; }
      versions = 'loading'; render();
      api('GET', '/sync/history').then(function (r) { versions = r.data.versions || []; render(); }).catch(function (e2) { versions = null; setStatus('error', e2.message); });
    } else if (act === 'restore') {
      var ver = el.getAttribute('data-v');
      if (!root.confirm(t('把进度恢复到这个版本？之后做的题不会保留；你所有设备上的进度都会换成它。现在的进度会在这个浏览器里留一份备份。',
        'Go back to this copy? Answers recorded after it are not kept, and all your devices will get it. A backup of the current progress is kept in this browser.'))) return;
      api('GET', '/sync/history/' + ver).then(function (r) {
        versions = null;
        return replaceWith(function () { var d = r.data.data; d.session = null; return d; }, 'restore');
      }).catch(function (e2) { setStatus('error', e2.message); });
    } else if (act === 'clear') {
      var sel = box.querySelector('.acct-scope'), lv = sel ? sel.value : 'all', name = lv === 'all' ? t('全部', 'all') : lv.toUpperCase();
      if (!root.confirm(t('清空' + name + '进度（做题记录、错题本、模拟考成绩、单词卡）？' + (acct().token ? '你所有设备和云端的都会清空。' : '') + '清空前的进度会在这个浏览器里留一份备份，登录用户也可以从“恢复到之前的版本”找回。',
        'Clear ' + (lv === 'all' ? 'all' : name) + ' progress (answers, review list, mock test results, flashcards)? ' + (acct().token ? 'It is cleared on all your devices and online. ' : '') + 'A backup stays in this browser, and signed-in readers can also get it back from "Restore an earlier copy".'))) return;
      replaceWith(function (cur) { return without(cur, lv); }, lv === 'all' ? 'clear_all' : 'clear_level');
    }
    else if (act === 'out') {
      track('account_logout', {});
      api('POST', '/auth/logout').catch(function () {}).then(function () { setAcct(null); remote = null; status = { kind: 'idle' }; render(); });
    } else if (act === 'delete') {
      if (!root.confirm(t('删除账号和云端保存的进度？这个浏览器里的进度会保留。此操作无法撤销。', 'Delete your account and the progress stored online? The progress in this browser stays. This can’t be undone.'))) return;
      api('DELETE', '/account').then(function () { track('account_delete', {}); setAcct(null); remote = null; status = { kind: 'idle' }; render(); }).catch(function (e2) { setStatus('error', e2.message); });
    }
  }
  root.jpAccount = {
    mount: function (el) {
      if (!el) return;
      if (box !== el) {
        box = el; el.addEventListener('click', onClick);
        el.addEventListener('change', function (e) { if (e.target.hasAttribute('data-acct-file') && e.target.files[0]) importFile(e.target.files[0]); });
        el.addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('acct-manage') && !e.target.classList.contains('acct-alt')) manageOpen = e.target.open; }, true);
        el.addEventListener('input', function (e) { var k = e.target.getAttribute && e.target.getAttribute('data-mail'); if (k) mailState[k] = e.target.value; });
        el.addEventListener('keydown', function (e) {
          var k = e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('data-mail');
          if (k) { e.preventDefault(); if (k === 'email') mailSend(); else mailVerify(); }
        });
      }
      versions = null;
      // first: which way in the panel offers first (signed out only); inapp: an app's own browser.
      track('account_view', acct().token ? { signed_in: true } : { signed_in: false, first: firstWay(), inapp: INAPP ? 1 : 0 });
      render();
      if (acct().token && Date.now() - lastPull > 60000) pull();      // opening the panel checks once
    }
  };

  // Google's button (their script, loaded only when a signed-out reader opens
  // the dialog; it renders an iframe).
  var gsi = null, gsiFailed = false;
  function google() {
    var el = box.querySelector('.acct-g');
    if (!el) return;          // an app's own browser: no Google at all (render())
    var dev = LOCAL && q.get('devlogin');
    if (dev) {    // local worker with DEV_LOGIN=1: no Google round trip, for tests
      el.innerHTML = '<button type="button" class="acct-btn acct-wide" data-dev>Dev sign-in: ' + esc(dev) + '</button>';
      el.firstChild.onclick = function () { api('POST', '/auth/google', { dev: dev }).then(signedIn).catch(function (e) { setStatus('error', e.message); }); };
      return;
    }
    if (!CLIENT_ID) return;
    // Where Google can't be reached (mainland China) the script neither loads nor
    // fails for a long time: after a few seconds say so and point at the email
    // code. A failure is remembered for the page — every render() comes
    // through here, and retrying each time flashed the notice and counted the
    // same reader many times — and for 14 days in jp_gsi_bad (email first next time).
    var slow = function () {
      var target = box && box.querySelector('.acct-g');
      var where = box && box.getAttribute('data-first') === 'email' ? t('上面', 'above') : t('下面', 'below');
      if (target && !target.firstChild && !acct().token) target.innerHTML = '<p class="acct-muted">' + (EMAIL_ON ? t('Google 登录加载不出来（访问不了 Google 时用不了），请用' + where + '的邮箱验证码登录。', 'Google sign-in isn’t loading (it needs access to Google). Use the email code ' + where + ' instead.') : t('Google 登录没能加载（网络访问不了 Google 时无法使用）。', 'Google sign-in didn’t load (it needs access to Google).')) + '</p>';
    };
    if (gsiFailed) { slow(); return; }
    if (!gsi) gsi = new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = function () { fail(new Error('gsi')); };
      document.head.appendChild(s);
    });
    if (!root.google || !root.google.accounts) {
      // zh-CN / zh-Hans browsers: not there after 2.5 s → the email code moves to the top.
      if (ZH_CN && !gsiSlow) setTimeout(function () { if (!root.google || !root.google.accounts) { gsiSlow = true; relayout(); } }, 2500);
      setTimeout(function () { if (!root.google || !root.google.accounts) slow(); }, 4000);
    }
    gsi.then(function () {
      ls.del(GSI_BAD);
      var target = box && box.querySelector('.acct-g');
      if (!target || acct().token) return;
      target.innerHTML = '';     // the "isn't loading" notice, if the script arrived late
      root.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: function (res) { api('POST', '/auth/google', { credential: res.credential }).then(signedIn).catch(function (e) { track('account_login_error', { status: e.status || 0, first: firstWay() }); setStatus('error', e.message); }); }
      });
      var c = document.documentElement.classList, dark = c.contains('theme-dark') || (!c.contains('theme-light') && root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
      root.google.accounts.id.renderButton(target, { theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'center',
        width: Math.max(200, Math.min(400, Math.floor(target.getBoundingClientRect().width) || 320)), locale: EN() ? 'en' : 'zh_CN' });
    }).catch(function () {
      // Google unreachable (mainland China, blockers); once per page
      if (!gsiFailed) track('account_gsi_fail', { inapp: INAPP ? 1 : 0, tz_cn: TZ_CN ? 1 : 0, zh: ZH_CN ? 1 : 0 });
      gsiFailed = true;
      ls.set(GSI_BAD, String(Date.now()));
      relayout();
      slow();
    });
  }
  // The open panel switches to email first when that became the better way in
  // (Google failed or is slow) — not while the reader is typing in it.
  function relayout() {
    if (!box || box.hidden || acct().token || box.getAttribute('data-first') === firstWay()) return;
    var f = document.activeElement;
    if (f && box.contains(f) && f.tagName === 'INPUT') return;
    render();
  }
  function copyLink(el) {
    var url = location.href.replace(/[?&](inapp|tzcn)=1/g, '');
    var done = function () { el.textContent = t('已复制，粘贴到浏览器打开', 'Copied — paste it into your browser'); track('account_copy_link', { inapp: INAPP ? 1 : 0 }); };
    try { navigator.clipboard.writeText(url).then(done, function () { root.prompt(t('复制这个链接：', 'Copy this link:'), url); }); }
    catch (e) { root.prompt(t('复制这个链接：', 'Copy this link:'), url); }
  }

  // Signed in: a practice page fetches the server's copy once its scripts have
  // run. Other pages change nothing and don't ask; opening the panel does.
  // Practice pages, and pages with review ticks (lessons, checklists) unless
  // checked in the last 10 minutes, fetch the latest copy on load.
  function start() {
    if (!acct().token) return;
    if (root.jpQuizState || (document.querySelector('input[type="checkbox"][data-lesson]') && Date.now() - (acct().at || 0) > 600000)) pull();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
})(typeof window !== 'undefined' ? window : this);
