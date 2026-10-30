#!/usr/bin/env node
/**
 * Practice questions: questions/N{level}/*.json → dist/quiz/{level}.json
 *
 * Three kinds of file per level (authoring rules: questions/README.md):
 *
 *   lessonNN.json   grammar questions on one lesson's grammar points
 *     bunpou    文の文法1  stem has one （　）
 *     narabe    文の文法2  stem has four slots, three [_] and one [★]; `order`
 *                         lists option indices in sentence order, the answer is
 *                         whatever lands on ★
 *   moji-goi*.json  vocabulary (no furigana anywhere, like the real section)
 *     kanji     漢字読み    <<漢字>> underlined in the stem, options are readings
 *     hyouki    表記       <<かな>> underlined, options are spellings
 *     bunmyaku  文脈規定   stem has one （　）, options are words
 *     iikae     言い換え    <<…>> underlined, options are whole sentences
 *   dokkai*.json    passages, each with its own questions
 *     bunshou   文章の文法  blanks [[1]] [[2]] … in the passage, one question
 *                         per blank in order (no `q` text)
 *     short / mid / info  内容理解（短文）/（中文）/ 情報検索; each question has `q`.
 *                         Passage lines starting with | are a table.
 *
 * Every question: options (4), answer (index, except narabe), why {zh,en},
 * wrong (one {zh,en} per option, null for the right one), difficulty 1–3.
 * Grammar questions also need refs ("lessonNN#K" = grammar point K), full
 * (the finished sentence) and tr {zh,en}; vocabulary questions need tr (of the
 * stem sentence) and may cite "lessonNN#vocab". Passages carry tr {zh,en} for
 * the whole text. Ids are permanent (progress is keyed on them):
 * n5-l05-001, n5-mg-001, n5-dk-001 (its questions become n5-dk-001-1, -2 …).
 *
 * build.js calls buildQuiz() with kuroshiro's furigana helper; on its own
 * (`node build-quiz.js`) this only validates the files.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
// The practice / mock test / flashcard pages: until they're public they are
// built and reachable by URL, but noindex, out of the sitemap and unlinked.
// Links to them (sidebar, home, level pages, lessons, guides, /anki/) show
// once they're public, or in a local preview build (QUIZ_PREVIEW=1).
const QUIZ_PUBLIC = true;
const QUIZ_LINKS = QUIZ_PUBLIC || process.env.QUIZ_PREVIEW === "1";
const LEVELS = ["N5", "N4", "N3", "N2", "N1"].filter((l) => fs.existsSync(path.join(ROOT, "questions", l)));
const GROUPS = {
  moji: { zh: "文字・语汇", en: "Vocabulary", ja: "文字・語彙" },
  bunpou: { zh: "语法", en: "Grammar", ja: "文法" },
  dokkai: { zh: "阅读", en: "Reading", ja: "読解" },
};
const TYPES = {
  kanji: { g: "moji", zh: "汉字读音", en: "Kanji reading", ja: "漢字読み" },
  hyouki: { g: "moji", zh: "汉字写法", en: "Writing", ja: "表記" },
  gokeisei: { g: "moji", zh: "构词", en: "Word formation", ja: "語形成" },
  bunmyaku: { g: "moji", zh: "选词填空", en: "Word in context", ja: "文脈規定" },
  iikae: { g: "moji", zh: "同义句", en: "Paraphrase", ja: "言い換え類義" },
  youhou: { g: "moji", zh: "词语用法", en: "Usage", ja: "用法" },
  bunpou: { g: "bunpou", zh: "文法形式", en: "Grammar form", ja: "文の文法1" },
  narabe: { g: "bunpou", zh: "句子排序 ★", en: "Sentence order ★", ja: "文の文法2" },
  bunshou: { g: "bunpou", zh: "文章语法", en: "Grammar in a text", ja: "文章の文法" },
  short: { g: "dokkai", zh: "短文阅读", en: "Short passages", ja: "内容理解（短文）" },
  mid: { g: "dokkai", zh: "中篇阅读", en: "Mid-length passages", ja: "内容理解（中文）" },
  long: { g: "dokkai", zh: "长篇阅读", en: "Long passages", ja: "内容理解（長文）" },
  tougou: { g: "dokkai", zh: "综合理解", en: "Comparing two texts", ja: "統合理解" },
  shuchou: { g: "dokkai", zh: "主张理解", en: "The author's argument", ja: "主張理解（長文）" },
  info: { g: "dokkai", zh: "信息检索", en: "Finding information", ja: "情報検索" },
};
const FILE_TYPES = {
  lesson: ["bunpou", "narabe"],
  "moji-goi": ["kanji", "hyouki", "gokeisei", "bunmyaku", "iikae", "youhou"],
  dokkai: ["bunshou", "short", "mid", "long", "tougou", "shuchou", "info"],
};
// Furigana like the real test: never in the vocabulary section, and from N3
// up not in grammar or reading either. The finished sentence and the
// explanations shown after answering keep it at every level.
const NO_RUBY = new Set(FILE_TYPES["moji-goi"]);
const RUBY_LEVELS = new Set(["N5", "N4"]);
// N3, like the real test, has furigana only on words with kanji above N4: a
// word written entirely in N5/N4 kanji (the usual JLPT lists) goes bare.
const ABOVE_N4_RUBY = new Set(["N3"]);
const BASIC_KANJI = new Set([..."日一国人年大十二本中長出三時行見月分後前生五間上東四今金九入学高円子外八六下来気小七山話女北午百書先名川千水半男西電校語土木聞食車何南万毎白天母火右読友左休父雨" +
  "会同事自社発者地業方新場員立開手力問代明動京目通言理体田主題意不作用度強公持野以思家世多正安院心界教文元重近考画海売知道集別物使品計死特私始朝運終台広住真有口少町料工建空急止送切転研足究楽起着店病質待試族銀早映親験英医仕去味写字答夜音注帰古歌買悪図週室歩風紙黒花春赤青館屋色走秋夏習駅洋旅服夕借曜飲肉貸堂鳥飯勉冬昼茶弟牛魚兄犬妹姉漢光声達部合遅乗寝晩降洗窓雪耳々"]);
const dropBasicRuby = (html) => html.replace(/<ruby>([^<]+)<rp>\(<\/rp><rt>[^<]*<\/rt><rp>\)<\/rp><\/ruby>/g, (m, k) => ([...k].every((c) => BASIC_KANJI.has(c) || !/[一-龯]/.test(c)) ? k : m));
const rubyMode = (level) => (RUBY_LEVELS.has(level) ? true : ABOVE_N4_RUBY.has(level) ? "above" : false);

// Grammar the lessons teach earlier than the JLPT tests it: the N5 lessons
// cover conditionals, potential/passive, そうだ/ようだ … which the usual lists
// put at N4. Their questions carry `pre` ("N4"): practice by lesson and the
// review list keep them; daily sets, practice by type and the analysis of
// the level leave them out. A whole lesson or one grammar point (lessonNN#K);
// only points every common list puts higher (つもり, 予定, でしょう stay N5).
const ABOVE_LEVEL = {
  N5: {
    "lesson07#4": "N4",                                   // たばかり
    lesson09: "N4", lesson10: "N4", lesson11: "N4",       // と・ば・たら・なら; 可能形・受身形
    "lesson12#1": "N4", "lesson12#4": "N4",               // 意向形; つもり vs 予定 vs ようと思う
    "lesson13#2": "N4", "lesson13#3": "N4", "lesson13#4": "N4",   // かもしれない; そうだ ×2
    lesson14: "N4", "lesson14#4": "N3",                   // ようだ・みたいだ・らしい; っぽい
    "lesson15#2": "N4", "lesson15#4": "N4", "lesson15#6": "N4", "lesson15#8": "N4",   // ことがある/ことはない, のに, し, ために
    "lesson16#2": "N4", "lesson16#3": "N4", "lesson16#5": "N4",   // すぎる, やすい/にくい, 方
  },
};
function aboveLevel(level, q) {
  const map = ABOVE_LEVEL[level];
  const ref = map && (q.refs || []).find((r) => !/#vocab$/.test(r));
  return ref ? map[ref] || map[ref.split("#")[0]] || null : null;
}

// Mock test layout per level: sittings (minutes, types in order; each type
// is one もんだい) and scoring (official sections; listening isn't tested).
// Mock test layout per level: sittings (minutes, types in order; each type
// is one もんだい) and scoring (official sections, each a set of types;
// listening isn't tested). Item counts per type: questions/README.md.
const MOJI = { key: "moji", zh: "言语知识（文字・语汇）", en: "Language knowledge (vocabulary)", ja: "言語知識（文字・語彙）" };
const BUNPOU = { key: "bunpou", zh: "言语知识（语法）・阅读", en: "Language knowledge (grammar) & reading", ja: "言語知識（文法）・読解" };
const GENGO_ALL = { key: "gengo", zh: "言语知识・阅读", en: "Language knowledge & reading", ja: "言語知識（文字・語彙・文法）・読解" };
const GENGO = { key: "gengo", zh: "言语知识（文字・语汇・语法）", en: "Language knowledge", ja: "言語知識（文字・語彙・文法）" };
const DOKKAI = { key: "dokkai", zh: "阅读", en: "Reading", ja: "読解" };
const LISTENING = { max: 60, min: 19 };
const GRAMMAR_TYPES = ["bunpou", "narabe", "bunshou"];
const MOCK = {
  N5: {
    sections: [{ ...MOJI, minutes: 20, types: ["kanji", "hyouki", "bunmyaku", "iikae"] }, { ...BUNPOU, minutes: 40, types: [...GRAMMAR_TYPES, "short", "mid", "info"] }],
    scoring: [{ ...GENGO_ALL, max: 120, min: 38, types: ["kanji", "hyouki", "bunmyaku", "iikae", ...GRAMMAR_TYPES, "short", "mid", "info"] }],
    listening: LISTENING, pass: 80,
  },
  N4: {
    sections: [{ ...MOJI, minutes: 25, types: ["kanji", "hyouki", "bunmyaku", "iikae", "youhou"] }, { ...BUNPOU, minutes: 55, types: [...GRAMMAR_TYPES, "short", "mid", "info"] }],
    scoring: [{ ...GENGO_ALL, max: 120, min: 38, types: ["kanji", "hyouki", "bunmyaku", "iikae", "youhou", ...GRAMMAR_TYPES, "short", "mid", "info"] }],
    listening: LISTENING, pass: 90,
  },
  N3: {
    sections: [{ ...MOJI, minutes: 30, types: ["kanji", "hyouki", "bunmyaku", "iikae", "youhou"] }, { ...BUNPOU, minutes: 70, types: [...GRAMMAR_TYPES, "short", "mid", "long", "info"] }],
    scoring: [
      { ...GENGO, max: 60, min: 19, types: ["kanji", "hyouki", "bunmyaku", "iikae", "youhou", ...GRAMMAR_TYPES] },
      { ...DOKKAI, max: 60, min: 19, types: ["short", "mid", "long", "info"] },
    ],
    listening: LISTENING, pass: 95,
  },
  N2: {
    sections: [{ key: "all", zh: "言语知识（文字・语汇・语法）・阅读", en: "Language knowledge & reading", ja: "言語知識（文字・語彙・文法）・読解", minutes: 105,
      types: ["kanji", "hyouki", "gokeisei", "bunmyaku", "iikae", "youhou", ...GRAMMAR_TYPES, "short", "mid", "tougou", "shuchou", "info"] }],
    scoring: [
      { ...GENGO, max: 60, min: 19, types: ["kanji", "hyouki", "gokeisei", "bunmyaku", "iikae", "youhou", ...GRAMMAR_TYPES] },
      { ...DOKKAI, max: 60, min: 19, types: ["short", "mid", "tougou", "shuchou", "info"] },
    ],
    listening: LISTENING, pass: 90,
  },
  // N1: one 110-minute sitting; no 表記 / 語形成 in the vocabulary part.
  N1: {
    sections: [{ key: "all", zh: "言语知识（文字・语汇・语法）・阅读", en: "Language knowledge & reading", ja: "言語知識（文字・語彙・文法）・読解", minutes: 110,
      types: ["kanji", "bunmyaku", "iikae", "youhou", ...GRAMMAR_TYPES, "short", "mid", "long", "tougou", "shuchou", "info"] }],
    scoring: [
      { ...GENGO, max: 60, min: 19, types: ["kanji", "bunmyaku", "iikae", "youhou", ...GRAMMAR_TYPES] },
      { ...DOKKAI, max: 60, min: 19, types: ["short", "mid", "long", "tougou", "shuchou", "info"] },
    ],
    listening: LISTENING, pass: 100,
  },
};
const SLOT = /\[(_|★)\]/g;
const RUBY = /<ruby>([^<]+)<rp>\(<\/rp><rt>([^<]*)<\/rt><rp>\)<\/rp><\/ruby>/g;
const KANJI = /[一-龯㐀-䶿々]/;
// A table cell that is only weekday abbreviations (月〜金, 土・日, 水): kuromoji
// reads a lone 水 as みず and 金 as きむ, so these get the weekday readings.
const WEEKDAYS = /^[月火水木金土日](\s*[・〜～、]\s*[月火水木金土日])*$/;
// Readings kuromoji gets wrong in the question texts (lessons have their own
// list, RUBY_FIXES in build.js). Each: [regex on the furigana'd HTML, replacement].
const R = (k, r) => `<ruby>${k}<rp>(</rp><rt>${r}</rt><rp>)</rp></ruby>`;
const RX = (k, r) => R(k, r).replace(/[()]/g, "\\$&");
// Kanji numerals + 日 read as dates / day counts: kuromoji gives 八(はち)日(にち),
// 二十(にじゅう)日(にち). 一日 is left alone (ついたち or いちにち).
const DAY_KANJI = { 二: "ふつか", 三: "みっか", 四: "よっか", 五: "いつか", 六: "むいか", 七: "なのか", 八: "ようか", 九: "ここのか", 十: "とおか", 十四: "じゅうよっか", 二十: "はつか", 二十四: "にじゅうよっか" };
const NUM_RUBY = /((?:<ruby>[一二三四五六七八九十]+<rp>\(<\/rp><rt>[^<]*<\/rt><rp>\)<\/rp><\/ruby>)+)<ruby>日<rp>\(<\/rp><rt>にち<\/rt><rp>\)<\/rp><\/ruby>/g;
const fixDays = (html) => html.replace(NUM_RUBY, (m, nums) => {
  const k = nums.replace(/<rp>[^<]*<\/rp>|<rt>[^<]*<\/rt>|<\/?ruby>/g, "");
  return DAY_KANJI[k] ? R(k + "日", DAY_KANJI[k]) : m;
});
const QUIZ_RUBY_FIXES = [
  [new RegExp(RX("管理人", "かんりじん") + "|" + RX("管理", "かんり") + RX("人", "じん"), "g"), R("管理人", "かんりにん")],
  [new RegExp(RX("土", "ど") + "(?=[にをがのは])", "g"), R("土", "つち")],
  // A weekday in brackets or a range: （月）, 月〜金.
  [new RegExp("(?<=[（(])" + RX("月", "つき") + "(?=[）)])|" + RX("月", "つき") + "(?=[〜～・])", "g"), R("月", "げつ")],
  // 角を曲がる is かど; 先々週 is せんせんしゅう.
  [new RegExp(RX("角", "かく") + "(?=を)", "g"), R("角", "かど")],
  [new RegExp(RX("先々", "さきざき") + RX("週", "しゅう"), "g"), R("先々週", "せんせんしゅう")],
  [new RegExp(RX("富士山", "ふじやま"), "g"), R("富士山", "ふじさん")],
  [new RegExp(RX("日本人", "にっぽんじん"), "g"), R("日本人", "にほんじん")],
  // A date's 1日 (3月1日) is ついたち; 1日で / 1日おきに stay いちにち.
  [new RegExp("(" + RX("月", "がつ") + ")([1１])" + RX("日", "にち"), "g"), (m, month, one) => month + R(one + "日", "ついたち")],
  [new RegExp(RX("市場", "しじょう"), "g"), R("市場", "いちば")],
  // 十分 / 二十分 as minutes (ぐらい・かかる・歩いて…) — not じゅうぶん / じゅうふん
  [new RegExp(RX("十分", "じゅうぶん") + "(?=\\s*(ぐらい|くらい|ほど|かか|で|前|後|です))", "g"), R("十分", "じゅっぷん")],
  [new RegExp(RX("十", "じゅう") + RX("分", "ふん"), "g"), R("十", "じゅっ") + R("分", "ぷん")],
  // お腹が空く is すく
  [new RegExp("(" + RX("腹", "なか") + "が\\s*)" + RX("空", "あ"), "g"), "$1" + R("空", "す")],
  [new RegExp("(この\\s*)" + RX("間", "ま") + "(?=\\s*[、は])", "g"), "$1" + R("間", "あいだ")],
  [new RegExp("(り)" + RX("紙", "し"), "g"), "$1" + R("紙", "がみ")],                 // 張り紙・貼り紙
  [new RegExp("(を\\s*)" + RX("書", "が") + "(?=き)", "g"), "$1" + R("書", "か")],       // 名前を書きさえすれば
  [new RegExp("(" + RX("洗濯", "せんたく") + ")" + RX("物", "ぶつ"), "g"), "$1" + R("物", "もの")],
  [new RegExp("(" + RX("何", "なに") + ")" + RX("色", "しょく"), "g"), "$1" + R("色", "いろ")],
  [new RegExp("(" + RX("直接", "ちょくせつ") + ")" + RX("話", "ばなし"), "g"), "$1" + R("話", "はなし")],
];
const WEEKDAY_READING = { 月: "げつ", 火: "か", 水: "すい", 木: "もく", 金: "きん", 土: "ど", 日: "にち" };

// Grammar points per lesson from the markdown: { lesson05: { title, 1: {zh, en, slug}, …, vocab } }
function lessonPoints(level) {
  const dir = path.join(ROOT, "grammar", level);
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(lesson\d+)_.*\.md$/);
    if (!m) continue;
    const md = fs.readFileSync(path.join(dir, f), "utf-8");
    const points = {};
    const h1 = (md.match(/^# (.+)$/m) || [])[1] || m[1];
    const [t1zh, t1en] = h1.split("||").map((x) => x.trim());
    points.title = { zh: t1zh.replace(/^Lesson\s*\d+\s*[–-]\s*/, ""), en: (t1en || t1zh).replace(/^Lesson\s*\d+\s*[–-]\s*/, "") };
    for (const h of md.matchAll(/^## (\d+)\.\s*(.+)$/gm)) {
      const [zh, en] = h[2].split("||").map((s) => s.trim());
      points[h[1]] = { zh, en: en ? en.replace(/^\d+\.\s*/, "") : zh, slug: `${h[1]}._${zh}`.replace(/[\s　]+/g, "_").replace(/[<>"'&]/g, "") };
    }
    if (/^## 本课单词表/m.test(md)) points.vocab = { zh: "本课单词表", en: "Vocabulary", slug: "本课单词表" };
    out[m[1]] = points;
  }
  return out;
}

// All questions in a folder, flat; passage questions carry `passage` (its id).
// A mock test folder (questions/N5/mock-1/) has the same kinds of file, with
// the grammar in bunpou.json.
function loadDir(dir, label) {
  const qs = [], passages = [];
  if (!fs.existsSync(dir)) return { qs, passages };
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
  const level = label;
  for (const f of fs.readdirSync(dir).sort()) {
    if (/^(lesson\d+|bunpou)\.json$/.test(f)) for (const q of read(f)) qs.push({ ...q, _file: `${level}/${f}`, _kind: "lesson" });
    else if (/^moji-goi(-[a-z]+)?\.json$/.test(f)) for (const q of read(f)) qs.push({ ...q, _file: `${level}/${f}`, _kind: "moji-goi" });
    else if (/^dokkai(-[a-z]+)?\.json$/.test(f)) for (const p of read(f)) {
      passages.push({ ...p, _file: `${level}/${f}` });
      (p.questions || []).forEach((q, i) => qs.push({ ...q, id: `${p.id}-${i + 1}`, type: p.type, passage: p.id, difficulty: q.difficulty || p.difficulty, _file: `${level}/${f}`, _kind: "dokkai", _blank: i + 1 }));
    }
  }
  return { qs, passages };
}
// Every word in a level's lesson vocabulary tables (本课单词表): word and
// reading → the lesson it's taught in (the first one, if several).
function lessonVocab(level) {
  const dir = path.join(ROOT, "grammar", level), out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^(lesson\d+)_.*\.md$/);
    if (!m) continue;
    const md = fs.readFileSync(path.join(dir, f), "utf-8");
    const table = (md.split(/^## 本课单词表.*$/m)[1] || "").split(/^## /m)[0];
    for (const row of table.split("\n")) {
      const cells = row.split("|").map((c) => c.trim());
      if (cells.length < 4 || /^[-:]*$/.test(cells[1]) || cells[1] === "单词") continue;
      for (const w of [cells[1], cells[2]]) if (w && !out.has(w)) out.set(w, m[1]);
    }
  }
  return out;
}
// Practice questions of a level. A vocabulary question with no lesson ref
// gets one when the word it tests is in a lesson's vocabulary table, so
// "practise this lesson" includes it.
function loadLevel(level) {
  const data = loadDir(path.join(ROOT, "questions", level), level);
  const vocab = lessonVocab(level);
  for (const q of data.qs) {
    if (q._kind !== "moji-goi" || (q.refs || []).some((r) => /#vocab$/.test(r))) continue;
    const words = [...underlined(q.stem), q.options && q.options[q.answer]].filter(Boolean)
      .flatMap((w) => [w, w.replace(/ます$/, "る")]);   // 読みます → 読む isn't covered, but 来ます → 来る is
    const lesson = words.map((w) => vocab.get(w.trim())).find(Boolean);
    if (lesson) q.refs = [...(q.refs || []), `${lesson}#vocab`];
  }
  return data;
}
const mockSets = (level) => {
  const dir = path.join(ROOT, "questions", level);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^mock-\d+$/.test(f)).sort((a, b) => a.split("-")[1] - b.split("-")[1]) : [];
};

const isBi = (o) => o && typeof o.zh === "string" && o.zh.trim() && typeof o.en === "string" && o.en.trim();
const underlined = (s) => [...String(s).matchAll(/<<([^<>]+)>>/g)].map((m) => m[1]);

// `mock`: the set number when validating a mock test folder (its ids are
// n5-m1-001 for questions and n5-m1-p1 for passages).
function validate(level, { qs, passages }, points, mock) {
  const errors = [];
  const seen = new Set();
  const lv = level.toLowerCase();
  const m = mock ? `${lv}-m${mock}` : null;
  for (const p of passages) {
    const err = (msg) => errors.push(`${p._file} ${p.id || "(no id)"}: ${msg}`);
    if (m ? !new RegExp(`^${m}-p\\d+$`).test(p.id || "") : !new RegExp(`^${lv}-dk-\\d{3}$`).test(p.id || "")) err(`passage id must look like ${m ? m + "-p1" : lv + "-dk-001"}`);
    if (seen.has(p.id)) err("duplicate id");
    seen.add(p.id);
    if (!FILE_TYPES.dokkai.includes(p.type)) err(`unknown passage type "${p.type}"`);
    if (typeof p.passage !== "string" || !p.passage.trim()) err("missing passage");
    if (!isBi(p.tr)) err("tr (translation of the passage) needs zh and en");
    if (!Array.isArray(p.questions) || !p.questions.length) err("needs questions");
    if (p.type === "bunshou" && typeof p.passage === "string") {
      const blanks = [...p.passage.matchAll(/\[\[(\d+)\]\]/g)].map((m) => +m[1]);
      if (blanks.join() !== (p.questions || []).map((_, i) => i + 1).join()) err("bunshou blanks must be [[1]] [[2]] … in order, one per question");
    }
  }
  for (const q of qs) {
    const err = (msg) => errors.push(`${q._file} ${q.id || "(no id)"}: ${msg}`);
    if (m && q._kind !== "dokkai" && !new RegExp(`^${m}-\\d{3}$`).test(q.id || "")) err(`id must look like ${m}-001`);
    if (!m && q._kind === "lesson" && !new RegExp(`^${lv}-l\\d{2}-\\d{3}$`).test(q.id || "")) err(`id must look like ${lv}-l05-001`);
    if (!m && q._kind === "moji-goi" && !new RegExp(`^${lv}-mg-\\d{3}$`).test(q.id || "")) err(`id must look like ${lv}-mg-001`);
    if (seen.has(q.id)) err("duplicate id");
    seen.add(q.id);
    if (!FILE_TYPES[q._kind].includes(q.type)) err(`type "${q.type}" doesn't belong in this file`);
    if (!Array.isArray(q.options) || q.options.length !== 4) err("needs exactly 4 options");
    else if (new Set(q.options.map((o) => o.trim())).size !== 4) err("options must be distinct");
    if (![1, 2, 3].includes(q.difficulty)) err("difficulty must be 1, 2 or 3");
    if (!isBi(q.why)) err("why needs zh and en");
    if (!Array.isArray(q.wrong) || q.wrong.length !== 4) err("wrong needs 4 entries (null for the right option)");
    if ("okj" in q && (!Array.isArray(q.okj) || q.okj.length !== 4)) err("okj needs 4 entries (null where the option has no kanji form)");
    if ("kj" in q && (typeof q.kj !== "string" || !/[一-龯]/.test(q.kj))) err("kj must be the sentence written with kanji");
    const refs = q.refs || [];
    if (q._kind === "lesson" && !refs.length) err("needs at least one ref");
    for (const r of refs) {
      const m = String(r).match(/^(lesson\d+)#(\d+|vocab)$/);
      if (!m) err(`bad ref "${r}" (want lessonNN#K or lessonNN#vocab)`);
      else if (!points[m[1]] || !points[m[1]][m[2]]) err(`ref ${r} points at nothing`);
    }
    if (q._kind !== "dokkai" && !isBi(q.tr)) err("tr needs zh and en");
    if (q._kind === "lesson" && (typeof q.full !== "string" || !q.full.trim())) err("missing full sentence");
    if (q.type === "narabe") {
      const slots = [...String(q.stem).matchAll(SLOT)].map((m) => m[1]);
      if (slots.length !== 4 || slots.filter((s) => s === "★").length !== 1) err("narabe stem needs three [_] and one [★]");
      const o = q.order;
      if (!Array.isArray(o) || o.length !== 4 || [...o].sort().join() !== "0,1,2,3") err("order must be a permutation of 0–3");
      if ("answer" in q) err("narabe takes `order`, not `answer`");
      else if (Array.isArray(o) && o.length === 4 && typeof q.full === "string" && !q.full.replace(/\s/g, "").includes(o.map((i) => q.options[i]).join("").replace(/\s/g, ""))) err("options in `order` don't spell out a part of `full`");
      continue;
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) { err("answer must be 0–3"); continue; }
    if (Array.isArray(q.wrong)) q.wrong.forEach((w, i) => {
      if (i === q.answer && w !== null) err("wrong[answer] must be null");
      if (i !== q.answer && !isBi(w)) err(`wrong[${i}] needs zh and en`);
    });
    const stem = String(q.stem || "");
    if (["bunpou", "bunmyaku", "gokeisei"].includes(q.type) && (stem.match(/（　）/g) || []).length !== 1) err(`${q.type} stem needs exactly one （　）`);
    if (["kanji", "hyouki", "iikae", "youhou"].includes(q.type) && underlined(stem).length !== 1) err(`${q.type} stem needs exactly one <<underlined>> part`);
    if (q.type === "kanji" && Array.isArray(q.options) && q.options.some((o) => KANJI.test(o))) err("kanji options are readings — no kanji in them");
    if (q.type === "kanji" && underlined(stem).length === 1 && !KANJI.test(underlined(stem)[0])) err("kanji: the underlined word must contain kanji");
    if (q.type === "hyouki" && underlined(stem).length === 1 && KANJI.test(underlined(stem)[0])) err("hyouki: the underlined word must be kana");
    if (q._kind === "dokkai" && q.type !== "bunshou" && (typeof q.q !== "string" || !q.q.trim())) err("reading questions need `q`");
  }
  return errors;
}

// Authors tend to put the right option first, so the published order is a
// fixed shuffle seeded by the question id: the same on every build (saved
// answers keep pointing at the same option) and independent of the author.
function shuffled(q) {
  const h = require("crypto").createHash("sha1").update(q.id).digest();
  const p = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = h[i] % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  const at = (old) => p.indexOf(old);
  return {
    ...q,
    options: p.map((o) => q.options[o]),
    wrong: Array.isArray(q.wrong) && q.wrong.length === 4 ? p.map((o) => q.wrong[o]) : q.wrong,
    ...(Array.isArray(q.okj) ? { okj: p.map((o) => q.okj[o]) } : {}),
    ...(q.type === "narabe" ? { order: q.order.map(at) } : { answer: at(q.answer) }),
  };
}

// The ★ answer for narabe; the option index for everything else.
function answerOf(q) {
  if (q.type !== "narabe") return q.answer;
  const star = [...q.stem.matchAll(SLOT)].findIndex((m) => m[1] === "★");
  return q.order[star];
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Validated, furigana'd bundle for one level's practice questions, or for
// one of its mock tests (`mock` = set number). `ruby(text)` → HTML.
async function bundleLevel(level, ruby, mock) {
  let points = lessonPoints(level);
  const data = mock ? loadDir(path.join(ROOT, "questions", level, `mock-${mock}`), `${level}/mock-${mock}`) : loadLevel(level);
  const errors = validate(level, data, points, mock);
  if (errors.length) throw new Error(`Invalid questions:\n  ${errors.join("\n  ")}`);
  // The questions a lower level marks as this level's grammar (ABOVE_LEVEL)
  // are practice questions here too, as ordinary ones: same ids, so progress
  // is shared between the two pages.
  if (!mock) for (const from of Object.keys(ABOVE_LEVEL)) {
    const borrowed = loadLevel(from).qs.filter((q) => aboveLevel(from, q) === level);
    if (!borrowed.length) continue;
    points = { ...lessonPoints(from), ...points };
    data.qs.push(...borrowed);
  }
  // Furigana each run of text between markers (slots, blanks, underlines,
  // newlines, table bars), keeping the markers. <<…>> becomes <u>; a
  // vocabulary question gets no furigana at all.
  const MARK = /(\[(?:_|★)\]|\[\[\d+\]\]|（　）|\n|\||<<|>>)/;
  const render = async (text, withRuby) => {
    let html = "";
    for (const part of String(text).split(MARK)) {
      if (part === "<<") html += "<u>";
      else if (part === ">>") html += "</u>";
      else if (MARK.test(part) && part.match(MARK)[0] === part) html += part;
      else if (withRuby && WEEKDAYS.test(part.trim())) html += part.replace(/[月火水木金土日]/g, (k) => `<ruby>${k}<rp>(</rp><rt>${WEEKDAY_READING[k]}</rt><rp>)</rp></ruby>`);
      // A cell that starts with a weekday and a time (火 14:00〜15:00)
      else if (withRuby && /^\s*[月火水木金土日](?=\s*[0-9０-９])/.test(part)) html += part.replace(/^(\s*)([月火水木金土日])/, (m, sp, k) => `${sp}<ruby>${k}<rp>(</rp><rt>${WEEKDAY_READING[k]}</rt><rp>)</rp></ruby>`) .replace(/^(.*?<\/ruby>)([\s\S]*)$/, (m, a, rest) => a + rest);
      else html += withRuby ? await ruby(part) : esc(part);
    }
    if (withRuby === "above") html = dropBasicRuby(html);
    for (const [re, to] of QUIZ_RUBY_FIXES) html = html.replace(re, to);
    html = fixDays(html);
    return html;
  };
  const refsUsed = {}, lessons = {};
  const out = [];
  for (const q0 of data.qs) {
    const q = shuffled(q0);
    const withRuby = !NO_RUBY.has(q.type) && rubyMode(level);
    const fullRuby = !NO_RUBY.has(q.type);
    for (const r of q.refs || []) {
      const [lesson, k] = r.split("#");
      refsUsed[r] = { lesson, ...points[lesson][k] };
      if (q._kind === "lesson") lessons[lesson] = points[lesson].title;
    }
    // Readings come from the finished sentence. A stem cut off at the blank
    // (高（　）) or a deliberately misconjugated option (帰えます, 飲って) gives
    // kuromoji nothing to go on, so a kanji followed by kana or a blank takes
    // the reading the same kanji has in `full`, when that one is unambiguous.
    const full = q.full ? await render(q.full, fullRuby) : null;
    const readings = {};
    if (full && withRuby) for (const [, k, r] of full.matchAll(RUBY)) (readings[k] = readings[k] || new Set()).add(r);
    const fix = (html) => html.replace(/<ruby>([^<])<rp>\(<\/rp><rt>([^<]*)<\/rt><rp>\)<\/rp><\/ruby>(?=[ぁ-ゖ（\[])/g, (m, k, r) =>
      readings[k] && readings[k].size === 1 && !readings[k].has(r) ? `<ruby>${k}<rp>(</rp><rt>${[...readings[k]][0]}</rt><rp>)</rp></ruby>` : m);
    // An option that is a lone kanji (方) has no context at all either.
    const opt = async (o) => fix((await render(o, withRuby)).replace(/^(<ruby>[^<]<rp>\(<\/rp><rt>[^<]*<\/rt><rp>\)<\/rp><\/ruby>)$/, "$1（")).replace(/（$/, "");
    out.push({
      id: q.id, type: q.type, d: q.difficulty,
      ...(q.refs && q.refs.length ? { refs: q.refs } : {}),
      ...(q.passage ? { passage: q.passage, blank: q.type === "bunshou" ? q._blank : undefined } : {}),
      ...(q.stem ? { stem: fix(await render(q.stem, withRuby)) } : {}),
      ...(q.q ? { q: await render(q.q, rubyMode(level)) } : {}),
      options: await Promise.all(q.options.map(opt)),
      answer: answerOf(q),
      ...(q.type === "narabe" ? { order: q.order } : {}),
      ...(full ? { full } : {}),
      // N5/N4 write words above the level in kana, like the real test; after
      // answering, the sentence in kanji (with furigana) and each option's kanji.
      ...(q.kj ? { kj: await render(q.kj, true) } : {}),
      ...(q.okj && q.okj.some(Boolean) ? { okj: q.okj } : {}),
      ...((sa) => sa ? { sa } : {})(sentenceAudio(q)),
      ...(q.tr ? { tr: q.tr } : {}),
      why: q.why, wrong: q.wrong,
      rev: q.rev || 1,
      ...(!mock && aboveLevel(level, q) ? { pre: aboveLevel(level, q) } : {}),
    });
  }
  const passages = {};
  // Each passage's right answer per blank, for the read-aloud text.
  const blanks = {};
  for (const q of data.qs) if (q.type === "bunshou") (blanks[q.passage] = blanks[q.passage] || {})[q._blank] = q.options[q.answer];
  for (const p of data.passages) {
    const pr = rubyMode(level);
    const au = passageAudio(p, blanks[p.id] || {});
    passages[p.id] = { type: p.type, ...(p.intro ? { intro: await render(p.intro, pr) } : {}), html: await render(p.passage, pr), tr: p.tr, ...(p.kj ? { kj: await render(p.kj, true) } : {}), ...(au ? { au } : {}) };
  }
  const used = new Set(out.map((q) => q.type));
  const types = {};
  for (const k of Object.keys(TYPES)) if (used.has(k)) types[k] = TYPES[k];
  return { level, groups: GROUPS, types, lessons, refs: refsUsed, passages, questions: out };
}

// Read-aloud audio for a passage (played after its questions are answered):
// the text in kanji when there is a kanji version, blanks filled with the right
// answers, without table lines (信息检索 passages aren't read). The id hashes the
// text, like the lesson examples; build.js adds the request for build-audio.py,
// and the page gets the id only once audio/{id}.mp3 exists.
const AUDIO_REQUESTS = [];
function passageAudio(p, answers) {
  if (p.type === "info") return null;
  const text = String(p.kj || p.passage)
    .replace(/\[\[(\d+)\]\]/g, (m, n) => answers[n] || "")
    .split("\n").filter((l) => !/^\s*\|/.test(l)).join("\n")
    .replace(/<<|>>/g, "")
    .replace(/(?<=[^\x00-\x7f])[ \u3000]+(?=[^\x00-\x7f])/g, "")
    .replace(/\n{2,}/g, "\n").trim();
  if (!text) return null;
  const id = "p" + require("crypto").createHash("sha1").update(text).digest("hex").slice(0, 12);
  if (!AUDIO_REQUESTS.some((r) => r.id === id)) AUDIO_REQUESTS.push({ id, text });
  return fs.existsSync(path.join(ROOT, "audio", `${id}.mp3`)) ? id : null;
}

// Read-aloud audio for a question's finished sentence (🔊 after answering):
// the kanji version when there is one, else `full`; dialogue labels (A「…」)
// dropped. Not for reading questions (the passage has its own) or 用法 (four
// separate sentences).
function sentenceAudio(q) {
  if (q.passage || q.type === "youhou") return null;
  const text = String(q.kj || q.full || "")
    .replace(/<<|>>/g, "")
    // Stage directions （…で）, then speaker labels: 「…」 that ends a line or
    // is followed by a space is a turn (A「…」 / 受付「…」), not a quote (「…」と).
    .replace(/(^|\n)（[^）]*）/g, "$1")
    .replace(/(^|\s)[^\s「」。、]{1,6}[:：]?「([^「」]*)」(?=\s|$)/g, "$1$2\n")
    .replace(/[「」]/g, "")
    .replace(/(?<=[^\x00-\x7f])[ \u3000]+(?=[^\x00-\x7f])/g, "")
    .replace(/\n+/g, "\n").trim();
  if (!text || /（\s*）|＿/.test(text)) return null;
  const id = "q" + require("crypto").createHash("sha1").update(text).digest("hex").slice(0, 12);
  if (!AUDIO_REQUESTS.some((r) => r.id === id)) AUDIO_REQUESTS.push({ id, text });
  return fs.existsSync(path.join(ROOT, "audio", `${id}.mp3`)) ? id : null;
}

// A mock test: the questions without anything that gives the answer away,
// in test order and grouped into sittings and もんだい, plus a separate key
// (answers, explanations, translations) that the page loads after submitting.
async function bundleMock(level, ruby, n) {
  const b = await bundleLevel(level, ruby, n);
  const cfg = MOCK[level];
  const SECRET = ["answer", "order", "why", "wrong", "full", "tr", "kj", "okj", "sa"];
  const key = { questions: {}, passages: {} };
  const qs = b.questions.map((q) => {
    key.questions[q.id] = Object.fromEntries(SECRET.filter((k) => k in q).map((k) => [k, q[k]]));
    return Object.fromEntries(Object.entries(q).filter(([k]) => !SECRET.includes(k)));
  });
  for (const [id, p] of Object.entries(b.passages)) { key.passages[id] = { tr: p.tr, ...(p.kj ? { kj: p.kj } : {}), ...(p.au ? { au: p.au } : {}) }; delete p.tr; delete p.kj; delete p.au; }
  const sections = cfg.sections.map((s) => ({
    ...s,
    problems: s.types.map((t, i) => ({ no: i + 1, type: t, ids: qs.filter((q) => q.type === t).map((q) => q.id) })).filter((p) => p.ids.length),
  }));
  const order = sections.flatMap((s) => s.problems.flatMap((p) => p.ids));
  const missing = qs.filter((q) => !order.includes(q.id)).map((q) => q.id);
  if (missing.length) throw new Error(`mock-${n}: questions of a type the ${level} test doesn't have: ${missing.join(", ")}`);
  return {
    test: { level, n, id: `${level.toLowerCase()}-mock-${n}`, groups: b.groups, types: b.types, refs: b.refs, sections, scoring: cfg.scoring, listening: cfg.listening, pass: cfg.pass, passages: b.passages, questions: qs },
    key,
  };
}

// Every level that has questions → { N5: { practice, mocks: [{ test, key }] }, … }.
async function buildQuiz(ruby) {
  const out = {};
  for (const level of LEVELS) {
    if (!loadLevel(level).qs.length) continue;
    const mocks = [];
    if (MOCK[level]) for (const d of mockSets(level)) mocks.push(await bundleMock(level, ruby, +d.split("-")[1]));
    const practice = await bundleLevel(level, ruby);
    // For the analysis page: how the real test is scored and paced.
    if (MOCK[level]) {
      const cfg = MOCK[level];
      practice.exam = { scoring: cfg.scoring, listening: cfg.listening, pass: cfg.pass,
        minutes: cfg.sections.reduce((a, x) => a + x.minutes, 0), items: mocks.length ? mocks[0].test.questions.length : null };
    }
    out[level] = { practice, mocks };
  }
  return out;
}

// Test-taking cues, reported as warnings (2026-10-30 audit against the
// official samples): (1) per type, how often the right option is the one
// clearly longest (or clearly shortest) — a test-wise reader just picks it;
// chance is about 25%. (2) 並べ替え: ★ piling up in one slot. (3) mock
// questions and passages that are near copies of practice ones, so the mock
// score isn't inflated by having seen them.
const plainText = (s) => String(s || "").replace(/<[^>]+>|\[\[\d+\]\]|<<|>>|\s/g, "");
const bigrams = (s) => { const b = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); b.set(k, (b.get(k) || 0) + 1); } return b; };
function similarity(a, b) {
  const x = bigrams(a), y = bigrams(b);
  let common = 0;
  for (const [k, n] of x) common += Math.min(n, y.get(k) || 0);
  return (2 * common) / Math.max(1, a.length - 1 + b.length - 1);
}
const LONGEST_MAX = 0.4;   // warn above this share, given at least 8 questions of the type
const SIMILAR_MAX = 0.8;
function cues(practice, mocks) {
  const out = [];
  const longest = {}, stars = {};
  for (const [name, d] of [["practice", practice], ...mocks]) for (const q of d.qs) {
    const k = `${q.type}${name === "practice" ? "" : " (mock)"}`;
    if (q.type === "narabe") {
      const s = [...String(q.stem).matchAll(SLOT)].findIndex((m) => m[1] === "★");
      (stars[k] = stars[k] || [0, 0, 0, 0])[s]++;
      continue;
    }
    if (!Number.isInteger(q.answer) || !Array.isArray(q.options)) continue;
    const len = q.options.map((o) => plainText(o).length), top = Math.max(...len), low = Math.min(...len);
    const t = (longest[k] = longest[k] || [0, 0, 0]);
    t[2]++;
    if (len[q.answer] === top && len.filter((n) => n >= top * 0.9).length === 1) t[0]++;
    if (len[q.answer] === low && len.filter((n) => n <= low * 1.1).length === 1) t[1]++;
  }
  const pct = (n, all) => `${n}/${all} (${Math.round((100 * n) / all)}%)`;
  for (const [k, [n, m, all]] of Object.entries(longest)) {
    if (all >= 8 && n / all > LONGEST_MAX) out.push(`${k}: the right option is clearly the longest in ${pct(n, all)}`);
    if (all >= 8 && m / all > LONGEST_MAX) out.push(`${k}: the right option is clearly the shortest in ${pct(m, all)}`);
  }
  for (const [k, slots] of Object.entries(stars)) {
    const all = slots.reduce((a, b) => a + b, 0), top = Math.max(...slots);
    if (all >= 8 && top / all > LONGEST_MAX) out.push(`${k}: ★ is in slot ${slots.indexOf(top) + 1} in ${pct(top, all)}`);
  }
  const text = (q) => plainText(q.stem || q.full);
  const pool = practice.qs.map((q) => [q.id, text(q)]).filter(([, t]) => t.length >= 12)
    .concat(practice.passages.map((p) => [p.id, plainText(p.passage)]));
  for (const [name, d] of mocks) {
    const items = d.qs.filter((q) => q._kind !== "dokkai").map((q) => [q.id, text(q)]).filter(([, t]) => t.length >= 12)
      .concat(d.passages.map((p) => [p.id, plainText(p.passage)]));
    for (const [id, t] of items) {
      let best = [0, ""];
      for (const [pid, pt] of pool) {
        if (Math.abs(pt.length - t.length) > t.length / 2) continue;
        const s = similarity(t, pt);
        if (s > best[0]) best = [s, pid];
      }
      if (best[0] >= SIMILAR_MAX) out.push(`${name} ${id} is a near copy of practice ${best[1]} (${best[0].toFixed(2)})`);
    }
    // Vocabulary: the same tested word, or three of the same options, is the
    // same question even when the sentence differs (用法's stem is just the
    // word). Grammar items share forms legitimately; they're compared above.
    const target = (q) => plainText(underlined(q.stem)[0] || "");
    const opts = (q) => new Set((q.options || []).map(plainText));
    for (const q of d.qs.filter((x) => x._kind === "moji-goi")) {
      const twin = practice.qs.find((p) => p.type === q.type && (
        (target(q) && target(q) === target(p)) || [...opts(q)].filter((o) => opts(p).has(o)).length >= 3));
      if (twin && !out.some((w) => w.includes(` ${q.id} `))) out.push(`${name} ${q.id} tests the same as practice ${twin.id} (same word or options)`);
    }
  }
  return out;
}

module.exports = { buildQuiz, loadLevel, loadDir, shuffled, answerOf, LEVELS, TYPES, MOCK, QUIZ_PUBLIC, QUIZ_LINKS, AUDIO_REQUESTS, ABOVE_LEVEL, aboveLevel };

if (require.main === module) {
  let total = 0, bad = 0;
  for (const level of LEVELS) {
    const data = loadLevel(level);
    if (!data.qs.length) continue;
    const errors = validate(level, data, lessonPoints(level));
    total += data.qs.length;
    bad += errors.length;
    const byType = {};
    for (const q of data.qs) byType[q.type] = (byType[q.type] || 0) + 1;
    console.log(`${level}: ${data.qs.length} questions (${Object.entries(byType).map(([k, n]) => `${k} ${n}`).join(", ")})${errors.length ? `, ${errors.length} problems` : ", ok"}`);
    for (const e of errors) console.log("  " + e);
    const mocks = [];
    for (const d of mockSets(level)) {
      const md = loadDir(path.join(ROOT, "questions", level, d), `${level}/${d}`);
      const me = validate(level, md, lessonPoints(level), +d.split("-")[1]);
      bad += me.length;
      mocks.push([d, md]);
      console.log(`${level} ${d}: ${md.qs.length} questions${me.length ? `, ${me.length} problems` : ", ok"}`);
      for (const e of me) console.log("  " + e);
    }
    for (const w of cues(data, mocks)) console.log(`  warning: ${w}`);
  }
  if (!total) console.log("No questions yet.");
  process.exit(bad ? 1 : 0);
}
