/* AI tutor side panel — "问 AI / Ask AI".
 *
 * A right-hand drawer on every lesson page. The reader supplies their own
 * API key (stored only in this browser's localStorage); the browser calls the
 * model provider directly, nothing goes through jpnotes.dev. The current
 * lesson's text (in the reader's active UI language) is sent as the system
 * prompt, so questions can be asked "in place" — including by selecting any
 * text in the lesson and clicking the floating 问 AI chip.
 *
 * Providers: Anthropic Claude (Messages API), and any OpenAI-compatible
 * /chat/completions endpoint (OpenAI, DeepSeek, Qwen/DashScope, local Ollama,
 * or a custom base URL). Responses stream token by token.
 */
(function () {
  'use strict';
  var article = document.querySelector('article.lesson');
  if (!article || !window.fetch || !window.ReadableStream) return;

  var CFG_KEY = 'jp_ai_cfg';
  var HIST_KEY = 'jp_ai_hist:' + location.pathname;
  var MAX_CONTEXT_CHARS = 30000;

  // group: 'intl' | 'cn' | 'local' | 'relay'. kind: 'anthropic' | 'openai' (any
  // /chat/completions-compatible endpoint). Model names drift; the ⟳ button in
  // settings fetches the live list from {base}/models.
  var PROVIDERS = {
    anthropic: { group: 'intl', name: 'Claude (Anthropic)', kind: 'anthropic', needsKey: true,
      base: 'https://api.anthropic.com', model: 'claude-opus-5', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6'],
      hintZh: '在 console.anthropic.com 创建 API key（按用量付费，与 claude.ai 订阅无关）。',
      hintEn: 'Create an API key at console.anthropic.com (pay-as-you-go; separate from a claude.ai subscription).' },
    openai: { group: 'intl', name: 'OpenAI (GPT)', kind: 'openai', needsKey: true,
      base: 'https://api.openai.com/v1', model: 'gpt-5', models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
      hintZh: '在 platform.openai.com 创建 API key。', hintEn: 'Create an API key at platform.openai.com.' },
    gemini: { group: 'intl', name: 'Google Gemini', kind: 'openai', needsKey: true,
      base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
      hintZh: '在 aistudio.google.com 创建 API key（有免费额度）。', hintEn: 'Create an API key at aistudio.google.com (free tier available).' },
    xai: { group: 'intl', name: 'xAI Grok', kind: 'openai', needsKey: true,
      base: 'https://api.x.ai/v1', model: 'grok-4', models: ['grok-4', 'grok-4-fast', 'grok-3', 'grok-3-mini'],
      hintZh: '在 console.x.ai 创建 API key。', hintEn: 'Create an API key at console.x.ai.' },
    mistral: { group: 'intl', name: 'Mistral', kind: 'openai', needsKey: true,
      base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'magistral-medium-latest', 'codestral-latest'],
      hintZh: '在 console.mistral.ai 创建 API key。', hintEn: 'Create an API key at console.mistral.ai.' },
    groq: { group: 'intl', name: 'Groq', kind: 'openai', needsKey: true,
      base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3-32b', 'moonshotai/kimi-k2-instruct'],
      hintZh: '在 console.groq.com 创建 API key（速度快，有免费额度）。', hintEn: 'Create an API key at console.groq.com (fast, free tier available).' },

    deepseek: { group: 'cn', name: 'DeepSeek', kind: 'openai', needsKey: true,
      base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'],
      hintZh: '在 platform.deepseek.com 创建 API key。', hintEn: 'Create an API key at platform.deepseek.com.' },
    qwen: { group: 'cn', name: '通义千问 Qwen (阿里云百炼)', kind: 'openai', needsKey: true,
      base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-flash', 'qwen-long', 'qwen3-235b-a22b', 'qwen3-32b'],
      hintZh: '在阿里云百炼 bailian.console.aliyun.com 创建 API key。', hintEn: 'Create an API key in Alibaba Cloud Model Studio (bailian.console.aliyun.com).' },
    kimi: { group: 'cn', name: 'Kimi (月之暗面)', kind: 'openai', needsKey: true,
      base: 'https://api.moonshot.cn/v1', model: 'kimi-k2-turbo-preview', models: ['kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'kimi-k2-thinking', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      hintZh: '在 platform.moonshot.cn 创建 API key。', hintEn: 'Create an API key at platform.moonshot.cn.' },
    zhipu: { group: 'cn', name: '智谱 GLM', kind: 'openai', needsKey: true,
      base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6', models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash', 'glm-4-plus'],
      hintZh: '在 open.bigmodel.cn 创建 API key。', hintEn: 'Create an API key at open.bigmodel.cn.' },
    doubao: { group: 'cn', name: '豆包 (火山方舟)', kind: 'openai', needsKey: true,
      base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-250615', models: ['doubao-seed-1-6-250615', 'doubao-seed-1-6-flash-250615', 'doubao-seed-1-6-thinking-250615', 'doubao-1-5-pro-32k-250115'],
      hintZh: '在火山方舟 console.volcengine.com/ark 创建 API key，模型填模型 ID 或接入点 ID。', hintEn: 'Create an API key in Volcengine Ark; use the model ID or endpoint ID as the model.' },
    minimax: { group: 'cn', name: 'MiniMax', kind: 'openai', needsKey: true,
      base: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2', models: ['MiniMax-M2', 'MiniMax-M1', 'MiniMax-Text-01'],
      hintZh: '在 platform.minimaxi.com 创建 API key（海外版用 api.minimax.io/v1）。', hintEn: 'Create an API key at platform.minimax.io (global base: api.minimax.io/v1).' },
    hunyuan: { group: 'cn', name: '腾讯混元', kind: 'openai', needsKey: true,
      base: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbos-latest', models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-lite'],
      hintZh: '在腾讯云控制台创建混元 API key。', hintEn: 'Create a Hunyuan API key in the Tencent Cloud console.' },
    qianfan: { group: 'cn', name: '百度文心 (千帆)', kind: 'openai', needsKey: true,
      base: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-turbo-128k', models: ['ernie-4.5-turbo-128k', 'ernie-4.5-turbo-32k', 'ernie-x1-turbo-32k', 'ernie-4.0-8k'],
      hintZh: '在百度千帆控制台创建 API key（bce-v3/… 格式）。', hintEn: 'Create an API key in the Baidu Qianfan console.' },

    ollama: { group: 'local', name: 'Ollama 本地 / Local', kind: 'openai', needsKey: false,
      base: 'http://localhost:11434/v1', model: 'qwen3', models: ['qwen3', 'qwen3:14b', 'qwen2.5', 'gemma3', 'llama3.1', 'deepseek-r1', 'mistral', 'phi4'],
      hintZh: '先启动：OLLAMA_ORIGINS=' + location.origin + ' ollama serve ，再 ollama pull 模型。Chrome 会询问是否允许访问本地网络，需点允许。',
      hintEn: 'Start with: OLLAMA_ORIGINS=' + location.origin + ' ollama serve, then ollama pull the model. Chrome will ask to allow local-network access.' },
    lmstudio: { group: 'local', name: 'LM Studio 本地 / Local', kind: 'openai', needsKey: false,
      base: 'http://localhost:1234/v1', model: '', models: [],
      hintZh: '在 LM Studio 里启动本地服务器并开启 CORS，然后点 ⟳ 获取已加载的模型。', hintEn: 'Start the LM Studio local server with CORS enabled, then click ⟳ to list loaded models.' },

    openrouter: { group: 'relay', name: 'OpenRouter (聚合)', kind: 'openai', needsKey: true,
      base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5', models: ['anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.1', 'openai/gpt-5', 'openai/gpt-5-mini', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat-v3.1', 'qwen/qwen3-235b-a22b', 'moonshotai/kimi-k2', 'x-ai/grok-4', 'openrouter/auto'],
      hintZh: '一个 key 用所有模型，在 openrouter.ai 创建；明确支持浏览器直连。', hintEn: 'One key for every model; create it at openrouter.ai. Browser calls are officially supported.' },
    siliconflow: { group: 'relay', name: '硅基流动 SiliconFlow (聚合)', kind: 'openai', needsKey: true,
      base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-235B-A22B', models: ['Qwen/Qwen3-235B-A22B', 'Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3.1', 'deepseek-ai/DeepSeek-R1', 'moonshotai/Kimi-K2-Instruct', 'zai-org/GLM-4.5'],
      hintZh: '在 cloud.siliconflow.cn 创建 API key。', hintEn: 'Create an API key at cloud.siliconflow.cn.' },
    custom: { group: 'relay', name: '自定义本地服务 / Custom local', kind: 'openai', needsKey: false,
      base: 'http://localhost:8000/v1', model: '', models: [],
      hintZh: '本机上任何 OpenAI 兼容服务（vLLM、llama.cpp、自建中转…）。为保护密钥，页面安全策略只允许连接上面列出的服务商和 localhost / 127.0.0.1。',
      hintEn: 'Any OpenAI-compatible server on this machine (vLLM, llama.cpp, your own relay…). To protect your key, the page security policy only allows the listed providers and localhost / 127.0.0.1.' }
  };
  var GROUPS = [['intl', '国际 / International'], ['cn', '国内 / China'], ['local', '本地 / Local'], ['relay', '聚合与自定义 / Relays & custom']];

  /* ── state ── */
  // cfg.session = true → stored in sessionStorage (gone when the tab closes).
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || JSON.parse(sessionStorage.getItem(CFG_KEY)) || null; } catch (e) { return null; }
  }
  function saveCfg(c) {
    try {
      (c.session ? sessionStorage : localStorage).setItem(CFG_KEY, JSON.stringify(c));
      (c.session ? localStorage : sessionStorage).removeItem(CFG_KEY);
    } catch (e) {}
  }
  var MODELS_KEY = 'jp_ai_models';
  function loadModelCache() { try { return JSON.parse(localStorage.getItem(MODELS_KEY)) || {}; } catch (e) { return {}; } }
  function saveModelCache(m) { try { localStorage.setItem(MODELS_KEY, JSON.stringify(m)); } catch (e) {} }
  function modelsFor(provider, current) {
    var p = PROVIDERS[provider] || {}, seen = {}, out = [];
    [].concat(current ? [current] : [], loadModelCache()[provider] || [], p.models || []).forEach(function (m) { if (m && !seen[m]) { seen[m] = 1; out.push(m); } });
    return out;
  }
  function forgetCfg() { try { localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY); } catch (e) {} }
  function hostOf(url) { try { return new URL(url).host; } catch (e) { return ''; } }
  function isLocalUrl(url) { return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url); }
  var SOURCE_URL = 'https://github.com/Ralphbupt/japanese-grammar/blob/main/site/ai-assistant.js';
  var PRIVACY_URL = '/about/#ai-privacy';
  function loadHist() { try { return JSON.parse(sessionStorage.getItem(HIST_KEY)) || []; } catch (e) { return []; } }
  function saveHist(h) { try { sessionStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) {} }
  function isEn() { return document.body.classList.contains('lang-en'); }
  function t(zh, en) { return isEn() ? en : zh; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Analytics (GA4 via window.gaEvent). Only metadata is sent — provider
  // preset, model name, where the question came from, error class, latency —
  // never the question, the answer, the key, or a custom base URL.
  function track(name, params) {
    if (!window.gaEvent) return;
    var p = { page_path: location.pathname };
    if (cfg) { p.provider = cfg.provider; p.model = (PROVIDERS[cfg.provider] || {}).models ? cfg.model : ''; }
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
  var pendingSource = 'typed';   // 'typed' | 'quick' | 'selection' — set before send()

  var cfg = loadCfg();
  var history = loadHist();   // [{role:'user'|'assistant', content}]
  var busy = false, abort = null;
  var panel, msgsEl, inputEl, sendBtn, settingsEl, modelLabel;

  /* ── lesson context ── */
  function lessonText() {
    var clone = article.cloneNode(true);
    clone.querySelectorAll('rt, rp, .speak-btn, .lesson-meta, .related-grammar, .checklist-progress, script, style, input').forEach(function (n) { n.remove(); });
    clone.querySelectorAll(isEn() ? '.lang-zh' : '.lang-en').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('tr').forEach(function (tr) {
      var cells = [].map.call(tr.querySelectorAll('td, th'), function (c) { return c.textContent.trim(); });
      tr.textContent = cells.join(' | ');
    });
    clone.querySelectorAll('h1,h2,h3,h4').forEach(function (h) {
      h.textContent = '\n' + '#'.repeat(+h.tagName[1]) + ' ' + h.textContent.trim() + '\n';
    });
    clone.querySelectorAll('li').forEach(function (li) { li.insertAdjacentText('afterbegin', '- '); });
    clone.querySelectorAll('p, li, tr, div, blockquote, pre, h1, h2, h3, h4').forEach(function (b) { b.insertAdjacentText('beforeend', '\n'); });
    var txt = (clone.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return txt.length > MAX_CONTEXT_CHARS ? txt.slice(0, MAX_CONTEXT_CHARS) + '\n…(truncated)' : txt;
  }
  function systemPrompt() {
    var lesson = lessonText();
    if (!isEn()) {
      return '你是一位日语语法老师，正在辅导一位备考 JLPT 的中文母语学习者。学习者此刻正在阅读下面这一课的笔记（网址 ' + location.href + '）。' +
        '请优先基于笔记内容回答；补充笔记之外的知识时请说明。回答用中文，日语例句请附上假名读音和中文翻译。回答简洁、多用例句、少说套话。' +
        '\n\n<lesson>\n' + lesson + '\n</lesson>';
    }
    return 'You are a Japanese grammar tutor helping a JLPT learner. The learner is currently reading the lesson notes below (' + location.href + '). ' +
      'Answer primarily from the notes and say so when you add outside knowledge. Reply in English; give Japanese examples with kana readings and English translations. Be concise, example-heavy, no filler.' +
      '\n\n<lesson>\n' + lesson + '\n</lesson>';
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
      try { var j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.type)) || j.message || txt; } catch (e) {}
      throw new Error('HTTP ' + res.status + ' – ' + String(msg).slice(0, 400));
    });
  }
  function fatal(msg) { var e = new Error(msg); e.aiFatal = true; return e; }

  function callAnthropic(c, sys, msgs, onDelta, signal) {
    return fetch(c.base.replace(/\/+$/, '') + '/v1/messages', {
      method: 'POST', signal: signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: c.model, max_tokens: 8192, stream: true, system: sys, messages: msgs })
    }).then(function (res) {
      if (!res.ok) return httpError(res);
      return readSSE(res, function (j) {
        if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') onDelta(j.delta.text);
        else if (j.type === 'error') throw fatal((j.error && j.error.message) || 'stream error');
        else if (j.type === 'message_delta' && j.delta && j.delta.stop_reason === 'refusal') onDelta('\n\n' + t('（模型拒绝了这个请求）', '(The model declined this request.)'));
      });
    });
  }
  function callOpenAI(c, sys, msgs, onDelta, signal) {
    var headers = { 'Content-Type': 'application/json' };
    if (c.key) headers.Authorization = 'Bearer ' + c.key;
    return fetch(c.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: signal, headers: headers,
      body: JSON.stringify({ model: c.model, stream: true, messages: [{ role: 'system', content: sys }].concat(msgs) })
    }).then(function (res) {
      if (!res.ok) return httpError(res);
      return readSSE(res, function (j) {
        if (j.error) throw fatal(j.error.message || JSON.stringify(j.error));
        var d = j.choices && j.choices[0] && j.choices[0].delta;
        if (d && d.content) onDelta(d.content);
      });
    });
  }

  /* ── tiny markdown ── */
  function md(src) {
    var s = esc(src);
    s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, function (m, c) { return '\u0000PRE' + btoa(unescape(encodeURIComponent(c))) + '\u0000'; });
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    var out = [], list = null, lines = s.split('\n');
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], m;
      if ((m = ln.match(/^\u0000PRE(.*)\u0000$/))) { closeList(); out.push('<pre><code>' + decodeURIComponent(escape(atob(m[1]))) + '</code></pre>'); continue; }
      if (!ln.trim()) { closeList(); continue; }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + m[1] + '</li>'); continue; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + m[1] + '</li>'); continue; }
      closeList();
      if ((m = ln.match(/^#{1,6}\s+(.*)/))) { out.push('<h4>' + m[1] + '</h4>'); continue; }
      out.push('<p>' + ln + '</p>');
    }
    closeList();
    return out.join('');
  }

  /* ── UI ── */
  function build() {
    panel = document.createElement('aside');
    panel.id = 'ai-panel';
    panel.setAttribute('aria-label', 'AI tutor');
    panel.innerHTML =
      '<div class="ai-head">' +
        '<span class="ai-title">🤖 <span class="lang-zh">问 AI</span><span class="lang-en">Ask AI</span> ' +
          '<button type="button" class="ai-model" title="' + esc(t('切换模型', 'Switch model')) + '"></button></span>' +
        '<div class="ai-model-menu" hidden></div>' +
        '<span class="ai-head-btns">' +
          '<button type="button" class="ai-new" title="' + esc(t('新对话', 'New chat')) + '">＋</button>' +
          '<button type="button" class="ai-gear" title="' + esc(t('设置', 'Settings')) + '">⚙</button>' +
          '<button type="button" class="ai-close" title="' + esc(t('关闭', 'Close')) + '">✕</button>' +
        '</span>' +
      '</div>' +
      '<div class="ai-msgs" aria-live="polite"></div>' +
      '<form class="ai-settings" hidden></form>' +
      '<form class="ai-input">' +
        '<textarea rows="3" placeholder="' + esc(t('问关于这一课的任何问题…', 'Ask anything about this lesson…')) + '"></textarea>' +
        '<div class="ai-input-row"><span class="ai-input-hint">' + esc(t('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter for a new line')) + '</span>' +
        '<button type="submit">' + esc(t('发送 ↑', 'Send ↑')) + '</button></div>' +
      '</form>';
    document.body.appendChild(panel);
    msgsEl = panel.querySelector('.ai-msgs');
    settingsEl = panel.querySelector('.ai-settings');
    inputEl = panel.querySelector('textarea');
    sendBtn = panel.querySelector('.ai-input button');
    modelLabel = panel.querySelector('.ai-model');

    panel.querySelector('.ai-close').addEventListener('click', close);
    var menu = panel.querySelector('.ai-model-menu');
    modelLabel.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!cfg) { showSettings(true); return; }
      if (!menu.hidden) { menu.hidden = true; return; }
      var items = modelsFor(cfg.provider, cfg.model);
      menu.innerHTML = '<div class="ai-menu-head">' + esc((PROVIDERS[cfg.provider] || { name: cfg.provider }).name) + '</div>' +
        items.map(function (m) { return '<button type="button" class="ai-menu-item' + (m === cfg.model ? ' sel' : '') + '" data-m="' + esc(m) + '">' + esc(m) + '</button>'; }).join('') +
        '<div class="ai-menu-sep"></div>' +
        '<button type="button" class="ai-menu-item ai-menu-settings">⚙ ' + esc(t('更多模型 / 换服务商…', 'More models / change provider…')) + '</button>';
      menu.hidden = false;
    });
    menu.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.ai-menu-item');
      if (!b) return;
      menu.hidden = true;
      if (b.classList.contains('ai-menu-settings')) { showSettings(true); return; }
      var m = b.getAttribute('data-m');
      if (m && m !== cfg.model) { cfg.model = m; saveCfg(cfg); track('ai_setup', { first: false, session_only: !!cfg.session, custom_host: false, via: 'menu' }); renderAll(); }
    });
    document.addEventListener('click', function () { if (menu && !menu.hidden) menu.hidden = true; });
    panel.querySelector('.ai-gear').addEventListener('click', function () { showSettings(settingsEl.hidden); });
    panel.querySelector('.ai-new').addEventListener('click', function () {
      if (busy) stop();
      history = []; saveHist(history); renderAll();
    });
    panel.querySelector('.ai-input').addEventListener('submit', function (e) { e.preventDefault(); if (busy) stop(); else send(inputEl.value); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(inputEl.value); }
    });
    inputEl.addEventListener('input', function () { autosize(); if (!inputEl.value.trim()) pendingSource = 'typed'; });
    msgsEl.addEventListener('click', function (e) {
      var q = e.target.closest && e.target.closest('.ai-quick');
      if (q) { pendingSource = 'quick'; send(q.getAttribute('data-q')); }
    });
    renderAll();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel && document.body.classList.contains('ai-open') && !settingsEl.contains(document.activeElement)) close(); });

  // Every label is produced by t() at render time, so when the reader flips
  // 中/EN we rebuild the panel in the new language, keeping the open state,
  // the draft in the input box and any unsaved settings edits.
  function formDraft() {
    if (!settingsEl || settingsEl.hidden) return null;
    var f = settingsEl;
    return { provider: f.querySelector('[name=provider]').value, base: f.querySelector('[name=base]').value, key: f.querySelector('[name=key]').value,
             model: f.querySelector('[name=model]').value, session: f.querySelector('[name=session]').checked };
  }
  function relocalize() {
    if (!panel) return;
    var draft = formDraft(), typed = inputEl.value, wasOpen = document.body.classList.contains('ai-open');
    panel.remove(); panel = null;
    build();
    inputEl.value = typed; autosize();
    if (draft) showSettings(true, draft);
    if (!wasOpen) panel.setAttribute('aria-hidden', 'true');
  }
  var lastEn = isEn();
  new MutationObserver(function () { if (isEn() !== lastEn) { lastEn = isEn(); relocalize(); } })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  function autosize() { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight + 2, window.innerHeight * 0.4) + 'px'; }

  function renderAll() {
    modelLabel.textContent = cfg ? (PROVIDERS[cfg.provider] || { name: cfg.provider }).name.split(' ')[0] + ' · ' + cfg.model + ' ▾' : t('未设置 ▾', 'not set ▾');
    msgsEl.innerHTML = '';
    if (!cfg) {
      msgsEl.innerHTML = '<div class="ai-note">' + esc(t('先在 ⚙ 设置里填入你的 API key。密钥只保存在本机浏览器，请求由浏览器直接发送给模型服务商，本站不经手。',
        'Add your API key in ⚙ Settings first. The key stays in this browser only; requests go straight from your browser to the provider, never through this site.')) + '</div>';
      showSettings(true);
      return;
    }
    if (!history.length) {
      var quick = isEn()
        ? ['Explain the hardest grammar point in this lesson simply', 'Give me 5 fresh example sentences using this lesson’s grammar', 'Quiz me with 5 multiple-choice questions', 'How do the grammar points in this lesson differ from each other?']
        : ['用最简单的话解释这一课最难的语法点', '用这一课的语法再造 5 个新例句', '出 5 道选择题考考我', '这一课的几个语法点之间有什么区别？'];
      msgsEl.innerHTML = '<div class="ai-note">' + esc(t('AI 已读过这一课的内容，可以直接提问；也可以在正文里选中一段文字后点「问 AI」。', 'The AI has read this lesson. Ask away, or select any text in the lesson and click "Ask AI".')) + '</div>' +
        '<div class="ai-quicks">' + quick.map(function (q) { return '<button type="button" class="ai-quick" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
      return;
    }
    history.forEach(function (m) { appendMsg(m.role, m.content); });
    scrollBottom();
  }
  function appendMsg(role, content) {
    var el = document.createElement('div');
    el.className = 'ai-msg ai-' + role;
    el.innerHTML = role === 'user' ? '<p>' + esc(content).replace(/\n/g, '<br>') + '</p>' : md(content);
    msgsEl.appendChild(el);
    return el;
  }
  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }
  function showError(msg) {
    var el = document.createElement('div');
    el.className = 'ai-msg ai-error';
    var hint = '';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      hint = t('（网络错误：通常是服务商不允许浏览器直连 (CORS)、base URL 写错，或本地 Ollama 未用 OLLAMA_ORIGINS 启动。）',
        '(Network error: usually the provider blocks browser calls (CORS), the base URL is wrong, or local Ollama was not started with OLLAMA_ORIGINS.)');
    } else if (/401|403|authentication|invalid.*key/i.test(msg)) {
      hint = t('（请检查 API key。）', '(Check your API key.)');
    }
    el.textContent = '⚠ ' + msg + ' ' + hint;
    msgsEl.appendChild(el); scrollBottom();
  }

  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    if (!cfg) { pendingSource = 'typed'; showSettings(true); return; }
    var source = pendingSource, t0 = Date.now();
    pendingSource = 'typed';
    if (!history.length) msgsEl.innerHTML = '';
    inputEl.value = ''; autosize();
    history.push({ role: 'user', content: text });
    appendMsg('user', text);
    var reply = '', el = appendMsg('assistant', ''), raf = 0;
    el.classList.add('ai-streaming');
    scrollBottom();
    busy = true; sendBtn.textContent = t('停止 ■', 'Stop ■'); sendBtn.classList.add('ai-stop');
    abort = new AbortController();
    function onDelta(chunk) {
      reply += chunk;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; el.innerHTML = md(reply); scrollBottom(); });
    }
    var msgs = history.map(function (m) { return { role: m.role, content: m.content }; });
    var sys = systemPrompt();
    var call = (PROVIDERS[cfg.provider] || PROVIDERS.custom).kind === 'anthropic' ? callAnthropic : callOpenAI;
    track('ai_ask', { source: source, turn: Math.ceil(history.length / 2), lesson_chars: sys.length });
    call(cfg, sys, msgs, onDelta, abort.signal).then(function () {
      track('ai_answer', { source: source, ms: Date.now() - t0, chars: reply.length });
    }, function (e) {
      if (e && e.name === 'AbortError') { track('ai_stop', { ms: Date.now() - t0, chars: reply.length }); return; }
      var msg = e && e.message ? e.message : String(e);
      showError(msg);
      track('ai_error', { kind: errorKind(msg), status: (msg.match(/^HTTP (\d+)/) || [])[1] || '' });
    }).then(function () {
      cancelAnimationFrame(raf); raf = 0;
      el.innerHTML = md(reply);
      el.classList.remove('ai-streaming');
      if (reply) history.push({ role: 'assistant', content: reply }); else el.remove();
      saveHist(history);
      busy = false; abort = null; sendBtn.textContent = t('发送 ↑', 'Send ↑'); sendBtn.classList.remove('ai-stop');
      scrollBottom();
    });
  }
  function stop() { if (abort) abort.abort(); }

  /* ── settings ── */
  function showSettings(on, draft) {
    settingsEl.hidden = !on;
    msgsEl.hidden = on;
    panel.querySelector('.ai-input').hidden = on;
    if (on) renderSettings(draft);
  }
  function renderSettings(draft) {
    var cur = draft || cfg || { provider: 'anthropic', base: PROVIDERS.anthropic.base, key: '', model: PROVIDERS.anthropic.model };
    settingsEl.innerHTML =
      '<label>' + esc(t('服务商', 'Provider')) + '<select name="provider">' +
        GROUPS.map(function (g) {
          return '<optgroup label="' + esc(g[1]) + '">' + Object.keys(PROVIDERS).filter(function (k) { return PROVIDERS[k].group === g[0]; }).map(function (k) {
            return '<option value="' + k + '"' + (k === cur.provider ? ' selected' : '') + '>' + esc(PROVIDERS[k].name) + '</option>';
          }).join('') + '</optgroup>';
        }).join('') +
      '</select></label>' +
      '<label>Base URL<input name="base" type="url" autocomplete="off" spellcheck="false" value="' + esc(cur.base) + '"></label>' +
      '<label>API Key<input name="key" type="password" autocomplete="off" spellcheck="false" value="' + esc(cur.key || '') + '"></label>' +
      '<label>' + esc(t('模型', 'Model')) + '<span class="ai-model-row"><input name="model" autocomplete="off" spellcheck="false" placeholder="' + esc(t('可手动输入任意模型名', 'Type any model name')) + '" value="' + esc(cur.model) + '">' +
        '<button type="button" class="ai-model-dd" title="' + esc(t('选择模型', 'Choose a model')) + '">▾</button>' +
        '<button type="button" class="ai-fetch" title="' + esc(t('从服务商获取全部可用模型', 'Fetch every available model from the provider')) + '">⟳</button>' +
        '<div class="ai-model-menu ai-settings-menu" hidden></div></span></label>' +
      '<p class="ai-hint"></p>' +
      '<p class="ai-hint ai-hostwarn" hidden></p>' +
      '<label class="ai-check"><input type="checkbox" name="session"' + (cur.session ? ' checked' : '') + '> ' +
        esc(t('只在本次会话保存密钥（关闭标签页后自动清除，公用电脑请勾选）', 'Keep the key for this tab only (cleared when the tab closes; use on shared computers)')) + '</label>' +
      '<div class="ai-privacy"><b>🔒 ' + esc(t('隐私与安全', 'Privacy & security')) + '</b><ul>' +
        '<li>' + esc(t('本站是纯静态页面，没有服务器。密钥只存在你这台设备的浏览器里，不会上传。', 'This site is static HTML with no server. Your key lives only in this browser on this device and is never uploaded.')) + '</li>' +
        '<li>' + esc(t('提问时，浏览器把这一课的内容和你的问题直接发给你选的服务商。页面设有安全策略 (CSP) 白名单，浏览器会拦截发往任何其他域名的请求。', 'When you ask, your browser sends this lesson and your question straight to the provider you chose. A Content-Security-Policy allowlist makes the browser block requests to any other domain.')) + '</li>' +
        '<li>' + esc(t('自行验证：按 F12 打开 Network 面板再提问，只会看到对服务商域名的请求。', 'Verify it yourself: open DevTools (F12) → Network and ask a question; only requests to the provider\u2019s domain appear.')) + '</li>' +
        '<li><a href="' + SOURCE_URL + '" target="_blank" rel="noopener">' + esc(t('查看源码', 'Read the source')) + '</a> · <a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">' + esc(t('详细说明', 'Full explanation')) + '</a></li>' +
      '</ul></div>' +
      '<div class="ai-settings-btns">' +
        '<button type="submit" class="ai-save">' + esc(t('保存', 'Save')) + '</button>' +
        (cfg ? '<button type="button" class="ai-cancel">' + esc(t('取消', 'Cancel')) + '</button><button type="button" class="ai-forget">' + esc(t('清除密钥', 'Forget key')) + '</button>' : '') +
      '</div>';
    var sel = settingsEl.querySelector('[name=provider]'), base = settingsEl.querySelector('[name=base]'),
        key = settingsEl.querySelector('[name=key]'), model = settingsEl.querySelector('[name=model]'),
        hint = settingsEl.querySelector('.ai-hint'), dd = settingsEl.querySelector('.ai-model-dd'), ddMenu = settingsEl.querySelector('.ai-settings-menu');
    function openModelMenu() {
      var items = modelsFor(sel.value, model.value.trim()), cached = !!loadModelCache()[sel.value];
      ddMenu.innerHTML = items.map(function (m) { return '<button type="button" class="ai-menu-item' + (m === model.value.trim() ? ' sel' : '') + '" data-m="' + esc(m) + '">' + esc(m) + '</button>'; }).join('') +
        '<div class="ai-menu-sep"></div>' +
        '<button type="button" class="ai-menu-item ai-menu-fetch">⟳ ' + esc(cached ? t('重新获取全部模型', 'Refresh the full list') : t('从服务商获取全部模型', 'Fetch every model from the provider')) + '</button>' +
        (cached ? '' : '<div class="ai-menu-head">' + esc(t('以上只是常用预设，完整列表请点获取。', 'These are common presets; fetch for the full list.')) + '</div>');
      ddMenu.hidden = false;
    }
    dd.addEventListener('click', function (e) { e.stopPropagation(); if (ddMenu.hidden) openModelMenu(); else ddMenu.hidden = true; });
    ddMenu.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest && e.target.closest('.ai-menu-item');
      if (!b) return;
      ddMenu.hidden = true;
      if (b.classList.contains('ai-menu-fetch')) { settingsEl.querySelector('.ai-fetch').click(); return; }
      model.value = b.getAttribute('data-m');
    });
    document.addEventListener('click', function () { if (!ddMenu.hidden) ddMenu.hidden = true; });
    function applyProvider(reset) {
      var p = PROVIDERS[sel.value];
      if (reset) { base.value = p.base; model.value = p.model; }
      base.readOnly = false;
      key.placeholder = p.needsKey ? '' : t('（可留空）', '(optional)');
      hint.textContent = isEn() ? p.hintEn : p.hintZh;
      hint.classList.remove('ai-hint-err');
      checkHost();
    }
    function checkHost() {
      var p = PROVIDERS[sel.value], warn = settingsEl.querySelector('.ai-hostwarn');
      var v = base.value.trim(), h = hostOf(v), preset = hostOf(p.base);
      var msg = '', fatalMsg = false;
      if (v && !/^https:\/\//i.test(v) && !isLocalUrl(v)) {
        fatalMsg = true;
        msg = t('⚠ 只允许 https:// 或本机 (localhost / 127.0.0.1) 地址，否则密钥会以明文在网络上传输。', '⚠ Only https:// or local (localhost / 127.0.0.1) URLs are allowed; anything else would send your key in plain text.');
      } else if (v && preset && h && h !== preset && !isLocalUrl(v)) {
        msg = t('⚠ 你的 API key 将发送到 ' + h + '，而不是 ' + p.name + ' 的官方地址 ' + preset + '。请确认你信任这个地址。', '⚠ Your API key will be sent to ' + h + ', not to ' + p.name + '\u2019s official host ' + preset + '. Make sure you trust it.');
      }
      warn.textContent = msg; warn.hidden = !msg;
      return !fatalMsg;
    }
    applyProvider(false);
    sel.addEventListener('change', function () { applyProvider(true); });
    base.addEventListener('input', checkHost);
    settingsEl.querySelector('.ai-fetch').addEventListener('click', function () {
      var btn = this, p = PROVIDERS[sel.value];
      var b = base.value.trim().replace(/\/+$/, ''), k = key.value.trim();
      if (!b) { hint.textContent = t('请先填 Base URL。', 'Enter the base URL first.'); return; }
      btn.disabled = true; hint.classList.remove('ai-hint-err'); hint.textContent = t('获取中…', 'Fetching…');
      var req = p.kind === 'anthropic'
        ? fetch(b + '/v1/models', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } })
        : fetch(b + '/models', { headers: k ? { Authorization: 'Bearer ' + k } : {} });
      req.then(function (res) { if (!res.ok) return httpError(res); return res.json(); }).then(function (j) {
        var ids = (j.data || j.models || []).map(function (m) { return m.id || m.name; }).filter(Boolean).sort();
        if (!ids.length) throw new Error(t('返回为空', 'empty list'));
        var mc = loadModelCache(); mc[sel.value] = ids.slice(0, 300); saveModelCache(mc);
        if (!model.value) model.value = ids[0];
        hint.textContent = t('已获取 ' + ids.length + ' 个模型。', ids.length + ' models loaded.');
        openModelMenu();
        track('ai_fetch_models', { provider: sel.value, ok: true, count: ids.length });
      }).catch(function (e) {
        track('ai_fetch_models', { provider: sel.value, ok: false, kind: errorKind(String(e && e.message)) });
        hint.classList.add('ai-hint-err');
        hint.textContent = t('获取失败：', 'Fetch failed: ') + (e && e.message ? e.message : e) + (/Failed to fetch|NetworkError|Load failed/i.test(String(e && e.message)) ? t('（该服务可能不允许浏览器直连，可改用 OpenRouter / 硅基流动等中转）', ' (the provider may block browser calls; try a relay like OpenRouter)') : '');
      }).then(function () { btn.disabled = false; });
    });
    settingsEl.onsubmit = function (e) {
      e.preventDefault();
      var p = PROVIDERS[sel.value];
      var next = { provider: sel.value, base: base.value.trim(), key: key.value.trim(), model: model.value.trim(), session: settingsEl.querySelector('[name=session]').checked };
      if (!next.base || !next.model || (p.needsKey && !next.key)) { hint.textContent = t('请填写完整。', 'Please fill in every field.'); hint.classList.add('ai-hint-err'); return; }
      if (!checkHost()) return;
      var first = !cfg, changed = !cfg || cfg.provider !== next.provider || cfg.model !== next.model;
      cfg = next; saveCfg(cfg);
      if (changed) track('ai_setup', { first: first, session_only: !!next.session, custom_host: hostOf(next.base) !== hostOf(p.base) });
      showSettings(false); renderAll();
      setTimeout(function () { inputEl.focus(); }, 0);
    };
    var cancel = settingsEl.querySelector('.ai-cancel'), forget = settingsEl.querySelector('.ai-forget');
    if (cancel) cancel.addEventListener('click', function () { showSettings(false); });
    if (forget) forget.addEventListener('click', function () {
      track('ai_forget', {});
      forgetCfg();
      cfg = null; renderAll();
    });
  }

  /* ── open / close ── */
  function open(prefill) {
    if (!panel) build();
    document.body.classList.add('ai-open');
    panel.removeAttribute('aria-hidden');
    if (prefill) { inputEl.value = prefill; autosize(); }
    if (cfg) setTimeout(function () { inputEl.focus(); inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length; }, 260);
    track('ai_open', { configured: !!cfg });
  }
  function close() {
    document.body.classList.remove('ai-open');
    if (panel) panel.setAttribute('aria-hidden', 'true');
  }

  /* ── 🤖 button in the top controls ── */
  function addBtn() {
    var host = document.getElementById('bottom-controls');
    if (!host) return;
    var b = document.createElement('button');
    b.id = 'ai-btn'; b.type = 'button';
    b.setAttribute('aria-label', '问 AI / Ask AI'); b.title = '问 AI / Ask AI';
    b.textContent = '🤖';
    b.addEventListener('click', function () { document.body.classList.contains('ai-open') ? close() : open(); });
    host.insertBefore(b, host.firstChild);
  }

  /* ── selection chip: select text in the lesson → 「问 AI」 ── */
  var chip = null;
  function hideChip() { if (chip) chip.hidden = true; }
  function onSelect() {
    var s = window.getSelection();
    var text = s && s.toString().trim();
    if (!text || text.length > 400 || s.rangeCount === 0 || !article.contains(s.anchorNode)) { hideChip(); return; }
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'ai-sel-chip'; chip.type = 'button';
      chip.addEventListener('mousedown', function (e) { e.preventDefault(); });
      chip.addEventListener('click', function () {
        var q = chip.getAttribute('data-text');
        hideChip();
        pendingSource = 'selection';
        track('ai_select', { chars: q.length });
        open(t('「' + q + '」\n这里怎么理解？', '"' + q + '"\nCan you explain this?'));
      });
      document.body.appendChild(chip);
    }
    chip.textContent = '✨ ' + t('问 AI', 'Ask AI');
    chip.setAttribute('data-text', text.replace(/\s+/g, ' '));
    var r = s.getRangeAt(0).getBoundingClientRect();
    chip.hidden = false;
    var left = Math.max(8, Math.min(window.innerWidth - 110, r.left + r.width / 2 - 45));
    chip.style.left = left + window.scrollX + 'px';
    chip.style.top = (r.top + window.scrollY - 38) + 'px';
  }
  document.addEventListener('mouseup', function () { setTimeout(onSelect, 0); });
  document.addEventListener('touchend', function () { setTimeout(onSelect, 0); });
  document.addEventListener('selectionchange', function () { var s = window.getSelection(); if (!s || !s.toString().trim()) hideChip(); });

  if (document.readyState !== 'loading') addBtn();
  else document.addEventListener('DOMContentLoaded', addBtn);
})();
