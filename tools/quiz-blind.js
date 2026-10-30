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
 *   node tools/quiz-blind.js sheet N2 choukai-kadai …
 *       Listening scripts (questions/N{level}/choukai-*.json) as a transcript.
 *       Options keep their file order (spoken options can't be shuffled);
 *       統合理解 with several questions → ids n2-ck-602-1, -2.
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

// Listening: one entry per question; a 統合理解 with `questions` becomes several.
function loadChoukai(only) {
  const files = fs.readdirSync(dir).filter((f) => /^choukai-[a-z]+\.json$/.test(f) && (!only.length || only.includes(f.replace(".json", ""))));
  return files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")).flatMap((q) =>
    q.questions ? q.questions.map((s, i) => ({ ...q, ...s, id: `${q.id}-${i + 1}`, _part: i })) : [q]));
}
const LISTEN_HOW = { kadai: "課題理解", point: "ポイント理解", gaiyou: "概要理解 (question comes only at the end)", hatsuwa: "発話表現", sokuji: "即時応答: which reply fits?", tougou: "統合理解" };

if (cmd === "sheet" && rest.length && rest.every((f) => f.startsWith("choukai"))) {
  const out = ["These are JLPT listening items, given as transcripts — in the test they are heard once, not read. Options marked (spoken) are only heard. Answer each; also flag anything that would be hard or ambiguous *by ear* (homophones, a key word easy to miss, unclear who is speaking), unnatural spoken Japanese, or vocabulary/grammar above the level. Reply with JSON: {\"<id>\": {\"a\": <option number>, \"flag\": \"<only if something is off>\"}}.", ""];
  let shown = null;
  for (const q of loadChoukai(rest)) {
    out.push(`### ${q.id} (${LISTEN_HOW[q.type]})`);
    const atEnd = q.type === "gaiyou" || (q.type === "tougou" && !q.questions);
    if (q._part === undefined || q.id.split("-").slice(0, 3).join("-") !== shown) {
      if (q.scene) out.push(`[narrator] ${q.scene}`);
      if (q.question && !atEnd && !q.questions) out.push(`[narrator] ${q.question}`);
      q.lines.forEach(([who, t]) => out.push(`${who}: ${t}`));
      if (q.question && (atEnd || q.questions)) out.push(`[narrator] ${q.question}`);
    } else out.push("(same audio as above)", `[narrator] ${q.question}`);
    shown = q.id.split("-").slice(0, 3).join("-");
    if (q.picture) out.push(`[picture in the booklet] ${q.picture.desc}${q.picture.arrow ? ` — arrow points at: ${q.picture.arrow}` : ""}`);
    const spoken = q.spokenOptions || q.type === "sokuji" || q.type === "hatsuwa";
    q.options.forEach((o, i) => out.push(`${i + 1}. ${q.optionImages ? `[picture] ${q.optionImages[i]}` : o}${spoken ? " (spoken)" : ""}`));
    out.push("");
  }
  console.log(out.join("\n"));
} else if (cmd === "check" && rest[1] === "choukai") {
  const answers = JSON.parse(fs.readFileSync(rest[0], "utf-8"));
  let n = 0, bad = 0;
  for (const q of loadChoukai([])) {
    const a = answers[q.id];
    if (!a) continue;
    n++;
    if (a.a !== q.answer + 1 || a.flag) {
      bad++;
      console.log(`${q.id}: key ${q.answer + 1} ${q.options[q.answer]} · reviewer ${a.a} ${q.options[a.a - 1] || "?"}${a.flag ? " · flag: " + a.flag : ""}`);
    }
  }
  console.log(`${n} checked, ${bad} to look at`);
} else if (cmd === "sheet") {
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
  console.log("usage: quiz-blind.js sheet <level> [lessonNN… | choukai-…] | check <level> answers.json [choukai]");
}
