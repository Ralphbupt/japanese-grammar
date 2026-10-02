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
 * Nothing is logged: no questions, answers or IPs.
 */

const MODEL = '@cf/openai/gpt-oss-120b';
const MODEL_NAME = 'gpt-oss-120b';
const MAX_BODY = 120000;                              // bytes; a whole lesson as context is ~30k chars
const MAX_TOKENS = 2048;
const PER_MINUTE = 6;
const PER_DAY = 30;
const DAILY_NEURONS = 9500;                           // Free plan allows 10,000/day; keep a margin so readers get our message, not an upstream error
const CACHE_TTL = 3 * 86400;

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
    if (req.method !== 'POST' || path !== '/v1/chat/completions') return json({ error: { message: 'Not found' } }, 404, cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: { message: '请求太长：把 📎 范围缩小到某一节再试。 / Request too large: narrow the 📎 scope to one grammar point.' } }, 413, cors);
    let body;
    try { body = JSON.parse(raw); } catch (e) { return json({ error: { message: 'Bad JSON' } }, 400, cors); }
    if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: { message: 'messages required' } }, 400, cors);

    // Only the fields the panel sends; anything else in the request is dropped.
    const messages = body.messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user', content: String(m.content || '') }));
    const stream = !!body.stream;
    const cacheable = stream && messages.length === 2 && messages[0].role === 'system' && messages[1].role === 'user';
    const cacheKey = cacheable ? new Request('https://ai.jpnotes.dev/cache/' + await sha256(MODEL + '\n' + JSON.stringify(messages))) : null;
    const headers = new Headers(cors);
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Type', stream ? 'text/event-stream' : 'application/json');

    if (cacheKey) {
      const hit = await caches.default.match(cacheKey);
      if (hit) return new Response(replay(await hit.json()), { status: 200, headers });
    }

    const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const quota = env.QUOTA.get(env.QUOTA.idFromName(new Date().toISOString().slice(0, 10)));
    const verdict = await (await quota.fetch('https://quota/take', { method: 'POST', body: await hashIp(ip, env) })).json();
    if (!verdict.ok) return json({ error: { message: verdict.message } }, 429, cors);

    const params = { messages, stream, max_tokens: Math.min(+body.max_tokens || MAX_TOKENS, MAX_TOKENS) };
    let result;
    try {
      try { result = await env.AI.run(MODEL, { ...params, reasoning_effort: 'low' }); }
      catch (e) { if (quotaGone(e)) throw e; result = await env.AI.run(MODEL, params); }   // in case the knob is ever rejected
    } catch (e) {
      const gone = quotaGone(e);
      return json({ error: { message: gone ? QUOTA_GONE : '免费模型现在出错了，请过一会儿再试。 / The free model failed; please try again shortly.' } }, gone ? 429 : 503, cors);
    }
    const spend = (neurons) => quota.fetch('https://quota/spend', { method: 'POST', body: String(neurons) });
    if (!stream) {
      const out = toCompletion(result);
      ctx.waitUntil(spend((result && result.usage && result.usage.neurons) || 0));
      return new Response(JSON.stringify(out), { status: 200, headers });
    }
    return new Response(result.pipeThrough(toChunks((done) => {
      ctx.waitUntil(spend(done.neurons));
      if (cacheKey && done.content && done.finished) {
        ctx.waitUntil(caches.default.put(cacheKey, new Response(JSON.stringify({ content: done.content, reasoning: done.reasoning }), { headers: { 'Cache-Control': 'public, max-age=' + CACHE_TTL } })));
      }
    })), { status: 200, headers });
  },
};

function quotaGone(e) { return /4006|neuron|allocation/i.test(String(e && e.message)); }

// A cached answer, sent as the same SSE chunks a live one would be.
function replay(a) {
  const ev = (delta) => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta }] }) + '\n\n';
  return (a.reasoning ? ev({ reasoning: a.reasoning }) : '') + ev({ content: a.content }) + 'data: [DONE]\n\n';
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

// Daily salt, so the stored value cannot be matched to an IP across days.
async function hashIp(ip, env) {
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
  }
  async fetch(req) {
    const path = new URL(req.url).pathname, now = Date.now();
    if (path === '/spend') {
      const n = +(await req.text()) || 0;
      this.sql.exec('INSERT INTO spent (id, neurons) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET neurons = neurons + excluded.neurons', n);
      return Response.json({ ok: true });
    }
    const ip = await req.text();
    const spent = (this.sql.exec('SELECT neurons FROM spent WHERE id = 1').toArray()[0] || { neurons: 0 }).neurons;
    if (spent >= DAILY_NEURONS) return Response.json({ ok: false, message: QUOTA_GONE });
    const row = this.sql.exec('SELECT day, recent FROM hits WHERE ip = ?', ip).toArray()[0];
    const day = row ? row.day : 0;
    const recent = (row ? JSON.parse(row.recent) : []).filter((t) => now - t < 60000);
    if (day >= PER_DAY) return Response.json({ ok: false, message: '你今天的 ' + PER_DAY + ' 次免费提问已用完，明天再来；或在设置里填自己的 API key（Groq 的 key 也免费）。 / You have used today\u2019s ' + PER_DAY + ' free questions; come back tomorrow, or add your own API key in settings.' });
    if (recent.length >= PER_MINUTE) return Response.json({ ok: false, message: '问得太快了，请一分钟后再试。 / Too many questions in a minute; try again shortly.' });
    recent.push(now);
    this.sql.exec('INSERT INTO hits (ip, day, recent) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET day = excluded.day, recent = excluded.recent', ip, day + 1, JSON.stringify(recent));
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(now + 2 * 86400000);
    return Response.json({ ok: true });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}
