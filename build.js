const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Marked } = require("marked");
const sharp = require("sharp");
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
const SITE = "https://jpnotes.dev/";
// Derived from SITE — change SITE in one place to migrate domains.
const SITE_PATH = new URL(SITE).pathname;             // "/japanese-grammar/" or "/"
const SITE_HOST = SITE.replace(/^https?:\/\//, "").replace(/\/$/, ""); // "ralphbupt.github.io/japanese-grammar" or "jpnotes.dev"
// IndexNow key — proves domain ownership to Bing/Yandex/etc. MUST stay stable
// (changing it breaks verification). Kept in sync with indexnow.mjs (CI ping).
const INDEXNOW_KEY = "b5c13368abbfcdaf25ed104808caeca9";

// Giscus comments — backed by this repo's GitHub Discussions. Replaces
// Disqus: no third-party cookies, no ads, lazy-loaded via IntersectionObserver
// (data-loading="lazy"), and comments are stored in your own repo.
const GISCUS_SCRIPT = `<script src="https://giscus.app/client.js"
        data-repo="Ralphbupt/japanese-grammar"
        data-repo-id="R_kgDOR7OzbA"
        data-category="Comments"
        data-category-id="DIC_kwDOR7OzbM4C9me3"
        data-mapping="pathname"
        data-strict="0"
        data-reactions-enabled="1"
        data-emit-metadata="0"
        data-input-position="top"
        data-theme="preferred_color_scheme"
        data-lang="zh-CN"
        data-loading="lazy"
        crossorigin="anonymous"
        async>
</script>`;

// Theme init script — runs synchronously in <head> before CSS evaluates,
// so the saved theme class is on <html> before paint (no flash of wrong theme).
// Default (no class) follows @media (prefers-color-scheme: dark).
const THEME_INIT_SCRIPT = `<script>
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark') document.documentElement.classList.add('theme-dark');
    else if (t === 'light') document.documentElement.classList.add('theme-light');
  } catch (e) {}
})();
</script>`;

// Theme toggle button + click handler. Three-state cycle:
// auto (no class, follows system) → dark → light → auto.
const THEME_TOGGLE_HTML = `<div id="theme-toggle"><button id="theme-btn" aria-label="切换主题 / Toggle theme">🌓</button></div>`;
const THEME_TOGGLE_JS = `(function(){
  var btn = document.getElementById('theme-btn');
  if (!btn) return;
  var html = document.documentElement;
  function current() {
    if (html.classList.contains('theme-dark')) return 'dark';
    if (html.classList.contains('theme-light')) return 'light';
    return 'auto';
  }
  function paintIcon() {
    var c = current();
    btn.textContent = c === 'dark' ? '🌙' : c === 'light' ? '☀️' : '🌓';
    btn.title = c === 'dark' ? '当前: 深色 (点击切浅色)' : c === 'light' ? '当前: 浅色 (点击切自动)' : '当前: 跟随系统 (点击切深色)';
  }
  paintIcon();
  btn.addEventListener('click', function() {
    var next = { auto: 'dark', dark: 'light', light: 'auto' }[current()];
    html.classList.remove('theme-dark', 'theme-light');
    if (next === 'dark') html.classList.add('theme-dark');
    else if (next === 'light') html.classList.add('theme-light');
    try {
      if (next === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', next);
    } catch (e) {}
    paintIcon();
    if (window.gaEvent) window.gaEvent('theme_toggle', { to: next });
  });
})();`;

// TTS (Text-to-Speech) for Japanese example sentences. Adds a small 🔊
// button to every data-ja <li> element. Click reads the Japanese text
// aloud via the browser's built-in speech synthesis (Web Speech API).
// Chinese translations in parens are stripped before speaking.
const TTS_JS = `document.addEventListener('DOMContentLoaded', function(){
  function getCleanJapanese(el) {
    var clone = el.cloneNode(true);
    clone.querySelectorAll('rt, rp, .speak-btn').forEach(function(r) { r.remove(); });
    return (clone.textContent || '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[→❌✓✗⚠️📖↑↓←→●■□▶︎•·…]/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function speakBrowserTTS(text) {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.85;
    speechSynthesis.speak(u);
  }

  // Inject 🔊 button ONLY on sentences with pre-generated Edge TTS audio.
  // No browser TTS fallback — quality is too poor to show.
  document.querySelectorAll('li[data-audio]').forEach(function(el) {
    var audioId = el.getAttribute('data-audio');
    var btn = document.createElement('button');
    btn.className = 'speak-btn';
    btn.textContent = '🔊';
    btn.title = '朗読';
    btn.setAttribute('aria-label', 'Read aloud');
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var audio = new Audio('/audio/' + audioId + '.mp3');
      audio.play();
      if (window.gaEvent) window.gaEvent('audio_play', { audio_id: audioId, page_path: location.pathname });
    });
    el.appendChild(btn);
  });
});`;

// Deferred Google Analytics loader — fires 1.5s after the load event,
// and bails out entirely for headless browsers / crawlers / Lighthouse
// runs (so they don't pollute GA's "new users" count with fake sessions).
// Async loading is fine for parsing but Lighthouse still penalises any
// third-party script in the critical path. Deferring until idle moves
// the gtag fetch out of LCP / TTI measurements without meaningfully
// hurting analytics accuracy.
const GTAG_DEFERRED = `<script>
(function() {
  var ua = navigator.userAgent || '';
  // Skip GA for automation / crawlers / SEO tools — they all match here.
  if (navigator.webdriver) return;
  if (/HeadlessChrome|Lighthouse|PhantomJS|Puppeteer|Playwright|crawler|spider|bot|Slurp|facebookexternalhit/i.test(ua)) return;
  window.addEventListener('load', function() {
    setTimeout(function() {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=G-D1KNQTFN1R';
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function(){ dataLayer.push(arguments); };
      gtag('js', new Date());
      gtag('config', 'G-D1KNQTFN1R');
    }, 1500);
  });
  // Safe event helper — silently no-ops if gtag hasn't loaded yet (first 1.5s
  // after load, or for users who block analytics). Callers don't need to
  // guard their calls. Buffers nothing intentionally; the first 1.5s of
  // interactions are a rounding error.
  window.gaEvent = function(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  };
})();
</script>`;

// Old /dayNN/ → new /lessonNN/ map for redirect stubs. Used to generate
// meta-refresh pages at the old URLs so previously-shared / Google-indexed
// /dayNN/ links continue to work after the rename. Google treats <meta
// http-equiv="refresh" content="0;url="> as a 301 equivalent.
const DAY_TO_LESSON = {
  day00:"lesson00",day01:"lesson01",day02:"lesson02",day03:"lesson03",
  day04:"lesson04",day05:"lesson05",day06:"lesson06",day07:"lesson07",
  day08:"lesson08",day09:"lesson09",day10:"lesson10",day11:"lesson11",
  day12:"lesson12",day13:"lesson13",day14:"lesson14",day15:"lesson15",
  day16:"lesson16",day17:"lesson17",day18:"lesson18",day19:"lesson19",
  day20:"lesson20",day21:"lesson21",day22:"lesson22",day23:"lesson23",
  day24:"lesson24",day25:"lesson25",day26:"lesson26",
  // N4 reordered: review moved to end, supplementary content gets sequential ids
  day27:"lesson34",day28:"lesson30",day29:"lesson31",day30:"lesson32",day31:"lesson33",
  // N3 shifted +3 to make room for new keigo lessons in N4
  day32:"lesson35",day33:"lesson36",day34:"lesson37",day35:"lesson38",
  day36:"lesson39",day37:"lesson40",day38:"lesson41",day39:"lesson42",
  day40:"lesson43",day41:"lesson44",day42:"lesson45",day43:"lesson46",
  day44:"lesson47",day45:"lesson48",day46:"lesson49",day47:"lesson50",
  day48:"lesson51",day49:"lesson52",day50:"lesson53",day51:"lesson54",
  day52:"lesson55",day53:"lesson56",day54:"lesson57",day55:"lesson58",
  // N2 shifted +3
  day56:"lesson59",day57:"lesson60",day58:"lesson61",day59:"lesson62",
  day60:"lesson63",day61:"lesson64",day62:"lesson65",day63:"lesson66",
  day64:"lesson67",day65:"lesson68",day66:"lesson69",day67:"lesson70",
  day68:"lesson71",day69:"lesson72",day70:"lesson73",day71:"lesson74",
  day72:"lesson75",
};

// Japanese sidebar titles (keyed by file id)
const JA_TITLES = {
  N5_grammar_list: "N5 文法チェックリスト",
  N4_grammar_list: "N4 文法チェックリスト",
  N3_grammar_list: "N3 文法チェックリスト",
  N2_grammar_list: "N2 文法チェックリスト",
  lesson00: "五十音図（参考）",
  lesson01: "判断句・は/が・基礎助詞",
  lesson02: "核心助詞 — に・で・へ・と・から・まで",
  lesson03: "動詞分類とます形",
  lesson04: "て形（最重要な動詞活用）",
  lesson05: "て形応用 — ている・てください・てもいい",
  lesson06: "ない形と義務表現",
  lesson07: "た形・経験・列挙表現",
  lesson08: "形容詞活用と比較表現",
  lesson09: "条件表現 — と・ば",
  lesson10: "条件表現 — たら・なら",
  lesson11: "可能形と受身形",
  lesson12: "意向形と願望表現",
  lesson13: "推測 — でしょう・かもしれない・そうだ",
  lesson14: "様態 — ようだ・らしい・みたいだ・っぽい",
  lesson15: "N5補充文法 — ことができる・のだ・のに",
  lesson16: "N5補充文法＋総復習",
  lesson18: "使役形 — させる・させてあげる",
  lesson19: "受身形詳解・使役受身形",
  lesson20: "授受表現 — あげる/もらう/くれる",
  lesson21: "ように系列 — ようにする/ようになる",
  lesson22: "ことにする/ことになる/はずだ",
  lesson23: "ばかり/ところだ/てしまう",
  lesson24: "ておく/てある/て以来/にかけて",
  lesson25: "という/ということ/というより",
  lesson26: "わけだ/ものだ",
  lesson27: "敬語入門 — 尊敬語",
  lesson28: "敬語入門 — 謙譲語",
  lesson29: "敬語実用 — 商務シーン",
  lesson34: "N4文法総復習",
  lesson30: "〜ても/〜てほしい/〜ていく・てくる",
  lesson31: "〜すぎる/〜やすい・にくい/〜ことはない",
  lesson17: "N5補充文法② — がある・に行く・のが好き",
  lesson32: "引用・思考・比況 — と思う・かどうか・のように",
  lesson33: "時間と場面 — あいだ・までに・場合は",
  lesson35: "N3書面助詞 — において/に対して",
  lesson36: "書面助詞② — に関して/にとって/に基づいて",
  lesson37: "原因・理由 — おかげで/せいで/からには",
  lesson38: "逆接・譲歩① — にもかかわらず/くせに",
  lesson39: "逆接・譲歩② — ものの/とはいえ/どころか",
  lesson40: "程度・範囲① — ほど/さえ〜ば",
  lesson41: "程度・範囲② — ばかりか/に限らず",
  lesson42: "傾向・状態 — がちだ/つつある/一方だ",
  lesson43: "判断・推量 — に違いない/おそれがある",
  lesson44: "動作関連① — ようとする/ざるを得ない",
  lesson45: "動作関連② — きる/得る/っこない",
  lesson46: "並列・添加 — 上に/とともに/に伴い",
  lesson47: "話題・立場 — として/にしては/向け",
  lesson48: "時間 — たとたんに/次第/うちに/際に",
  lesson49: "状態・様態 — まま/だらけ/っぱなし",
  lesson50: "附加・対比 — 代わりに/たびに/て初めて",
  lesson51: "表現方式① — というより/といっても/とおり",
  lesson52: "表現方式② — こそ/ふりをする/ごとに",
  lesson53: "否定関連 — ずにはいられない/めったに〜ない",
  lesson54: "助言・複合① — たらいい/〜込む/〜合う",
  lesson55: "複合表現 — からこそ/とは限らない",
  lesson56: "常用文法① — べきだ/わけにはいかない",
  lesson57: "常用文法② — てたまらない/てならない",
  lesson58: "N3文法総復習",
  lesson59: "逆接 — からといって/つつも/にしろ",
  lesson60: "原因・理由 — あまり/ばこそ/だけに",
  lesson61: "程度・限定① — に過ぎない/にほかならない",
  lesson62: "程度・限定② — はもとより/のみならず",
  lesson63: "時間 — にあたって/に先立って/を機に",
  lesson64: "主張・判断① — わけがない/はずがない",
  lesson65: "主張・判断② — ということだ/ないものか",
  lesson66: "対比・関係 — に反して/一方で/につれて",
  lesson67: "話題・立場 — をめぐって/を問わず/に応じて",
  lesson68: "感情・不可抗 — てしょうがない/てはいられない",
  lesson69: "書面表現 — に沿って/を踏まえて/上で",
  lesson70: "仮定・条件 — ものなら/ことだ/に越したことはない",
  lesson71: "関係・結果 — あげくに/ところだった",
  lesson72: "強調・限定 — だけのことはある/まい",
  lesson73: "接続・転折 — それにしても/したがって",
  lesson74: "高頻出 — げ/抜く/次第/きり/ぶりに",
  lesson75: "N2文法総復習",
};

// SEO keywords per lesson (Japanese, Chinese, English)
const LESSON_KEYWORDS = {
  N5_grammar_list: "N5文法一覧, N5语法列表, JLPT N5 grammar list, checklist, 文法チェックリスト",
  N4_grammar_list: "N4文法一覧, N4语法列表, JLPT N4 grammar list, checklist, 文法チェックリスト",
  N3_grammar_list: "N3文法一覧, N3语法列表, JLPT N3 grammar list, checklist, 文法チェックリスト",
  N2_grammar_list: "N2文法一覧, N2语法列表, JLPT N2 grammar list, checklist, 文法チェックリスト",
  lesson00: "五十音図, 五十音图, hiragana, katakana, Japanese alphabet, 平仮名, 片仮名, 日语入门",
  lesson01: "です, は, が, 助詞, 基础句型, Japanese particles, desu, basic sentence patterns, JLPT N5",
  lesson02: "に, で, へ, と, から, まで, 助词详解, core particles, JLPT N5",
  lesson03: "ます形, 动词分类, masu form, verb groups, 一类动词, 二类动词, 三类动词, JLPT N5",
  lesson04: "て形, te form, verb conjugation, 音便, te form rules, 动词变形, JLPT N5",
  lesson05: "ている, てください, てもいい, てはいけない, て形応用, te form usage, JLPT N5",
  lesson06: "ない形, なければならない, なくてもいい, negative form, obligation, JLPT N5",
  lesson07: "た形, たことがある, たり, たばかり, ta form, experience, JLPT N5",
  lesson08: "い形容词, な形容词, より, 一番, adjective conjugation, comparison, JLPT N5",
  lesson09: "と, ば, 条件表現, conditional と, conditional ば, JLPT N5",
  lesson10: "たら, なら, 条件表現, conditional たら, conditional なら, JLPT N5",
  lesson11: "可能形, 受身形, potential form, passive form, られる, JLPT N5",
  lesson12: "意向形, つもり, 予定, たい, volitional form, intention, desire, JLPT N5",
  lesson13: "でしょう, かもしれない, そうだ, 推測, conjecture, hearsay, JLPT N5",
  lesson14: "ようだ, らしい, みたいだ, っぽい, 様態, appearance, seems like, JLPT N5",
  lesson15: "ことができる, のだ, のに, ので, N5補充, supplementary grammar, JLPT N5",
  lesson16: "N5文法, N5 grammar review, 総復習, すぎる, やすい, にくい, ながら, JLPT N5",
  lesson18: "使役形, させる, させてあげる, させてもらう, causative, JLPT N4",
  lesson19: "受身形, 使役受身形, させられる, passive, causative passive, JLPT N4",
  lesson20: "あげる, もらう, くれる, 授受表現, てあげる, てもらう, てくれる, giving receiving, JLPT N4",
  lesson21: "ようにする, ようになる, ように, ないようにする, so that, JLPT N4",
  lesson22: "ことにする, ことになる, はずだ, decide to, expected to, JLPT N4",
  lesson23: "ばかり, ところだ, てしまう, ちゃう, just did, about to, regret, JLPT N4",
  lesson24: "ておく, てある, て以来, にかけて, advance preparation, result state, JLPT N4",
  lesson25: "という, ということ, というより, といえば, called, means that, JLPT N4",
  lesson26: "わけだ, ものだ, わけがない, わけではない, ものだから, JLPT N4",
  lesson27: "敬語, 尊敬語, いらっしゃる, 召し上がる, ご覧になる, お〜になる, られる, honorific Japanese, JLPT N4",
  lesson28: "敬語, 謙譲語, 参る, 申す, 拝見する, お〜する, 〜せていただく, humble Japanese, JLPT N4",
  lesson29: "敬語実用, 商務日本語, ビジネス敬語, 商务日语, business Japanese keigo, JLPT N4",
  lesson34: "N4文法, N4 grammar review, 総復習, JLPT N4 summary",
  lesson30: "ても, てほしい, ていく, てくる, がる, even if, want someone to, JLPT N4",
  lesson31: "すぎる, やすい, にくい, ことはない, 方, 出す, 始める, too much, easy to, JLPT N4",
  lesson17: "がある, がいる, に行く, のが好き, くらい, だけ, や, existence, JLPT N5",
  lesson32: "と思う, かどうか, のように, なさい, がする, 必要がある, I think, whether, JLPT N4",
  lesson33: "あいだ, までに, おきに, 場合は, たらどう, てよかった, during, by, in case, JLPT N4",
  lesson35: "において, に対して, について, によって, 書面助詞, formal particles, JLPT N3",
  lesson36: "に関して, にとって, に基づいて, にかけて, にわたって, 書面助詞, formal particles, JLPT N3",
  lesson37: "おかげで, せいで, ために, 以上は, からには, ことから, 原因理由, cause reason, JLPT N3",
  lesson38: "にもかかわらず, ながらも, くせに, としても, 逆接, 譲歩, concession, JLPT N3",
  lesson39: "にしても, ものの, とはいえ, どころか, 逆接, concession, nevertheless, JLPT N3",
  lesson40: "ほど, くらい, ば〜ほど, さえ〜ば, 程度, 範囲, degree extent, JLPT N3",
  lesson41: "だけ, しか〜ない, ばかりか, に限って, に限らず, 程度, 限定, only, not limited to, JLPT N3",
  lesson42: "がちだ, っぽい, 気味, つつある, 一方だ, かけ, 傾向, tendency, state, JLPT N3",
  lesson43: "に違いない, に決まっている, おそれがある, っけ, ものか, 判断, 推量, must be, JLPT N3",
  lesson44: "ようとする, ようがない, ざるを得ない, かねる, かねない, 動作, action, JLPT N3",
  lesson45: "きる, きれない, っこない, 得る, 得ない, 可能, possibility, completely, JLPT N3",
  lesson46: "上に, だけでなく, はもちろん, をはじめ, とともに, に伴い, 並列, addition, JLPT N3",
  lesson47: "として, にしては, 割に, 向け, 向き, 話題, 立場, as, considering, JLPT N3",
  lesson48: "たとたんに, 次第, うちに, 最中に, 際に, 時間, time, as soon as, JLPT N3",
  lesson49: "まま, だらけ, っぱなし, ずに, ように見える, 状態, 様態, state, appearance, JLPT N3",
  lesson50: "代わりに, ついでに, に比べて, によると, たびに, て初めて, 対比, comparison, JLPT N3",
  lesson51: "というより, といっても, というと, といえば, とおり, 表現, expression, rather than, JLPT N3",
  lesson52: "ふりをする, こそ, ことに, ごとに, 表現, emphasis, every, pretend, JLPT N3",
  lesson53: "ないことはない, ずにはいられない, そうもない, 決して〜ない, めったに〜ない, 否定, negation, JLPT N3",
  lesson54: "たらいい, ばいい, ばよかった, てごらん, 込む, 合う, 助言, advice, compound verb, JLPT N3",
  lesson55: "からこそ, ことは〜が, ことになっている, ような気がする, とは限らない, ところが, 複合, compound, JLPT N3",
  lesson56: "わけにはいかない, しかない, ことはない, べきだ, べきではない, ものだ, 義務, should, JLPT N3",
  lesson57: "ことか, てたまらない, てならない, てもかまわない, ことがある, 結果, feeling, JLPT N3",
  lesson58: "N3文法, N3 grammar review, 総復習, JLPT N3 summary",
  lesson59: "からといって, つつも, にしろ, にせよ, たところで, どころではない, 逆接, concession, JLPT N2",
  lesson60: "あまり, ばこそ, だけに, だけあって, ものだから, 原因, cause, precisely because, JLPT N2",
  lesson61: "に過ぎない, にほかならない, に限る, もかまわず, をものともせず, 程度, 限定, merely, JLPT N2",
  lesson62: "はもとより, のみならず, 程度, 限定, not only, let alone, JLPT N2",
  lesson63: "にあたって, に先立って, を機に, をきっかけに, 時間, occasion, prior to, JLPT N2",
  lesson64: "ないわけにはいかない, に相違ない, わけがない, はずがない, 主張, 判断, impossible, JLPT N2",
  lesson65: "ということだ, ないものか, としては, としても, 主張, 判断, it means, JLPT N2",
  lesson66: "に反して, 一方で, 反面, につれて, にしたがって, 対比, contrast, as, JLPT N2",
  lesson67: "にしても〜にしても, はともかく, をめぐって, を問わず, を中心に, に応じて, 話題, topic, JLPT N2",
  lesson68: "てしょうがない, てはいられない, ないことには, てからでないと, 感情, 不可抗, unbearable, JLPT N2",
  lesson69: "に沿って, を踏まえて, を除いて, に加えて, 上で, 末に, 書面, formal written, JLPT N2",
  lesson70: "ものなら, ようものなら, ことだ, に越したことはない, 仮定, 条件, if, best to, JLPT N2",
  lesson71: "にかけては, に当たらない, あげくに, ことなく, ずに済む, ところだった, 結果, result, JLPT N2",
  lesson72: "だけのことはある, だけは, だけまし, まい, 強調, 限定, worth, at least, JLPT N2",
  lesson73: "それにしても, それなのに, しかも, したがって, すなわち, 接続, 転折, however, therefore, JLPT N2",
  lesson74: "げ, 抜く, 次第だ, 次第で, きり, ぶりに, つき, 高頻出, suffix, JLPT N2",
  lesson75: "N2文法, N2 grammar review, 総復習, JLPT N2 summary",
};

// ─── Helpers ───
function gitLastMod(filePath) {
  try {
    const date = execSync(`git log -1 --format=%aI -- "${filePath}"`, { encoding: "utf-8" }).trim();
    return date ? date.slice(0, 10) : null;
  } catch { return null; }
}

// First commit date for a file (when it was added). Used as datePublished
// for Schema.org Article — Google differentiates published vs modified.
function gitFirstMod(filePath) {
  try {
    const log = execSync(`git log --format=%aI -- "${filePath}"`, { encoding: "utf-8" }).trim();
    if (!log) return null;
    const dates = log.split("\n");
    return dates[dates.length - 1].slice(0, 10);
  } catch { return null; }
}

// Estimate reading time in minutes from HTML content. Counts CJK characters
// only (Chinese + hiragana + katakana + CJK ext) — Latin tokens contribute
// little to reading load on a Chinese-language Japanese grammar page.
// 250 chars/min is a conservative pace for educational content with kanji.
function computeReadingTime(html) {
  const text = html.replace(/<[^>]+>/g, "");
  const cjk = (text.match(/[一-鿿぀-ヿ㐀-䶿]/g) || []).length;
  return Math.max(1, Math.ceil(cjk / 250));
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
        id: f.replace(/\.md$/, "").replace(/^(lesson\d+).*/, "$1"),
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

// Extract top-of-file :::zh block (before any ## heading).
// Used as the unique per-lesson SEO lead + meta description, replacing the
// templated "本课讲解 X 的接续规则…" boilerplate that triggers Google's
// "已抓取-未编入索引" judgement.
function extractTopLead(md) {
  const beforeH2 = md.split(/^## /m)[0];
  const m = beforeH2.match(/^:::zh\s*\n([\s\S]*?)^:::\s*$/m);
  if (!m) return null;
  return m[1].trim();
}

// For lessons without a hand-written top :::zh, fall back to the first
// prose :::zh block inside the first real grammar-point section. Each
// grammar point has a "接续/Conjugation" subsection with bullet-point
// rules — we skip those since they make awful meta descriptions. We
// also skip "本课单词表"-style vocabulary headings. What remains is
// usually the meaning/usage paragraph, which is unique per lesson.
function extractFirstMeaningZh(md) {
  const sections = md.split(/^## /m);
  for (let i = 1; i < sections.length; i++) {
    const sec = sections[i];
    const headerLine = sec.split("\n")[0];
    if (/单词表|単語表|Vocabulary/i.test(headerLine)) continue;
    const subSections = sec.split(/^### /m);
    for (let j = 1; j < subSections.length; j++) {
      const sub = subSections[j];
      const subHeader = sub.split("\n")[0];
      if (/^(接[续続]|Conjugation)/i.test(subHeader)) continue;
      const m = sub.match(/^:::zh\s*\n([\s\S]*?)^:::\s*$/m);
      if (m) return m[1].trim();
    }
  }
  return null;
}

// Strip markdown formatting from extracted lead text for meta description use.
// Strips a leading "接续：…" line that some lessons put inside their first
// :::zh block before the actual examples/meaning.
function leadToPlainText(text, maxLen = 160) {
  let s = text;
  s = s.replace(/^\s*接[续続][:：][^\n]*\n+/, "");
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s;
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

  const today = new Date().toISOString().slice(0, 10);
  const groups = discoverFiles();
  const marked = new Marked({ gfm: true, breaks: false });

  const sidebarHtml = [];
  const articlesHtml = [];
  const audioRequests = [];
  const lessonPages = []; // for individual page generation
  let firstId = null;

  for (const group of groups) {
    sidebarHtml.push(`<a class="nav-group nav-group-link" href="${SITE_PATH}${group.label}/">${group.label}</a>`);
    for (const file of group.files) {
      const md = fs.readFileSync(file.path, "utf-8");
      const title = extractTitle(md);
      const shortTitle = title.length > 40 ? title.slice(0, 38) + "…" : title;
      const topLead = extractTopLead(md);
      const firstMeaningZh = topLead ? null : extractFirstMeaningZh(md);
      if (!firstId) firstId = file.id;

      // Pre-process bilingual blocks: :::zh ... ::: / :::en ... :::
      // Use HTML comments to avoid markdown parser issues, then replace after parsing
      const bilingualMd = md.replace(
        /^:::(zh|en)\s*\n([\s\S]*?)^:::\s*$/gm,
        (_, lang, content) => `<!--lang:${lang}:start-->\n${content.trim()}\n<!--lang:${lang}:end-->`
      );

      // Parse markdown to HTML
      let html = await marked.parse(bilingualMd);

      // Convert language markers to divs (with lang attribute for SEO)
      html = html.replace(/<!--lang:(zh|en):start-->/g, (_, lang) =>
        lang === "zh" ? '<div class="lang-zh" lang="zh-CN">' : '<div class="lang-en" lang="en">'
      );
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

      // a11y: marked emits <th> without scope, which Lighthouse flags on
      // large tables. All lesson tables are column-major (header row),
      // so scope="col" is always correct.
      html = html.replace(/<th(\s[^>]*)?>/g, (m, attrs) =>
        attrs && /\bscope=/.test(attrs) ? m : `<th${attrs || ""} scope="col">`
      );

      // a11y: dual-header tables — when the first <th> in <thead> is empty,
      // the first <td> in each <tbody> row is actually a row label
      // (e.g. "现在"/"过去" in conjugation tables). Promote those to
      // <th scope="row"> so screen readers can associate body cells with
      // both the column and row header.
      html = html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/g, (tableHtml) => {
        const thead = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/);
        if (!thead) return tableHtml;
        const firstTh = thead[1].match(/<th[^>]*>([\s\S]*?)<\/th>/);
        if (!firstTh || firstTh[1].trim() !== "") return tableHtml;
        return tableHtml.replace(/<tbody>([\s\S]*?)<\/tbody>/, (m, body) => {
          const newBody = body.replace(
            /<tr>(\s*)<td(\s[^>]*)?>([\s\S]*?)<\/td>/g,
            (mm, ws, attrs, content) => `<tr>${ws}<th scope="row"${attrs || ""}>${content}</th>`
          );
          return `<tbody>${newBody}</tbody>`;
        });
      });

      // Enable checklist checkboxes (remove disabled, add data attributes)
      let checkIdx = 0;
      html = html.replace(
        /<input (checked="" )?disabled="" type="checkbox">/g,
        (match, checked) => {
          const idx = checkIdx++;
          return `<input type="checkbox" data-lesson="${file.id}" data-idx="${idx}"${checked ? ' checked' : ''}>`;
        }
      );

      // Extract grammar points from h2 headings in the original markdown for SEO descriptions
      const grammarPoints = [];
      const mdH2Regex = /^##\s+(.+)$/gm;
      let mdH2Match;
      while ((mdH2Match = mdH2Regex.exec(md)) !== null) {
        let headingText = mdH2Match[1].replace(/[#*`]/g, "").trim();
        // Grammar points must contain 〜/～ OR Japanese kana (hiragana/katakana)
        // This excludes pure Chinese headings like "本课单词表" or "练习"
        if (/[〜～]/.test(headingText) || /[\u3040-\u309f\u30a0-\u30ff]/.test(headingText)) {
          // Use text before || if bilingual heading
          const gpName = headingText.includes("||") ? headingText.split("||")[0].trim() : headingText;
          grammarPoints.push(gpName);
        }
      }
      // Clean grammar points: strip "1. " numbering and "（中文释义）" parens.
      // Only keep entries that look like real grammar patterns:
      //   - Contains 〜/～ (tilde marks a grammar pattern)
      //   - OR is short kana-mostly text like "て形", "ます形"
      // Reject section titles like "て形的基本用法", "今日练习", "本课单词表".
      const cleanPoints = grammarPoints
        .map(p => p.replace(/^\d+[.、．]\s*/, "").replace(/（[^）]*）/g, "").trim())
        .filter(p => {
          if (p.length === 0) return false;
          if (/[〜～]/.test(p)) return true;
          // Allow short kana-dominant patterns (≤8 chars, mostly kana, no Chinese explainer words)
          if (p.length > 8) return false;
          if (/[的与和及或]/.test(p)) return false;
          if (/(用法|应用|练习|总结|单词|计划|复习|基本|形式)/.test(p)) return false;
          const kanaCount = (p.match(/[぀-ゟ゠-ヿ]/g) || []).length;
          return kanaCount >= 1 && kanaCount >= p.length / 2;
        });

      // Lesson meta line: last-updated date + reading time. Inserted right
      // after H1 so the freshness signal is visible to readers and Google
      // can extract it for the SERP snippet. Also fuels datePublished /
      // dateModified in the Article schema below.
      const lessonLastMod = gitLastMod(file.path) || today;
      const lessonFirstMod = gitFirstMod(file.path) || lessonLastMod;
      const readingMin = computeReadingTime(html);
      const lessonMetaHtml = `<div class="lesson-meta"><span class="lang-zh">📅 最后更新 <time datetime="${lessonLastMod}">${lessonLastMod}</time> · ⏱ 阅读约 ${readingMin} 分钟</span><span class="lang-en">📅 Updated <time datetime="${lessonLastMod}">${lessonLastMod}</time> · ⏱ ${readingMin} min read</span></div>`;
      html = html.replace(/(<\/h1>)/, `$1\n${lessonMetaHtml}`);

      // SEO lead paragraph: keyword-rich summary inserted after h1.
      // If the lesson markdown has its own top-of-file :::zh / :::en block,
      // mark those rendered divs with the seo-lead class instead of adding
      // a templated paragraph — this prevents lesson pages from starting with
      // near-identical "本课讲解 X 的接续规则…" boilerplate, which is what
      // makes Google flag pages as 已抓取-未编入索引.
      const groupLevel = group.label;
      if (topLead) {
        html = html.replace(
          /(<div class=")lang-zh(" lang="zh-CN">)/,
          "$1lang-zh seo-lead$2"
        );
        html = html.replace(
          /(<div class=")lang-en(" lang="en">)/,
          "$1lang-en seo-lead$2"
        );
      } else if (cleanPoints.length > 0) {
        const leadPoints = cleanPoints.slice(0, 6);
        const pointsZh = leadPoints.map(p => `<strong>${p}</strong>`).join("、");
        const seoLead = `<p class="seo-lead">本课讲解 ${groupLevel} 语法 ${pointsZh} 的接续规则、含义、例句辨析与易错点对比，配套练习题与 JLPT ${groupLevel} 备考要点。</p>`;
        html = html.replace(/(<\/h1>)/, `$1\n${seoLead}`);
      }

      // Add id attributes to h2 elements for direct linking (#5)
      html = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (match, attrs, content) => {
        // If bilingual (has lang-zh span), use only the zh text for slug
        const zhMatch = content.match(/<span class="lang-zh">([\s\S]*?)<\/span>/);
        let slugSource;
        if (zhMatch) {
          slugSource = zhMatch[1].replace(/<[^>]+>/g, "").trim();
        } else {
          slugSource = content.replace(/<[^>]+>/g, "").trim();
        }
        // Generate a clean id from the text
        const slug = slugSource.replace(/[\s\u3000]+/g, "_").replace(/[<>"'&]/g, "");
        return `<h2${attrs} id="${slug}">${content}</h2>`;
      });

      // Add furigana (kana-based detection)
      console.log(`  Processing ${file.id}...`);
      html = await addFurigana(kuro, html);

      // Tag ALL <li data-ja> with audio IDs (not just inside <ol>).
      // Covers numbered examples, bullet examples, and unnumbered lists.
      let audioSeq = 0;
      const lnum = (file.id.match(/\d+/) || ["0"])[0];
      html = html.replace(/<li data-ja([^>]*)>([\s\S]*?)<\/li>/g, (match, attrs, content) => {
        if (/word-table/.test(attrs)) return match;
        const plain = content
          .replace(/<ruby>([^<]*)<rp>[^<]*<\/rp><rt>[^<]*<\/rt><rp>[^<]*<\/rp><\/ruby>/g, "$1")
          .replace(/<[^>]+>/g, "")
          .replace(/[（(][^）)]*[）)]/g, "")
          .replace(/[→❌✓✗⚠️📖↑↓←→●■□▶︎•·…]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (plain.length < 10 || !/[。！？]/.test(plain)) return match;
        if (!/[぀-ゟ゠-ヿ]/.test(plain)) return match;
        audioSeq++;
        const audioId = `l${lnum}.${String(audioSeq).padStart(3, "0")}`;
        audioRequests.push({ id: audioId, text: plain });
        return `<li data-ja${attrs} data-audio="${audioId}">${content}</li>`;
      });

      const lessonMatch = file.id.match(/^lesson(\d+)/);
      const lessonNum = lessonMatch ? lessonMatch[1] : "";
      const jaTitle = JA_TITLES[file.id];
      const sidebarTitle = jaTitle
        ? (lessonNum ? `Lesson ${lessonNum} – ${jaTitle}` : jaTitle)
        : shortTitle;
      sidebarHtml.push(
        `<a class="nav-item" href="${SITE_PATH}${file.id}/" data-target="${file.id}">${sidebarTitle}</a>`
      );
      articlesHtml.push(
        `<article id="${file.id}" class="lesson">${html}</article>`
      );
      lessonPages.push({ id: file.id, title, sidebarTitle, html, jaTitle: jaTitle || shortTitle, filePath: file.path, grammarPoints, cleanPoints, level: group.label, md, topLead, firstMeaningZh, lastMod: lessonLastMod, firstMod: lessonFirstMod, readingMin });
    }
  }

  // ─── Cross-link related grammar points between lessons ───
  // Build an index: grammar term → { lessonId, slug }
  const grammarIndex = new Map(); // term → [{ id, slug }]
  for (const lesson of lessonPages) {
    // Extract h2 ids from the lesson HTML
    const h2Regex = /<h2[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h2>/gi;
    let h2Match;
    while ((h2Match = h2Regex.exec(lesson.html)) !== null) {
      const slug = h2Match[1];
      // Prefer Chinese variant when bilingual heading (<span class="lang-zh">).
      let rawContent = h2Match[2];
      const zhSpan = rawContent.match(/<span class="lang-zh">([\s\S]*?)<\/span>/);
      const content = (zhSpan ? zhSpan[1] : rawContent).replace(/<[^>]+>/g, "").trim();
      // Description: first parenthesized note, used as anchor text suffix.
      const descMatch = content.match(/[（(]([^）)]+)[）)]/);
      const description = descMatch ? descMatch[1].trim() : null;
      // Extract the grammar pattern (〜xxx or Japanese term)
      const patterns = content.match(/[〜～]?[\u3040-\u309f\u30a0-\u30ffー\u4e00-\u9fff]+/g) || [];
      for (const pat of patterns) {
        const hadTilde = /^[〜～]/.test(pat);
        const term = pat.replace(/^[〜～]/, "");
        if (term.length < 2) continue;
        // Filter to actual grammar terms: must have 〜 OR contain kana.
        // Pure-kanji words like "辨析" / "将来" / "状态" are noise — they're
        // Chinese vocabulary the page happens to use, not Japanese grammar.
        const hasKana = /[぀-ゟ゠-ヿ]/.test(term);
        if (!hadTilde && !hasKana) continue;
        // Skip generic section labels that show up across every lesson.
        if (/^(辨析|含义|用法|接続|接续|例句|練習|练习|本课|总结|计划|易错点)$/.test(term)) continue;
        if (!grammarIndex.has(term)) grammarIndex.set(term, []);
        grammarIndex.get(term).push({ id: lesson.id, slug, description, level: lesson.level });
      }
    }
  }

  // Insert cross-links: for each lesson, find references to grammar in other
  // lessons. Cap at 25 per lesson (up from 8) for denser internal linking —
  // Google's SEO guide treats internal links as a primary discovery signal.
  for (let li = 0; li < lessonPages.length; li++) {
    let html = lessonPages[li].html;
    const relatedLinks = new Set();
    const seenTerms = new Set();
    for (const [term, locations] of grammarIndex) {
      if (seenTerms.has(term)) continue;
      const otherLocs = locations.filter(l => l.id !== lessonPages[li].id);
      if (otherLocs.length === 0) continue;
      const plainText = html.replace(/<h2[\s\S]*?<\/h2>/g, "").replace(/<[^>]+>/g, "");
      if (plainText.includes(term) && relatedLinks.size < 25) {
        const loc = otherLocs[0];
        // Descriptive anchor: pattern + (description + level tag) so the
        // link text tells readers and Google what the target page contains.
        const levelTag = loc.level ? `<span class="cross-link-level">${loc.level}</span>` : "";
        const descShort = loc.description && loc.description.length > 14
          ? loc.description.slice(0, 13) + "…"
          : loc.description;
        const descPart = descShort
          ? `<span class="cross-link-desc">${descShort}</span>`
          : "";
        const titleAttr = (loc.description
          ? `${loc.description} — ${loc.level || ""} ${loc.id}`
          : `${loc.level || ""} ${loc.id}`).trim();
        relatedLinks.add(`<a href="${SITE}${loc.id}/#${loc.slug}" class="cross-link" data-target="${loc.id}" data-scroll="${loc.slug}" title="${titleAttr.replace(/"/g, "&quot;")}"><span class="cross-link-term">${term}</span>${descPart}${levelTag}</a>`);
        seenTerms.add(term);
      }
    }
    if (relatedLinks.size > 0) {
      const relatedHtml = `<div class="related-grammar"><span class="related-label">関連文法:</span> ${[...relatedLinks].join(" ")}</div>`;
      // Insert before the last section (review schedule) or at the end
      const reviewIdx = html.lastIndexOf('<h2');
      if (reviewIdx > 0) {
        html = html.slice(0, reviewIdx) + relatedHtml + html.slice(reviewIdx);
      } else {
        html += relatedHtml;
      }
    }
    lessonPages[li].html = html;
    articlesHtml[li] = `<article id="${lessonPages[li].id}" class="lesson">${html}</article>`;
  }

  // ─── Shared sidebar markup ───
  // Used on home, lesson, and level pages so the directory is reachable
  // from anywhere. Sidebar links are root-relative so they work from any
  // subpath (e.g. clicking from /day01/ correctly navigates to /day05/).
  const sidebarMarkupHtml = `<nav id="sidebar" class="collapsed">
  <div class="nav-scroll">
  <div class="nav-header"><a href="${SITE_PATH}" style="color:inherit;text-decoration:none;">日语语法笔记</a></div>
  ${sidebarHtml.join("\n  ")}
  </div>
  <div class="nav-footer">
    <a href="https://podcast.jpnotes.dev/" target="_blank">Podcast</a>
    <a href="${SITE_PATH}about/">关于</a>
    <a href="https://github.com/Ralphbupt" target="_blank">GitHub</a>
  </div>
</nav>
<script>
// On lesson / level / about pages, mark the current sidebar entry as active
// and scroll the sidebar so the user doesn't have to hunt down their place
// in a 77-item list when they hover the collapsed sidebar.
(function() {
  var path = location.pathname.replace(/\\/$/, '');
  var slug = path.split('/').pop();
  if (!slug) return;
  var item = document.querySelector('#sidebar a[data-target="' + slug + '"]')
          || document.querySelector('#sidebar a[href$="/' + slug + '/"]');
  if (!item) return;
  item.classList.add('active');
  var scroll = document.querySelector('#sidebar .nav-scroll');
  if (!scroll) return;
  function centerItem() {
    // item.offsetTop is relative to the offsetParent (.nav-scroll),
    // so we don't need a getBoundingClientRect subtraction here.
    var top = item.offsetTop;
    var navH = scroll.clientHeight;
    var itemH = item.offsetHeight;
    if (navH <= 0) {
      // Layout not ready yet — try again next frame.
      requestAnimationFrame(centerItem);
      return;
    }
    // Position active item ~40% from top — slightly above center, so the
    // user sees the current lesson plus upcoming lessons below it.
    var target = top - navH * 0.4 + itemH / 2;
    scroll.scrollTop = Math.max(0, target);
  }
  // rAF defers until layout is computed (flex children sometimes have
  // clientHeight = 0 if measured before the first layout pass).
  requestAnimationFrame(centerItem);
})();
${TTS_JS}
</script>`;

  // ─── Home page main content ───
  // Don't inline every lesson article into index.html (3.98MB → ~50KB).
  // Replace with a landing-page layout: hero + level cards + how-to.
  // Sidebar links already point to standalone /dayXX/ pages.
  const levelCounts = { N5: 0, N4: 0, N3: 0, N2: 0 };
  let totalPoints = 0;
  let totalLessons = 0;
  for (const l of lessonPages) {
    totalPoints += (l.cleanPoints || []).length;
    if (/^lesson\d+/.test(l.id) && levelCounts.hasOwnProperty(l.level)) {
      levelCounts[l.level]++;
      totalLessons++;
    }
  }
  const homeMainHtml = `<header class="home-hero">
    <h1><span class="lang-zh">日语语法笔记 — N5 到 N2，8 周完整体系</span><span class="lang-en">Japanese Grammar Notes — JLPT N5 to N2 in 8 Weeks</span></h1>
    <p class="home-intro">
      <span class="lang-zh">免费、双语（中文 + 日语）的日语语法笔记，从 N5 入门到 N2 进阶共 <strong>${totalLessons} 课、${totalPoints}+ 语法点</strong>，每课配接续规则、例句、辨析、练习题与间隔复习勾选清单。</span>
      <span class="lang-en">Free, bilingual (Chinese + Japanese) grammar notes covering JLPT N5 → N2 in <strong>${totalLessons} lessons, ${totalPoints}+ grammar points</strong>. Each lesson has conjugation rules, example sentences, side-by-side comparisons of confusable patterns, practice questions, and a spaced-repetition checklist.</span>
    </p>
    <div class="home-stats">
      <div class="home-stat"><strong>${totalLessons}</strong><span class="lang-zh">课</span><span class="lang-en">lessons</span></div>
      <div class="home-stat"><strong>${totalPoints}+</strong><span class="lang-zh">语法点</span><span class="lang-en">grammar points</span></div>
      <div class="home-stat"><strong>4</strong><span class="lang-zh">JLPT 级别</span><span class="lang-en">JLPT levels</span></div>
      <div class="home-stat"><strong><span class="lang-zh">免费</span><span class="lang-en">Free</span></strong><span class="lang-zh">双语</span><span class="lang-en">bilingual</span></div>
    </div>
  </header>
  <section class="home-levels">
    <h2><span class="lang-zh">按级别学习</span><span class="lang-en">Browse by JLPT level</span></h2>
    <div class="level-grid">
      <a class="level-card" href="N5/">
        <span class="level-tag">N5</span>
        <h3><span class="lang-zh">入门基础</span><span class="lang-en">Beginner foundations</span></h3>
        <p>
          <span class="lang-zh">判断句、助词、动词分类、て形、ない形、た形、形容词、条件、可能/受身。共 ${levelCounts.N5} 课。</span>
          <span class="lang-en">Copula sentences, particles, verb groups, て-form, ない-form, た-form, adjectives, conditionals, potential/passive. ${levelCounts.N5} lessons.</span>
        </p>
      </a>
      <a class="level-card" href="N4/">
        <span class="level-tag">N4</span>
        <h3><span class="lang-zh">日常进阶</span><span class="lang-en">Everyday intermediate</span></h3>
        <p>
          <span class="lang-zh">使役、受身、授受表现、ように系列、ことにする/なる、わけだ/ものだ 等核心日常语法。共 ${levelCounts.N4} 课。</span>
          <span class="lang-en">Causative, passive, giving/receiving, ように patterns, ことにする/なる, わけだ/ものだ, and other daily-use grammar. ${levelCounts.N4} lessons.</span>
        </p>
      </a>
      <a class="level-card" href="N3/">
        <span class="level-tag">N3</span>
        <h3><span class="lang-zh">书面分水岭</span><span class="lang-en">Written-Japanese watershed</span></h3>
        <p>
          <span class="lang-zh">书面助词、原因理由、逆接让步、程度范围、状态样态、否定与复合表达。共 ${levelCounts.N3} 课。</span>
          <span class="lang-en">Formal particles, cause/reason, concession, degree/range, state/appearance, negation, and compound expressions. ${levelCounts.N3} lessons.</span>
        </p>
      </a>
      <a class="level-card" href="N2/">
        <span class="level-tag">N2</span>
        <h3><span class="lang-zh">商务・学术</span><span class="lang-en">Business · academic</span></h3>
        <p>
          <span class="lang-zh">高阶逆接、程度限定、判断主张、对比关系、感情表达、书面专用语法。共 ${levelCounts.N2} 课。</span>
          <span class="lang-en">Advanced concession, degree/limit, assertion, contrast, emotional expressions, and written-only grammar. ${levelCounts.N2} lessons.</span>
        </p>
      </a>
    </div>
  </section>
  <section class="home-howto">
    <h2><span class="lang-zh">使用方法</span><span class="lang-en">How to use</span></h2>
    <p>
      <span class="lang-zh">每节课包含 <strong>接续 / 含义 / 例句 / 辨析 / 易错点</strong> 五个部分，配套练习题与按间隔复习的勾选清单（当天 → 1 天 → 4 天 → 7 天 → 14 天 → 30 天）。</span>
      <span class="lang-en">Each lesson covers <strong>conjugation / meaning / examples / comparisons / common mistakes</strong>, plus practice questions and a spaced-repetition checklist (day 0 → 1 → 4 → 7 → 14 → 30).</span>
    </p>
    <p>
      <span class="lang-zh">从级别概览页（<a href="N5/">N5</a> · <a href="N4/">N4</a> · <a href="N3/">N3</a> · <a href="N2/">N2</a>）查看完整语法清单，或从侧栏直接进入任意一课。</span>
      <span class="lang-en">Browse the per-level index pages (<a href="N5/">N5</a> · <a href="N4/">N4</a> · <a href="N3/">N3</a> · <a href="N2/">N2</a>) for the full grammar list, or jump to any lesson via the sidebar.</span>
    </p>
    <p>
      <span class="lang-zh">用 Anki 复习？下载 <a href="anki/">免费 JLPT N5-N2 文法卡组</a>（共 {{ANKI_CARDS}} 张，原生 TSV 一键导入）。</span>
      <span class="lang-en">Use Anki for review? Download the <a href="anki/">free JLPT N5–N2 grammar decks</a> ({{ANKI_CARDS}} cards, native TSV one-click import).</span>
    </p>
    <p>
      <span class="lang-zh">想练听力？试试 <a href="https://podcast.jpnotes.dev/" target="_blank">Japanese Daily News 播客</a>——慢速日语新闻 + 英语解说，配套逐句精听与 transcript。</span>
      <span class="lang-en">Want listening practice? Try the <a href="https://podcast.jpnotes.dev/" target="_blank">Japanese Daily News podcast</a> — slow Japanese news with English commentary, plus sentence-by-sentence listening and transcripts.</span>
    </p>
  </section>`;

  // ─── Assemble ───
  const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Japanese Grammar Notes | 日语语法笔记 – N5→N2 in 8 Weeks</title>
<meta name="description" content="Free structured Japanese grammar notes from N5 to N2 in 8 weeks. Bilingual (Japanese + Chinese) with conjugation rules, example sentences, and spaced repetition.">
<meta name="keywords" content="Japanese grammar, JLPT N2, N5, N4, N3, 日语语法, 日本語文法, grammar notes, spaced repetition, 语法笔记">
<link rel="canonical" href="${SITE}">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="Japanese Grammar Notes | 日语语法笔记 – N5→N2">
<meta property="og:description" content="Free structured Japanese grammar notes from N5 to N2 in 8 weeks. Bilingual with examples and spaced repetition.">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ja_JP">
<meta property="og:locale:alternate" content="zh_CN">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Japanese Grammar Notes | 日语语法笔记 – N5→N2">
<meta name="twitter:description" content="Free structured Japanese grammar notes from N5 to N2 in 8 weeks.">
<meta name="twitter:image" content="${SITE}og-image.png">

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
  "image": "${SITE}og-image.png",
  "url": "${SITE}",
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
  "url": "${SITE}",
  "inLanguage": ["ja", "zh-CN"]
}]
</script>

<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>文</text></svg>">
<link rel="alternate" type="application/rss+xml" title="Japanese Grammar Notes RSS" href="${SITE}feed.xml">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#1a1a2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="日语文法">

${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
<style>
${CSS}
</style>
</head>
<body class="sidebar-collapsed">
<button id="menu-toggle" aria-label="Toggle menu">☰</button>
${sidebarMarkupHtml}
<main id="content" class="home">
  ${homeMainHtml}
</main>
<nav id="toc-panel"></nav>
<div id="bottom-controls">
  ${THEME_TOGGLE_HTML}
  <div id="furigana-toggle">
    <label><input type="checkbox" id="ruby-toggle" checked> 显示读音</label>
  </div>
  <div id="lang-toggle">
    <button id="lang-btn">EN</button>
  </div>
</div>
<script>
${JS}
</script>
</body>
</html>`;

  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, OUT), fullHtml, "utf-8");

  // Write audio request list for build-audio.py
  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "dist", ".audio-requests.json"),
    JSON.stringify(audioRequests),
    "utf-8"
  );
  console.log(`  Tagged ${audioRequests.length} sentences with audio IDs.`);

  // ─── Generate individual lesson pages ───
  for (let li = 0; li < lessonPages.length; li++) {
    const lesson = lessonPages[li];
    const prevLesson = li > 0 ? lessonPages[li - 1] : null;
    const nextLesson = li < lessonPages.length - 1 ? lessonPages[li + 1] : null;
    const lessonDir = path.join(__dirname, "dist", lesson.id);
    fs.mkdirSync(lessonDir, { recursive: true });
    const lessonUrl = `${SITE}${lesson.id}/`;
    // SEO-friendly Chinese-first title & description targeting long-tail searches
    const lessonLevel = lesson.level || "";
    const cleanPoints = lesson.cleanPoints || [];
    let lessonTitle, lessonDesc;
    if (cleanPoints.length >= 2) {
      const titlePoints = cleanPoints.slice(0, 2).join(" / ");
      lessonTitle = `${titlePoints} 用法详解 | 日语 ${lessonLevel} 语法 区别+例句`;
    } else if (cleanPoints.length === 1) {
      lessonTitle = `${cleanPoints[0]} 用法详解 | 日语 ${lessonLevel} 语法 例句+易错点`;
    } else {
      lessonTitle = `${lesson.jaTitle} | 日语 ${lessonLevel} 语法笔记 - JLPT 备考`;
    }
    // Prefer the lesson's hand-written :::zh lead for meta description.
    // Fall back to the first 含义 section's :::zh content (auto-extracted,
    // still unique because each lesson covers a different grammar point).
    // Only use the templated description as a last resort.
    if (lesson.topLead) {
      lessonDesc = leadToPlainText(lesson.topLead, 160);
    } else if (lesson.firstMeaningZh) {
      lessonDesc = leadToPlainText(lesson.firstMeaningZh, 160);
    } else if (cleanPoints.length >= 2) {
      lessonDesc = `日语 ${lessonLevel} 语法 ${cleanPoints.slice(0, 4).join("、")} 的接续、含义、例句、辨析与易错点对比。JLPT ${lessonLevel} 备考笔记，含练习题与答案。`;
    } else if (cleanPoints.length === 1) {
      lessonDesc = `深入讲解日语 ${lessonLevel} 语法 ${cleanPoints[0]} 的接续规则、用法、例句与易错点。JLPT ${lessonLevel} 备考必看笔记。`;
    } else {
      lessonDesc = `${lesson.title} - 日语 ${lessonLevel} 语法笔记，含接续规则、例句、辨析与练习。免费 JLPT 备考资源。`;
    }

    // Auto-generate Chinese-first keywords (override hardcoded LESSON_KEYWORDS)
    const autoKeywords = [
      `日语 ${lessonLevel} 语法`,
      `JLPT ${lessonLevel}`,
      `${lessonLevel} 文法`,
      ...cleanPoints.slice(0, 4).flatMap(p => [`${p} 用法`, `${p} 例句`]),
      cleanPoints.length >= 2 ? `${cleanPoints[0]} ${cleanPoints[1]} 区别` : null,
      cleanPoints.length >= 2 ? `${cleanPoints[0]} vs ${cleanPoints[1]}` : null,
      "日语语法笔记",
      "Japanese grammar",
    ].filter(Boolean);
    // Combine with existing English keywords for coverage, but lead with Chinese
    const existingKw = LESSON_KEYWORDS[lesson.id] || "";
    const lessonKeywords = [...autoKeywords, existingKw].filter(Boolean).join(", ");

    const ogImageUrl = `${SITE}${lesson.id}/og-image.png`;

    // Prev/next navigation HTML
    const prevHtml = prevLesson
      ? `<a class="pn-link pn-prev" href="${SITE}${prevLesson.id}/">← ${prevLesson.jaTitle}</a>`
      : `<span class="pn-link pn-prev"></span>`;
    const nextHtml = nextLesson
      ? `<a class="pn-link pn-next" href="${SITE}${nextLesson.id}/">${nextLesson.jaTitle} →</a>`
      : `<span class="pn-link pn-next"></span>`;

    // #3: rel prev/next links
    const prevLink = prevLesson ? `\n<link rel="prev" href="${SITE}${prevLesson.id}/">` : "";
    const nextLink = nextLesson ? `\n<link rel="next" href="${SITE}${nextLesson.id}/">` : "";

    // FAQ Schema: extract Q&A from exercises (### heading as question, <details> as answer)
    const faqItems = [];
    const faqRegex = /### ([^\n]+)\n[\s\S]*?<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/g;
    let faqMatch;
    while ((faqMatch = faqRegex.exec(lesson.md)) !== null) {
      const question = faqMatch[1].replace(/\|\|.*$/, "").trim(); // use Chinese side
      let answer = faqMatch[2].replace(/^:::(zh|en)\s*\n/gm, "").replace(/^:::\s*$/gm, "").trim();
      answer = answer.replace(/\*\*/g, "").replace(/\n/g, " ").slice(0, 300);
      if (question && answer) {
        faqItems.push({ q: question, a: answer });
      }
    }
    const faqSchema = faqItems.length > 0 ? `,\n{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [${faqItems.slice(0, 5).map(f => `
    {"@type": "Question", "name": "${f.q.replace(/"/g, '\\"')}", "acceptedAnswer": {"@type": "Answer", "text": "${f.a.replace(/"/g, '\\"')}"}}`).join(",")}
  ]
}` : "";

    const lessonHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${lessonTitle}</title>
<meta name="description" content="${lessonDesc.replace(/"/g, '&quot;')}">
<meta name="keywords" content="${lessonKeywords.replace(/"/g, '&quot;')}">
<link rel="canonical" href="${lessonUrl}">${prevLink}${nextLink}
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
<meta name="twitter:description" content="${lessonDesc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${ogImageUrl}">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": ["Article", "LearningResource"],
  "name": "${lesson.jaTitle.replace(/"/g, '\\"')}",
  "headline": "${lesson.jaTitle.replace(/"/g, '\\"')}",
  "description": "${lessonDesc.replace(/"/g, '\\"')}",
  "inLanguage": ["ja", "zh-CN"],
  "isAccessibleForFree": true,
  "url": "${lessonUrl}",
  "image": "${ogImageUrl}",
  "datePublished": "${lesson.firstMod}",
  "dateModified": "${lesson.lastMod}",
  "timeRequired": "PT${lesson.readingMin}M",
  "learningResourceType": "Lesson",
  "educationalLevel": "JLPT ${lessonLevel}",
  "educationalAlignment": {
    "@type": "AlignmentObject",
    "alignmentType": "educationalLevel",
    "educationalFramework": "JLPT",
    "targetName": "${lessonLevel}"
  },
  "teaches": [${cleanPoints.slice(0, 5).map(p => `"${p.replace(/"/g, '\\"')}"`).join(", ") || '""'}],
  "audience": { "@type": "EducationalAudience", "educationalRole": "student" },
  "author": { "@type": "Person", "name": "Ralphbupt", "url": "https://github.com/Ralphbupt" },
  "isPartOf": { "@type": "Course", "name": "Japanese Grammar Notes – N5 to N2", "url": "${SITE}" }
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "日语语法笔记", "item": "${SITE}" },
    { "@type": "ListItem", "position": 2, "name": "${lesson.jaTitle.replace(/"/g, '\\"')}", "item": "${lessonUrl}" }
  ]
}${faqSchema}]
</script>
<link rel="alternate" type="application/rss+xml" title="Japanese Grammar Notes RSS" href="${SITE}feed.xml">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>文</text></svg>">
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
<style>
${CSS}
/* Hide chrome that requires JS (menu toggle, TOC, settings overlay) but
   keep the sidebar — it works on hover via pure CSS and links are root-
   relative so they navigate from any standalone page. */
