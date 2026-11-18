/**
 * Words for the 生词本 (vocabulary notebook) on the practice pages.
 *
 * After answering, a question lists the content words of its sentence, its
 * options, its passage or its transcript (`wd`, lemmas in order of first
 * appearance). The reader taps one to see its reading and meaning and to add
 * it to the notebook (progress `words`, see site/quiz.js and merge() in
 * site/sync.js). Meanings come from questions/words/{level}.json
 * ({ lemma: { r, zh, en } }, written by Claude, keyed by the dictionary form
 * kuromoji gives; { skip: true } drops a mis-split or useless one); a word
 * without one shows its reading only.
 *
 * build-quiz.js calls wordsOf() while bundling and dictionary() at the end.
 * `node build-words.js todo N5 [N]` prints the level's words that have no
 * meaning yet (lemma, reading, one sentence it appears in), for writing more.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIR = path.join(ROOT, "questions", "words");
const KEEP = new Set(["名詞", "動詞", "形容詞", "副詞", "連体詞"]);
const DROP_DETAIL = new Set(["非自立", "接尾", "数", "代名詞", "固有名詞", "特殊", "副詞可能-"]);
// Too basic or too grammatical to be worth a card.
const STOP = new Set(["する", "いる", "ある", "なる", "れる", "られる", "せる", "させる", "くる", "来る", "いく", "行く", "おく", "しまう", "みる", "くれる", "もらう", "あげる", "くださる", "いただく", "こと", "もの", "とき", "時", "ところ", "ため", "よう", "そう", "こう", "どう", "ああ", "こちら", "そちら", "あちら", "どちら", "ここ", "そこ", "あそこ", "どこ", "これ", "それ", "あれ", "どれ", "この", "その", "あの", "どの", "さん", "ちゃん", "くん", "様", "方"]);

const kata2hira = (s) => String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const HAS_JA = /[぀-ヿ一-鿿]/;

let tokenizer;
function init() {
  if (tokenizer) return Promise.resolve(tokenizer);
  const kuromoji = require("kuromoji");
  return new Promise((ok, fail) => kuromoji.builder({ dicPath: path.join(ROOT, "node_modules", "kuromoji", "dict") }).build((e, t) => (e ? fail(e) : ok((tokenizer = t)))));
}

// Readings and a context sentence per lemma, gathered while bundling.
const SEEN = {};   // level → Map(lemma → { r, ctx })

// Markers and speaker labels out, so they don't become words.
function clean(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/<<|>>|\[(?:_|★)\]|\[\[\d+\]\]|（　）|＿+/g, " ")
    .replace(/(^|\n|\s)[A-ZＡ-Ｚ][:：]?(?=「)/g, "$1")
    .replace(/\|/g, " ");
}

// A token worth a card: its lemma, or null.
function lemmaOf(w) {
  if (!KEEP.has(w.pos) || w.word_type !== "KNOWN" || DROP_DETAIL.has(w.pos_detail_1)) return null;
  const lemma = w.basic_form === "*" ? w.surface_form : w.basic_form;
  if (!HAS_JA.test(lemma) || /[A-Za-z0-9０-９]/.test(lemma) || STOP.has(lemma) || (glosses()[lemma] || {}).skip) return null;
  if (/^[぀-ゟ]$/.test(lemma)) return null;   // a lone hiragana is a mis-split
  if (w.pos === "名詞" && w.pos_detail_1 === "サ変接続" && !/[一-鿿]/.test(lemma) && lemma.length < 2) return null;
  return lemma;
}

// Where the words stand in one sentence, in order: [surface, lemma] pairs, so
// the page can mark them in the sentence it shows (quiz.js linkWords()).
function spansOf(text) {
  const out = [];
  for (const line of clean(text).split(/\n+/)) for (const w of tokenizer.tokenize(line)) {
    const lemma = lemmaOf(w);
    if (lemma && w.surface_form.trim()) out.push([w.surface_form, lemma]);
  }
  return out;
}

// A word met at a lower level (in its questions): on this level's pages it
// goes into a folded "easy words" group. Levels are bundled N5 first.
function easy(level, lemma) {
  const order = ["N5", "N4", "N3", "N2", "N1"];
  return order.slice(0, Math.max(0, order.indexOf(level))).some((lv) => SEEN[lv] && SEEN[lv].has(lemma));
}

// The content words of some texts, in order, each once. `level` records them
// for the level's dictionary.
function wordsOf(level, texts) {
  if (!tokenizer) throw new Error("build-words: init() first");
  const out = [], seen = new Set(), map = (SEEN[level] = SEEN[level] || new Map());
  for (const raw of texts) {
    const text = clean(raw);
    if (!HAS_JA.test(text)) continue;
    for (const line of text.split(/\n+/)) {
      for (const w of tokenizer.tokenize(line)) {
        const lemma = lemmaOf(w);
        if (!lemma) continue;
        if (!seen.has(lemma)) { seen.add(lemma); out.push(lemma); }
        if (!map.has(lemma)) map.set(lemma, { r: kata2hira(w.reading && w.reading !== "*" ? (w.basic_form === w.surface_form ? w.reading : readingOfBase(w)) : lemma), ctx: line.trim().slice(0, 80) });
      }
    }
  }
  return out;
}
// A conjugated verb's reading is of the surface form (書い → かい); take the
// base form's own reading from a second pass.
function readingOfBase(w) {
  const t = tokenizer.tokenize(w.basic_form);
  return t.length === 1 && t[0].reading ? t[0].reading : t.map((x) => x.reading || x.surface_form).join("");
}

let GLOSS;
function glosses() {
  if (GLOSS) return GLOSS;
  GLOSS = {};
  if (fs.existsSync(DIR)) for (const f of fs.readdirSync(DIR).filter((f) => /\.json$/.test(f)).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));
    for (const [k, v] of Object.entries(d)) if (!GLOSS[k]) GLOSS[k] = v;
  }
  return GLOSS;
}

// A word written in kana (へや, as the N5 test writes it) that has exactly one
// kanji spelling with the same reading among the words seen so far (部屋) is
// the same card: lemma → that spelling.
// Kanji spellings come from the words seen so far and from every level's
// meanings file, so a kana word on N5 still finds 是非 when only N1 has it
// (levels are bundled N5 first; 2026-11-18: ぜひ, かばん … showed no meaning).
function aliasOf() {
  const byReading = new Map();
  const add = (lemma, r) => { if (!r || !/[一-鿿]/.test(lemma)) return; const set = byReading.get(r) || new Set(); set.add(lemma); byReading.set(r, set); };
  for (const m of Object.values(SEEN)) for (const [lemma, s] of m) add(lemma, s.r);
  for (const [lemma, x] of Object.entries(glosses())) if (x && !x.skip && x.zh) add(lemma, kata2hira(x.r || ""));
  return (lemma) => {
    if (/[一-鿿゠-ヿ]/.test(lemma)) return null;
    const set = byReading.get(lemma);
    return set && set.size === 1 ? [...set][0] : null;
  };
}

// The level's dictionary: lemma → [reading, { zh, en }] (meaning when
// written), or → "部屋" (a string: the kana spelling of that entry).
function dictionary(level) {
  const g = glosses(), out = {}, alias = aliasOf();
  const entry = (lemma, s) => { const x = g[lemma]; return x && x.zh && x.en ? [x.r || s.r, { zh: x.zh, en: x.en }] : [(x && x.r) || s.r]; };
  for (const [lemma, s] of SEEN[level] || []) {
    const to = alias(lemma);
    if (to) {
      out[lemma] = to;
      if (!out[to]) for (const m of Object.values(SEEN)) if (m.has(to)) { out[to] = entry(to, m.get(to)); break; }
      if (!out[to]) out[to] = entry(to, { r: lemma });   // only in a later level's meanings file
    } else if (typeof out[lemma] !== "object") out[lemma] = entry(lemma, s);
  }
  return out;
}

module.exports = { init, wordsOf, spansOf, easy, dictionary, glosses, SEEN };

// `node build-words.js todo N5 [limit]`: words of a level (first seen at that
// level, lower levels' words excluded) without a meaning yet, as JSON lines.
if (require.main === module) {
  const [cmd, level, limit] = process.argv.slice(2);
  if (cmd !== "todo" || !level) { console.error("usage: node build-words.js todo N5 [limit]"); process.exit(1); }
  (async () => {
    await init();
    const { buildQuiz, LEVELS } = require("./build-quiz.js");
    process.env.WORDS_ONLY = "1";
    await buildQuiz(async (t) => t);
    const g = glosses(), earlier = new Set();
    for (const lv of LEVELS) {
      if (lv === level) break;
      for (const k of (SEEN[lv] || new Map()).keys()) earlier.add(k);
    }
    let n = 0;
    const alias = aliasOf();
    for (const [lemma, s] of SEEN[level] || []) {
      if (earlier.has(lemma) || (g[lemma] && g[lemma].zh) || alias(lemma)) continue;
      if (limit && n >= +limit) break;
      console.log(JSON.stringify({ w: lemma, r: s.r, ctx: s.ctx }));
      n++;
    }
  })();
}
