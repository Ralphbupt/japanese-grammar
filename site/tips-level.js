/* /jlpt-test-tips/ only (build.js inlines it there): "my level" chips under the
 * title. The chosen level (localStorage jp_tips_lv; at first the level of the
 * question this browser answered last, from jp_quiz_v1) gets its column
 * marked in every N5…N1 table, the other levels' lines of a per-level list
 * hidden, and a "practise this with N3 questions" link under each technique
 * that has a question type at that level. GA tip_level / tip_practice. */
(function () {
  var LV = ['N5', 'N4', 'N3', 'N2', 'N1'];
  var ZH = location.pathname.indexOf('/zh/') === 0, base = ZH ? '/zh/' : '/';
  var t = function (zh, en) { return ZH ? zh : en; };
  var ga = function (n, p) { try { if (window.gaEvent) window.gaEvent(n, p); } catch (e) {} };
  var h1 = document.querySelector('main h1') || document.querySelector('h1');
  if (!h1) return;
  // Section heading → question type, and the levels that have that type.
  var ALL = LV, SECTIONS = [
    [/排序|Sentence Order/, 'narabe', ALL],
    [/課題理解|Task-Based/, 'kadai', ALL],
    [/ポイント理解|Point Items/, 'point', ALL],
    [/概要理解|Summary Items/, 'gaiyou', ['N3', 'N2', 'N1']],
    [/発話表現|Utterance/, 'hatsuwa', ['N5', 'N4', 'N3']],
    [/即時応答|Quick Response/, 'sokuji', ALL],
    [/統合理解|Integrated Listening/, 'ctougou', ['N2', 'N1']],
    [/先题后文|Question First/, 'reading', ALL],
  ];
  function readType(lv) { return lv === 'N5' || lv === 'N4' ? 'short' : 'mid'; }
  function guess() {
    try { var v = localStorage.getItem('jp_tips_lv'); if (LV.indexOf(v) >= 0) return v; } catch (e) {}
    try {
      var s = JSON.parse(localStorage.getItem('jp_quiz_v1') || 'null'), best = 0, lv = null;
      Object.keys((s && s.answers) || {}).forEach(function (id) {
        var a = s.answers[id], x = a && a.length ? +a[a.length - 1].t || 0 : 0, m = /^n([1-5])-/.exec(id);
        if (m && x > best) { best = x; lv = 'N' + m[1]; }
      });
      return lv;
    } catch (e) { return null; }
  }
  var css = document.createElement('style');
  css.textContent = '.tl-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin:.2rem 0 1.2rem;font-size:.92rem}' +
    '.tl-bar button{font:inherit;padding:.25em .8em;border:1px solid var(--border);border-radius:999px;background:var(--surface-2,transparent);color:var(--text);cursor:pointer}' +
    '.tl-bar button[aria-pressed="true"]{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}' +
    'td.tl-on,th.tl-on{background:var(--ui-soft);font-weight:600}' +
    '.tl-go{margin:.2rem 0 1rem}.tl-go a{display:inline-block;padding:.35em .9em;border:1px solid var(--ui);border-radius:6px;text-decoration:none;font-size:.92rem}';
  document.head.appendChild(css);
  var bar = document.createElement('div');
  bar.className = 'tl-bar';
  bar.innerHTML = '<span>' + t('我的级别：', 'My level: ') + '</span>' + LV.map(function (l) { return '<button type="button" data-lv="' + l + '">' + l + '</button>'; }).join('') +
    '<button type="button" data-lv="">' + t('全部', 'All') + '</button>';
  h1.parentNode.insertBefore(bar, h1.nextSibling);
  var main = h1.closest('main') || document.body;
  // Per-level list items ("N3：…" / "N3: …"), and per-level table columns.
  var items = [].filter.call(main.querySelectorAll('li'), function (li) { return /^\s*N[1-5]\s*[：:]/.test(li.textContent); });
  var tables = [].map.call(main.querySelectorAll('table'), function (tb) {
    var head = tb.querySelector('tr'), cols = {};
    if (!head) return null;
    [].forEach.call(head.children, function (c, i) { var m = /^\s*(N[1-5])\s*$/.exec(c.textContent); if (m) cols[m[1]] = i; });
    return Object.keys(cols).length >= 3 ? { tb: tb, cols: cols } : null;
  }).filter(Boolean);
  var heads = [].filter.call(main.querySelectorAll('h2, h3'), function (h) { return SECTIONS.some(function (s) { return s[0].test(h.textContent); }); });
  function apply(lv) {
    [].forEach.call(bar.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lv') === (lv || ''))); });
    items.forEach(function (li) { li.hidden = !!lv && li.textContent.trim().indexOf(lv) !== 0; });
    tables.forEach(function (x) {
      [].forEach.call(x.tb.rows, function (r) {
        LV.forEach(function (l) { var c = r.children[x.cols[l]]; if (c) c.classList.toggle('tl-on', l === lv); });
      });
    });
    [].forEach.call(main.querySelectorAll('.tl-go'), function (el) { el.remove(); });
    if (!lv) return;
    heads.forEach(function (h) {
      var s = SECTIONS.filter(function (x) { return x[0].test(h.textContent); })[0];
      if (s[2].indexOf(lv) < 0) return;
      var type = s[1] === 'reading' ? readType(lv) : s[1];
      var p = document.createElement('p');
      p.className = 'tl-go';
      p.innerHTML = '<a href="' + base + lv.toLowerCase() + '-practice/#type=' + type + '" data-tip="' + type + '">' + t('用 ' + lv + ' 的题练这个 →', 'Practise this with ' + lv + ' questions →') + '</a>';
      // after the section's first paragraph or list, so the method comes first
      var at = h.nextElementSibling;
      while (at && !/^(P|UL|OL|DIV|H2|H3)$/.test(at.tagName)) at = at.nextElementSibling;
      (at && !/^H[23]$/.test(at.tagName) ? at : h).insertAdjacentElement('afterend', p);
    });
  }
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-lv]');
    if (!b) return;
    var lv = b.getAttribute('data-lv');
    try { if (lv) localStorage.setItem('jp_tips_lv', lv); else localStorage.removeItem('jp_tips_lv'); } catch (x) {}
    ga('tip_level', { level: lv || 'all' });
    apply(lv);
  });
  main.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var m = /\/(n[1-5])-(practice|listening|mock-test)\/(?:#type=(\w+))?/.exec(a.getAttribute('href'));
    if (m) ga('tip_practice', { level: m[1].toUpperCase(), tip: a.getAttribute('data-tip') || m[3] || m[2], from: a.hasAttribute('data-tip') ? 'section' : 'link' });
  });
  apply(guess());
})();
