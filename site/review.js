/* /review/ — 复习 › 错题: the practice pages' review lists, every level on one
 * page. jp_quiz_v1 review[question id] = { lv, due, src } (quiz.js: a miss or a
 * guess puts a question in, each right answer pushes it further out); the id's
 * prefix (n3-…) is its level. Doing the questions stays on the level's practice
 * page: #review starts a set of the due ones, #reviewlist opens the list. */
(function () {
  var app = document.getElementById('rv-app');
  if (!app) return;
  var EN = (document.documentElement.lang || '').indexOf('zh') !== 0, LV = ['N5', 'N4', 'N3', 'N2', 'N1'];
  function t(z, e) { return EN ? e : z; }
  function state() { try { var s = JSON.parse(localStorage.getItem('jp_quiz_v1')); return s && s.v === 1 ? s : {}; } catch (e) { return {}; } }
  function render() {
    // review[id].due is in SECONDS (quiz.js now())
    var R = state().review || {}, now = Date.now() / 1000, by = {}, all = 0, dueAll = 0, next = {};
    LV.forEach(function (l) { by[l] = { n: 0, due: 0 }; });
    Object.keys(R).forEach(function (id) {
      var m = /^n([1-5])-/.exec(id), r = R[id]; if (!m || !r) return;
      var l = 'N' + m[1], b = by[l]; b.n++; all++;
      if ((r.due || 0) <= now) { b.due++; dueAll++; } else if (!next[l] || r.due < next[l]) next[l] = r.due;
    });
    var base = EN ? '/' : '/zh/';
    if (!all) {
      app.innerHTML = '<div class="wb-empty"><p>' + t('错题本是空的。', 'Your review list is empty.') + '</p><p class="wb-muted">' +
        t('练习里答错、选了「不会」或者标了「其实是猜的」的题会自动进来，按间隔提醒你再做一遍：答对一次就往后推，直到真的会了。', 'Questions you miss, answer “don’t know” to, or mark as a guess in practice land here, and come back at growing intervals until you have them.') +
        ' <a href="' + base + 'practice/">' + t('去做题 →', 'Start practising →') + '</a></p></div>';
      return;
    }
    var h = '<div class="wb-sum"><span>' + t('今天要做的错题 <b>' + dueAll + '</b> 道 · 错题本一共 ' + all + ' 道', '<b>' + dueAll + '</b> due today · ' + all + ' in your review lists') + '</span></div><ul class="wb-list rv-list">';
    LV.forEach(function (l) {
      var b = by[l]; if (!b.n) return;
      var lv = l.toLowerCase(), days = next[l] ? Math.max(1, Math.round((next[l] - now) / 86400)) : 0;
      h += '<li><div class="wb-w"><span class="wb-lv rv-lv">' + l + '</span></div><div class="wb-m">' +
        (b.due ? t('今天到期 <b>' + b.due + '</b> 道', '<b>' + b.due + '</b> due today') : t('今天没有到期的', 'Nothing due today') + (days ? t('（下一道 ' + days + ' 天后）', ' (next in ' + days + ' d)') : '')) +
        '<div class="wb-meta">' + t('错题本 ' + b.n + ' 道', b.n + ' in the list') + '</div></div><span class="wb-acts">' +
        '<a class="wb-btn' + (b.due ? ' wb-primary' : '') + '" href="' + base + lv + '-practice/#review">' + (b.due ? t('做到期的错题', 'Do the due ones') : t('提前复习', 'Review early')) + '</a>' +
        '<a class="wb-btn" href="' + base + lv + '-practice/#reviewlist">' + t('看错题本', 'See the list') + '</a></span></li>';
    });
    app.innerHTML = h + '</ul><p class="wb-muted rv-note">' + t('做题在各级别的练习页上，用的是练习页的错题复习：答对一次就往后推，连续答对几次就移出错题本。', 'You answer them on each level’s practice page, with its review schedule: each right answer pushes a question further out, and a few in a row take it off the list.') + '</p>';
  }
  render();
  addEventListener('storage', function (e) { if (e.key === 'jp_quiz_v1') render(); });
  addEventListener('pageshow', render);   // back from a practice page
  if (window.gaEvent) window.gaEvent('review_hub_view', {});
})();
