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
 * This browser keeps: localStorage jp_acct = { token, email, version, at }
 * and, from just before the first merge, jp_quiz_v1_backup.
 * While the feature is being tested the sign-in box only shows after a visit
 * with ?account=1 (remembered in localStorage jp_acct_beta).
 */
(function (root) {
  'use strict';
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
  //   session   this browser's unfinished practice set, never the other device's
  // `local` wins ties where there is no time to compare and it changed last.
  function merge(local, remote) {
    if (!remote) return local;
    var a = local, b = remote, prim = (a.at || 0) >= (b.at || 0) ? a : b, sec = prim === a ? b : a;
    var out = { v: 1 };
    out.answers = {};
    keys(a.answers, b.answers).forEach(function (q) {
      var seen = {}, all = ((a.answers || {})[q] || []).concat((b.answers || {})[q] || []).filter(function (r) {
        var k = r.t + ':' + r.c; if (seen[k]) return false; seen[k] = 1; return true;
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
      var atts = (x.attempts || []).concat(y.attempts || []).filter(function (t) { if (seen[t.start]) return false; seen[t.start] = 1; return true; });
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
    out.at = Math.max(a.at || 0, b.at || 0);
    // Fields a newer quiz.js may add: the more recent side's.
    keys(prim, sec).forEach(function (k) { if (!(k in out)) out[k] = k in prim ? prim[k] : sec[k]; });
    return out;
  }

  // Same content? Key order, `at` and the per-browser `session` don't count.
  function canon(o) {
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).sort().filter(function (k) { return o[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canon(o[k]); }).join(',') + '}';
    return JSON.stringify(o);
  }
  function strip(s) { var o = {}; for (var k in s) if (k !== 'session' && k !== 'at') o[k] = s[k]; return o; }
  function same(x, y) { return !!x && !!y && canon(strip(x)) === canon(strip(y)); }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { merge: merge, same: same }; return; }

  // ─── Browser ───
  var app = document.getElementById('quiz-app');
  if (!app || !root.fetch) return;
  var EN = document.documentElement.getAttribute('data-force-lang') !== 'zh';
  function t(zh, en) { return EN ? en : zh; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(name, p) { try { if (root.gaEvent) root.gaEvent(name, p); } catch (e) {} }
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };

  var q = new URLSearchParams(location.search);
  var LOCAL = q.get('acct') === 'local' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = LOCAL ? 'http://localhost:8788' : 'https://api.jpnotes.dev';
  var CLIENT_ID = app.getAttribute('data-gclient');
  if (q.get('account') === '1') ls.set('jp_acct_beta', '1');

  function acct() { try { return JSON.parse(ls.get('jp_acct')) || {}; } catch (e) { return {}; } }
  function setAcct(a) { if (a) ls.set('jp_acct', JSON.stringify(a)); else ls.del('jp_acct'); }
  if (!acct().token && ls.get('jp_acct_beta') !== '1') return;

  function api(method, path, body) {
    var a = acct(), head = {};
    if (a.token) head.Authorization = 'Bearer ' + a.token;
    if (body) head['Content-Type'] = 'application/json';
    return fetch(API + path, { method: method, headers: head, body: body ? JSON.stringify(body) : undefined }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && a.token) { setAcct(null); render(); }
        if (!res.ok && res.status !== 409) { var e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
        return { status: res.status, data: data };
      });
    });
  }

  // ─── Sync ───
  var state = root.jpQuizState;                 // from quiz.js, which loads first
  var remote = null;                            // { version, data } as last seen on the server
  var busy = false, again = false, timer = null, status = { kind: 'idle' };
  function setStatus(kind, msg) { status = { kind: kind, msg: msg, at: Date.now() }; render(); }

  // One round: fetch the server's copy if we don't have it, merge, show the
  // result here, and send it back if the server's differs. A 409 means another
  // device wrote in between: merge with what it wrote and try again.
  function sync(pull) {
    if (!acct().token || !state) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    busy = true; again = false;
    setStatus('busy');
    var tries = 0;
    function step() {
      var mine = state.get(), merged = merge(mine, remote.data && clone(remote.data));   // a copy: quiz.js will change what it is given
      if (remote.data && !same(merged, mine)) {
        var a = acct();
        if (!a.backup) { ls.set('jp_quiz_v1_backup', JSON.stringify({ at: Date.now(), data: mine })); a.backup = 1; setAcct(a); }
        state.set(merged);
      }
      var cur = state.get();
      if (remote.data && same(cur, remote.data)) return;
      var send = strip(cur); send.at = cur.at || Date.now();
      return api('PUT', '/sync', { version: remote.version, data: send }).then(function (r) {
        if (r.status === 409) { remote = r.data; if (++tries > 4) throw new Error(t('同步冲突，请稍后再试', 'Sync conflict — try again later')); return step(); }
        remote = { version: r.data.version, data: clone(send) };
      });
    }
    var first = pull || !remote ? api('GET', '/sync').then(function (r) { remote = r.data; }) : Promise.resolve();
    return first.then(step).then(function () {
      var a = acct(); if (a.token) { a.version = remote.version; a.at = Date.now(); setAcct(a); }
      setStatus('ok');
    }).catch(function (e) {
      if (acct().token) setStatus('error', e.message);
      track('account_sync_error', { status: e.status || 0 });
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
    else if (Date.now() - lastPull > 60000) pull();          // back on this tab: the other device may have moved on
  });

  // ─── Sign-in box, under the quiz ───
  var box = document.createElement('div');
  box.className = 'q-card q-acct';
  app.parentNode.insertBefore(box, app.nextSibling);
  function time(ms) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function render() {
    var a = acct();
    if (!a.token) {
      box.innerHTML = '<h2>' + t('同步进度', 'Sync your progress') + ' <small class="q-tag">' + t('测试中', 'Beta') + '</small></h2>' +
        '<p class="q-muted">' + t('登录后，做题记录、错题本、模拟考成绩和单词卡会在你的各个设备之间同步。不登录也能照常使用，进度只存在这个浏览器里。我们只保存你的邮箱和这些进度。',
          'Sign in and your answers, review list, mock test results and flashcards follow you across devices. Without signing in everything works as before, kept in this browser only. We store your email address and that progress, nothing else.') + '</p>' +
        '<div class="q-acct-g"></div>' + (status.kind === 'error' ? '<p class="q-acct-err">' + esc(status.msg) + '</p>' : '');
      google();
      return;
    }
    var line = status.kind === 'busy' ? t('同步中…', 'Syncing…') :
      status.kind === 'error' ? '<span class="q-acct-err">' + t('同步失败：', 'Sync failed: ') + esc(status.msg) + '</span>' :
      a.at ? t('已同步 ', 'Synced ') + time(a.at) : '';
    box.innerHTML = '<h2>' + t('同步进度', 'Sync your progress') + ' <small class="q-tag">' + t('测试中', 'Beta') + '</small></h2>' +
      '<p>' + t('已登录：', 'Signed in as ') + '<b>' + esc(a.email) + '</b> <span class="q-muted q-acct-status">' + line + '</span></p>' +
      '<div class="q-actions"><button class="q-btn" data-acct="sync">' + t('立即同步', 'Sync now') + '</button><button class="q-btn" data-acct="out">' + t('退出登录', 'Sign out') + '</button>' +
      '<button class="q-link" data-acct="delete">' + t('删除账号和云端数据', 'Delete account and synced data') + '</button></div>';
  }
  function signedIn(r) {
    setAcct({ token: r.data.token, email: r.data.email });
    track('account_login', { method: 'google' });
    status = { kind: 'idle' };
    pull();
  }
  box.addEventListener('click', function (e) {
    var el = e.target.closest('[data-acct]'), act = el && el.getAttribute('data-acct');
    if (act === 'sync') pull();
    else if (act === 'out') {
      api('POST', '/auth/logout').catch(function () {}).then(function () { setAcct(null); remote = null; status = { kind: 'idle' }; render(); });
    } else if (act === 'delete') {
      if (!root.confirm(t('删除账号和云端保存的进度？这个浏览器里的进度会保留。此操作无法撤销。', 'Delete your account and the progress stored online? The progress in this browser stays. This can’t be undone.'))) return;
      api('DELETE', '/account').then(function () { setAcct(null); remote = null; status = { kind: 'idle' }; render(); }).catch(function (e2) { setStatus('error', e2.message); });
    }
  });

  // Google's button (their script, loaded only for this box; it renders an iframe).
  var gsi = null;
  function google() {
    var el = box.querySelector('.q-acct-g');
    var dev = LOCAL && q.get('devlogin');
    if (dev) {    // local worker with DEV_LOGIN=1: no Google round trip, for tests
      el.innerHTML = '<button class="q-btn" data-dev>Dev sign-in: ' + esc(dev) + '</button>';
      el.firstChild.onclick = function () { api('POST', '/auth/google', { dev: dev }).then(signedIn).catch(function (e) { setStatus('error', e.message); }); };
      return;
    }
    if (!CLIENT_ID) return;
    if (!gsi) gsi = new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = function () { gsi = null; fail(new Error('gsi')); };
      document.head.appendChild(s);
    });
    gsi.then(function () {
      var target = box.querySelector('.q-acct-g');
      if (!target || acct().token) return;
      root.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: function (res) { api('POST', '/auth/google', { credential: res.credential }).then(signedIn).catch(function (e) { setStatus('error', e.message); }); }
      });
      root.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: EN ? 'en' : 'zh_CN' });
    }).catch(function () {
      var target = box.querySelector('.q-acct-g');
      if (target) target.innerHTML = '<p class="q-muted">' + t('Google 登录没能加载（网络访问不了 Google 时无法使用）。', 'Google sign-in didn’t load (it needs access to Google).') + '</p>';
    });
  }

  render();
  if (acct().token) pull();
})(typeof window !== 'undefined' ? window : this);
