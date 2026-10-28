/* Practice questions — /n5-practice/ and friends.
 *
 * Mounts on <div id="quiz-app" data-level="N5" data-src="/quiz/n5.json?v=…">.
 * The bundle comes from build-quiz.js (furigana already in the HTML).
 * Everything the reader does stays in this browser (localStorage
 * jp_quiz_v1): answer history, the review list (spaced repetition), the
 * set in progress, daily counts. Spec: docs/quiz-practice-spec.md.
 */
(function () {
  'use strict';
  var app = document.getElementById('quiz-app');
  if (!app || !window.fetch) return;

  var LEVEL = app.getAttribute('data-level');
  var EN = document.documentElement.getAttribute('data-force-lang') !== 'zh';
  var LESSON_BASE = '/' + (EN ? '' : 'zh/');
  var KEY = 'jp_quiz_v1';
  var DAY = 86400;
  var KEEP_ANSWERS = 5;          // per question
  var RECENT = 20;               // answers that make up a type's accuracy
  var REVIEW_DAYS = [0, 3, 7];   // review level → days until due; past the last level it's learned

  function t(zh, en) { return EN ? en : zh; }
  function bi(o) { return o ? (EN ? o.en : o.zh) : ''; }
  function now() { return Math.floor(Date.now() / 1000); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(name, p) { try { if (window.gaEvent) window.gaEvent(name, p); } catch (e) {} }

  // ─── Storage ───
  function fresh() { return { v: 1, answers: {}, review: {}, reported: [], session: null, days: {}, prefs: { size: 10 }, mock: {}, cards: {}, cardDays: {} }; }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) { var f = fresh(); for (var k in f) if (!(k in s)) s[k] = f[k]; return s; }
    } catch (e) {}
    return fresh();
  }
  var S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  // ─── Data ───
  var D, Q = {}, ALL = [];
  var MOCK = app.getAttribute('data-mode') === 'mock';
  var CARDS = app.getAttribute('data-mode') === 'cards';
  // The text under the app (what the level tests, FAQ, lesson links) is for the
  // start screen; while a set, test or card session is on screen it's hidden.
  function view(home) { document.body.classList.toggle('quiz-busy', !home); }
  function loadFail() { app.innerHTML = '<p class="q-muted">' + t('题目载入失败，刷新再试一次。', 'Couldn’t load the questions — try reloading.') + '</p>'; }
  app.innerHTML = '<p class="q-muted">' + t('载入题目…', 'Loading questions…') + '</p>';
  // Runs at the end of this file, once every mode's state is set up.
  function boot() {
    if (MOCK) return mockList();
    if (CARDS) return cardsLoad();
    fetch(app.getAttribute('data-src')).then(function (r) { return r.json(); }).then(function (d) {
    D = d;
    D.questions.forEach(function (q) { Q[q.id] = q; });
    // A question whose answer changed (rev bump) starts over.
    Object.keys(S.answers).forEach(function (id) {
      var q = Q[id], a = S.answers[id];
      if (q && a.length && (a[a.length - 1].rev || 1) !== q.rev) { delete S.answers[id]; delete S.review[id]; }
    });
    ALL = D.questions.filter(function (q) { return S.reported.indexOf(q.id) < 0; });
    home();
    // Deep links from other pages: #type=kanji, #lesson=lesson05, #ref=lesson05.3
    var m = location.hash.match(/^#(type|lesson|ref)=([\w.]+)$/);
    if (m) { history.replaceState(null, '', location.pathname); startKind(m[1], m[1] === 'ref' ? m[2].replace('.', '#') : m[2]); }
  }).catch(loadFail);
  }

  // Grammar questions belong to their lesson; a vocabulary question to the
  // lesson whose word table has the word (refs lessonNN#vocab); reading to none.
  function lessonOf(q) {
    if (q.type === 'bunpou' || q.type === 'narabe') return q.refs[0].split('#')[0];
    var v = (q.refs || []).filter(function (r) { return /#vocab$/.test(r); })[0];
    return v ? v.split('#')[0] : null;
  }
  function groupOf(q) { return D.types[q.type].g; }
  function seen(id) { return (S.answers[id] || []).length > 0; }
  function lastT(id) { var a = S.answers[id] || []; return a.length ? a[a.length - 1].t : 0; }
  function due() { var n = now(); return ALL.filter(function (q) { var r = S.review[q.id]; return r && r.due <= n; }); }
  function inReview() { return ALL.filter(function (q) { return S.review[q.id]; }); }

  // Accuracy over the last RECENT answers to questions matching `pick`.
  function accuracy(pick) {
    var xs = [];
    ALL.forEach(function (q) { if (pick(q)) (S.answers[q.id] || []).forEach(function (a) { xs.push(a); }); });
    xs.sort(function (a, b) { return b.t - a.t; });
    xs = xs.slice(0, RECENT);
    if (!xs.length) return null;
    var ok = xs.filter(function (a) { return a.ok && !a.g; }).length;
    return { pct: Math.round(ok * 100 / xs.length), n: xs.length };
  }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  // Order a set: questions on one passage stay together and in passage order
  // (all of them, even if only one was picked); the rest is shuffled, keeping
  // two questions on the same grammar point apart where possible.
  function arrange(list) {
    var units = [], seenP = {};
    list.forEach(function (q) {
      if (!q.passage) units.push([q]);
      else if (!seenP[q.passage]) { seenP[q.passage] = 1; units.push(ALL.filter(function (x) { return x.passage === q.passage; })); }
    });
    shuffle(units);
    var out = [], key = function (u) { return u.length === 1 && u[0].refs ? u[0].refs[0] : null; };
    while (units.length) {
      var prev = out.length ? out[out.length - 1] : null, i = 0;
      while (i < units.length && prev && key(units[i]) && key(units[i]) === key(prev)) i++;
      out.push(units.splice(i < units.length ? i : 0, 1)[0]);
    }
    return [].concat.apply([], out);
  }
  // Unseen first (in lesson order), then the ones seen longest ago.
  function freshFirst(list) {
    var unseen = list.filter(function (q) { return !seen(q.id); });
    var old = list.filter(function (q) { return seen(q.id); }).sort(function (a, b) { return lastT(a.id) - lastT(b.id); });
    return unseen.concat(old);
  }

  // 今日练习: due reviews, then the weakest types, then new questions.
  function daily(n) {
    // A passage brings all of its questions, so it counts as that many, and a
    // set has at most one — the rest stays single questions.
    var pick = [], has = {}, size = 0, passage = null;
    function cost(q) { return ALL.filter(function (x) { return x.passage === q.passage; }).length; }
    function add(q) {
      if (has[q.id]) return false;
      if (q.passage) {
        if (passage !== q.passage && (passage || size + cost(q) > n)) return false;
        if (passage !== q.passage) { passage = q.passage; size += cost(q); }
      } else if (size >= n) return false;
      else size++;
      has[q.id] = 1; pick.push(q); return true;
    }
    due().sort(function (a, b) { return S.review[a.id].due - S.review[b.id].due; }).slice(0, Math.ceil(n * 0.4)).forEach(add);
    var weak = Object.keys(D.types).map(function (k) { return { k: k, a: accuracy(function (q) { return q.type === k; }) }; })
      .filter(function (x) { return x.a; }).sort(function (a, b) { return a.a.pct - b.a.pct; }).slice(0, 2);
    var cap = size + Math.ceil(n * 0.4);
    weak.forEach(function (w) {
      ALL.filter(function (q) { return q.type === w.k && !seen(q.id); }).forEach(function (q) { if (size < cap) add(q); });
    });
    // Then new questions taken in turn: vocabulary, grammar (single questions,
    // in lesson order), and one passage — 文章の文法 or reading, at random.
    var queues = [
      // vocabulary has no natural order: unseen ones at random, then the oldest
      shuffle(ALL.filter(function (q) { return !q.passage && groupOf(q) === 'moji' && !seen(q.id); })).concat(freshFirst(ALL.filter(function (q) { return !q.passage && groupOf(q) === 'moji' && seen(q.id); }))),
      freshFirst(ALL.filter(function (q) { return !q.passage && groupOf(q) === 'bunpou'; })),
      shuffle(ALL.filter(function (q) { return q.passage && !seen(q.id); })),
    ];
    for (var k = 0; size < n && queues.some(function (x) { return x.length; }); k++) {
      var qu = queues[k % queues.length];
      while (qu.length && !add(qu.shift())) {}
    }
    return arrange(pick);
  }
  function subset(pickFn, n) { return arrange(freshFirst(ALL.filter(pickFn)).slice(0, n)); }

  // ─── Recording an answer ───
  function record(q, choice, guess, ms) {
    var ok = choice === q.answer, n = now();
    var a = S.answers[q.id] || (S.answers[q.id] = []);
    a.push({ t: n, c: choice, ok: ok, ms: ms, g: guess, rev: q.rev });
    if (a.length > KEEP_ANSWERS) a.splice(0, a.length - KEEP_ANSWERS);
    S.days[today()] = (S.days[today()] || 0) + 1;
    var r = S.review[q.id];
    if (!ok) S.review[q.id] = { lv: 0, due: n, src: 'bank' };
    else if (guess) S.review[q.id] = { lv: 0, due: n + DAY, src: 'bank' };
    else if (r && r.due <= n) {
      r.lv++;
      if (r.lv >= REVIEW_DAYS.length) delete S.review[q.id];
      else r.due = n + REVIEW_DAYS[r.lv] * DAY;
    }
    track('quiz_answer', { type: q.type, ok: ok, guess: guess, ms: ms < 10000 ? '<10s' : ms < 30000 ? '10-30s' : ms < 60000 ? '30-60s' : '60s+' });
    return ok;
  }

  // ─── Home ───
  function streak() {
    var n = 0, d = new Date();
    if (!S.days[today()]) d.setDate(d.getDate() - 1);   // today not started yet doesn't break it
    for (;;) {
      var k = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      if (!S.days[k]) return n;
      n++; d.setDate(d.getDate() - 1);
    }
  }
  function bar(a) {
    if (!a) return '<span class="q-acc q-muted">—</span>';
    return '<span class="q-acc' + (a.pct < 60 ? ' q-acc-low' : '') + '"><span class="q-bar"><span style="width:' + a.pct + '%"></span></span>' + a.pct + '%</span>';
  }
  function home() {
    view(true);
    var size = S.prefs.size || 10;
    var d = due().length, r = inReview().length;
    var h = '';
    if (S.session && S.session.ids.every(function (id) { return Q[id]; }) && S.session.i < S.session.ids.length) {
      h += '<div class="q-resume">' + t('上一组还剩 ', 'You have ') + (S.session.ids.length - S.session.i) + t(' 题', ' questions left in your last set') +
        ' <button class="q-btn q-btn-primary" data-act="resume">' + t('继续', 'Continue') + '</button> <button class="q-btn" data-act="drop">' + t('放弃', 'Discard') + '</button></div>';
    }
    h += '<div class="q-today">' +
      '<button class="q-btn q-btn-primary q-btn-big" data-act="daily">' + t('今日练习', 'Today’s practice') + ' · ' + size + t(' 题', ' questions') + '</button>' +
      // Today's count and streak once there is one; a first visit says what a set is.
      '<p class="q-muted">' + (S.days[today()] || streak() ? t('今天做了 ', 'Today: ') + (S.days[today()] || 0) + t(' 题', ' answered') + ' · ' + t('连续 ', 'streak ') + streak() + t(' 天', ' days') :
        t('词汇、语法、阅读混在一起，答完马上看解析', 'Vocabulary, grammar and reading mixed — explanations right after each answer')) + '</p></div>';
    h += '<section class="q-sec"><h2>' + t('错题本', 'Review list') + '</h2><p>' +
      (r ? t('共 ', '') + r + t(' 题，今天到期 ', ' questions, ') + d + t(' 题', ' due today') : t('还没有错题。答错、点了“不会”或“其实是蒙的”的题会出现在这里，隔几天再考你一次。', 'Nothing here yet. Questions you miss, mark “I don’t know”, or flag as a guess show up here and come back a few days later.')) + '</p>' +
      (r ? '<button class="q-btn" data-act="review"' + (d ? '' : ' data-early="1"') + '>' + (d ? t('复习到期的错题', 'Review due questions') : t('提前复习', 'Review early')) + '</button>' : '') + '</section>';
    Object.keys(D.groups).forEach(function (g) {
      var keys = Object.keys(D.types).filter(function (k) { return D.types[k].g === g; });
      if (!keys.length) return;
      h += '<section class="q-sec"><h2>' + esc(bi(D.groups[g])) + ' <small class="q-muted">' + esc(D.groups[g].ja) + '</small></h2><ul class="q-rows">';
      keys.forEach(function (k) {
        var list = ALL.filter(function (q) { return q.type === k; });
        if (!list.length) return;
        var done = list.filter(function (q) { return seen(q.id); }).length;
        h += '<li><button class="q-row" data-act="type" data-k="' + k + '"><span class="q-row-name">' + esc(bi(D.types[k])) + ' <small>' + esc(D.types[k].ja) + '</small></span>' +
          '<span class="q-muted">' + done + '/' + list.length + '</span>' + bar(accuracy(function (q) { return q.type === k; })) + '</button></li>';
      });
      h += '</ul></section>';
    });
    h += '<details class="q-sec q-settings"><summary>' + t('设置与备份', 'Settings & backup') + '</summary>' +
      '<label>' + t('每组题数', 'Questions per set') + ' <select data-act="size">' + [5, 10, 20].map(function (n) { return '<option' + (n === size ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<p class="q-muted">' + t('做题记录只存在这个浏览器里。换手机或清缓存前先导出。', 'Your progress lives only in this browser. Export it before switching phones or clearing site data.') + '</p>' +
      '<button class="q-btn" data-act="export">' + t('导出进度', 'Export progress') + '</button> ' +
      '<label class="q-btn">' + t('导入进度', 'Import progress') + '<input type="file" accept="application/json" data-act="import" hidden></label></details>';
    app.innerHTML = h;
  }

  // ─── A set of questions ───
  var cur = null;   // { q, start, picked: [slot → option], guess, done, root }
  // A passage's questions share one screen: curs holds each one's state (cur is
  // the one being answered), and every lookup is inside that question's block.
  var curs = null;
  function root() { return (cur && cur.root) || app; }
  function start(kind, list, label) {
    if (!list.length) return;
    S.session = { kind: kind, label: label || '', ids: list.map(function (q) { return q.id; }), i: 0, res: [] };
    save();
    track('quiz_start', { kind: kind, size: list.length, level: LEVEL });
    ask();
  }
  function ask() {
    view(false);
    var s = S.session;
    if (s.i >= s.ids.length) return summary();
    var q = Q[s.ids[s.i]];
    curs = null;
    if (q.passage) {
      var group = [];
      for (var j = s.i; j < s.ids.length && Q[s.ids[j]].passage === q.passage; j++) group.push(Q[s.ids[j]]);
      if (group.length > 1) return askPassage(group);
    }
    cur = { q: q, start: Date.now(), picked: [null, null, null, null], guess: false, done: false };
    var h = '<div class="q-top"><button class="q-link" data-act="home">‹ ' + t('返回', 'Back') + '</button>' +
      '<span>' + (s.i + 1) + ' / ' + s.ids.length + '</span><span class="q-muted">' + esc(bi(D.types[q.type])) + '</span></div>' +
      '<div class="q-progress"><span style="width:' + (s.i * 100 / s.ids.length) + '%"></span></div>' +
      '<div class="q-card">' + passageHtml(q) + '<div class="q-stem" lang="ja">' + stemHtml(q) + '</div>';
    if (q.type === 'narabe') {
      h += '<p class="q-muted q-hint">' + t('按顺序点选项填进空格，点空格可以撤回。选出 ★ 处的词。', 'Tap the pieces in order to fill the blanks; tap a blank to undo. The answer is what goes in ★.') + '</p>' +
        '<div class="q-pieces" lang="ja">' + q.options.map(function (o, i) { return '<button class="q-piece" data-act="piece" data-i="' + i + '">' + o + '</button>'; }).join('') + '</div>';
    } else {
      h += '<ol class="q-opts" lang="ja">' + q.options.map(function (o, i) { return '<li><button class="q-opt" data-act="opt" data-i="' + i + '"><span class="q-num">' + (i + 1) + '</span>' + o + '</button></li>'; }).join('') + '</ol>';
    }
    h += '<div class="q-actions">' + (q.type === 'narabe' ? '' : '<button class="q-btn q-idk" data-act="idk">' + t('不会', 'I don’t know') + '</button>') +
      (q.type === 'narabe' ? '<button class="q-btn q-btn-primary" data-act="submit" disabled>' + t('提交', 'Submit') + '</button>' : '') + '</div>' +
      '<div class="q-feedback" aria-live="polite"></div></div>';
    app.innerHTML = h;
    window.scrollTo(0, app.offsetTop - 16);
  }
  function askPassage(group) {
    var s = S.session, q = group[0];
    var h = '<div class="q-top"><button class="q-link" data-act="home">‹ ' + t('返回', 'Back') + '</button>' +
      '<span>' + (s.i + 1) + '–' + (s.i + group.length) + ' / ' + s.ids.length + '</span><span class="q-muted">' + esc(bi(D.types[q.type])) + '</span></div>' +
      '<div class="q-progress"><span style="width:' + (s.i * 100 / s.ids.length) + '%"></span></div>' +
      '<div class="q-card">' + passageHtml({ passage: q.passage, blank: null });
    group.forEach(function (g, k) {
      h += '<div class="q-sub" data-q="' + g.id + '"><p class="q-subno">' + t('问题 ', 'Question ') + (k + 1) + '</p><div class="q-stem" lang="ja">' + stemHtml(g) + '</div>' +
        '<ol class="q-opts" lang="ja">' + g.options.map(function (o, i) { return '<li><button class="q-opt" data-act="opt" data-i="' + i + '"><span class="q-num">' + (i + 1) + '</span>' + o + '</button></li>'; }).join('') + '</ol>' +
        '<div class="q-actions">' + '<button class="q-btn q-idk" data-act="idk">' + t('不会', 'I don’t know') + '</button>' + '</div>' +
        '<div class="q-feedback" aria-live="polite"></div></div>';
    });
    app.innerHTML = h + '</div>';
    curs = {};
    group.forEach(function (g) { curs[g.id] = { q: g, start: Date.now(), picked: [null, null, null, null], guess: false, done: false, root: app.querySelector('.q-sub[data-q="' + g.id + '"]') }; });
    cur = curs[group[0].id];
    window.scrollTo(0, app.offsetTop - 16);
  }
  // The passage a question belongs to: intro line, then the text in a box.
  // Lines starting with | are a table; [[n]] is a numbered blank (文章の文法).
  function textHtml(src) {
    var rows = [], out = '';
    src.split('\n').forEach(function (line) {
      if (/^\|/.test(line)) { rows.push(line.replace(/^\||\|$/g, '').split('|')); return; }
      if (rows.length) { out += table(rows); rows = []; }
      out += line ? '<p>' + line + '</p>' : '';
    });
    if (rows.length) out += table(rows);
    return out;
  }
  // N5/N4: after answering, the kanji a kana word or sentence would be written with.
  function okjOf(q, i) { return q.okj && q.okj[i] ? '<span class="q-okj">（' + q.okj[i] + '）</span>' : ''; }
  function kjHtml(q, passages) {
    var h = q.kj ? '<p class="q-full q-kj" lang="ja"><span class="q-kj-label">' + t('汉字写法', 'In kanji') + '</span>' + q.kj + '</p>' : q.full ? '<p class="q-full" lang="ja">' + q.full + '</p>' : '';
    var P = q.passage && passages && passages[q.passage];
    if (P && P.kj) h += '<details class="q-tr"><summary>' + t('全文汉字写法', 'The text in kanji') + '</summary><div class="q-passage" lang="ja">' + textHtml(P.kj) + '</div></details>';
    return h;
  }
  function passageHtml(q) {
    if (!q.passage) return '';
    var P = D.passages[q.passage];
    var out = textHtml(P.html);
    out = out.replace(/\[\[(\d+)\]\]/g, function (m, n) { return '<span class="q-pblank' + (+n === q.blank ? ' q-pblank-on' : '') + '" data-n="' + n + '">' + n + '</span>'; });
    return (P.intro ? '<p class="q-intro" lang="ja">' + P.intro + '</p>' : '') + '<div class="q-passage" lang="ja">' + out + '</div>';
  }
  function table(rows) {
    return '<div class="table-scroll"><table class="q-table">' + rows.map(function (r, i) {
      var tag = i === 0 ? 'th' : 'td';
      return '<tr>' + r.map(function (c) { return '<' + tag + '>' + c.trim() + '</' + tag + '>'; }).join('') + '</tr>';
    }).join('') + '</table></div>';
  }
  function stemHtml(q) {
    if (q.type === 'bunshou') return '<span class="q-pblank">' + q.blank + '</span> ' + t('处应填入什么？', 'What goes in this blank?');
    if (!q.stem) return q.q;
    var k = 0;
    return q.stem.replace(/\n/g, '<br>')
      .replace(/（　）/, '<span class="q-blank">（　）</span>')
      .replace(/\[(_|★)\]/g, function (m, s) { var i = k++; return '<button class="q-slot' + (s === '★' ? ' q-star' : '') + '" data-act="slot" data-k="' + i + '" aria-label="' + (s === '★' ? '★' : t('空格', 'blank')) + ' ' + (i + 1) + '">' + (s === '★' ? '★' : '') + '</button>'; });
  }

  function fillSlots() {
    var slots = app.querySelectorAll('.q-slot'), pieces = app.querySelectorAll('.q-piece');
    var used = {};
    cur.picked.forEach(function (p, k) {
      slots[k].innerHTML = p === null ? (slots[k].classList.contains('q-star') ? '★' : '') : cur.q.options[p];
      slots[k].classList.toggle('q-filled', p !== null);
      if (p !== null) used[p] = 1;
    });
    for (var i = 0; i < pieces.length; i++) pieces[i].disabled = !!used[i];
    var btn = app.querySelector('[data-act="submit"]');
    if (btn) btn.disabled = cur.picked.indexOf(null) >= 0;
  }

  /* ── 🤖 AI 讲解: hand the answered question to the AI panel (ai-assistant.js) ──
   * Only after answering (in a mock test: only in the review after submitting).
   * The context is plain text: passage, question, options, the right answer,
   * the reader's choice, the fixed explanation and the linked lesson section
   * (fetched from the lesson page). Nothing time- or reader-specific goes in,
   * so the same question + choice is the same request and can come from cache. */
  function aiBtn(primary) {
    if (!window.jpAI) return '';
    return '<p class="q-ai"><button class="q-btn' + (primary ? ' q-btn-primary' : '') + '" data-act="ai">🤖 ' + t('AI 讲解', 'Explain with AI') + '</button>' +
      (primary ? ' <span class="q-muted">' + t('针对你选的选项讲，可以追问', 'about the option you picked; ask follow-ups') + '</span>' : '') + '</p>';
  }
  function plainJa(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html || '').replace(/<br\s*\/?>/g, '\n').replace(/<<([^<>]+)>>/g, '「$1」');
    d.querySelectorAll('rt, rp').forEach(function (n) { n.remove(); });
    d.querySelectorAll('u, .q-ul').forEach(function (n) { n.textContent = '「' + n.textContent + '」'; });
    return d.textContent.trim();
  }
  var lessonText = {};
  function refText(ref) {
    var p = D.refs && D.refs[ref];
    if (!p) return Promise.resolve('');
    var key = p.lesson + '#' + p.slug;
    if (lessonText[key] != null) return Promise.resolve(lessonText[key]);
    return fetch(LESSON_BASE + p.lesson + '/').then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html'), h = doc.getElementById(p.slug), out = [];
      if (h && /^H[23]$/.test(h.tagName)) {
        for (var n = h; n && !(n !== h && n.tagName === h.tagName); n = n.nextElementSibling) {
          n.querySelectorAll('rt, rp, .speak-btn, .quiz-link, script').forEach(function (x) { x.remove(); });
          out.push(n.textContent.replace(/[ \t]+/g, ' ').trim());
        }
      }
      return (lessonText[key] = out.join('\n').replace(/\n{2,}/g, '\n').slice(0, 6000));
    }).catch(function () { return (lessonText[key] = ''); });
  }
  function aiExplain(q, choice, guess, typeJa, passages) {
    var L = [], P = q.passage && passages && passages[q.passage];
    if (P) L.push(t('【文章】', '[Text]') + '\n' + plainJa((P.intro ? P.intro + '<br>' : '') + P.html).replace(/\[\[(\d+)\]\]/g, '（$1）'));
    L.push(t('【题型】', '[Question type]') + ' ' + typeJa);
    L.push(t('【题目】', '[Question]') + ' ' + (q.type === 'bunshou' ? t('文章里的空格 ', 'blank ') + q.blank : plainJa(q.stem || q.q).replace(/\[_\]/g, '＿＿').replace(/\[★\]/g, '＿★＿')));
    L.push(t('【选项】', '[Options]') + '\n' + q.options.map(function (o, i) { return (i + 1) + '. ' + plainJa(o); }).join('\n'));
    if (q.type === 'narabe') L.push(t('【正确顺序】', '[Correct order]') + ' ' + q.order.map(function (i) { return plainJa(q.options[i]); }).join(' / '));
    L.push(t('【正确答案】', '[Correct answer]') + ' ' + (q.answer + 1) + '. ' + plainJa(q.options[q.answer]));
    L.push(t('【学习者选的】', '[Learner chose]') + ' ' + (choice == null ? t('没答', 'no answer') : (choice + 1) + '. ' + plainJa(q.options[choice])) + (guess ? t('（标了"蒙的"）', ' (marked as a guess)') : ''));
    if (q.full) L.push(t('【完整句子】', '[Full sentence]') + ' ' + plainJa(q.full));
    L.push(t('【固定解析】', '[Explanation]') + ' ' + bi(q.why) + (q.wrong ? '\n' + q.wrong.map(function (w, i) { return w ? (i + 1) + '. ' + bi(w) : ''; }).filter(Boolean).join('\n') : ''));
    var ok = choice === q.answer, prompt = choice == null
      ? t('这题我没答，帮我讲清楚为什么是 ' + (q.answer + 1) + '，下次怎么判断。', 'I didn’t answer this one. Explain why it’s ' + (q.answer + 1) + ' and how to tell next time.')
      : !ok ? t('我选了 ' + (choice + 1) + '「' + plainJa(q.options[choice]) + '」，为什么不对？它和正确答案的区别是什么？', 'I chose ' + (choice + 1) + ' 「' + plainJa(q.options[choice]) + '」. Why is it wrong, and how does it differ from the right answer?')
      : guess ? t('这题我是蒙的，帮我讲清楚为什么是 ' + (q.answer + 1) + '，下次怎么判断。', 'I guessed this one. Explain why it’s ' + (q.answer + 1) + ' and how to tell next time.')
      : t('我答对了。再讲讲这几个选项的区别。', 'I got it right. Explain how these options differ.');
    track('quiz_ai', { id: q.id, ok: ok, guess: !!guess });
    Promise.all((q.refs || []).filter(function (r) { return !/#vocab$/.test(r); }).slice(0, 2).map(refText)).then(function (secs) {
      secs = secs.filter(Boolean);
      if (secs.length) L.push(t('【对应课文】', '[Lesson section]') + '\n' + secs.join('\n---\n'));
      window.jpAI.explain(L.join('\n\n'), prompt);
    });
  }

  function submit(choice) {
    if (cur.done) return;
    cur.done = true;
    var q = cur.q, ms = Date.now() - cur.start;
    var ok = record(q, choice, cur.guess, ms);
    S.session.res.push({ id: q.id, c: choice, ok: ok, g: cur.guess, ms: ms });
    S.session.i++;
    save();
    feedback(q, choice, ok);
  }

  function feedback(q, choice, ok) {
    var opts = root().querySelectorAll('.q-opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].disabled = true;
      if (i === q.answer) opts[i].classList.add('q-ok');
      else if (i === choice) opts[i].classList.add('q-bad');
      if (okjOf(q, i)) opts[i].insertAdjacentHTML('beforeend', okjOf(q, i));
    }
    if (q.type === 'narabe') {
      app.querySelectorAll('.q-piece').forEach(function (b) { b.disabled = true; });
      app.querySelectorAll('.q-slot').forEach(function (b, k) {
        b.disabled = true;
        b.innerHTML = q.options[q.order[k]];
        b.classList.add('q-filled');
        if (b.classList.contains('q-star')) b.classList.add(ok ? 'q-ok' : 'q-bad');
      });
    } else {
      var blank = root().querySelector('.q-blank') || (curs ? app.querySelector('.q-pblank[data-n="' + q.blank + '"]') : app.querySelector('.q-pblank-on'));
      if (blank) { blank.innerHTML = '<span class="q-fill">' + q.options[q.answer] + '</span>'; blank.classList.add('q-filled'); }
    }
    var g = root().querySelector('[data-act="idk"]'); if (g) g.remove();
    var sb = root().querySelector('[data-act="submit"]'); if (sb) sb.remove();

    cur.choice = choice;
    // 不会 before answering; 其实是蒙的 after a right answer (both go on the review list).
    var h = '<p class="q-verdict ' + (ok ? 'q-v-ok' : 'q-v-bad') + '">' + (ok ? '✓ ' + t('正确', 'Correct') : '✗ ' + (choice == null ? t('不会 · ', 'Didn’t know · ') : '') + t('正确答案是 ', 'The answer is ') + (q.answer + 1) + ' <span lang="ja">' + q.options[q.answer] + okjOf(q, q.answer) + '</span>') +
      (ok ? ' <button class="q-btn q-was-guess" data-act="was-guess">' + t('其实是蒙的', 'I guessed') + '</button>' : '') + '</p>';
    var aiFirst = !ok || cur.guess;
    if (aiFirst) h += aiBtn(true);
    h += '<div class="q-explain"><p>' + esc(bi(q.why)) + '</p>';
    if (q.type !== 'narabe') {
      var rows = q.wrong.map(function (w, i) { return w ? { i: i, w: w } : null; }).filter(Boolean);
      rows.sort(function (a, b) { return (b.i === choice) - (a.i === choice); });
      h += '<ul class="q-wrong">' + rows.map(function (r) { return '<li' + (r.i === choice ? ' class="q-mine"' : '') + '><b lang="ja">' + (r.i + 1) + ' ' + q.options[r.i] + okjOf(q, r.i) + '</b> — ' + esc(bi(r.w)) + '</li>'; }).join('') + '</ul>';
    }
    h += kjHtml(q, D.passages);
    if (q.tr) h += '<p class="q-muted">' + esc(bi(q.tr)) + '</p>';
    if (q.passage) h += '<details class="q-tr"><summary>' + t('全文翻译', 'Translation of the text') + '</summary><p>' + esc(bi(D.passages[q.passage].tr)) + '</p></details>';
    h += '<p class="q-refs">' + (q.refs || []).map(function (r) {
      var p = D.refs[r];
      return '📖 <a href="' + LESSON_BASE + p.lesson + '/#' + encodeURI(p.slug) + '" target="_blank" rel="noopener">' + esc(EN ? p.en : p.zh) + '</a>';
    }).join(' · ') + '</p>';
    if (!aiFirst) h += aiBtn(false);
    h += '<details class="q-report"><summary>' + t('这题有问题？', 'Something wrong with this question?') + '</summary>' +
      [['answer', '答案不对', 'The answer is wrong'], ['two', '有两个对的', 'Two options work'], ['stem', '题目不通顺', 'The question reads badly'], ['other', '其他', 'Something else']]
        .map(function (r) { return '<button class="q-btn" data-act="report" data-k="' + r[0] + '">' + t(r[1], r[2]) + '</button>'; }).join(' ') +
      '<div class="q-report-more" hidden><textarea maxlength="1000" rows="3" placeholder="' + t('哪里不对？可以不写', 'What’s wrong? (optional)') + '"></textarea>' +
      '<button class="q-btn q-btn-primary" data-act="report-send">' + t('提交', 'Send') + '</button></div></details></div>';
    var left = curs ? Object.keys(curs).filter(function (id) { return !curs[id].done; }) : [];
    if (!left.length) h += '<div class="q-next"><button class="q-btn q-btn-primary q-btn-big" data-act="next">' + (S.session.i >= S.session.ids.length ? t('看结果', 'See results') : t('下一题', 'Next')) + ' →</button></div>';
    root().querySelector('.q-feedback').innerHTML = h;
    if (left.length) cur = curs[left[0]];   // the keyboard moves on to the next question of the passage
  }

  function summary() {
    view(false);
    var s = S.session, res = s.res;
    var ok = res.filter(function (r) { return r.ok; }).length;
    var mins = Math.round(res.reduce(function (a, r) { return a + r.ms; }, 0) / 60000);
    var bad = res.filter(function (r) { return !r.ok || r.g; });
    track('quiz_finish', { kind: s.kind, score: ok, size: res.length, level: LEVEL });
    var h = '<div class="q-top"><button class="q-link" data-act="home">‹ ' + t('返回', 'Back') + '</button></div>' +
      '<div class="q-card q-summary"><p class="q-score">' + ok + ' / ' + res.length + '</p><p class="q-muted">' + t('用时约 ', 'About ') + Math.max(mins, 1) + t(' 分钟', ' min') + '</p>';
    if (bad.length) {
      h += '<h2>' + t('错题和蒙的', 'Missed or guessed') + '</h2><ul class="q-sumlist">' + bad.map(function (r) {
        var q = Q[r.id];
        var label = q.type === 'bunshou' ? '<span class="q-pblank">' + q.blank + '</span> ' + D.passages[q.passage].html.split('\n')[0].slice(0, 60) + '…' : stemHtml(q).replace(/<button[^>]*>(★)?<\/button>/g, function (m, st) { return st ? '★' : '＿'; });
        return '<li><div lang="ja" class="q-sumstem">' + label + '</div>' +
          '<div class="q-muted">' + (r.ok ? t('蒙对', 'Guessed right') : r.c == null ? t('不会', 'Didn’t know') : t('你选 ', 'You: ') + '<span lang="ja">' + q.options[r.c] + '</span>') + ' · ' + t('答案 ', 'Answer: ') + '<span lang="ja">' + q.options[q.answer] + '</span></div></li>';
      }).join('') + '</ul>';
      // The grammar point missed most often.
      var cnt = {}; bad.forEach(function (r) { var ref = (Q[r.id].refs || [])[0]; if (ref) cnt[ref] = (cnt[ref] || 0) + 1; });
      var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0], p = top && D.refs[top];
      if (p) h += '<p>📖 ' + t('去复习：', 'Go over: ') + '<a href="' + LESSON_BASE + p.lesson + '/#' + encodeURI(p.slug) + '">' + esc(EN ? p.en : p.zh) + '</a></p>';
    } else {
      h += '<p>' + t('全对！', 'All correct!') + '</p>';
    }
    h += '<div class="q-actions">' + (bad.length ? '<button class="q-btn" data-act="retry">' + t('重做错题', 'Redo the misses') + '</button>' : '') +
      '<button class="q-btn q-btn-primary" data-act="again">' + t('再来一组', 'Another set') + '</button></div></div>';
    S.session = null; save();
    app._last = { kind: s.kind, label: s.label, bad: bad.map(function (r) { return r.id; }) };
    app.innerHTML = h;
  }

  function startKind(kind, k) {
    var n = S.prefs.size || 10;
    if (kind === 'daily') start('daily', daily(n));
    else if (kind === 'type') start('type', subset(function (q) { return q.type === k; }, n), k);
    else if (kind === 'lesson') start('lesson', subset(function (q) { return lessonOf(q) === k; }, n), k);
    else if (kind === 'ref') start('ref', subset(function (q) { return (q.refs || []).indexOf(k) >= 0; }, n), k);
    else if (kind === 'review') {
      var list = due();
      if (!list.length) list = inReview().sort(function (a, b) { return S.review[a.id].due - S.review[b.id].due; });
      start('review', arrange(list.slice(0, n)));
    }
  }


  // ─── Mock tests (/n5-mock-test/) ───
  // A set is one or two sittings (sections) with their own time limits, no
  // feedback until the end; then an estimated score, a breakdown and a review.
  // Spec: docs/quiz-mock-spec.md. State: S.mock[setId] = { current, attempts }.
  var SETS = MOCK ? JSON.parse(app.getAttribute('data-sets')) : [];
  var M = null;        // { set, test, mode, secs: [section index…], si, qi, timer }
  var AWAY_GRACE = 60000;   // longer in the background than this pauses the clock and marks the attempt informal
  function mstate(id) { return S.mock[id] || (S.mock[id] = { current: null, attempts: [] }); }
  function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function loadTest(set) {
    return fetch(set.src).then(function (r) { return r.json(); }).then(function (test) {
      D = test; Q = {}; test.questions.forEach(function (q) { Q[q.id] = q; }); return test;
    });
  }
  function secIds(sec) { return [].concat.apply([], sec.problems.map(function (p) { return p.ids; })); }
  function problemOf(sec, id) { for (var i = 0; i < sec.problems.length; i++) if (sec.problems[i].ids.indexOf(id) >= 0) return sec.problems[i]; }

  function mockList() {
    view(true);
    stopTimer();
    var h = '';
    SETS.forEach(function (set) {
      var st = mstate(set.id), cur = st.current, att = st.attempts;
      var best = att.filter(function (a) { return a.mode === 'full' && !a.flags.length; }).sort(function (a, b) { return b.total - a.total; })[0];
      var last = att[att.length - 1];
      h += '<div class="q-card q-set"><h2>' + t('第 ' + set.n + ' 套', 'Test ' + set.n) + (cur ? ' <small class="q-tag">' + t('进行中', 'In progress') + '</small>' : !att.length ? ' <small class="q-tag q-tag-new">' + t('未做', 'Not taken') + '</small>' : '') + '</h2>';
      if (best) h += '<p>' + t('最好成绩 ', 'Best: ') + best.score.map(function (x) { return x.score + '/' + x.max; }).join(' · ') + t('（估算）', ' (estimate)') + '</p>';
      if (last) h += '<p class="q-muted">' + t('上次 ', 'Last: ') + new Date(last.end).toLocaleDateString() + ' · ' + Math.round(last.used / 60000) + t(' 分钟', ' min') + (last.flags.length ? ' · ' + last.flags.map(flagName).join('、') : '') + '</p>';
      h += '<div class="q-actions">';
      if (cur) h += '<button class="q-btn q-btn-primary" data-act="m-resume" data-k="' + set.id + '">' + t('继续', 'Continue') + '</button><button class="q-btn" data-act="m-drop" data-k="' + set.id + '">' + t('放弃这次', 'Discard') + '</button>';
      else h += '<button class="q-btn q-btn-primary" data-act="m-intro" data-k="' + set.id + '">' + (att.length ? t('再做一次', 'Take again') : t('开始', 'Start')) + '</button>';
      if (last) h += '<button class="q-btn" data-act="m-result" data-k="' + set.id + '">' + t('看上次结果', 'Last result') + '</button>';
      h += '</div></div>';
    });
    app.innerHTML = h;
  }
  function flagName(f) { return { informal: t('非正式（暂停过）', 'informal (paused)'), partial: t('只做了一节', 'one section only'), retake: t('重做', 'retake') }[f] || f; }
  function setById(id) { return SETS.filter(function (s) { return s.id === id; })[0]; }

  function mockIntro(set) {
    view(false);
    loadTest(set).then(function (test) {
      var h = '<div class="q-top"><button class="q-link" data-act="m-list">‹ ' + t('返回', 'Back') + '</button></div><div class="q-card"><h2>' + t('第 ' + set.n + ' 套', 'Test ' + set.n) + '</h2><table class="q-table q-plan">';
      test.sections.forEach(function (sec, i) {
        h += '<tr><th>' + esc(sec.ja) + '<br><small>' + esc(bi(sec)) + '</small></th><td>' + secIds(sec).length + t(' 题', ' questions') + '</td><td>' + sec.minutes + t(' 分钟', ' min') + '</td></tr>';
      });
      h += '</table><ul class="q-rules"><li>' + t('作答中不显示对错和解析，交卷后统一看。', 'No answers or explanations until you submit.') + '</li>' +
        '<li>' + t('可以前后翻题、改答案；拿不准的题点 ⚑ 标记，最后回来看。', 'Move back and forth and change answers; flag ⚑ anything to come back to.') + '</li>' +
        '<li>' + t('每节时间到自动结束。不会的题先蒙一个——空着也算错。', 'Each section ends when its time is up. Guess rather than leave a blank — blanks count as wrong.') + '</li>' +
        '<li>' + t('可以暂停；切到别的 App 超过 1 分钟会自动暂停。暂停过的成绩标为“非正式”。', 'You can pause; leaving the page for over a minute pauses it too. A paused attempt is marked informal.') + '</li></ul>' +
        '<div class="q-actions q-start"><button class="q-btn q-btn-primary q-btn-big" data-act="m-start" data-k="full">' + t('整套开始', 'Start the full test') + '</button>' +
        test.sections.map(function (sec, i) { return '<button class="q-btn" data-act="m-start" data-k="' + i + '">' + t('只做：', 'Only: ') + esc(sec.ja) + '</button>'; }).join('') + '</div></div>';
      M = { set: set, test: test };
      app.innerHTML = h;
    }).catch(loadFail);
  }

  function mockStart(mode) {
    var st = mstate(M.set.id);
    st.current = { mode: mode, secs: mode === 'full' ? M.test.sections.map(function (_, i) { return i; }) : [+mode], si: 0, start: Date.now(), secStart: Date.now(), pausedMs: 0, used: [], answers: {}, flagsQ: {}, informal: false, at: 0, retake: st.attempts.length > 0 };
    save();
    track('mock_start', { set: M.set.id, mode: mode });
    mockSection();
  }
  function cur2() { return mstate(M.set.id).current; }
  function curSec() { var c = cur2(); return M.test.sections[c.secs[c.si]]; }
  function remaining() { var c = cur2(), sec = curSec(); return sec.minutes * 60000 - (Date.now() - c.secStart - c.pausedMs) + (c.pauseAt ? Date.now() - c.pauseAt : 0); }
  function stopTimer() { if (M && M.timer) { clearInterval(M.timer); M.timer = null; } }
  function tick() {
    var c = cur2(); if (!c) return stopTimer();
    if (c.pauseAt) return;
    var left = remaining(), el = app.querySelector('.q-clock');
    if (el) { el.textContent = fmt(left); el.classList.toggle('q-clock-low', left < 5 * 60000); }
    if (left <= 0) endSection(true);
  }

  function mockSection() {
    view(false);
    var c = cur2(), sec = curSec(), ids = secIds(sec);
    if (c.at >= ids.length) c.at = 0;
    var id = ids[c.at], q = Q[id], prob = problemOf(sec, id), a = c.answers[id] || {};
    cur = { q: q, start: Date.now(), picked: a.p ? a.p.slice() : [null, null, null, null], guess: !!a.g, done: false, mock: true };
    curs = null;
    // A passage's questions share the screen: [g0, g1] is the run with the same passage.
    var g0 = c.at, g1 = c.at;
    if (q.passage) { while (g0 > 0 && Q[ids[g0 - 1]].passage === q.passage) g0--; while (g1 < ids.length - 1 && Q[ids[g1 + 1]].passage === q.passage) g1++; }
    var answered = ids.filter(function (x) { return c.answers[x] && c.answers[x].c != null; }).length;
    var h = '<div class="q-mockbar"><span class="q-clock">' + fmt(remaining()) + '</span><span>' + esc(sec.ja) + '</span><span class="q-muted q-answered">' + answered + '/' + ids.length + '</span>' +
      '<button class="q-btn" data-act="m-sheet">' + t('答题卡', 'Answer sheet') + '</button><button class="q-btn" data-act="m-pause">' + t('暂停', 'Pause') + '</button></div>';
    h += '<div class="q-sheet" hidden>' + sec.problems.map(function (p) {
      return '<div class="q-sheet-row"><span>' + t('问题', 'もんだい') + p.no + '</span>' + p.ids.map(function (x) {
        var k = ids.indexOf(x), aa = c.answers[x];
        return '<button class="q-cell' + (aa && aa.c != null ? ' q-cell-done' : '') + (c.flagsQ[x] ? ' q-cell-flag' : '') + (x === id ? ' q-cell-on' : '') + '" data-act="m-go" data-k="' + k + '">' + (k + 1) + '</button>';
      }).join('') + '</div>';
    }).join('') + '<button class="q-btn q-btn-primary" data-act="m-end">' + (c.si < c.secs.length - 1 ? t('结束本节，进入下一节', 'End this section') : t('交卷', 'Submit')) + '</button></div>';
    h += '<div class="q-card"><p class="q-prob"><b>' + t('问题 ', 'もんだい') + prob.no + '</b> ' + esc(D.types[prob.type].ja) + ' <small class="q-muted">' + esc(bi(D.types[prob.type])) + '</small><span class="q-qno">' + (c.at + 1) + '</span></p>' +
      passageHtml(g1 > g0 ? { passage: q.passage, blank: null } : q) + (g1 > g0 ? '' : '<div class="q-stem" lang="ja">' + stemHtml(q) + '</div>');
    if (g1 > g0) {
      for (var gi = g0; gi <= g1; gi++) {
        var gq = Q[ids[gi]], ga = c.answers[gq.id] || {};
        h += '<div class="q-sub" data-q="' + gq.id + '"><p class="q-subno">' + (gi + 1) + '</p><div class="q-stem" lang="ja">' + stemHtml(gq) + '</div>' +
          '<ol class="q-opts" lang="ja">' + gq.options.map(function (o, i) { return '<li><button class="q-opt' + (ga.c === i ? ' q-picked' : '') + '" data-act="m-opt" data-i="' + i + '"><span class="q-num">' + (i + 1) + '</span>' + o + '</button></li>'; }).join('') + '</ol>' +
          '<div class="q-actions"><label class="q-guess"><input type="checkbox" data-act="m-guess"' + (ga.g ? ' checked' : '') + '> ' + t('蒙的', 'Guessing') + '</label>' +
          '<button class="q-btn' + (c.flagsQ[gq.id] ? ' q-flagged' : '') + '" data-act="m-flag">⚑ ' + t('标记', 'Flag') + '</button></div></div>';
      }
    } else {
      if (q.type === 'narabe') {
        h += '<p class="q-muted q-hint">' + t('按顺序点选项填进空格，点空格可以撤回。', 'Tap the pieces in order; tap a blank to undo.') + '</p><div class="q-pieces" lang="ja">' +
          q.options.map(function (o, i) { return '<button class="q-piece" data-act="m-piece" data-i="' + i + '">' + o + '</button>'; }).join('') + '</div>';
      } else {
        h += '<ol class="q-opts" lang="ja">' + q.options.map(function (o, i) { return '<li><button class="q-opt' + (a.c === i ? ' q-picked' : '') + '" data-act="m-opt" data-i="' + i + '"><span class="q-num">' + (i + 1) + '</span>' + o + '</button></li>'; }).join('') + '</ol>';
      }
      h += '<div class="q-actions"><label class="q-guess"><input type="checkbox" data-act="m-guess"' + (a.g ? ' checked' : '') + '> ' + t('蒙的', 'Guessing') + '</label>' +
        '<button class="q-btn' + (c.flagsQ[id] ? ' q-flagged' : '') + '" data-act="m-flag">⚑ ' + t('标记', 'Flag') + '</button></div>';
    }
    h += '<div class="q-actions q-nav"><button class="q-btn" data-act="m-go" data-k="' + (g0 - 1) + '"' + (g0 ? '' : ' disabled') + '>← ' + t('上一题', 'Prev') + '</button>' +
      (g1 < ids.length - 1 ? '<button class="q-btn q-btn-primary" data-act="m-go" data-k="' + (g1 + 1) + '">' + t('下一题', 'Next') + ' →</button>' : '<button class="q-btn q-btn-primary" data-act="m-sheet">' + t('检查答题卡', 'Review answer sheet') + '</button>') + '</div></div>';
    app.innerHTML = h;
    if (g1 > g0) {
      curs = {};
      for (var gk = g0; gk <= g1; gk++) { var gid = ids[gk], gaa = c.answers[gid] || {}; curs[gid] = { q: Q[gid], start: Date.now(), picked: [null, null, null, null], guess: !!gaa.g, done: false, mock: true, root: app.querySelector('.q-sub[data-q="' + gid + '"]') }; }
      cur = curs[id];
    }
    if (q.type === 'narabe') fillSlots();
    if (!M.timer) M.timer = setInterval(tick, 1000);
    window.scrollTo(0, app.offsetTop - 16);
  }
  function mockAnswer(choice) {
    var c = cur2(), id = cur.q.id, a = c.answers[id] || (c.answers[id] = {});
    a.c = choice; a.g = cur.guess; a.ms = (a.ms || 0) + (Date.now() - cur.start); cur.start = Date.now();
    if (cur.q.type === 'narabe') a.p = cur.picked.slice();
    save();
    markSheet();
  }
  // Answered count and answer-sheet cells, after any change to an answer.
  function markSheet() {
    var c = cur2(), ids = secIds(curSec());
    var n = ids.filter(function (x) { return c.answers[x] && c.answers[x].c != null; }).length;
    var el = app.querySelector('.q-answered'); if (el) el.textContent = n + '/' + ids.length;
    app.querySelectorAll('.q-cell').forEach(function (cell) {
      var x = ids[+cell.getAttribute('data-k')], a = c.answers[x];
      cell.classList.toggle('q-cell-done', !!(a && a.c != null));
      cell.classList.toggle('q-cell-flag', !!c.flagsQ[x]);
    });
  }
  function endSection(timeUp) {
    var c = cur2(), ids = secIds(curSec());
    if (!timeUp) {
      var open = ids.filter(function (x) { return !c.answers[x] || c.answers[x].c == null; }).length;
      var flagged = ids.filter(function (x) { return c.flagsQ[x]; }).length;
      if ((open || flagged) && !window.confirm(t('还有 ' + open + ' 题没答、' + flagged + ' 题标记了。确定结束这一节？', open + ' unanswered, ' + flagged + ' flagged. End this section anyway?'))) return;
    }
    c.used[c.si] = Math.min(curSec().minutes * 60000, Date.now() - c.secStart - c.pausedMs);
    stopTimer();
    if (c.si < c.secs.length - 1) {
      c.si++; c.at = 0; c.pausedMs = 0; c.secStart = null; save();
      app.innerHTML = '<div class="q-card q-break"><h2>' + (timeUp ? t('时间到。', 'Time’s up. ') : '') + t('第一节结束', 'Section done') + '</h2><p>' + t('休息一下。下一节：', 'Take a break. Next: ') + esc(curSec().ja) + '（' + curSec().minutes + t(' 分钟', ' min') + '）</p><button class="q-btn q-btn-primary q-btn-big" data-act="m-next">' + t('开始下一节', 'Start the next section') + '</button></div>';
    } else submitMock();
  }
  function submitMock() {
    var st = mstate(M.set.id), c = st.current;
    app.innerHTML = '<p class="q-muted">' + t('判分中…', 'Scoring…') + '</p>';
    fetch(M.set.key).then(function (r) { return r.json(); }).then(function (key) {
      var att = { mode: c.mode, start: c.start, end: Date.now(), used: c.used.reduce(function (x, y) { return x + y; }, 0), usedBy: c.used, answers: c.answers, flags: [] };
      if (c.informal) att.flags.push('informal');
      if (c.mode !== 'full') att.flags.push('partial');
      if (c.retake) att.flags.push('retake');
      scoreAttempt(att, key);
      st.attempts.push(att); st.current = null; save();
      track('mock_submit', { set: M.set.id, mode: c.mode, score: att.score.map(function (x) { return x.score; }).join('/'), minutes: Math.round(att.used / 60000), flags: att.flags.join(',') });
      mockResult(M.set, att, key);
    }).catch(loadFail);
  }
  // Each scored part = share of its questions right × its maximum. The real
  // test is equated (IRT), so this is only an estimate.
  function scoreAttempt(att, key) {
    var right = 0, all = 0;
    var c = mstate(M.set.id).current || { secs: att.mode === 'full' ? M.test.sections.map(function (_, i) { return i; }) : [+att.mode] };
    var taken = [];
    c.secs.forEach(function (i) { taken = taken.concat(secIds(M.test.sections[i])); });
    // Each scored part is a set of question types (N3/N2 split language
    // knowledge and reading across the sittings); only sittings taken count.
    att.score = M.test.scoring.map(function (p) {
      var ids = taken.filter(function (id) { return p.types.indexOf(Q[id].type) >= 0; });
      var ok = ids.filter(function (id) { var a = att.answers[id]; return a && a.c === key.questions[id].answer; }).length;
      right += ok; all += ids.length;
      return { key: p.key, ok: ok, n: ids.length, score: ids.length ? Math.round(ok / ids.length * p.max) : 0, max: p.max, min: p.min };
    });
    att.total = right; att.n = all;
  }

  function mockResult(set, att, key) {
    view(false);
    var go = function (test) {
      var h = '<div class="q-top"><button class="q-link" data-act="m-list">‹ ' + t('返回', 'Back') + '</button></div><div class="q-card q-result">';
      h += '<h2>' + t('第 ' + set.n + ' 套 · 结果', 'Test ' + set.n + ' · results') + (att.flags.length ? ' <small class="q-tag">' + att.flags.map(flagName).join('、') + '</small>' : '') + '</h2>';
      var sum = 0;
      att.score.forEach(function (x) {
        var p = test.scoring.filter(function (s) { return s.key === x.key; })[0];
        sum += x.score;
        h += '<div class="q-scoreline"><span>' + esc(p.ja) + '<br><small class="q-muted">' + esc(bi(p)) + '</small></span><b>' + x.score + '<small>/' + x.max + '</small></b>' +
          (att.mode === 'full' ? '<span class="' + (x.score >= x.min ? 'q-v-ok' : 'q-v-bad') + '">' + (x.score >= x.min ? '✓ ' + t('过了 ' + x.min + ' 分单科线', 'above the ' + x.min + ' minimum') : '✗ ' + t('差 ' + (x.min - x.score) + ' 分到单科线 ' + x.min, (x.min - x.score) + ' short of the ' + x.min + ' minimum')) + '</span>' : '<span class="q-muted">' + x.ok + '/' + x.n + t(' 题', ' right') + '</span>') + '</div>';
      });
      if (att.mode === 'full') {
        var L = test.listening, need = Math.max(L.min, test.pass - sum);
        h += '<p class="q-listen">' + t('聴解未测（听力题还在规划中）。', 'Listening isn’t included (listening questions are planned). ') + (need > L.max ? t('按这个分数，聴解满分也达不到总分线 ' + test.pass + '。', 'At this score even full marks in listening wouldn’t reach the ' + test.pass + ' pass mark.') :
          t('要合格，聴解需要 ≥ ' + need + ' / ' + L.max + ' 分（总分线 ' + test.pass + '，聴解单科线 ' + L.min + '）。', 'To pass you’d need ≥ ' + need + ' / ' + L.max + ' in listening (pass mark ' + test.pass + ', listening minimum ' + L.min + ').')) + '</p>';
      }
      h += '<p class="q-muted q-small">' + t('估算：按答对比例换算。真考是等化计分，实际分数会有出入。', 'Estimate: share of questions right, scaled. The real test is equated, so your actual score will differ.') + '</p>';
      // By もんだい
      h += '<h3>' + t('各题型', 'By question type') + '</h3><table class="q-table q-bytype"><tr><th></th><th>' + t('题型', 'Type') + '</th><th>' + t('对', 'Right') + '</th><th>' + t('蒙对', 'Guessed') + '</th><th></th></tr>';
      test.sections.forEach(function (sec, si) {
        if (att.usedBy && att.mode !== 'full' && +att.mode !== si) return;
        sec.problems.forEach(function (p) {
          var ok = 0, g = 0;
          p.ids.forEach(function (id) { var a = att.answers[id]; if (a && a.c === key.questions[id].answer) { ok++; if (a.g) g++; } });
          var low = ok / p.ids.length < 0.5;
          h += '<tr' + (low ? ' class="q-low"' : '') + '><td>' + (si + 1) + '-' + p.no + '</td><td>' + esc(test.types[p.type].ja) + '<br><small class="q-muted">' + esc(bi(test.types[p.type])) + '</small></td><td>' + ok + '/' + p.ids.length + '</td><td>' + (g || '') + '</td>' +
            '<td><a href="' + LESSON_BASE + LEVEL.toLowerCase() + '-practice/#type=' + p.type + '" title="' + t('练这个题型', 'Practice this type') + '">✍ ' + t('练', 'Practice') + '</a></td></tr>';
        });
      });
      h += '</table>';
      // Time
      h += '<h3>' + t('时间', 'Time') + '</h3><ul class="q-time">';
      var secs = att.mode === 'full' ? test.sections.map(function (_, i) { return i; }) : [+att.mode];
      secs.forEach(function (si, k) {
        var sec = test.sections[si], used = (att.usedBy || [])[k] || 0;
        h += '<li>' + esc(sec.ja) + '：' + Math.round(used / 60000) + ' / ' + sec.minutes + t(' 分钟', ' min') + (used >= sec.minutes * 60000 - 1000 ? ' · ' + t('用满了', 'used it all') : '') + '</li>';
      });
      h += '</ul>';
      var slow = Object.keys(att.answers).sort(function (a, b) { return (att.answers[b].ms || 0) - (att.answers[a].ms || 0); }).slice(0, 3);
      if (slow.length) h += '<p class="q-muted">' + t('用时最长：', 'Slowest: ') + slow.map(function (id) { return id.split('-').pop() + '（' + Math.round((att.answers[id].ms || 0) / 1000) + 's）'; }).join('、') + '</p>';
      h += '<div class="q-actions"><button class="q-btn q-btn-primary" data-act="m-review" data-k="wrong">' + t('复盘错题和蒙的题', 'Review misses and guesses') + '</button><button class="q-btn" data-act="m-review" data-k="all">' + t('全部题目', 'All questions') + '</button></div></div>';
      M = { set: set, test: test, att: att, key: key };
      app.innerHTML = h;
    };
    if (M && M.test && M.set === set) go(M.test); else loadTest(set).then(go).catch(loadFail);
  }
  function lastResult(set) {
    var att = mstate(set.id).attempts.slice(-1)[0];
    loadTest(set).then(function (test) {
      M = { set: set, test: test };
      return fetch(set.key).then(function (r) { return r.json(); }).then(function (key) { mockResult(set, att, key); });
    }).catch(loadFail);
  }

  function mockReview(which) {
    view(false);
    var test = M.test, key = M.key, att = M.att, h = '<div class="q-top"><button class="q-link" data-act="m-back-result">‹ ' + t('回到结果', 'Back to results') + '</button></div>';
    var shownP = {};
    test.sections.forEach(function (sec, si) {
      if (att.mode !== 'full' && +att.mode !== si) return;
      sec.problems.forEach(function (p) {
        p.ids.forEach(function (id, k) {
          var q = Q[id], kq = key.questions[id], a = att.answers[id] || {}, ok = a.c === kq.answer;
          if (which === 'wrong' && ok && !a.g) return;
          var qq = {}; for (var x in q) qq[x] = q[x]; for (var y in kq) qq[y] = kq[y];
          h += '<div class="q-card q-revcard">';
          if (q.passage && !shownP[q.passage]) { shownP[q.passage] = 1; h += '<details class="q-revpass"><summary>' + t('原文', 'Text') + '</summary>' + passageHtml(qq) + '<p class="q-muted">' + esc(bi(key.passages[q.passage].tr)) + '</p></details>'; }
          h += '<p class="q-prob"><b>' + (si + 1) + '-' + p.no + '</b> ' + esc(test.types[p.type].ja) + '</p><div class="q-stem" lang="ja">' + stemHtml(qq).replace(/<button[^>]*>(★)?<\/button>/g, function (m, st) { return st ? '＿★＿' : '＿＿'; }) + '</div>';
          if (q.type === 'narabe') h += '<p lang="ja">' + t('正确顺序：', 'Order: ') + kq.order.map(function (i) { return q.options[i]; }).join(' / ') + '</p>';
          h += '<ol class="q-opts" lang="ja">' + q.options.map(function (o, i) { return '<li><div class="q-opt' + (i === kq.answer ? ' q-ok' : i === a.c ? ' q-bad' : '') + '"><span class="q-num">' + (i + 1) + '</span>' + o + okjOf(qq, i) + '</div></li>'; }).join('') + '</ol>';
          h += '<p class="q-verdict ' + (ok ? 'q-v-ok' : 'q-v-bad') + '">' + (a.c == null ? t('没答', 'Not answered') : ok ? (a.g ? t('✓ 蒙对了', '✓ Guessed right') : '✓ ' + t('正确', 'Correct')) : '✗ ' + t('你选了 ', 'You chose ') + (a.c + 1)) + '</p>';
          h += '<div class="q-explain"><p>' + esc(bi(kq.why)) + '</p>' + (q.type !== 'narabe' ? '<ul class="q-wrong">' + kq.wrong.map(function (w, i) { return w ? '<li' + (i === a.c ? ' class="q-mine"' : '') + '><b lang="ja">' + (i + 1) + ' ' + q.options[i] + okjOf(qq, i) + '</b> — ' + esc(bi(w)) + '</li>' : ''; }).join('') + '</ul>' : '') +
            kjHtml(qq, key.passages) + (kq.tr ? '<p class="q-muted">' + esc(bi(kq.tr)) + '</p>' : '') + '</div>' +
            (window.jpAI ? '<p class="q-ai"><button class="q-btn" data-act="m-ai" data-k="' + id + '">🤖 ' + t('AI 讲解', 'Explain with AI') + '</button></p>' : '') + '</div>';
        });
      });
    });
    app.innerHTML = h;
    window.scrollTo(0, app.offsetTop - 16);
  }

  function pause(auto, awayMs) {
    var c = cur2(); if (!c || c.pauseAt || !c.secStart) return;
    c.pauseAt = Date.now() - (awayMs || 0); save();
    var overlay = document.createElement('div');
    overlay.className = 'q-paused';
    overlay.innerHTML = '<div class="q-card"><h2>' + t('已暂停', 'Paused') + '</h2><p>' + (auto ? t('离开页面超过 1 分钟，计时已暂停。', 'You were away for over a minute, so the clock stopped.') : '') + t('这次成绩会标为“非正式”。', 'This attempt will be marked informal.') + '</p><button class="q-btn q-btn-primary q-btn-big" data-act="m-unpause">' + t('继续', 'Resume') + '</button></div>';
    app.appendChild(overlay);
  }
  function unpause() {
    var c = cur2(); if (!c || !c.pauseAt) return;
    c.pausedMs += Date.now() - c.pauseAt; c.pauseAt = null; c.informal = true; save();
    var o = app.querySelector('.q-paused'); if (o) o.remove();
    tick();
  }
  var hiddenAt = null;
  document.addEventListener('visibilitychange', function () {
    if (!MOCK || !M || !cur2() || !cur2().secStart) return;
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt) { var away = Date.now() - hiddenAt; hiddenAt = null; if (away > AWAY_GRACE && !cur2().pauseAt) pause(true, away); else tick(); }
  });

  if (MOCK) app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var act = el.getAttribute('data-act'), k = el.getAttribute('data-k');
    var sub = curs && el.closest('.q-sub');
    if (sub && curs[sub.getAttribute('data-q')]) cur = curs[sub.getAttribute('data-q')];
    if (act === 'm-list') mockList();
    else if (act === 'm-intro') mockIntro(setById(k));
    else if (act === 'm-start') mockStart(k);
    else if (act === 'm-resume') { var set = setById(k); loadTest(set).then(function (test) { M = { set: set, test: test }; var c = cur2(); if (!c.secStart) { c.secStart = Date.now(); save(); } if (c.pauseAt) { mockSection(); pause(false); } else mockSection(); }).catch(loadFail); }
    else if (act === 'm-drop') { if (window.confirm(t('放弃这次作答？', 'Discard this attempt?'))) { mstate(k).current = null; save(); mockList(); } }
    else if (act === 'm-result') lastResult(setById(k));
    else if (act === 'm-sheet') { var sh = app.querySelector('.q-sheet'); sh.hidden = !sh.hidden; if (!sh.hidden) sh.scrollIntoView({ block: 'nearest' }); }
    else if (act === 'm-go') { cur2().at = +k; save(); mockSection(); }
    else if (act === 'm-opt') { mockAnswer(+el.getAttribute('data-i')); root().querySelectorAll('.q-opt').forEach(function (b, i) { b.classList.toggle('q-picked', i === +el.getAttribute('data-i')); }); }
    else if (act === 'm-piece') { var i = cur.picked.indexOf(null); if (i >= 0) { cur.picked[i] = +el.getAttribute('data-i'); fillSlots(); if (cur.picked.indexOf(null) < 0) { var star = [].indexOf.call(app.querySelectorAll('.q-slot'), app.querySelector('.q-star')); mockAnswer(cur.picked[star]); } } }
    else if (act === 'm-slot') { cur.picked[+el.getAttribute('data-k')] = null; fillSlots(); var a = cur2().answers[cur.q.id]; if (a) { a.c = null; a.p = cur.picked.slice(); save(); markSheet(); } }
    else if (act === 'm-flag') { var c = cur2(); c.flagsQ[cur.q.id] = !c.flagsQ[cur.q.id]; save(); el.classList.toggle('q-flagged'); markSheet(); }
    else if (act === 'm-end') endSection(false);
    else if (act === 'm-next') { var c2 = cur2(); c2.secStart = Date.now(); save(); mockSection(); }
    else if (act === 'm-pause') pause(false);
    else if (act === 'm-unpause') unpause();
    else if (act === 'm-review') mockReview(k);
    else if (act === 'm-ai') {
      var mq = {}, a2 = M.att.answers[k] || {}, P2 = {};
      for (var x in Q[k]) mq[x] = Q[k][x]; for (var y in M.key.questions[k]) mq[y] = M.key.questions[k][y];
      if (mq.passage) { P2[mq.passage] = D.passages[mq.passage]; }
      aiExplain(mq, a2.c == null ? null : a2.c, a2.g, M.test.types[mq.type].ja, P2);
    }
    else if (act === 'm-back-result') mockResult(M.set, M.att, M.key);
  });
  if (MOCK) app.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-act') !== 'm-guess') return;
    var sub = curs && e.target.closest('.q-sub');
    if (sub && curs[sub.getAttribute('data-q')]) cur = curs[sub.getAttribute('data-q')];
    cur.guess = e.target.checked;
    var a = cur2().answers[cur.q.id];
    if (a) { a.g = cur.guess; save(); }
  });


  // ─── Flashcards (/n5-cards/) ───
  // One grammar point (data from build-anki.js) gives up to two cards, each
  // switchable in settings:
  //   recognition (key = id)    the pattern → meaning, rules, examples
  //   fill-in     (key = id|c)  an example with its grammar blanked and the
  //                             translation as the hint → the full sentence
  // Scheduled like Anki: new cards go through two short learning steps, then
  // review intervals grow by the card's ease. State: S.cards[key] = { s:
  // 'learn' | 'review', step, due (ms), ivl (days), ease, lapses };
  // S.cardDays[date] = { n: new cards started, r: reviews }.
  var CARD_STEPS = [60e3, 10 * 60e3];    // learning steps: 1 min, 10 min
  var MIN_EASE = 1.3, DAY_MS = 86400e3;
  var C = [], cq = null;                  // all grammar points; the card on screen { key, c, kind, ex }
  function cardsLoad() {
    fetch(app.getAttribute('data-src')).then(function (r) { return r.json(); }).then(function (d) { C = d; cardsHome(); }).catch(loadFail);
  }
  function cday() { return S.cardDays[today()] || (S.cardDays[today()] = { n: 0, r: 0 }); }
  function newLimit() { return S.prefs.newCards || 10; }
  function cardKinds() { var k = S.prefs.cardKinds || { r: true, c: false }; return (k.r || k.c) ? k : { r: true, c: false }; }
  // Every enabled card, recognition before fill-in for the same point.
  function units() {
    var k = cardKinds(), out = [];
    C.forEach(function (c) {
      if (k.r) out.push({ key: c.id, c: c, kind: 'r' });
      if (k.c && c.cloze && c.cloze.length) out.push({ key: c.id + '|c', c: c, kind: 'c' });
    });
    return out;
  }
  function cardQueue() {
    var n = Date.now(), all = units();
    var due = all.filter(function (u) { var x = S.cards[u.key]; return x && x.due <= n; }).sort(function (a, b) { return S.cards[a.key].due - S.cards[b.key].due; });
    var fresh = all.filter(function (u) { return !S.cards[u.key]; }).slice(0, Math.max(0, newLimit() - cday().n));
    return { all: all, due: due, fresh: fresh, learning: all.filter(function (u) { var x = S.cards[u.key]; return x && x.s === 'learn'; }) };
  }
  function cardsHome() {
    view(true);
    var q = cardQueue(), k = cardKinds();
    var seen = q.all.filter(function (u) { return S.cards[u.key]; }).length;
    var mature = q.all.filter(function (u) { var x = S.cards[u.key]; return x && x.s === 'review' && x.ivl >= 21; }).length;
    var nextDue = q.all.map(function (u) { return S.cards[u.key] && S.cards[u.key].due; }).filter(function (x) { return x && x > Date.now(); }).sort()[0];
    var h = '<div class="q-today"><div class="q-cardstats"><span><b>' + q.fresh.length + '</b>' + t('新卡', 'new') + '</span><span><b>' + q.due.length + '</b>' + t('待复习', 'due') + '</span></div>' +
      ((q.fresh.length || q.due.length) ? '<button class="q-btn q-btn-primary q-btn-big" data-act="c-start">' + t('开始背', 'Study now') + '</button>' :
        '<p class="q-done">' + t('今天背完了 🎉', 'All done for today 🎉') + (nextDue ? ' ' + t('下一张：', 'Next card: ') + new Date(nextDue).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') + '</p>') +
      '<p class="q-muted">' + t('已学 ', 'Learned ') + seen + ' / ' + q.all.length + t(' 张 · 熟记 ', ' cards · mature ') + mature + t('（间隔 ≥ 21 天）', ' (interval ≥ 21 days)') + '</p></div>';
    h += '<details class="q-sec q-settings"><summary>' + t('设置：卡片类型（认卡 / 填空卡）、每天新卡', 'Settings: card types (recognition / fill-in), new cards per day') + '</summary>' +
      '<fieldset class="q-kinds"><legend>' + t('卡片类型', 'Card types') + '</legend>' +
      '<label><input type="checkbox" data-act="c-kind" data-k="r"' + (k.r ? ' checked' : '') + '> <b>' + t('认卡', 'Recognition') + '</b> <span class="q-muted">' + t('看语法点，想含义和用法', 'see the pattern, recall what it means and how it’s used') + '</span></label>' +
      '<label><input type="checkbox" data-act="c-kind" data-k="c"' + (k.c ? ' checked' : '') + '> <b>' + t('填空卡', 'Fill-in') + '</b> <span class="q-muted">' + t('看例句和翻译，想挖掉的语法部分（学过再开）', 'see a sentence and its translation, recall the missing grammar (best after recognition)') + '</span></label></fieldset>' +
      '<label>' + t('每天新卡', 'New cards per day') + ' <select data-act="c-new">' +
      [5, 10, 15, 20, 30].map(function (n) { return '<option' + (n === newLimit() ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<p class="q-muted">' + t('进度和练习题记录存在一起，可以在练习页导出备份。', 'Progress is stored with your practice record; export it from the practice page.') + '</p></details>';
    app.innerHTML = h;
  }
  // A fill-in hint: the translation without the "→ usage" note that would give it away.
  function hint(e) { return String((EN ? e.en : e.zh) || '').split(/\s*→/)[0]; }
  function nextCard() {
    view(false);
    var q = cardQueue(), n = Date.now();
    // Due learning/review cards first; a new card when nothing is due; a learning
    // card due within a few minutes rather than ending the session early.
    var u = q.due[0] || q.fresh[0];
    if (!u) u = q.learning.filter(function (x) { return S.cards[x.key].due - n < 20 * 60e3; }).sort(function (a, b) { return S.cards[a.key].due - S.cards[b.key].due; })[0];
    if (!u) { cq = null; track('cards_done', { level: LEVEL }); return cardsHome(); }
    var c = u.c, x = S.cards[u.key];
    cq = { key: u.key, c: c, kind: u.kind, ex: u.kind === 'c' ? c.cloze[Math.floor(Math.random() * c.cloze.length)] : null };
    var h = '<div class="q-top"><button class="q-link" data-act="c-home">‹ ' + t('返回', 'Back') + '</button><span class="q-muted">' + t('新 ', 'New ') + q.fresh.length + ' · ' + t('待复习 ', 'Due ') + q.due.length + '</span></div>' +
      '<div class="q-card q-flash"><p class="q-muted q-flash-tag">' + (u.kind === 'c' ? t('填空', 'Fill-in') + ' · ' : '') + (x ? (x.s === 'learn' ? t('学习中', 'Learning') : t('复习', 'Review')) : t('新卡', 'New')) + ' · ' + c.lesson.replace('lesson', 'Lesson ') + '</p>';
    if (u.kind === 'c') {
      h += '<div class="q-flash-cloze" lang="ja">' + cq.ex.ja.replace(/<b class="cl">[\s\S]*?<\/b>/g, '<span class="q-cl">？</span>') + '</div>' +
        '<p class="q-flash-hinttext">' + esc(hint(cq.ex)) + '</p>' +
        '<p class="q-muted q-flash-hint">' + t('想一想：空的地方是什么？', 'What goes in the gap?') + '</p>';
    } else {
      h += '<div class="q-flash-term" lang="ja">' + esc(bi(c.term)) + '</div>' +
        '<p class="q-muted q-flash-hint">' + t('想一想：什么意思？怎么接续？举个例句。', 'Think: what does it mean, what does it attach to, an example?') + '</p>';
    }
    h += '<div class="q-flash-back" hidden></div>' +
      '<div class="q-next"><button class="q-btn q-btn-primary q-btn-big" data-act="c-show">' + t('显示答案', 'Show answer') + '</button></div></div>';
    app.innerHTML = h;
    window.scrollTo(0, app.offsetTop - 16);
  }
  function ivlLabel(ms) {
    if (ms < 3600e3) return Math.max(1, Math.round(ms / 60e3)) + t('分钟', 'm');
    if (ms < DAY_MS) return Math.round(ms / 3600e3) + t('小时', 'h');
    var d = Math.round(ms / DAY_MS);
    return d < 31 ? d + t('天', 'd') : Math.round(d / 30) + t('个月', 'mo');
  }
  // What each button would do to card state x (null = new). Returns the new state.
  function schedule(x, grade) {
    var n = Date.now();
    x = x ? JSON.parse(JSON.stringify(x)) : { s: 'learn', step: 0, ivl: 0, ease: 2.5, lapses: 0 };
    if (x.s === 'learn') {
      if (grade === 0) { x.step = 0; x.due = n + CARD_STEPS[0]; }
      else if (grade === 1) x.due = n + CARD_STEPS[x.step] * 1.5;
      else if (grade === 3 || x.step + 1 >= CARD_STEPS.length) { x.s = 'review'; x.ivl = grade === 3 ? 4 : 1; x.due = n + x.ivl * DAY_MS; }
      else { x.step++; x.due = n + CARD_STEPS[x.step]; }
      return x;
    }
    if (grade === 0) { x.lapses++; x.ease = Math.max(MIN_EASE, x.ease - 0.2); x.ivl = Math.max(1, Math.round(x.ivl * 0.3)); x.s = 'learn'; x.step = 1; x.due = n + CARD_STEPS[1]; return x; }
    if (grade === 1) { x.ease = Math.max(MIN_EASE, x.ease - 0.15); x.ivl = Math.max(x.ivl + 1, Math.round(x.ivl * 1.2)); }
    else if (grade === 2) x.ivl = Math.max(x.ivl + 1, Math.round(x.ivl * x.ease));
    else { x.ease += 0.15; x.ivl = Math.max(x.ivl + 2, Math.round(x.ivl * x.ease * 1.3)); }
    x.due = n + x.ivl * DAY_MS;
    return x;
  }
  function audioBtn(a) { return a ? ' <button class="q-link" data-act="c-audio" data-k="' + esc(a) + '" aria-label="' + t('播放', 'Play') + '">🔊</button>' : ''; }
  function showBack() {
    var c = cq.c, x = S.cards[cq.key], back = app.querySelector('.q-flash-back');
    var h = '';
    if (cq.kind === 'c') {
      // The sentence with the answer filled in and highlighted, then the point.
      app.querySelector('.q-flash-cloze').innerHTML = cq.ex.ja + audioBtn(cq.ex.audio);
      app.querySelector('.q-flash-hinttext').textContent = (EN ? cq.ex.en : cq.ex.zh) || '';
      h += '<p class="q-flash-pt"><b lang="ja">' + esc(bi(c.term)) + '</b>' + (bi(c.desc) ? ' — ' + esc(bi(c.desc)) : '') + '</p>';
      var others = c.cloze.filter(function (e) { return e !== cq.ex; }).slice(0, 2);
      if (others.length) h += '<ul class="q-flash-ex">' + others.map(function (e) { return '<li><span lang="ja">' + e.ja + '</span>' + audioBtn(e.audio) + '<br><span class="q-muted">' + esc(EN ? e.en : e.zh) + '</span></li>'; }).join('') + '</ul>';
    } else {
      if (bi(c.desc)) h += '<p class="q-flash-desc">' + esc(bi(c.desc)) + '</p>';
      // meaning is HTML built from the lesson markdown (tables, bold, lists).
      if (bi(c.meaning)) h += '<div class="q-flash-meaning">' + bi(c.meaning) + '</div>';
      if (c.ex.length) h += '<ul class="q-flash-ex">' + c.ex.map(function (e) {
        return '<li><span lang="ja">' + e.ja + '</span>' + audioBtn(e.audio) + '<br><span class="q-muted">' + esc(EN ? e.en : e.zh) + '</span></li>';
      }).join('') + '</ul>';
    }
    h += '<p class="q-refs">📖 <a href="' + LESSON_BASE + c.lesson + '/" target="_blank" rel="noopener">' + t('看课文', 'Open the lesson') + '</a> · <a href="' + LESSON_BASE + LEVEL.toLowerCase() + '-practice/#lesson=' + c.lesson + '" target="_blank" rel="noopener">' + t('练这一课的题', 'Practice this lesson') + '</a></p>';
    back.innerHTML = h; back.hidden = false;
    app.querySelector('.q-flash-hint').hidden = true;
    var names = [t('忘了', 'Again'), t('难', 'Hard'), t('记得', 'Good'), t('简单', 'Easy')];
    app.querySelector('.q-next').innerHTML = '<div class="q-grades">' + names.map(function (nm, g) {
      return '<button class="q-btn q-grade q-grade-' + g + '" data-act="c-grade" data-k="' + g + '"><b>' + nm + '</b><small>' + ivlLabel(schedule(x, g).due - Date.now()) + '</small></button>';
    }).join('') + '</div>';
  }
  function grade(g) {
    var wasNew = !S.cards[cq.key];
    S.cards[cq.key] = schedule(S.cards[cq.key], g);
    if (wasNew) cday().n++; else cday().r++;
    save();
    track('card_grade', { level: LEVEL, grade: g, isNew: wasNew, kind: cq.kind });
    nextCard();
  }
  if (CARDS) {
    app.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.getAttribute('data-act');
      if (act === 'c-start') { track('cards_start', { level: LEVEL, kinds: (cardKinds().r ? 'r' : '') + (cardKinds().c ? 'c' : '') }); nextCard(); }
      else if (act === 'c-home') cardsHome();
      else if (act === 'c-show') showBack();
      else if (act === 'c-grade') grade(+el.getAttribute('data-k'));
      else if (act === 'c-audio') new Audio('/audio/' + el.getAttribute('data-k')).play().catch(function () {});
    });
    app.addEventListener('change', function (e) {
      var act = e.target.getAttribute('data-act');
      if (act === 'c-new') { S.prefs.newCards = +e.target.value; save(); cardsHome(); }
      else if (act === 'c-kind') {
        var k = cardKinds(); k = { r: k.r, c: k.c };
        k[e.target.getAttribute('data-k')] = e.target.checked;
        if (!k.r && !k.c) { e.target.checked = true; return; }    // keep at least one
        S.prefs.cardKinds = k; save(); cardsHome();
        app.querySelector('.q-settings').open = true;
        track('cards_kinds', { level: LEVEL, kinds: (k.r ? 'r' : '') + (k.c ? 'c' : '') });
      }
    });
    document.addEventListener('keydown', function (e) {
      if (!cq || e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input, select, textarea')) return;
      var show = app.querySelector('[data-act="c-show"]');
      if (show && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); showBack(); }
      else if (!show && /^[1-4]$/.test(e.key)) grade(+e.key - 1);
    });
  }

  // ─── Events ───
  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var act = el.getAttribute('data-act');
    var sub = curs && el.closest('.q-sub');
    if (sub && curs[sub.getAttribute('data-q')]) cur = curs[sub.getAttribute('data-q')];
    if (act === 'daily' || act === 'type' || act === 'lesson' || act === 'review') startKind(act, el.getAttribute('data-k'));
    else if (act === 'resume') ask();
    else if (act === 'drop') { S.session = null; save(); home(); }
    else if (act === 'home') home();
    else if (act === 'opt') submit(+el.getAttribute('data-i'));
    else if (act === 'piece' && !cur.done) { var k = cur.picked.indexOf(null); if (k >= 0) { cur.picked[k] = +el.getAttribute('data-i'); fillSlots(); } }
    else if (act === 'slot' && !cur.done) { cur.picked[+el.getAttribute('data-k')] = null; fillSlots(); }
    else if (act === 'submit') { var star = [].indexOf.call(app.querySelectorAll('.q-slot'), app.querySelector('.q-star')); submit(cur.picked[star]); }
    else if (act === 'next') ask();
    else if (act === 'idk') submit(null);
    else if (act === 'was-guess') {
      var gq = cur.q, ans = S.answers[gq.id], last = ans && ans[ans.length - 1];
      if (last) last.g = true;
      cur.guess = true;
      if (S.session) for (var ri = S.session.res.length - 1; ri >= 0; ri--) if (S.session.res[ri].id === gq.id) { S.session.res[ri].g = true; break; }
      S.review[gq.id] = { lv: 0, due: now() + DAY, src: 'bank' };
      save();
      track('quiz_guess', { type: gq.type });
      el.outerHTML = '<small class="q-muted">' + t('已加入错题本，明天再考一次', 'On your review list for tomorrow') + '</small>';
    }
    else if (act === 'ai') aiExplain(cur.q, cur.choice, cur.guess, D.types[cur.q.type].ja, D.passages);
    // "这题有问题？": pick a reason, optionally say more, send.
    else if (act === 'report') {
      el.parentNode.querySelectorAll('[data-act="report"]').forEach(function (b) { b.classList.toggle('q-picked', b === el); });
      el.closest('details').setAttribute('data-reason', el.getAttribute('data-k'));
      var more = el.closest('details').querySelector('.q-report-more'); more.hidden = false; more.querySelector('textarea').focus();
    }
    else if (act === 'report-send') {
      var det = el.closest('details'), id = cur.q.id, reason = det.getAttribute('data-reason');
      var last = (S.answers[id] || []).slice(-1)[0];
      if (S.reported.indexOf(id) < 0) S.reported.push(id);
      save();
      track('quiz_report', { id: id, reason: reason });
      var done = function (ok) { det.outerHTML = '<p class="q-muted q-report">' + (ok ? t('谢谢！这题之后不会再出给你，我会检查。', 'Thanks — you won’t see this one again, and it’ll be checked.') : t('没发出去，但这题之后不会再出给你。', 'Couldn’t send it, but you won’t see this one again.')) + '</p>'; };
      if (window.jpFeedback) window.jpFeedback.send({ kind: 'question', qid: id, reason: reason, choice: last ? last.c : null, text: det.querySelector('textarea').value.trim() }).then(function () { done(true); }, function () { done(false); });
      else done(false);
    }
    else if (act === 'retry') start('retry', arrange(app._last.bad.map(function (id) { return Q[id]; })));
    else if (act === 'again') { if (app._last.kind === 'retry') startKind('daily'); else startKind(app._last.kind, app._last.label); }
    else if (act === 'export') {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' }));
      a.download = 'jpnotes-quiz-' + today() + '.json';
      a.click();
    }
  });
  app.addEventListener('change', function (e) {
    var act = e.target.getAttribute('data-act');
    var sub = curs && e.target.closest('.q-sub');
    if (sub && curs[sub.getAttribute('data-q')]) cur = curs[sub.getAttribute('data-q')];
    if (act === 'guess') cur.guess = e.target.checked;
    else if (act === 'size') { S.prefs.size = +e.target.value; save(); home(); }
    else if (act === 'import' && e.target.files[0]) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var s = JSON.parse(fr.result);
          if (!s || s.v !== 1 || typeof s.answers !== 'object') throw 0;
          S = s; save(); ALL = D.questions.filter(function (q) { return S.reported.indexOf(q.id) < 0; }); home();
        } catch (err) { alert(t('这不是有效的进度文件。', 'That isn’t a valid progress file.')); }
      };
      fr.readAsText(e.target.files[0]);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!cur || cur.mock || e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!document.body.contains(app.querySelector('.q-card'))) return;
    if (!cur.done && cur.q.type !== 'narabe' && /^[1-4]$/.test(e.key)) submit(+e.key - 1);
    else if (!cur.done && cur.q.type !== 'narabe' && e.key === '0') submit(null);
    else if (e.key === 'Enter') {
      var b = app.querySelector('[data-act="next"]') || app.querySelector('[data-act="submit"]:not([disabled])');
      if (b) { e.preventDefault(); b.click(); }
    }
  });
  boot();
})();
