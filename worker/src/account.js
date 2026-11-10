/* jpnotes accounts — api.jpnotes.dev
 *
 * Optional sign-in so a reader's practice progress (site/quiz.js, jp_quiz_v1)
 * follows them across devices. Readers who don't sign in never talk to this
 * Worker. Client: site/sync.js.
 *
 *   POST   /auth/google   { credential }  Google ID token → { token, email }
 *   POST   /auth/logout                   ends this session
 *   GET    /me                            → { email }
 *   GET    /sync                          → { version, data, updated }  (version 0, data null: nothing saved yet)
 *   PUT    /sync          { version, data }  → { version }, or 409 { version, data } when
 *                                         `version` is not the stored one: merge and retry
 *   DELETE /account                       deletes the user and everything stored for them
 *
 * All but /auth/google need `Authorization: Bearer <token>`. The token is 32
 * random bytes; only its SHA-256 is stored. Stored per user: the email, the
 * Google account id, sessions, the progress JSON and its last few versions.
 * Nothing else, and no request logging (wrangler.account.toml).
 *
 * Only browsers on jpnotes.dev may call it (CORS + Origin check; localhost
 * under `wrangler dev` with ALLOW_LOCAL=1 in .dev.vars, where DEV_LOGIN=1 also
 * accepts { dev: "name@example.com" } instead of a Google token, for tests).
 */

const ORIGIN_RE = /^https:\/\/(www\.)?jpnotes\.dev$/;
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const SESSION_DAYS = 180;
const MAX_DATA = 1800000;        // characters of JSON; a D1 row holds 2 MB
const WRITES_PER_DAY = 3000;     // per user; the page saves at most every few seconds
const KEEP_HISTORY = 3;
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISS = ['accounts.google.com', 'https://accounts.google.com'];

const now = () => new Date().toISOString();
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const randomId = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function reply(body, status, cors) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
}

// Google's signing keys, kept for an hour (they rotate every few days).
let certs = { at: 0, keys: [] };
async function googleKey(kid) {
  if (Date.now() - certs.at > 3600e3 || !certs.keys.some((k) => k.kid === kid)) {
    const res = await fetch(GOOGLE_CERTS);
    if (!res.ok) throw new HttpError(503, 'Could not reach Google to check the sign-in. Try again.');
    certs = { at: Date.now(), keys: (await res.json()).keys || [] };
  }
  const jwk = certs.keys.find((k) => k.kid === kid);
  if (!jwk) throw new HttpError(401, 'Sign-in token was signed with an unknown key.');
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

// Verifies a Google ID token (RS256, issuer, audience, expiry) → { sub, email }.
async function verifyGoogle(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new HttpError(400, 'Not a sign-in token.');
  let head, claims;
  try {
    head = JSON.parse(new TextDecoder().decode(b64u(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
  } catch (e) { throw new HttpError(400, 'Not a sign-in token.'); }
  if (head.alg !== 'RS256' || !head.kid) throw new HttpError(401, 'Unexpected token type.');
  const key = await googleKey(head.kid);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new HttpError(401, 'Sign-in token has a bad signature.');
  const t = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISS.includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, 'Sign-in token is for another app.');
  if (!(claims.exp > t - 30) || !(claims.iat < t + 300)) throw new HttpError(401, 'Sign-in token has expired. Try again.');
  if (!claims.sub || !claims.email || claims.email_verified === false) throw new HttpError(401, 'Google did not confirm an email address.');
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase() };
}

// The user behind (provider, subject); an existing user with the same email
// gets this sign-in method added; otherwise a new user.
async function userFor(env, provider, who) {
  const db = env.DB;
  const known = await db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').bind(provider, who.sub).first();
  if (known) return known.user_id;
  let user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(who.email).first();
  if (!user) {
    user = { id: randomId(12) };
    await db.prepare('INSERT INTO users (id, email, created) VALUES (?, ?, ?)').bind(user.id, who.email, now()).run();
  }
  await db.prepare('INSERT OR IGNORE INTO identities (provider, subject, user_id, created) VALUES (?, ?, ?, ?)').bind(provider, who.sub, user.id, now()).run();
  return user.id;
}

async function newSession(env, userId) {
  const token = randomId(32), t = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(t),
    env.DB.prepare('INSERT INTO sessions (hash, user_id, created, expires) VALUES (?, ?, ?, ?)').bind(await sha256(token), userId, now(), t + SESSION_DAYS * 86400),
  ]);
  return token;
}

