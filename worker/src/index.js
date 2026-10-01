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
 *   - per-IP limits: a burst limit per minute and a daily cap, plus a global
 *     daily cap, counted in a Durable Object (IPs are stored hashed, per day)
 *
 * Nothing is logged: no questions, answers or IPs.
 */

const MODEL = '@cf/openai/gpt-oss-120b';
const MODEL_NAME = 'gpt-oss-120b';
const MAX_BODY = 120000;                              // bytes; a whole lesson as context is ~30k chars
const MAX_TOKENS = 4096;
const PER_MINUTE = 6;
const PER_DAY = 20;
const GLOBAL_PER_DAY = 500;

const ORIGIN_RE = /^(https:\/\/jpnotes\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const QUOTA_GONE = '今天本站的免费额度已用完，明天再来；或在设置里填自己的 API key。 / The site’s free quota for today is used up; come back tomorrow, or add your own API key in settings.';

export default {
  async fetch(req, env) {
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

    const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const quota = env.QUOTA.get(env.QUOTA.idFromName(new Date().toISOString().slice(0, 10)));
    const verdict = await (await quota.fetch('https://quota/take', { method: 'POST', body: await hashIp(ip, env) })).json();
    if (!verdict.ok) return json({ error: { message: verdict.message } }, 429, cors);

    // Only the fields the panel sends; anything else in the request is dropped.
    const messages = body.messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user', content: String(m.content || '') }));
    const stream = !!body.stream;
    let result;
    try {
      result = await env.AI.run(MODEL, { messages, stream, max_tokens: Math.min(+body.max_tokens || MAX_TOKENS, MAX_TOKENS) });
    } catch (e) {
      const gone = /4006|neuron|allocation/i.test(String(e && e.message));
      return json({ error: { message: gone ? QUOTA_GONE : '免费模型现在出错了，请过一会儿再试。 / The free model failed; please try again shortly.' } }, gone ? 429 : 503, cors);
    }
    const headers = new Headers(cors);
    headers.set('Cache-Control', 'no-store');
    if (!stream) {
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(toCompletion(result)), { status: 200, headers });
    }
    headers.set('Content-Type', 'text/event-stream');
    return new Response(result.pipeThrough(toChunks()), { status: 200, headers });
  },
};

// Workers AI streams either OpenAI chat.completion.chunk events or its own
// {response: "..."} events depending on the model; the panel reads the
// OpenAI shape, so normalise to that.
function toChunks() {
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  const conv = (line) => {
    if (!line.startsWith('data:')) return '';
    const data = line.slice(5).trim();
    if (data === '[DONE]') return 'data: [DONE]\n\n';
    let j;
    try { j = JSON.parse(data); } catch (e) { return ''; }
    if (j.choices) return 'data: ' + data + '\n\n';
    if (typeof j.response === 'string' && j.response) return 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: j.response } }] }) + '\n\n';
    return '';
  };
  return new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      const out = lines.map((l) => conv(l.trim())).join('');
      if (out) ctl.enqueue(enc.encode(out));
    },
    flush(ctl) { const out = conv(buf.trim()); if (out) ctl.enqueue(enc.encode(out)); },
  });
}
function toCompletion(r) {
  if (r && r.choices) return r;
  return { choices: [{ index: 0, message: { role: 'assistant', content: (r && r.response) || '' } }] };
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
  }
  async fetch(req) {
    const ip = await req.text(), now = Date.now();
    const total = this.sql.exec('SELECT COALESCE(SUM(day), 0) AS n FROM hits').one().n;
    if (total >= GLOBAL_PER_DAY) return Response.json({ ok: false, message: QUOTA_GONE });
    const row = this.sql.exec('SELECT day, recent FROM hits WHERE ip = ?', ip).toArray()[0];
    const day = row ? row.day : 0;
    const recent = (row ? JSON.parse(row.recent) : []).filter((t) => now - t < 60000);
    if (day >= PER_DAY) return Response.json({ ok: false, message: '你今天的 ' + PER_DAY + ' 次免费提问已用完，明天再来；或在设置里填自己的 API key（Groq 的 key 也免费）。 / You have used today’s ' + PER_DAY + ' free questions; come back tomorrow, or add your own API key in settings.' });
    if (recent.length >= PER_MINUTE) return Response.json({ ok: false, message: '问得太快了，请一分钟后再试。 / Too many questions in a minute; try again shortly.' });
    recent.push(now);
    this.sql.exec('INSERT INTO hits (ip, day, recent) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET day = excluded.day, recent = excluded.recent', ip, day + 1, JSON.stringify(recent));
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(now + 2 * 86400000);
    return Response.json({ ok: true });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}
