/* /words/ — the reader's word list (生词本) on its own page, every level in one
 * place: the same jp_quiz_v1 `words` the practice pages, lesson pages and audio
 * pages add to (synced by sync.js). S.words[word] = { t: last change (ms; < 0
 * removed), a: added, r, m: reading and meaning as shown then, q: question id
 * (practice pages), lv: level it was added on (since 2026-11-23), k / due /
 * ok: the review schedule }.
 * Level of a word: x.lv, else the question id's prefix (n3-…), else the lowest
 * level whose meanings file has it (dist/quiz/word-levels.json), else "other".
 * 背单词 here is the practice pages' schedule (quiz.js wordGrade): a new word is
 * due at once; 记得 → next review 1 / 3 / 7 / 14 / 30 days later; remembering
 * the 30-day one, or 太简单, = learned (ok); 忘了 → k 0, due tomorrow. */
(function () {
  var app = document.getElementById('wb-app');
  if (!app) return;
  var EN = (document.documentElement.lang || '').indexOf('zh') !== 0, K = 'jp_quiz_v1';
  var LV = ['N5', 'N4', 'N3', 'N2', 'N1'], WIV = [1, 3, 7, 14, 30], DAY = 864e5;
  function t(z, e) { return EN ? e : z; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ev(n, p) { if (window.gaEvent) { p = p || {}; p.via = 'words_page'; window.gaEvent(n, p); } }
  function ld() {
    try { var s = JSON.parse(localStorage.getItem(K)); if (s && s.v === 1) { s.words = s.words || {}; return s; } } catch (e) {}
    return { v: 1, answers: {}, review: {}, reported: [], session: null, days: {}, prefs: {}, mock: {}, cards: {}, cardDays: {}, fav: {}, words: {} };
  }
  function sv(s) { s.at = Date.now(); try { localStorage.setItem(K, JSON.stringify(s)); } catch (e) {} if (window.jpSync) window.jpSync.changed(); try { dispatchEvent(new Event('jp-words')); } catch (x) {} }
  function setWord(k, ch) { var s = ld(), x = {}, o = s.words[k] || {}; for (var f in o) x[f] = o[f]; for (var g in ch) x[g] = ch[g]; x.t = Date.now(); s.words[k] = x; sv(s); }

  var LVMAP = {}, filt = 'all', WS = null, PER = 50, pg = { L: 0, M: 0 };
  try { var f0 = (location.hash || '').slice(1).toUpperCase(); if (LV.indexOf(f0) >= 0) filt = f0; else filt = localStorage.getItem('jp_wb_lv') || 'all'; } catch (e) {}
  function levelOf(k, x) {
    if (x.lv && LV.indexOf(String(x.lv).toUpperCase()) >= 0) return String(x.lv).toUpperCase();
    var m = /^(n[1-5])-/.exec(x.q || ''); if (m) return m[1].toUpperCase();
    return LVMAP[k] || 'other';
  }
  function mine() {
    var W = ld().words;
    return Object.keys(W).filter(function (k) { return W[k] && W[k].t > 0; }).map(function (k) { return { k: k, x: W[k], lv: levelOf(k, W[k]) }; })
      .sort(function (a, b) { return (b.x.a || b.x.t) - (a.x.a || a.x.t); });
  }
  function whenDue(x) {
    var d = Math.round(((x.due || 0) - Date.now()) / DAY);
    return d <= 0 ? t('今天', 'today') : d === 1 ? t('明天', 'tomorrow') : t(d + ' 天后', 'in ' + d + ' days');
  }
  function ruby(k, r) { return r && r !== k ? '<ruby>' + esc(k) + '<rp>(</rp><rt>' + esc(r) + '</rt><rp>)</rp></ruby>' : esc(k); }

  function list() {
    WS = null;
    var all = mine(), counts = { all: all.length, other: 0 };
    LV.forEach(function (l) { counts[l] = 0; });
    all.forEach(function (w) { counts[w.lv] = (counts[w.lv] || 0) + 1; });
    if (filt !== 'all' && !counts[filt]) filt = 'all';
    var ws = all.filter(function (w) { return filt === 'all' || w.lv === filt; });
    var L = ws.filter(function (w) { return !w.x.ok; }), M = ws.filter(function (w) { return w.x.ok; });
    var now = Date.now(), due = L.filter(function (w) { return (w.x.due || 0) <= now; }).length;
    var h = '<div class="wb-tabs" role="tablist">' + ['all'].concat(LV, ['other']).filter(function (l) { return l === 'all' || counts[l]; }).map(function (l) {
      return '<button type="button" role="tab" data-lv="' + l + '" aria-selected="' + (l === filt) + '">' + (l === 'all' ? t('全部', 'All') : l === 'other' ? t('其他', 'Other') : l) + ' <small>' + counts[l] + '</small></button>';
    }).join('') + '</div>';
    if (!all.length) {
      h += '<div class="wb-empty"><p>' + t('生词本还是空的。', 'Your word list is empty.') + '</p><p class="wb-muted">' +
        t('在课文例句、练习题答完以后、语法听读和高频词汇页上，点任何一个词，再点「加入生词本」，它就会出现在这里，可以按级别背。', 'Tap any word in a lesson\'s example sentences, under a practice question after you answer, or on the grammar audio and vocabulary list pages, then “Add to word list”. It shows up here, sorted by level, ready to study.') + '</p></div>';
      app.innerHTML = h; return;
    }
    h += '<div class="wb-sum"><span>' + t('在学 <b>' + L.length + '</b> · 今天要背 <b>' + due + '</b> · 已掌握 ' + M.length, 'Learning <b>' + L.length + '</b> · due today <b>' + due + '</b> · learned ' + M.length) + '</span>' +
      (L.length ? '<button type="button" class="wb-btn wb-primary" data-act="study"' + (due ? '' : ' data-early="1"') + '>' + (due ? t('背单词 · ' + due + ' 个到期', 'Study · ' + due + ' due') : t('提前背', 'Study early')) + '</button>' : '') + '</div>';
    h += L.length ? page(L, 'L', false) : '<p class="wb-muted">' + t('这一级的词都掌握了。', 'All the words here are learned.') + '</p>';
    if (M.length) h += '<details class="wb-done"' + (pg.M ? ' open' : '') + '><summary>' + t('已掌握 ', 'Learned ') + M.length + '</summary>' + page(M, 'M', true) + '</details>';
    app.innerHTML = h;
  }
  // PER words a page; the page buttons only when there is more than one page.
  function page(ws, which, done) {
    var n = Math.ceil(ws.length / PER), p = Math.min(pg[which], n - 1);
    pg[which] = p;
    var h = '<ul class="wb-list">' + ws.slice(p * PER, p * PER + PER).map(function (w) { return row(w, done); }).join('') + '</ul>';
    if (n > 1) {
      h += '<nav class="wb-pages" aria-label="' + t('分页', 'Pages') + '"><button type="button" class="wb-btn" data-pg="' + which + ':' + (p - 1) + '"' + (p ? '' : ' disabled') + '>' + t('‹ 上一页', '‹ Previous') + '</button>';
      for (var i = 0; i < n; i++) h += '<button type="button" class="wb-btn wb-pg' + (i === p ? ' on' : '') + '" data-pg="' + which + ':' + i + '"' + (i === p ? ' aria-current="page"' : '') + '>' + (i * PER + 1) + '–' + Math.min(ws.length, i * PER + PER) + '</button>';
      h += '<button type="button" class="wb-btn" data-pg="' + which + ':' + (p + 1) + '"' + (p < n - 1 ? '' : ' disabled') + '>' + t('下一页 ›', 'Next ›') + '</button></nav>';
    }
    return h;
  }
  function row(w, done) {
    var x = w.x;
    return '<li><div class="wb-w" lang="ja">' + ruby(w.k, x.r) + '</div><div class="wb-m">' + esc(x.m || '') +
      '<div class="wb-meta">' + (w.lv !== 'other' ? '<span class="wb-lv">' + w.lv + '</span>' : '') + (done ? '' : t('下次复习：', 'Next review: ') + whenDue(x)) + '</div></div>' +
      '<span class="wb-acts">' + (done ? '<button type="button" class="wb-btn" data-act="back" data-k="' + esc(w.k) + '">' + t('放回在学', 'Learn again') + '</button>'
        : '<button type="button" class="wb-btn" data-act="ok" data-k="' + esc(w.k) + '">' + t('✓ 掌握了', '✓ Know it') + '</button>') +
      '<button type="button" class="wb-btn" data-act="del" data-k="' + esc(w.k) + '">' + t('移除', 'Remove') + '</button></span></li>';
  }

  function study(early) {
    var now = Date.now(), ws = mine().filter(function (w) { return !w.x.ok && (filt === 'all' || w.lv === filt) && (early || (w.x.due || 0) <= now); })
      .sort(function (a, b) { return (a.x.due || 0) - (b.x.due || 0); });
    WS = { list: ws.slice(0, 30).map(function (w) { return w.k; }), i: 0, flip: false, ok: 0, miss: 0, seen: {} };
    ev('word_study', { level: filt, n: WS.list.length, early: early ? 1 : 0 });
    card();
  }
  function card() {
    var h = '<div class="wb-top"><button type="button" class="wb-link" data-act="list">‹ ' + t('生词本', 'Word list') + '</button><span>' + t('背单词', 'Study') + (filt !== 'all' ? ' · ' + (filt === 'other' ? t('其他', 'Other') : filt) : '') + (WS.i < WS.list.length ? ' · ' + (WS.i + 1) + ' / ' + WS.list.length : '') + '</span></div>';
    if (WS.i >= WS.list.length) {
      h += '<div class="wb-card"><p class="wb-card-w">' + t('这一轮背完了', 'Round done') + '</p><p class="wb-muted">' + t('记得 ' + WS.ok + ' · 忘了 ' + WS.miss, WS.ok + ' remembered · ' + WS.miss + ' forgotten') + '</p>' +
        '<p><button type="button" class="wb-btn wb-primary" data-act="list">' + t('回生词本', 'Back to word list') + '</button></p></div>';
    } else {
      var k = WS.list[WS.i], x = ld().words[k] || {};
      h += '<div class="wb-card"><p class="wb-card-w" lang="ja">' + (WS.flip ? ruby(k, x.r) : esc(k)) + '</p>';
      if (!WS.flip) h += '<p><button type="button" class="wb-btn wb-primary wb-big" data-act="flip">' + t('看答案', 'Show answer') + '</button></p><p class="wb-muted">' + t('先想想读音和意思（空格键翻面）', 'Recall the reading and meaning first (space flips)') + '</p>';
      else h += '<p class="wb-card-m">' + esc(x.m || '') + '</p><div class="wb-card-acts"><button type="button" class="wb-btn" data-act="grade" data-g="0">' + t('忘了', 'Forgot') + ' <kbd>1</kbd></button><button type="button" class="wb-btn wb-primary" data-act="grade" data-g="1">' + t('记得', 'Remembered') + ' <kbd>2</kbd></button><button type="button" class="wb-btn" data-act="grade" data-g="2">' + t('太简单', 'Too easy') + ' <kbd>3</kbd></button></div>';
      h += '</div>';
    }
    app.innerHTML = h;
  }
  function grade(g) {
    var k = WS.list[WS.i], x = ld().words[k] || {}, step = x.k || 0;
    if (g === 0) { WS.miss++; if (!WS.seen[k]) WS.list.push(k); WS.seen[k] = 1; setWord(k, { k: 0, due: Date.now() + DAY }); }
    else if (g === 2 || step >= WIV.length) { WS.ok++; setWord(k, { ok: 1 }); ev('word_mastered', { level: filt }); }
    else { WS.ok++; setWord(k, { k: step + 1, due: Date.now() + WIV[step] * DAY }); }
    ev('word_grade', { g: g, level: filt });
    WS.i++; WS.flip = false; card();
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var lv = b.getAttribute('data-lv');
    if (lv) { filt = lv; pg = { L: 0, M: 0 }; try { localStorage.setItem('jp_wb_lv', lv); } catch (x) {} return list(); }
    var pgv = b.getAttribute('data-pg');
    if (pgv) {
      var pp = pgv.split(':'); pg[pp[0]] = Math.max(0, +pp[1]); list();
      var top = pp[0] === 'M' ? app.querySelector('.wb-done') : app.querySelector('.wb-sum');
      if (top) top.scrollIntoView({ block: 'start' });
      return;
    }
    var a = b.getAttribute('data-act'), k = b.getAttribute('data-k');
    if (a === 'study') study(b.hasAttribute('data-early'));
    else if (a === 'list') list();
    else if (a === 'flip') { WS.flip = true; card(); }
    else if (a === 'grade') grade(+b.getAttribute('data-g'));
    else if (a === 'ok') { setWord(k, { ok: 1 }); ev('word_mastered', { level: filt }); list(); }
    else if (a === 'back') { setWord(k, { ok: 0, k: 0, due: Date.now() }); list(); }
    else if (a === 'del') { var s = ld(); s.words[k] = { t: -Date.now(), q: (s.words[k] || {}).q }; sv(s); ev('word_remove', { level: filt }); list(); }
  });
  document.addEventListener('keydown', function (e) {
    if (!WS || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (WS.i >= WS.list.length) return;
    if (!WS.flip && (e.code === 'Space' || e.key === 'Enter')) { e.preventDefault(); WS.flip = true; card(); }
    else if (WS.flip && /^[123]$/.test(e.key)) { e.preventDefault(); grade(+e.key - 1); }
  });
  // progress from another device (sync.js writes localStorage), or a word added in another tab
  addEventListener('storage', function (e) { if (e.key === K && !WS) list(); });
  addEventListener('jp-words', function () { if (!WS) list(); });

  list();
  ev('word_list', { n: mine().length });
  // levels for words saved before they carried one (fetched after the first paint)
  var src = app.getAttribute('data-levels');
  if (src) fetch(src).then(function (r) { return r.json(); }).then(function (m) { LVMAP = m || {}; if (!WS) list(); }).catch(function () {});
})();
