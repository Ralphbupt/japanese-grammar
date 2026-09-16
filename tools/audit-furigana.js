#!/usr/bin/env node
/**
 * Audit the furigana build.js actually emitted, by reading dist/.
 *
 * tools/audit-readings.js checks the hand-typed 读音 column of the word
 * tables; this one checks the <ruby> annotations on every example sentence —
 * the readings kuromoji guessed, where context errors live (話せます read as
 * はなし + せます, 後で as のちで, 方 as ほう).
 *
 * It rewrites nothing. Categories:
 *   [broken]      the reading isn't kana at all — Chinese/kanji leaked in
 *   [table]       contradicts a 读音 cell a human typed in a word table
 *   [split]       the same word is read two different ways across the site
 *   [suspect]     implausible kana-per-kanji ratio
 *
 * Usage:
 *   npm run build && node tools/audit-furigana.js [lesson11]
 *
 * Exits non-zero if any [broken] or [table] finding is present.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const DIST = path.join(ROOT, "dist");
const GRAMMAR = path.join(ROOT, "grammar");

const RUBY = /<ruby>([^<]*)<rp>\(<\/rp><rt>([^<]*)<\/rt><rp>\)<\/rp><\/ruby>/g;
const KANA_ONLY = /^[ぁ-んァ-ヶーゔ・\s]+$/;
const KANJI = /[一-龠々〆ヶ]/g;

const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const norm = (s) => toHira(s).trim().replace(/[ー・\s　]/g, "");

// Readings that legitimately differ from the word table's dictionary form:
// grammar-term compounds (ます形 = ますけい), conjugations (空く = すく) and
// the fixed compounds a 单词/读音 cell can't express (お母さん, 何時).
const KNOWN_OK = new Set([
  "形(けい)", "嫌(きら)", "何(なん)", "空(す)", "足(た)", "母(かあ)", "外(はず)",
]);

// Hand-typed word-table readings: word -> Set of accepted readings.
function tableReadings() {
  const map = new Map();
  for (const level of ["N5", "N4", "N3", "N2"]) {
    const dir = path.join(GRAMMAR, level);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      let inTable = false;
      for (const raw of fs.readFileSync(path.join(dir, f), "utf-8").split(/\r?\n/)) {
        const line = raw.trim();
        if (/^\|\s*单词\s*\|\s*读音\s*\|/.test(line)) { inTable = true; continue; }
        if (!inTable) continue;
        if (!line.startsWith("|")) { inTable = false; continue; }
        const cells = line.split("|").slice(1, -1).map((c) => c.trim());
        if (cells.length < 2 || /^-+$/.test(cells[0])) continue;
        const word = cells[0].replace(/[（(].*$/, "").trim();
        if (!word || !KANA_ONLY.test(cells[1].replace(/[\/／、,，]/g, ""))) continue;
        if (!map.has(word)) map.set(word, new Set());
        for (const r of cells[1].split(/[\/／、,，]/)) if (r.trim()) map.get(word).add(norm(r));
      }
    }
  }
  return map;
}

// Plain text around a ruby, for showing context.
const strip = (s) => s.replace(/<rp>[^<]*<\/rp>|<rt>[^<]*<\/rt>/g, "").replace(/<[^>]+>/g, "");

function pages(filter) {
  const out = [];
  for (const d of fs.readdirSync(DIST, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (filter && !d.name.includes(filter)) continue;
    const p = path.join(DIST, d.name, "index.html");
    if (fs.existsSync(p)) out.push({ page: d.name, file: p });
  }
  return out.sort((a, b) => a.page.localeCompare(b.page));
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error("dist/ not found — run `npm run build` first.");
    process.exit(2);
  }
  const table = tableReadings();
  const broken = [];
  const tableConflict = new Map();
  const suspect = [];
  const byWord = new Map(); // word -> reading -> [{page, context}]
  let total = 0;

  for (const { page, file } of pages(process.argv[2])) {
    const html = fs.readFileSync(file, "utf-8");
    let m;
    RUBY.lastIndex = 0;
    while ((m = RUBY.exec(html))) {
      const [tag, word, reading] = m;
      total++;
      const ctx =
        strip(html.slice(Math.max(0, m.index - 24), m.index)).slice(-12) +
        `【${word}(${reading})】` +
        strip(html.slice(m.index + tag.length, m.index + tag.length + 40)).slice(0, 12);
      const where = `${page.padEnd(10)} ${ctx.replace(/\s+/g, " ")}`;

      if (!KANA_ONLY.test(reading)) { broken.push(where); continue; }

      const accepted = table.get(word);
      if (accepted && accepted.size && !accepted.has(norm(reading)) && !KNOWN_OK.has(`${word}(${reading})`)) {
        const key = `${word}(${reading})  vs word table 「${[...accepted].join("／")}」`;
        if (!tableConflict.has(key)) tableConflict.set(key, []);
        tableConflict.get(key).push(where);
      }

      const kanjiCount = (word.match(KANJI) || []).length;
      if (kanjiCount && norm(reading).length > kanjiCount * 4) suspect.push(where);

      if (!byWord.has(word)) byWord.set(word, new Map());
      const r = byWord.get(word);
      const key = norm(reading);
      if (!r.has(key)) r.set(key, []);
      r.get(key).push(where);
    }
  }

  const splits = [...byWord.entries()]
    .filter(([, r]) => r.size > 1)
    .sort((a, b) => b[1].size - a[1].size);

  const section = (title, rows) => {
    console.log(`\n${title} (${rows.length})`);
    for (const r of rows) console.log("  " + r);
  };

  console.log(`Checked ${total} ruby annotations across ${pages(process.argv[2]).length} pages.`);
  section("[broken] reading is not kana", broken);
  const conflicts = [...tableConflict.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`\n[table] contradicts a hand-typed 读音 cell (${conflicts.length} words, ${[...tableConflict.values()].reduce((n, v) => n + v.length, 0)} spots)`);
  for (const [key, hits] of conflicts) console.log(`  ×${String(hits.length).padStart(3)}  ${key}\n           e.g. ${hits[0]}`);
  section("[suspect] implausible reading length", suspect);
  console.log(`\n[split] same word read two ways (${splits.length}) — most need a human`);
  for (const [word, readings] of splits) {
    const parts = [...readings.entries()].map(([r, hits]) => `${r}×${hits.length}`).join("  ");
    console.log(`  ${word}: ${parts}`);
    for (const [, hits] of readings) console.log(`      ${hits[0]}`);
  }

  if (broken.length || tableConflict.size) process.exit(1);
}

main();
