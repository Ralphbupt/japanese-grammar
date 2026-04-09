const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Marked } = require("marked");
const KuroshiroMod = require("kuroshiro");
const Kuroshiro = KuroshiroMod.default || KuroshiroMod;
const KuromojiMod = require("kuroshiro-analyzer-kuromoji");
const KuromojiAnalyzer = KuromojiMod.default || KuromojiMod;

// ─── Config ───
const GRAMMAR_DIRS = [
  { dir: "grammar/N5", label: "N5" },
  { dir: "grammar/N4", label: "N4" },
  { dir: "grammar/N3", label: "N3" },
  { dir: "grammar/N2", label: "N2" },
];
const OUT = "dist/index.html";

// Japanese sidebar titles (keyed by file id)
const JA_TITLES = {
  N5_grammar_list: "N5 文法チェックリスト",
  N4_grammar_list: "N4 文法チェックリスト",
  N3_grammar_list: "N3 文法チェックリスト",
  N2_grammar_list: "N2 文法チェックリスト",
  day00: "五十音図（参考）",
  day01: "判断句・は/が・基礎助詞",
  day02: "核心助詞 — に・で・へ・と・から・まで",
  day03: "動詞分類とます形",
  day04: "て形（最重要な動詞活用）",
  day05: "て形応用 — ている・てください・てもいい",
  day06: "ない形と義務表現",
  day07: "た形・経験・列挙表現",
  day08: "形容詞活用と比較表現",
  day09: "条件表現 — と・ば",
  day10: "条件表現 — たら・なら",
  day11: "可能形と受身形",
  day12: "意向形と願望表現",
  day13: "推測 — でしょう・かもしれない・そうだ",
  day14: "様態 — ようだ・らしい・みたいだ・っぽい",
  day15: "N5補充文法 — ことができる・のだ・のに",
  day16: "N5補充文法＋総復習",
  day18: "使役形 — させる・させてあげる",
  day19: "受身形詳解・使役受身形",
  day20: "授受表現 — あげる/もらう/くれる",
  day21: "ように系列 — ようにする/ようになる",
  day22: "ことにする/ことになる/はずだ",
  day23: "ばかり/ところだ/てしまう",
  day24: "ておく/てある/て以来/にかけて",
  day25: "という/ということ/というより",
  day26: "わけだ/ものだ",
  day27: "N4文法総復習",
  day28: "〜ても/〜てほしい/〜ていく・てくる",
  day29: "〜すぎる/〜やすい・にくい/〜ことはない",
  day17: "N5補充文法② — がある・に行く・のが好き",
  day30: "引用・思考・比況 — と思う・かどうか・のように",
  day31: "時間と場面 — あいだ・までに・場合は",
  day32: "N3書面助詞 — において/に対して",
  day33: "書面助詞② — に関して/にとって/に基づいて",
  day34: "原因・理由 — おかげで/せいで/からには",
  day35: "逆接・譲歩① — にもかかわらず/くせに",
  day36: "逆接・譲歩② — ものの/とはいえ/どころか",
  day37: "程度・範囲① — ほど/さえ〜ば",
  day38: "程度・範囲② — ばかりか/に限らず",
  day39: "傾向・状態 — がちだ/つつある/一方だ",
  day40: "判断・推量 — に違いない/おそれがある",
  day41: "動作関連① — ようとする/ざるを得ない",
  day42: "動作関連② — きる/得る/っこない",
  day43: "並列・添加 — 上に/とともに/に伴い",
  day44: "話題・立場 — として/にしては/向け",
  day45: "時間 — たとたんに/次第/うちに/際に",
  day46: "状態・様態 — まま/だらけ/っぱなし",
  day47: "附加・対比 — 代わりに/たびに/て初めて",
  day48: "表現方式① — というより/といっても/とおり",
  day49: "表現方式② — こそ/ふりをする/ごとに",
  day50: "否定関連 — ずにはいられない/めったに〜ない",
  day51: "助言・複合① — たらいい/〜込む/〜合う",
  day52: "複合表現 — からこそ/とは限らない",
  day53: "常用文法① — べきだ/わけにはいかない",
  day54: "常用文法② — てたまらない/てならない",
  day55: "N3文法総復習",
  day56: "逆接 — からといって/つつも/にしろ",
  day57: "原因・理由 — あまり/ばこそ/だけに",
  day58: "程度・限定① — に過ぎない/にほかならない",
  day59: "程度・限定② — はもとより/のみならず",
  day60: "時間 — にあたって/に先立って/を機に",
  day61: "主張・判断① — わけがない/はずがない",
  day62: "主張・判断② — ということだ/ないものか",
  day63: "対比・関係 — に反して/一方で/につれて",
  day64: "話題・立場 — をめぐって/を問わず/に応じて",
  day65: "感情・不可抗 — てしょうがない/てはいられない",
  day66: "書面表現 — に沿って/を踏まえて/上で",
  day67: "仮定・条件 — ものなら/ことだ/に越したことはない",
  day68: "関係・結果 — あげくに/ところだった",
  day69: "強調・限定 — だけのことはある/まい",
  day70: "接続・転折 — それにしても/したがって",
  day71: "高頻出 — げ/抜く/次第/きり/ぶりに",
  day72: "N2文法総復習",
};

