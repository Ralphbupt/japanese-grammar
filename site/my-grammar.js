/* /my-grammar/ — the reader's own grammar cards, every level in one place.
 * Which points (by lesson point "lessonNN#K", the cards' `ref`):
 *   to review = added on a lesson page ("＋ 语法卡", jp_grammar_checks 'gs:…' > 0)
 *               or the latest practice answer on one of its questions was wrong /
 *               a guess (quiz/qrefs.json: question id → point), unless removed
 *               here ('gs:…' < 0) after that miss;
 *   learned   = ticked "got it" ('g:…' > 0) and not missed since.
 * Points only studied on /nX-cards/ and nothing else are left out.
 * Studying uses the level's card data (quiz/{lv}-cards.json, build-anki.js) and
 * the cards page's scheduler (quiz.js schedule(): learning steps 1 / 10 min,
 * then intervals grown by ease), on the same S.cards[card id] — progress is
 * shared with /nX-cards/. State: jp_quiz_v1 + jp_grammar_checks (both synced). */
(function () {
  var app = document.getElementById('mg-app');
  if (!app) return;
  var EN = (document.documentElement.lang || '').indexOf('zh') !== 0, K = 'jp_quiz_v1', CK = 'jp_grammar_checks';
  var LV = ['N5', 'N4', 'N3', 'N2', 'N1'], STEPS = [60e3, 10 * 60e3], MIN_EASE = 1.3, DAY = 864e5;
  function t(z, e) { return EN ? e : z; }
  function bi(o) { return o && typeof o === 'object' ? (EN ? o.en : o.zh) || o.zh || o.en || '' : o || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ev(n, p) { if (window.gaEvent) { p = p || {}; p.via = 'my_grammar'; window.gaEvent(n, p); } }
  function lsJ(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function ld() { var s = lsJ(K, null); if (!s || s.v !== 1) s = { v: 1, answers: {}, review: {}, reported: [], session: null, days: {}, prefs: {}, mock: {}, cards: {}, cardDays: {}, fav: {}, words: {} }; s.cards = s.cards || {}; s.answers = s.answers || {}; return s; }
  function sv(s) { s.at = Date.now(); try { localStorage.setItem(K, JSON.stringify(s)); } catch (e) {} if (window.jpSync) window.jpSync.changed(); }
  function setCheck(k, v) { var c = lsJ(CK, {}); c[k] = v; try { localStorage.setItem(CK, JSON.stringify(c)); } catch (e) {} if (window.jpSync) window.jpSync.changed(); }

  var cfg = { cards: app.getAttribute('data-cards'), qrefs: app.getAttribute('data-qrefs'), index: app.getAttribute('data-index') };
  // CARDS[level]: the index entries ({ id, ref, lesson, term, desc }); FULL[level]:
  // id → the full card (meaning, examples), loaded for a study round only.
  var CARDS = null, FULL = {}, QR = null, filt = 'all', MS = null, PER = 40, pg = { T: 0, M: 0 };
  try { var h0 = (location.hash || '').slice(1).toUpperCase(); filt = LV.indexOf(h0) >= 0 ? h0 : localStorage.getItem('jp_mg_lv') || 'all'; } catch (e) {}

  function load() {
    var ps = [];
    if (!CARDS) ps.push(fetch(cfg.index).then(function (r) { return r.json(); }).then(function (d) {
      CARDS = {};
      LV.forEach(function (l) { CARDS[l] = (d[l] || []).map(function (a) { return { id: a[0], ref: a[1], lesson: a[2], term: { zh: a[3], en: a[4] }, desc: { zh: a[5], en: a[6] } }; }); });
    }).catch(function () { CARDS = {}; }));
    if (!QR) ps.push(fetch(cfg.qrefs).then(function (r) { return r.json(); }).then(function (d) { QR = d; }).catch(function () { QR = {}; }));
    return Promise.all(ps);
  }
  function loadFull(levels) {
    return Promise.all(levels.filter(function (l) { return !FULL[l]; }).map(function (l) {
      return fetch(cfg.cards.replace('{lv}', l.toLowerCase())).then(function (r) { return r.json(); }).then(function (d) {
        FULL[l] = {}; d.forEach(function (c) { FULL[l][c.id] = c; });
      }).catch(function () { FULL[l] = {}; });
    }));
  }
  // ref → { wrong: n questions whose latest answer is wrong / a guess, last: time of the latest such answer }
  function misses() {
    var S = ld(), by = {};
    Object.keys(S.answers).forEach(function (id) {
      var r = QR && QR[id], a = S.answers[id]; if (!r || !a || !a.length) return;
      var x = a[a.length - 1];
      if (x.ok && !x.g) return;
      var e = by[r] || (by[r] = { wrong: 0, last: 0 }); e.wrong++; e.last = Math.max(e.last, (x.t || 0) * 1000);   // answer t: seconds → ms, like the checks
    });
    return by;
  }
  // Every card of the loaded levels with its status: 'todo' | 'done' | null
  function items() {
    var c = lsJ(CK, {}), S = ld(), mi = misses(), out = [];
    LV.forEach(function (l) {
      ((CARDS && CARDS[l]) || []).forEach(function (cd) {
        var r = cd.ref; if (!r) return;
        var g = c['g:' + r] || 0, gs = c['gs:' + r] || 0, m = mi[r];
        var slip = g > 0 && m && m.last > g, missed = m && !(gs < 0 && -gs > m.last);
        var st = g > 0 && !slip ? 'done' : (gs > 0 || missed || slip) ? 'todo' : null;
        if (!st) return;
        out.push({ c: cd, lv: l, st: st, added: gs > 0, wrong: m ? m.wrong : 0, slip: slip, x: S.cards[cd.id] });
      });
    });
    return out;
  }
  function due(it) { return !it.x || (it.x.due || 0) <= Date.now(); }

  // ─── 按级别学: whole levels, like the word list ───
  // prefs.mgLv = the levels being learned (synced with the progress), prefs.mgNew
  // = new points a day. Each day: the cards of those levels that are due (any
  // studied there or on /nX-cards/), then new ones in lesson order, N5 first,
  // up to mgNew minus the new cards already started today (cardDays, shared
  // with the cards pages).
  function prefs() { var p = ld().prefs || {}; return { lv: (p.mgLv || []).filter(function (l) { return LV.indexOf(l) >= 0; }), n: p.mgNew || 10 }; }
  function setPrefs(ch) { var S = ld(); S.prefs = S.prefs || {}; for (var k in ch) S.prefs[k] = ch[k]; sv(S); }
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function plan() {
    var P = prefs(), S = ld(), now = Date.now(), dueL = [], fresh = [], prog = {};
    var started = ((S.cardDays || {})[todayKey()] || {}).n || 0, left = Math.max(0, P.n - started);
    P.lv.forEach(function (l) {
      var cs = (CARDS && CARDS[l]) || [], seen = 0, ripe = 0;
      cs.forEach(function (cd) {
        var x = S.cards[cd.id];
        if (x) { seen++; if (x.s === 'review' && x.ivl >= 21) ripe++; if ((x.due || 0) <= now) dueL.push({ c: cd, lv: l, st: 'plan', x: x }); }
        else if (fresh.length < left) fresh.push({ c: cd, lv: l, st: 'new', x: null });
      });
      prog[l] = { all: cs.length, seen: seen, ripe: ripe };
    });
    return { P: P, due: dueL, fresh: fresh, prog: prog, left: left, started: started };
  }
  function planHtml() {
    var p = plan(), P = p.P, h = '<section class="mg-plan"><h2>' + t('按级别学', 'Learn by level') + '</h2>';
    h += '<div class="mg-plan-row"><span class="mg-muted">' + t('学哪些级别：', 'Levels:') + '</span>' + LV.map(function (l) {
      return '<button type="button" class="wb-btn mg-lv' + (P.lv.indexOf(l) >= 0 ? ' on' : '') + '" data-plv="' + l + '" aria-pressed="' + (P.lv.indexOf(l) >= 0) + '">' + l + ' <small>' + (((CARDS && CARDS[l]) || []).length) + '</small></button>';
    }).join('') + '<label class="mg-muted mg-newsel">' + t('每天新语法', 'New a day') + ' <select data-pnew>' + [5, 10, 15, 20, 30].map(function (n) { return '<option value="' + n + '"' + (n === P.n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>';
    if (!P.lv.length) return h + '<p class="mg-muted">' + t('选一个或几个级别，每天背到期的语法和几条新语法，像背单词一样。', 'Pick one or more levels: each day you review what is due plus a few new points, like the word list.') + '</p></section>';
    h += '<div class="mg-prog">' + P.lv.map(function (l) {
      var g = p.prog[l] || { all: 0, seen: 0, ripe: 0 }, pct = g.all ? Math.round(g.seen * 100 / g.all) : 0;
      return '<div class="mg-prog-r"><span class="wb-lv">' + l + '</span><span class="mg-bar"><span style="width:' + pct + '%"></span></span><span class="mg-muted">' + t('已学 ' + g.seen + ' / ' + g.all + (g.ripe ? ' · 已熟 ' + g.ripe : ''), g.seen + ' / ' + g.all + ' started' + (g.ripe ? ' · ' + g.ripe + ' mature' : '')) + '</span></div>';
    }).join('') + '</div>';
    var n = p.due.length + p.fresh.length;
    // the daily new limit is shared with the cards pages: say how many were started already
    var used = p.started ? t('（今天已经学了 ' + p.started + ' 条新语法，每天上限 ' + P.n + ' 条，和语法卡片页共用）', ' (' + p.started + ' new started today; the limit of ' + P.n + ' a day is shared with the flashcard pages)') : '';
    h += '<div class="wb-sum"><span>' + t('今天：复习 <b>' + p.due.length + '</b> · 新语法 <b>' + p.fresh.length + '</b>', 'Today: <b>' + p.due.length + '</b> to review · <b>' + p.fresh.length + '</b> new') + '<span class="mg-muted" style="font-size:.85em">' + used + '</span></span>' +
      (n ? '<button type="button" class="wb-btn wb-primary" data-act="plan">' + t('开始今天的语法 · ' + n, 'Start today’s grammar · ' + n) + '</button>' : '<span class="mg-muted">' + t('今天的背完了 🎉', 'All done for today 🎉') + '</span>') + '</div></section>';
    return h;
  }
  function whenDue(x) {
    if (!x) return t('还没背过', 'not studied yet');
    var d = Math.round(((x.due || 0) - Date.now()) / DAY);
    return d <= 0 ? t('今天', 'today') : d === 1 ? t('明天', 'tomorrow') : d < 31 ? t(d + ' 天后', 'in ' + d + ' days') : t(Math.round(d / 30) + ' 个月后', 'in ' + Math.round(d / 30) + ' months');
  }

  function render() {
    MS = null;
    if (!CARDS || !QR) { app.innerHTML = '<p class="mg-muted">' + t('加载中…', 'Loading…') + '</p>'; return load().then(render); }
    var all = items(), counts = { all: 0 };
    LV.forEach(function (l) { counts[l] = 0; });
    all.forEach(function (it) { counts[it.lv]++; counts.all++; });
    var ws = all.filter(function (it) { return filt === 'all' || it.lv === filt; });
    var T = ws.filter(function (it) { return it.st === 'todo'; }).sort(function (a, b) { return ((a.x && a.x.due) || 0) - ((b.x && b.x.due) || 0); });
    var M = ws.filter(function (it) { return it.st === 'done'; });
    var d = T.filter(due).length;
    var h = planHtml() + '<h2 class="mg-h">' + t('我加的和做错的', 'Added and missed') + '</h2><div class="wb-tabs" role="tablist">' + ['all'].concat(LV).map(function (l) {
      return '<button type="button" role="tab" data-lv="' + l + '" aria-selected="' + (l === filt) + '">' + (l === 'all' ? t('全部', 'All') : l) + ' <small>' + counts[l] + '</small></button>';
    }).join('') + '</div>';
    if (!ws.length) {
      h += '<div class="wb-empty"><p>' + t('这里还没有语法卡。', 'No grammar cards here yet.') + '</p><p class="mg-muted">' +
        t('课文里每个语法点下面有「＋ 语法卡」，点一下就会出现在这里；练习题里做错的语法点也会自动出现。打了「已掌握」的放在「已掌握」里。', 'Each grammar point in the lessons has “＋ Grammar card”; tap it and the point shows up here. Points you miss in practice appear on their own, and the ones you ticked “Got it” are under “Learned”.') + '</p></div>';
      app.innerHTML = h; return;
    }
    h += '<div class="wb-sum"><span>' + t('要复习 <b>' + T.length + '</b> · 今天要背 <b>' + d + '</b> · 已掌握 ' + M.length, 'To review <b>' + T.length + '</b> · due today <b>' + d + '</b> · learned ' + M.length) + '</span>' +
      (T.length ? '<button type="button" class="wb-btn wb-primary" data-act="study"' + (d ? '' : ' data-early="1"') + '>' + (d ? t('背卡片 · ' + d + ' 张到期', 'Study · ' + d + ' due') : t('提前背', 'Study early')) + '</button>' : '') + '</div>';
    h += T.length ? page(T, 'T') : '<p class="mg-muted">' + t('没有要复习的语法点。', 'Nothing to review.') + '</p>';
    if (M.length) h += '<details class="wb-done"' + (pg.M ? ' open' : '') + '><summary>' + t('已掌握 ', 'Learned ') + M.length + '</summary>' + page(M, 'M') + '</details>';
    app.innerHTML = h;
  }
  function page(ws, which) {
    var n = Math.ceil(ws.length / PER), p = Math.min(pg[which], n - 1);
    pg[which] = p;
    var h = '<ul class="wb-list mg-list">' + ws.slice(p * PER, p * PER + PER).map(row).join('') + '</ul>';
    if (n > 1) {
      h += '<nav class="wb-pages"><button type="button" class="wb-btn" data-pg="' + which + ':' + (p - 1) + '"' + (p ? '' : ' disabled') + '>' + t('‹ 上一页', '‹ Previous') + '</button>';
      for (var i = 0; i < n; i++) h += '<button type="button" class="wb-btn wb-pg' + (i === p ? ' on' : '') + '" data-pg="' + which + ':' + i + '">' + (i * PER + 1) + '–' + Math.min(ws.length, i * PER + PER) + '</button>';
      h += '<button type="button" class="wb-btn" data-pg="' + which + ':' + (p + 1) + '"' + (p < n - 1 ? '' : ' disabled') + '>' + t('下一页 ›', 'Next ›') + '</button></nav>';
    }
    return h;
  }
  function row(it) {
    var c = it.c, r = esc(c.ref), why = [];
    if (it.st === 'todo') {
      if (it.slip) why.push(t('标了已掌握，又做错了', 'marked “got it”, missed since'));
      else if (it.wrong) why.push(t('练习做错 ' + it.wrong + ' 题', 'missed ' + it.wrong + ' in practice'));
      if (it.added) why.push(t('自己加的', 'added by you'));
    }
    return '<li><div class="wb-w mg-term" lang="ja">' + esc(bi(c.term)) + '</div><div class="wb-m">' + esc(bi(c.desc)) +
      '<div class="wb-meta"><span class="wb-lv">' + it.lv + '</span>' + (it.st === 'todo' ? why.map(esc).join(' · ') + (why.length ? ' · ' : '') + t('下次复习：', 'next review: ') + whenDue(it.x) : '') +
      ' · <a href="/' + (EN ? '' : 'zh/') + c.lesson + '/">' + t('讲解', 'Lesson') + ' →</a></div></div><span class="wb-acts">' +
      (it.st === 'todo' ? '<button type="button" class="wb-btn" data-act="got" data-r="' + r + '">' + t('✓ 已掌握', '✓ Got it') + '</button><button type="button" class="wb-btn" data-act="drop" data-r="' + r + '">' + t('移出', 'Remove') + '</button>'
        : '<button type="button" class="wb-btn" data-act="back" data-r="' + r + '">' + t('放回复习', 'Review again') + '</button>') + '</span></li>';
  }

  // ─── studying: the cards page's scheduler (quiz.js schedule()) ───
  function schedule(x, grade) {
    var n = Date.now();
    x = x ? JSON.parse(JSON.stringify(x)) : { s: 'learn', step: 0, ivl: 0, ease: 2.5, lapses: 0 };
    x.t = n;
    if (x.s === 'learn') {
      if (grade === 0) { x.step = 0; x.due = n + STEPS[0]; }
      else if (grade === 1) x.due = n + STEPS[x.step] * 1.5;
      else if (grade === 3 || x.step + 1 >= STEPS.length) { x.s = 'review'; x.ivl = grade === 3 ? 4 : 1; x.due = n + x.ivl * DAY; }
      else { x.step++; x.due = n + STEPS[x.step]; }
      return x;
    }
    if (grade === 0) { x.lapses++; x.ease = Math.max(MIN_EASE, x.ease - 0.2); x.ivl = Math.max(1, Math.round(x.ivl * 0.3)); x.s = 'learn'; x.step = 1; x.due = n + STEPS[1]; return x; }
    if (grade === 1) { x.ease = Math.max(MIN_EASE, x.ease - 0.15); x.ivl = Math.max(x.ivl + 1, Math.round(x.ivl * 1.2)); }
    else if (grade === 2) x.ivl = Math.max(x.ivl + 1, Math.round(x.ivl * x.ease));
    else { x.ease += 0.15; x.ivl = Math.max(x.ivl + 2, Math.round(x.ivl * x.ease * 1.3)); }
    x.due = n + x.ivl * DAY;
    return x;
  }
  function study(early) {
    var T = items().filter(function (it) { return it.st === 'todo' && (filt === 'all' || it.lv === filt) && (early || due(it)); })
      .sort(function (a, b) { return ((a.x && a.x.due) || 0) - ((b.x && b.x.due) || 0); });
    ev('grammar_card_study', { level: filt, n: Math.min(20, T.length), early: early ? 1 : 0 });
    round(T.slice(0, 20));
  }
  // 按级别学: added / missed points that are due first, then the levels' due
  // cards, then today's new ones (each card once).
  function studyPlan() {
    var p = plan(), seen = {}, list = [];
    items().filter(function (it) { return it.st === 'todo' && due(it); }).concat(p.due, p.fresh).forEach(function (it) {
      if (seen[it.c.id]) return; seen[it.c.id] = 1; list.push(it);
    });
    ev('grammar_plan_study', { levels: p.P.lv.join(','), due: p.due.length, fresh: p.fresh.length });
    round(list.slice(0, 60));
  }
  function round(list) {
    MS = { list: list, i: 0, flip: false, n: 0 };
    app.innerHTML = '<p class="mg-muted">' + t('加载卡片…', 'Loading cards…') + '</p>';
    var lvs = []; MS.list.forEach(function (it) { if (lvs.indexOf(it.lv) < 0) lvs.push(it.lv); });
    loadFull(lvs).then(function () {
      MS.list.forEach(function (it) { var f = FULL[it.lv] && FULL[it.lv][it.c.id]; if (f) it.c = f; });
      card();
    });
  }
  function card() {
    var h = '<div class="wb-top"><button type="button" class="wb-link" data-act="list">‹ ' + t('我的语法卡', 'My grammar cards') + '</button><span>' + t('背卡片', 'Study') + (MS.i < MS.list.length ? ' · ' + (MS.i + 1) + ' / ' + MS.list.length : '') + '</span></div>';
    if (MS.i >= MS.list.length) {
      h += '<div class="wb-card"><p class="wb-card-w">' + t('这一轮背完了', 'Round done') + '</p><p class="mg-muted">' + t('背了 ' + MS.n + ' 张', MS.n + ' cards studied') + '</p><p><button type="button" class="wb-btn wb-primary" data-act="list">' + t('回列表', 'Back to the list') + '</button></p></div>';
      app.innerHTML = h; return;
    }
    var it = MS.list[MS.i], c = it.c;
    h += '<div class="wb-card mg-card"><p class="mg-card-lv">' + it.lv + '</p><p class="wb-card-w" lang="ja">' + esc(bi(c.term)) + '</p>';
    if (!MS.flip) h += '<p><button type="button" class="wb-btn wb-primary wb-big" data-act="flip">' + t('看答案', 'Show answer') + '</button></p><p class="mg-muted">' + t('先想想意思和用法（空格键翻面）', 'Recall the meaning and use first (space flips)') + '</p>';
    else {
      h += (bi(c.desc) ? '<p class="wb-card-m">' + esc(bi(c.desc)) + '</p>' : '') + '<div class="mg-back">' + bi(c.meaning) +
        ((c.ex || []).length ? '<ul class="mg-ex">' + c.ex.slice(0, 2).map(function (e) { return '<li><span lang="ja">' + e.ja + '</span><br><span class="mg-muted">' + esc(EN ? e.en : e.zh) + '</span></li>'; }).join('') + '</ul>' : '') + '</div>' +
        '<div class="wb-card-acts">' + [[0, t('重来', 'Again')], [1, t('困难', 'Hard')], [2, t('记得', 'Good')], [3, t('简单', 'Easy')]].map(function (g) {
          return '<button type="button" class="wb-btn' + (g[0] === 2 ? ' wb-primary' : '') + '" data-act="grade" data-g="' + g[0] + '">' + g[1] + ' <kbd>' + (g[0] + 1) + '</kbd></button>';
        }).join('') + '</div>';
    }
    app.innerHTML = h + '</div>';
  }
  function grade(g) {
    var it = MS.list[MS.i], S = ld(), fresh = !S.cards[it.c.id];
    S.cards[it.c.id] = schedule(S.cards[it.c.id], g);
    var dt = new Date(), day = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);   // local date, like quiz.js today()
    S.cardDays = S.cardDays || {}; var cd = S.cardDays[day] || (S.cardDays[day] = { n: 0, r: 0 });
    if (fresh) cd.n++; else cd.r++;   // as the cards page counts: a first look is a new card
    sv(S);
    ev('grammar_card_grade', { g: g, level: it.lv });
    MS.n++;
    if (g === 0) MS.list.push(it);   // again: once more at the end of this round
    MS.i++; MS.flip = false; card();
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var lv = b.getAttribute('data-lv');
    if (lv) { filt = lv; pg = { T: 0, M: 0 }; try { localStorage.setItem('jp_mg_lv', lv); } catch (x) {} return render(); }
    var pv = b.getAttribute('data-pg');
    if (pv) { var pp = pv.split(':'); pg[pp[0]] = Math.max(0, +pp[1]); render(); var top = app.querySelector(pp[0] === 'M' ? '.wb-done' : '.wb-sum'); if (top) top.scrollIntoView({ block: 'start' }); return; }
    var plv = b.getAttribute('data-plv');
    if (plv) {
      var P = prefs(), i = P.lv.indexOf(plv);
      if (i >= 0) P.lv.splice(i, 1); else P.lv.push(plv);
      P.lv.sort(function (x, y) { return LV.indexOf(x) - LV.indexOf(y); });
      setPrefs({ mgLv: P.lv }); ev('grammar_plan_levels', { levels: P.lv.join(',') }); return render();
    }
    var a = b.getAttribute('data-act'), r = b.getAttribute('data-r');
    if (a === 'plan') studyPlan();
    else if (a === 'study') study(b.hasAttribute('data-early'));
    else if (a === 'list') render();
    else if (a === 'flip') { MS.flip = true; card(); }
    else if (a === 'grade') grade(+b.getAttribute('data-g'));
    else if (a === 'got') { setCheck('g:' + r, Date.now()); ev('grammar_mastered', { g: r, on: 1, page: location.pathname }); render(); }
    else if (a === 'back') { setCheck('g:' + r, -Date.now()); setCheck('gs:' + r, Date.now()); render(); }
    else if (a === 'drop') { setCheck('gs:' + r, -Date.now()); ev('grammar_card_remove', { g: r }); render(); }
  });
  app.addEventListener('change', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-pnew')) { setPrefs({ mgNew: +e.target.value }); render(); }
  });
  document.addEventListener('keydown', function (e) {
    if (!MS || MS.i >= MS.list.length || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!MS.flip && (e.code === 'Space' || e.key === 'Enter')) { e.preventDefault(); MS.flip = true; card(); }
    else if (MS.flip && /^[1-4]$/.test(e.key)) { e.preventDefault(); grade(+e.key - 1); }
  });
  addEventListener('storage', function (e) { if ((e.key === K || e.key === CK) && !MS) render(); });
  document.addEventListener('jp-checks', function () { if (!MS) render(); });
  render();
  ev('grammar_card_list', {});
})();
