#!/usr/bin/env node
/**
 * Blind review for practice questions (questions/README.md, "Review").
 *
 *   node tools/quiz-blind.js sheet N5 lesson01 dokkai-short > sheet.md
 *       The questions without answers or explanations, for a reviewer who
 *       hasn't seen them.
 *   node tools/quiz-blind.js check N5 answers.json   (or N5/mock-1 for a mock test)
 *       answers.json = { "n5-l01-001": { "a": 2, "flag": "optional note" }, … }
 *       (a = option number 1–4). Lists every question where the reviewer's
 *       answer differs from the key or that was flagged.
 */
const fs = require("fs");
const path = require("path");
const { loadLevel, loadDir, shuffled, answerOf } = require("../build-quiz");

const [, , cmd, level, ...rest] = process.argv;
const dir = path.join(__dirname, "..", "questions", level || "");

// `only`: file names without .json (lesson05, moji-goi-kanji, dokkai-short …).
// Same option order as the published quiz.
function load(only) {
  // A mock test folder is given as N5/mock-1.
  const { qs, passages } = level.includes("/") ? loadDir(path.join(__dirname, "..", "questions", level), level) : loadLevel(level);
  const pick = (q) => !only.length || only.includes(q._file.split("/").pop().replace(".json", ""));
  return { qs: qs.filter(pick).map(shuffled), passages: Object.fromEntries(passages.map((p) => [p.id, p])) };
}
const key = answerOf;

if (cmd === "sheet") {
  const out = ["Answer each question. <<…>> marks the underlined part. Reply with JSON: {\"<id>\": {\"a\": <option number 1-4>, \"flag\": \"<only if something is off: another option also works, unnatural Japanese, above level, …>\"}}.", ""];
  const { qs, passages } = load(rest);
  let lastP = null;
  for (const q of qs) {
    if (q.passage && q.passage !== lastP) {
      const p = passages[q.passage];
      out.push(`## Passage ${p.id}`, ...(p.intro ? [p.intro] : []), "", p.passage.replace(/\[\[(\d+)\]\]/g, "［$1］"), "");
    }
    lastP = q.passage || null;
    const how = { narabe: "put the four pieces in order; which piece goes in ★?", kanji: "how is the underlined word read?", hyouki: "how is the underlined word written?", iikae: "which option is closest in meaning to the underlined part?", youhou: "which sentence uses the underlined word correctly?", gokeisei: "which part forms the right word with the one next to （　）?", bunshou: `what goes in ［${q._blank}］?` }[q.type] || "fill （　） / answer the question";
    out.push(`### ${q.id} (${how})`);
    if (q.stem) out.push(q.stem.replace(/\[_\]/g, "＿＿").replace(/\[★\]/g, "＿★＿"));
    if (q.q) out.push(q.q);
    q.options.forEach((o, i) => out.push(`${i + 1}. ${o}`));
    out.push("");
  }
  console.log(out.join("\n"));
} else if (cmd === "check") {
  const answers = JSON.parse(fs.readFileSync(rest[0], "utf-8"));
  let n = 0, bad = 0;
  for (const q of load([]).qs) {
    const a = answers[q.id];
    if (!a) continue;
    n++;
    const k = key(q) + 1;
    if (a.a !== k || a.flag) {
      bad++;
      console.log(`${q.id}: key ${k} ${q.options[k - 1]} · reviewer ${a.a} ${q.options[a.a - 1] || "?"}${a.flag ? " · flag: " + a.flag : ""}`);
    }
  }
  console.log(`${n} checked, ${bad} to look at`);
} else {
  console.log("usage: quiz-blind.js sheet <level> [lessonNN…] | check <level> answers.json");
}
