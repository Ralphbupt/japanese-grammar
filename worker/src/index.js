/* jpnotes free AI relay — ai.jpnotes.dev
 *
 * Lets readers use the 问 AI panel without their own API key. The model runs
 * on Cloudflare Workers AI: no third-party key, and the Free plan's daily
 * neuron allocation is the budget (running out errors, it never bills). The
 * browser talks to this Worker with the same OpenAI-compatible shape it uses
 * for every other provider:
 *
 *   POST /v1/chat/completions   → Workers AI, model fixed
 *   GET  /v1/models             → the one model on offer
 *   POST /feedback              → a reader's note from the practice pages, into D1
 *
 * Guard rails, because the quota is shared by everyone:
 *   - only browsers on jpnotes.dev (or localhost while developing) — CORS + Origin check
 *   - one fixed model, so the worst an abuser can do is use up the quota
 *   - request size and reply length capped
 *   - per-IP limits: a burst limit per minute and a daily cap, plus a daily
 *     neuron budget for the whole site, counted in a Durable Object from the
 *     usage the model reports (IPs are stored hashed, per day)
 *
 * Saving quota:
 *   - reasoning effort forced to low (reasoning tokens are billed as output)
 *   - first questions (system prompt + one user message) are answered from
 *     the edge cache when someone already asked the same thing about the same
 *     text: the quick-prompt buttons and the 「…」这里怎么理解？ selection chip
 *     produce identical requests across readers. Cache hits cost nothing and
 *     do not count against anyone's limit.
 *
 * Feedback (POST /feedback) is the one thing stored: what the reader wrote,
 * the page and question it was about, and a daily-salted hash of the IP so
 * one reader can send at most FEEDBACK_PER_DAY a day.
 *
 * Otherwise nothing is logged: no questions, answers or IPs. The only record is a
 * usage counter in Analytics Engine (dataset jpnotes_ai_usage), one row per
 * request: which button sent it (the panel's `source`), first question or
 * follow-up, reader or the site owner (blob4), what happened (cache / model / fallback-groq|cerebras / limited-ip-day|ip-minute|budget / error) and the neurons
 * spent.
 */

const MODEL = '@cf/openai/gpt-oss-120b';
const MODEL_NAME = 'gpt-oss-120b';
const MAX_BODY = 120000;                              // bytes; a whole lesson as context is ~30k chars
const MAX_TOKENS = 2048;
const PER_MINUTE = 6;
const PER_DAY = 50;
const DAILY_NEURONS = 9500;                           // Free plan allows 10,000/day; keep a margin so readers get our message, not an upstream error
const CACHE_TTL = 3 * 86400;
const FEEDBACK_PER_DAY = 20;
const FEEDBACK_MAX = 1000;                            // characters of text
const MAX_MESSAGES = 40;                              // the panel sends the system prompt + the last 6 turns

