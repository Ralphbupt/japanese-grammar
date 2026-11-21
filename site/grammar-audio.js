/* Grammar audio pages (/{level}-grammar-audio/, build.js): one mp3 per level and
 * language. Every line on the page carries data-l, its index in the timing list
 * #ga-t ([start, end, kind] seconds; kinds g pattern, m meaning, e example,
 * t translation). Modes: play all, one line and stop, loop one line, play one
 * lesson. "Read translations" off = the player jumps over the t lines. Lesson
 * headings / chips (data-go) start a lesson; folded extra examples (data-mp3)
 * play their own lesson mp3. Position is remembered per page.
 * A page may set window.jpGaSkip(i, from) → true to jump over line i while
 * playing on (vocabulary list: words not in the word list, filtered-out words);
 * `from` is the line the reader last started by hand, so that one still plays. */
(function () {
  var root = document.getElementById('ga'), a = document.getElementById('ga-a'), T;
  if (!root || !a) return;
  try { T = JSON.parse(document.getElementById('ga-t').textContent); } catch (e) { return; }
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var page = root.getAttribute('data-page'), KEY = 'jp_ga_' + page;
  var els = {}, cur = -1, from = -1, stopAt = null, mode = 'all', played = false, readTr = ls.get('jp_ga_tr') !== '0', readM = ls.get('jp_ga_m') !== '0';
  [].forEach.call(root.querySelectorAll('[data-l]'), function (e) { els[e.getAttribute('data-l')] = e; });
  // Lesson starts (line indices), for "this lesson" and the chip that lights up.
  var starts = [].map.call(root.querySelectorAll('h2[data-go]'), function (h) { return +h.getAttribute('data-go'); });
  var chips = document.querySelectorAll('.ga-toc a[data-go]');
  var pb = document.getElementById('ga-play'), seek = document.getElementById('ga-seek'), time = document.getElementById('ga-time');
  var trBtn = document.getElementById('ga-trs');

  function fmt(s) { s = Math.max(0, s || 0); return Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2); }
  function lineAt(t) { var lo = 0, hi = T.length - 1, r = -1; while (lo <= hi) { var m = (lo + hi) >> 1; if (T[m][0] <= t + 0.05) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
  function lessonOf(i) { var r = 0; for (var k = 0; k < starts.length; k++) if (starts[k] <= i) r = k; return r; }
  function lessonEnd(i) { var k = lessonOf(i); return k + 1 < starts.length ? starts[k + 1] - 1 : T.length - 1; }
  var lastChip = -1;
  function mark(i, scroll) {
    if (i === cur) return;
    if (els[cur]) els[cur].classList.remove('ga-cur');
    cur = i;
    var k = i >= 0 ? lessonOf(i) : -1;
    if (k !== lastChip) { if (chips[lastChip]) chips[lastChip].classList.remove('on'); if (chips[k]) chips[k].classList.add('on'); lastChip = k; }
    var e = els[i]; if (!e) return;
    e.classList.add('ga-cur');
    // Follow the reading like the podcast pages: the current line in the middle,
    // except for 4 s after the reader scrolled themselves.
    if (scroll && Date.now() - userScroll > 4000) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  var userScroll = 0;
  ['wheel', 'touchmove', 'keydown'].forEach(function (ev) {
    addEventListener(ev, function (e) { if (ev !== 'keydown' || /^(Page|Arrow(Up|Down)|Home|End)/.test(e.key)) userScroll = Date.now(); }, { passive: true });
  });
  function first() {
    if (played) return; played = true;
    if (window.gaEvent) window.gaEvent('grammar_audio', { page: page });
  }
  function go() { first(); var p = a.play(); if (p && p.catch) p.catch(function () {}); }
  function seekTo(i) { a.currentTime = T[i][0]; mark(i, true); }
  function playLine(i) {
    if (!T[i]) return;
    from = i;
    stopAt = mode === 'one' || mode === 'loop' ? i : mode === 'lesson' ? lessonEnd(i) : null;
    seekTo(i); go();
  }
  function playFrom(i, lesson) {
    if (!T[i]) return;
    from = i;
    if (lesson) setMode('lesson');
    stopAt = mode === 'lesson' ? lessonEnd(i) : null;
    seekTo(i); go();
  }

  // For other scripts on the page (vocabulary quick sort): play lines i…j once.
  window.jpGaPlay = function (i, j) { if (!T[i]) return; from = i; seekTo(i); stopAt = Math.min(j, T.length - 1); go(); };
  window.jpGaPause = function () { a.pause(); stopAt = null; };
  // Swap to another track with the same line layout (vocabulary list: Japanese-only
  // definitions); keeps the place by line, keeps playing if it was.
  window.jpGaTrack = function (src, lines, dur) {
    var at = cur, was = !a.paused;
    a.pause(); T = lines; root.setAttribute('data-dur', dur); a.src = src;
    a.addEventListener('loadedmetadata', function once() {
      a.removeEventListener('loadedmetadata', once);
      if (T[at]) a.currentTime = T[at][0];
      if (was) go();
    });
    a.load();
    time.textContent = fmt(at >= 0 && T[at] ? T[at][0] : 0) + ' / ' + fmt(dur);
  };

  a.addEventListener('timeupdate', function () {
    var t = a.currentTime, i = lineAt(t);
    if (stopAt != null && t >= T[stopAt][1]) {
      if (mode === 'loop') { a.currentTime = T[stopAt][0]; return; }
      a.pause(); stopAt = null; return;
    }
    // Translations off (or meanings off, #ga-ms, vocabulary list): jump from the start of such a line to the next line.
    if (i >= 0 && ((!readTr && T[i][2] === 't') || (!readM && T[i][2] === 'm')) && t < T[i][1] - 0.15 && mode !== 'one' && mode !== 'loop') {
      if (T[i + 1]) { a.currentTime = T[i + 1][0]; i = i + 1; }
    }
    if (window.jpGaSkip && !a.paused && mode !== 'one' && mode !== 'loop' && i >= 0 && window.jpGaSkip(i, from)) {
      var j = i + 1; while (T[j] && window.jpGaSkip(j, from)) j++;
      // past the last line that plays: start over from the first one (a loop of
      // "my words"), unless a lesson/group is playing, which just ends
      if (!T[j] && stopAt == null) { j = 0; while (j < i && window.jpGaSkip(j, from)) j++; if (j >= i) j = T.length; }
      if (!T[j] || (stopAt != null && j > stopAt)) { a.pause(); stopAt = null; return; }
      a.currentTime = T[j][0]; i = j;
    }
    mark(i, !a.paused);
    if (a.duration) seek.value = Math.round(t / a.duration * 1000);
    time.textContent = fmt(t) + ' / ' + fmt(a.duration || +root.getAttribute('data-dur'));
  });
  a.addEventListener('play', function () { pb.classList.add('on'); pb.setAttribute('aria-label', pb.getAttribute('data-pause')); });
  a.addEventListener('pause', function () { pb.classList.remove('on'); pb.setAttribute('aria-label', pb.getAttribute('data-play')); ls.set(KEY, String(a.currentTime)); });
  pb.addEventListener('click', function () {
    if (!a.paused) return a.pause();
    if (mode !== 'all' && cur >= 0) return playLine(cur);
    go();
  });
  seek.addEventListener('input', function () { if (a.duration) { a.currentTime = seek.value / 1000 * a.duration; stopAt = null; } });

  function setMode(m) {
    mode = m;
    [].forEach.call(document.querySelectorAll('[data-ga-mode]'), function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-ga-mode') === m)); });
    stopAt = a.paused || cur < 0 ? null : m === 'one' || m === 'loop' ? cur : m === 'lesson' ? lessonEnd(cur) : null;
  }
  [].forEach.call(document.querySelectorAll('[data-ga-mode]'), function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-ga-mode')); });
  });
  document.getElementById('ga-rate').addEventListener('change', function (e) { a.playbackRate = +e.target.value; extra.playbackRate = a.playbackRate; });
  function showTr() { trBtn.setAttribute('aria-pressed', String(readTr)); root.classList.toggle('ga-notr', !readTr); }
  trBtn.addEventListener('click', function () { readTr = !readTr; ls.set('jp_ga_tr', readTr ? '1' : '0'); showTr(); });
  var mBtn = document.getElementById('ga-ms');
  if (mBtn) {
    mBtn.setAttribute('aria-pressed', String(readM));
    mBtn.addEventListener('click', function () { readM = !readM; ls.set('jp_ga_m', readM ? '1' : '0'); mBtn.setAttribute('aria-pressed', String(readM)); });
  } else readM = true;
  showTr();
  document.getElementById('ga-hide').addEventListener('click', function (e) {
    var on = root.classList.toggle('ga-hidden'); e.currentTarget.setAttribute('aria-pressed', String(on));
  });

  // Folded extra examples: not in the track; each plays its own lesson mp3.
  var extra = new Audio(), extraEl = null;
  function stopExtra() { extra.pause(); if (extraEl) extraEl.classList.remove('ga-cur'); extraEl = null; }
  extra.addEventListener('ended', stopExtra);
  a.addEventListener('play', stopExtra);

  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) {
      e.preventDefault();
      var i = +g.getAttribute('data-go'), h = root.querySelector('h2[data-go="' + i + '"]');
      if (g.tagName === 'A' && h) h.scrollIntoView({ behavior: 'smooth' });
      playFrom(i, g.hasAttribute('data-lesson'));
      return;
    }
    if (!root.contains(e.target) || e.target.closest('a,summary')) return;
    var x = e.target.closest('[data-mp3]');
    if (x) {
      a.pause(); stopExtra(); extraEl = x; x.classList.add('ga-cur');
      extra.src = x.getAttribute('data-mp3'); extra.playbackRate = a.playbackRate; first();
      var p = extra.play(); if (p && p.catch) p.catch(function () {});
      return;
    }
    var l = e.target.closest('[data-l]'); if (l) playLine(+l.getAttribute('data-l'));
  });
  document.addEventListener('keydown', function (e) {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' && !e.target.closest('button,a,summary')) { e.preventDefault(); pb.click(); }
    else if (e.key === 'ArrowRight' && cur < T.length - 1) { e.preventDefault(); playLine(cur + 1); }
    else if (e.key === 'ArrowLeft' && cur > 0) { e.preventDefault(); playLine(cur - 1); }
  });

  var saved = +ls.get(KEY);
  if (saved > 1) {
    var i0 = lineAt(saved);
    a.addEventListener('loadedmetadata', function once() { a.removeEventListener('loadedmetadata', once); if (a.currentTime < 1 && T[i0]) a.currentTime = T[i0][0]; });
    mark(i0, false);
    time.textContent = fmt(saved) + ' / ' + fmt(+root.getAttribute('data-dur'));
  }
})();
