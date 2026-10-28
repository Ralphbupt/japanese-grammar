/* Reader feedback on the practice, mock test, flashcard and /practice/ pages.
 *
 * A "💬 反馈 / 建议" box at the bottom (into #quiz-feedback), and
 * window.jpFeedback.send() for quiz.js's "这题有问题？". Notes go to the
 * Worker behind ai.jpnotes.dev (POST /feedback → D1): the text, the page,
 * and for a question its id, the option picked and the reason. Nothing else.
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

  var box = document.getElementById('quiz-feedback');
  if (!box) return;
  box.innerHTML = '<details class="fb"><summary>💬 ' + t('反馈 / 建议', 'Feedback / suggestions') + '</summary>' +
    '<p class="fb-note">' + t('题目哪里不对、哪里不好用、想要什么功能，都可以写。匿名，只收你写的内容和当前页面。', 'Anything wrong, awkward or missing — tell us. Anonymous: only what you write and this page are sent.') + '</p>' +
    '<textarea maxlength="1000" rows="4" placeholder="' + t('写点什么……', 'Write something…') + '"></textarea>' +
    '<div class="fb-row"><button class="q-btn q-btn-primary" type="button">' + t('发送', 'Send') + '</button><span class="fb-msg" aria-live="polite"></span></div></details>';
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
})();
