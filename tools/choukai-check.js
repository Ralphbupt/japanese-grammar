#!/usr/bin/env node
/**
 * Checks listening scripts (questions/N{level}/choukai-*.json, spec in
 * docs/quiz-listening-spec.md §8) before they go to review or TTS.
 *
 *   node tools/choukai-check.js N5        errors + warnings for one level
 *   node tools/choukai-check.js           every level
 *
 * Mock tests (questions/N5/mock-1/choukai-*.json, ids n5-m1-ck-101) are checked
 * too: per-type counts must match MOCK_COUNTS, and no line may repeat a
 * practice line word for word.
 *
 * Errors: missing fields, bad ids, answer out of range, tr not matching lines,
 * traps outside the fixed list. Warnings: the right option clearly longest /
 * shortest (a test-taking cue), answers piling up in one position.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TYPES = { kadai: 1, point: 2, gaiyou: 3, hatsuwa: 4, sokuji: 5, tougou: 6 };
const NOPTS = { kadai: 4, point: 4, gaiyou: 4, hatsuwa: 3, sokuji: 3, tougou: 4 };
// Keep in step with the list in the spec (§8 `traps`).
const TRAPS = new Set([
  "repeat-word", "timing", "tense", "question-word", "intent", "perspective", "contradiction", "number",
  "later", "done-already", "someone-else", "order", "not-possible", "condition-conflict",
  "denied-guess", "mentioned-not-asked", "half-right", "other-option-attribute",
  "partial-content", "detail-as-topic", "twisted", "attitude-combo", "third-person-decides",
]);
const SPEAKERS = /^(M|F)[12]?$/;
// Official listening item counts per mock test (N5: JLPT 2020 revision notice).
const MOCK_COUNTS = { N5: { kadai: 7, point: 6, hatsuwa: 5, sokuji: 6 } };
const len = (s) => s.replace(/[\s　]/g, "").length;
const isBi = (o) => o && typeof o.zh === "string" && o.zh.trim() && typeof o.en === "string" && o.en.trim();

function check(level, sub, practiceLines) {
  const dir = path.join(ROOT, "questions", level, sub || "");
  const prefix = level.toLowerCase() + (sub ? `-m${sub.split("-")[1]}` : "");
  const errors = [], warnings = [], seen = new Set(), positions = {}, perType = {}, lineSet = new Set();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^choukai-[a-z]+\.json$/.test(f)).sort() : [];
  for (const f of files) {
    let items;
    try { items = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")); } catch (e) { errors.push(`${f}: ${e.message}`); continue; }
    for (const q of items) {
      const at = `${level}${sub ? "/" + sub : ""}/${f} ${q.id || "?"}`;
      const err = (m) => errors.push(`${at}: ${m}`);
      if (!TYPES[q.type]) { err(`unknown type ${q.type}`); continue; }
      if (`choukai-${q.type}.json` !== f) err(`type ${q.type} in ${f}`);
      const idRe = new RegExp(`^${prefix}-ck-${TYPES[q.type]}\\d\\d$`);
      if (!idRe.test(q.id || "")) err(`id should look like ${prefix}-ck-${TYPES[q.type]}NN`);
      perType[q.type] = (perType[q.type] || 0) + 1;
      if (seen.has(q.id)) err("duplicate id");
      seen.add(q.id);

      const lines = q.lines || [];
      if (q.type !== "hatsuwa" && !lines.length) err("no lines");
      for (const l of lines) if (!Array.isArray(l) || l.length !== 2 || !SPEAKERS.test(l[0]) || !String(l[1]).trim()) err(`bad line ${JSON.stringify(l)}`);
      // Mock items are new: no dialogue line copied from the practice bank. Short set phrases
      // (ただいま) and the narrator's stock scene sentences (〜が 話して います) are fine.
      for (const t of lines.map((l) => l[1])) {
        const k = String(t).replace(/[\s　]/g, "");
        lineSet.add(k);
        if (practiceLines && k.length > 12 && practiceLines.has(k)) err(`copies a practice line: ${t}`);
      }
      if (q.type === "sokuji" || q.type === "hatsuwa") {
        if (!SPEAKERS.test(q.respond || "")) err("respond missing");
      }
      if (q.type === "hatsuwa" && !(q.picture && q.picture.desc && q.picture.arrow)) err("picture { desc, arrow } missing");
      if (["kadai", "point", "gaiyou", "tougou"].includes(q.type) && !q.scene) err("scene missing");
      if (q.type !== "sokuji" && !q.question && !q.questions) err("question missing");

      const n = NOPTS[q.type];
      if (!Array.isArray(q.options) || q.options.length !== n) err(`needs ${n} options`);
      if (q.optionImages && (!Array.isArray(q.optionImages) || q.optionImages.length !== n || q.optionImages.some((d) => !String(d).trim()))) err(`optionImages needs ${n} descriptions`);

      // One or several questions on the same audio.
      const parts = q.questions || [q];
      for (const [i, p] of parts.entries()) {
        const pat = q.questions ? `${at}-${i + 1}` : at;
        if (!Number.isInteger(p.answer) || p.answer < 0 || p.answer >= n) { errors.push(`${pat}: answer out of range`); continue; }
        if (!isBi(p.why)) errors.push(`${pat}: why needs zh + en`);
        if (!Array.isArray(p.wrong) || p.wrong.length !== n) errors.push(`${pat}: wrong needs ${n} entries`);
        else p.wrong.forEach((w, k) => {
          if (k === p.answer ? w !== null : !isBi(w)) errors.push(`${pat}: wrong[${k}] ${k === p.answer ? "should be null" : "needs zh + en"}`);
        });
        const key = `${q.type}${q.optionImages ? "-pic" : ""}`;
        (positions[key] = positions[key] || Array(n).fill(0))[p.answer]++;
        // Length cue: the right option alone at the long or short end, ≥3 chars clear of the next.
        if (!q.optionImages && Array.isArray(q.options) && q.options.length === n) {
          const L = q.options.map(len), s = [...L].sort((a, b) => a - b), a = L[p.answer];
          if (a === s[n - 1] && s[n - 2] <= a - 3) warnings.push(`${pat}: right option is clearly the longest ${JSON.stringify(L)}`);
          if (a === s[0] && s[1] >= a + 3) warnings.push(`${pat}: right option is clearly the shortest ${JSON.stringify(L)}`);
        }
      }

      for (const lang of ["zh", "en"]) {
        const t = q.tr && q.tr[lang];
        if (!t) { err(`tr.${lang} missing`); continue; }
        if ((t.lines || []).length !== lines.length) err(`tr.${lang}.lines has ${(t.lines || []).length}, lines has ${lines.length}`);
        if ((t.options || []).length !== n) err(`tr.${lang}.options needs ${n}`);
        if (q.scene && !t.scene) err(`tr.${lang}.scene missing`);
        if (q.question && !t.question) err(`tr.${lang}.question missing`);
        if (q.questions && (t.questions || []).length !== q.questions.length) err(`tr.${lang}.questions needs ${q.questions.length}`);
      }
      if (!Array.isArray(q.traps) || !q.traps.length) err("traps missing");
      else for (const t of q.traps) if (!TRAPS.has(t)) err(`trap "${t}" not in the fixed list`);
    }
  }
  for (const [k, c] of Object.entries(positions)) {
    const total = c.reduce((a, b) => a + b, 0);
    if (total >= 8 && Math.max(...c) > Math.ceil(total / c.length) + 2) warnings.push(`${level} ${k}: answers pile up ${JSON.stringify(c)}`);
  }
  const want = sub && MOCK_COUNTS[level];
  if (want && seen.size) for (const [t, n] of Object.entries(want)) if ((perType[t] || 0) !== n) errors.push(`${level}/${sub}: ${t} has ${perType[t] || 0} items, the test has ${n}`);
  return { errors, warnings, count: seen.size, lineSet };
}
const mockDirs = (level) => {
  const dir = path.join(ROOT, "questions", level);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => /^mock-\d+$/.test(d)) : [];
};

const levels = process.argv[2] ? [process.argv[2]] : ["N5", "N4", "N3", "N2", "N1"];
let bad = 0;
for (const lv of levels) {
  const practice = check(lv);
  for (const [sub, r] of [[null, practice], ...mockDirs(lv).map((m) => [m, check(lv, m, practice.lineSet)])]) {
    const { errors, warnings, count } = r;
    if (!count && !errors.length) continue;
    for (const e of errors) console.log(`ERROR ${e}`);
    for (const w of warnings) console.log(`warn  ${w}`);
    console.log(`${lv}${sub ? "/" + sub : ""}: ${count} items, ${errors.length} errors, ${warnings.length} warnings`);
    bad += errors.length;
  }
}
process.exit(bad ? 1 : 0);
