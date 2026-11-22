/* Tap a word in the audio pages' example sentences (grammar audio, vocabulary
 * list; build.js) — the practice pages' 生词本 card (site/quiz.js) on its own:
 * every [data-wsp] sentence gets its words ([surface, lemma] pairs) marked with
 * a dotted underline; a mouse hovers one for reading + meaning and clicks to
 * add it, a touch opens the same card as a sheet at the bottom. The dictionary
 * (#wt data-src: lemma → [reading, meaning] or → "部屋" alias) loads on first
 * use. Saved into jp_quiz_v1 `words` like the practice pages (synced by sync.js);
 * fires "jp-words" so the page can repaint. Clicks on a word don't reach the
 * player (no line starts). */
(function () {
  var cfg = document.getElementById('wt');
  if (!cfg) return;
  // Lesson pages: one #wt for both language copies (data-src-zh / data-src-en),
  // the page's own language picks; the audio pages say data-en / data-src.
  var EN = cfg.hasAttribute('data-en') ? cfg.getAttribute('data-en') === '1' : (document.documentElement.lang || '').indexOf('zh') !== 0;
  var SRC = cfg.getAttribute('data-src') || cfg.getAttribute(EN ? 'data-src-en' : 'data-src-zh');
  var LV = cfg.getAttribute('data-lv'), VIA = cfg.getAttribute('data-via') || 'audio_page', K = 'jp_quiz_v1';
  function t(z, e) { return EN ? e : z; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var HOVER = !!window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var css = document.createElement('style');
  css.textContent = '.q-w{cursor:pointer;text-decoration:underline dotted;text-decoration-color:var(--text-muted,#999);text-underline-offset:.25em;border-radius:3px}' +
    '.q-w:hover,.q-w.q-wsel{background:var(--ui-soft,#eef)}.q-w.q-won{text-decoration-style:solid;text-decoration-color:var(--ui,#334)}' +
    '.q-wtip{position:fixed;z-index:95;background:var(--bg,#fff);color:inherit;border:1px solid var(--border,#ddd);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:.7rem .9rem;font-size:.92rem}' +
    '.q-wtip.q-wsheet{left:0!important;right:0;bottom:0;top:auto!important;width:auto!important;border-radius:16px 16px 0 0;padding:1rem 1.1rem calc(1rem + env(safe-area-inset-bottom))}' +
    '.q-wtip-w{font-size:1.35rem;font-weight:700}.q-wtip-w rt{font-size:.55em;font-weight:400}.q-wtip-m{margin:.3rem 0 .6rem}.q-wtip-muted{color:var(--text-muted,#888);font-size:.85rem}' +
    '.q-wtip-add{font:inherit;font-size:.88rem;padding:.35rem .8rem;border-radius:8px;border:1px solid var(--ui,#334);background:var(--ui,#334);color:var(--ui-on,#fff);cursor:pointer}' +
    '.q-wtip-add.on{background:transparent;color:var(--ui,#334)}.q-wtip-go{color:var(--ui,#334);font-size:.88rem}.q-wtip-x{position:absolute;right:.6rem;top:.4rem;border:0;background:none;color:inherit;font-size:1.3rem;cursor:pointer}';
  document.head.appendChild(css);

  function ld() {
    try { var s = JSON.parse(localStorage.getItem(K)); if (s && s.v === 1) { s.words = s.words || {}; return s; } } catch (e) {}
    return { v: 1, answers: {}, review: {}, reported: [], session: null, days: {}, prefs: {}, mock: {}, cards: {}, cardDays: {}, fav: {}, words: {} };
  }
  function sv(s) { s.at = Date.now(); try { localStorage.setItem(K, JSON.stringify(s)); } catch (e) {} if (window.jpSync) window.jpSync.changed(); }
  var WD = null, wdP = null;
  function load() {
    if (!wdP) wdP = fetch(SRC).then(function (r) { return r.json(); }).then(function (d) { WD = d; return d; }).catch(function () { wdP = null; WD = {}; return {}; });
    return wdP;
  }
  function wordOf(w) { var e = WD && WD[w]; return typeof e === 'string' ? e : w; }
  function has(k) { var x = ld().words[k]; return !!x && x.t > 0; }
  function entry(w) {
    var k = wordOf(w), e = WD && WD[k], saved = ld().words[k];
    var r = e && typeof e === 'object' ? e[0] : saved && saved.r, m = e && typeof e === 'object' ? e[1] : saved && saved.m;
    return { k: k, r: r && r !== k ? r : '', m: m || '' };
  }

  // Mark the words in each sentence: wrap [surface, lemma] in order; a boundary
  // inside a <ruby> moves out to the whole ruby (same as quiz.js linkWords()).
  function link(el) {
    var sp; try { sp = JSON.parse(el.getAttribute('data-wsp')); } catch (e) { return; }
    var from = 0;
    sp.forEach(function (p) {
      var nodes = [], text = '', tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentNode.closest('rt, rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
      for (var n; (n = tw.nextNode());) { nodes.push([n, text.length]); text += n.nodeValue; }
      var at = text.indexOf(p[0], from);
      if (at < 0) return;
      from = at + p[0].length;
      var find = function (pos, end) {
        for (var i = 0; i < nodes.length; i++) { var a = nodes[i][1], b = a + nodes[i][0].nodeValue.length; if (end ? pos > a && pos <= b : pos >= a && pos < b) return [nodes[i][0], pos - a]; }
        return null;
      };
      var s = find(at, false), e = find(from, true);
      if (!s || !e || s[0].parentNode.closest('.q-w') || e[0].parentNode.closest('.q-w')) return;
      var r = document.createRange(), rs = s[0].parentNode.closest('ruby'), re = e[0].parentNode.closest('ruby');
      if (rs && el.contains(rs)) r.setStartBefore(rs); else r.setStart(s[0], s[1]);
      if (re && el.contains(re)) r.setEndAfter(re); else r.setEnd(e[0], e[1]);
      var span = document.createElement('span');
      span.className = 'q-w'; span.setAttribute('data-k', p[1]); span.setAttribute('role', 'button'); span.setAttribute('tabindex', '0');
      try { span.appendChild(r.extractContents()); r.insertNode(span); } catch (x) {}
    });
  }
  [].forEach.call(document.querySelectorAll('[data-wsp]'), link);
  function paint() {
    var W = ld().words;
    [].forEach.call(document.querySelectorAll('.q-w'), function (s) { var x = W[wordOf(s.getAttribute('data-k'))]; s.classList.toggle('q-won', !!x && x.t > 0); });
  }
  paint();
  addEventListener('storage', paint);
  addEventListener('jp-words', paint);

  var tip = null, tipFor = null, hideT = 0;
  function tipEl() {
    if (tip) return tip;
    tip = document.createElement('div'); tip.className = 'q-wtip' + (HOVER ? '' : ' q-wsheet'); tip.hidden = true; tip.setAttribute('role', 'dialog');
    tip.addEventListener('mouseenter', function () { clearTimeout(hideT); });
    tip.addEventListener('mouseleave', hideSoon);
    tip.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target.closest('.q-wtip-x')) return hide();
      if (e.target.closest('.q-wtip-add')) { toggle(tip.getAttribute('data-k')); show(tipFor); if (!HOVER && has(wordOf(tip.getAttribute('data-k')))) setTimeout(hide, 700); }
    });
    document.body.appendChild(tip);
    return tip;
  }
  function hide() { if (tip) tip.hidden = true; if (tipFor) tipFor.classList.remove('q-wsel'); tipFor = null; }
  function hideSoon() { clearTimeout(hideT); hideT = setTimeout(hide, 250); }
  function place(box, el) {
    if (!HOVER) return;
    var r = el.getBoundingClientRect(), h = box.offsetHeight || 120, w = Math.min(320, innerWidth - 16);
    box.style.width = w + 'px';
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    box.style.top = Math.max(8, r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  }
  function show(el) {
    if (!el) return;
    clearTimeout(hideT);
    var w = el.getAttribute('data-k'), box = tipEl();
    if (tipFor && tipFor !== el) tipFor.classList.remove('q-wsel');
    tipFor = el; el.classList.add('q-wsel');
    box.setAttribute('data-k', w); box.hidden = false;
    if (!WD) box.innerHTML = '<span class="q-wtip-muted">…</span>';
    place(box, el);
    load().then(function () {
      if (tipFor !== el) return;
      var e = entry(w), on = has(e.k);
      box.innerHTML = (HOVER ? '' : '<button class="q-wtip-x" aria-label="' + t('关闭', 'Close') + '">×</button>') +
        '<div class="q-wtip-w" lang="ja">' + (e.r ? '<ruby>' + esc(e.k) + '<rp>(</rp><rt>' + esc(e.r) + '</rt><rp>)</rp></ruby>' : esc(e.k)) + '</div>' +
        (e.m ? '<div class="q-wtip-m">' + esc(e.m) + '</div>' : '<div class="q-wtip-m q-wtip-muted">' + t('释义还在补充中', 'Meaning coming soon') + '</div>') +
        '<button class="q-wtip-add' + (on ? ' on' : '') + '">' + (on ? t('✓ 已在生词本（点击移除）', '✓ In your word list (remove)') : t('＋ 加入生词本', '＋ Add to word list')) + '</button>' +
        (HOVER && !on ? '<div class="q-wtip-muted" style="margin-top:.35rem">' + t('也可以直接点这个词', 'or just click the word') + '</div>' : '') +
        // where the list is reviewed: the level's practice page, flashcards (#words)
        (on ? '<div style="margin-top:.45rem"><a class="q-wtip-go" href="/' + (EN ? '' : 'zh/') + 'words/' + (LV ? '#' + LV.toLowerCase() : '') + '">' + t('去生词本背单词 →', 'Study your word list →') + '</a></div>' : '');
      place(box, el);
    });
  }
  function toggle(w) {
    var e = entry(w), s = ld(), on = !!s.words[e.k] && s.words[e.k].t > 0, n = Date.now();
    s.words[e.k] = on ? { t: -n, q: (s.words[e.k] || {}).q } : { t: n, a: n, q: '', r: e.r, m: e.m, k: 0, due: n, lv: (LV || '').toUpperCase() };
    sv(s); paint();
    try { dispatchEvent(new Event('jp-words')); } catch (x) {}
    if (window.gaEvent) window.gaEvent(on ? 'word_remove' : 'word_add', { level: LV, via: VIA });
  }
  // capture: a click on a word never reaches the player's line handler
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.q-w');
    if (!el) { if (tip && !tip.hidden && !e.target.closest('.q-wtip')) hide(); return; }
    e.stopPropagation(); e.preventDefault();
    if (!HOVER) { if (tipFor === el && !tip.hidden) hide(); else show(el); return; }
    load().then(function () { toggle(el.getAttribute('data-k')); show(el); });
  }, true);
  if (HOVER) {
    document.addEventListener('mouseover', function (e) { var el = e.target.closest && e.target.closest('.q-w'); if (el) show(el); });
    document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('.q-w')) hideSoon(); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tip && !tip.hidden) hide();
    var el = e.target.closest && e.target.closest('.q-w');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); el.click(); }
  }, true);
})();