#menu-toggle, #toc-panel { display: none !important; }
#content { margin: 0 auto !important; max-width: 1000px; }
.back-link { display: block; margin-bottom: 1.5rem; color: var(--accent); text-decoration: none; font-size: 0.9rem; }
.back-link:hover { text-decoration: underline; }
.breadcrumb { font-size: 0.85rem; color: #666; margin-bottom: 0.5rem; }
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
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
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
  <section class="comments-section" aria-label="评论">
    <h2 class="comments-heading">评论 · Comments</h2>
    ${GISCUS_SCRIPT}
  </section>
</main>
<div id="bottom-controls">
  ${THEME_TOGGLE_HTML}
  <div id="furigana-toggle">
    <label><input type="checkbox" id="ruby-toggle" checked> 显示读音</label>
  </div>
  <div id="lang-toggle">
    <button id="lang-btn">EN</button>
  </div>
</div>
<script>
${THEME_TOGGLE_JS}
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
  rubyToggle.addEventListener('change', function(){ var hide = !this.checked; document.body.classList.toggle('hide-ruby', hide); savePrefs({ hideRuby: hide }); if (window.gaEvent) window.gaEvent('furigana_toggle', { visible: !hide }); });
  langBtn.addEventListener('click', function(){ isEn = !isEn; document.body.classList.toggle('lang-en', isEn); langBtn.textContent = isEn ? '中' : 'EN'; savePrefs({ isEn: isEn }); if (window.gaEvent) window.gaEvent('language_toggle', { to: isEn ? 'en' : 'zh' }); });
  // Learning-progression events: prev/next lesson + cross-link clicks. These
  // capture real reading/exploration behavior, unlike the toggle events above.
  document.addEventListener('click', function(e) {
    var prev = e.target.closest && e.target.closest('.pn-prev');
    var next = e.target.closest && e.target.closest('.pn-next');
    var cross = e.target.closest && e.target.closest('.cross-link');
    if (next && next.href && window.gaEvent) window.gaEvent('next_lesson', { from: location.pathname, to: new URL(next.href).pathname });
    else if (prev && prev.href && window.gaEvent) window.gaEvent('prev_lesson', { from: location.pathname, to: new URL(prev.href).pathname });
    else if (cross && cross.href && window.gaEvent) window.gaEvent('cross_link_click', { from: location.pathname, to: new URL(cross.href).pathname, term: (cross.querySelector('.cross-link-term') || {}).textContent || '' });
  });
})();
</script>
</body>
</html>`;

    fs.writeFileSync(path.join(lessonDir, "index.html"), lessonHtml, "utf-8");
  }

  // ─── Level overview pages (/N5/, /N4/, /N3/, /N2/) ───
  const LEVEL_INTRO = {
    N5: "JLPT N5 是日语入门级别，覆盖基础句型、助词、动词三类、ます形/て形/ない形/た形、形容词活用、条件表达、可能/受身/意向形与基础推测样态。",
    N4: "JLPT N4 在 N5 基础上深化使役、受身、使役受身、授受表现、ように系列、ことにする/なる、ばかり/ところ/てしまう、ておく/てある、わけだ/ものだ 等核心日常语法。",
    N3: "JLPT N3 是日语进阶分水岭，覆盖书面助词（において/に対して/について）、原因理由、逆接让步、程度范围、动作相关、并列添加、状态样态、否定与复合表达等核心语法点。",
    N2: "JLPT N2 是商务/学术级别语法，覆盖高阶逆接（からといって/つつも）、程度限定（に過ぎない/はもとより）、判断主张（わけがない/ということだ）、对比关系、感情不可抗、书面表达、仮定条件等高频考点。",
  };
  const LEVEL_KEYWORDS = {
    N5: "JLPT N5 语法清单, 日语 N5 语法总结, N5 文法一覧, N5 grammar list, 日语入门语法, JLPT N5 备考",
    N4: "JLPT N4 语法清单, 日语 N4 语法总结, N4 文法一覧, N4 grammar list, JLPT N4 备考, 日语进阶语法",
    N3: "JLPT N3 语法清单, 日语 N3 语法总结, N3 文法一覧, N3 grammar list, JLPT N3 备考, 日语进阶语法, N3 语法速查",
    N2: "JLPT N2 语法清单, 日语 N2 语法总结, N2 文法一覧, N2 grammar list, JLPT N2 备考, 日语商务语法, N2 语法速查",
  };
  const lessonsByLevel = { N5: [], N4: [], N3: [], N2: [] };
  for (const lesson of lessonPages) {
    if (lessonsByLevel[lesson.level]) lessonsByLevel[lesson.level].push(lesson);
  }
  const levelPageIds = [];
  for (const level of ["N5", "N4", "N3", "N2"]) {
    const lessons = lessonsByLevel[level].filter(l => /^lesson\d+/.test(l.id));
    if (lessons.length === 0) continue;
    const totalPoints = lessons.reduce((sum, l) => sum + (l.cleanPoints || []).length, 0);
    const levelDir = path.join(__dirname, "dist", level);
    fs.mkdirSync(levelDir, { recursive: true });
    const levelUrl = `${SITE}${level}/`;

    const ovTitle = `JLPT ${level} 语法清单 | ${lessons.length} 课 ${totalPoints}+ 语法点速查 - 日语 ${level} 语法总结`;
    const ovDesc = `日语 JLPT ${level} 全部语法点速查清单，含 ${lessons.length} 课、${totalPoints}+ 语法点的接续、含义、例句与辨析。免费 JLPT ${level} 备考笔记。`;
    const ovOgImage = `${SITE}${level}/og-image.png`;

    // Lesson cards: each shows day, title, grammar points, link
    const cardsHtml = lessons.map(l => {
      const lessonMatch = l.id.match(/^lesson(\d+)/);
      const dayLabel = lessonMatch ? `Lesson ${lessonMatch[1]}` : l.id;
      const points = (l.cleanPoints || []).slice(0, 4);
      const pointsHtml = points.length > 0
        ? `<div class="overview-points">${points.map(p => `<span class="grammar-pill">${p}</span>`).join("")}</div>`
        : "";
      return `<a class="overview-card" href="${SITE}${l.id}/">
        <div class="overview-card-head">
          <span class="overview-day">${dayLabel}</span>
          <span class="overview-title">${l.jaTitle}</span>
        </div>
        ${pointsHtml}
      </a>`;
    }).join("\n");

    // Full grammar points table for fast lookup
    const tableRows = [];
    for (const l of lessons) {
      const lessonMatch = l.id.match(/^lesson(\d+)/);
      const dayLabel = lessonMatch ? `Lesson ${lessonMatch[1]}` : l.id;
      for (const point of (l.cleanPoints || [])) {
        tableRows.push(`<tr><td><a href="${SITE}${l.id}/">${point}</a></td><td>${dayLabel}</td><td>${l.jaTitle}</td></tr>`);
      }
    }
    const tableHtml = tableRows.length > 0
      ? `<h2 id="grammar-index">${level} 全部语法点速查表</h2>