// Backup providers, tried in order when Workers AI can't answer (the day's
// neuron budget is gone, or it errors). Each is used only if its key is set as
// a Worker secret (npx wrangler secret put GROQ_KEY / CEREBRAS_KEY). The model
// defaults to the one Workers AI runs, so answers keep their character; set
// GROQ_MODEL / CEREBRAS_MODEL (wrangler.toml [vars]) to use another. Free
// tiers rate-limit (429) rather than bill; a site-wide daily cap bounds a paid plan.
const FALLBACKS = [
  { name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', key: 'GROQ_KEY', modelVar: 'GROQ_MODEL' },
  { name: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', model: 'gpt-oss-120b', key: 'CEREBRAS_KEY', modelVar: 'CEREBRAS_MODEL' },
];
const FALLBACK_PER_DAY = 1500;                        // requests a day across all backups

const ORIGIN_RE = /^(https:\/\/jpnotes\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const QUOTA_GONE = '今天本站的免费额度已用完，明天再来；或在设置里填自己的 API key。 / The site’s free quota for today is used up; come back tomorrow, or add your own API key in settings.';

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    if (!ORIGIN_RE.test(origin)) return json({ error: { message: 'Forbidden' } }, 403);
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    if (req.method === 'GET' && path === '/v1/models') return json({ data: [{ id: MODEL_NAME }] }, 200, cors);
    if (req.method === 'POST' && path === '/feedback') return feedback(req, env, cors);
    if (req.method !== 'POST' || path !== '/v1/chat/completions') return json({ error: { message: 'Not found' } }, 404, cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: { message: '请求太长：把 📎 范围缩小到某一节再试。 / Request too large: narrow the 📎 scope to one grammar point.' } }, 413, cors);
    let body;
    try { body = JSON.parse(raw); } catch (e) { return json({ error: { message: 'Bad JSON' } }, 400, cors); }
    if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: { message: 'messages required' } }, 400, cors);
    if (body.messages.length > MAX_MESSAGES) return json({ error: { message: 'Too many messages' } }, 400, cors);

    // Only the fields the panel sends; anything else in the request is dropped.
    const messages = body.messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user', content: String(m.content || '') }));
    const stream = !!body.stream;
    const source = /^(typed|quick|selection|example|quiz|retry)$/.test(body.source) ? body.source : 'other';
    const turn = messages.filter((m) => m.role === 'user').length > 1 ? 'followup' : 'first';
    // The site owner's own browser says so (it opted out of GA), and local
    // development is the owner too, so reports can leave both out.
    const who = body.owner === true || !origin.startsWith('https://') ? 'owner' : 'reader';
    const count = (outcome, neurons) => { try { env.USAGE && env.USAGE.writeDataPoint({ indexes: [source], blobs: [source, turn, outcome, who], doubles: [1, neurons || 0] }); } catch (e) {} };
    const cacheable = stream && messages.length === 2 && messages[0].role === 'system' && messages[1].role === 'user';
    const cacheKey = cacheable ? new Request('https://ai.jpnotes.dev/cache/' + await sha256(MODEL + '\n' + JSON.stringify(messages))) : null;
    const headers = new Headers(cors);
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Type', stream ? 'text/event-stream' : 'application/json');

    if (cacheKey) {
      const hit = await caches.default.match(cacheKey);
      if (hit) { count('cache'); return new Response(replay(await hit.json()), { status: 200, headers }); }
    }

    const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const quota = env.QUOTA.get(env.QUOTA.idFromName(new Date().toISOString().slice(0, 10)));
    const verdict = await (await quota.fetch('https://quota/take', { method: 'POST', body: await hashIp(ip, env) })).json();
    if (!verdict.ok) { count('limited-' + (verdict.why || 'ip')); return json({ error: { message: verdict.message } }, 429, cors); }

    const params = { messages, stream, max_tokens: Math.min(+body.max_tokens || MAX_TOKENS, MAX_TOKENS) };
    const onCached = (done) => {
      if (cacheKey && done.content && done.finished) {
        ctx.waitUntil(caches.default.put(cacheKey, new Response(JSON.stringify({ content: done.content, reasoning: done.reasoning }), { headers: { 'Cache-Control': 'public, max-age=' + CACHE_TTL } })));
      }
    };
    // Workers AI can't answer: try the backups, else say why.
    const backup = async (gone) => {
      const res = await viaFallback(env, quota, params, count);
      if (res) {
        if (!stream) return new Response(JSON.stringify(await res.json()), { status: 200, headers });
        return new Response(res.body.pipeThrough(toChunks(onCached)), { status: 200, headers });
      }
      // Workers AI couldn't answer and no backup did: the one that needs a look.
      count(gone ? 'limited-budget' : 'error');
      return json({ error: { message: gone ? QUOTA_GONE : '免费模型现在出错了，请过一会儿再试。 / The free model failed; please try again shortly.' } }, gone ? 429 : 503, cors);
    };
    if (verdict.budgetGone) return backup(true);
    let result;
    try {
      try { result = await env.AI.run(MODEL, { ...params, reasoning_effort: 'low' }); }
      catch (e) { if (quotaGone(e)) throw e; result = await env.AI.run(MODEL, params); }   // in case the knob is ever rejected
    } catch (e) {
      return backup(quotaGone(e));
    }
    const spend = (neurons) => quota.fetch('https://quota/spend', { method: 'POST', body: String(neurons) });
    if (!stream) {
      const out = toCompletion(result);
      const neurons = (result && result.usage && result.usage.neurons) || 0;
      count('model', neurons);
      ctx.waitUntil(spend(neurons));
      return new Response(JSON.stringify(out), { status: 200, headers });
    }
    return new Response(result.pipeThrough(toChunks((done) => {
      count('model', done.neurons);
      ctx.waitUntil(spend(done.neurons));
      onCached(done);
    })), { status: 200, headers });
  },
};