async function session(req, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Not signed in.');
  const hash = await sha256(m[1]);
  const row = await env.DB.prepare('SELECT s.user_id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires > ?').bind(hash, Math.floor(Date.now() / 1000)).first();
  if (!row) throw new HttpError(401, 'Signed out. Sign in again.');
  return { userId: row.user_id, email: row.email, hash };
}

async function body(req, limit) {
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, 'Too much data.');
  try { return JSON.parse(text); } catch (e) { throw new HttpError(400, 'Bad request.'); }
}

async function getSync(env, me) {
  const row = await env.DB.prepare('SELECT version, data, updated FROM progress WHERE user_id = ?').bind(me.userId).first();
  return row ? { version: row.version, data: JSON.parse(row.data), updated: row.updated } : { version: 0, data: null, updated: null };
}

async function putSync(env, me, input) {
  const base = input.version, data = input.data;
  if (!Number.isInteger(base) || base < 0 || !data || typeof data !== 'object' || data.v !== 1 || typeof data.answers !== 'object') throw new HttpError(400, 'Not a progress file.');
  const text = JSON.stringify(data);
  if (text.length > MAX_DATA) throw new HttpError(413, 'Progress is too large to sync.');
  const db = env.DB, day = now().slice(0, 10);
  const cur = await db.prepare('SELECT version, data, updated, day, writes FROM progress WHERE user_id = ?').bind(me.userId).first();
  if ((cur ? cur.version : 0) !== base) return { conflict: { version: cur ? cur.version : 0, data: cur ? JSON.parse(cur.data) : null } };
  const writes = cur && cur.day === day ? cur.writes + 1 : 1;
  if (writes > WRITES_PER_DAY) throw new HttpError(429, 'Too many saves today. Syncing resumes tomorrow.');
  if (!cur) {
    // Two first writes at once: the second fails on the primary key and is told to merge.
    try { await db.prepare('INSERT INTO progress (user_id, version, data, updated, day, writes) VALUES (?, 1, ?, ?, ?, 1)').bind(me.userId, text, now(), day).run(); }
    catch (e) { return { conflict: await getSync(env, me) }; }
    return { version: 1 };
  }
  // The WHERE on version makes the compare-and-set atomic; history first, in one batch.
  const res = await db.batch([
    db.prepare('INSERT OR REPLACE INTO progress_history (user_id, version, data, saved) SELECT user_id, version, data, updated FROM progress WHERE user_id = ? AND version = ?').bind(me.userId, base),
    db.prepare('UPDATE progress SET version = version + 1, data = ?, updated = ?, day = ?, writes = ? WHERE user_id = ? AND version = ?').bind(text, now(), day, writes, me.userId, base),
    db.prepare('DELETE FROM progress_history WHERE user_id = ? AND version <= ?').bind(me.userId, base - KEEP_HISTORY),
  ]);
  if (!res[1].meta.changes) return { conflict: await getSync(env, me) };
  return { version: base + 1 };
}

async function route(req, env, url, local) {
  const path = url.pathname.replace(/\/+$/, '') || '/', method = req.method;
  if (method === 'POST' && path === '/auth/google') {
    const input = await body(req, 8000);
    const who = local && env.DEV_LOGIN === '1' && typeof input.dev === 'string' && /^[^@\s]+@example\.com$/.test(input.dev)
      ? { sub: 'dev:' + input.dev, email: input.dev }
      : await verifyGoogle(input.credential, env);
    const userId = await userFor(env, 'google', who);
    return reply({ token: await newSession(env, userId), email: who.email });
  }
  const me = await session(req, env);
  if (method === 'GET' && path === '/me') return reply({ email: me.email });
  if (method === 'POST' && path === '/auth/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(me.hash).run();
    return reply({ ok: true });
  }
  if (method === 'GET' && path === '/sync') return reply(await getSync(env, me));
  if (method === 'PUT' && path === '/sync') {
    const out = await putSync(env, me, await body(req, MAX_DATA + 1000));
    return out.conflict ? reply(out.conflict, 409) : reply(out);
  }
  if (method === 'DELETE' && path === '/account') {
    await env.DB.batch(['progress_history', 'progress', 'sessions', 'identities'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(me.userId))
      .concat(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.userId)));
    return reply({ ok: true });
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const local = env.ALLOW_LOCAL === '1' && LOCAL_RE.test(origin);
    if (!ORIGIN_RE.test(origin) && !local) return reply({ error: 'This service only works from jpnotes.dev.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, new URL(req.url), local);
      for (const k in cors) res.headers.set(k, cors[k]);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message }, e.status, cors);
      return reply({ error: 'Something went wrong on our side. Try again.' }, 500, cors);
    }
  },
};
