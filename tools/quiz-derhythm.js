#!/usr/bin/env node
/**
 * Re-place the right options of a mock file so the published answer positions
 * (after build-quiz.js's id-seeded shuffle) are balanced and patternless: a
 * seeded shuffle of a balanced list, no position three times in a row, no run
 * of four repeated, no 0-1-2-3 ramps. build-quiz.js warns when a file has a
 * rhythm (cue 4); this fixes it without touching wording.
 *
 *   node tools/quiz-derhythm.js questions/N3/mock-3/moji-goi.json
 *
 * Works on moji-goi / bunpou (flat items) and dokkai (passages with questions);
 * narabe is left alone (its answer comes from `order`). Each option moves with
 * its wrong[] and okj[] entries. Explanations must not refer to option numbers.
 */
const fs = require('fs'), crypto = require('crypto');
const file = process.argv[2], seed = process.argv[3] || file;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const perm = (id) => { const h = crypto.createHash('sha1').update(id).digest(), p = [0,1,2,3]; for (let i = 3; i > 0; i--) { const j = h[i] % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } return p; };
const items = [];
for (const x of data) {
  if (Array.isArray(x.questions) && x.passage) x.questions.forEach((q, i) => items.push({ q, id: `${x.id}-${i + 1}` }));
  else if (x.type !== 'narabe') items.push({ q: x, id: x.id });
}
const usable = items.filter(({ q }) => Number.isInteger(q.answer) && Array.isArray(q.options) && q.options.length === 4);
const fin = ({ q, id }) => perm(id).indexOf(q.answer);
const move = ({ q, id }, to) => { const s = perm(id)[to], a = q.answer; if (s === a) return;
  for (const k of ['options', 'wrong', 'okj']) if (Array.isArray(q[k]) && q[k].length === 4) [q[k][a], q[k][s]] = [q[k][s], q[k][a]];
  q.answer = s; };
// Seeded RNG.
let st = parseInt(crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
const rnd = () => ((st = (st * 1103515245 + 12345) >>> 0) / 4294967296);
const ok = (s) => { for (let i = 2; i < s.length; i++) if (s[i] === s[i-1] && s[i] === s[i-2]) return false;
  const seen = new Set(); for (let i = 0; i + 4 <= s.length; i++) { const g = s.slice(i, i + 4).join(''); if (seen.has(g)) return false; seen.add(g); }
  for (let i = 1; i + 1 < s.length; i++) if (s[i-1] === (s[i]+3)%4 && s[i+1] === (s[i]+1)%4 && s[i+2] === (s[i]+2)%4) return false; // no 0123-style ramps
  return true; };
const n = usable.length, base = Array.from({ length: n }, (_, i) => i % 4);
let target;
for (let t = 0; t < 20000; t++) { const s = base.slice(); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } if (ok(s)) { target = s; break; } }
if (!target) { console.error('no pattern-free order found'); process.exit(1); }
console.log('before', usable.map(fin).join(''));
usable.forEach((it, i) => move(it, target[i]));
console.log('after ', usable.map(fin).join(''));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
