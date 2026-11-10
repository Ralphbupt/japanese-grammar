/* AI tutor side panel — "问 AI / Ask AI".
 *
 * A right-hand drawer on every page. It talks to the site's free relay
 * (ai.jpnotes.dev, see worker/), which serves Claude Haiku with per-reader
 * daily limits; there is nothing to set up and no key anywhere in the
 * browser. Three modes: on a lesson page the lesson's text (or just the
 * grammar point being read, see "context") is sent as the system prompt, so
 * questions can be asked "in place" — including by selecting any text in the
 * lesson and clicking the floating 💬 问 AI chip, or the 讲解 button after
 * any example sentence; on practice / mock pages quiz.js hands over the
 * question just answered (window.jpAI.explain); everywhere else it is a
 * general Japanese tutor with no page context.
 *
 * Requests are OpenAI-style /chat/completions and stream token by token.
 * Chat history, the quiz explanation log and flagged answers stay in this
 * browser's localStorage.
 */
(function () {
  'use strict';
  var article = document.querySelector('article.lesson');
  // Practice / mock test pages: no lesson; the context is the question being
  // explained, set by quiz.js through window.jpAI.explain() after an answer.
  var quizApp = document.getElementById('quiz-app');
  var QUIZ = !article && !!quizApp && quizApp.getAttribute('data-mode') !== 'cards';
  // Every other page (home, overviews, hubs, flashcards): a general tutor with no page context.
  var GENERAL = !article && !QUIZ;
  if (!window.fetch || !window.ReadableStream) return;
  if (!article) article = document.createElement('article');
  document.body.classList.add('has-ai');

  var CFG_KEY = 'jp_ai_cfg';          // { v: 3, effort }; absent = standard depth
  var HIST_KEY = 'jp_ai_hist:' + location.pathname.replace(/^\/zh\//, '/');  // /zh/ copy shares the lesson's history
  var MAX_CONTEXT_CHARS = 30000;
  var MAX_HISTORY_MSGS = 24;          // kept per lesson (12 turns); older ones are dropped
  var SEND_TURNS = 2;                 // turns sent with each request: earlier answers are the bulk of a follow-up's tokens

  // The site's free relay (worker/, a Cloudflare Worker) is the only backend.
  // It chooses the model itself (Claude Haiku; a backup model where Claude is
  // not available or its daily budget is spent); `model` is just what the
  // request names. build.js reads the `base:` URL here for the CSP connect-src.
  var RELAY = { base: 'https://ai.jpnotes.dev/v1', model: 'claude-haiku-5-5' };
  // The live relay only answers jpnotes.dev; on localhost, ?ai=local (or the
  // feedback box's ?fb=local) talks to `wrangler dev` instead.
  var LOCAL_RELAY = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&](ai|fb)=local\b/.test(location.search);
  var RELAY_URL = LOCAL_RELAY ? 'http://localhost:8787/v1' : RELAY.base;
  var MODEL_ID = 'jpnotes/' + RELAY.model;   // how an answer's origin is recorded in the flag list and the quiz log

  /* ── config ──
   * Only the thinking depth is kept. Until 2026-11 readers could add their own
   * provider API keys (config v1/v2, in localStorage or sessionStorage, plus a
   * cache of model lists); whatever is left of that is deleted on load and a
   * stored key is never read or sent. */
  function saveCfg(c) {
    try {
      if (c.effort) localStorage.setItem(CFG_KEY, JSON.stringify({ v: 3, effort: c.effort }));
      else localStorage.removeItem(CFG_KEY);
    } catch (e) {}
  }
  function loadCfg() {
    var c = { v: 3, effort: '' }, stored = null, session = null;
    try { stored = localStorage.getItem(CFG_KEY); session = sessionStorage.getItem(CFG_KEY); } catch (e) {}
    try { var raw = JSON.parse(stored) || JSON.parse(session); if (raw && (raw.effort === 'low' || raw.effort === 'high')) c.effort = raw.effort; } catch (e) {}
    try {
      if (session !== null) sessionStorage.removeItem(CFG_KEY);
      localStorage.removeItem('jp_ai_models');
    } catch (e) {}
    if (stored !== (c.effort ? JSON.stringify({ v: 3, effort: c.effort }) : null) || session !== null) saveCfg(c);
    return c;
  }

  /* ── history (per lesson, survives tab close) ── */
  // Quiz pages keep no history: the question it was about is gone after a reload.
  function loadHist() {
    if (QUIZ) return [];
    try { return JSON.parse(localStorage.getItem(HIST_KEY)) || JSON.parse(sessionStorage.getItem(HIST_KEY)) || []; } catch (e) { return []; }
  }
  function saveHist(h) {
    if (h.length > MAX_HISTORY_MSGS) h.splice(0, h.length - MAX_HISTORY_MSGS);
    if (QUIZ) return;
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); sessionStorage.removeItem(HIST_KEY); } catch (e) {}
  }

  // Practice pages: a log of AI explanations, in this browser only (never
  // sent anywhere), so a learner can look back at what they asked — newest
  // last, at most QUIZ_LOG_MAX entries. { t, id, page, model, q, a }.
  var QUIZ_LOG_KEY = 'jp_ai_quiz_log', QUIZ_LOG_MAX = 50, quizId = null;
  function logQuiz(q, a, model) {
    try {
      var log = JSON.parse(localStorage.getItem(QUIZ_LOG_KEY)) || [];
      log.push({ t: Date.now(), id: quizId, page: location.pathname, model: model, q: q, a: a });
      if (log.length > QUIZ_LOG_MAX) log.splice(0, log.length - QUIZ_LOG_MAX);
      localStorage.setItem(QUIZ_LOG_KEY, JSON.stringify(log));
    } catch (e) {}
  }

  function isEn() { return document.body.classList.contains('lang-en'); }
  function t(zh, en) { return isEn() ? en : zh; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }

  // Analytics (GA4 via window.gaEvent). Only metadata is sent — model name,
  // where the question came from, error class, latency — never the question
  // or the answer.
  function track(name, params) {
    if (!window.gaEvent) return;
    var p = { page_path: location.pathname };
    p.provider = 'jpnotes'; p.model = RELAY.model;
    for (var k in params) p[k] = params[k];
    window.gaEvent(name, p);
  }
  function errorKind(msg) {
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'network';
    if (/HTTP 401|HTTP 403|authentication|invalid.*key/i.test(msg)) return 'auth';
    if (/HTTP 429/.test(msg)) return 'rate_limit';
    if (/HTTP 4\d\d/.test(msg)) return 'http_4xx';
    if (/HTTP 5\d\d/.test(msg)) return 'http_5xx';
    return 'other';
  }
  var pendingSource = 'typed';   // 'typed' | 'quick' | 'selection' | 'example' | 'quiz' | 'retry' — set before send()

  var cfg = loadCfg();
  var history = loadHist();      // [{role:'user'|'assistant', content}]
  var busy = false, abort = null;
  var panel, msgsEl, inputEl, sendBtn, modelLabel, scopeSel;

  /* ── lesson context ──
   * "Scope" is what the model sees: the whole lesson (scope = -1) or one
   * numbered grammar point (index into sections()). Selecting text inside a
   * grammar point narrows the scope to it automatically; the 📎 row above the
   * input shows the current choice and lets the reader change it. */
  // scope: -2 = auto (the grammar point currently on screen; whole lesson when
  // none is), -1 = whole lesson, n = section index.
  var scope = -2, sectionCache = null;
  function headingText(h) {
    var s = h.querySelector(isEn() ? '.lang-en' : '.lang-zh');
    return (s || h).textContent.trim();
  }
  function sections() {
    if (sectionCache) return sectionCache;
    var out = [];
    [].forEach.call(article.querySelectorAll('h2'), function (h) {
      if (!/^\d+[.．、]/.test(headingText(h))) return;      // numbered grammar points only
      var nodes = [h], n = h.nextElementSibling;
      while (n && n.tagName !== 'H2') { nodes.push(n); n = n.nextElementSibling; }
      out.push({ h: h, nodes: nodes, chars: 0 });
    });
    sectionCache = out;
    return out;
  }
  function sectionTitle(i) { return i >= 0 && sections()[i] ? headingText(sections()[i].h).replace(/^(\d+)[.．、]\s*/, '$1. ') : ''; }
  function sectionOf(el) {
    var secs = sections();
    for (var i = 0; i < secs.length; i++) for (var j = 0; j < secs[i].nodes.length; j++) if (secs[i].nodes[j].contains(el)) return i;
    return -1;
  }
  function textOf(root) {
    root.querySelectorAll('rt, rp, .speak-btn, .ai-ex-btn, .lesson-meta, .related-grammar, .checklist-progress, script, style, input').forEach(function (n) { n.remove(); });
    root.querySelectorAll(isEn() ? '.lang-zh' : '.lang-en').forEach(function (n) { n.remove(); });
    root.querySelectorAll('tr').forEach(function (tr) {
      var cells = [].map.call(tr.querySelectorAll('td, th'), function (c) { return c.textContent.trim(); });
      tr.textContent = cells.join(' | ');
    });
    root.querySelectorAll('h1,h2,h3,h4').forEach(function (h) {
      h.textContent = '\n' + '#'.repeat(+h.tagName[1]) + ' ' + h.textContent.trim() + '\n';
    });
    root.querySelectorAll('li').forEach(function (li) { li.insertAdjacentText('afterbegin', '- '); });
    root.querySelectorAll('p, li, tr, div, blockquote, pre, h1, h2, h3, h4').forEach(function (b) { b.insertAdjacentText('beforeend', '\n'); });
    var txt = (root.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return txt.length > MAX_CONTEXT_CHARS ? txt.slice(0, MAX_CONTEXT_CHARS) + '\n…(truncated)' : txt;
  }
  // The section whose heading is the last one above the upper third of the
  // viewport, i.e. what the reader is looking at. -1 above the first heading.
  function autoSection() {
    var secs = sections(), y = window.innerHeight * 0.35, best = -1;
    for (var i = 0; i < secs.length; i++) if (secs[i].h.getBoundingClientRect().top <= y) best = i; else break;
    return best;
  }
  function effectiveScope() { return scope === -2 ? autoSection() : scope; }
  var wholeCache = null;
  function wholeText() {
    if (wholeCache === null || wholeCache.en !== isEn()) wholeCache = { en: isEn(), txt: textOf(article.cloneNode(true)) };
    return wholeCache.txt;
  }
  function contextText(sc) {
    if (sc < 0 || !sections()[sc]) return wholeText();
    var box = document.createElement('div'), h1 = article.querySelector('h1');
    if (h1) box.appendChild(h1.cloneNode(true));
    sections()[sc].nodes.forEach(function (n) { box.appendChild(n.cloneNode(true)); });
    return textOf(box);
  }
  function contextChars(i) {
    if (i < 0) return wholeText().length;
    var s = sections()[i];
    if (!s.chars) { var box = document.createElement('div'); s.nodes.forEach(function (n) { box.appendChild(n.cloneNode(true)); }); s.chars = textOf(box).length; }
    return s.chars;
  }
  function kChars(n) { return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n); }

  // "Thinking depth": '' (standard) adds nothing; 'low' / 'high' add a line to
  // the system prompt asking for shorter or fuller answers (effortPrompt()).
  var EFFORTS = [['low', '快速', 'Quick'], ['', '标准', 'Standard'], ['high', '深入', 'Deep']];
  function effortLabel(e) { var r = EFFORTS.filter(function (x) { return x[0] === (e || ''); })[0]; return r ? (isEn() ? r[2] : r[1]) : ''; }
  function effortPrompt(c) {
    var e = c.effort || '';
    if (e === 'low') return isEn() ? ' Keep answers short: 3–5 sentences, conclusion first.' : ' 回答尽量简短，3–5 句，先给结论。';
    if (e === 'high') return isEn() ? ' Feel free to go deep: more examples, side-by-side comparisons with similar grammar, and common mistakes you are sure of.' : ' 可以详细展开：多给例句，和相近语法对比辨析；易错点只写有把握的。';
    return '';
  }
  function systemPrompt(sc) {
    var ctx = contextText(sc), scoped = sc >= 0 && sections()[sc];
    if (GENERAL) return isEn()
      ? 'You are a Japanese grammar tutor helping a JLPT learner on ' + location.origin + ' (free grammar notes N5–N1). Answer any Japanese question. Reply in English. In Japanese examples, put the kana reading right after each kanji word in full-width parentheses, e.g. 雨（あめ）に降（ふ）られた, and add an English translation. When a lesson on the site covers the point, say so (lessons are at ' + location.origin + '/lessonNN/). Be concise, example-heavy, no filler.' + effortPrompt(cfg)
      : '你是一位日语语法老师，正在辅导一位备考 JLPT 的中文母语学习者（网站 ' + location.origin + '，N5–N1 免费语法笔记）。回答任何日语问题，用中文。日语例句里的汉字请紧跟全角括号标注假名读音，格式如「雨（あめ）に降（ふ）られた」，并附中文翻译。回答简洁、多用例句、少说套话。' + effortPrompt(cfg);
    if (QUIZ) return isEn()
      ? 'You are a Japanese tutor (grammar, vocabulary and reading) helping a JLPT learner who has just answered the practice question below on ' + location.origin + location.pathname + '. ' +
        'Answer from the question, its explanation and the linked lesson; say so when you add outside knowledge. The learner has already read the fixed explanation, so don\u2019t repeat it \u2014 add what it leaves out. The fixed explanation and the reasons it gives for each wrong option were checked by hand: build on them and never contradict them (e.g. a 〜ませんか form is an invitation or suggestion, not a plain negative). When the learner says the notes or the question are wrong, check carefully before answering: if they are wrong, say so; if not, say plainly that they are right and why — never agree just because the learner said so. If you think the answer key is wrong or two options work, say so plainly and suggest reporting it with \u201cSomething wrong with this question?\u201d under the question. Reply in English. Do what the learner asks in their message. Pitch it at the level shown in the question: example sentences should use vocabulary and grammar at or below that level. In Japanese, put the kana reading right after each kanji word in full-width parentheses, e.g. 雨（あめ）に降（ふ）られた, and add an English translation; for a word the question writes in kana you may give its kanji as ひと（人）. If asked to rewrite a sentence, the rewrite must actually differ from the original; if the original is already natural, say so instead. Stick to what this question needs; don\u2019t list general rules. If you aren\u2019t sure of a reading, origin or rule, leave it out \u2014 never make one up. No tables (the panel is narrow): short paragraphs or lists. Follow the [How to explain] note in the question for length and shape; keep follow-up answers short. No filler, no greetings or praise.' + effortPrompt(cfg) +
        '\n\n<question>\n' + ctx + '\n</question>'
      : '你是一位日语老师（语法、词汇、阅读都教），正在辅导一位备考 JLPT 的中文母语学习者。学习者刚在 ' + location.origin + location.pathname + ' 做完下面这道练习题。' +
        '请基于题目、固定解析和对应课文回答；补充其他知识时请说明。学习者已经看过固定解析，不要照抄，要补充它没讲到的。固定解析和它对每个错误选项给出的理由都经过人工核对：在它的基础上讲，不要和它矛盾（例如「〜ませんか」是邀请或劝说，不是单纯的否定）。学习者说笔记或题目有错时，先仔细核对再回答：确实错了就直说，没错就明确说没错并解释原因，不要因为学习者这么说就附和。如果你认为标准答案有误或有两个选项都对，请直接指出，并建议点题目下方的「这题有问题？」反馈。回答用中文。按学习者消息里的要求来讲。讲解难度和例句要符合题目标注的级别，例句里的词汇和语法不超过该级别。日语里的汉字请紧跟全角括号标注假名读音，格式如「雨（あめ）に降（ふ）られた」，并附中文翻译；题目里写成假名的词，可以写成「ひと（人）」告诉学习者汉字写法；中文后面不要加日语括号。被要求改写句子时，改写后的句子必须和原句不同；如果原句已经自然，就直说原句没问题。只讲和这道题直接相关的内容，不要罗列一般规则；没有把握的读音、词源或规则宁可不说，不要编。不要用表格（面板很窄），用短段落或列表。长度和格式按题目信息里的【讲解要求】来；追问时简短回答。不说套话，不寒暄、不夸奖。' + effortPrompt(cfg) +
        '\n\n<question>\n' + ctx + '\n</question>';
    if (!isEn()) {
      return '你是一位日语语法老师，正在辅导一位备考 JLPT 的中文母语学习者。学习者此刻正在阅读' +
        (scoped ? '下面这一课中「' + sectionTitle(sc) + '」这一节' : '下面这一课的笔记') + '（网址 ' + location.origin + location.pathname + '）。' +
        '请优先基于笔记内容回答；补充笔记之外的知识时请说明。回答用中文。日语例句里的汉字请紧跟全角括号标注假名读音，格式如「雨（あめ）に降（ふ）られた」，并附中文翻译。回答简洁、多用例句、少说套话；不要用表格（面板很窄），用短段落或列表。学习者说笔记或题目有错时，先仔细核对再回答：确实错了就直说，没错就明确说没错并解释原因，不要因为学习者这么说就附和。' + effortPrompt(cfg) +
        '\n\n<lesson>\n' + ctx + '\n</lesson>';
    }
    return 'You are a Japanese grammar tutor helping a JLPT learner. The learner is currently reading ' +
      (scoped ? 'the section "' + sectionTitle(sc) + '" of the lesson notes below' : 'the lesson notes below') + ' (' + location.origin + location.pathname + '). ' +
      'Answer primarily from the notes and say so when you add outside knowledge. Reply in English. In Japanese examples, put the kana reading right after each kanji word in full-width parentheses, e.g. 雨（あめ）に降（ふ）られた, and add an English translation. Be concise, example-heavy, no filler; no tables (the panel is narrow), use short paragraphs or lists. When the learner says the notes or the question are wrong, check carefully before answering: if they are wrong, say so; if not, say plainly that they are right and why — never agree just because the learner said so.' + effortPrompt(cfg) +
      '\n\n<lesson>\n' + ctx + '\n</lesson>';
  }

  /* ── streaming clients ── */
  function readSSE(res, onJson) {
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split('\n'); buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.indexOf('data:') !== 0) continue;
          var data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try { onJson(JSON.parse(data)); } catch (e) { if (e && e.aiFatal) throw e; }
        }
        return pump();
      });
    }
    return pump();
  }
  function httpError(res) {
    return res.text().then(function (txt) {
      var msg = txt;
      try {
        var j = JSON.parse(txt); if (Array.isArray(j)) j = j[0] || {};
        msg = (j.error && (typeof j.error === 'string' ? j.error : j.error.message || j.error.type)) || j.message || (j.detail && (j.detail.message || j.detail)) || txt;
      } catch (e) {}
      throw new Error('HTTP ' + res.status + ' – ' + String(msg).slice(0, 400));
    });
  }
  function fatal(msg) { var e = new Error(msg); e.aiFatal = true; return e; }
  // Sent with every request, for the relay's usage counter: which button, and
  // whether this browser is the site owner's (opted out of GA with ?ga_off).
  function relayTags(source) {
    var me = false; try { me = localStorage.getItem('jp_ga_off') === '1'; } catch (e) {}
    return me ? { source: source, owner: true } : { source: source };
  }
  // The relay speaks OpenAI-style /chat/completions with SSE streaming.
  function callRelay(sys, msgs, onDelta, signal, source) {
    var inThink = false;   // a backup model may inline <think>…</think> in content
    return fetch(RELAY_URL.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assign({ model: RELAY.model, stream: true, messages: [{ role: 'system', content: sys }].concat(msgs) }, relayTags(source)))
    }).then(function (res) {
      if (!res.ok) return httpError(res);
      return readSSE(res, function (j) {
        if (j.error) throw fatal(j.error.message || JSON.stringify(j.error));
        var d = j.choices && j.choices[0] && j.choices[0].delta;
        if (!d) return;
        if (d.reasoning || d.reasoning_content) onDelta(d.reasoning || d.reasoning_content, true);
        if (!d.content) return;
        var s = d.content;
        while (s) {
          if (inThink) { var e = s.indexOf('</think>'); if (e < 0) { onDelta(s, true); return; } onDelta(s.slice(0, e), true); s = s.slice(e + 8); inThink = false; }
          else { var b = s.indexOf('<think>'); if (b < 0) { onDelta(s); return; } if (b) onDelta(s.slice(0, b)); s = s.slice(b + 7); inThink = true; }
        }
      });
    });
  }

  /* ── markdown-ish rendering ──
   * Replies are asked to write readings as 漢字（かな）; those become <ruby>
   * so answers look like the lesson text (and obey the furigana toggle). */
  var PRE = String.fromCharCode(0) + 'PRE', PRE_END = String.fromCharCode(0);
  var PRE_RE = new RegExp('^' + PRE + '(.*)' + PRE_END + '$');
  // Handles both 雨（あめ） and 降られた（ふられた）: when the reading ends with
  // the okurigana that follows the kanji, the ruby covers only the kanji.
  function ruby(s) {
    return s.replace(/([\u4e00-\u9fff\u3400-\u4dbf々〆ヶ]+)([ぁ-ゖ]*)[（(]([ぁ-ゖァ-ヺー]+)[）)]/g, function (m, kanji, oku, yomi) {
      if (oku) { if (yomi.length <= oku.length || yomi.slice(-oku.length) !== oku) return m; yomi = yomi.slice(0, -oku.length); }
      // Fewer kana than kanji can't be a reading — e.g. Chinese text running into a gloss: 确认频率词（いつも）.
      if (yomi.length < kanji.length) return m;
      return '<ruby>' + kanji + '<rp>(</rp><rt>' + yomi + '</rt><rp>)</rp></ruby>' + oku;
    });
  }
  // While a reply streams in, hold back the parts of the last line that
  // would change shape once complete — a half table row, an unclosed
  // （reading） that becomes ruby, unfinished **bold** — so text does not
  // jump around.
  function settled(s) {
    var i = s.lastIndexOf('\n'), head = s.slice(0, i + 1), tail = s.slice(i + 1);
    if (/^\s*\|/.test(tail)) return head;
    tail = tail.replace(/[（(][ぁ-ゖァ-ヺー]*$/, '');
    if ((tail.match(/\*\*/g) || []).length % 2) tail = tail.slice(0, tail.lastIndexOf('**'));   // "**1. 拆" would briefly render as a list
    return head + tail;
  }
  function md(src) {
    var s = esc(src);
    s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, function (m, c) { return PRE + btoa(unescape(encodeURIComponent(c))) + PRE_END; });
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = ruby(s);
    var out = [], list = null, lines = s.split('\n');
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], m;
      if ((m = ln.match(PRE_RE))) { closeList(); out.push('<pre><code>' + decodeURIComponent(escape(atob(m[1]))) + '</code></pre>'); continue; }
      if (!ln.trim()) { closeList(); continue; }
      if (list === 'table' && /^\s*\|?\s*:?-{2,}/.test(ln)) continue;                       // table separator row
      if (/^\s*\|.*\|\s*$/.test(ln)) {
        var cells = ln.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
        if (list !== 'table') { closeList(); out.push('<table>'); list = 'table'; out.push('<tr>' + cells.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>'); }
        else out.push('<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>');
        continue;
      }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + m[1] + '</li>'); continue; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + m[1] + '</li>'); continue; }
      closeList();
      if ((m = ln.match(/^#{1,6}\s+(.*)/))) { out.push('<h4>' + m[1] + '</h4>'); continue; }
      out.push('<p>' + ln + '</p>');
    }
    closeList();
    return out.join('');
  }

  /* ── panel width (drag the left edge; remembered per browser) ── */
  // Quiz pages have a narrow question column, so the panel may take more of the
  // screen there (and opens wider by default); each kind of page remembers its own width.
  var WIDTH_KEY = QUIZ ? 'jp_ai_w_quiz' : 'jp_ai_w';
  function clampWidth(w) { return Math.max(340, Math.min(window.innerWidth - (QUIZ ? 560 : 640), QUIZ ? 1100 : 900, Math.round(w))); }
  function applyWidth(w) { document.documentElement.style.setProperty('--ai-w', clampWidth(w) + 'px'); }
  function defaultWidth() {
    document.documentElement.style.removeProperty('--ai-w');
    if (QUIZ && window.innerWidth >= 1100) applyWidth(window.innerWidth * 0.45);
  }
  function resetWidth() { defaultWidth(); try { localStorage.removeItem(WIDTH_KEY); } catch (e) {} }
  (function () { var w = 0; try { w = +localStorage.getItem(WIDTH_KEY); } catch (e) {} if (w) applyWidth(w); else defaultWidth(); })();
  function initResize(handle) {
    var startX = 0, startW = 0, dragging = false;
    function move(e) {
      if (!dragging) return;
      var x = e.touches ? e.touches[0].clientX : e.clientX;
      applyWidth(startW + (startX - x));
    }
    function up() {
      if (!dragging) return;
      dragging = false; document.body.classList.remove('ai-resizing');
      var w = clampWidth(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ai-w')));
      try { localStorage.setItem(WIDTH_KEY, String(w)); } catch (e) {}
      track('ai_resize', { width: w });
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up);
    }
    function down(e) {
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startW = panel.getBoundingClientRect().width;
      dragging = true; document.body.classList.add('ai-resizing');
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      window.addEventListener('touchmove', move, { passive: true }); window.addEventListener('touchend', up);
      e.preventDefault();
    }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
    handle.addEventListener('dblclick', resetWidth);
  }

  /* ── UI ── */
  function build() {
    panel = document.createElement('aside');
    panel.id = 'ai-panel';
    panel.setAttribute('aria-label', 'AI tutor');
    panel.innerHTML =
      '<div class="ai-resize" title="' + esc(t('拖动调整宽度，双击恢复默认', 'Drag to resize, double-click to reset')) + '"></div>' +
      '<div class="ai-head">' +
        '<span class="ai-title"><button type="button" class="ai-back">' + (QUIZ ? '<span class="lang-zh">‹ 题目</span><span class="lang-en">‹ Question</span>' : '<span class="lang-zh">‹ 课文</span><span class="lang-en">‹ Lesson</span>') + '</button>' +
          '<span class="ai-name">🤖 <span class="lang-zh">问 AI</span><span class="lang-en">Ask AI</span></span> ' +
          '<button type="button" class="ai-model" title="' + esc(t('思考深度', 'Thinking depth')) + '"></button></span>' +
        '<div class="ai-model-menu" hidden></div>' +
        '<span class="ai-head-btns">' +
          '<button type="button" class="ai-new" title="' + esc(t('新对话（清空本课记录）', 'New chat (clears this lesson’s history)')) + '">＋</button>' +
          '<button type="button" class="ai-close" title="' + esc(t('关闭', 'Close')) + '">✕</button>' +
        '</span>' +
      '</div>' +
      '<div class="ai-msgs" aria-live="polite"></div>' +
      '<form class="ai-input">' +
        '<label class="ai-ctx" title="' + esc(t('随问题一起发给模型的笔记范围。选中某一节的例句提问时会自动缩小到那一节。', 'Which part of the notes is sent with your question. Selecting text inside a grammar point narrows it to that point automatically.')) + '">' +
          '<span class="ai-ctx-label">📎 ' + esc(t('AI 看到', 'AI sees')) + '</span><select class="ai-scope"></select>' +
          '<button type="button" class="ai-clear" hidden title="' + esc(t('清空本课的对话记录，模型不再看到之前的问答', 'Clear this lesson\u2019s chat; the model will no longer see earlier turns')) + '">🗑 ' + esc(t('清空对话', 'Clear chat')) + '</button></label>' +
        '<p class="ai-free-warn">' + esc(t('AI 偶尔会讲错，以课文和解析为准', 'The AI sometimes gets things wrong; the notes and explanations come first')) + '</p>' +
        '<textarea rows="3"></textarea>' +
        '<div class="ai-input-row"><span class="ai-input-hint">' + esc(t('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter for a new line')) + '</span>' +
        '<button type="submit">' + esc(t('发送 ↑', 'Send ↑')) + '</button></div>' +
      '</form>';
    document.body.appendChild(panel);
    msgsEl = panel.querySelector('.ai-msgs');
    inputEl = panel.querySelector('textarea');
    sendBtn = panel.querySelector('.ai-input button[type=submit]');
    modelLabel = panel.querySelector('.ai-model');
    scopeSel = panel.querySelector('.ai-scope');
    if (QUIZ) { scopeSel.hidden = true; panel.querySelector('.ai-ctx-label').textContent = '📎 ' + t('AI 看到：这道题、解析和对应课文', 'AI sees: this question, its explanation and lesson'); }
    if (GENERAL) { scopeSel.hidden = true; panel.querySelector('.ai-ctx-label').textContent = '📎 ' + t('通用提问：AI 看不到页面内容', 'General question: the AI doesn\u2019t see this page'); }

    panel.querySelector('.ai-close').addEventListener('click', function () { close(); });
    panel.querySelector('.ai-back').addEventListener('click', function () { close(); });
    initResize(panel.querySelector('.ai-resize'));
    // The header label opens a small menu with the one setting there is: thinking depth.
    var menu = panel.querySelector('.ai-model-menu');
    modelLabel.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!menu.hidden) { menu.hidden = true; return; }
      menu.innerHTML = '<div class="ai-menu-head">' + esc(t('思考深度', 'Thinking depth')) + '</div>' +
        '<div class="ai-effort-row">' + EFFORTS.map(function (x) { return '<button type="button" class="ai-effort' + (cfg.effort === x[0] ? ' sel' : '') + '" data-e="' + x[0] + '">' + esc(isEn() ? x[2] : x[1]) + '</button>'; }).join('') + '</div>';
      menu.hidden = false;
    });
    menu.addEventListener('click', function (e) {
      e.stopPropagation();
      var eb = e.target.closest && e.target.closest('.ai-effort');
      if (!eb) return;
      cfg.effort = eb.getAttribute('data-e'); saveCfg(cfg); track('ai_effort', { effort: cfg.effort || 'standard', via: 'menu' }); renderAll(); menu.hidden = true;
    });
    document.addEventListener('click', function () { if (menu && !menu.hidden) menu.hidden = true; });
    function clearChat() { if (busy) stop(); history = []; saveHist(history); track('ai_clear', {}); renderAll(); }
    panel.querySelector('.ai-new').addEventListener('click', clearChat);
    panel.querySelector('.ai-clear').addEventListener('click', clearChat);
    panel.querySelector('.ai-input').addEventListener('submit', function (e) { e.preventDefault(); if (busy) stop(); else send(inputEl.value); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(inputEl.value); }
    });
    inputEl.addEventListener('input', function () { autosize(); if (!inputEl.value.trim()) pendingSource = 'typed'; });
    panel.addEventListener('mouseenter', refreshAuto);
    inputEl.addEventListener('focus', refreshAuto);
    scopeSel.addEventListener('mousedown', refreshAuto);
    scopeSel.addEventListener('change', function () { scope = +scopeSel.value; track('ai_scope', { scope: scope < 0 ? 'lesson' : 'section', via: 'select' }); renderScope(); });
    msgsEl.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('ai-quick')) { pendingSource = 'quick'; send(b.getAttribute('data-q')); return; }
      if (b.classList.contains('ai-copy')) { copyText(b.closest('.ai-msg').getAttribute('data-raw') || '', b); return; }
      if (b.classList.contains('ai-regen')) { regenerate(); return; }
      if (b.classList.contains('ai-flag')) { flagAnswer(b.closest('.ai-msg'), b); return; }
      if (b.classList.contains('ai-retry')) { regenerate(); return; }
    });
    renderScope();
    renderAll();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel && document.body.classList.contains('ai-open')) close(); });

  function autoLabel() {
    var a = autoSection();
    return t('跟随阅读位置 · 现在是', 'follow my reading · now') + (a >= 0 ? ' ' + sectionTitle(a) + ' · ~' + kChars(contextChars(a)) : t(' 整课 · 约 ', ' whole lesson · ~') + kChars(contextChars(-1)));
  }
  function renderScope() {
    if (!scopeSel) return;
    var secs = sections();
    scopeSel.innerHTML = '<option value="-2">' + esc(autoLabel()) + '</option>' +
      '<option value="-1">' + esc(t('整课 · 约 ', 'whole lesson · ~') + kChars(contextChars(-1)) + t(' 字', ' chars')) + '</option>' +
      secs.map(function (s, i) { return '<option value="' + i + '">' + esc(t('仅 ', 'only ') + sectionTitle(i) + ' · ~' + kChars(contextChars(i))) + '</option>'; }).join('');
    if (scope >= secs.length) scope = -2;
    scopeSel.value = String(scope);
    scopeSel.classList.toggle('ai-scope-narrow', scope >= 0);
    var sc = effectiveScope();
    inputEl.placeholder = GENERAL ? t('问任何日语语法问题…', 'Ask any Japanese grammar question…') : QUIZ ? t('接着问这道题…', 'Ask more about this question…') : sc >= 0 ? t('问关于「' + sectionTitle(sc) + '」的问题…', 'Ask about "' + sectionTitle(sc) + '"…') : t('问关于这一课的任何问题…', 'Ask anything about this lesson…');
  }
  // Keep the "follow my reading" label current: on scroll, and again whenever
  // the reader comes back to the panel (scroll events can be throttled).
  function refreshAuto() {
    if (QUIZ || GENERAL || scope !== -2 || !scopeSel) return;
    scopeSel.options[0].text = autoLabel();
    var sc = effectiveScope();
    inputEl.placeholder = sc >= 0 ? t('问关于「' + sectionTitle(sc) + '」的问题…', 'Ask about "' + sectionTitle(sc) + '"…') : t('问关于这一课的任何问题…', 'Ask anything about this lesson…');
  }
  var scrollTimer = 0;
  window.addEventListener('scroll', function () {
    if (!document.body.classList.contains('ai-open')) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(refreshAuto, 250);
  }, { passive: true });

  // Every label is produced by t() at render time, so when the reader flips
  // 中/EN we rebuild the panel in the new language, keeping the open state
  // and the draft in the input box.
  function relocalize() {
    if (!panel) return;
    var typed = inputEl.value, wasOpen = document.body.classList.contains('ai-open');
    panel.remove(); panel = null; sectionCache = null; wholeCache = null;
    build();
    inputEl.value = typed; autosize();
    if (!wasOpen) panel.setAttribute('aria-hidden', 'true');
  }
  var lastEn = isEn();
  new MutationObserver(function () { if (isEn() !== lastEn) { lastEn = isEn(); relocalize(); } })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  function autosize() { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight + 2, window.innerHeight * 0.4) + 'px'; }

  function renderAll() {
    modelLabel.textContent = t('免费模型', 'Free model') + (cfg.effort ? ' · ' + effortLabel(cfg.effort) : '') + ' ▾';
    msgsEl.innerHTML = '';
    panel.querySelector('.ai-clear').hidden = !history.length;
    if (!history.length && GENERAL) {
      var gq = isEn()
        ? ['What\u2019s the difference between は and が?', 'When do I use ために and when ように?', 'Explain the te-form rules simply', 'Which grammar comes up most on the JLPT N2?']
        : ['は和が有什么区别？', 'ために和ように怎么区分？', '用最简单的话讲讲て形变形规则', 'N2 最常考哪些语法？'];
      msgsEl.innerHTML = '<div class="ai-note">' + esc(t('这里可以问任何日语问题。想问某一课的内容，到那一课里打开 AI，它会读过整课再回答。', 'Ask any Japanese question here. For a specific lesson, open the AI on that lesson page: it reads the whole lesson first.')) + '</div>' +
        '<div class="ai-quicks">' + gq.map(function (q) { return '<button type="button" class="ai-quick" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
      return;
    }
    if (!history.length && QUIZ) {
      msgsEl.innerHTML = '<div class="ai-note">' + esc(t('答完一道题后，点解析里的「🤖 AI 讲解」，AI 会针对你选的选项讲为什么错、怎么区分，还可以接着追问。', 'After answering a question, press "🤖 Explain with AI" under the explanation: the AI explains why your choice was wrong and how to tell them apart, and you can ask follow-ups.')) + '</div>';
      return;
    }
    if (!history.length) {
      var quick = isEn()
        ? ['Explain the hardest grammar point in this lesson simply', 'Give me 5 fresh example sentences using this lesson’s grammar', 'Quiz me with 5 multiple-choice questions', 'How do the grammar points in this lesson differ from each other?']
        : ['用最简单的话解释这一课最难的语法点', '用这一课的语法再造 5 个新例句', '出 5 道选择题考考我', '这一课的几个语法点之间有什么区别？'];
      msgsEl.innerHTML = '<div class="ai-note">' + esc(t('AI 已读过这一课的内容，可以直接提问；点例句后面的「讲解」可以讲解那一句的语法；选中正文里的文字再点「💬 问 AI」，可以就那段内容提问。', 'The AI has read this lesson. Ask away. Click "Explain" after any example sentence for a quick grammar breakdown, or select text in the lesson and click "💬 Ask AI" to ask about it.')) + '</div>' +
        '<div class="ai-quicks">' + quick.map(function (q) { return '<button type="button" class="ai-quick" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
        '<p class="ai-note ai-free-note">' + esc(t('免费使用，每人每天 50 次。对话只保存在这个浏览器里。', 'Free to use, 50 questions a day. Conversations are kept in this browser only.')) + '</p>';
      return;
    }
    history.forEach(function (m, i) { appendMsg(m.role, m.shown || m.content, i === history.length - 1); });
    if (history[history.length - 1].role === 'user') {
      var un = document.createElement('div');
      un.className = 'ai-msg ai-error';
      un.innerHTML = '<p>' + esc(t('上一个问题没有收到回答。', 'The last question got no answer.')) + '</p><div class="ai-actions"><button type="button" class="ai-retry">↻ ' + esc(t('重试', 'Retry')) + '</button></div>';
      msgsEl.appendChild(un);
    }
    scrollBottom();
  }
  function appendMsg(role, content, last) {
    var el = document.createElement('div');
    el.className = 'ai-msg ai-' + role;
    el.innerHTML = role === 'user' ? '<p>' + esc(content).replace(/\n/g, '<br>') + '</p>' : md(content);
    if (role === 'assistant' && content) { el.setAttribute('data-raw', content); el.appendChild(actionsFor(!!last)); }
    msgsEl.appendChild(el);
    return el;
  }
  function actionsFor(last) {
    var d = document.createElement('div');
    d.className = 'ai-actions';
    d.innerHTML = '<button type="button" class="ai-copy" title="' + esc(t('复制回答', 'Copy answer')) + '">⧉ ' + esc(t('复制', 'Copy')) + '</button>' +
      '<button type="button" class="ai-flag" title="' + esc(t('标记这个回答有错，记在本浏览器里，方便以后核对', 'Mark this answer as wrong — kept in this browser for checking later')) + '">⚑ ' + esc(t('有错', 'Wrong')) + '</button>' +
      (last ? '<button type="button" class="ai-regen" title="' + esc(t('重新回答', 'Answer again')) + '">↻ ' + esc(t('重新生成', 'Regenerate')) + '</button>' : '');
    return d;
  }
  // ⚑ 有错: the answer, the question before it and where it was asked go to
  // localStorage jp_ai_flags (this browser only, newest last, at most 100).
  function flagAnswer(msgEl, btn) {
    var nodes = [].slice.call(msgsEl.querySelectorAll('.ai-msg.ai-user, .ai-msg.ai-assistant')), i = nodes.indexOf(msgEl), q = '';
    for (var j = i - 1; j >= 0; j--) if (nodes[j].classList.contains('ai-user')) { q = nodes[j].textContent; break; }
    try {
      var f = JSON.parse(localStorage.getItem('jp_ai_flags')) || [];
      f.push({ t: Date.now(), page: location.pathname, id: QUIZ ? quizId : null, model: MODEL_ID, q: q, a: msgEl.getAttribute('data-raw') || msgEl.textContent });
      if (f.length > 100) f.splice(0, f.length - 100);
      localStorage.setItem('jp_ai_flags', JSON.stringify(f));
    } catch (e) {}
    btn.textContent = '✓ ' + t('已标记', 'Marked'); btn.disabled = true;
    if (!msgEl.querySelector('.ai-flag-tip')) {
      var tip = document.createElement('p');
      tip.className = 'ai-note ai-flag-tip';
      tip.textContent = t('谢谢。AI 在细微语感上不太可靠，以课文和解析为准。', 'Thanks. The AI is unreliable on fine points of usage; the notes and explanations come first.');
      msgEl.appendChild(tip);
    }
    track('ai_flag', { mode: QUIZ ? 'quiz' : GENERAL ? 'general' : 'lesson' });
  }
  function copyText(s, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = '✓ ' + t('已复制', 'Copied'); setTimeout(function () { btn.textContent = o; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, function () { legacyCopy(s); done(); });
    else { legacyCopy(s); done(); }
  }
  function legacyCopy(s) { var ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }
  function showError(msg) {
    var el = document.createElement('div');
    el.className = 'ai-msg ai-error';
    // The relay's own messages already say what to do; only a dead connection needs a word.
    var hint = /Failed to fetch|NetworkError|Load failed/i.test(msg) ? t('（连不上本站的 AI 服务，请稍后再试。在中国大陆偶尔会连不上。）', '(Cannot reach the site\u2019s AI service; try again later.)') : '';
    el.innerHTML = '<p>⚠ ' + esc(msg) + ' ' + esc(hint) + '</p><div class="ai-actions"><button type="button" class="ai-retry">↻ ' + esc(t('重试', 'Retry')) + '</button></div>';
    msgsEl.appendChild(el); scrollBottom();
  }

  // Re-ask the last user message: drop the trailing assistant reply (if any)
  // and any error bubble, then send again without re-adding the question.
  function regenerate() {
    if (busy || !history.length) return;
    if (history[history.length - 1].role === 'assistant') history.pop();
    var last = history.pop();
    if (!last || last.role !== 'user') { if (last) history.push(last); return; }
    saveHist(history);
    var nodes = [].slice.call(msgsEl.querySelectorAll('.ai-msg')), i = nodes.length - 1;
    while (i >= 0 && !nodes[i].classList.contains('ai-user')) i--;
    nodes.slice(Math.max(i, 0)).forEach(function (n) { n.remove(); });
    pendingSource = 'retry';
    track('ai_retry', {});
    send(last.content, last.shown);
  }

  // `shown`, when given, is what the chat displays instead of `text` (the full
  // instruction still goes to the model): a button's prompt stays out of view.
  function send(text, shown) {
    text = (text || '').trim();
    if (!text || busy) return;
    var source = pendingSource, t0 = Date.now();
    pendingSource = 'typed';
    if (!history.length) msgsEl.innerHTML = '';
    msgsEl.querySelectorAll('.ai-error, .ai-actions').forEach(function (n) { n.remove(); });
    inputEl.value = ''; autosize();
    history.push(shown ? { role: 'user', content: text, shown: shown } : { role: 'user', content: text });
    appendMsg('user', shown || text);
    var reply = '', think = '', el = appendMsg('assistant', ''), raf = 0, gotBytes = false;
    el.classList.add('ai-streaming');
    el.innerHTML = '<p class="ai-status">' + t('连接中…', 'Connecting…') + '</p>';
    var slowTimer = setTimeout(function () {
      if (gotBytes) return;
      el.innerHTML = '<p class="ai-status">' + t('连接中…', 'Connecting…') + '</p><p class="ai-status">' + t('还没有收到回应，再等一会儿，或点「停止」后重试。', 'No answer yet; wait a bit or press Stop and retry.') + '</p>';
    }, 10000);
    scrollBottom();
    busy = true; sendBtn.textContent = t('停止 ■', 'Stop ■'); sendBtn.classList.add('ai-stop');
    abort = new AbortController();
    function render(done) {
      var html = '';
      // Collapsed from the start: opening it while thinking and closing it when the answer starts made the reply jump.
      // Practice pages: the reasoning often just restates our instructions, so
      // readers only see that the model is thinking, not what it thinks.
      if (think && QUIZ) { if (!reply) html += '<p class="ai-status">' + t('思考中…', 'Thinking…') + '</p>'; }
      else if (think) html += '<details class="ai-think"><summary>' + (reply ? t('已思考', 'Thought') : t('思考中…', 'Thinking…')) + ' (' + think.length + ')</summary><p>' + esc(think).replace(/\n+/g, '<br>') + '</p></details>';
      el.innerHTML = html + md(done ? reply : settled(reply));
    }
    function onDelta(chunk, isThinking) {
      gotBytes = true;
      if (isThinking) think += chunk; else reply += chunk;
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0;
        // Follow the stream only while the reader is at the bottom, so
        // scrolling up to reread is not yanked back on every frame.
        var atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 40;
        render(); if (atBottom) scrollBottom();
      });
    }
    // A 讲解 button press stands alone: earlier turns would only muddle it, cost more,
    // and keep the relay from answering it from cache (same sentence = same request).
    var msgs = (source === 'example' || source === 'quiz' ? history.slice(-1) : history.slice(-SEND_TURNS * 2)).map(function (m) { return { role: m.role, content: m.content }; });
    var sc = source === 'quick' ? -1 : effectiveScope();
    var sys = systemPrompt(sc);
    // `src`, not `source`: GA4 reads an event param named source / medium /
    // campaign as the session's traffic source ("example" showed up as a referrer).
    track('ai_ask', { src: source, turn: Math.ceil(history.length / 2), lesson_chars: sys.length, scope: scope === -2 ? 'auto' : scope < 0 ? 'lesson' : 'section' });
    // The relay gets the source too: it counts which button was used.
    callRelay(sys, msgs, onDelta, abort.signal, source).then(function () {
      track('ai_answer', { src: source, ms: Date.now() - t0, chars: reply.length });
    }, function (e) {
      if (e && e.name === 'AbortError') { track('ai_stop', { ms: Date.now() - t0, chars: reply.length }); return; }
      var msg = e && e.message ? e.message : String(e);
      showError(msg);
      track('ai_error', { kind: errorKind(msg), status: (msg.match(/^HTTP (\d+)/) || [])[1] || '' });
    }).then(function () {
      clearTimeout(slowTimer);
      cancelAnimationFrame(raf); raf = 0;
      render(true);
      el.classList.remove('ai-streaming');
      if (reply && QUIZ) logQuiz(shown || text, reply, MODEL_ID);
      if (reply) { history.push({ role: 'assistant', content: reply }); el.setAttribute('data-raw', reply); el.appendChild(actionsFor(true)); }
      else el.remove();
      saveHist(history);
      panel.querySelector('.ai-clear').hidden = !history.length;
      busy = false; abort = null; sendBtn.textContent = t('发送 ↑', 'Send ↑'); sendBtn.classList.remove('ai-stop');
      scrollBottom();
    });
  }
  function stop() { if (abort) abort.abort(); }

  /* ── open / close ── */
  // Warm up DNS + TLS to the relay while the reader is still typing, so the
  // first question doesn't pay for the handshake.
  var warmed = false;
  function preconnect() {
    var m = /^https?:\/\/[^/]+/.exec(RELAY_URL);
    if (!m || warmed) return;
    warmed = true;
    var l = document.createElement('link');
    l.rel = 'preconnect'; l.href = m[0]; l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
  function open(prefill) {
    if (!panel) build();
    preconnect();
    document.body.classList.add('ai-open');
    refreshAuto();
    panel.removeAttribute('aria-hidden');
    if (prefill) { inputEl.value = prefill; autosize(); }
    setTimeout(function () { inputEl.focus(); inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length; }, 260);
    // On a phone the panel covers the lesson, and the back button / edge swipe
    // would leave the page. A history entry makes "back" close the panel.
    if (FULL_SCREEN.matches && !(window.history.state && window.history.state.aiPanel)) window.history.pushState(assign(assign({}, window.history.state), { aiPanel: true }), '');
    track('ai_open', {});
  }
  function close(fromHistory) {
    document.body.classList.remove('ai-open');
    if (panel) panel.setAttribute('aria-hidden', 'true');
    if (!fromHistory && window.history.state && window.history.state.aiPanel) window.history.back();   // drop the entry open() added
  }
  var FULL_SCREEN = window.matchMedia('(max-width: 760px)');
  window.addEventListener('popstate', function () {
    if (document.body.classList.contains('ai-open') && !(window.history.state && window.history.state.aiPanel)) close(true);
  });
  // A reload keeps the entry's state; clear it so the panel's entry is not mistaken for an open panel.
  if (window.history.state && window.history.state.aiPanel) window.history.replaceState(assign(assign({}, window.history.state), { aiPanel: false }), '');

  /* ── sidebar chat button ── */
  function addBtn() {
    var b = document.getElementById('ai-btn');
    if (!b) return;
    b.addEventListener('click', function () { document.body.classList.contains('ai-open') ? close() : open(); });
  }

  /* ── selection chip: select text in the lesson → 💬 问 AI ──
   * The quoted text is taken from the DOM range, not Selection.toString(), so
   * furigana (rt) and the 🔊 / 讲解 buttons never leak in. If the selection
   * runs past the end of an example sentence into its translation, only the
   * Japanese sentence is quoted. The grammar point containing the selection
   * becomes the context scope. The chip only fills the input box: explaining
   * a whole example sentence is the 讲解 button's job. */
  var chip = null;
  function plain(node) {
    var c = node.cloneNode(true), box = document.createElement('div');
    if (c.querySelectorAll) box.appendChild(c); else box.textContent = c.textContent;
    box.querySelectorAll('rt, rp, .speak-btn, .ai-ex-btn').forEach(function (n) { n.remove(); });
    return box.textContent.replace(/🔊/g, '').replace(/\s+/g, ' ').trim();
  }
  function japanesePart(s) { var m = s.match(/^(.*?[。！？!?])\s*[（(]/); return m ? m[1] : s; }
  function selectionInfo(s) {
    var range = s.getRangeAt(0), text = plain(range.cloneContents());
    if (!text) return null;
    var node = range.commonAncestorContainer; if (node.nodeType === 3) node = node.parentNode;
    var ex = node.closest && node.closest('li[data-ja], p[data-ja], td[data-ja]');
    if (ex) {
      var full = plain(ex), jp = japanesePart(full);
      if (/[（(]/.test(text) && text.length > jp.length / 2) text = jp;   // ran into the translation → quote the sentence
    }
    return { text: text.slice(0, 400), sec: sectionOf(ex || node) };
  }
  // Skeleton first: the main clause with the modifiers stripped, then what
  // modifies what, then the conjugations. Long sentences (where learners get
  // lost) are read by finding the core first; short ones skip part 2.
  function explainPrompt(s) {
    return t('「' + s + '」\n简明讲解这句话的语法，不要用表格，整体 350 字以内：\n' +
        '1. 主干：去掉所有修饰成分后的骨架，用「／」隔开，如「私は／犬を／飼っています」，再用一句话说清谁、做什么\n' +
        '2. 修饰：哪个成分修饰哪个，如「小さい → 犬」；有从句的说明从句从哪里到哪里；句子没有修饰成分就省略这一项\n' +
        '3. 活用和助词：只讲关键的，写出原形到句中形式的变化，如「飼う → 飼って＋います」；活用形的名称没有把握就不写名称\n' +
        '4. 语法点：只讲本句实际用到的语法，说明接续和意思；本课讲过的请标出，课文以外的标【补充】\n' +
        '5. 翻译：自然的中文\n' +
        '6. 易错点：只写课文里讲过的易错点，课文没提到就整项省略；没有把握的规则不要写',
      '"' + s + '"\nBriefly explain the grammar of this sentence, no tables, under 180 words:\n' +
        '1. Core: the bare skeleton with every modifier removed, split with "／", e.g. 私は／犬を／飼っています, then one line on who does what\n' +
        '2. Modifiers: what modifies what, e.g. 小さい → 犬; for a clause, say where it starts and ends; leave this part out if the sentence has none\n' +
        '3. Conjugations and particles: only the key ones, from dictionary form to the form used, e.g. 飼う → 飼って + います; if you aren\u2019t sure of a form\u2019s name, don\u2019t name it\n' +
        '4. Grammar points: only the patterns this sentence actually uses, with how they attach and what they mean; mark the ones taught in this lesson, and tag anything from outside the lesson [extra]\n' +
        '5. Translation: a natural one\n' +
        '6. Pitfalls: only one the lesson itself points out; if it doesn\u2019t, leave this part out. Don\u2019t state rules you aren\u2019t sure of');
  }
  function hideChip() { if (chip) chip.hidden = true; }
  function onSelect() {
    var s = window.getSelection();
    if (!s || s.rangeCount === 0 || s.isCollapsed || !article.contains(s.anchorNode) || !article.contains(s.focusNode)) { hideChip(); return; }
    var info = selectionInfo(s);
    if (!info || info.text.length > 400) { hideChip(); return; }
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'ai-sel-chip'; chip.type = 'button';
      chip.addEventListener('mousedown', function (e) { e.preventDefault(); });
      chip.addEventListener('click', function () {
        var q = chip.getAttribute('data-text'), sec = +chip.getAttribute('data-sec');
        hideChip();
        if (!panel) build();
        if (sec >= 0 && sec !== scope) { scope = sec; renderScope(); }
        pendingSource = 'selection';
        track('ai_select', { chars: q.length, scoped: sec >= 0, mode: 'ask' });
        open(t('「' + q + '」\n', '"' + q + '"\n'));
      });
      document.body.appendChild(chip);
    }
    chip.textContent = '💬 ' + t('问 AI', 'Ask AI');
    chip.setAttribute('data-text', info.text);
    chip.setAttribute('data-sec', info.sec);
    // Translation extensions (Google Translate, 划词翻译, DeepL…) drop their
    // bubble where the mouse was released — the selection's focus end. We use
    // the other end (where the drag started) and sit just above that line so
    // nothing on the line itself is covered; below it if there is no room.
    var range = s.getRangeAt(0), rects = range.getClientRects();
    if (!rects.length) { hideChip(); return; }
    var a = document.createRange(); a.setStart(s.anchorNode, s.anchorOffset); a.collapse(true);
    var f = document.createRange(); f.setStart(s.focusNode, s.focusOffset); f.collapse(true);
    var backward = a.compareBoundaryPoints(Range.START_TO_START, f) > 0;   // dragged right-to-left
    var r = backward ? rects[rects.length - 1] : rects[0];
    if (!r.width && !r.height) { hideChip(); return; }
    chip.hidden = false;
    var w = chip.offsetWidth || 90, h = chip.offsetHeight || 30;
    var left = backward ? r.right - w : r.left;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    var top = r.top - h - 6;
    if (top < 8) top = r.bottom + 6;
    chip.style.left = left + window.scrollX + 'px';
    chip.style.top = top + window.scrollY + 'px';
  }
  document.addEventListener('mouseup', function () { setTimeout(onSelect, 0); });
  document.addEventListener('touchend', function () { setTimeout(onSelect, 0); });
  document.addEventListener('selectionchange', function () { var s = window.getSelection(); if (!s || s.isCollapsed) hideChip(); });

  /* ── 讲解 button on every example sentence ──
   * Sits right after the sentence's 🔊 (inside the same no-wrap span), so
   * only model sentences with audio get one. One click sends a fixed
   * whole-sentence grammar breakdown; identical requests across readers mean
   * the free relay can answer repeats from its cache. */
  function explainSentence(li) {
    var sentence = japanesePart(plain(li)), sec = sectionOf(li);
    if (!sentence) return;
    if (!panel) build();
    if (sec >= 0 && sec !== scope) { scope = sec; renderScope(); }
    pendingSource = 'example';
    track('ai_select', { chars: sentence.length, scoped: sec >= 0, mode: 'button' });
    if (!busy) { open(); send(explainPrompt(sentence), t('讲解这句：「' + sentence + '」', 'Explain this sentence: "' + sentence + '"')); }
    else open(explainPrompt(sentence));
  }
  function addExplainBtns() {
    article.querySelectorAll('li[data-audio]').forEach(function (li) {
      var speak = li.querySelector('.speak-btn');
      if (!speak || li.querySelector('.ai-ex-btn')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ai-ex-btn';
      b.innerHTML = '<span class="lang-zh">讲解</span><span class="lang-en">Explain</span>';
      b.title = t('让 AI 讲解这句的语法', 'Ask the AI to explain this sentence\u2019s grammar');
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); explainSentence(li); });
      speak.parentNode.insertBefore(b, speak.nextSibling);
    });
  }

  /* ── quiz pages: explain the question just answered ──
   * ctx is the question as plain text (stem, options, answer, the learner's
   * choice, the fixed explanation, the linked lesson); prompt is the first
   * message. A new question starts a fresh chat, so follow-ups stay on it.
   * The first request has no times or dates in it, so the same question and
   * choice is the same request and the free relay can answer from cache. */
  if (QUIZ) window.jpAI = {
    explain: function (ctx, prompt, id) {
      if (busy) stop();
      quizId = id || null;
      article.textContent = ctx; wholeCache = null; sectionCache = null;
      history = []; saveHist(history);
      if (!panel) build(); else renderAll();
      pendingSource = 'quiz';
      track('ai_select', { chars: ctx.length, scoped: true, mode: 'quiz' });
      open(); send(prompt);
    }
  };

  // The 🔊 buttons are added on DOMContentLoaded by the page's TTS script;
  // wait a tick so they exist before the 讲解 buttons go in next to them.
  function init() { addBtn(); setTimeout(addExplainBtns, 0); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