<table class="overview-table">
<thead><tr><th scope="col">语法点</th><th scope="col">课次</th><th scope="col">课题</th></tr></thead>
<tbody>${tableRows.join("\n")}</tbody>
</table>`
      : "";

    const ovHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ovTitle}</title>
<meta name="description" content="${ovDesc.replace(/"/g, '&quot;')}">
<meta name="keywords" content="${LEVEL_KEYWORDS[level]}">
<link rel="canonical" href="${levelUrl}">
<meta property="og:type" content="website">
<meta property="og:title" content="${ovTitle}">
<meta property="og:description" content="${ovDesc.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${levelUrl}">
<meta property="og:image" content="${ovOgImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ovTitle}">
<meta name="twitter:description" content="${ovDesc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${ovOgImage}">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "JLPT ${level} 语法清单",
  "description": "${ovDesc.replace(/"/g, '\\"')}",
  "url": "${levelUrl}",
  "inLanguage": ["zh-CN", "ja"],
  "isPartOf": { "@type": "Course", "name": "Japanese Grammar Notes – N5 to N2", "url": "${SITE}" },
  "hasPart": [${lessons.map(l => `{"@type": "Article", "name": "${l.jaTitle.replace(/"/g, '\\"')}", "url": "${SITE}${l.id}/"}`).join(",")}]
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "日语语法笔记", "item": "${SITE}" },
    { "@type": "ListItem", "position": 2, "name": "JLPT ${level}", "item": "${levelUrl}" }
  ]
}]
</script>
<link rel="alternate" type="application/rss+xml" title="Japanese Grammar Notes RSS" href="${SITE}feed.xml">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>文</text></svg>">
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
<style>
${CSS}
/* Keep sidebar (pure-CSS hover navigation) + theme toggle; hide other JS-dependent chrome. */
#menu-toggle, #toc-panel { display: none !important; }
#bottom-controls #furigana-toggle, #bottom-controls #lang-toggle { display: none !important; }
#content { margin: 0 auto !important; max-width: 1100px; padding: 2rem 1.5rem 4rem; }
.breadcrumb { font-size: .85rem; color: #666; margin-bottom: 1rem; }
.breadcrumb a { color: var(--accent); text-decoration: none; }
.breadcrumb .sep { margin: 0 .4em; }
.overview-intro { font-size: 1rem; line-height: 1.8; color: #444; margin: 1rem 0 2rem; padding: 1rem 1.2rem; background: #fafaf2; border-left: 3px solid var(--word-border); border-radius: 0 6px 6px 0; }
.overview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; margin: 1.5rem 0 2.5rem; }
.overview-card { display: block; padding: 1rem 1.2rem; background: #fff; border: 1px solid var(--border); border-radius: 8px; text-decoration: none; color: inherit; transition: all .15s; }
.overview-card:hover { border-color: var(--accent); box-shadow: 0 2px 12px rgba(233,69,96,.1); transform: translateY(-1px); }
.overview-card-head { display: flex; align-items: baseline; gap: .6rem; margin-bottom: .5rem; }
.overview-day { font-size: .75rem; font-weight: 700; color: var(--accent); white-space: nowrap; }
.overview-title { font-size: .95rem; font-weight: 600; color: #1a1a2e; }
.overview-points { display: flex; flex-wrap: wrap; gap: .3rem; }
.grammar-pill { font-size: .75rem; background: #f4f4f4; color: #555; padding: .15rem .5rem; border-radius: 4px; }
.overview-table { width: 100%; border-collapse: collapse; margin: 1rem 0 2rem; font-size: .9rem; }
.overview-table th { background: var(--word-bg); font-weight: 600; padding: .5rem .8rem; text-align: left; border: 1px solid var(--border); }
.overview-table td { padding: .4rem .8rem; border: 1px solid var(--border); }
.overview-table td:first-child { font-weight: 500; }
.overview-table a { color: var(--accent); text-decoration: none; }
.overview-table a:hover { text-decoration: underline; }
.level-stats { display: flex; gap: 2rem; margin: 1rem 0; padding: 1rem 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.level-stat strong { display: block; font-size: 1.6rem; color: var(--accent); }
.level-stat span { font-size: .8rem; color: #666; }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .overview-intro { background: #1f1f2e; color: #c8c8d4; }
  :root:not(.theme-light) .overview-card { background: #1f1f2e; }
  :root:not(.theme-light) .overview-title { color: #f0f0f5; }
  :root:not(.theme-light) .grammar-pill { background: #25253a; color: #c8c8d4; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark .overview-intro { background: #1f1f2e; color: #c8c8d4; }
html.theme-dark .overview-card { background: #1f1f2e; }
html.theme-dark .overview-title { color: #f0f0f5; }
html.theme-dark .grammar-pill { background: #25253a; color: #c8c8d4; }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}">日语语法笔记</a><span class="sep">›</span><span>JLPT ${level} 语法清单</span>
  </nav>
  <h1>JLPT ${level} 语法清单 - ${lessons.length} 课 ${totalPoints}+ 语法点速查</h1>
  <p class="overview-intro">${LEVEL_INTRO[level]}</p>
  <div class="level-stats">
    <div class="level-stat"><strong>${lessons.length}</strong><span>课</span></div>
    <div class="level-stat"><strong>${totalPoints}+</strong><span>语法点</span></div>
    <div class="level-stat"><strong>免费</strong><span>双语笔记</span></div>
  </div>
  <h2>分课目录</h2>
  <div class="overview-grid">${cardsHtml}</div>
  ${tableHtml}
</main>
<div id="bottom-controls">${THEME_TOGGLE_HTML}</div>
<script>
${THEME_TOGGLE_JS}
</script>
</body>
</html>`;
    fs.writeFileSync(path.join(levelDir, "index.html"), ovHtml, "utf-8");
    levelPageIds.push(level);
  }
  console.log(`  Generated ${levelPageIds.length} level overview pages: ${levelPageIds.join(", ")}`);

  // ─── About page (E-E-A-T signal: who built this and why) ───
  const aboutMdPath = path.join(__dirname, "pages/about.md");
  let aboutPageGenerated = false;
  if (fs.existsSync(aboutMdPath)) {
    const aboutMd = fs.readFileSync(aboutMdPath, "utf-8");
    // Process :::zh / :::en bilingual blocks (same pattern as lesson md).
    const aboutMdBilingual = aboutMd.replace(
      /^:::(zh|en)\s*\n([\s\S]*?)^:::\s*$/gm,
      (_, lang, content) => `<!--lang:${lang}:start-->\n${content.trim()}\n<!--lang:${lang}:end-->`
    );
    let aboutHtml = await marked.parse(aboutMdBilingual);
    aboutHtml = aboutHtml.replace(/<!--lang:(zh|en):start-->/g, (_, lang) =>
      lang === "zh" ? '<div class="lang-zh" lang="zh-CN">' : '<div class="lang-en" lang="en">'
    );
    aboutHtml = aboutHtml.replace(/<!--lang:(zh|en):end-->/g, '</div>');
    // Bilingual headings: <h2>中文||English</h2>
    aboutHtml = aboutHtml.replace(
      /(<h[1-6][^>]*>)(.+?)\|\|(.+?)(<\/h[1-6]>)/g,
      (_, open, zh, en, close) =>
        `${open}<span class="lang-zh">${zh.trim()}</span><span class="lang-en">${en.trim()}</span>${close}`
    );
    const aboutUrl = `${SITE}about/`;
    const aboutDir = path.join(__dirname, "dist/about");
    fs.mkdirSync(aboutDir, { recursive: true });
    const aboutTitle = "关于本站 - 日语语法笔记 | 作者、内容来源与开源协议";
    const aboutDesc = "了解日语语法笔记是谁做的、为什么做、参考了哪些资料、如何反馈错误。免费、开源、CC BY 4.0 许可的 JLPT N5-N2 学习笔记。";
    const aboutKeywords = "日语语法笔记关于, 作者, jpnotes.dev, 日语学习, JLPT 自学, 中文母语者";
    const aboutOgImage = `${SITE}about/og-image.png`;

    const aboutPageHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${aboutTitle}</title>
<meta name="description" content="${aboutDesc.replace(/"/g, '&quot;')}">
<meta name="keywords" content="${aboutKeywords}">
<link rel="canonical" href="${aboutUrl}">
<meta property="og:type" content="website">
<meta property="og:title" content="${aboutTitle}">
<meta property="og:description" content="${aboutDesc.replace(/"/g, '&quot;')}">
<meta property="og:url" content="${aboutUrl}">
<meta property="og:image" content="${aboutOgImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${aboutTitle}">
<meta name="twitter:description" content="${aboutDesc.replace(/"/g, '&quot;')}">
<meta name="twitter:image" content="${aboutOgImage}">
<script type="application/ld+json">
[{
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "name": "关于日语语法笔记",
  "description": "${aboutDesc.replace(/"/g, '\\"')}",
  "url": "${aboutUrl}",
  "isPartOf": { "@type": "WebSite", "name": "日语语法笔记", "url": "${SITE}" },
  "mainEntity": {
    "@type": "Person",
    "name": "Ralphbupt",
    "url": "https://github.com/Ralphbupt",
    "email": "pengcheng199@gmail.com",
    "sameAs": ["https://github.com/Ralphbupt"]
  }
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "日语语法笔记", "item": "${SITE}" },
    { "@type": "ListItem", "position": 2, "name": "关于本站", "item": "${aboutUrl}" }
  ]
}]
</script>
<link rel="alternate" type="application/rss+xml" title="Japanese Grammar Notes RSS" href="${SITE}feed.xml">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>文</text></svg>">
${THEME_INIT_SCRIPT}
${GTAG_DEFERRED}
<style>
${CSS}
/* Keep sidebar (pure-CSS hover) + lang toggle; hide other JS-dependent chrome. */
#menu-toggle, #toc-panel, #furigana-toggle { display: none !important; }
#content { margin: 0 auto !important; max-width: 800px; padding: 2rem 2rem 4rem; }
.breadcrumb { font-size: .85rem; color: #666; margin-bottom: 1rem; }
.breadcrumb a { color: var(--accent); text-decoration: none; }
.breadcrumb .sep { margin: 0 .4em; }
.about-content h1 { font-size: 2rem; margin: 0 0 1.5rem; border-bottom: 2px solid var(--accent); padding-bottom: .6rem; }
.about-content h2 { font-size: 1.4rem; margin: 2.2rem 0 .9rem; color: #1a1a2e; }
.about-content p, .about-content li { line-height: 1.85; }
.about-content ul { margin: .6rem 0 .6rem 1.4rem; }
.about-content li { margin: .3rem 0; }
.about-content blockquote { background: rgba(233,69,96,.04); border-left: 3px solid var(--accent); padding: .7rem 1.1rem; margin: 1rem 0; color: #555; }
.about-content a { color: var(--accent); text-decoration: none; }
.about-content a:hover { text-decoration: underline; }
.about-content code { background: var(--code-bg); padding: .1rem .3rem; border-radius: 3px; font-size: .9em; }
.about-content strong { color: #1a1a2e; }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .about-content h2 { color: #e4e4ec; }
  :root:not(.theme-light) .about-content strong { color: #f0f0f5; }
  :root:not(.theme-light) .about-content blockquote { background: rgba(233,69,96,.08); color: #b8b8c4; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark .about-content h2 { color: #e4e4ec; }
html.theme-dark .about-content strong { color: #f0f0f5; }
html.theme-dark .about-content blockquote { background: rgba(233,69,96,.08); color: #b8b8c4; }
</style>
</head>
<body class="sidebar-collapsed">
${sidebarMarkupHtml}
<main id="content">
  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="${SITE}">日语语法笔记</a><span class="sep">›</span><span><span class="lang-zh">关于本站</span><span class="lang-en">About</span></span>
  </nav>
  <article class="about-content">${aboutHtml}</article>
</main>
<div id="bottom-controls">
  ${THEME_TOGGLE_HTML}
  <div id="lang-toggle">
    <button id="lang-btn">EN</button>
  </div>
</div>
<script>
${THEME_TOGGLE_JS}
(function(){
  var langBtn = document.getElementById('lang-btn');
  var STORE_KEY = 'jp_grammar_prefs';
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) { return {}; } }
  function savePrefs(patch) { var p = loadPrefs(); for (var k in patch) p[k] = patch[k]; localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
  var prefs = loadPrefs();
  var isEn = ('isEn' in prefs) ? prefs.isEn : !/^zh/i.test(navigator.language || '');
  if (isEn) { document.body.classList.add('lang-en'); langBtn.textContent = '中'; }
  langBtn.addEventListener('click', function(){ isEn = !isEn; document.body.classList.toggle('lang-en', isEn); langBtn.textContent = isEn ? '中' : 'EN'; savePrefs({ isEn: isEn }); if (window.gaEvent) window.gaEvent('language_toggle', { to: isEn ? 'en' : 'zh' }); });
})();
</script>
</body>
</html>`;
    fs.writeFileSync(path.join(aboutDir, "index.html"), aboutPageHtml, "utf-8");
    aboutPageGenerated = true;
    console.log("  Generated dist/about/index.html");
  }

  // ─── Redirect stubs for old /dayNN/ URLs ───
  // After renaming day → lesson, previously-indexed /dayNN/ URLs would 404.
  // Generate a tiny page at each /dayNN/ that meta-refreshes to /lessonNN/.
  // Google's docs explicitly call <meta http-equiv="refresh" content="0;url=">
  // a 301-equivalent — old links and search results transition cleanly.
  let stubCount = 0;
  for (const [oldId, newId] of Object.entries(DAY_TO_LESSON)) {
    const newUrl = `${SITE}${newId}/`;
    const stubDir = path.join(__dirname, "dist", oldId);
    fs.mkdirSync(stubDir, { recursive: true });
    fs.writeFileSync(path.join(stubDir, "index.html"), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=${newUrl}">
<link rel="canonical" href="${newUrl}">
<meta name="robots" content="noindex">
<title>已移动 — ${newUrl}</title>
</head>
<body>
<p>本页已迁移至 <a href="${newUrl}">${newUrl}</a></p>
<script>location.replace(${JSON.stringify(newUrl)})</script>
</body>
</html>`, "utf-8");
    stubCount++;
  }
  console.log(`  Generated ${stubCount} day → lesson redirect stubs`);

  // ─── Sitemap ───
  const homeMod = gitLastMod("schedule.md") || today;
  const sitemapUrls = [`  <url>
    <loc>${SITE}</loc>
    <lastmod>${homeMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`];
  // About page (E-E-A-T page, lower priority since not browsed often)
  if (aboutPageGenerated) {
    sitemapUrls.push(`  <url>
    <loc>${SITE}about/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>`);
  }
  // Anki landing page (downloadable flashcards)
  sitemapUrls.push(`  <url>
    <loc>${SITE}anki/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
  // Level overview pages (high priority — major landing pages)
  for (const level of levelPageIds) {
    sitemapUrls.push(`  <url>
    <loc>${SITE}${level}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);
  }
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

  // IndexNow ownership key — must be reachable at https://<host>/<key>.txt and
  // contain exactly the key. CI (indexnow.mjs) submits URLs referencing it.
  fs.writeFileSync(path.join(__dirname, `dist/${INDEXNOW_KEY}.txt`), INDEXNOW_KEY + "\n", "utf-8");

  // CNAME for GitHub Pages custom domain. Skipped while SITE points at
  // *.github.io (no custom domain in use); written automatically once
  // SITE is changed to e.g. https://jpnotes.dev/.
  const cnameHost = new URL(SITE).hostname;
  if (!cnameHost.endsWith(".github.io")) {
    fs.writeFileSync(path.join(__dirname, "dist/CNAME"), cnameHost + "\n", "utf-8");
  }

  // ─── RSS Feed ───
  const rssItems = lessonPages.map(lesson => {
    const mod = gitLastMod(lesson.filePath) || today;
    const pubDate = new Date(mod + "T00:00:00Z").toUTCString();
    const lessonDescRss = lesson.grammarPoints && lesson.grammarPoints.length > 0
      ? `Learn ${lesson.grammarPoints.slice(0, 4).join(", ")} – Japanese grammar lesson with examples.`
      : `${lesson.title} – Japanese grammar lesson with conjugation rules and examples.`;
    return `    <item>
      <title>${lesson.jaTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>
      <link>${SITE}${lesson.id}/</link>
      <description>${lessonDescRss.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</description>
      <pubDate>${pubDate}</pubDate>
      <guid>${SITE}${lesson.id}/</guid>
    </item>`;
  });
  fs.writeFileSync(path.join(__dirname, "dist/feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Japanese Grammar Notes | 日语语法笔记</title>
    <link>${SITE}</link>
    <description>Free structured Japanese grammar notes from N5 to N2 in 8 weeks. Bilingual with examples and spaced repetition.</description>
    <language>ja</language>
    <atom:link href="${SITE}feed.xml" rel="self" type="application/rss+xml"/>
${rssItems.join("\n")}
  </channel>
</rss>
`, "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/llms.txt"), `# Japanese Grammar Notes / 日语语法笔记

> Free, structured Japanese grammar notes covering JLPT N5 → N2 in an 8-week curriculum. Bilingual: Chinese explanations + Japanese examples with furigana annotations. ${lessonPages.length} lessons, 400+ grammar points, each with conjugation rules, 3+ example sentences, comparisons between easily confused patterns, and spaced-repetition checklists.

Site: ${SITE}
Author: Ralphbupt (https://github.com/Ralphbupt)
License: CC BY 4.0 — attribution required, no full-site mirroring

## Main pages

- [Home / 主页](${SITE}): Site overview, level cards, getting started.
- [About / 关于](${SITE}about/): Author bio, content sources, methodology, contact, license details.

## JLPT levels (lesson groups)

- [N5 overview / N5 级别概览](${SITE}N5/): Basic sentence patterns, particles, verb groups, て-form, ない-form, た-form, adjectives, conditionals, potential, passive, volitional, conjecture. ${levelCounts.N5} lessons.
- [N4 overview / N4 级别概览](${SITE}N4/): Causative, passive, giving/receiving, ように, ことにする/なる, わけだ/ものだ. ${levelCounts.N4} lessons.
- [N3 overview / N3 级别概览](${SITE}N3/): Formal particles, cause/reason, concession, degree/extent, state, negation, compound expressions. ${levelCounts.N3} lessons.
- [N2 overview / N2 级别概览](${SITE}N2/): Advanced concession, degree/limitation, judgment, contrast, written-formal grammar. ${levelCounts.N2} lessons.

## Grammar checklists (full point-by-point listings)

- [N5 grammar list / N5 文法チェックリスト](${SITE}N5_grammar_list/): All ~70 N5 grammar points with progress checkboxes.
- [N4 grammar list / N4 文法チェックリスト](${SITE}N4_grammar_list/): All ~74 N4 grammar points (excluding N5 overlap).
- [N3 grammar list / N3 文法チェックリスト](${SITE}N3_grammar_list/): All ~150 N3 grammar points.
- [N2 grammar list / N2 文法チェックリスト](${SITE}N2_grammar_list/): All ~130 N2 grammar points.

## Feeds and metadata

- [RSS feed](${SITE}feed.xml): Lesson update feed.
- [Sitemap](${SITE}sitemap.xml): Full list of indexable URLs.
- [Source code](https://github.com/Ralphbupt/japanese-grammar): Markdown content and build scripts (Node.js + marked + kuroshiro).

## Lesson page structure

Each \`/lessonNN/\` page contains:
- Conjugation rules (接続)
- Meaning / usage (含义 / 用法)
- 3+ example sentences with furigana (例句)
- Comparison with similar grammar (辨析)
- Common mistakes for Chinese-native speakers (易错点)
- Spaced-repetition checklist (复习计划)
`, "utf-8");

  fs.writeFileSync(path.join(__dirname, "dist/manifest.json"), JSON.stringify({
    name: "日语语法笔记 – N5→N2",
    short_name: "日语文法",
    start_url: SITE_PATH,
    scope: SITE_PATH,
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
  <a href="${SITE_PATH}">← ホームに戻る</a>
</div>
</body>
</html>`, "utf-8");

  // ─── OG Image (SVG → PNG via sharp) ───
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
  <text x="600" y="550" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666666">${SITE_HOST}</text>
</svg>`;
  fs.writeFileSync(path.join(__dirname, "dist/og-image.svg"), ogSvg, "utf-8");

  // Convert main OG SVG to PNG using sharp (#1)
  await sharp(Buffer.from(ogSvg))
    .resize(1200, 630)
    .png()
    .toFile(path.join(__dirname, "dist/og-image.png"));
  console.log("  Generated dist/og-image.png (1200x630)");

  // ─── Per-lesson OG Images (#7) ───
  console.log("Generating per-lesson OG images...");
  for (const lesson of lessonPages) {
    const lessonDir = path.join(__dirname, "dist", lesson.id);
    fs.mkdirSync(lessonDir, { recursive: true });
    // Escape special XML characters in text
    const escJaTitle = (lesson.jaTitle || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const level = lesson.level || "N5";
    const lessonOgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="#e94560" stroke-width="2" opacity="0.3"/>
  <text x="600" y="180" text-anchor="middle" font-family="sans-serif" font-size="48" fill="#e94560" font-weight="bold">JLPT ${level}</text>
  <text x="600" y="310" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="64" fill="#ffffff" font-weight="bold">${escJaTitle}</text>
  <text x="600" y="430" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="32" fill="#c8c8d8">Japanese Grammar Notes</text>
  <text x="600" y="550" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666666">${SITE_HOST}</text>
</svg>`;
    await sharp(Buffer.from(lessonOgSvg))
      .resize(1200, 630)
      .png()
      .toFile(path.join(lessonDir, "og-image.png"));
  }
  console.log(`  Generated ${lessonPages.length} per-lesson OG images`);

  // ─── Index-page OG Images (N5/N4/N3/N2 level pages, about, anki) ───
  // Each shareable index page gets a tailored 1200×630 social preview so a
  // share to XHS / X / Threads / WeChat surfaces a distinctive image rather
  // than the generic site-wide one.
  const ogLevelCounts = { N5: 0, N4: 0, N3: 0, N2: 0 };
  for (const lp of lessonPages) {
    if (lp.level && ogLevelCounts.hasOwnProperty(lp.level)) ogLevelCounts[lp.level]++;
  }
  const indexOgPages = [
    { slug: "N5", topLabel: "JLPT N5", mainTitle: "N5 文法チェックリスト", sub: `${ogLevelCounts.N5} 课 · 53+ 语法点`, accent: "#e94560" },
    { slug: "N4", topLabel: "JLPT N4", mainTitle: "N4 文法チェックリスト", sub: `${ogLevelCounts.N4} 课 · 54+ 语法点`, accent: "#e94560" },
    { slug: "N3", topLabel: "JLPT N3", mainTitle: "N3 文法チェックリスト", sub: `${ogLevelCounts.N3} 课 · 100+ 语法点`, accent: "#e94560" },
    { slug: "N2", topLabel: "JLPT N2", mainTitle: "N2 文法チェックリスト", sub: `${ogLevelCounts.N2} 课 · 75+ 语法点`, accent: "#e94560" },
    { slug: "about", topLabel: "About · 关于", mainTitle: "日语语法笔记", sub: "N5 → N2 · 8 Weeks · Free", accent: "#e94560" },
    { slug: "anki", topLabel: "Anki Decks", mainTitle: "JLPT 文法 卡组", sub: "N5 · N4 · N3 · N2 · 297 张卡", accent: "#e94560" },
  ];
  for (const p of indexOgPages) {
    const dir = path.join(__dirname, "dist", p.slug);
    fs.mkdirSync(dir, { recursive: true });
    const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="${p.accent}" stroke-width="2" opacity="0.3"/>
  <text x="600" y="200" text-anchor="middle" font-family="sans-serif" font-size="48" fill="${p.accent}" font-weight="bold">${esc(p.topLabel)}</text>
  <text x="600" y="330" text-anchor="middle" font-family="Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif" font-size="80" fill="#ffffff" font-weight="bold">${esc(p.mainTitle)}</text>
  <text x="600" y="430" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#c8c8d8">${esc(p.sub)}</text>
  <text x="600" y="550" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666666">${SITE_HOST}</text>
</svg>`;
    await sharp(Buffer.from(svg))
      .resize(1200, 630)
      .png()
      .toFile(path.join(dir, "og-image.png"));
  }
  console.log(`  Generated ${indexOgPages.length} index-page OG images (N5/N4/N3/N2/about/anki)`);

  console.log(`Done! Output: ${OUT}, sitemap.xml, robots.txt, feed.xml, llms.txt, manifest.json, 404.html, og-image.png`);
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
html { font-size: 19px; }
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
  display: block;
  font-size: .75rem; text-transform: uppercase; letter-spacing: .08em;
  color: var(--accent); padding: .8rem 1.2rem .3rem;
  font-weight: 700; white-space: nowrap;
  text-decoration: none;
}
.nav-group-link:hover { color: #fff; }
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
  max-width: 1050px;
  transition: margin-left .25s;
}
body.sidebar-collapsed #content {
  margin-left: 48px;
}
.lesson { display: none; content-visibility: auto; contain-intrinsic-size: 0 500px; }
.lesson.active { display: block; content-visibility: visible; }
.comments-section { margin-top: 3rem; padding-top: 2rem; border-top: 2px solid var(--border); }
.comments-heading { font-size: 1.2rem; margin: 0 0 1rem; color: #666; font-weight: 600; }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .comments-heading { color: #999; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark .comments-heading { color: #999; }

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
  text-decoration: line-through; color: #7a7a7a;
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

/* SEO lead paragraph (keyword-rich summary after h1) */
.seo-lead {
  font-size: .95rem; color: #555;
  background: #fafaf2; border-left: 3px solid var(--word-border);
  padding: .7rem 1rem; margin: 0 0 1.5rem;
  border-radius: 0 6px 6px 0;
  line-height: 1.7;
}
.seo-lead strong { color: var(--accent); font-weight: 600; }

/* Lesson meta line (last-updated, reading time) — sits between h1 and seo-lead */
.lesson-meta {
  font-size: .82rem; color: #666;
  margin: -.6rem 0 1.2rem;
}
.lesson-meta time { color: #555; }

/* TTS speak button on example sentences */
.speak-btn {
  display: inline-block;
  background: none; border: 1px solid var(--border);
  border-radius: 50%; width: 1.6em; height: 1.6em;
  font-size: .75rem; line-height: 1.5em;
  cursor: pointer; margin-left: .4em;
  vertical-align: middle; padding: 0;
  opacity: .5; transition: opacity .2s, border-color .2s;
}
.speak-btn:hover { opacity: 1; border-color: var(--accent); }
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) .speak-btn { border-color: #3a3a55; }
  :root:not(.theme-light) .speak-btn:hover { border-color: var(--accent); }
}
html.theme-dark .speak-btn { border-color: #3a3a55; }
html.theme-dark .speak-btn:hover { border-color: var(--accent); }

/* Cross-links */
.related-grammar {
  background: #f0f8ff; border: 1px solid #d0e8f8; border-radius: 8px;
  padding: .6rem 1rem; margin: 1.5rem 0; font-size: .85rem;
}
.related-label { font-weight: 600; color: #666; margin-right: .5rem; }
.cross-link {
  display: inline-block; background: #e8f4fd; color: var(--accent);
  padding: .15rem .55rem; border-radius: 4px; margin: .15rem .2rem;
  text-decoration: none; font-size: .82rem;
  line-height: 1.5;
}
.cross-link:hover { background: var(--accent); color: #fff; }
.cross-link:hover .cross-link-desc,
.cross-link:hover .cross-link-level { color: rgba(255,255,255,.9); background: rgba(255,255,255,.18); }
.cross-link-term { font-weight: 600; }
.cross-link-desc { opacity: .8; font-size: .88em; margin-left: .35em; }
.cross-link-desc::before { content: "· "; opacity: .55; }
.cross-link-level {
  display: inline-block; margin-left: .4em;
  font-size: .68em; font-weight: 700; letter-spacing: .03em;
  background: rgba(233,69,96,.13); color: var(--accent);
  padding: .05em .4em; border-radius: 3px;
  vertical-align: 1px;
}

/* Details */
details {
  background: #f7f7f7; border-radius: 6px;
  padding: .5rem 1rem; margin: .8rem 0;
}
summary {
  cursor: pointer; font-weight: 600; color: var(--accent);
  padding: .2rem 0;
}

/* Top controls */
#bottom-controls {
  position: fixed; top: .8rem; right: 1.2rem;
  display: flex; align-items: center; gap: .5rem; z-index: 200;
}
#furigana-toggle, #lang-toggle, #theme-toggle {
  background: var(--card-bg); color: inherit;
  padding: .4rem .8rem; border-radius: 6px;
  font-size: .8rem;
  border: 1px solid var(--border);
  box-shadow: 0 1px 4px rgba(0,0,0,.08);
}
#furigana-toggle label { cursor: pointer; }
#furigana-toggle input { margin-right: .3rem; }
#lang-btn, #theme-btn {
  background: none; border: none; color: inherit;
  font-size: 1rem; cursor: pointer;
  padding: 0; line-height: 1;
}
#lang-btn { font-size: .8rem; font-weight: 700; }
#theme-btn { font-size: 1.05rem; }

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

/* Home page landing layout (no lesson articles inlined).
   Hide the right-hand TOC panel (no lessons to navigate within) and
   center the directory horizontally. Sidebar is position: fixed and
   doesn't occupy flow, so margin: 0 auto centers cleanly across the
   viewport on wide screens. */
body:has(#content.home) #toc-panel { display: none; }
#content.home,
body.sidebar-collapsed #content.home {
  max-width: 1100px;
  margin-left: auto;
  margin-right: auto;
}
.home-hero {
  text-align: center;
  padding: 2.5rem 1rem 1.8rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 2.2rem;
}
.home-hero h1 {
  font-size: 2rem; margin: 0 0 1rem;
  border: none; padding: 0; color: #1a1a2e;
}
.home-intro {
  font-size: 1rem; color: #555;
  max-width: 680px; margin: 0 auto 1.6rem;
  line-height: 1.75;
}
.home-intro strong { color: var(--accent); font-weight: 600; }
.home-stats {
  display: flex; justify-content: center; gap: 2.2rem;
  flex-wrap: wrap;
  margin: 1rem 0 .3rem;
}
.home-stat { text-align: center; }
.home-stat strong {
  display: block; font-size: 1.7rem; color: var(--accent);
  font-weight: 700; line-height: 1.1;
}
.home-stat span { font-size: .78rem; color: #666; }
.home-levels h2, .home-howto h2 {
  font-size: 1.35rem; margin: 2rem 0 1rem; color: #1a1a2e;
}
.level-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.2rem;
  margin: 1rem 0 2.4rem;
}
@media (max-width: 640px) {
  .level-grid { grid-template-columns: 1fr; }
}
.level-card {
  display: block;
  padding: 1.4rem 1.6rem;
  background: #fff; border: 1px solid var(--border);
  border-radius: 10px;
  text-decoration: none; color: inherit;
  transition: all .2s;
}
.level-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 18px rgba(233,69,96,.12);
  transform: translateY(-2px);
}
.level-tag {
  display: inline-block;
  padding: .2rem .65rem;
  /* Slightly darker than --accent so #fff text passes AA 4.5:1 contrast. */
  background: #d6354c; color: #fff;
  font-size: .82rem; font-weight: 700;
  border-radius: 4px; letter-spacing: .05em;
  margin-bottom: .9rem;
}
.level-card h3 {
  font-size: 1.25rem; margin: .2rem 0 .6rem;
  color: #1a1a2e;
}
.level-card p {
  font-size: 1rem; color: #666;
  line-height: 1.65; margin: 0;
}
.home-howto p {
  color: #555; line-height: 1.75;
  margin: .6rem 0;
}
.home-howto a {
  color: var(--accent); text-decoration: underline;
  text-underline-offset: 2px;
}
.home-howto a:hover { text-decoration: underline; text-decoration-thickness: 2px; }

/* ─── Dark mode (follows OS preference) ───
   The site already uses CSS variables for most colors, so overriding
   them here flips the palette without touching individual rules. The
   accent red (#e94560) and ruby furigana color stay — they read well
   on both light and dark backgrounds. */
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) {
    --bg: #14141e;
    --sidebar-bg: #0a0a14;
    --sidebar-text: #b8b8c4;
    --card-bg: #1f1f2e;
    --border: #2d2d44;
    --word-bg: #2a2618;
    --word-border: #5a4920;
    --code-bg: #1f1f2e;
    --ruby-color: #ff7088;  /* lighter than --accent so furigana stays readable on dark blockquote tints */
  }
  /* Accent-colored strong text fails 4.5:1 on dark card surfaces; brighten. */
  :root:not(.theme-light) .seo-lead strong, :root:not(.theme-light) .home-intro strong { color: #ff7088; }
  /* .breadcrumb is defined on each page; override gray contrast for dark. */
  :root:not(.theme-light) .breadcrumb { color: #999 !important; }
  /* .related-label gray on the (red-tinted) related-grammar box was 4.46
     in dark mode (just under AA 4.5). Lighten to clear the bar. */
  :root:not(.theme-light) .related-label { color: #a8a8b8; }
  :root:not(.theme-light) body { color: #d4d4dc; }
  :root:not(.theme-light) h1 { color: #f0f0f5; }
  :root:not(.theme-light) h2 { color: #e4e4ec; }
  :root:not(.theme-light) h3, :root:not(.theme-light) h4 { color: #d8d8e0; }
  :root:not(.theme-light) th { background: #25253a; color: #e4e4ec; }
  :root:not(.theme-light) tr:nth-child(even) { background: rgba(255, 255, 255, 0.025); }
  :root:not(.theme-light) blockquote { background: rgba(233, 69, 96, 0.08); }
  :root:not(.theme-light) details { background: #1f1f2e; }
  :root:not(.theme-light) ul:has(input[type="checkbox"]) li:hover { background: #1f1f2e; }
  :root:not(.theme-light) ul:has(input[type="checkbox"]) li.checked { color: #6a6a78; }
  :root:not(.theme-light) .seo-lead { background: #1f1f2e; color: #c8c8d4; }
  :root:not(.theme-light) .lesson-meta { color: #a8a8b8; }
  :root:not(.theme-light) .lesson-meta time { color: #b8b8c4; }
  :root:not(.theme-light) .related-grammar { background: #1a223a; border-color: #2a3a55; }
  :root:not(.theme-light) .cross-link { background: #1f3548; color: #ff7088; }
  :root:not(.theme-light) .cross-link:hover { background: var(--accent); color: #fff; }
  :root:not(.theme-light) .checklist-progress { background: #1f1f2e; color: #b8b8c4; }
  :root:not(.theme-light) .checklist-progress .progress-bar { background: #2d2d44; }
  /* Home page */
  :root:not(.theme-light) .home-hero h1 { color: #f0f0f5; }
  :root:not(.theme-light) .home-intro { color: #b8b8c4; }
  :root:not(.theme-light) .home-stat span { color: #888; }
  :root:not(.theme-light) .home-levels h2, :root:not(.theme-light) .home-howto h2 { color: #e4e4ec; }
  :root:not(.theme-light) .level-card { background: #1f1f2e; }
  :root:not(.theme-light) .level-card h3 { color: #f0f0f5; }
  :root:not(.theme-light) .level-card p { color: #b8b8c4; }
  :root:not(.theme-light) .home-howto p { color: #b8b8c4; }
  /* Code */
  :root:not(.theme-light) code { color: #f0a0b0; }
  :root:not(.theme-light) pre code { color: #d4d4dc; }
}

/* Manual dark override (toggled via JS, mirrors media query rules) */
html.theme-dark {
    --bg: #14141e;
    --sidebar-bg: #0a0a14;
    --sidebar-text: #b8b8c4;
    --card-bg: #1f1f2e;
    --border: #2d2d44;
    --word-bg: #2a2618;
    --word-border: #5a4920;
    --code-bg: #1f1f2e;
    --ruby-color: #ff7088;  /* lighter than --accent so furigana stays readable on dark blockquote tints */
  }
/* Accent-colored strong text fails 4.5:1 on dark card surfaces; brighten. */
html.theme-dark .seo-lead strong, html.theme-dark .home-intro strong { color: #ff7088; }
/* .breadcrumb is defined on each page; override gray contrast for dark. */
html.theme-dark .breadcrumb { color: #999 !important; }
/* .related-label gray on the (red-tinted) related-grammar box was 4.46
     in dark mode (just under AA 4.5). Lighten to clear the bar. */
html.theme-dark .related-label { color: #a8a8b8; }
html.theme-dark body { color: #d4d4dc; }
html.theme-dark h1 { color: #f0f0f5; }
html.theme-dark h2 { color: #e4e4ec; }
html.theme-dark h3, html.theme-dark h4 { color: #d8d8e0; }
html.theme-dark th { background: #25253a; color: #e4e4ec; }
html.theme-dark tr:nth-child(even) { background: rgba(255, 255, 255, 0.025); }
html.theme-dark blockquote { background: rgba(233, 69, 96, 0.08); }
html.theme-dark details { background: #1f1f2e; }
html.theme-dark ul:has(input[type="checkbox"]) li:hover { background: #1f1f2e; }
html.theme-dark ul:has(input[type="checkbox"]) li.checked { color: #6a6a78; }
html.theme-dark .seo-lead { background: #1f1f2e; color: #c8c8d4; }
html.theme-dark .lesson-meta { color: #a8a8b8; }
html.theme-dark .lesson-meta time { color: #b8b8c4; }
html.theme-dark .related-grammar { background: #1a223a; border-color: #2a3a55; }
html.theme-dark .cross-link { background: #1f3548; color: #ff7088; }
html.theme-dark .cross-link:hover { background: var(--accent); color: #fff; }
html.theme-dark .checklist-progress { background: #1f1f2e; color: #b8b8c4; }
html.theme-dark .checklist-progress .progress-bar { background: #2d2d44; }
/* Home page */
html.theme-dark .home-hero h1 { color: #f0f0f5; }
html.theme-dark .home-intro { color: #b8b8c4; }
html.theme-dark .home-stat span { color: #888; }
html.theme-dark .home-levels h2, html.theme-dark .home-howto h2 { color: #e4e4ec; }
html.theme-dark .level-card { background: #1f1f2e; }
html.theme-dark .level-card h3 { color: #f0f0f5; }
html.theme-dark .level-card p { color: #b8b8c4; }
html.theme-dark .home-howto p { color: #b8b8c4; }
/* Code */
html.theme-dark code { color: #f0a0b0; }
html.theme-dark pre code { color: #d4d4dc; }
`;

// ─── JS ───
const JS = `
${THEME_TOGGLE_JS}
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

  function isModifiedClick(e) {
    return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
  }

  items.forEach(function(item){
    item.addEventListener('click', function(e){
      if (isModifiedClick(e)) return;
      // Home page has no inline lesson articles — let the browser follow
      // the link to the standalone /dayXX/ page instead of intercepting.
      if (lessons.length === 0) return;
      e.preventDefault();
      var id = this.getAttribute('data-target');
      show(id);
      history.replaceState(null,null,'#'+id);
    });
  });

  // Cross-link navigation
  document.addEventListener('click', function(e) {
    var link = e.target.closest('.cross-link');
    if (!link) return;
    if (isModifiedClick(e)) return;
    var targetId = link.getAttribute('data-target');
    if (!document.getElementById(targetId)) return;
    e.preventDefault();
    var scrollTo = link.getAttribute('data-scroll');
    show(targetId);
    history.replaceState(null, null, '#' + targetId);
    if (window.gaEvent) window.gaEvent('cross_link_click', { from: currentLesson || '', to: targetId, term: (link.querySelector('.cross-link-term') || {}).textContent || '' });
    if (scrollTo) {
      setTimeout(function() {
        var el = document.getElementById(scrollTo);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
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
    if (window.gaEvent) window.gaEvent('furigana_toggle', { visible: !hide });
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
    if (window.gaEvent) window.gaEvent('language_toggle', { to: isEn ? 'en' : 'zh' });
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
