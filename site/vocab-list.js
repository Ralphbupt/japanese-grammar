/* Vocabulary list pages (/{level}-vocabulary-list/, build.js), on top of the
 * grammar-audio player. State lives in the practice app's jp_quiz_v1 `words`
 * (synced by sync.js, merged per word by |t|):
 *   { t: +ms, a, q: '', r, m, k: 0, due }  in the word list (背单词 picks it up)
 *   { t: -ms, kn: 1 }                      sorted out as known (快速筛词)
 *   { t: -ms }                             taken out of the list
 *   no entry                               not sorted yet
 * Every item is 4 track lines (word, meaning, example, translation), so item i
 * owns lines 4i…4i+3 — window.jpGaSkip uses that to play only the list's words
 * and only the words the filter shows. */
(function () {
  var K = 'jp_quiz_v1', box = document.getElementById('vl'), ga = document.getElementById('ga');
  if (!box || !ga) return;
  var LV = box.getAttribute('data-lv'), EN = box.getAttribute('data-en') === '1';
  function t(z, e) { return EN ? e : z; }
  var its = [].slice.call(ga.querySelectorAll('.ga-it'));
  var W = its.map(function (s) { return s.getAttribute('data-w'); });
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  function ld() {
    try { var s = JSON.parse(localStorage.getItem(K)); if (s && s.v === 1) { s.words = s.words || {}; return s; } } catch (e) {}
    return { v: 1, answers: {}, review: {}, reported: [], session: null, days: {}, prefs: {}, mock: {}, cards: {}, cardDays: {}, fav: {}, words: {} };
  }
  function sv(s) { s.at = Date.now(); try { localStorage.setItem(K, JSON.stringify(s)); } catch (e) {} if (window.jpSync) window.jpSync.changed(); try { dispatchEvent(new Event('jp-words')); } catch (x) {} }
  function st(s, w) { var x = s.words[w]; return !x ? '' : x.t > 0 ? 'in' : x.kn ? 'kn' : 'out'; }
  function ev(n, p) { if (window.gaEvent) { p = p || {}; p.level = LV; p.via = 'vocab_list'; window.gaEvent(n, p); } }
  function setW(s, i, to) {
    var w = W[i], b = its[i].querySelector('.vl-add'), n = Date.now(), old = s.words[w];
    if (to === 'in') s.words[w] = { t: n, a: n, q: '', r: b.getAttribute('data-r'), m: b.getAttribute('data-m'), k: 0, due: n };
    else if (to === 'kn') s.words[w] = { t: -n, kn: 1 };
    else if (to === 'out') s.words[w] = { t: -n, q: (old || {}).q };
    else delete s.words[w];   // undo of a first sort: back to "not sorted"
  }

  // ---- list: ＋ buttons, counts, filter, hide readings, play only my words
  var filter = ls.get('jp_vl_f') || 'all', mine = ls.get('jp_vl_mine') === '1', S = ld();
  var shown = [], query = '';
  // search text per word: the word, its reading, its meaning
  var hay = its.map(function (s, i) { return (W[i] + ' ' + s.querySelector('.vl-r').textContent + ' ' + s.querySelector('.ga-m').textContent).toLowerCase(); });
  function goTo(i) {
    var s = its[i]; if (!s) return;
    if (s.hidden) { filter = 'all'; sel.value = 'all'; query = ''; qin.value = ''; paint(); }
    its.forEach(function (e) { e.classList.remove('vl-hit'); });
    s.classList.add('vl-hit'); s.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function paint() {
    S = ld();
    var c = 0, todo = 0;
    its.forEach(function (s, i) {
      var k = st(S, W[i]), b = s.querySelector('.vl-add');
      if (k === 'in') c++;
      if (!k) todo++;
      b.setAttribute('aria-pressed', String(k === 'in'));
      b.textContent = k === 'in' ? t('✓ 生词本', '✓ Word list') : t('＋ 生词本', '＋ Word list');
      s.classList.toggle('vl-kn', k === 'kn');
      var n = +s.getAttribute('data-n');
      shown[i] = (filter === 'todo' ? !k : filter === 'in' ? k === 'in' : filter === 'n2' ? n >= 2 : true) && (!query || hay[i].indexOf(query) >= 0);
      s.hidden = !shown[i];
    });
    // a group heading disappears when the filter leaves nothing under it
    [].forEach.call(ga.querySelectorAll('h2.ga-lh'), function (h) {
      var any = false, e = h.nextElementSibling;
      while (e && !e.matches('h2')) { if (e.classList.contains('ga-it') && !e.hidden) { any = true; break; } e = e.nextElementSibling; }
      h.hidden = !any;
    });
    document.getElementById('vl-n').textContent = c;
    document.getElementById('vl-todo').textContent = todo;
    var empty = document.getElementById('vl-empty');
    empty.hidden = shown.some(Boolean);
    document.getElementById('vl-mine').setAttribute('aria-pressed', String(mine && c > 0));
  }
  function listCount() { return W.filter(function (w) { return st(S, w) === 'in'; }).length; }
  // "Only my words" with nothing of this list in the word list would skip every
  // line (play stopped at once), so it only counts once there is a word to play.
  window.jpGaSkip = function (line, from) {
    var i = line >> 2;
    if (from >= 0 && i === from >> 2) return false;
    // Started by hand on a word that isn't in the list: the reader is browsing,
    // so play on in order; "only my words" applies from a list word or the play button.
    var onlyMine = mine && listCount() > 0 && !(from >= 0 && st(S, W[from >> 2]) !== 'in');
    return !shown[i] || (onlyMine && st(S, W[i]) !== 'in');
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.vl-add');
    if (!b) return;
    e.stopPropagation();
    var i = its.indexOf(b.closest('.ga-it')), s = ld(), on = st(s, W[i]) === 'in';
    setW(s, i, on ? 'out' : 'in'); sv(s); paint();
    ev(on ? 'word_remove' : 'word_add');
  }, true);
  var sel = document.getElementById('vl-f');
  sel.value = filter;
  sel.addEventListener('change', function () { filter = sel.value; ls.set('jp_vl_f', filter); paint(); });
  document.getElementById('vl-mine').addEventListener('click', function () {
    S = ld();
    if (!mine && !listCount()) { alertMsg(t('生词本里还没有这一级的词。先用「快速筛词」挑出不认识的，再打开这个开关。', 'No words from this list in your word list yet. Sort them first with “Quick sort”, then turn this on.')); return; }
    mine = !mine; ls.set('jp_vl_mine', mine ? '1' : '0'); paint();
  });
  // search: a number jumps to that word; text filters the list
  var qin = document.getElementById('vl-q-in'), qt = 0;
  qin.addEventListener('input', function () {
    clearTimeout(qt);
    qt = setTimeout(function () {
      var v = qin.value.trim().toLowerCase();
      if (/^\d+$/.test(v)) { query = ''; paint(); goTo(+v - 1); return; }
      query = v; paint();
      if (v) { var f = shown.indexOf(true); if (f >= 0) its[f].scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 250);
  });
  // parts of 50 words: jump to one, or play it (word, meaning, example … and stop after its last word)
  var jump = document.getElementById('vl-jump'), seg = +ls.get('jp_vl_seg') || 1;
  jump.value = String(seg);
  jump.addEventListener('change', function () { if (jump.value) { seg = +jump.value; ls.set('jp_vl_seg', seg); goTo(seg - 1); } });
  document.getElementById('vl-seg').addEventListener('click', function () {
    if (!jump.value) { jump.value = String(seg); }
    seg = +jump.value; goTo(seg - 1);
    if (window.jpGaPlay) window.jpGaPlay((seg - 1) * 4, Math.min(its.length, seg + 49) * 4 - 1);
    ev('vocab_part', { part: seg });
  });
  // Japanese definitions: meanings shown in Japanese and the all-Japanese track
  // (word → definition → example; its translation lines are empty)
  var jam = document.getElementById('vl-jam'), JA = null;
  try { JA = JSON.parse(document.getElementById('vl-ja').textContent); } catch (e) {}
  if (jam && JA) {
    var orig = { src: document.getElementById('ga-a').getAttribute('src'), dur: +ga.getAttribute('data-dur'), lines: JSON.parse(document.getElementById('ga-t').textContent) };
    var mEls = its.map(function (s) { return s.querySelector('.ga-m'); }), mTxt = mEls.map(function (e) { return e.textContent; });
    var setJa = function (on, save) {
      jam.setAttribute('aria-pressed', String(on));
      ga.classList.toggle('vl-jam', on);
      mEls.forEach(function (e, i) { e.textContent = on ? JA.mean[i] || mTxt[i] : mTxt[i]; if (on) e.setAttribute('lang', 'ja'); else e.removeAttribute('lang'); });
      var t = on ? JA : orig;
      if (window.jpGaTrack) window.jpGaTrack(t.src, t.lines, t.dur);
      if (save) { ls.set('jp_vl_ja', on ? '1' : '0'); ev('vocab_ja', { on: on ? 1 : 0 }); }
    };
    jam.addEventListener('click', function () { setJa(jam.getAttribute('aria-pressed') !== 'true', true); });
    // after grammar-audio.js (loaded after this script) has set up the player
    if (ls.get('jp_vl_ja') === '1') document.addEventListener('DOMContentLoaded', function () { setJa(true, false); });
  }
  var hr = document.getElementById('vl-hr');
  hr.addEventListener('click', function () { var on = ga.classList.toggle('vl-hr'); hr.setAttribute('aria-pressed', String(on)); });
  function alertMsg(m) { var p = document.getElementById('vl-msg'); p.textContent = m; p.hidden = false; setTimeout(function () { p.hidden = true; }, 5000); }
  addEventListener('storage', paint);
  addEventListener('jp-words', function () { if (!painting) { painting = true; paint(); painting = false; } });
  var painting = false;
  paint();

  // ---- quick sort: one card per unsorted word; 不认识 → word list, 认识 → known
  var dlg = document.getElementById('vl-q'), Q = [], qi = 0, hist = [], flipped = false;
  document.getElementById('vl-qsay').addEventListener('click', function (e) { e.stopPropagation(); say(); });
  var qw = document.getElementById('vl-qw'), qb = document.getElementById('vl-qb'), qp = document.getElementById('vl-qp');
  function plain(el) { return el ? el.innerHTML : ''; }
  function show() {
    flipped = false;
    if (window.jpGaPause) window.jpGaPause();
    dlg.classList.remove('vl-flip');
    var left = Q.length - qi;
    qp.textContent = t('还剩 ' + left + ' 个', left + ' left');
    document.getElementById('vl-qundo').disabled = !hist.length;
    if (!left) {
      qw.textContent = t('这一组筛完了 🎉', 'All sorted 🎉');
      qb.innerHTML = '<p>' + t('不认识的词都在生词本里了，去背单词，或者打开「只听我的生词」连播。', 'The ones you didn’t know are in your word list: review them with flashcards, or turn on “Only my words” and listen.') + '</p>';
      dlg.classList.add('vl-flip', 'vl-done');
      return;
    }
    dlg.classList.remove('vl-done');
    var s = its[Q[qi]];
    qw.textContent = W[Q[qi]];
    qb.innerHTML = '<p class="vl-qr" lang="ja">' + s.querySelector('.vl-r').textContent + '</p><p class="vl-qm">' + plain(s.querySelector('.ga-m')) +
      '</p><div class="ga-ex"><p><span lang="ja">' + plain(s.querySelector('.ga-ex span[lang]')) + '</span></p><p class="ga-tr">' + plain(s.querySelector('.ga-ex .ga-tr')) + '</p></div>';
  }
  // Turning the card reads the word and its meaning (track lines 4i, 4i+1); 🔊 again.
  function say() { if (qi < Q.length && window.jpGaPlay) window.jpGaPlay(Q[qi] * 4, Q[qi] * 4 + 1); }
  function flip() {
    if (qi >= Q.length) return;
    flipped = !flipped; dlg.classList.toggle('vl-flip', flipped);
    if (flipped) say(); else if (window.jpGaPause) window.jpGaPause();
  }
  function grade(to) {
    if (qi >= Q.length) return;
    var s = ld(), i = Q[qi];
    hist.push({ i: i, old: s.words[W[i]] });
    setW(s, i, to); sv(s); qi++;
    ev(to === 'in' ? 'word_add' : 'word_known');
    show(); paint();
  }
  function undo() {
    var h = hist.pop(); if (!h) return;
    var s = ld();
    if (h.old) s.words[W[h.i]] = h.old; else delete s.words[W[h.i]];
    sv(s); qi--; show(); paint();
  }
  function open() {
    S = ld();
    // unsorted words of the current filter (most-tested first, page order)
    Q = []; its.forEach(function (s, i) { if (!st(S, W[i]) && (filter !== 'n2' || +s.getAttribute('data-n') >= 2)) Q.push(i); });
    qi = 0; hist = [];
    dlg.hidden = false; document.documentElement.classList.add('vl-open');
    show(); ev('word_sort_open', { left: Q.length });
    document.getElementById('vl-qcard').focus();
  }
  function close() { if (window.jpGaPause) window.jpGaPause(); dlg.hidden = true; document.documentElement.classList.remove('vl-open'); paint(); }
  document.getElementById('vl-sort').addEventListener('click', open);
  document.getElementById('vl-qx').addEventListener('click', close);
  document.getElementById('vl-qcard').addEventListener('click', flip);
  document.getElementById('vl-qno').addEventListener('click', function () { grade('in'); });
  document.getElementById('vl-qyes').addEventListener('click', function () { grade('kn'); });
  document.getElementById('vl-qundo').addEventListener('click', undo);
  // keys while the card is open: space / enter flip, ← or 1 don't know, → or 2 know, Backspace undo, Esc close
  document.addEventListener('keydown', function (e) {
    if (dlg.hidden) return;
    var k = e.key, done = true;
    if (k === 'Escape') close();
    else if (k === ' ' || k === 'Enter') { if (!e.target.closest('button') || e.target.id === 'vl-qcard') flip(); else done = false; }
    else if (k === 'ArrowLeft' || k === '1') grade('in');
    else if (k === 'ArrowRight' || k === '2') grade('kn');
    else if (k === 'Backspace' || k === 'z') undo();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
