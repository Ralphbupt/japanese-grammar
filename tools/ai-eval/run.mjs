#!/usr/bin/env node
/**
 * AI-panel answer check: send the frozen prompts in cases.json to one or more
 * models and save what they answer, with the cases' simple string checks.
 * Grading the answers themselves is done by a person (or Claude) reading
 * results/<date>/<model>.md against each case's `expect`.
 *
 *   node tools/ai-eval/run.mjs cf:@cf/openai/gpt-oss-120b gemini:gemini-3.8-flash
 *   node tools/ai-eval/run.mjs --only l35-claim-reversed cf:@cf/zai-org/glm-5.3-flash
 *   node tools/ai-eval/run.mjs --effort medium cf:@cf/openai/gpt-oss-120b
 *
 * cf:<model>      Workers AI over the REST API, with the wrangler login token.
 *                 This spends the account's free daily neurons, the same pool
 *                 the site's free relay uses — run few models a day.
 *                 Called like the relay: reasoning low (gpt-oss), max_tokens 2048.
 * gemini:<model>  needs GEMINI_API_KEY.
 * openai-compatible: <base>|<model> with OPENAI_COMPAT_KEY, for anything else.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ACCOUNT = 'ac5b0b471a6fa56e6acbaef0f4f0810b';
const MAX_TOKENS = 2048;   // same as worker/src/index.js
const args = process.argv.slice(2);
const only = args[0] === '--only' ? args.splice(0, 2)[1].split(',') : null;
// --effort low|medium|high: gpt-oss reasoning effort (the relay sends low).
const effort = args[0] === '--effort' ? args.splice(0, 2)[1] : 'low';
if (!args.length) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(1); }
const { cases } = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'));
const todo = cases.filter((c) => !only || only.includes(c.id));

function cfToken() {
  try { execSync('npx wrangler whoami', { cwd: path.join(DIR, '../../worker'), stdio: 'ignore' }); } catch {}
  const toml = fs.readFileSync(path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  return toml.match(/oauth_token = "([^"]+)"/)[1];
}
function endpoint(spec) {
  const [kind, ...rest] = spec.split(':'), model = rest.join(':');
  if (kind === 'cf') return { url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`, key: cfToken(), model, extra: /gpt-oss/.test(model) ? { reasoning_effort: effort } : {} };
  if (kind === 'gemini') return { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: process.env.GEMINI_API_KEY, model, extra: {} };
  if (kind === 'openai-compatible') { const [base, m] = model.split('|'); return { url: base.replace(/\/$/, '') + '/chat/completions', key: process.env.OPENAI_COMPAT_KEY, model: m, extra: {} }; }
  throw new Error('unknown model spec ' + spec);
}
async function ask(ep, messages) {
  const t0 = Date.now();
  const r = await fetch(ep.url, { method: 'POST', headers: { Authorization: 'Bearer ' + ep.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ep.model, messages: messages.map(({ role, content }) => ({ role, content })), max_tokens: MAX_TOKENS, ...ep.extra }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`, ms: Date.now() - t0 };
  const ch = (j.choices || [])[0] || {};
  return { answer: (ch.message && ch.message.content) || '', usage: j.usage || null, ms: Date.now() - t0 };
}
// Answers put readings after kanji (面白（おもしろ）くない); drop them before matching.
const plain = (a) => a.replace(/（[\u3041-\u309f\u30fc]+）/g, '').replace(/\*\*/g, '');
const check = (c, ans) => { const a = plain(ans); return [
  ...c.must.filter((s) => !a.includes(s) && !ans.includes(s)).map((s) => `missing「${s}」`),   // a reading may be the point (しか)
  ...c.mustNot.filter((s) => a.includes(s)).map((s) => `has「${s}」`),
  ...(ans.trim() ? [] : ['EMPTY']),
]; };

const day = new Date().toISOString().slice(0, 10);
for (const spec of args) {
  const ep = endpoint(spec), out = [`# ${spec} · ${day}`, ''], json = [];
  let flagged = 0;
  for (const c of todo) {
    const r = await ask(ep, c.messages);
    const issues = r.error ? ['ERROR'] : check(c, r.answer);
    if (issues.length) flagged++;
    json.push({ id: c.id, ...r, issues });
    out.push(`## ${c.id}${issues.length ? '  ⚠ ' + issues.join(', ') : ''}`, '', `**Asked:** ${c.messages[c.messages.length - 1].content.split('\n')[0]}`, '',
      `**Expected:** ${c.expect}`, '', r.error || r.answer, '', `_(${r.ms} ms${r.usage ? ', ' + JSON.stringify(r.usage) : ''})_`, '');
    process.stdout.write(issues.length ? '!' : '.');
  }
  const dir = path.join(DIR, 'results', day), base = spec.replace(/[^a-z0-9.-]+/gi, '_') + (/gpt-oss/.test(spec) && effort !== 'low' ? '_' + effort : '');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, base + '.md'), out.join('\n'));
  fs.writeFileSync(path.join(dir, base + '.json'), JSON.stringify(json, null, 1));
  console.log(`  ${spec}: ${todo.length} cases, ${flagged} with string-check issues → results/${day}/${base}.md`);
}