// SEO keywords per lesson (Japanese, Chinese, English)
const LESSON_KEYWORDS = {
  N5_grammar_list: "N5文法一覧, N5语法列表, JLPT N5 grammar list, checklist, 文法チェックリスト",
  N4_grammar_list: "N4文法一覧, N4语法列表, JLPT N4 grammar list, checklist, 文法チェックリスト",
  N3_grammar_list: "N3文法一覧, N3语法列表, JLPT N3 grammar list, checklist, 文法チェックリスト",
  N2_grammar_list: "N2文法一覧, N2语法列表, JLPT N2 grammar list, checklist, 文法チェックリスト",
  day00: "五十音図, 五十音图, hiragana, katakana, Japanese alphabet, 平仮名, 片仮名, 日语入门",
  day01: "です, は, が, 助詞, 基础句型, Japanese particles, desu, basic sentence patterns, JLPT N5",
  day02: "に, で, へ, と, から, まで, 助词详解, core particles, JLPT N5",
  day03: "ます形, 动词分类, masu form, verb groups, 一类动词, 二类动词, 三类动词, JLPT N5",
  day04: "て形, te form, verb conjugation, 音便, te form rules, 动词变形, JLPT N5",
  day05: "ている, てください, てもいい, てはいけない, て形応用, te form usage, JLPT N5",
  day06: "ない形, なければならない, なくてもいい, negative form, obligation, JLPT N5",
  day07: "た形, たことがある, たり, たばかり, ta form, experience, JLPT N5",
  day08: "い形容词, な形容词, より, 一番, adjective conjugation, comparison, JLPT N5",
  day09: "と, ば, 条件表現, conditional と, conditional ば, JLPT N5",
  day10: "たら, なら, 条件表現, conditional たら, conditional なら, JLPT N5",
  day11: "可能形, 受身形, potential form, passive form, られる, JLPT N5",
  day12: "意向形, つもり, 予定, たい, volitional form, intention, desire, JLPT N5",
  day13: "でしょう, かもしれない, そうだ, 推測, conjecture, hearsay, JLPT N5",
  day14: "ようだ, らしい, みたいだ, っぽい, 様態, appearance, seems like, JLPT N5",
  day15: "ことができる, のだ, のに, ので, N5補充, supplementary grammar, JLPT N5",
  day16: "N5文法, N5 grammar review, 総復習, すぎる, やすい, にくい, ながら, JLPT N5",
  day18: "使役形, させる, させてあげる, させてもらう, causative, JLPT N4",
  day19: "受身形, 使役受身形, させられる, passive, causative passive, JLPT N4",
  day20: "あげる, もらう, くれる, 授受表現, てあげる, てもらう, てくれる, giving receiving, JLPT N4",
  day21: "ようにする, ようになる, ように, ないようにする, so that, JLPT N4",
  day22: "ことにする, ことになる, はずだ, decide to, expected to, JLPT N4",
  day23: "ばかり, ところだ, てしまう, ちゃう, just did, about to, regret, JLPT N4",
  day24: "ておく, てある, て以来, にかけて, advance preparation, result state, JLPT N4",
  day25: "という, ということ, というより, といえば, called, means that, JLPT N4",
  day26: "わけだ, ものだ, わけがない, わけではない, ものだから, JLPT N4",
  day27: "N4文法, N4 grammar review, 総復習, JLPT N4 summary",
  day28: "ても, てほしい, ていく, てくる, がる, even if, want someone to, JLPT N4",
  day29: "すぎる, やすい, にくい, ことはない, 方, 出す, 始める, too much, easy to, JLPT N4",
  day17: "がある, がいる, に行く, のが好き, くらい, だけ, や, existence, JLPT N5",
  day30: "と思う, かどうか, のように, なさい, がする, 必要がある, I think, whether, JLPT N4",
  day31: "あいだ, までに, おきに, 場合は, たらどう, てよかった, during, by, in case, JLPT N4",
  day32: "において, に対して, について, によって, 書面助詞, formal particles, JLPT N3",
  day33: "に関して, にとって, に基づいて, にかけて, にわたって, 書面助詞, formal particles, JLPT N3",
  day34: "おかげで, せいで, ために, 以上は, からには, ことから, 原因理由, cause reason, JLPT N3",
  day35: "にもかかわらず, ながらも, くせに, としても, 逆接, 譲歩, concession, JLPT N3",
  day36: "にしても, ものの, とはいえ, どころか, 逆接, concession, nevertheless, JLPT N3",
  day37: "ほど, くらい, ば〜ほど, さえ〜ば, 程度, 範囲, degree extent, JLPT N3",
  day38: "だけ, しか〜ない, ばかりか, に限って, に限らず, 程度, 限定, only, not limited to, JLPT N3",
  day39: "がちだ, っぽい, 気味, つつある, 一方だ, かけ, 傾向, tendency, state, JLPT N3",
  day40: "に違いない, に決まっている, おそれがある, っけ, ものか, 判断, 推量, must be, JLPT N3",
  day41: "ようとする, ようがない, ざるを得ない, かねる, かねない, 動作, action, JLPT N3",
  day42: "きる, きれない, っこない, 得る, 得ない, 可能, possibility, completely, JLPT N3",
  day43: "上に, だけでなく, はもちろん, をはじめ, とともに, に伴い, 並列, addition, JLPT N3",
  day44: "として, にしては, 割に, 向け, 向き, 話題, 立場, as, considering, JLPT N3",
  day45: "たとたんに, 次第, うちに, 最中に, 際に, 時間, time, as soon as, JLPT N3",
  day46: "まま, だらけ, っぱなし, ずに, ように見える, 状態, 様態, state, appearance, JLPT N3",
  day47: "代わりに, ついでに, に比べて, によると, たびに, て初めて, 対比, comparison, JLPT N3",
  day48: "というより, といっても, というと, といえば, とおり, 表現, expression, rather than, JLPT N3",
  day49: "ふりをする, こそ, ことに, ごとに, 表現, emphasis, every, pretend, JLPT N3",
  day50: "ないことはない, ずにはいられない, そうもない, 決して〜ない, めったに〜ない, 否定, negation, JLPT N3",
  day51: "たらいい, ばいい, ばよかった, てごらん, 込む, 合う, 助言, advice, compound verb, JLPT N3",
  day52: "からこそ, ことは〜が, ことになっている, ような気がする, とは限らない, ところが, 複合, compound, JLPT N3",
  day53: "わけにはいかない, しかない, ことはない, べきだ, べきではない, ものだ, 義務, should, JLPT N3",
  day54: "ことか, てたまらない, てならない, てもかまわない, ことがある, 結果, feeling, JLPT N3",
  day55: "N3文法, N3 grammar review, 総復習, JLPT N3 summary",
  day56: "からといって, つつも, にしろ, にせよ, たところで, どころではない, 逆接, concession, JLPT N2",
  day57: "あまり, ばこそ, だけに, だけあって, ものだから, 原因, cause, precisely because, JLPT N2",
  day58: "に過ぎない, にほかならない, に限る, もかまわず, をものともせず, 程度, 限定, merely, JLPT N2",
  day59: "はもとより, のみならず, 程度, 限定, not only, let alone, JLPT N2",
  day60: "にあたって, に先立って, を機に, をきっかけに, 時間, occasion, prior to, JLPT N2",
  day61: "ないわけにはいかない, に相違ない, わけがない, はずがない, 主張, 判断, impossible, JLPT N2",
  day62: "ということだ, ないものか, としては, としても, 主張, 判断, it means, JLPT N2",
  day63: "に反して, 一方で, 反面, につれて, にしたがって, 対比, contrast, as, JLPT N2",
  day64: "にしても〜にしても, はともかく, をめぐって, を問わず, を中心に, に応じて, 話題, topic, JLPT N2",
  day65: "てしょうがない, てはいられない, ないことには, てからでないと, 感情, 不可抗, unbearable, JLPT N2",
  day66: "に沿って, を踏まえて, を除いて, に加えて, 上で, 末に, 書面, formal written, JLPT N2",
  day67: "ものなら, ようものなら, ことだ, に越したことはない, 仮定, 条件, if, best to, JLPT N2",
  day68: "にかけては, に当たらない, あげくに, ことなく, ずに済む, ところだった, 結果, result, JLPT N2",
  day69: "だけのことはある, だけは, だけまし, まい, 強調, 限定, worth, at least, JLPT N2",
  day70: "それにしても, それなのに, しかも, したがって, すなわち, 接続, 転折, however, therefore, JLPT N2",
  day71: "げ, 抜く, 次第だ, 次第で, きり, ぶりに, つき, 高頻出, suffix, JLPT N2",
  day72: "N2文法, N2 grammar review, 総復習, JLPT N2 summary",
};

// ─── Helpers ───
function gitLastMod(filePath) {
  try {
    const date = execSync(`git log -1 --format=%aI -- "${filePath}"`, { encoding: "utf-8" }).trim();
    return date ? date.slice(0, 10) : null;
  } catch { return null; }
}

function discoverFiles() {
  const groups = [];
  for (const { dir, label } of GRAMMAR_DIRS) {
    const abs = path.join(__dirname, dir);
    if (!fs.existsSync(abs)) continue;
    const files = fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) continue;
    groups.push({
      label,
      files: files.map((f) => ({
        id: f.replace(/\.md$/, "").replace(/^(day\d+).*/, "$1"),
        path: path.join(abs, f),
      })),
    });
  }
  return groups;
}