// One note from a reader. Only known fields are kept, each checked and capped.
async function feedback(req, env, cors) {
  const raw = await req.text();
  if (raw.length > 8000) return json({ ok: false, message: 'Too long' }, 413, cors);
  let b;
  try { b = JSON.parse(raw); } catch (e) { return json({ ok: false, message: 'Bad JSON' }, 400, cors); }
  const kind = b.kind === 'question' ? 'question' : 'general';
  const text = String(b.text || '').trim().slice(0, FEEDBACK_MAX);
  const qid = /^n[1-5]-[a-z0-9-]{3,24}$/.test(b.qid) ? b.qid : null;
  const reason = /^(answer|two|stem|other)$/.test(b.reason) ? b.reason : null;
  const choice = Number.isInteger(b.choice) && b.choice >= 0 && b.choice <= 3 ? b.choice : null;
  const page = /^\/[\w\-\/]{0,120}$/.test(b.page) ? b.page : null;
  const lang = b.lang === 'zh' ? 'zh' : 'en';
  if (kind === 'general' ? !text : !qid) return json({ ok: false, message: 'Empty' }, 400, cors);
  if (!env.FEEDBACK) return json({ ok: false, message: 'Feedback is not set up' }, 503, cors);
  const day = new Date().toISOString().slice(0, 10);
  const ip = await hashIp(req.headers.get('CF-Connecting-IP') || '0.0.0.0', env);
  const sent = await env.FEEDBACK.prepare('SELECT COUNT(*) AS n FROM feedback WHERE day = ? AND ip = ?').bind(day, ip).first();
  if (sent && sent.n >= FEEDBACK_PER_DAY) return json({ ok: false, message: '今天的反馈已经够多了，谢谢！明天再来。 / That\u2019s plenty for today — thank you! Try again tomorrow.' }, 429, cors);
  await env.FEEDBACK.prepare('INSERT INTO feedback (at, day, ip, kind, page, qid, choice, reason, lang, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(new Date().toISOString(), day, ip, kind, page, qid, choice, reason, lang, text || null).run();
  return json({ ok: true }, 200, cors);
}

function quotaGone(e) { return /4006|neuron|allocation/i.test(String(e && e.message)); }

// A cached answer, sent as the same SSE chunks a live one would be.
function replay(a) {
  const ev = (delta) => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta }] }) + '\n\n';
  return (a.reasoning ? ev({ reasoning: a.reasoning }) : '') + ev({ content: a.content }) + 'data: [DONE]\n\n';
}

// The first backup with a key that answers (429 / 5xx → the next one). Returns
// the provider's Response (OpenAI-shaped, streamed or not) or null.
async function viaFallback(env, quota, params, count) {
  const ready = FALLBACKS.filter((f) => env[f.key]);
  if (!ready.length) return null;
  const allowed = await (await quota.fetch('https://quota/fallback', { method: 'POST' })).json();
  if (!allowed.ok) return null;
  for (const f of ready) {
    try {
      const res = await fetch(f.url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env[f.key], 'Content-Type': 'application/json' },
        // reasoning_effort only for the gpt-oss models; other models may reject it.
        body: JSON.stringify({ ...params, model: env[f.modelVar] || f.model, ...(/gpt-oss/.test(env[f.modelVar] || f.model) ? { reasoning_effort: 'low' } : {}) }),
      });
      if (res.ok) { count('fallback-' + f.name); return res; }
    } catch (e) {}
  }
  return null;
}

