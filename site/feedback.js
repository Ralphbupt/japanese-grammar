/* Reader feedback, on every page.
 *
 * A "💬 反馈 / 建议" box: inline wherever the page has #quiz-feedback (the
 * practice / mock / card / hub pages, and above the comments on lessons),
 * and opened on demand by any .fb-open link (the footer's 💬 反馈). Also
 * window.jpFeedback.send() for quiz.js's "这题有问题？". Notes go to the
 * Worker behind ai.jpnotes.dev (POST /feedback → D1): the text, the page,
 * and for a question its id, the option picked and the reason. Nothing else.
 * The styles are injected here so the box works on pages without quiz.css.
 * Testing against `wrangler dev`: open the page with ?fb=local.
 */
(function () {
  'use strict';
  var EN = document.documentElement.getAttribute('data-force-lang') !== 'zh';
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]fb=local\b/.test(location.search);
  var URL = LOCAL ? 'http://localhost:8787/feedback' : 'https://ai.jpnotes.dev/feedback';
  function t(zh, en) { return EN ? en : zh; }

  function send(payload) {
    payload.page = location.pathname;
    payload.lang = EN ? 'en' : 'zh';
    return fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.message || 'HTTP ' + r.status); return j; }); });
  }
  window.jpFeedback = { send: send };

  var CSS = '#quiz-feedback{margin:2.5rem 0 1rem}' +
    '.fb summary{cursor:pointer;color:var(--text-muted)}' +
    '.fb[open] summary{color:var(--text)}' +
    '.fb-note{color:var(--text-muted);font-size:.9em}' +
    '.fb textarea{width:100%;box-sizing:border-box;padding:.5rem .7rem;border:1px solid var(--border);border-radius:var(--radius,6px);background:var(--bg);color:var(--text);font:inherit;resize:vertical}' +
    '.fb-row{display:flex;align-items:center;gap:.8rem;margin-top:.5rem}' +
    '.fb-send{padding:.5em 1.1em;border:1px solid var(--accent);border-radius:var(--radius,6px);background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}' +
    '.fb-send:disabled{opacity:.6;cursor:default}' +
    '.fb-msg{color:var(--text-muted);font-size:.9em}';
  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  // What the note under the summary says depends on the page.
  function note(box) {
    if (box.getAttribute('data-fb') === 'lesson')
      return t('哪里讲错了、例句不自然、翻译不对、看不懂，都可以直接写，不用登录 GitHub。匿名，只收你写的内容和当前页面。',
        'Something wrong, an unnatural example, a bad translation, or just unclear? Write it here — no GitHub account needed. Anonymous: only what you write and this page are sent.');
    return t('题目哪里不对、哪里不好用、想要什么功能，都可以写。匿名，只收你写的内容和当前页面。',
      'Anything wrong, awkward or missing — tell us. Anonymous: only what you write and this page are sent.');
  }

  function render(box) {
    if (box.querySelector('.fb')) return box.querySelector('.fb');
    var lesson = box.getAttribute('data-fb') === 'lesson';
    box.innerHTML = '<details class="fb"><summary>💬 ' + (lesson ? t('这一课有问题？反馈给作者', 'Spotted a problem in this lesson? Tell us') : t('反馈 / 建议', 'Feedback / suggestions')) + '</summary>' +
      '<p class="fb-note">' + note(box) + '</p>' +
      '<textarea maxlength="1000" rows="4" placeholder="' + t('写点什么……', 'Write something…') + '"></textarea>' +
      '<div class="fb-row"><button class="fb-send" type="button">' + t('发送', 'Send') + '</button><span class="fb-msg" aria-live="polite"></span></div></details>';
    var ta = box.querySelector('textarea'), btn = box.querySelector('button'), msg = box.querySelector('.fb-msg');
    btn.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      btn.disabled = true; msg.textContent = t('发送中…', 'Sending…');
      send({ kind: 'general', text: text }).then(function () {
        ta.value = ''; msg.textContent = t('收到了，谢谢！', 'Got it — thank you!');
        if (window.gaEvent) window.gaEvent('feedback_send', { kind: 'general' });
      }).catch(function (e) {
        msg.textContent = t('没发出去：', 'Couldn’t send: ') + e.message;
      }).then(function () { btn.disabled = false; });
    });
    return box.querySelector('.fb');
  }

  var box = document.getElementById('quiz-feedback');
  if (box) render(box);

  // Footer link: open the page's box, or add one just above the footer.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.fb-open');
    if (!a) return;
    e.preventDefault();
    var b = document.getElementById('quiz-feedback');
    if (!b) {
      b = document.createElement('div');
      b.id = 'quiz-feedback';
      var foot = document.querySelector('.site-footer');
      foot.parentNode.insertBefore(b, foot);
    }
    var d = render(b);
    d.open = true;
    d.scrollIntoView({ block: 'center', behavior: 'smooth' });
    d.querySelector('textarea').focus({ preventScroll: true });
    if (window.gaEvent) window.gaEvent('feedback_open', { from: 'footer' });
  });
})();
