/* Reader feedback, on every page.
 *
 * A "💬 反馈 / 建议" box: inline wherever the page has #quiz-feedback (the
 * practice / mock / card / hub pages, and above the comments on lessons),
 * and opened on demand by any .fb-open link (the footer's 💬 反馈). Also
 * window.jpFeedback.send() for quiz.js's "这题有问题？". Notes go to the
 * Worker behind ai.jpnotes.dev (POST /feedback → D1): the text, the page,
 * and for a question its id, the option picked and the reason; the browser's
 * random reply id (localStorage jp_fb_rid, also kept in the synced progress
 * as fbRids so a signed-in reader sees replies on every device); an email
 * address only when the reader types one.
 * Replies (written at admin.jpnotes.dev) come back through POST
 * /feedback/replies: checked at most hourly while a note is unanswered, daily
 * otherwise, shown once as a notice and listed in the box afterwards.
 * The styles are injected here so the box works on pages without quiz.css.
 * Testing against `wrangler dev`: open the page with ?fb=local.
 */
(function () {
  'use strict';
  var EN = document.documentElement.getAttribute('data-force-lang') !== 'zh';
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]fb=local\b/.test(location.search);
  var URL = LOCAL ? 'http://localhost:8787/feedback' : 'https://ai.jpnotes.dev/feedback';
  function t(zh, en) { return EN ? en : zh; }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    json: function (k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  };

  // ─── Reply ids ───
  // This browser's id, made on the first note. Signed-in readers' other
  // devices' ids arrive in the synced progress (jp_quiz_v1.fbRids).
  function quizState() {
    if (window.jpQuizState) return window.jpQuizState.get();
    var s = ls.json('jp_quiz_v1', null);
    return s && s.v === 1 ? s : null;
  }
  function myRid() {
    var r = ls.get('jp_fb_rid');
    if (!/^[0-9a-f]{20}$/.test(r || '')) {
      var b = new Uint8Array(10); crypto.getRandomValues(b);
      r = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
      ls.set('jp_fb_rid', r);
    }
    // Into the synced progress, so the account carries it to the other devices.
    var s = window.jpQuizState ? window.jpQuizState.get() : (ls.json('jp_quiz_v1', null) || { v: 1, answers: {}, review: {}, reported: [], session: null, days: {}, prefs: {}, mock: {}, cards: {}, cardDays: {} });
    if (s.v === 1 && (s.fbRids || []).indexOf(r) < 0) {
      s.fbRids = (s.fbRids || []).concat(r).slice(-20); s.at = Date.now();
      ls.set('jp_quiz_v1', JSON.stringify(s));
      if (window.jpSync) window.jpSync.changed();
    }
    return r;
  }
  function allRids() {
    var own = ls.get('jp_fb_rid'), s = quizState(), out = (s && s.fbRids) || [];
    if (own && out.indexOf(own) < 0) out = out.concat(own);
    return out.filter(function (r) { return /^[0-9a-f]{20}$/.test(r); }).slice(-20);
  }
  // The address to suggest: the last one typed, else the signed-in account's.
  function knownEmail() {
    return ls.get('jp_fb_email') || (ls.json('jp_acct', {}).email || '');
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  function send(payload) {
    payload.page = location.pathname;
    payload.lang = EN ? 'en' : 'zh';
    payload.rid = myRid();
    var em = (payload.email || '').trim();
    if (em && EMAIL_RE.test(em)) { payload.email = em; ls.set('jp_fb_email', em); } else delete payload.email;
    ls.set('jp_fb_pending', '1'); ls.set('jp_fb_checked', String(Date.now()));   // the next check is an hour from now
    return fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.message || 'HTTP ' + r.status); return j; }); });
  }
  // The optional email field, for this box and quiz.js's report box.
  function emailField(cls) {
    return '<label class="fb-email ' + (cls || '') + '"><span>' + t('想收到回复的邮件？留个邮箱（选填）', 'Want an email when I reply? Your address (optional)') + '</span>' +
      '<input type="email" maxlength="200" autocomplete="email" placeholder="name@example.com" value="' + esc(knownEmail()) + '"></label>';
  }
  function sentNote(email) {
    return email ? t('收到了，谢谢！回复会显示在这个网站上，也会发到你的邮箱。', 'Got it — thank you! The reply will show on this site and be emailed to you.')
      : t('收到了，谢谢！回复会显示在这个网站上（同一个浏览器，或登录后的任何设备）。', 'Got it — thank you! The reply will show on this site (in this browser, or on any device once you sign in).');
  }
  window.jpFeedback = { send: send, emailField: emailField, sentNote: sentNote };

  var CSS = '#quiz-feedback{margin:2.5rem 0 1rem}' +
    '.fb summary{cursor:pointer;color:var(--text-muted)}' +
    '.fb[open] summary{color:var(--text)}' +
    '.fb-note{color:var(--text-muted);font-size:.9em}' +
    '.fb textarea{width:100%;box-sizing:border-box;padding:.5rem .7rem;border:1px solid var(--border);border-radius:var(--radius,6px);background:var(--bg);color:var(--text);font:inherit;resize:vertical}' +
    '.fb-row{display:flex;align-items:center;gap:.8rem;margin-top:.5rem}' +
    '.fb-send{padding:.5em 1.1em;border:1px solid var(--ui,var(--accent));border-radius:var(--radius,6px);background:var(--ui,var(--accent));color:var(--ui-on,#fff);font:inherit;font-weight:600;cursor:pointer}' +
    '.fb-send:disabled{opacity:.6;cursor:default}' +
    '.fb-msg{color:var(--text-muted);font-size:.9em}' +
    '.fb-email{display:block;margin-top:.5rem;font-size:.9em;color:var(--text-muted)}' +
    '.fb-email input{display:block;width:100%;max-width:22rem;box-sizing:border-box;margin-top:.25rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius,6px);background:var(--bg);color:var(--text);font:inherit}' +
    '.fb-mine{margin-top:1rem;font-size:.95em}' +
    '.fb-r{border-left:3px solid var(--ui,var(--link));padding:.2rem 0 .2rem .8rem;margin:.8rem 0}' +
    '.fb-r-q{color:var(--text-muted);font-size:.9em;margin:0 0 .3rem}' +
    '.fb-r-a{margin:0;white-space:pre-wrap}' +
    '.fb-r-meta{color:var(--text-muted);font-size:.8em;margin:.3rem 0 0}' +
    '.fb-toast{position:fixed;right:16px;bottom:16px;z-index:60;width:min(420px,calc(100vw - 32px));max-height:70vh;overflow:auto;box-sizing:border-box;padding:1rem 1.1rem;border:1px solid var(--border);border-radius:var(--radius,8px);background:var(--surface-2,var(--bg));color:var(--text);box-shadow:0 8px 28px rgba(0,0,0,.25)}' +
    '.fb-toast h2{font-size:1rem;margin:0 0 .4rem}' +
    '.fb-toast .fb-send{margin-top:.6rem}';
  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  // What the note under the summary says depends on the page.
  function note(box) {
    if (box.getAttribute('data-fb') === 'lesson')
      return t('哪里讲错了、例句不自然、翻译不对、看不懂，都可以直接写，不用登录 GitHub。匿名，只收你写的内容、当前页面和你选填的邮箱。回复会显示在本站上。',
        'Something wrong, an unnatural example, a bad translation, or just unclear? Write it here — no GitHub account needed. Anonymous: only what you write, this page and the email you choose to leave are sent. Replies show on this site.');
    return t('题目哪里不对、哪里不好用、想要什么功能，都可以写。匿名，只收你写的内容、当前页面和你选填的邮箱。回复会显示在本站上。',
      'Anything wrong, awkward or missing — tell us. Anonymous: only what you write, this page and the email you choose to leave are sent. Replies show on this site.');
  }

  function render(box) {
    if (box.querySelector('.fb')) return box.querySelector('.fb');
    var lesson = box.getAttribute('data-fb') === 'lesson';
    box.innerHTML = '<details class="fb"><summary>💬 ' + (lesson ? t('这一课有问题？反馈给作者', 'Spotted a problem in this lesson? Tell us') : t('反馈 / 建议', 'Feedback / suggestions')) + '</summary>' +
      '<p class="fb-note">' + note(box) + '</p>' +
      '<textarea maxlength="1000" rows="4" placeholder="' + t('写点什么……', 'Write something…') + '"></textarea>' + emailField() +
      '<div class="fb-row"><button class="fb-send" type="button">' + t('发送', 'Send') + '</button><span class="fb-msg" aria-live="polite"></span></div>' +
      '<div class="fb-mine"></div></details>';
    var ta = box.querySelector('textarea'), btn = box.querySelector('.fb-send'), msg = box.querySelector('.fb-msg'), em = box.querySelector('.fb-email input');
    mine(box);
    btn.addEventListener('click', function () {
      var text = ta.value.trim(), email = em.value.trim();
      if (!text) { ta.focus(); return; }
      if (email && !EMAIL_RE.test(email)) { msg.textContent = t('邮箱好像不对，可以留空。', 'That email doesn’t look right — it can be left empty.'); em.focus(); return; }
      btn.disabled = true; msg.textContent = t('发送中…', 'Sending…');
      send({ kind: 'general', text: text, email: email }).then(function () {
        ta.value = ''; msg.textContent = sentNote(email);
        if (window.gaEvent) window.gaEvent('feedback_send', { kind: 'general' });
      }).catch(function (e) {
        msg.textContent = t('没发出去：', 'Couldn’t send: ') + e.message;
      }).then(function () { btn.disabled = false; });
    });
    return box.querySelector('.fb');
  }

  // ─── Replies ───
  function replyHtml(r) {
    return '<div class="fb-r">' + (r.text ? '<p class="fb-r-q">' + t('你写的：', 'You wrote: ') + esc(r.text.length > 140 ? r.text.slice(0, 140) + '…' : r.text) + '</p>' : '') +
      '<p class="fb-r-a">' + esc(r.reply) + '</p>' +
      '<p class="fb-r-meta">' + esc((r.replied_at || '').slice(0, 10)) + (r.page ? ' · <a href="' + esc(r.page) + '">' + esc(r.page) + '</a>' : '') + (r.qid ? ' · ' + esc(r.qid) : '') + '</p></div>';
  }
  // Earlier replies, inside the box.
  function mine(box) {
    var el = box.querySelector('.fb-mine'), list = ls.json('jp_fb_replies', []);
    if (!el) return;
    el.innerHTML = list.length ? '<details><summary>' + t('作者给你的回复（' + list.length + '）', 'Replies to your feedback (' + list.length + ')') + '</summary>' + list.map(replyHtml).join('') + '</details>' : '';
  }
  function toast(fresh) {
    var d = document.createElement('div');
    d.className = 'fb-toast'; d.setAttribute('role', 'status');
    d.innerHTML = '<h2>💬 ' + t('作者回复了你的反馈', 'A reply to your feedback') + '</h2>' + fresh.map(replyHtml).join('') +
      '<button class="fb-send" type="button">' + t('知道了', 'Got it') + '</button>';
    document.body.appendChild(d);
    d.querySelector('.fb-send').addEventListener('click', function () {
      var seen = ls.json('jp_fb_seen', []);
      fresh.forEach(function (r) { if (seen.indexOf(r.id) < 0) seen.push(r.id); });
      ls.set('jp_fb_seen', JSON.stringify(seen.slice(-200)));
      d.remove();
    });
    if (window.gaEvent) window.gaEvent('feedback_reply_seen', { n: fresh.length });
  }
  function checkReplies() {
    var rids = allRids();
    if (!rids.length) return;
    var last = +ls.get('jp_fb_checked') || 0, wait = ls.get('jp_fb_pending') === '1' ? 3600e3 : 86400e3;
    if (Date.now() - last < wait && !/[?&]fb=check\b/.test(location.search)) return;
    ls.set('jp_fb_checked', String(Date.now()));
    fetch(URL + '/replies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rids: rids }) })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j || !j.ok) return;
        ls.set('jp_fb_pending', j.pending ? '1' : '0');
        ls.set('jp_fb_replies', JSON.stringify(j.replies));
        var seen = ls.json('jp_fb_seen', []), fresh = j.replies.filter(function (r) { return seen.indexOf(r.id) < 0; });
        if (fresh.length) toast(fresh);
        var b = document.getElementById('quiz-feedback'); if (b) mine(b);
      }).catch(function () {});
  }

  var box = document.getElementById('quiz-feedback');
  if (box) render(box);
  // After the page has settled: not in the way of anything the page loads first.
  setTimeout(checkReplies, 2500);

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