// Workers AI streams either OpenAI chat.completion.chunk events or its own
// {response: "..."} events depending on the model; the panel reads the
// OpenAI shape, so normalise to that.
// Also tallies what the stream cost and what it said, for the quota and the
// answer cache; onDone runs once the stream has ended.
function toChunks(onDone) {
  const dec = new TextDecoder(), enc = new TextEncoder();
  const done = { neurons: 0, content: '', reasoning: '', finished: false };
  let buf = '';
  const conv = (line) => {
    if (!line.startsWith('data:')) return '';
    const data = line.slice(5).trim();
    if (data === '[DONE]') return 'data: [DONE]\n\n';
    let j;
    try { j = JSON.parse(data); } catch (e) { return ''; }
    if (j.usage && j.usage.neurons) done.neurons += j.usage.neurons;
    if (j.choices) {
      const c = j.choices[0] || {}, d = c.delta || {};
      done.content += d.content || '';
      done.reasoning += d.reasoning_content || d.reasoning || '';
      if (c.finish_reason === 'stop') done.finished = true;
      return 'data: ' + data + '\n\n';
    }
    if (typeof j.response === 'string' && j.response) { done.content += j.response; return 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: j.response } }] }) + '\n\n'; }
    return '';
  };
  return new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      const out = lines.map((l) => conv(l.trim())).join('');
      if (out) ctl.enqueue(enc.encode(out));
    },
    flush(ctl) { const out = conv(buf.trim()); if (out) ctl.enqueue(enc.encode(out)); onDone(done); },
  });
}
function toCompletion(r) {
  if (r && r.choices) return r;
  return { choices: [{ index: 0, message: { role: 'assistant', content: (r && r.response) || '' } }] };
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The first four groups of an IPv6 address (its /64), "::" expanded first.
function v6prefix(ip) {
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail !== undefined && tail ? tail.split(':') : [];
  const full = tail === undefined ? h : h.concat(Array(Math.max(0, 8 - h.length - t.length)).fill('0'), t);
  return full.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

// Daily salt, so the stored value cannot be matched to an IP across days.
// An IPv6 address counts by its /64: one home or phone gets a whole /64 and
// could otherwise step through addresses to dodge the per-reader limits.
async function hashIp(ip, env) {
  if (ip.includes(':')) ip = v6prefix(ip);
  const data = new TextEncoder().encode(new Date().toISOString().slice(0, 10) + '|' + (env.IP_SALT || '') + '|' + ip);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

/* One instance per UTC day. Counters live in SQLite; yesterday's instance is
 * simply never addressed again and its alarm wipes it. */
export class Quota {
  constructor(state) {
    this.state = state;
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS hits (ip TEXT PRIMARY KEY, day INTEGER NOT NULL, recent TEXT NOT NULL)');
        this.sql.exec('CREATE TABLE IF NOT EXISTS spent (id INTEGER PRIMARY KEY CHECK (id = 1), neurons REAL NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS backup (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)');
  }
  async fetch(req) {
    const path = new URL(req.url).pathname, now = Date.now();
    if (path === '/spend') {
      const n = +(await req.text()) || 0;
      this.sql.exec('INSERT INTO spent (id, neurons) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET neurons = neurons + excluded.neurons', n);
      return Response.json({ ok: true });
    }
    if (path === '/fallback') {
      this.sql.exec('INSERT INTO backup (id, n) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET n = n + 1');
      const used = this.sql.exec('SELECT n FROM backup WHERE id = 1').toArray()[0].n;
      return Response.json({ ok: used <= FALLBACK_PER_DAY });
    }
    const ip = await req.text();
    const spent = (this.sql.exec('SELECT neurons FROM spent WHERE id = 1').toArray()[0] || { neurons: 0 }).neurons;
    const row = this.sql.exec('SELECT day, recent FROM hits WHERE ip = ?', ip).toArray()[0];
    const day = row ? row.day : 0;
    const recent = (row ? JSON.parse(row.recent) : []).filter((t) => now - t < 60000);
    if (day >= PER_DAY) return Response.json({ ok: false, why: 'ip-day', message: '你今天的 ' + PER_DAY + ' 次免费提问已用完，明天再来；或在设置里填自己的 API key（Groq 的 key 也免费）。 / You have used today\u2019s ' + PER_DAY + ' free questions; come back tomorrow, or add your own API key in settings.' });
    if (recent.length >= PER_MINUTE) return Response.json({ ok: false, why: 'ip-minute', message: '问得太快了，请一分钟后再试。 / Too many questions in a minute; try again shortly.' });
    recent.push(now);
    this.sql.exec('INSERT INTO hits (ip, day, recent) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET day = excluded.day, recent = excluded.recent', ip, day + 1, JSON.stringify(recent));
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(now + 2 * 86400000);
    // Per-reader limits still apply when the site budget is gone: the request then goes to a backup.
    return Response.json({ ok: true, budgetGone: spent >= DAILY_NEURONS });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}
