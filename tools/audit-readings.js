#!/usr/bin/env node
/**
 * Audit the 读音 (reading) column of every word table in grammar/.
 *
 * Inspired by the podcast project's tools/audit-furigana.py: it cross-checks
 * each hand-typed reading against an independent tokenizer (kuromoji, the same
 * engine build.js uses for furigana) and flags disagreements for MANUAL review.
 * It rewrites nothing — a flag means "a human should look", not "this is wrong"
 * (kuromoji also mis-reads rare/contextual words).
 *
 * Usage:
 *   node tools/audit-readings.js                 # all lessons
 *   node tools/audit-readings.js N5              # one level
 *   node tools/audit-readings.js lesson01        # one lesson (any level)
 *
 * Exits non-zero if any suspect reading is found.
 */

const fs = require("fs");
const path = require("path");
const kuromoji = require("kuromoji");

const ROOT = path.dirname(__dirname);
const GRAMMAR = path.join(ROOT, "grammar");
const DICT = path.join(ROOT, "node_modules", "kuromoji", "dict");

const KATA = /[ァ-ヶ]/;
const KANJI = /[一-龠々〆ヶ]/;
const KANA_ONLY = /^[ぁ-んァ-ヶーゔ・]+$/;

// katakana -> hiragana
const toHira = (s) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// Normalize for comparison: hiragana, drop long-vowel marks and small-tsu noise,
// collapse the おう/おお distinction tokenizers and humans disagree on harmlessly.
function norm(s) {
  return toHira(s)
    .trim()
    .replace(/ー/g, "")
    .replace(/・/g, "")
    .replace(/[\s　]/g, "");
}

// Manual reading cells sometimes list alternates: あめ／あま, とう・どう, etc.
function manualVariants(reading) {
  return reading
    .split(/[\/／、,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function* tableRows(md) {
  const lines = md.split(/\r?\n/);
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // header row of a vocab table: | 单词 | 读音 | 含义 |
    if (/^\|\s*单词\s*\|\s*读音\s*\|/.test(line)) {
      inTable = true;
      i++; // skip the |---|---| separator
      continue;
    }
    if (inTable) {
      if (!line.startsWith("|")) {
        inTable = false;
        continue;
      }
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length < 2) continue;
      if (/^-+$/.test(cells[0])) continue;
      yield { word: cells[0], reading: cells[1], lineNo: i + 1 };
    }
  }
}

function kuromojiReading(tokenizer, word) {
  const tokens = tokenizer.tokenize(word);
  let out = "";
  for (const t of tokens) {
    // reading is katakana; '*' or missing => unknown word, can't verify
    if (!t.reading || t.reading === "*") return null;
    out += t.reading;
  }
  return out;
}

function lessonFiles(filter) {
  const out = [];
  for (const level of ["N5", "N4", "N3", "N2"]) {
    const dir = path.join(GRAMMAR, level);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      if (filter && !level.includes(filter) && !f.includes(filter)) continue;
      out.push(path.join(dir, f));
    }
  }
  return out;
}

async function main() {
  const filter = process.argv[2];
  const files = lessonFiles(filter);

  const tokenizer = await new Promise((res, rej) =>
    kuromoji.builder({ dicPath: DICT }).build((e, t) => (e ? rej(e) : res(t)))
  );

  const findings = [];
  let checked = 0;
  let unverifiable = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const md = fs.readFileSync(file, "utf-8");
    for (const { word, reading, lineNo } of tableRows(md)) {
      if (!word || !reading) continue;
      const variants = manualVariants(reading).map(norm);

      // Kana-only word: the reading should just echo it.
      if (KANA_ONLY.test(word) && !KANJI.test(word)) {
        const w = norm(word);
        if (!variants.includes(w)) {
          findings.push(
            `${rel}:${lineNo}  ${word} (读音「${reading}」) — kana word; reading should match the word itself`
          );
        }
        checked++;
        continue;
      }
      if (!KANJI.test(word)) continue;

      const ref = kuromojiReading(tokenizer, word);
      checked++;
      if (ref == null) {
        unverifiable++;
        continue;
      }
      const refN = norm(ref);
      if (!variants.includes(refN)) {
        findings.push(
          `${rel}:${lineNo}  ${word} — 读音「${reading}」 but kuromoji reads 「${toHira(ref)}」`
        );
      }
    }
  }

  for (const line of findings) console.log(`SUSPECT  ${line}`);
  console.log(
    `\nChecked ${checked} reading(s) in ${files.length} file(s); ` +
      `${findings.length} suspect, ${unverifiable} unverifiable (unknown to kuromoji).`
  );
  process.exit(findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
