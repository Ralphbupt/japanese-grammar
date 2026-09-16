/* AI tutor side panel — "问 AI / Ask AI".
 *
 * A right-hand drawer on every lesson page. The reader supplies their own
 * API key (stored only in this browser); the browser calls the model provider
 * directly, nothing goes through jpnotes.dev. The current lesson's text (or
 * just the grammar point being read, see "context") is sent as the system
 * prompt, so questions can be asked "in place" — including by selecting any
 * text in the lesson and clicking the floating 问 AI chip.
 *
 * Providers: Anthropic Claude (Messages API), and any OpenAI-compatible
 * /chat/completions endpoint (OpenAI, DeepSeek, Qwen/DashScope, local Ollama,
 * or a custom base URL). Responses stream token by token. Several providers
 * can be configured at once and switched from the header menu.
 */
(function () {
  'use strict';
  var article = document.querySelector('article.lesson');
  if (!article || !window.fetch || !window.ReadableStream) return;

  var CFG_KEY = 'jp_ai_cfg';          // v2: { v, active, profiles: { provider: { base, key, model } }, effort, session }
  var HIST_KEY = 'jp_ai_hist:' + location.pathname;
  var MODELS_KEY = 'jp_ai_models';
  var MAX_CONTEXT_CHARS = 30000;
  var MAX_HISTORY_MSGS = 24;          // kept per lesson (12 turns); older ones are dropped
  var SEND_TURNS = 6;                 // turns sent with each request

  // group: 'intl' | 'cn' | 'local' | 'relay'. kind: 'anthropic' | 'openai' (any
  // /chat/completions-compatible endpoint). Model names drift; the ⟳ button in
  // settings fetches the live list from {base}/models. keyUrl is where the
  // reader creates a key; `free` is the one-line pitch shown in the first-run
  // wizard for the recommended providers.
  // /chat/completions-compatible endpoint). Model names drift; the ⟳ button in
  // settings fetches the live list from {base}/models.
  var PROVIDERS = {
    anthropic: { keyUrl: 'https://console.anthropic.com/settings/keys', group: 'intl', name: 'Claude (Anthropic)', kind: 'anthropic', needsKey: true,
      base: 'https://api.anthropic.com', model: 'claude-opus-5', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-opus-4-8', 'claude-sonnet-4-6'],
      hintZh: '在 console.anthropic.com 创建 API key（按用量付费，与 claude.ai 订阅无关）。',
      hintEn: 'Create an API key at console.anthropic.com (pay-as-you-go; separate from a claude.ai subscription).' },
    openai: { keyUrl: 'https://platform.openai.com/api-keys', group: 'intl', name: 'OpenAI (GPT)', kind: 'openai', needsKey: true,
      base: 'https://api.openai.com/v1', model: 'gpt-5.6', models: ['gpt-6-astra', 'gpt-5.6', 'gpt-5.5', 'gpt-5.6-terra', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.6-luna'],
      hintZh: '在 platform.openai.com 创建 API key。', hintEn: 'Create an API key at platform.openai.com.' },
    gemini: { keyUrl: 'https://aistudio.google.com/apikey', freeZh: '有免费额度，Google 账号即可', freeEn: 'Free tier, just a Google account', group: 'intl', name: 'Google Gemini', kind: 'openai', needsKey: true,
      base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-pro-preview', models: ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'],
      hintZh: '在 aistudio.google.com 创建 API key（有免费额度）。', hintEn: 'Create an API key at aistudio.google.com (free tier available).' },
    xai: { keyUrl: 'https://console.x.ai/', group: 'intl', name: 'xAI Grok', kind: 'openai', needsKey: true,
      base: 'https://api.x.ai/v1', model: 'grok-4.6', models: ['grok-4.6', 'grok-4.5', 'grok-4.3', 'grok-4.20-0309-reasoning'],
      hintZh: '在 console.x.ai 创建 API key。', hintEn: 'Create an API key at console.x.ai.' },
    mistral: { keyUrl: 'https://console.mistral.ai/api-keys', group: 'intl', name: 'Mistral', kind: 'openai', needsKey: true,
      base: 'https://api.mistral.ai/v1', model: 'mistral-medium-latest', models: ['mistral-medium-latest', 'mistral-large-latest', 'mistral-small-latest', 'mistral-medium-3-5', 'mistral-large-2512', 'mistral-small-2603', 'ministral-14b-2512'],
      hintZh: '在 console.mistral.ai 创建 API key。', hintEn: 'Create an API key at console.mistral.ai.' },
    groq: { keyUrl: 'https://console.groq.com/keys', freeZh: '有免费额度，回答极快', freeEn: 'Free tier, very fast answers', group: 'intl', name: 'Groq', kind: 'openai', needsKey: true,
      base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'groq/compound', 'groq/compound-mini'],
      hintZh: '在 console.groq.com 创建 API key（速度快，有免费额度）。', hintEn: 'Create an API key at console.groq.com (fast, free tier available).' },

    deepseek: { keyUrl: 'https://platform.deepseek.com/api_keys', freeZh: '便宜好用，需充值（几元够用很久）', freeEn: 'Cheap and good; needs a small top-up', group: 'cn', name: 'DeepSeek', kind: 'openai', needsKey: true,
      base: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro', models: ['deepseek-v4-pro', 'deepseek-flash'],
      hintZh: '在 platform.deepseek.com 创建 API key。deepseek-chat / deepseek-reasoner 已于 2026-07 停服。', hintEn: 'Create an API key at platform.deepseek.com. deepseek-chat / deepseek-reasoner were retired in 2026-07.' },
    qwen: { keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key', group: 'cn', name: '通义千问 Qwen (阿里云百炼)', kind: 'openai', needsKey: true,
      base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-max', models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.8-27b', 'qwen-plus', 'qwen-flash'],
      hintZh: '在阿里云百炼 bailian.console.aliyun.com 创建 API key。', hintEn: 'Create an API key in Alibaba Cloud Model Studio (bailian.console.aliyun.com).' },
    kimi: { keyUrl: 'https://platform.moonshot.cn/console/api-keys', group: 'cn', name: 'Kimi (月之暗面)', kind: 'openai', needsKey: true,
      base: 'https://api.moonshot.cn/v1', model: 'kimi-k3', models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code'],
      hintZh: '在 platform.moonshot.cn 创建 API key。', hintEn: 'Create an API key at platform.moonshot.cn.' },
    zhipu: { keyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys', freeZh: '有免费模型 (glm-4.5-flash)，注册送额度', freeEn: 'Free flash model plus signup credit', group: 'cn', name: '智谱 GLM', kind: 'openai', needsKey: true,
      base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', models: ['glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-5.3-flash', 'glm-4.7', 'glm-4.7-flash', 'glm-4.5-flash'],
      hintZh: '在 open.bigmodel.cn 创建 API key。', hintEn: 'Create an API key at open.bigmodel.cn.' },
    doubao: { keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', group: 'cn', name: '豆包 (火山方舟)', kind: 'openai', needsKey: true,
      base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-1-pro-260628', models: ['doubao-seed-2-1-pro-260628', 'doubao-seed-2-1-turbo-260628', 'doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-mini-260428', 'doubao-seed-evolving'],
      hintZh: '在火山方舟 console.volcengine.com/ark 创建 API key，模型填模型 ID 或接入点 ID。', hintEn: 'Create an API key in Volcengine Ark; use the model ID or endpoint ID as the model.' },
    minimax: { keyUrl: 'https://platform.minimaxi.cn/user-center/basic-information/interface-key', group: 'cn', name: 'MiniMax', kind: 'openai', needsKey: true, altBase: 'https://api.minimax.io/v1',
      base: 'https://api.minimaxi.cn/v1', model: 'MiniMax-M3', models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5'],
      hintZh: '在 platform.minimax.cn 创建 API key；国际版把 Base URL 改成 https://api.minimax.io/v1。', hintEn: 'Create an API key at platform.minimax.io and set the base URL to https://api.minimax.io/v1 (China: api.minimaxi.cn).' },
    hunyuan: { keyUrl: 'https://tokenhub.tencentmaas.com/', group: 'cn', name: '腾讯混元 (TokenHub)', kind: 'openai', needsKey: true, altBase: 'https://api.hunyuan.cloud.tencent.com/v1',
      base: 'https://tokenhub.tencentmaas.com/v1', model: 'hy4-preview', models: ['hy4-preview', 'hy3', 'hy3-preview', 'hunyuan-2.0-thinking-20251109', 'hunyuan-2.0-instruct-20251111'],
      hintZh: '新模型 (hy4/hy3) 在 TokenHub 平台，去 tokenhub.tencentmaas.com 创建 key。旧平台 api.hunyuan.cloud.tencent.com/v1 的 key 不通用，用旧平台请改 Base URL。', hintEn: 'New models (hy4/hy3) live on TokenHub; create the key at tokenhub.tencentmaas.com. Keys for the legacy api.hunyuan.cloud.tencent.com/v1 endpoint are separate.' },
    qianfan: { keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list', group: 'cn', name: '百度文心 (千帆)', kind: 'openai', needsKey: true,
      base: 'https://qianfan.baidubce.com/v2', model: 'ernie-5.1', models: ['ernie-5.1', 'ernie-5.0', 'ernie-5.0-thinking-latest', 'ernie-4.5-turbo-128k', 'ernie-4.5-turbo-32k'],
      hintZh: '在百度千帆控制台创建 API key（bce-v3/… 格式）。', hintEn: 'Create an API key in the Baidu Qianfan console.' },

    ollama: { group: 'local', name: 'Ollama 本地 / Local', kind: 'openai', needsKey: false,
      base: 'http://localhost:11434/v1', model: 'qwen3', models: ['qwen3', 'qwen3:14b', 'qwen2.5', 'gemma3', 'llama3.1', 'deepseek-r1', 'mistral', 'phi4'],
      hintZh: '先启动：OLLAMA_ORIGINS=' + location.origin + ' OLLAMA_CONTEXT_LENGTH=16384 ollama serve ，再 ollama pull 模型，点 ⟳ 选本机已装的模型。Chrome 会询问是否允许访问本地网络，需点允许。qwen3 等模型默认先「思考」再回答，选「快速」可关闭思考。',
      hintEn: 'Start with: OLLAMA_ORIGINS=' + location.origin + ' OLLAMA_CONTEXT_LENGTH=16384 ollama serve, then ollama pull a model and click ⟳ to pick an installed one. Chrome will ask to allow local-network access. Thinking models (qwen3 etc.) reason before answering; choose Quick to turn thinking off.' },
    lmstudio: { group: 'local', name: 'LM Studio 本地 / Local', kind: 'openai', needsKey: false,
      base: 'http://localhost:1234/v1', model: '', models: [],
      hintZh: '在 LM Studio 里启动本地服务器并开启 CORS，然后点 ⟳ 获取已加载的模型。', hintEn: 'Start the LM Studio local server with CORS enabled, then click ⟳ to list loaded models.' },

    openrouter: { keyUrl: 'https://openrouter.ai/settings/keys', freeZh: '一个 key 用所有模型，有免费模型', freeEn: 'One key for every model; some models are free', group: 'relay', name: 'OpenRouter (聚合)', kind: 'openai', needsKey: true,
      base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', models: ['openrouter/auto', 'anthropic/claude-opus-5', 'anthropic/claude-sonnet-5', 'openai/gpt-6-astra', 'openai/gpt-5.6-sol', 'google/gemini-3.1-pro-preview', 'google/gemini-3.8-flash', 'deepseek/deepseek-v4-pro', 'qwen/qwen3.8-max-0902', 'moonshotai/kimi-k3', 'z-ai/glm-5.3', 'x-ai/grok-4.6', 'minimax/minimax-m3'],
      hintZh: '一个 key 用所有模型，在 openrouter.ai 创建；明确支持浏览器直连。', hintEn: 'One key for every model; create it at openrouter.ai. Browser calls are officially supported.' },
    siliconflow: { keyUrl: 'https://cloud.siliconflow.cn/account/ak', freeZh: '注册送额度，一个 key 可用 DeepSeek / Qwen / GLM', freeEn: 'Signup credit; one key for DeepSeek / Qwen / GLM', group: 'relay', name: '硅基流动 SiliconFlow (聚合)', kind: 'openai', needsKey: true,
      base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V4-Pro', models: ['deepseek-ai/DeepSeek-V4-Pro', 'deepseek-ai/DeepSeek-V4-Flash', 'zai-org/GLM-5.3', 'Qwen/Qwen3.8-27B', 'moonshotai/Kimi-K2.7-Code', 'Pro/moonshotai/Kimi-K2.6', 'zai-org/GLM-5.2', 'Qwen/Qwen3.6-35B-A3B', 'tencent/Hy4-preview'],
      hintZh: '在 cloud.siliconflow.cn 创建 API key。', hintEn: 'Create an API key at cloud.siliconflow.cn.' },
    custom: { group: 'relay', name: '自定义本地服务 / Custom local', kind: 'openai', needsKey: false,
      base: 'http://localhost:8000/v1', model: '', models: [],
      hintZh: '本机上任何 OpenAI 兼容服务（vLLM、llama.cpp、自建中转…）。为保护密钥，页面安全策略只允许连接上面列出的服务商和 localhost / 127.0.0.1。',
      hintEn: 'Any OpenAI-compatible server on this machine (vLLM, llama.cpp, your own relay…). To protect your key, the page security policy only allows the listed providers and localhost / 127.0.0.1.' }
  };

  var GROUPS = [['intl', '国际 / International'], ['cn', '国内 / China'], ['local', '本地 / Local'], ['relay', '聚合与自定义 / Relays & custom']];
  var RECOMMEND = { zh: ['siliconflow', 'zhipu', 'deepseek'], en: ['gemini', 'groq', 'openrouter'] };

  /* ── config (several providers, one active) ── */
  // cfg.session = true → stored in sessionStorage (gone when the tab closes).
  function loadCfg() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(CFG_KEY)) || JSON.parse(sessionStorage.getItem(CFG_KEY)) || null; } catch (e) {}
    if (!raw) return null;
    if (raw.v !== 2) {                       // v1 shape: { provider, base, key, model, session, effort }
      if (!raw.provider || !PROVIDERS[raw.provider]) return null;
      var pr = {}; pr[raw.provider] = { base: raw.base, key: raw.key || '', model: raw.model };
      raw = { v: 2, active: raw.provider, profiles: pr, effort: raw.effort || '', session: !!raw.session };
    }
    if (!raw.profiles || !raw.profiles[raw.active]) return null;
    return raw;
  }
  function saveCfg(c) {
    try {
      (c.session ? sessionStorage : localStorage).setItem(CFG_KEY, JSON.stringify(c));
      (c.session ? localStorage : sessionStorage).removeItem(CFG_KEY);
    } catch (e) {}
  }
  function forgetCfg() { try { localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY); } catch (e) {} }
  function active() { return cfg ? cfg.profiles[cfg.active] : null; }
  // Flat view of the active profile, the shape the request builders take.
  function callCfg() { var a = active(); return { provider: cfg.active, base: a.base, key: a.key, model: a.model, effort: cfg.effort || '' }; }
  function setProfile(provider, prof, makeActive) {
    if (!cfg) cfg = { v: 2, active: provider, profiles: {}, effort: '', session: false };
    cfg.profiles[provider] = prof;
    if (makeActive) cfg.active = provider;
    saveCfg(cfg);
  }
  function configuredProviders() { return cfg ? Object.keys(cfg.profiles).filter(function (k) { return PROVIDERS[k]; }) : []; }

  function loadModelCache() { try { return JSON.parse(localStorage.getItem(MODELS_KEY)) || {}; } catch (e) { return {}; } }
  function saveModelCache(m) { try { localStorage.setItem(MODELS_KEY, JSON.stringify(m)); } catch (e) {} }
  function modelsFor(provider, current) {
    var p = PROVIDERS[provider] || {}, seen = {}, out = [], cached = loadModelCache()[provider];
    // Local servers: the presets are just names you *could* pull, so once the
    // server has told us what is installed, list only that.
    var presets = p.group === 'local' && cached ? [] : (p.models || []);
    [].concat(current ? [current] : [], cached || [], presets).forEach(function (m) { if (m && !seen[m]) { seen[m] = 1; out.push(m); } });
    return out;
  }
  // Ask a local server (no key, no cost) for its installed models and cache them.
  function refreshLocalModels(provider) {
    var p = PROVIDERS[provider], prof = cfg && cfg.profiles[provider];
    if (!p || p.group !== 'local' || !prof) return Promise.resolve(false);
    return fetch(prof.base.replace(/\/+$/, '') + '/models').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var ids = ((j && (j.data || j.models)) || []).map(function (m) { return m.id || m.name; }).filter(Boolean).sort();
      if (!ids.length) return false;
      var mc = loadModelCache(), same = JSON.stringify(mc[provider] || []) === JSON.stringify(ids);
      mc[provider] = ids; saveModelCache(mc);
      return !same;
    }).catch(function () { return false; });
  }
  function hostOf(url) { try { return new URL(url).host; } catch (e) { return ''; } }
  function isLocalUrl(url) { return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url); }
  var SOURCE_URL = 'https://github.com/Ralphbupt/japanese-grammar/blob/main/site/ai-assistant.js';
  var PRIVACY_URL = '/about/#ai-privacy';

  /* ── history (per lesson, survives tab close) ── */
  function loadHist() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY)) || JSON.parse(sessionStorage.getItem(HIST_KEY)) || []; } catch (e) { return []; }
  }
  function saveHist(h) {
    if (h.length > MAX_HISTORY_MSGS) h.splice(0, h.length - MAX_HISTORY_MSGS);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); sessionStorage.removeItem(HIST_KEY); } catch (e) {}
  }

  function isEn() { return document.body.classList.contains('lang-en'); }
  function t(zh, en) { return isEn() ? en : zh; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }

  // Analytics (GA4 via window.gaEvent). Only metadata is sent — provider
  // preset, model name, where the question came from, error class, latency —
  // never the question, the answer, the key, or a custom base URL.
  function track(name, params) {
    if (!window.gaEvent) return;
    var p = { page_path: location.pathname };
    if (cfg) { p.provider = cfg.active; p.model = (PROVIDERS[cfg.active] || {}).models ? active().model : ''; }
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
  var pendingSource = 'typed';   // 'typed' | 'quick' | 'selection' | 'retry' — set before send()

  var cfg = loadCfg();
  var history = loadHist();      // [{role:'user'|'assistant', content}]
  var busy = false, abort = null;
  var panel, msgsEl, inputEl, sendBtn, settingsEl, modelLabel, scopeSel;

  /* ── lesson context ──
   * "Scope" is what the model sees: the whole lesson (scope = -1) or one
   * numbered grammar point (index into sections()). Selecting text inside a
   * grammar point narrows the scope to it automatically; the 📎 row above the
   * input shows the current choice and lets the reader change it. */
  var scope = -1, sectionCache = null;
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
    root.querySelectorAll('rt, rp, .speak-btn, .lesson-meta, .related-grammar, .checklist-progress, script, style, input').forEach(function (n) { n.remove(); });
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
  var wholeCache = null;
  function wholeText() {
    if (wholeCache === null || wholeCache.en !== isEn()) wholeCache = { en: isEn(), txt: textOf(article.cloneNode(true)) };
    return wholeCache.txt;
  }
  function contextText() {
    if (scope < 0 || !sections()[scope]) return wholeText();
    var box = document.createElement('div'), h1 = article.querySelector('h1');
    if (h1) box.appendChild(h1.cloneNode(true));
    sections()[scope].nodes.forEach(function (n) { box.appendChild(n.cloneNode(true)); });
    return textOf(box);
  }
  function contextChars(i) {
    if (i < 0) return wholeText().length;
    var s = sections()[i];
    if (!s.chars) { var box = document.createElement('div'); s.nodes.forEach(function (n) { box.appendChild(n.cloneNode(true)); }); s.chars = textOf(box).length; }
    return s.chars;
  }
  function kChars(n) { return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n); }

  // "Thinking depth": '' (standard) sends nothing so each provider's default
  // applies; 'low' / 'high' map onto the provider's own knob where one is known
  // to exist for that model family, and otherwise only shape the prompt. Unknown
  // combos deliberately send nothing rather than risk a 400.
  var EFFORTS = [['low', '快速', 'Quick'], ['', '标准', 'Standard'], ['high', '深入', 'Deep']];
  function effortLabel(e) { var r = EFFORTS.filter(function (x) { return x[0] === (e || ''); })[0]; return r ? (isEn() ? r[2] : r[1]) : ''; }
  function effortParams(c) {
    var e = c.effort || '', m = c.model || '', k = c.provider;
    if (!e) return {};
    if (k === 'anthropic') return /haiku|sonnet-4-5|opus-4-[0-5]|claude-3/.test(m) ? {} : { output_config: { effort: e } };
    if (k === 'openai') return /^(gpt-[5-9]|o\d)/.test(m) ? { reasoning_effort: e } : {};
    if (k === 'gemini') return /^gemini-(2\.5|3)/.test(m) ? { reasoning_effort: e } : {};
    if (k === 'xai') return /^grok-4\.[2-9]|^grok-[5-9]/.test(m) ? { reasoning_effort: e } : {};
    if (k === 'mistral') return /medium|small/.test(m) ? { reasoning_effort: e === 'high' ? 'high' : 'none' } : {};
    if (k === 'groq') return /gpt-oss|qwen3/.test(m) ? { reasoning_effort: e } : {};
    if (k === 'openrouter') return { reasoning: { effort: e } };
    if (k === 'ollama' || k === 'lmstudio') return { reasoning_effort: e === 'low' ? 'none' : e };
    if (k === 'zhipu') {
      if (/^glm-5\.3/.test(m)) return { thinking: { type: 'enabled' }, reasoning_effort: e };   // 5.3 cannot disable thinking
      return /^glm-(4\.[5-9]|[5-9])/.test(m) ? { thinking: { type: e === 'low' ? 'disabled' : 'enabled' } } : {};
    }
    if (k === 'qwen') return /^qwen3|^qwen-(plus|turbo|flash)/.test(m) ? { enable_thinking: e === 'high' } : {};
    if (k === 'deepseek') return e === 'low' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: 'high' };
    if (k === 'kimi') {
      if (/^kimi-k3/.test(m)) return { reasoning_effort: e };
      return /^kimi-k2\.6/.test(m) ? { thinking: { type: e === 'low' ? 'disabled' : 'enabled' } } : {};
    }
    if (k === 'doubao') return { thinking: { type: e === 'low' ? 'disabled' : 'enabled' } };
    if (k === 'minimax') return /M3/i.test(m) && e === 'low' ? { thinking: { type: 'disabled' } } : {};
    if (k === 'hunyuan') return /^hy[34]|thinking/.test(m) ? { thinking: { type: e === 'low' ? 'disabled' : 'enabled' } } : {};
    if (k === 'qianfan') return { enable_thinking: e === 'high' };
    if (k === 'siliconflow') return /DeepSeek-V4|Qwen3|GLM-5|Kimi-K2\.6|Hy4/i.test(m) ? { enable_thinking: e === 'high' } : {};
    return {};
  }
  function effortPrompt(c) {
    var e = c.effort || '';
    if (e === 'low') return isEn() ? ' Keep answers short: 3–5 sentences, conclusion first.' : ' 回答尽量简短，3–5 句，先给结论。';
    if (e === 'high') return isEn() ? ' Feel free to go deep: more examples, side-by-side comparisons with similar grammar, and common mistakes.' : ' 可以详细展开：多给例句，和相近语法对比辨析，并指出易错点。';
    return '';
  }
  function systemPrompt() {
    var ctx = contextText(), scoped = scope >= 0 && sections()[scope];
    if (!isEn()) {
      return '你是一位日语语法老师，正在辅导一位备考 JLPT 的中文母语学习者。学习者此刻正在阅读' +
        (scoped ? '下面这一课中「' + sectionTitle(scope) + '」这一节' : '下面这一课的笔记') + '（网址 ' + location.href + '）。' +
        '请优先基于笔记内容回答；补充笔记之外的知识时请说明。回答用中文。日语例句里的汉字请紧跟全角括号标注假名读音，格式如「雨（あめ）に降（ふ）られた」，并附中文翻译。回答简洁、多用例句、少说套话。' + effortPrompt(cfg) +
        '\n\n<lesson>\n' + ctx + '\n</lesson>';
    }
    return 'You are a Japanese grammar tutor helping a JLPT learner. The learner is currently reading ' +
      (scoped ? 'the section "' + sectionTitle(scope) + '" of the lesson notes below' : 'the lesson notes below') + ' (' + location.href + '). ' +
      'Answer primarily from the notes and say so when you add outside knowledge. Reply in English. In Japanese examples, put the kana reading right after each kanji word in full-width parentheses, e.g. 雨（あめ）に降（ふ）られた, and add an English translation. Be concise, example-heavy, no filler.' + effortPrompt(cfg) +
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
      try { var j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.type)) || j.message || txt; } catch (e) {}
      throw new Error('HTTP ' + res.status + ' – ' + String(msg).slice(0, 400));
    });
  }
  function fatal(msg) { var e = new Error(msg); e.aiFatal = true; return e; }
  function anthropicHeaders(c) {
    return { 'Content-Type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  }
  function openaiHeaders(c) {
    var h = { 'Content-Type': 'application/json' };
    if (c.key) h.Authorization = 'Bearer ' + c.key;
    return h;
  }
  function callAnthropic(c, sys, msgs, onDelta, signal) {
    return fetch(c.base.replace(/\/+$/, '') + '/v1/messages', {
      method: 'POST', signal: signal, headers: anthropicHeaders(c),
      body: JSON.stringify(assign({ model: c.model, max_tokens: 8192, stream: true, system: sys, messages: msgs }, effortParams(c)))
    }).then(function (res) {
      if (!res.ok) return httpError(res);
      return readSSE(res, function (j) {
        if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') onDelta(j.delta.text);
        else if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'thinking_delta') onDelta(j.delta.thinking, true);
        else if (j.type === 'error') throw fatal((j.error && j.error.message) || 'stream error');
        else if (j.type === 'message_delta' && j.delta && j.delta.stop_reason === 'refusal') onDelta('\n\n' + t('（模型拒绝了这个请求）', '(The model declined this request.)'));
      });
    });
  }
  function callOpenAI(c, sys, msgs, onDelta, signal) {
    var inThink = false;   // older servers inline <think>…</think> in content
    return fetch(c.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: signal, headers: openaiHeaders(c),
      body: JSON.stringify(assign({ model: c.model, stream: true, messages: [{ role: 'system', content: sys }].concat(msgs) }, effortParams(c)))
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
  // One tiny non-streaming request, used by the first-run wizard and the
  // settings "test" button to validate key + model before saving.
  function testConnection(c) {
    var p = PROVIDERS[c.provider] || PROVIDERS.custom, base = c.base.replace(/\/+$/, '');
    var req = p.kind === 'anthropic'
      ? fetch(base + '/v1/messages', { method: 'POST', headers: anthropicHeaders(c), body: JSON.stringify({ model: c.model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }) })
      : fetch(base + '/chat/completions', { method: 'POST', headers: openaiHeaders(c), body: JSON.stringify({ model: c.model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }) });
    return req.then(function (res) { if (!res.ok) return httpError(res); return res.json(); }).then(function (j) { if (j && j.error) throw new Error(j.error.message || JSON.stringify(j.error)); });
  }

  /* ── markdown-ish rendering ──
   * Replies are asked to write readings as 漢字（かな）; those become <ruby>
   * so answers look like the lesson text (and obey the furigana toggle). */
  var PRE = String.fromCharCode(0) + 'PRE', PRE_END = String.fromCharCode(0);
  var PRE_RE = new RegExp('^' + PRE + '(.*)' + PRE_END + '$');
  function ruby(s) {
    return s.replace(/([一-鿿㐀-䶿々〆ヶ]+)[（(]([ぁ-ゖァ-ヺー]+)[）)]/g, '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>');
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
  var WIDTH_KEY = 'jp_ai_w';
  function clampWidth(w) { return Math.max(340, Math.min(Math.round(window.innerWidth * 0.6), 760, Math.round(w))); }
  function applyWidth(w) { document.documentElement.style.setProperty('--ai-w', clampWidth(w) + 'px'); }
  function resetWidth() { document.documentElement.style.removeProperty('--ai-w'); try { localStorage.removeItem(WIDTH_KEY); } catch (e) {} }
  (function () { try { var w = +localStorage.getItem(WIDTH_KEY); if (w) applyWidth(w); } catch (e) {} })();
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
        '<span class="ai-title">🤖 <span class="lang-zh">问 AI</span><span class="lang-en">Ask AI</span> ' +
          '<button type="button" class="ai-model" title="' + esc(t('切换模型', 'Switch model')) + '"></button></span>' +
        '<div class="ai-model-menu" hidden></div>' +
        '<span class="ai-head-btns">' +
          '<button type="button" class="ai-new" title="' + esc(t('新对话（清空本课记录）', 'New chat (clears this lesson’s history)')) + '">＋</button>' +
          '<button type="button" class="ai-gear" title="' + esc(t('设置', 'Settings')) + '">⚙</button>' +
          '<button type="button" class="ai-close" title="' + esc(t('关闭', 'Close')) + '">✕</button>' +
        '</span>' +
      '</div>' +
      '<div class="ai-msgs" aria-live="polite"></div>' +
      '<form class="ai-settings" hidden></form>' +
      '<form class="ai-input">' +
        '<label class="ai-ctx" title="' + esc(t('随问题一起发给模型的笔记范围。选中某一节的例句提问时会自动缩小到那一节。', 'Which part of the notes is sent with your question. Selecting text inside a grammar point narrows it to that point automatically.')) + '">' +
          '<span class="ai-ctx-label">📎 ' + esc(t('AI 看到', 'AI sees')) + '</span><select class="ai-scope"></select>' +
          '<button type="button" class="ai-clear" hidden title="' + esc(t('清空本课的对话记录，模型不再看到之前的问答', 'Clear this lesson\u2019s chat; the model will no longer see earlier turns')) + '">🗑 ' + esc(t('清空对话', 'Clear chat')) + '</button></label>' +
        '<textarea rows="3"></textarea>' +
        '<div class="ai-input-row"><span class="ai-input-hint">' + esc(t('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter for a new line')) + '</span>' +
        '<button type="submit">' + esc(t('发送 ↑', 'Send ↑')) + '</button></div>' +
      '</form>';
    document.body.appendChild(panel);
    msgsEl = panel.querySelector('.ai-msgs');
    settingsEl = panel.querySelector('.ai-settings');
    inputEl = panel.querySelector('textarea');
    sendBtn = panel.querySelector('.ai-input button');
    modelLabel = panel.querySelector('.ai-model');
    scopeSel = panel.querySelector('.ai-scope');

    panel.querySelector('.ai-close').addEventListener('click', close);
    initResize(panel.querySelector('.ai-resize'));
    var menu = panel.querySelector('.ai-model-menu');
    modelLabel.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!cfg) { showSettings(true); return; }
      if (!menu.hidden) { menu.hidden = true; return; }
      renderMenu();
      configuredProviders().forEach(function (k) {
        if (PROVIDERS[k].group === 'local') refreshLocalModels(k).then(function (changed) { if (changed && !menu.hidden) renderMenu(); });
      });
    });
    function renderMenu() {
      var html = '';
      configuredProviders().forEach(function (k) {
        var prof = cfg.profiles[k], on = k === cfg.active, p = PROVIDERS[k];
        html += '<div class="ai-menu-head">' + esc(p.name) + (p.group === 'local' ? ' · ' + esc(loadModelCache()[k] ? t('本机已安装', 'installed here') : t('未能读取已安装列表', 'could not read installed list')) : '') + '</div>' +
          modelsFor(k, prof.model).slice(0, on ? 40 : 6).map(function (m) {
            return '<button type="button" class="ai-menu-item' + (on && m === prof.model ? ' sel' : '') + '" data-p="' + k + '" data-m="' + esc(m) + '">' + esc(m) + '</button>';
          }).join('');
      });
      menu.innerHTML = html +
        '<div class="ai-menu-sep"></div>' +
        '<div class="ai-menu-head">' + esc(t('思考深度', 'Thinking depth')) + '</div>' +
        '<div class="ai-effort-row">' + EFFORTS.map(function (x) { return '<button type="button" class="ai-effort' + ((cfg.effort || '') === x[0] ? ' sel' : '') + '" data-e="' + x[0] + '">' + esc(isEn() ? x[2] : x[1]) + '</button>'; }).join('') + '</div>' +
        '<div class="ai-menu-sep"></div>' +
        '<button type="button" class="ai-menu-item ai-menu-settings">⚙ ' + esc(t('添加服务商 / 更多模型…', 'Add a provider / more models…')) + '</button>';
      menu.hidden = false;
    }
    menu.addEventListener('click', function (e) {
      var eb = e.target.closest && e.target.closest('.ai-effort');
      if (eb) { e.stopPropagation(); cfg.effort = eb.getAttribute('data-e'); saveCfg(cfg); track('ai_effort', { effort: cfg.effort || 'standard', via: 'menu' }); renderAll(); menu.hidden = true; return; }
      var b = e.target.closest && e.target.closest('.ai-menu-item');
      if (!b) return;
      menu.hidden = true;
      if (b.classList.contains('ai-menu-settings')) { showSettings(true); return; }
      var p = b.getAttribute('data-p'), m = b.getAttribute('data-m');
      if (p && m && (p !== cfg.active || m !== active().model)) {
        cfg.active = p; cfg.profiles[p].model = m; saveCfg(cfg);
        track('ai_setup', { first: false, session_only: !!cfg.session, custom_host: false, via: 'menu' });
        renderAll();
      }
    });
    document.addEventListener('click', function () { if (menu && !menu.hidden) menu.hidden = true; });
    panel.querySelector('.ai-gear').addEventListener('click', function () { showSettings(settingsEl.hidden); });
    function clearChat() { if (busy) stop(); history = []; saveHist(history); track('ai_clear', {}); renderAll(); }
    panel.querySelector('.ai-new').addEventListener('click', clearChat);
    panel.querySelector('.ai-clear').addEventListener('click', clearChat);
    panel.querySelector('.ai-input').addEventListener('submit', function (e) { e.preventDefault(); if (busy) stop(); else send(inputEl.value); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(inputEl.value); }
    });
    inputEl.addEventListener('input', function () { autosize(); if (!inputEl.value.trim()) pendingSource = 'typed'; });
    scopeSel.addEventListener('change', function () { scope = +scopeSel.value; track('ai_scope', { scope: scope < 0 ? 'lesson' : 'section', via: 'select' }); renderScope(); });
    msgsEl.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('ai-quick')) { pendingSource = 'quick'; send(b.getAttribute('data-q')); return; }
      if (b.classList.contains('ai-copy')) { copyText(b.closest('.ai-msg').getAttribute('data-raw') || '', b); return; }
      if (b.classList.contains('ai-regen')) { regenerate(); return; }
      if (b.classList.contains('ai-retry')) { regenerate(); return; }
    });
    renderScope();
    renderAll();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel && document.body.classList.contains('ai-open') && !settingsEl.contains(document.activeElement)) close(); });

  function renderScope() {
    if (!scopeSel) return;
    var secs = sections();
    scopeSel.innerHTML = '<option value="-1">' + esc(t('整课 · 约 ', 'whole lesson · ~') + kChars(contextChars(-1)) + t(' 字', ' chars')) + '</option>' +
      secs.map(function (s, i) { return '<option value="' + i + '">' + esc(t('仅 ', 'only ') + sectionTitle(i) + ' · ~' + kChars(contextChars(i))) + '</option>'; }).join('');
    if (scope >= secs.length) scope = -1;
    scopeSel.value = String(scope);
    scopeSel.classList.toggle('ai-scope-narrow', scope >= 0);
    inputEl.placeholder = scope >= 0 ? t('问关于「' + sectionTitle(scope) + '」的问题…', 'Ask about "' + sectionTitle(scope) + '"…') : t('问关于这一课的任何问题…', 'Ask anything about this lesson…');
  }

  // Every label is produced by t() at render time, so when the reader flips
  // 中/EN we rebuild the panel in the new language, keeping the open state,
  // the draft in the input box and any unsaved settings edits.
  function formDraft() {
    if (!settingsEl || settingsEl.hidden || !settingsEl.querySelector('[name=provider]')) return null;
    var f = settingsEl;
    return { provider: f.querySelector('[name=provider]').value, base: f.querySelector('[name=base]').value, key: f.querySelector('[name=key]').value,
             model: f.querySelector('[name=model]').value, session: f.querySelector('[name=session]').checked,
             effort: (f.querySelector('[name=effort]:checked') || {}).value || '' };
  }
  function relocalize() {
    if (!panel) return;
    var draft = formDraft(), typed = inputEl.value, wasOpen = document.body.classList.contains('ai-open');
    panel.remove(); panel = null; sectionCache = null; wholeCache = null;
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
    modelLabel.textContent = cfg ? (PROVIDERS[cfg.active] || { name: cfg.active }).name.split(' ')[0] + ' · ' + active().model + (cfg.effort ? ' · ' + effortLabel(cfg.effort) : '') + ' ▾' : t('未设置 ▾', 'not set ▾');
    msgsEl.innerHTML = '';
    panel.querySelector('.ai-input').hidden = !cfg;
    panel.querySelector('.ai-clear').hidden = !history.length;
    if (!cfg) { renderWizard(); return; }
    if (!history.length) {
      var quick = isEn()
        ? ['Explain the hardest grammar point in this lesson simply', 'Give me 5 fresh example sentences using this lesson’s grammar', 'Quiz me with 5 multiple-choice questions', 'How do the grammar points in this lesson differ from each other?']
        : ['用最简单的话解释这一课最难的语法点', '用这一课的语法再造 5 个新例句', '出 5 道选择题考考我', '这一课的几个语法点之间有什么区别？'];
      msgsEl.innerHTML = '<div class="ai-note">' + esc(t('AI 已读过这一课的内容，可以直接提问；也可以在正文里选中一段文字后点「问 AI」。', 'The AI has read this lesson. Ask away, or select any text in the lesson and click "Ask AI".')) + '</div>' +
        '<div class="ai-quicks">' + quick.map(function (q) { return '<button type="button" class="ai-quick" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
      return;
    }
    history.forEach(function (m, i) { appendMsg(m.role, m.content, i === history.length - 1); });
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
      (last ? '<button type="button" class="ai-regen" title="' + esc(t('用当前模型重新回答', 'Answer again with the current model')) + '">↻ ' + esc(t('重新生成', 'Regenerate')) + '</button>' : '');
    return d;
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
    var hint = '', p = cfg && PROVIDERS[cfg.active];
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      hint = p && p.group === 'local'
        ? t('（连不上本地服务：确认它在运行、Chrome 已允许访问本地网络，且是用 OLLAMA_ORIGINS=' + location.origin + ' 启动的。）', '(Cannot reach the local server: make sure it is running, Chrome allowed local-network access, and it was started with OLLAMA_ORIGINS=' + location.origin + '.)')
        : t('（网络错误：通常是服务商不允许浏览器直连 (CORS)、base URL 写错，或网络不通。可改用 OpenRouter / 硅基流动等中转。）', '(Network error: usually the provider blocks browser calls (CORS), the base URL is wrong, or you are offline. A relay like OpenRouter works around CORS.)');
    } else if (/401|403|authentication|invalid.*key/i.test(msg)) {
      hint = t('（请检查 API key。）', '(Check your API key.)');
    } else if (/HTTP 402|insufficient|balance|quota|billing/i.test(msg)) {
      hint = t('（账户余额或额度不足。）', '(Out of credit or quota on this account.)');
    } else if (/^HTTP 404/.test(msg) && p && p.group === 'local') {
      hint = t('（本机没有这个模型：先 ollama pull ' + active().model + '，或在设置里点 ⟳ 选一个已安装的模型。）', '(This model is not installed locally: run ollama pull ' + active().model + ', or click ⟳ in settings to pick an installed one.)');
    } else if (/^HTTP 404|model.*not (found|exist)|does not exist/i.test(msg)) {
      hint = t('（模型名可能不对，在设置里点 ⟳ 获取可用列表。）', '(The model name may be wrong; click ⟳ in settings for the live list.)');
    }
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
    send(last.content);
  }

  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    if (!cfg) { pendingSource = 'typed'; renderAll(); return; }
    var source = pendingSource, t0 = Date.now();
    pendingSource = 'typed';
    if (!history.length) msgsEl.innerHTML = '';
    msgsEl.querySelectorAll('.ai-error, .ai-actions').forEach(function (n) { n.remove(); });
    inputEl.value = ''; autosize();
    history.push({ role: 'user', content: text });
    appendMsg('user', text);
    var reply = '', think = '', el = appendMsg('assistant', ''), raf = 0, gotBytes = false;
    var prov = PROVIDERS[cfg.active] || PROVIDERS.custom, c = callCfg();
    el.classList.add('ai-streaming');
    el.innerHTML = '<p class="ai-status">' + t('连接中…', 'Connecting…') + '</p>';
    // A local server that never answers usually means Chrome's "allow local network access"
    // prompt is waiting in the address bar, or Ollama was started without OLLAMA_ORIGINS.
    var slowTimer = setTimeout(function () {
      if (gotBytes) return;
      el.innerHTML = '<p class="ai-status">' + t('连接中…', 'Connecting…') + '</p><p class="ai-status">' + (prov.group === 'local'
        ? t('本地模型读完这一课通常要 10–30 秒。如果一直没反应：看看 Chrome 地址栏有没有「允许访问本地网络」的提示并点允许；并确认服务是用 OLLAMA_ORIGINS=' + location.origin + ' 启动的。',
            'A local model usually needs 10–30 s to read the lesson. If nothing ever arrives: check the address bar for Chrome\'s "allow local network access" prompt and allow it, and make sure the server was started with OLLAMA_ORIGINS=' + location.origin + '.')
        : t('服务商还没有回应，再等一会儿，或点「停止」后重试。', 'The provider has not answered yet; wait a bit or press Stop and retry.')) + '</p>';
    }, 10000);
    scrollBottom();
    busy = true; sendBtn.textContent = t('停止 ■', 'Stop ■'); sendBtn.classList.add('ai-stop');
    abort = new AbortController();
    function render() {
      var html = '';
      if (think) html += '<details class="ai-think"' + (reply ? '' : ' open') + '><summary>' + (reply ? t('已思考', 'Thought') : t('思考中…', 'Thinking…')) + ' (' + think.length + ')</summary><p>' + esc(think).replace(/\n+/g, '<br>') + '</p></details>';
      el.innerHTML = html + md(reply);
    }
    function onDelta(chunk, isThinking) {
      gotBytes = true;
      if (isThinking) think += chunk; else reply += chunk;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); scrollBottom(); });
    }
    var msgs = history.slice(-SEND_TURNS * 2).map(function (m) { return { role: m.role, content: m.content }; });
    var sys = systemPrompt();
    var call = prov.kind === 'anthropic' ? callAnthropic : callOpenAI;
    track('ai_ask', { source: source, turn: Math.ceil(history.length / 2), lesson_chars: sys.length, scope: scope < 0 ? 'lesson' : 'section' });
    call(c, sys, msgs, onDelta, abort.signal).then(function () {
      track('ai_answer', { source: source, ms: Date.now() - t0, chars: reply.length });
    }, function (e) {
      if (e && e.name === 'AbortError') { track('ai_stop', { ms: Date.now() - t0, chars: reply.length }); return; }
      var msg = e && e.message ? e.message : String(e);
      showError(msg);
      track('ai_error', { kind: errorKind(msg), status: (msg.match(/^HTTP (\d+)/) || [])[1] || '' });
    }).then(function () {
      clearTimeout(slowTimer);
      cancelAnimationFrame(raf); raf = 0;
      render();
      el.classList.remove('ai-streaming');
      if (reply) { history.push({ role: 'assistant', content: reply }); el.setAttribute('data-raw', reply); el.appendChild(actionsFor(true)); }
      else el.remove();
      saveHist(history);
      panel.querySelector('.ai-clear').hidden = !history.length;
      busy = false; abort = null; sendBtn.textContent = t('发送 ↑', 'Send ↑'); sendBtn.classList.remove('ai-stop');
      scrollBottom();
    });
  }
  function stop() { if (abort) abort.abort(); }

  /* ── first-run wizard ──
   * Three recommended providers for the reader's language, each with a link
   * to the key page and a paste box; "connect" runs one tiny request so a bad
   * key or model name is caught before anything is saved. */
  function renderWizard(pick) {
    var recs = RECOMMEND[isEn() ? 'en' : 'zh'];
    if (!pick) {
      msgsEl.innerHTML =
        '<div class="ai-wiz">' +
          '<p class="ai-wiz-lead">' + esc(t('要用 AI 问答，需要一个模型服务商的 API key（一般几分钟就能创建）。密钥只存在你的浏览器里，本站没有服务器。', 'Asking the AI needs an API key from a model provider (usually takes a couple of minutes to create). The key stays in your browser; this site has no server.')) + '</p>' +
          '<p class="ai-wiz-step">' + esc(t('1 · 选一家开始', '1 · Pick a provider')) + '</p>' +
          '<div class="ai-wiz-cards">' + recs.map(function (k) {
            var p = PROVIDERS[k];
            return '<button type="button" class="ai-wiz-card" data-p="' + k + '"><b>' + esc(p.name) + '</b><span>' + esc(isEn() ? p.freeEn : p.freeZh) + '</span></button>';
          }).join('') + '</div>' +
          '<button type="button" class="ai-wiz-more">' + esc(t('其他服务商 / 本地 Ollama / OpenAI / Claude…', 'Other providers / local Ollama / OpenAI / Claude…')) + '</button>' +
          '<p class="ai-wiz-priv"><a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">' + esc(t('隐私说明', 'Privacy')) + '</a> · <a href="' + SOURCE_URL + '" target="_blank" rel="noopener">' + esc(t('源码', 'Source')) + '</a></p>' +
        '</div>';
      msgsEl.querySelector('.ai-wiz-cards').addEventListener('click', function (e) {
        var b = e.target.closest('.ai-wiz-card'); if (!b) return;
        track('ai_wizard', { step: 'pick', provider: b.getAttribute('data-p') });
        renderWizard(b.getAttribute('data-p'));
      });
      msgsEl.querySelector('.ai-wiz-more').addEventListener('click', function () { track('ai_wizard', { step: 'more' }); showSettings(true); });
      return;
    }
    var p = PROVIDERS[pick];
    msgsEl.innerHTML =
      '<div class="ai-wiz">' +
        '<p class="ai-wiz-step">' + esc(t('2 · 创建 key', '2 · Create a key')) + '</p>' +
        '<p>' + esc(t('打开 ', 'Open ')) + '<a href="' + esc(p.keyUrl) + '" target="_blank" rel="noopener">' + esc(p.name) + ' ↗</a>' +
          esc(t('，登录后新建一个 API key 并复制。', ', sign in, create an API key and copy it.')) + '</p>' +
        '<p class="ai-wiz-step">' + esc(t('3 · 粘贴到这里', '3 · Paste it here')) + '</p>' +
        '<form class="ai-wiz-form">' +
          '<input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" required>' +
          '<label class="ai-check"><input type="checkbox" name="session"> ' + esc(t('公用电脑：只保存到本次会话', 'Shared computer: keep for this tab only')) + '</label>' +
          '<p class="ai-hint ai-wiz-msg"></p>' +
          '<div class="ai-settings-btns"><button type="submit" class="ai-save">' + esc(t('连接并开始', 'Connect and start')) + '</button>' +
          '<button type="button" class="ai-wiz-back">' + esc(t('换一家', 'Pick another')) + '</button></div>' +
        '</form>' +
      '</div>';
    var form = msgsEl.querySelector('.ai-wiz-form'), msg = form.querySelector('.ai-wiz-msg'), keyIn = form.querySelector('[name=key]');
    setTimeout(function () { keyIn.focus(); }, 0);
    form.querySelector('.ai-wiz-back').addEventListener('click', function () { renderWizard(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var key = keyIn.value.trim(); if (!key) return;
      var c = { provider: pick, base: p.base, key: key, model: p.model, effort: '' };
      form.querySelector('.ai-save').disabled = true; msg.classList.remove('ai-hint-err'); msg.textContent = t('正在测试连接…', 'Testing the connection…');
      testConnection(c).then(function () {
        cfg = { v: 2, active: pick, profiles: {}, effort: '', session: form.querySelector('[name=session]').checked };
        cfg.profiles[pick] = { base: p.base, key: key, model: p.model };
        saveCfg(cfg);
        track('ai_setup', { first: true, session_only: cfg.session, custom_host: false, via: 'wizard' });
        renderAll();
        setTimeout(function () { inputEl.focus(); }, 0);
      }, function (err) {
        form.querySelector('.ai-save').disabled = false;
        var m = err && err.message ? err.message : String(err);
        msg.classList.add('ai-hint-err');
        msg.textContent = t('连接失败：', 'Connection failed: ') + m + (/401|403|invalid.*key|authentication/i.test(m) ? t('（key 不对或没复制完整）', ' (the key is wrong or incomplete)') : '');
        track('ai_wizard', { step: 'fail', provider: pick, kind: errorKind(m) });
      });
    });
  }

  /* ── settings (full form, one profile per provider) ── */
  function showSettings(on, draft) {
    settingsEl.hidden = !on;
    msgsEl.hidden = on;
    panel.querySelector('.ai-input').hidden = on || !cfg;
    if (on) renderSettings(draft); else if (!cfg) renderAll();
  }
  function profileFor(k) {
    var p = PROVIDERS[k], saved = cfg && cfg.profiles[k];
    return saved ? { provider: k, base: saved.base, key: saved.key || '', model: saved.model } : { provider: k, base: p.base, key: '', model: p.model };
  }
  function renderSettings(draft) {
    var cur = draft || (cfg ? assign(profileFor(cfg.active), { session: cfg.session, effort: cfg.effort || '' }) : assign(profileFor(RECOMMEND[isEn() ? 'en' : 'zh'][0]), { session: false, effort: '' }));
    var configured = configuredProviders();
    settingsEl.innerHTML =
      '<label>' + esc(t('服务商', 'Provider')) + '<select name="provider">' +
        GROUPS.map(function (g) {
          return '<optgroup label="' + esc(g[1]) + '">' + Object.keys(PROVIDERS).filter(function (k) { return PROVIDERS[k].group === g[0]; }).map(function (k) {
            return '<option value="' + k + '"' + (k === cur.provider ? ' selected' : '') + '>' + (configured.indexOf(k) >= 0 ? '✓ ' : '') + esc(PROVIDERS[k].name) + '</option>';
          }).join('') + '</optgroup>';
        }).join('') +
      '</select></label>' +
      '<label>Base URL<input name="base" type="url" autocomplete="off" spellcheck="false" value="' + esc(cur.base) + '"></label>' +
      '<label>API Key<span class="ai-model-row"><input name="key" type="password" autocomplete="off" spellcheck="false" value="' + esc(cur.key || '') + '">' +
        '<a class="ai-keylink" target="_blank" rel="noopener" title="' + esc(t('去服务商网站创建 key', 'Create a key on the provider’s site')) + '">↗</a></span></label>' +
      '<label>' + esc(t('模型', 'Model')) + '<span class="ai-model-row"><input name="model" autocomplete="off" spellcheck="false" placeholder="' + esc(t('可手动输入任意模型名', 'Type any model name')) + '" value="' + esc(cur.model) + '">' +
        '<button type="button" class="ai-model-dd" title="' + esc(t('选择模型', 'Choose a model')) + '">▾</button>' +
        '<button type="button" class="ai-fetch" title="' + esc(t('从服务商获取全部可用模型', 'Fetch every available model from the provider')) + '">⟳</button>' +
        '<div class="ai-model-menu ai-settings-menu" hidden></div></span></label>' +
      '<p class="ai-hint"></p>' +
      '<p class="ai-hint ai-hostwarn" hidden></p>' +
      '<label>' + esc(t('思考深度', 'Thinking depth')) + '<span class="ai-effort-row ai-effort-settings">' +
        EFFORTS.map(function (x) { return '<label class="ai-effort-opt"><input type="radio" name="effort" value="' + x[0] + '"' + ((cur.effort || '') === x[0] ? ' checked' : '') + '> ' + esc(isEn() ? x[2] : x[1]) + '</label>'; }).join('') +
      '</span><span class="ai-hint">' + esc(t('快速 = 短答、少思考、更便宜；深入 = 允许模型多想、多举例。有推理开关的模型（GPT-5、Claude、Gemini、GLM、Qwen3 等）会同时调节推理强度。', 'Quick = short answers, little reasoning, cheaper; Deep = let the model think longer and give more examples. On models with a reasoning knob (GPT-5, Claude, Gemini, GLM, Qwen3…) it also sets reasoning effort.')) + '</span></label>' +
      '<label class="ai-check"><input type="checkbox" name="session"' + (cur.session ? ' checked' : '') + '> ' +
        esc(t('只在本次会话保存密钥（关闭标签页后自动清除，公用电脑请勾选）', 'Keep keys for this tab only (cleared when the tab closes; use on shared computers)')) + '</label>' +
      '<div class="ai-privacy"><b>🔒 ' + esc(t('隐私与安全', 'Privacy & security')) + '</b><ul>' +
        '<li>' + esc(t('本站是纯静态页面，没有服务器。密钥只存在你这台设备的浏览器里，不会上传。', 'This site is static HTML with no server. Your keys live only in this browser on this device and are never uploaded.')) + '</li>' +
        '<li>' + esc(t('提问时，浏览器把笔记内容和你的问题直接发给你选的服务商。页面设有安全策略 (CSP) 白名单，浏览器会拦截发往任何其他域名的请求。', 'When you ask, your browser sends the notes and your question straight to the provider you chose. A Content-Security-Policy allowlist makes the browser block requests to any other domain.')) + '</li>' +
        '<li>' + esc(t('自行验证：按 F12 打开 Network 面板再提问，只会看到对服务商域名的请求。', 'Verify it yourself: open DevTools (F12) → Network and ask a question; only requests to the provider’s domain appear.')) + '</li>' +
        '<li><a href="' + SOURCE_URL + '" target="_blank" rel="noopener">' + esc(t('查看源码', 'Read the source')) + '</a> · <a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">' + esc(t('详细说明', 'Full explanation')) + '</a></li>' +
      '</ul></div>' +
      '<div class="ai-settings-btns">' +
        '<button type="submit" class="ai-save">' + esc(t('测试并保存', 'Test and save')) + '</button>' +
        '<button type="button" class="ai-cancel">' + esc(t('取消', 'Cancel')) + '</button>' +
        '<button type="button" class="ai-remove" hidden>' + esc(t('删除这家', 'Remove this one')) + '</button>' +
        (cfg ? '<button type="button" class="ai-forget">' + esc(t('清除全部密钥', 'Forget all keys')) + '</button>' : '') +
      '</div>';
    var sel = settingsEl.querySelector('[name=provider]'), base = settingsEl.querySelector('[name=base]'),
        key = settingsEl.querySelector('[name=key]'), model = settingsEl.querySelector('[name=model]'),
        hint = settingsEl.querySelector('.ai-hint'), dd = settingsEl.querySelector('.ai-model-dd'), ddMenu = settingsEl.querySelector('.ai-settings-menu'),
        keyLink = settingsEl.querySelector('.ai-keylink'), removeBtn = settingsEl.querySelector('.ai-remove');
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
      if (reset) { var pf = profileFor(sel.value); base.value = pf.base; model.value = pf.model; key.value = pf.key; }
      key.placeholder = p.needsKey ? '' : t('（可留空）', '(optional)');
      keyLink.hidden = !p.keyUrl; if (p.keyUrl) keyLink.href = p.keyUrl;
      removeBtn.hidden = !(cfg && cfg.profiles[sel.value]);
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
      } else if (v && preset && h && h !== preset && h !== hostOf(p.altBase || '') && !isLocalUrl(v)) {
        msg = t('⚠ 你的 API key 将发送到 ' + h + '，而不是 ' + p.name + ' 的官方地址 ' + preset + '。请确认你信任这个地址。', '⚠ Your API key will be sent to ' + h + ', not to ' + p.name + '’s official host ' + preset + '. Make sure you trust it.');
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
      var p = PROVIDERS[sel.value], saveBtn = settingsEl.querySelector('.ai-save');
      var next = { provider: sel.value, base: base.value.trim(), key: key.value.trim(), model: model.value.trim() };
      var session = settingsEl.querySelector('[name=session]').checked, effort = (settingsEl.querySelector('[name=effort]:checked') || {}).value || '';
      if (!next.base || !next.model || (p.needsKey && !next.key)) { hint.textContent = t('请填写完整。', 'Please fill in every field.'); hint.classList.add('ai-hint-err'); return; }
      if (!checkHost()) return;
      saveBtn.disabled = true; hint.classList.remove('ai-hint-err'); hint.textContent = t('正在测试连接…', 'Testing the connection…');
      testConnection(next).then(function () {
        var first = !cfg, changed = !cfg || cfg.active !== next.provider || active().model !== next.model;
        setProfile(next.provider, { base: next.base, key: next.key, model: next.model }, true);
        cfg.session = session; cfg.effort = effort; saveCfg(cfg);
        if (changed) track('ai_setup', { first: first, session_only: session, custom_host: hostOf(next.base) !== hostOf(p.base), via: 'settings' });
        showSettings(false); renderAll();
        setTimeout(function () { inputEl.focus(); }, 0);
      }, function (err) {
        saveBtn.disabled = false;
        var m = err && err.message ? err.message : String(err);
        hint.classList.add('ai-hint-err');
        hint.textContent = t('连接失败：', 'Connection failed: ') + m + (/Failed to fetch|NetworkError|Load failed/i.test(m) ? t('（服务商不允许浏览器直连，或本地服务未启动 / 未设置 OLLAMA_ORIGINS）', ' (the provider blocks browser calls, or the local server is not running / lacks OLLAMA_ORIGINS)') : '');
      });
    };
    settingsEl.querySelector('.ai-cancel').addEventListener('click', function () { showSettings(false); });
    removeBtn.addEventListener('click', function () {
      if (!cfg || !cfg.profiles[sel.value]) return;
      delete cfg.profiles[sel.value];
      var left = configuredProviders();
      if (!left.length) { forgetCfg(); cfg = null; showSettings(false); return; }
      if (cfg.active === sel.value) cfg.active = left[0];
      saveCfg(cfg); track('ai_forget', { one: true });
      showSettings(false); renderAll();
    });
    var forget = settingsEl.querySelector('.ai-forget');
    if (forget) forget.addEventListener('click', function () {
      track('ai_forget', {});
      forgetCfg(); cfg = null;
      showSettings(false);
    });
  }

  /* ── open / close ── */
  // Sidebar (230) + lesson column (1000) + panel do not fit below ~1700px, so
  // opening the panel folds the sidebar (it still expands on hover) and closing
  // restores it — only if we were the ones who folded it.
  var foldedSidebar = false;
  function foldSidebar() {
    var sb = document.getElementById('sidebar');
    if (!sb || window.innerWidth <= 768 || sb.classList.contains('collapsed')) return;
    var aiW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ai-w')) || 440;
    if (window.innerWidth - aiW - 230 >= 1000 + 96) return;
    sb.classList.add('collapsed'); document.body.classList.add('sidebar-collapsed'); foldedSidebar = true;
  }
  function unfoldSidebar() {
    if (!foldedSidebar) return;
    foldedSidebar = false;
    var sb = document.getElementById('sidebar');
    if (sb) { sb.classList.remove('collapsed'); document.body.classList.remove('sidebar-collapsed'); }
  }
  function open(prefill) {
    if (!panel) build();
    foldSidebar();
    document.body.classList.add('ai-open');
    panel.removeAttribute('aria-hidden');
    if (prefill) { inputEl.value = prefill; autosize(); }
    if (cfg) setTimeout(function () { inputEl.focus(); inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length; }, 260);
    track('ai_open', { configured: !!cfg });
  }
  function close() {
    document.body.classList.remove('ai-open');
    unfoldSidebar();
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

  /* ── selection chip: select text in the lesson → 「问 AI」 ──
   * The quoted text is taken from the DOM range, not Selection.toString(), so
   * furigana (rt) and the 🔊 button never leak in. If the selection runs past
   * the end of an example sentence into its translation, only the Japanese
   * sentence is quoted. The grammar point containing the selection becomes
   * the context scope. */
  var chip = null;
  function plain(node) {
    var c = node.cloneNode(true), box = document.createElement('div');
    if (c.querySelectorAll) box.appendChild(c); else box.textContent = c.textContent;
    box.querySelectorAll('rt, rp, .speak-btn').forEach(function (n) { n.remove(); });
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
        track('ai_select', { chars: q.length, scoped: sec >= 0 });
        open(t('「' + q + '」\n这里怎么理解？', '"' + q + '"\nCan you explain this?'));
      });
      document.body.appendChild(chip);
    }
    chip.textContent = '✨ ' + t('问 AI', 'Ask AI');
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

  if (document.readyState !== 'loading') addBtn();
  else document.addEventListener('DOMContentLoaded', addBtn);
})();