// Extract title from first heading
function extractTitle(md) {
  const m = md.match(/^#\s+(.+)/m);
  return m ? m[1].replace(/[#*]/g, "").trim() : "Untitled";
}

// ─── Furigana via kuroshiro ───
async function initKuroshiro() {
  const k = new Kuroshiro();
  await k.init(new KuromojiAnalyzer());
  return k;
}

// ─── Furigana via element-level tagging ───

// Simplified Chinese chars that never appear in Japanese text.
// Simplified Chinese characters not used in Japanese (JP has different kanji).
// Shared chars like 点画声断残温条礼 are NOT here.
const SC_CHARS = new Set(
  "词讲语调证试诉该详请谢议论识记设访许评读写书" +
  "买卖贵费资质购赢赶趣够辑辩辨边达远连运近" +
  "闪闭闻间阅队阳阶际陆险随难须频颜飘馆驾验骑" +
  "问题马头车东两关门见贝页鱼鸟齿风飞鞋韩" +
  "进发现实应虽选择认输环让错绝谓释练确义务" +
  "则规变对称赞类纯陈述简罗辑处叹做并" +
  "组粗细网终编继续绍纷绕缘缺缩织" +
  "当将独获奖妆庄严丧" +
  "从给过还这没为着到被说" +
  "们它哪怎谁的了吗呢吧啊哦嘛呀嗯啦么" +
  "举护坏态惯样欢决热经结据动听观传师预报转" +
  "离单复图场园约计长换历准办银铁镇脑较亲价" +
  "强录厅婴宽异弯张扬杂笔脸构标松灭虑综级" +
  "岁属带怀戏执担坚叶杀产仅优储兰创势华币" +
  "响团块奋妇宁宝宪审岛帐广庆径恼悬惊愿战" +
  "扩拟拥拨择损摇撑权枪"
);

function hasSC(text) {
  for (const ch of text) {
    if (SC_CHARS.has(ch)) return true;
  }
  return false;
}

// Tag block elements as data-ja if their content (outside parens) is Japanese.
// Japanese = has kana + no SC chars (after removing parenthetical Chinese).
function tagElements(html) {
  // Match block elements: li, p, td, th, blockquote, summary, dt, dd
  return html.replace(
    /(<(li|p|td|th|blockquote|summary|dt|dd)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (match, openTag, tagName, content, closeTag) => {
      // Extract plain text, stripping HTML tags
      const plain = content.replace(/<[^>]+>/g, "");
      // Remove text inside （…） for language detection
      const outsideParens = plain.replace(/（[^）]*）/g, "");
      const hasKana = /[\u3040-\u309f\u30a0-\u30ff]/.test(outsideParens);
      const hasSimplifiedChinese = hasSC(outsideParens);

      if (hasKana && !hasSimplifiedChinese) {
        // Japanese element → tag it
        const tagged = openTag.replace(/^<(\w+)/, '<$1 data-ja');
        return tagged + content + closeTag;
      }
      return match;
    }
  );
}

// Core: add furigana to a text node via kuroshiro
async function furiganaText(kuro, text) {
  if (!/[\u4e00-\u9faf\u3400-\u4dbf]/.test(text)) return text;
  try {
    return await kuro.convert(text, { to: "hiragana", mode: "furigana" });
  } catch {
    return text;
  }
}

// Strip ruby from Chinese text inside full-width parens （…）
function stripParensChinese(html) {
  return html.replace(/（([\s\S]*?)）/g, (match, inner) => {
    const stripped = inner.replace(
      /<ruby>([\u4e00-\u9fff]+)<rp>\(<\/rp><rt>[^<]*<\/rt><rp>\)<\/rp><\/ruby>/g,
      "$1"
    );
    return "（" + stripped + "）";
  });
}

// Process HTML:
//  1. Tag elements as data-ja (Japanese) based on content analysis
//  2. Add furigana only inside data-ja elements
//  3. Strip ruby from parenthetical Chinese
async function addFurigana(kuro, html) {
  // Step 1: tag elements
  html = tagElements(html);

  // Step 2: add furigana only inside data-ja elements
  const parts = html.split(/(<[^>]+>)/);
  const result = [];
  let jaDepth = 0;    // > 0 = inside a data-ja element
  let skipDepth = 0;  // > 0 = inside code/pre/rt/word-table/heading

  // Pre-scan: for td/th cells that contain <strong>, collect their content
  // so we can process them as a whole unit (strip bold → furigana → re-bold).
  // Maps cell-open index → { endIdx, plainText }
  const strongCells = new Map();
  for (let i = 0; i < parts.length; i++) {
    if (/^<(td|th)\b/i.test(parts[i])) {
      let hasStrong = false;
      let endIdx = -1;
      for (let j = i + 1; j < parts.length; j++) {
        if (/^<\/(td|th)>/i.test(parts[j])) { endIdx = j; break; }
        if (/^<strong\b/i.test(parts[j])) hasStrong = true;
      }
      if (hasStrong && endIdx > 0) {
        // Extract plain text (strip all tags)
        let plain = "";
        for (let j = i + 1; j < endIdx; j++) {
          if (!/^</.test(parts[j])) plain += parts[j];
        }
        strongCells.set(i, { endIdx, plainText: plain });
      }
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Skip zones
    if (/^<(code|pre|rt|h[1-6])\b/i.test(part)) {
      skipDepth++; result.push(part);
    } else if (/^<\/(code|pre|rt|h[1-6])>/i.test(part)) {
      skipDepth--; result.push(part);
    } else if (/^<table\b[^>]*class="word-table"/i.test(part)) {
      skipDepth++; result.push(part);
    } else if (skipDepth > 0 && /^<\/table>/i.test(part)) {
      skipDepth--; result.push(part);
    }
    // data-ja td/th with <strong>: process whole cell as one unit
    else if (/\bdata-ja\b/.test(part) && /^<(td|th)\b/i.test(part) && strongCells.has(i)) {
      const cell = strongCells.get(i);
      // Get furigana for the plain text (without bold tags breaking words)
      const furiganaHtml = await furiganaText(kuro, cell.plainText);
      // Now re-apply <strong> by matching bold ranges from original parts
      // Collect which character ranges were bold
      let charIdx = 0;
      let inBold = false;
      const boldChars = new Set();
      for (let j = i + 1; j < cell.endIdx; j++) {
        if (/^<strong\b/i.test(parts[j])) { inBold = true; continue; }
        if (/^<\/strong>/i.test(parts[j])) { inBold = false; continue; }
        if (/^</.test(parts[j])) continue;
        // text node
        for (const ch of parts[j]) {
          if (inBold) boldChars.add(charIdx);
          charIdx++;
        }
      }
      // Walk through furigana HTML and wrap bold characters with <strong>
      // Characters inside <ruby>...<rt>...</rt></ruby> need careful handling
      let finalHtml = "";
      let srcIdx = 0;
      let fi = 0;
      while (fi < furiganaHtml.length) {
        // Check for ruby tag
        const rubyMatch = furiganaHtml.slice(fi).match(/^<ruby>([\s\S]*?)<rp>\(<\/rp><rt>([\s\S]*?)<\/rt><rp>\)<\/rp><\/ruby>/);
        if (rubyMatch) {
          const kanji = rubyMatch[1];
          const reading = rubyMatch[2];
          // Check if any char in this kanji range is bold
          let anyBold = false;
          for (let k = 0; k < kanji.length; k++) {
            if (boldChars.has(srcIdx + k)) anyBold = true;
          }
          if (anyBold) {
            finalHtml += `<strong><ruby>${kanji}<rp>(</rp><rt>${reading}</rt><rp>)</rp></ruby></strong>`;
          } else {
            finalHtml += rubyMatch[0];
          }
          srcIdx += kanji.length;
          fi += rubyMatch[0].length;
        } else if (furiganaHtml[fi] === "<") {
          // Some other tag, pass through
          const tagEnd = furiganaHtml.indexOf(">", fi);
          finalHtml += furiganaHtml.slice(fi, tagEnd + 1);
          fi = tagEnd + 1;
        } else {
          // Plain character
          if (boldChars.has(srcIdx)) {
            // Collect consecutive bold chars
            let boldRun = "";
            while (fi < furiganaHtml.length && furiganaHtml[fi] !== "<" && boldChars.has(srcIdx)) {
              boldRun += furiganaHtml[fi];
              srcIdx++; fi++;
            }
            finalHtml += `<strong>${boldRun}</strong>`;
          } else {
            finalHtml += furiganaHtml[fi];
            srcIdx++; fi++;
          }
        }
      }
      result.push(part);  // opening <td>
      result.push(finalHtml);
      // Skip all original parts inside this cell
      i = cell.endIdx;    // will be the </td>
      result.push(parts[i]);
    }
    // data-ja zones (non-strong td/th and other elements)
    else if (/\bdata-ja\b/.test(part) && /^<(li|p|td|th|blockquote|summary|dt|dd)\b/i.test(part)) {
      jaDepth++; result.push(part);
    } else if (jaDepth > 0 && /^<\/(li|p|td|th|blockquote|summary|dt|dd)>/i.test(part)) {
      jaDepth--; result.push(part);
    }
    // Other tags
    else if (/^</.test(part)) {
      result.push(part);
    }
    // Text nodes
    else if (skipDepth > 0) {
      result.push(part);
    } else if (jaDepth > 0 && /[\u4e00-\u9faf\u3400-\u4dbf]/.test(part)) {
      result.push(await furiganaText(kuro, part));
    } else {
      result.push(part);
    }
  }

  // Step 3: strip ruby from parenthetical Chinese
  return stripParensChinese(result.join(""));
}

// ─── Build ───
async function main() {
  console.log("Initializing kuroshiro...");
  const kuro = await initKuroshiro();
  console.log("Kuroshiro ready.");

  const groups = discoverFiles();
  const marked = new Marked({ gfm: true, breaks: false });

  const sidebarHtml = [];
  const articlesHtml = [];
  const lessonPages = []; // for individual page generation
  let firstId = null;

  for (const group of groups) {
    sidebarHtml.push(`<div class="nav-group">${group.label}</div>`);
    for (const file of group.files) {
      const md = fs.readFileSync(file.path, "utf-8");
      const title = extractTitle(md);
      const shortTitle = title.length > 40 ? title.slice(0, 38) + "…" : title;
      if (!firstId) firstId = file.id;

      // Pre-process bilingual blocks: :::zh ... ::: / :::en ... :::
      // Use HTML comments to avoid markdown parser issues, then replace after parsing
      const bilingualMd = md.replace(
        /^:::(zh|en)\s*\n([\s\S]*?)^:::\s*$/gm,
        (_, lang, content) => `<!--lang:${lang}:start-->\n${content.trim()}\n<!--lang:${lang}:end-->`
      );

      // Parse markdown to HTML
      let html = await marked.parse(bilingualMd);

      // Convert language markers to divs
      html = html.replace(/<!--lang:(zh|en):start-->/g, '<div class="lang-$1">');
      html = html.replace(/<!--lang:(zh|en):end-->/g, '</div>');

      // Bilingual headings: <h2>中文||English</h2>
      html = html.replace(
        /(<h[1-6][^>]*>)(.+?)\|\|(.+?)(<\/h[1-6]>)/g,
        (_, open, zh, en, close) =>
          `${open}<span class="lang-zh">${zh.trim()}</span><span class="lang-en">${en.trim()}</span>${close}`
      );

      // Bilingual table cells: <td>中文//English</td>
      html = html.replace(
        /(<td[^>]*>)([^<]*?)\/\/([^<]*?)(<\/td>)/g,
        (_, open, zh, en, close) =>
          `${open}<span class="lang-zh">${zh.trim()}</span><span class="lang-en">${en.trim()}</span>${close}`
      );

      // Add class to word tables (tables whose first row has 单词)
      html = html.replace(
        /(<table>[\s\S]*?<th>单词<\/th>[\s\S]*?<\/table>)/g,
        (match) => match.replace("<table>", '<table class="word-table">')
      );

      // Enable checklist checkboxes (remove disabled, add data attributes)
      let checkIdx = 0;
      html = html.replace(
        /<input (checked="" )?disabled="" type="checkbox">/g,
        (match, checked) => {
          const idx = checkIdx++;
          return `<input type="checkbox" data-lesson="${file.id}" data-idx="${idx}"${checked ? ' checked' : ''}>`;
        }
      );

      // Add furigana (kana-based detection)
      console.log(`  Processing ${file.id}...`);
      html = await addFurigana(kuro, html);

      const dayMatch = file.id.match(/^day(\d+)/);
      const dayNum = dayMatch ? dayMatch[1] : "";
      const jaTitle = JA_TITLES[file.id];
      const sidebarTitle = jaTitle
        ? (dayNum ? `Day ${dayNum} – ${jaTitle}` : jaTitle)
        : shortTitle;
      sidebarHtml.push(
        `<a class="nav-item" href="#${file.id}" data-target="${file.id}">${sidebarTitle}</a>`
      );
      articlesHtml.push(
        `<article id="${file.id}" class="lesson">${html}</article>`
      );
      lessonPages.push({ id: file.id, title, sidebarTitle, html, jaTitle: jaTitle || shortTitle, filePath: file.path });
    }
  }

  // ─── Assemble ───
  const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Japanese Grammar Notes | 日语语法笔记 – N5→N2 in 8 Weeks</title>
<meta name="description" content="Free structured Japanese grammar notes from N5 to N2 in 8 weeks. Bilingual (Japanese + Chinese) with conjugation rules, example sentences, and spaced repetition.">
<meta name="keywords" content="Japanese grammar, JLPT N2, N5, N4, N3, 日语语法, 日本語文法, grammar notes, spaced repetition, 语法笔记">
<link rel="canonical" href="https://ralphbupt.github.io/japanese-grammar/">
<link rel="alternate" hreflang="ja" href="https://ralphbupt.github.io/japanese-grammar/">
<link rel="alternate" hreflang="zh" href="https://ralphbupt.github.io/japanese-grammar/">
<link rel="alternate" hreflang="x-default" href="https://ralphbupt.github.io/japanese-grammar/">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="Japanese Grammar Notes | 日语语法笔记 – N5→N2">
<meta property="og:description" content="Free structured Japanese grammar notes from N5 to N2 in 8 weeks. Bilingual with examples and spaced repetition.">
<meta property="og:url" content="https://ralphbupt.github.io/japanese-grammar/">
<meta property="og:image" content="https://ralphbupt.github.io/japanese-grammar/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ja_JP">
<meta property="og:locale:alternate" content="zh_CN">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Japanese Grammar Notes | 日语语法笔记 – N5→N2">
<meta name="twitter:description" content="Free structured Japanese grammar notes from N5 to N2 in 8 weeks.">
<meta name="twitter:image" content="https://ralphbupt.github.io/japanese-grammar/og-image.png">

<!-- Structured Data -->
<meta http-equiv="Content-Language" content="ja, zh-CN">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "Course",
  "name": "Japanese Grammar Notes – N5 to N2",
  "description": "Free structured Japanese grammar notes covering JLPT N5 to N2 in 8 weeks, with bilingual explanations, example sentences, and spaced repetition.",
  "provider": { "@type": "Person", "name": "Ralphbupt" },
  "inLanguage": ["ja", "zh-CN"],
  "educationalLevel": "Beginner to Intermediate",
  "about": { "@type": "Thing", "name": "Japanese Language Grammar" },
  "isAccessibleForFree": true,
  "image": "https://ralphbupt.github.io/japanese-grammar/og-image.png",
  "url": "https://ralphbupt.github.io/japanese-grammar/",
  "hasCourseInstance": {
    "@type": "CourseInstance",
    "courseMode": "online",
    "courseWorkload": "P8W"
  },
  "numberOfLessons": ${lessonPages.length}
},
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "日语语法笔记 – Japanese Grammar Notes",
  "url": "https://ralphbupt.github.io/japanese-grammar/",
  "inLanguage": ["ja", "zh-CN"]
}]
</script>

<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>文</text></svg>">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#1a1a2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="日语文法">

<script async src="https://www.googletagmanager.com/gtag/js?id=G-D1KNQTFN1R"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-D1KNQTFN1R');</script>
<style>
${CSS}
</style>
</head>
<body class="sidebar-collapsed">
<button id="menu-toggle" aria-label="Toggle menu">☰</button>
<nav id="sidebar" class="collapsed">
  <div class="nav-scroll">
  <div class="nav-header">日语语法笔记</div>
  ${sidebarHtml.join("\n  ")}
  </div>
  <div class="nav-footer">
    <a href="https://github.com/Ralphbupt" target="_blank">GitHub</a>
  </div>
</nav>
<main id="content">
  ${articlesHtml.join("\n  ")}
  <div id="disqus_thread"></div>
</main>
<nav id="toc-panel"></nav>
<div id="bottom-controls">
  <div id="settings-toggle">
    <button id="settings-btn">⚙</button>
  </div>
  <div id="furigana-toggle">
    <label><input type="checkbox" id="ruby-toggle" checked> 显示读音</label>
  </div>
  <div id="lang-toggle">
    <button id="lang-btn">EN</button>
  </div>
</div>
<div id="settings-overlay" class="hidden">
  <div id="settings-panel">
    <div class="settings-header">
      <span>设置</span>
      <button id="settings-close">✕</button>
    </div>
    <div class="settings-body">
      <label class="settings-label">学习开始日期</label>
      <input type="date" id="start-date-input">
      <p class="settings-hint">设置你的学习起始日，侧栏将显示对应的日期</p>
    </div>
  </div>
</div>
<script>
${JS}
</script>
<script>
var disqus_config = function () {
  this.page.url = 'https://ralphbupt.github.io/japanese-grammar/';
  this.page.identifier = 'japanese-grammar-main';
};
(function() {
  var d = document, s = d.createElement('script');
  s.src = 'https://japanese-4.disqus.com/embed.js';
  s.setAttribute('data-timestamp', +new Date());
  (d.head || d.body).appendChild(s);
})();
</script>
</body>
</html>`;

  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, OUT), fullHtml, "utf-8");

  const SITE = "https://ralphbupt.github.io/japanese-grammar/";
  const today = new Date().toISOString().slice(0, 10);

  // ─── Generate individual lesson pages ───
  for (let li = 0; li < lessonPages.length; li++) {
    const lesson = lessonPages[li];
    const prevLesson = li > 0 ? lessonPages[li - 1] : null;
    const nextLesson = li < lessonPages.length - 1 ? lessonPages[li + 1] : null;
    const lessonDir = path.join(__dirname, "dist", lesson.id);
    fs.mkdirSync(lessonDir, { recursive: true });
    const lessonUrl = `${SITE}${lesson.id}/`;
    const lessonTitle = `${lesson.jaTitle} | Japanese Grammar Notes`;
    const lessonDesc = `${lesson.title} – Free Japanese grammar lesson with conjugation rules, example sentences, and practice exercises.`;
    const ogImageUrl = `${SITE}og-image.png`;

    // Prev/next navigation HTML
    const prevHtml = prevLesson
      ? `<a class="pn-link pn-prev" href="${SITE}${prevLesson.id}/">← ${prevLesson.jaTitle}</a>`
      : `<span class="pn-link pn-prev"></span>`;
    const nextHtml = nextLesson
      ? `<a class="pn-link pn-next" href="${SITE}${nextLesson.id}/">${nextLesson.jaTitle} →</a>`
      : `<span class="pn-link pn-next"></span>`;

    const lessonHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${lessonTitle}</title>
<meta name="description" content="${lessonDesc.replace(/"/g, '&quot;')}">
<meta name="keywords" content="${LESSON_KEYWORDS[lesson.id] || ''}">
<link rel="canonical" href="${lessonUrl}">
<link rel="alternate" hreflang="ja" href="${lessonUrl}">
<link rel="alternate" hreflang="zh" href="${lessonUrl}">
<link rel="alternate" hreflang="x-default" href="${lessonUrl}">
<meta property="og:type" content="article">
<meta property="og:title" content="${lessonTitle}">
<meta property="og:description" content="${lessonDesc.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${lessonUrl}">
<meta property="og:image" content="${ogImageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ja_JP">
<meta property="og:locale:alternate" content="zh_CN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${lessonTitle}">
<meta name="twitter:image" content="${ogImageUrl}">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "Article",
  "name": "${lesson.jaTitle.replace(/"/g, '\\"')}",
  "headline": "${lesson.jaTitle.replace(/"/g, '\\"')}",
  "description": "${lessonDesc.replace(/"/g, '\\"')}",
  "inLanguage": ["ja", "zh-CN"],
  "isAccessibleForFree": true,
  "url": "${lessonUrl}",
  "image": "${ogImageUrl}",
  "author": { "@type": "Person", "name": "Ralphbupt" },
  "isPartOf": { "@type": "Course", "name": "Japanese Grammar Notes – N5 to N2", "url": "${SITE}" }
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "日语语法笔记", "item": "${SITE}" },
    { "@type": "ListItem", "position": 2, "name": "${lesson.jaTitle.replace(/"/g, '\\"')}", "item": "${lessonUrl}" }
  ]
}]
</script>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>文</text></svg>">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-D1KNQTFN1R"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-D1KNQTFN1R');</script>
<style>
${CSS}
#sidebar, #menu-toggle, #toc-panel, #settings-toggle, #settings-overlay { display: none !important; }
#content { margin-left: 0 !important; margin-right: 0 !important; max-width: 800px; margin: 0 auto; }
.back-link { display: block; margin-bottom: 1.5rem; color: var(--accent); text-decoration: none; font-size: 0.9rem; }
.back-link:hover { text-decoration: underline; }
.breadcrumb { font-size: 0.85rem; color: #888; margin-bottom: 0.5rem; }
.breadcrumb a { color: var(--accent); text-decoration: none; }
.breadcrumb a:hover { text-decoration: underline; }
.breadcrumb .sep { margin: 0 0.4em; }
.prev-next { display: flex; justify-content: space-between; align-items: flex-start; margin: 2.5rem 0 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); gap: 1rem; }
.pn-link { font-size: 0.9rem; color: var(--accent); text-decoration: none; max-width: 48%; }
.pn-link:hover { text-decoration: underline; }
.pn-prev { text-align: left; }
.pn-next { text-align: right; margin-left: auto; }
</style>
</head>
<body>
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}">日语语法笔记</a><span class="sep">›</span><span>${lesson.jaTitle}</span>
  </nav>
  <a class="back-link" href="${SITE}">← All Lessons / 返回目录</a>
  <article class="lesson active">${lesson.html}</article>
  <nav class="prev-next" aria-label="lesson navigation">
    ${prevHtml}
    ${nextHtml}
  </nav>
  <div id="disqus_thread"></div>
</main>
<div id="bottom-controls">
  <div id="furigana-toggle">
    <label><input type="checkbox" id="ruby-toggle" checked> 显示读音</label>
  </div>
  <div id="lang-toggle">
    <button id="lang-btn">EN</button>
  </div>
</div>
<script>
(function(){
  var rubyToggle = document.getElementById('ruby-toggle');
  var langBtn = document.getElementById('lang-btn');
  var STORE_KEY = 'jp_grammar_prefs';
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) { return {}; } }
  function savePrefs(patch) { var p = loadPrefs(); for (var k in patch) p[k] = patch[k]; localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
  var prefs = loadPrefs();
  if (prefs.hideRuby) { rubyToggle.checked = false; document.body.classList.add('hide-ruby'); }
  var isEn = ('isEn' in prefs) ? prefs.isEn : !/^zh/i.test(navigator.language || '');
  if (isEn) { document.body.classList.add('lang-en'); langBtn.textContent = '中'; }
  rubyToggle.addEventListener('change', function(){ var hide = !this.checked; document.body.classList.toggle('hide-ruby', hide); savePrefs({ hideRuby: hide }); });
  langBtn.addEventListener('click', function(){ isEn = !isEn; document.body.classList.toggle('lang-en', isEn); langBtn.textContent = isEn ? '中' : 'EN'; savePrefs({ isEn: isEn }); });
})();
</script>
<script>
var disqus_config = function () {
  this.page.url = '${lessonUrl}';
  this.page.identifier = '${lesson.id}';
};
(function() {
  var d = document, s = d.createElement('script');
  s.src = 'https://japanese-4.disqus.com/embed.js';
  s.setAttribute('data-timestamp', +new Date());
  (d.head || d.body).appendChild(s);
})();
</script>
</body>
</html>`;

    fs.writeFileSync(path.join(lessonDir, "index.html"), lessonHtml, "utf-8");
  }

  // ─── Sitemap ───
  const homeMod = gitLastMod("schedule.md") || today;
  const sitemapUrls = [`  <url>
    <loc>${SITE}</loc>
    <lastmod>${homeMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`];
  for (const lesson of lessonPages) {
    const mod = gitLastMod(lesson.filePath) || today;
    sitemapUrls.push(`  <url>
    <loc>${SITE}${lesson.id}/</loc>
    <lastmod>${mod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`);
  }
  fs.writeFileSync(path.join(__dirname, "dist/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.join("\n")}
</urlset>
`, "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/robots.txt"), `User-agent: *
Allow: /

Sitemap: ${SITE}sitemap.xml
`, "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/llms.txt"), `# Japanese Grammar Notes

> Free, structured Japanese grammar notes covering JLPT N5 to N2 in 8 weeks.
> Bilingual: Japanese + Chinese. Includes conjugation rules, 3+ example sentences per grammar point, comparison with similar grammar, and spaced repetition tracking.

## URL
https://ralphbupt.github.io/japanese-grammar/

## Content Overview
- Week 1-2: N5 grammar (basic sentence patterns, verb conjugation, て form, ない form, た form, adjectives, conditionals, potential/passive/volitional, conjecture)
- Week 3-4: N4 grammar (causative, giving/receiving, ように, ことにする/なる, ばかり/ところ/てしまう, passive details, わけだ/ものだ)
- Week 5-6: N3 grammar (in progress)
- Week 7-8: N2 grammar (in progress)

## Format
Single-page static site. Each grammar point includes:
- Conjugation rules (接続)
- Example sentences (例句)
- Comparison with similar grammar (辨析)
- Practice exercises
- Spaced repetition checklist

## License
CC BY 4.0
`, "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/manifest.json"), JSON.stringify({
    name: "日语语法笔记 – N5→N2",
    short_name: "日语文法",
    start_url: "/japanese-grammar/",
    scope: "/japanese-grammar/",
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#1a1a2e",
    icons: [
      { src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>文</text></svg>", sizes: "any", type: "image/svg+xml" }
    ]
  }, null, 2), "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/404.html"), `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 – 日语语法笔记</title>
<style>
  body { font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #fafaf8; color: #333; }
  .box { text-align: center; }
  h1 { font-size: 4rem; margin: 0; }
  p { font-size: 1.2rem; margin: 1rem 0; }
  a { color: #e94560; text-decoration: none; }
</style>
</head>
<body>
<div class="box">
  <h1>404</h1>
  <p>ページが見つかりません</p>
  <a href="/japanese-grammar/">← ホームに戻る</a>
</div>
</body>
</html>`, "utf-8");

  // ─── OG Image (SVG) ───
  // Social platforms prefer PNG, but SVG works as fallback.
  // To generate a proper PNG: open dist/og-image.html in a browser and screenshot at 1200x630,
  // or use: npx capture-website-cli dist/og-image.html --output dist/og-image.png --width 1200 --height 630
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="#e94560" stroke-width="2" opacity="0.3"/>
  <text x="600" y="220" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="96" fill="#ffffff" font-weight="bold">日语语法笔记</text>
  <text x="600" y="320" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="42" fill="#c8c8d8">Japanese Grammar Notes</text>
  <text x="600" y="400" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="36" fill="#e94560">N5 → N4 → N3 → N2</text>
  <text x="600" y="470" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#888888">Free · Bilingual · 8 Weeks · Spaced Repetition</text>
  <text x="600" y="550" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666666">ralphbupt.github.io/japanese-grammar</text>
</svg>`;
  fs.writeFileSync(path.join(__dirname, "dist/og-image.svg"), ogSvg, "utf-8");

  // Also generate an HTML version for easy PNG conversion
  const ogHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; }
body { width: 1200px; height: 630px; background: linear-gradient(135deg, #1a1a2e, #16213e); display: flex; align-items: center; justify-content: center; font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; }
.card { width: 1120px; height: 550px; border: 2px solid rgba(233,69,96,0.3); border-radius: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; }
h1 { font-size: 96px; color: #fff; font-weight: bold; }
h2 { font-size: 42px; color: #c8c8d8; font-weight: normal; }
.levels { font-size: 36px; color: #e94560; }
.tagline { font-size: 24px; color: #888; }
.url { font-size: 20px; color: #666; }
</style></head>
<body><div class="card">
<h1>日语语法笔记</h1>
<h2>Japanese Grammar Notes</h2>
<div class="levels">N5 → N4 → N3 → N2</div>
<div class="tagline">Free · Bilingual · 8 Weeks · Spaced Repetition</div>
<div class="url">ralphbupt.github.io/japanese-grammar</div>
</div></body></html>`;
  fs.writeFileSync(path.join(__dirname, "dist/og-image.html"), ogHtml, "utf-8");

  console.log(`Done! Output: ${OUT}, sitemap.xml, robots.txt, llms.txt, manifest.json, 404.html, og-image.svg/html`);
  console.log(`NOTE: Convert og-image to PNG for best social sharing support:`);
  console.log(`  npx capture-website-cli dist/og-image.html --output dist/og-image.png --width 1200 --height 630`);
}

// ─── CSS ───
const CSS = `
:root {
  --sidebar-w: 230px;
  --bg: #fafaf8;
  --sidebar-bg: #1a1a2e;
  --sidebar-text: #c8c8d8;
  --accent: #e94560;
  --card-bg: #fff;
  --border: #e2e2e2;
  --ruby-color: #e94560;
  --word-bg: #fffbe6;
  --word-border: #f5c842;
  --code-bg: #f4f4f4;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 18px; }
body {
  font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", "PingFang SC", sans-serif;
  background: var(--bg);
  color: #2d2d2d;
  line-height: 1.9;
}

/* Sidebar */
#sidebar {
  position: fixed; top: 0; left: 0; bottom: 0;
  width: var(--sidebar-w);
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  overflow: hidden;
  display: flex; flex-direction: column;
  z-index: 100;
  transition: width .25s, transform .25s;
}
#sidebar .nav-scroll {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 1rem 0;
}
#sidebar.collapsed {
  width: 48px;
  overflow: hidden;
}
#sidebar.collapsed:hover {
  width: var(--sidebar-w);
}
#sidebar.collapsed:hover .nav-scroll {
  overflow-y: auto;
}
#sidebar.collapsed .nav-header,
#sidebar.collapsed .nav-group,
#sidebar.collapsed .nav-item,
#sidebar.collapsed .nav-footer {
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s;
}
#sidebar.collapsed:hover .nav-header,
#sidebar.collapsed:hover .nav-group,
#sidebar.collapsed:hover .nav-item,
#sidebar.collapsed:hover .nav-footer {
  opacity: 1;
  pointer-events: auto;
}
.nav-header {
  font-size: 1.2rem; font-weight: 700; color: #fff;
  padding: .8rem 1.2rem 1rem;
  border-bottom: 1px solid rgba(255,255,255,.08);
  margin-bottom: .5rem;
  white-space: nowrap;
}
.nav-group {
  font-size: .75rem; text-transform: uppercase; letter-spacing: .08em;
  color: var(--accent); padding: .8rem 1.2rem .3rem;
  font-weight: 700; white-space: nowrap;
}
.nav-item {
  display: block; padding: .3rem 1rem;
  color: var(--sidebar-text); text-decoration: none;
  font-size: .75rem; border-left: 3px solid transparent;
  transition: all .15s;
  line-height: 1.4;
}
.nav-item:hover { color: #fff; background: rgba(255,255,255,.06); }
.nav-item.active {
  color: #fff; background: rgba(233,69,96,.15);
  border-left-color: var(--accent);
}

/* Main */
#content {
  margin-left: var(--sidebar-w);
  margin-right: 220px;
  padding: 2rem 3rem 4rem;
  max-width: 900px;
  transition: margin-left .25s;
}
body.sidebar-collapsed #content {
  margin-left: 48px;
}
.lesson { display: none; }
.lesson.active { display: block; }
#disqus_thread { margin-top: 3rem; padding-top: 2rem; border-top: 2px solid var(--border); }

/* Right TOC */
#toc-panel {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 210px;
  padding: 1.5rem .8rem 2rem;
  overflow-y: auto;
  font-size: .78rem;
  line-height: 1.6;
  border-left: 1px solid var(--border);
  background: var(--bg);
}
#toc-panel .toc-title {
  font-weight: 700; font-size: .8rem; margin-bottom: .5rem;
  color: #999; text-transform: uppercase; letter-spacing: .05em;
}
#toc-panel a {
  color: #777; text-decoration: none;
  display: block; padding: .15rem 0 .15rem .6rem;
  border-left: 2px solid transparent;
  transition: all .15s;
}
#toc-panel a:hover { color: var(--accent); }
#toc-panel a.active {
  color: var(--accent); border-left-color: var(--accent);
  font-weight: 600;
}
#toc-panel a.toc-h3 { padding-left: 1.2rem; font-size: .73rem; }

/* Bilingual toggle */
:not(body).lang-en { display: none; }
body.lang-en .lang-zh { display: none; }
body.lang-en span.lang-en { display: inline; }
body.lang-en div.lang-en { display: block; }

/* Typography */
h1 { font-size: 1.8rem; margin: 0 0 1.4rem; border-bottom: 2px solid var(--accent); padding-bottom: .6rem; }
h2 { font-size: 1.45rem; margin: 2.2rem 0 .9rem; color: #1a1a2e; }
h3 { font-size: 1.2rem; margin: 1.6rem 0 .6rem; }
h4 { font-size: 1.05rem; margin: 1.3rem 0 .5rem; }
p { margin: .6rem 0; }
ul, ol { margin: .5rem 0 .5rem 1.5rem; }
li { margin: .2rem 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
blockquote {
  border-left: 3px solid var(--accent);
  background: rgba(233,69,96,.04);
  padding: .6rem 1rem; margin: .8rem 0;
  font-size: .95rem;
}

/* Ruby / Furigana */
ruby { ruby-align: center; }
rt {
  font-size: .6em; color: var(--ruby-color);
  font-weight: 400;
}
body.hide-ruby rt { visibility: hidden; }
body.hide-ruby ruby:hover rt { visibility: visible; }

/* Tables */
table {
  border-collapse: collapse; width: 100%;
  margin: .8rem 0; font-size: .9rem;
}
th, td {
  border: 1px solid var(--border);
  padding: .4rem .7rem; text-align: left;
}
th { background: #f0f0f0; font-weight: 600; font-size: .85rem; }
tr:nth-child(even) { background: #fafafa; }

/* Word table highlight */
table.word-table { border-left: 4px solid var(--word-border); }
table.word-table th { background: var(--word-bg); }
table.word-table td:first-child { font-size: 1.2rem; font-weight: 500; }

/* Checklist */
.checklist-progress {
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px;
  padding: .8rem 1.2rem; margin: 1rem 0 1.5rem; display: flex; align-items: center; gap: 1rem;
  font-size: .9rem; color: #666; position: sticky; top: 0; z-index: 5;
}
.checklist-progress .progress-bar {
  flex: 1; height: 8px; background: #e8e8e8; border-radius: 4px; overflow: hidden;
}
.checklist-progress .progress-fill {
  height: 100%; background: var(--accent); border-radius: 4px; transition: width .3s;
}
.checklist-progress .progress-text { white-space: nowrap; font-weight: 500; min-width: 80px; text-align: right; }
ul:has(input[type="checkbox"]) {
  list-style: none; padding-left: 0;
}
ul:has(input[type="checkbox"]) li {
  padding: .4rem .6rem; border-radius: 6px; margin: .2rem 0;
  transition: background .2s;
}
ul:has(input[type="checkbox"]) li:hover { background: #f5f5f5; }
ul:has(input[type="checkbox"]) li.checked {
  text-decoration: line-through; color: #aaa;
}
ul:has(input[type="checkbox"]) li.checked input[type="checkbox"] { accent-color: var(--accent); }
input[type="checkbox"] {
  width: 1.1em; height: 1.1em; margin-right: .5em; cursor: pointer;
  vertical-align: middle; accent-color: var(--accent);
}

/* Code */
pre {
  background: var(--code-bg); padding: 1rem; border-radius: 6px;
  overflow-x: auto; margin: .8rem 0; font-size: .85rem;
  line-height: 1.6;
}
code {
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", monospace;
  background: var(--code-bg); padding: .1rem .3rem; border-radius: 3px;
  font-size: .88em;
}
pre code { background: none; padding: 0; }

/* Details */
details {
  background: #f7f7f7; border-radius: 6px;
  padding: .5rem 1rem; margin: .8rem 0;
}
summary {
  cursor: pointer; font-weight: 600; color: var(--accent);
  padding: .2rem 0;
}

/* Bottom controls */
#bottom-controls {
  position: fixed; bottom: 1.2rem; right: 1.2rem;
  display: flex; gap: .5rem; z-index: 200;
}
#furigana-toggle, #lang-toggle {
  background: var(--sidebar-bg); color: #fff;
  padding: .5rem 1rem; border-radius: 20px;
  font-size: .8rem;
  box-shadow: 0 2px 10px rgba(0,0,0,.2);
}
#furigana-toggle label { cursor: pointer; }
#furigana-toggle input { margin-right: .3rem; }
#lang-btn {
  background: none; border: none; color: #fff;
  font-size: .8rem; font-weight: 700; cursor: pointer;
  padding: 0;
}

/* Sidebar footer */
.nav-footer {
  flex-shrink: 0;
  padding: .6rem 1.2rem;
  border-top: 1px solid rgba(255,255,255,.08);
  display: flex; gap: .8rem;
  font-size: .75rem;
}
.nav-footer a {
  color: var(--sidebar-text); text-decoration: none;
  opacity: .7; transition: opacity .15s;
}
.nav-footer a:hover { opacity: 1; color: #fff; }

/* Settings */
#settings-btn {
  background: none; border: none; color: #fff;
  font-size: 1rem; cursor: pointer; padding: 0;
}
#settings-overlay {
  position: fixed; inset: 0; z-index: 500;
  background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center;
}
#settings-overlay.hidden { display: none; }
#settings-panel {
  background: #fff; border-radius: 12px;
  width: min(400px, 90vw); box-shadow: 0 8px 30px rgba(0,0,0,.25);
}
.settings-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 1rem 1.2rem; border-bottom: 1px solid #eee;
  font-weight: 700; font-size: 1rem;
}
.settings-header button {
  background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #666;
}
.settings-body { padding: 1.2rem; }
.settings-label { display: block; font-weight: 600; margin-bottom: .4rem; color: #333; }
#start-date-input {
  width: 100%; padding: .5rem; border: 1px solid #ccc; border-radius: 6px;
  font-size: .95rem;
}
.settings-hint { font-size: .8rem; color: #888; margin-top: .4rem; }

/* Day date badges in sidebar */
.nav-item .day-date {
  display: block; font-size: .65rem; opacity: .5; margin-top: 1px;
}
.nav-item.today-lesson { background: rgba(255,255,255,.12); border-left: 3px solid #ffd700; }

/* Menu button */
#menu-toggle {
  position: fixed; top: .6rem; left: .6rem;
  z-index: 200; background: var(--sidebar-bg); color: #fff;
  border: none; border-radius: 6px; padding: .4rem .7rem;
  font-size: 1.2rem; cursor: pointer;
  display: none;
}
body.sidebar-collapsed #menu-toggle { display: block; }

/* Hide right TOC on narrower screens */
@media (max-width: 900px) {
  #toc-panel { display: none; }
  #content { margin-right: 0; }
}

/* Mobile */
@media (max-width: 768px) {
  #sidebar { transform: translateX(-100%); width: var(--sidebar-w); }
  #sidebar.collapsed { width: var(--sidebar-w); }
  #sidebar.open { transform: translateX(0); }
  #sidebar.open .nav-header,
  #sidebar.open .nav-group,
  #sidebar.open .nav-item,
  #sidebar.open .nav-footer {
    opacity: 1;
    pointer-events: auto;
  }
  #content { margin-left: 0 !important; margin-right: 0; padding: 3rem 1rem 4rem; }
  #menu-toggle { display: block !important; }
}
`;

// ─── JS ───
const JS = `
(function(){
  var items = document.querySelectorAll('.nav-item');
  var lessons = document.querySelectorAll('.lesson');
  var toggle = document.getElementById('menu-toggle');
  var sidebar = document.getElementById('sidebar');
  var rubyToggle = document.getElementById('ruby-toggle');

  // ─── localStorage helpers ───
  var STORE_KEY = 'jp_grammar_prefs';
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) { return {}; }
  }
  function savePrefs(patch) {
    var prefs = loadPrefs();
    for (var k in patch) prefs[k] = patch[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  }
  var prefs = loadPrefs();

  // ─── Scroll position memory ───
  var SCROLL_KEY = 'jp_grammar_scroll';
  function loadScrollPositions() {
    try { return JSON.parse(localStorage.getItem(SCROLL_KEY)) || {}; } catch(e) { return {}; }
  }
  function saveScrollPosition(lessonId, pos) {
    var sp = loadScrollPositions();
    sp[lessonId] = pos;
    localStorage.setItem(SCROLL_KEY, JSON.stringify(sp));
  }
  var currentLesson = null;

  // Save scroll position periodically
  var scrollSaveTimer;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(function() {
      if (currentLesson) saveScrollPosition(currentLesson, window.scrollY);
    }, 300);
  });

  // ─── Restore ruby preference ───
  if (prefs.hideRuby) {
    rubyToggle.checked = false;
    document.body.classList.add('hide-ruby');
  }

  function collapseSidebar() {
    sidebar.classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
  }
  function expandSidebar() {
    sidebar.classList.remove('collapsed');
    document.body.classList.remove('sidebar-collapsed');
  }

  var tocPanel = document.getElementById('toc-panel');
  var tocData = {};

  function headingText(el) {
    var s = isEn ? el.querySelector('.lang-en') : el.querySelector('.lang-zh');
    return s ? s.textContent : el.textContent;
  }

  lessons.forEach(function(lesson) {
    var headings = lesson.querySelectorAll('h2, h3');
    var entries = [];
    var counter = 0;
    headings.forEach(function(h) {
      var id = lesson.id + '-s' + (counter++);
      h.id = id;
      entries.push({ id: id, level: h.tagName });
    });
    tocData[lesson.id] = entries;
  });

  function buildToc(lessonId) {
    var entries = tocData[lessonId] || [];
    if (entries.length < 2) { tocPanel.innerHTML = ''; return; }
    var html = '<div class="toc-title">目录</div>';
    entries.forEach(function(e) {
      var h = document.getElementById(e.id);
      var text = h ? headingText(h) : '';
      var cls = e.level === 'H3' ? ' class="toc-h3"' : '';
      html += '<a href="#' + e.id + '"' + cls + ' data-toc="' + e.id + '">' + text + '</a>';
    });
    tocPanel.innerHTML = html;
    tocPanel.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function(ev) {
        ev.preventDefault();
        document.getElementById(a.getAttribute('data-toc')).scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  // Scroll spy
  var scrollTimer;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      var active = document.querySelector('.lesson.active');
      if (!active) return;
      var entries = tocData[active.id] || [];
      var current = '';
      for (var i = 0; i < entries.length; i++) {
        var el = document.getElementById(entries[i].id);
        if (el && el.getBoundingClientRect().top <= 80) current = entries[i].id;
      }
      tocPanel.querySelectorAll('a').forEach(function(a) {
        a.classList.toggle('active', a.getAttribute('data-toc') === current);
      });
    }, 30);
  });

  // ─── Start date & day-date display ───
  var startDateInput = document.getElementById('start-date-input');

  function getDayNumber(lessonId) {
    var m = lessonId.match(/^day(\\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  function formatDate(d) {
    return (d.getMonth()+1) + '/' + d.getDate();
  }

  function updateDayDates() {
    var startStr = loadPrefs().startDate;
    if (!startStr) {
      items.forEach(function(item) {
        var badge = item.querySelector('.day-date');
        if (badge) badge.remove();
        item.classList.remove('today-lesson');
      });
      return;
    }
    var start = new Date(startStr + 'T00:00:00');
    var today = new Date(); today.setHours(0,0,0,0);

    items.forEach(function(item) {
      var id = item.getAttribute('data-target');
      var dayNum = getDayNumber(id);
      if (dayNum < 0) return;

      var lessonDate = new Date(start);
      lessonDate.setDate(lessonDate.getDate() + dayNum);
      var dateStr = formatDate(lessonDate);

      var badge = item.querySelector('.day-date');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'day-date';
        item.appendChild(badge);
      }
      badge.textContent = dateStr;

      var isToday = lessonDate.getTime() === today.getTime();
      item.classList.toggle('today-lesson', isToday);
    });
  }

  // ─── Settings panel ───
  var settingsBtn = document.getElementById('settings-btn');
  var settingsOverlay = document.getElementById('settings-overlay');
  var settingsClose = document.getElementById('settings-close');

  settingsBtn.addEventListener('click', function() {
    var p = loadPrefs();
    startDateInput.value = p.startDate || '';
    settingsOverlay.classList.remove('hidden');
  });
  settingsClose.addEventListener('click', function() {
    settingsOverlay.classList.add('hidden');
  });
  settingsOverlay.addEventListener('click', function(e) {
    if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
  });

  startDateInput.addEventListener('change', function() {
    savePrefs({ startDate: this.value });
    updateDayDates();
  });

  function show(id) {
    // Save scroll position of previous lesson
    if (currentLesson) saveScrollPosition(currentLesson, window.scrollY);

    lessons.forEach(function(l){ l.classList.remove('active'); });
    items.forEach(function(i){ i.classList.remove('active'); });
    var target = document.getElementById(id);
    if(target) target.classList.add('active');
    var link = document.querySelector('[data-target="'+id+'"]');
    if(link) link.classList.add('active');
    buildToc(id);
    translateHeadings(isEn);

    currentLesson = id;

    // Restore scroll position
    var sp = loadScrollPositions();
    var savedY = sp[id];
    if (savedY && savedY > 0) {
      requestAnimationFrame(function() { window.scrollTo(0, savedY); });
    } else {
      window.scrollTo(0, 0);
    }

    if (window.innerWidth > 768) {
      collapseSidebar();
    } else {
      sidebar.classList.remove('open');
    }
  }

  items.forEach(function(item){
    item.addEventListener('click', function(e){
      e.preventDefault();
      var id = this.getAttribute('data-target');
      show(id);
      history.replaceState(null,null,'#'+id);
    });
  });

  toggle.addEventListener('click', function(){
    if (window.innerWidth > 768) {
      if (sidebar.classList.contains('collapsed')) {
        expandSidebar();
      } else {
        collapseSidebar();
      }
    } else {
      sidebar.classList.toggle('open');
    }
  });

  rubyToggle.addEventListener('change', function(){
    var hide = !this.checked;
    document.body.classList.toggle('hide-ruby', hide);
    savePrefs({ hideRuby: hide });
  });

  // Language toggle
  var langBtn = document.getElementById('lang-btn');
  var isEn = ('isEn' in prefs) ? prefs.isEn : !/^zh/i.test(navigator.language || '');
  if (isEn) {
    document.body.classList.add('lang-en');
    langBtn.textContent = '中';
  }
  var headingMap = {
    '接续': 'Conjugation', '含义': 'Meaning', '例句': 'Examples',
    '辨析': 'Comparison', '易错点': 'Common Mistakes', '今日练习': 'Practice',
    '复习计划': 'Review Schedule', '本课单词表': 'Vocabulary',
    '活用表（敬体）': 'Conjugation Table (Polite)',
    '活用表（简体/常体）': 'Conjugation Table (Plain)',
    '总览': 'Overview', '用法': 'Usage', '用法详解': 'Usage Details',
    '核心语感': 'Core Nuance', '例': 'Example', '注意点': 'Notes',
    '口语缩略': 'Casual Forms', '对比总结': 'Summary', '答案': 'Answers',
    '单词': 'Word', '读音': 'Reading', '含义': 'Meaning',
  };
  var cellMap = {
    '肯定': 'Affirmative', '否定': 'Negative',
    '现在': 'Present', '过去': 'Past',
    '现在肯定': 'Present +', '现在否定': 'Present −',
    '过去肯定': 'Past +', '过去否定': 'Past −',
    '接续': 'Form', '例子': 'Example', '规则': 'Rule',
    '词类': 'Type', '形式': 'Form', '含义': 'Meaning',
    '表达': 'Expression', '场景': 'Context', '语感': 'Nuance',
    '根据': 'Basis', '确定度': 'Certainty', '语气': 'Tone',
    '书面': 'Written', '口语': 'Spoken',
  };
  var originalHeadings = new Map();

  var reChinese = /[\u4e00-\u9fff\u3400-\u4dbf]/;

  function autoTranslateHeading(text) {
    if (headingMap[text]) return headingMap[text];
    var m = text.match(/^用法([①②③④⑤⑥⑦⑧])/);
    if (m) return 'Usage ' + m[1];
    var stripped = text.replace(/（[^）]*）/g, '').trim();
    if (!reChinese.test(stripped)) return stripped;
    return text;
  }

  function translateHeadings(toEn) {
    var active = document.querySelector('.lesson.active');
    if (!active) return;
    active.querySelectorAll('h2, h3, h4, summary').forEach(function(el) {
      if (el.querySelector('.lang-zh')) return;
      var orig = el.getAttribute('data-orig') || el.textContent.trim();
      if (!el.getAttribute('data-orig')) el.setAttribute('data-orig', orig);
      el.textContent = toEn ? autoTranslateHeading(orig) : orig;
    });
    active.querySelectorAll('th').forEach(function(el) {
      var orig = el.getAttribute('data-orig') || el.textContent.trim();
      if (!el.getAttribute('data-orig')) el.setAttribute('data-orig', orig);
      if (toEn && cellMap[orig]) {
        el.textContent = cellMap[orig];
      } else if (!toEn) {
        el.textContent = orig;
      }
    });
    tocPanel.querySelectorAll('a[data-toc]').forEach(function(a) {
      var h = document.getElementById(a.getAttribute('data-toc'));
      if (h) a.textContent = headingText(h);
    });
  }

  langBtn.addEventListener('click', function(){
    isEn = !isEn;
    document.body.classList.toggle('lang-en', isEn);
    langBtn.textContent = isEn ? '中' : 'EN';
    translateHeadings(isEn);
    savePrefs({ isEn: isEn });
  });

  // ─── Checklist persistence ───
  var CHECK_KEY = 'jp_grammar_checks';
  function loadChecks() {
    try { return JSON.parse(localStorage.getItem(CHECK_KEY)) || {}; } catch(e) { return {}; }
  }
  function saveChecks(data) { localStorage.setItem(CHECK_KEY, JSON.stringify(data)); }

  function initChecklists() {
    var checks = loadChecks();
    var boxes = document.querySelectorAll('input[type="checkbox"][data-lesson]');
    boxes.forEach(function(cb) {
      var key = cb.getAttribute('data-lesson') + ':' + cb.getAttribute('data-idx');
      if (checks[key]) { cb.checked = true; cb.parentElement.classList.add('checked'); }
      else { cb.checked = false; cb.parentElement.classList.remove('checked'); }
      cb.addEventListener('change', function() {
        var c = loadChecks();
        var k = this.getAttribute('data-lesson') + ':' + this.getAttribute('data-idx');
        if (this.checked) { c[k] = 1; this.parentElement.classList.add('checked'); }
        else { delete c[k]; this.parentElement.classList.remove('checked'); }
        saveChecks(c);
        updateProgress(this.getAttribute('data-lesson'));
      });
    });
  }

  function updateProgress(lessonId) {
    var article = document.getElementById(lessonId);
    if (!article) return;
    var bar = article.querySelector('.progress-fill');
    var text = article.querySelector('.progress-text');
    if (!bar || !text) return;
    var boxes = article.querySelectorAll('input[type="checkbox"][data-lesson]');
    var total = boxes.length;
    var done = 0;
    boxes.forEach(function(cb) { if (cb.checked) done++; });
    var pct = total > 0 ? Math.round(done / total * 100) : 0;
    bar.style.width = pct + '%';
    text.textContent = done + ' / ' + total + ' (' + pct + '%)';
  }

  function insertProgressBars() {
    var checkLessons = {};
    document.querySelectorAll('input[type="checkbox"][data-lesson]').forEach(function(cb) {
      checkLessons[cb.getAttribute('data-lesson')] = true;
    });
    Object.keys(checkLessons).forEach(function(lid) {
      var article = document.getElementById(lid);
      if (!article || article.querySelector('.checklist-progress')) return;
      var h1 = article.querySelector('h1');
      if (!h1) return;
      var div = document.createElement('div');
      div.className = 'checklist-progress';
      div.innerHTML = '<div class="progress-bar"><div class="progress-fill"></div></div><span class="progress-text">0 / 0</span>';
      h1.after(div);
      updateProgress(lid);
    });
  }

  // Init
  updateDayDates();
  var hash = location.hash.slice(1);
  var first = items[0] ? items[0].getAttribute('data-target') : null;
  show(hash || first);
  initChecklists();
  insertProgressBars();
})();
`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
