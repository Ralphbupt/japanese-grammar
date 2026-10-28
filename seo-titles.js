// Hand-written <title> tags per page, phrased the way learners actually search.
//
// en — the main /lessonNN/ page. English-first for Google: the Japanese pattern
//      up front, its romaji in parens (learners type "you ni naru meaning",
//      not ようになる), then "vs" / "meaning" / "difference" wording.
// zh — the /zh/lessonNN/ page, for Bing China: "用法" / "区别" / "总结" wording.
//
// Pages missing here fall back to the templated title in build.js. Rewrite a
// title when Search Console shows a page with many impressions but few clicks
// (tools/gsc-report.py lists them), and keep each one under ~65 characters.
module.exports = {
  lesson00: {
    en: "Hiragana & Katakana Chart (Gojūon) — Japanese Syllabary Basics",
    zh: "五十音图（平假名・片假名）完整对照表 | 日语入门",
  },
  lesson01: {
    en: "です, は vs が (wa vs ga) — Basic Japanese Particles | JLPT N5",
    zh: "です・は和が的区别 — 日语判断句与基础助词 | JLPT N5 语法",
  },
  lesson02: {
    en: "を, に vs で, へ, と (wo, ni, de) — Japanese Particles | JLPT N5",
    zh: "に和で的区别・へ・と・から・まで — 日语核心助词用法 | JLPT N5",
    desc: "What を, に, で, へ, と, から and まで mean in Japanese and when to use each: を as the object marker, に vs で for place and time, with example sentences and audio.",
  },
  lesson03: {
    en: "Japanese Verb Groups & ます-form (masu form) Conjugation | JLPT N5",
    zh: "日语动词三类分类与ます形变形规则 | JLPT N5 语法",
  },
  lesson04: {
    en: "て-form (te form) Conjugation Rules & Chart | JLPT N5 Grammar",
    zh: "て形变形规则与音便对照表 | JLPT N5 日语语法",
  },
  lesson05: {
    en: "ている, てください, てもいい (te iru / te kudasai) | JLPT N5",
    zh: "ている・てください・てもいい 用法详解 | JLPT N5 日语语法",
  },
  lesson06: {
    en: "“Must” & “Must Not” in Japanese — なければならない, ない-form | N5",
    zh: "ない形变形与なければならない（必须）用法 | JLPT N5 语法",
    desc: "How to say must, have to, don't have to and must not in Japanese: the ない-form, なければならない, なくてもいい and てはいけない, with examples and a quick reference table.",
  },
  lesson07: {
    en: "た-form (ta form) & たことがある (Have Done) | JLPT N5 Grammar",
    zh: "た形变形・たことがある（经历）・たり〜たり | JLPT N5 语法",
  },
  lesson08: {
    en: "Japanese Adjective Conjugation (い/な) & Comparison | JLPT N5",
    zh: "い形容词・な形容词活用与比较句 | JLPT N5 日语语法",
  },
  lesson09: {
    en: "と, ば, たら (to / ba form) — How to Say “If” in Japanese | JLPT N5",
    zh: "と和ば的区别 — 日语条件句详解（含例句）| JLPT N5",
    desc: "How to say “if” in Japanese with と, ば and たら: how to make the ba-form, when と means “whenever”, and how the three conditionals differ, with examples.",
  },
  lesson10: {
    en: "たら vs なら (tara vs nara) — Japanese Conditionals Explained | N5",
    zh: "たら和なら的区别 — と・ば・たら・なら 条件句总结 | JLPT",
    desc: "The tara-form and なら in Japanese: how to conjugate たら, when なら means “if that's the case”, and a chart comparing と, ば, たら and なら, with common mistakes.",
  },
  lesson11: {
    en: "可能形 Potential & 受身形 Passive Form (られる) Conjugation | JLPT N5",
    zh: "可能形与受身形（被动）变形规则和用法 | JLPT N5 语法",
  },
  lesson12: {
    en: "Volitional Form (ou/you) & つもり (tsumori) — Intentions | JLPT N5",
    zh: "意向形（よう/おう）・つもり・たい 用法 | JLPT N5 语法",
  },
  lesson13: {
    en: "でしょう vs かもしれない (deshou / kamoshirenai) | JLPT N5",
    zh: "でしょう・だろう・かもしれない・そうだ 推测表达区别 | JLPT N5",
  },
  lesson14: {
    en: "“Seems Like” in Japanese — ようだ vs らしい vs みたい (you da, rashii)",
    zh: "ようだ・らしい・みたい・っぽい 的区别 | JLPT 日语语法",
    desc: "How to say “seems like”, “looks like” and “apparently” in Japanese: ようだ, みたいだ, らしい and っぽい compared side by side, with example sentences for each.",
  },
  lesson15: {
    en: "ことができる, ので vs から, のに, ために — N5 Grammar | JLPT",
    zh: "ことができる・ので和から的区别・のに・ために | JLPT N5 语法",
  },
  lesson16: {
    en: "すぎる, やすい/にくい, ながら, 方 (kata) + N5 Review | JLPT N5",
    zh: "すぎる・やすい/にくい・ながら・方 ＋ N5 语法总复习 | JLPT N5",
  },
  lesson17: {
    en: "ある vs いる (aru vs iru), に行く, のが好き, くらい | JLPT N5",
    zh: "ある和いる的区别・に行く・のが好き・くらい | JLPT N5 语法",
  },
  lesson18: {
    en: "Causative Form させる (saseru) — Make / Let Someone | JLPT N4",
    zh: "使役形（させる）变形规则与用法 | JLPT N4 日语语法",
  },
  lesson19: {
    en: "受身形 Passive vs Causative-Passive (rareru / saserareru) | JLPT N4",
    zh: "受身形与使役受身形（させられる）详解 | JLPT N4 语法",
  },
  lesson20: {
    en: "てあげる・てくれる・てもらう (ageru / kureru / morau) | JLPT N4",
    zh: "てあげる・てくれる・てもらう 授受动词的区别 | JLPT N4 语法",
  },
  lesson21: {
    en: "ようにする vs ようになる (you ni suru / you ni naru) | JLPT N4",
    zh: "ようにする和ようになる的区别・ように（目的）| JLPT N4",
  },
  lesson22: {
    en: "ことにする vs ことになる (koto ni suru / naru), はずだ | JLPT N4",
    zh: "ことにする和ことになる的区别・はずだ | JLPT N4 语法",
  },
  lesson23: {
    en: "“Just Did” in Japanese — たばかり vs たところ, てしまう | JLPT N4",
    zh: "ばかり和ところだ的区别・てしまう | JLPT N4 日语语法",
    desc: "How to say “just did” in Japanese: たばかり vs たところ, ところだ for “about to” and “in the middle of”, and てしまう for completion or regret, with examples.",
  },
  lesson24: {
    en: "ておく vs てある (te oku / te aru), て以来 | JLPT N4 Grammar",
    zh: "ておく和てある的区别・て以来 | JLPT N4 日语语法",
  },
  lesson25: {
    en: "という, ということ (to iu / to iu koto) Meaning | JLPT N4",
    zh: "という・ということ 用法详解 | JLPT N4 日语语法",
  },
  lesson26: {
    en: "わけだ, わけがない, わけではない (wake da) | JLPT N4 Grammar",
    zh: "わけだ・わけがない・わけではない・ものだ 的区别 | JLPT N4",
  },
  lesson27: {
    en: "Sonkeigo (Respectful Keigo) — Honorific Verbs List | JLPT N4",
    zh: "尊敬语入门 — 敬语动词对照表与れる尊敬 | JLPT N4 敬语",
  },
  lesson28: {
    en: "Kenjougo (Humble Keigo) & させていただく | JLPT N4",
    zh: "谦让语入门・させていただきます 用法 | JLPT N4 敬语",
  },
  lesson29: {
    en: "Business Japanese Keigo — Phone, Email & Meeting Phrases | JLPT",
    zh: "商务日语敬语实用 — 电话・邮件・会议常用表达 | JLPT 敬语",
  },
  lesson30: {
    en: "ても (temo), てほしい (te hoshii), ていく vs てくる | JLPT N4",
    zh: "ても・てほしい・ていく和てくる的区别・がる | JLPT N4 语法",
  },
  lesson31: {
    en: "すぎる, やすい/にくい, ことはない, Compound Verbs | JLPT N4",
    zh: "すぎる・やすい/にくい・ことはない・复合动词 | JLPT N4 语法",
  },
  lesson32: {
    en: "と思う vs と思っている, かどうか, のように | JLPT N4",
    zh: "と思う和と思っている的区别・かどうか・のように | JLPT N4",
  },
  lesson33: {
    en: "あいだ vs あいだに (aida vs aida ni) Meaning, までに vs まで | JLPT N4",
    zh: "あいだ和あいだに・まで和までに的区别・場合は | JLPT N4",
    desc: "あいだ vs あいだに (“while” / “during”) and までに vs まで (“by” vs “until”) in Japanese, plus おきに, 場合は, たらどう and てよかった, with example sentences.",
  },
  lesson34: {
    en: "JLPT N4 Grammar Review — All N4 Grammar Summary",
    zh: "JLPT N4 语法总复习 — N4 语法总结 | 日语语法",
  },
  N4_grammar_list: {
    en: "JLPT N4 Grammar List — All N4 Grammar Points (Checklist)",
    zh: "JLPT N4 语法清单 — 全部 N4 语法点一览（可打勾）",
  },
  lesson35: {
    en: "において / における, に対して, について, によって | JLPT N3",
    zh: "において・における・に対して・について・によって 的区别 | JLPT N3",
  },
  lesson36: {
    en: "に関して, にとって, に基づいて, にわたって | JLPT N3 Grammar",
    zh: "に関して・にとって・に基づいて・にわたって 用法 | JLPT N3",
  },
  lesson37: {
    en: "おかげで vs せいで (okage de / sei de), からには | JLPT N3",
    zh: "おかげで和せいで的区别・ために・からには | JLPT N3 语法",
  },
  lesson38: {
    en: "“Although” in Japanese — にもかかわらず, ながらも, くせに | JLPT N3",
    zh: "にもかかわらず・ながらも・くせに・としても 的区别 | JLPT N3",
  },
  lesson39: {
    en: "“Even If” & “Even So” in Japanese — にしても, ものの, とはいえ | N3",
    zh: "にしても・ものの・とはいえ・どころか 的区别 | JLPT N3 语法",
    desc: "How to say even if, even so and although in Japanese: にしても, ものの, とはいえ and どころか (“far from”), with nuance notes and JLPT N3 example sentences.",
  },
  lesson40: {
    en: "ほど vs くらい (hodo vs kurai), ば〜ほど, さえ〜ば | JLPT N3",
    zh: "ほど和くらい的区别・ば〜ほど・さえ〜ば | JLPT N3 语法",
  },
  lesson41: {
    en: "“Only” in Japanese — だけ vs しか〜ない (dake vs shika) | JLPT N3",
    zh: "だけ和しか〜ない的区别・ばかりか・に限って | JLPT N3",
    desc: "How to say “only” in Japanese: だけ vs しか〜ない, ばかりか (“not only… but also”), に限って and に限らず, with examples and the traps the JLPT N3 sets.",
  },
  lesson42: {
    en: "がちだ vs っぽい vs 気味 (gachi / ppoi / gimi) | JLPT N3",
    zh: "がちだ・っぽい・気味・つつある・一方だ 的区别 | JLPT N3",
  },
  lesson43: {
    en: "に違いない vs に決まっている, おそれがある | JLPT N3",
    zh: "に違いない・に決まっている・おそれがある 的区别 | JLPT N3",
  },
  lesson44: {
    en: "ようとする, ざるを得ない, かねる vs かねない | JLPT N3",
    zh: "ようとする・ざるを得ない・かねる和かねない的区别 | JLPT N3",
  },
  lesson45: {
    en: "きる / きれない, っこない, 得る (uru / eru) | JLPT N3 Grammar",
    zh: "きる・きれない・っこない・得る・得ない 用法 | JLPT N3 语法",
  },
  lesson46: {
    en: "上に, だけでなく, はもちろん, をはじめ, とともに | JLPT N3",
    zh: "上に・だけでなく・はもちろん・をはじめ・とともに | JLPT N3",
  },
  lesson47: {
    en: "として, にしては vs 割に (wari ni), 向け vs 向き | JLPT N3",
    zh: "として・にしては和割に・向け和向き的区别 | JLPT N3 语法",
  },
  lesson48: {
    en: "たとたん, 次第, うちに, 最中に (tatotan / shidai) | JLPT N3",
    zh: "たとたん・次第・うちに・最中に・際に 的区别 | JLPT N3",
  },
  lesson49: {
    en: "まま, だらけ, っぱなし, ずに (mama / darake) | JLPT N3",
    zh: "まま・だらけ・っぱなし・ずに・ように見える | JLPT N3 语法",
  },
  lesson50: {
    en: "“Instead Of” in Japanese — 代わりに (kawari ni), ついでに | JLPT N3",
    zh: "代わりに・ついでに・に比べて・によると・たびに | JLPT N3",
    desc: "How to say instead of, while you're at it, compared to and every time in Japanese: 代わりに, ついでに, に比べて, によると, たびに and て初めて, with examples.",
  },
  lesson51: {
    en: "というより, といっても, といえば, とおり | JLPT N3 Grammar",
    zh: "というより・といっても・というと/といえば・とおり | JLPT N3",
  },
  lesson52: {
    en: "“Pretend” in Japanese — ふりをする (furi wo suru), こそ | JLPT N3",
    zh: "ふりをする・こそ・ことに・ごとに 用法 | JLPT N3 语法",
    desc: "How to say “pretend” in Japanese with ふりをする, plus こそ for emphasis, ことに, ごとに (“every”) and かのように (“as if”), with JLPT N3 examples.",
  },
  lesson53: {
    en: "“Never” & “Rarely” in Japanese — 決して〜ない, めったに〜ない | JLPT N3",
    zh: "ないことはない・ずにはいられない・そうもない | JLPT N3",
    desc: "How to say never, rarely and not particularly in Japanese: 決して〜ない, めったに〜ない and 別に〜ない, plus ずにはいられない (“can't help but”) and ないことはない.",
  },
  lesson54: {
    en: "たらいい vs ばいい vs といい, ばよかった, 〜込む | JLPT N3",
    zh: "たらいい・ばいい・といい的区别・ばよかった・〜込む | JLPT N3",
  },
  lesson55: {
    en: "からこそ, ことになっている, とは限らない | JLPT N3 Grammar",
    zh: "からこそ・ことになっている・ような気がする・とは限らない | N3",
  },
  lesson56: {
    en: "わけにはいかない vs しかない, べきだ, ものだ | JLPT N3",
    zh: "わけにはいかない・しかない・べきだ・ものだ 的区别 | JLPT N3",
  },
  lesson57: {
    en: "ことか, てたまらない vs てならない, てもかまわない | JLPT N3",
    zh: "ことか・てたまらない和てならない的区别 | JLPT N3 语法",
  },
  lesson58: {
    en: "JLPT N3 Grammar Review — All N3 Grammar Summary by Topic",
    zh: "JLPT N3 语法总复习 — N3 语法分类总结",
  },
  N3_grammar_list: {
    en: "JLPT N3 Grammar List — All N3 Grammar Points (Checklist)",
    zh: "JLPT N3 语法清单 — 全部 N3 语法点一览（可打勾）",
  },
  lesson59: {
    en: "からといって, つつも, にしろ, たところで, どころではない | N2",
    zh: "からといって・つつも・にしろ・たところで 的区别 | JLPT N2",
  },
  lesson60: {
    en: "あまり, ばこそ, だけに vs だけあって, ものだから | JLPT N2",
    zh: "あまり・ばこそ・だけに和だけあって的区别 | JLPT N2 语法",
  },
  lesson61: {
    en: "に過ぎない, にほかならない, に限る, をものともせず | JLPT N2",
    zh: "に過ぎない・にほかならない・に限る・もかまわず | JLPT N2",
  },
  lesson62: {
    en: "はもとより vs のみならず (wa moto yori) | JLPT N2 Grammar",
    zh: "はもとより和のみならず的区别 | JLPT N2 日语语法",
  },
  lesson63: {
    en: "にあたって, に先立って, を機に vs をきっかけに | JLPT N2",
    zh: "にあたって・に先立って・を機に和をきっかけに | JLPT N2",
  },
  lesson64: {
    en: "わけがない vs はずがない, に相違ない | JLPT N2 Grammar",
    zh: "わけがない和はずがない的区别・に相違ない | JLPT N2 语法",
  },
  lesson65: {
    en: "ということだ, ないものか, としては (to iu koto da) | JLPT N2",
    zh: "ということだ・ないものか・としては/としても | JLPT N2 语法",
  },
  lesson66: {
    en: "に反して, 一方で vs 反面, につれて vs にしたがって | JLPT N2",
    zh: "に反して・一方で和反面・につれて和にしたがって的区别 | N2",
  },
  lesson67: {
    en: "をめぐって, を問わず, を中心に, に応じて, はともかく | N2",
    zh: "をめぐって・を問わず・を中心に・に応じて 用法 | JLPT N2",
  },
  lesson68: {
    en: "てしょうがない vs てしかたがない, てはいられない | JLPT N2",
    zh: "てしょうがない・てしかたがない・ないことには | JLPT N2",
  },
  lesson69: {
    en: "に沿って, を踏まえて, を除いて, 上で, 末に | JLPT N2 Grammar",
    zh: "に沿って・を踏まえて・を除いて・上で・末に | JLPT N2 语法",
  },
  lesson70: {
    en: "ものなら vs ようものなら, ことだ, に越したことはない | N2",
    zh: "ものなら和ようものなら的区别・に越したことはない | JLPT N2",
  },
  lesson71: {
    en: "にかけては, あげく, ことなく, ずに済む, ところだった | N2",
    zh: "にかけては・あげく・ことなく・ずに済む・ところだった | N2",
  },
  lesson72: {
    en: "だけのことはある, だけまし, まい (mai) | JLPT N2 Grammar",
    zh: "だけのことはある・だけは・だけまし・まい 用法 | JLPT N2",
  },
  lesson73: {
    en: "それにしても, それなのに, しかも, すなわち — Connectives | N2",
    zh: "それにしても・それなのに・しかも・すなわち 接续词 | JLPT N2",
  },
  lesson74: {
    en: "げ, 抜く, 次第だ, きり, ぶりに, につき | JLPT N2 Grammar",
    zh: "げ・抜く・次第だ・きり・ぶりに・につき 用法 | JLPT N2",
  },
  lesson75: {
    en: "JLPT N2 Grammar Review — All N2 Grammar Summary by Topic",
    zh: "JLPT N2 语法总复习 — N2 语法分类总结",
  },
  lesson76: {
    en: "が早いか vs や否や vs なり (ga hayai ka, ya ina ya) | JLPT N1",
    zh: "が早いか・や否や・なり・そばから・を皮切りに 区别 | JLPT N1",
    desc: "が早いか, や否や and なり all mean “as soon as” in JLPT N1 Japanese — how they differ, plus そばから, てからというもの, を皮切りに and に至って, with examples and audio.",
  },
  lesson77: {
    en: "ならでは, はおろか, もさることながら (naradewa, wa oroka) | N1",
    zh: "をおいて・ならでは・はおろか・もさることながら 用法 | JLPT N1",
    desc: "N1 grammar for limits and scope: をおいて〜ない, ならでは (unique to), にとどまらず, はおろか (let alone), もさることながら, に限ったことではない and を限りに, with examples.",
  },
  lesson78: {
    en: "といい〜といい vs といわず, であれ (to ii, de are) | JLPT N1",
    zh: "といい・といわず・なり〜なり・であれ 区别 | JLPT N1",
    desc: "Listing examples in N1 Japanese: といい〜といい, といわず〜といわず, なり〜なり, であれ〜であれ, だの〜だの and (よ)うが〜まいが (whether or not), compared.",
  },
  lesson79: {
    en: "たりとも, すら, にして, からある, あっての (taritomo) | JLPT N1",
    zh: "たりとも・すら・にして・からある・の極み 用法 | JLPT N1",
    desc: "N1 emphasis and extremes: たりとも (not even one), すら／ですら (even), にして, からある／からする (as much as), あっての and の極み／の至り, with examples.",
  },
  lesson80: {
    en: "ものを vs ものの, といえども, ところを (to iedomo) | JLPT N1",
    zh: "ものを・といえども・ところを・ながらも 区别 | JLPT N1",
    desc: "N1 concession grammar: ものを (if only), といえども (even though), ところを, ながらも, とはいうものの, (よ)うが／(よ)うと and にしたって — how they differ.",
  },
  lesson81: {
    en: "なくして, ともなると, とあれば, たら最後 (tara saigo) | JLPT N1",
    zh: "なくして・ともなると・とあれば・たら最後 用法 | JLPT N1",
    desc: "N1 conditionals: なくして(は) (without), ともなると／ともなれば, とあれば, たら最後／が最後 (once…there's no going back), ようでは and ないまでも, with examples.",
  },
  lesson82: {
    en: "べく vs んがため, ゆえに, とあって, こととて (beku) | JLPT N1",
    zh: "べく・んがため・ゆえ・とあって・こととて 区别 | JLPT N1",
    desc: "Purpose and cause in N1 Japanese: べく and んがため (in order to), ゆえ(に) (because), とあって, こととて and にかこつけて (on the pretext of), compared.",
  },
  lesson83: {
    en: "いかんで, いかんにかかわらず, をよそに (ikan, yoso ni) | N1",
    zh: "いかん・をよそに・によらず・に即して 用法 | JLPT N1",
    desc: "N1 grammar for depending on / regardless of: いかんで, いかんにかかわらず／によらず, をよそに (ignoring), によらず, に即して and にかかわる, with examples.",
  },
  lesson84: {
    en: "ずにはおかない, を余儀なくされる, を禁じ得ない | JLPT N1",
    zh: "ずにはおかない・ずにはすまない・を余儀なくされる 区别 | JLPT N1",
    desc: "N1 grammar: なしに／ことなしに (without), ずにはおかない, ずにはすまない, を禁じ得ない (can't help feeling) and を余儀なくされる (be forced to), with examples.",
  },
  lesson85: {
    en: "までもない, には及ばない, に足る, に堪えない (made mo nai) | N1",
    zh: "までもない・に足る・に堪えない・にかたくない 用法 | JLPT N1",
    desc: "N1 evaluation grammar: までもない (needless to), までだ, には及ばない, に足る／に足りない (worth), に堪える／に堪えない and にかたくない (easy to imagine).",
  },
  lesson86: {
    en: "べくもない, てしかるべきだ, ばそれまでだ (beku mo nai) | N1",
    zh: "べくもない・てしかるべきだ・ばそれまでだ 用法 | JLPT N1",
    desc: "N1 judgement grammar: べくもない (no way to), てしかるべきだ (ought to), でなくてなんだろう, ないではすまない, ないものでもない and ばそれまでだ, with examples.",
  },
  lesson87: {
    en: "てやまない, 極まりない, といったらない (te yamanai) | JLPT N1",
    zh: "てやまない・極まりない・といったらない・限りだ 用法 | JLPT N1",
    desc: "Emotion and emphasis in N1 Japanese: てやまない, 極まりない／極まる, といったらない, 限りだ, とは (to think that) and てはばからない, with examples.",
  },
  lesson88: {
    en: "ずくめ vs まみれ vs だらけ, ぐるみ, めく (zukume) | JLPT N1",
    zh: "ずくめ・まみれ・ぐるみ・めく・ともなく 区别 | JLPT N1",
    desc: "N1 suffixes: ずくめ, まみれ (covered in) vs だらけ, ぐるみ, めく (-ish), ともなく and ながらに(して) — what each means and how they differ, with examples.",
  },
  lesson89: {
    en: "かたがた vs がてら vs かたわら (katagata, gatera) | JLPT N1",
    zh: "かたがた・がてら・かたわら 区别 | JLPT N1",
    desc: "かたがた, がてら and かたわら all mean doing one thing along with another — how they differ at JLPT N1, plus つ〜つ, なりに and とばかりに, with examples.",
  },
  lesson90: {
    en: "べからず, ごとき, ずとも, んばかり, をもって | JLPT N1",
    zh: "べからず・ごとき・ずとも・んばかり・をもって 用法 | JLPT N1",
    desc: "Classical and written N1 grammar: (よ)うにも〜ない, べからず (must not), ごとき／ごとく, ずとも, んばかり (as if about to) and をもって, with examples.",
  },
  lesson91: {
    en: "にひきかえ, ともあろう, たるもの, ではあるまいし | JLPT N1",
    zh: "にひきかえ・ともあろう・たる・ではあるまいし 用法 | JLPT N1",
    desc: "N1 grammar: にひきかえ (in contrast to), ともあろう者が, たる(もの), ではあるまいし (it's not as if), と相まって and に則って, with examples.",
  },
  lesson92: {
    en: "JLPT N1 Grammar Review — All N1 Grammar Summary by Topic",
    zh: "JLPT N1 语法总复习 — N1 语法分类总结",
    desc: "All JLPT N1 grammar in one review: every pattern from lessons 76–91 grouped by function, the most confusable pairs side by side, and tips for the N1 grammar section.",
  },
  N1_grammar_list: {
    en: "JLPT N1 Grammar List — All N1 Grammar Points (Checklist)",
    zh: "JLPT N1 语法清单 — 全部 N1 语法点一览（可打勾）",
  },
  N2_grammar_list: {
    en: "JLPT N2 Grammar List — All N2 Grammar Points (Checklist)",
    zh: "JLPT N2 语法清单 — 全部 N2 语法点一览（可打勾）",
  },
  N5_grammar_list: {
    en: "JLPT N5 Grammar List — All N5 Grammar Points (Checklist)",
    zh: "JLPT N5 语法清单 — 全部 N5 语法点一览（可打勾）",
  },

  // ─── Guides (grammar/guides/) — also need a JA_TITLES entry in build.js.
  // desc / descZh feed the meta description and the /guides/ hub card;
  // level is the JLPT level shown on the card and OG image.
  "wa-vs-ga": {
    en: "は vs が (wa vs ga) — Difference Explained with Examples",
    zh: "は和が的区别 — 用法总结、判断流程与自测题",
    desc: "The difference between は (wa) and が (ga): one-line rule, comparison table, six typical situations, a decision flow and a 10-question self-test with answers.",
    descZh: "日语助词は和が到底怎么区分？一句话结论＋对比总表＋6 种典型场景＋判断流程，最后 10 道自测题带解析。",
    level: "N5",
  },
  "jlpt-december-2026": {
    en: "JLPT December 2026 Guide — Test Times, Pass Marks & 6-Week Plan",
    zh: "2026年12月JLPT考前指南 — 考试时长、合格线、6周冲刺计划",
    desc: "JLPT December 6, 2026: section times for N1–N5, overall and per-section pass marks, a six-week final review plan, N2 time allocation, exam-day checklist, results dates.",
    descZh: "2026 年 12 月 6 日 JLPT：各级别考试时长、总分与单科合格线、最后 6 周复习计划、N2 时间分配、考试当天清单和出成绩时间。",
  },
  "ni-vs-de": {
    en: "に vs で (ni vs de) — Place, Time & Means Explained | JLPT N5",
    zh: "に和で的区别 — 用法总结、判断方法与自测题",
    desc: "に vs で (ni vs de): where things are vs where actions happen, plus time, transport, causes and に vs へ. Clear rules, examples and a 10-question self-test.",
    descZh: "に和で的区别：存在场所与动作场所、时间点与所需时间、交通工具、原因，以及に和へ。附判断流程和10道自测题。",
    level: "N5",
  },
  "kara-vs-node": {
    en: "から vs ので (kara vs node) — Difference & Usage Explained | JLPT N5",
    zh: "から和ので的区别 — 用法总结、判断方法与自测题",
    desc: "から vs ので (kara vs node): subjective vs objective reasons, politeness, commands vs requests, 〜からです and んです. Clear rules, examples and a self-test.",
    descZh: "から和ので的区别：主观与客观理由、礼貌程度、能否接命令和请求、〜からです、ので与んです。附判断流程和自测题。",
    level: "N5",
  },
  "to-ba-tara-nara": {
    en: "と・ば・たら・なら (to, ba, tara, nara) — Japanese Conditionals | JLPT N4",
    zh: "と・ば・たら・なら的区别 — 四种条件用法总结与自测题",
    desc: "と, ば, たら, なら compared: which take requests, rules vs one-off events, なら for advice, たら for \"when\", plus a decision flow and a self-test.",
    descZh: "と・ば・たら・なら四种条件的区别：能否接请求、规律与一次性、なら给建议、たら表示之后。附判断流程和自测题。",
    level: "N4",
  },
  "you-da-rashii-sou-da-mitai": {
    en: "ようだ vs らしい vs そうだ vs みたいだ (you da, rashii, sou da, mitai)",
    zh: "ようだ・らしい・そうだ・みたいだ 的区别 — 推测与传闻总结与自测题",
    desc: "ようだ, らしい, そうだ and みたいだ all mean \"it seems\". Learn which to use by evidence source, the two そうだ, conjugation rules, plus a JLPT N4 self-test.",
    descZh: "ようだ、らしい、そうだ、みたいだ 怎么区分？按判断根据对比样态与传闻两种そうだ、接续规则和らしい的「典型」用法，附自测题。",
    level: "N4",
  },
  "ageru-kureru-morau": {
    en: "あげる vs くれる vs もらう (ageru, kureru, morau) Explained",
    zh: "あげる・くれる・もらう 的区别 — 授受动词总结与自测题",
    desc: "When to use あげる, くれる or もらう and てあげる / てくれる / てもらう: direction, in-group, に vs から, keigo (くださる, いただく) and a JLPT N4 self-test.",
    descZh: "あげる、くれる、もらう 怎么选？按方向和视角讲清授受动词、てあげる等动作版、もらう用に还是から、敬语版本，附自测题。",
    level: "N4",
  },
  "teiru-vs-tearu": {
    en: "ている vs てある vs ておく (te iru, te aru, te oku) Explained",
    zh: "ている・てある・ておく 的区别 — 自他动词与状态表达总结",
    desc: "ている vs てある vs ておく: ongoing action vs resulting state, transitive/intransitive pairs like 開く/開ける, が vs を, and a JLPT N4 self-test.",
    descZh: "ている、てある、ておく 怎么区分？讲清进行与结果状态、自动词/他动词（開く・開ける）、が和を的用法，附自测题。",
    level: "N4",
  },
  "tame-ni-vs-you-ni": {
    en: "ために vs ように (tame ni vs you ni) — Purpose Explained | JLPT",
    zh: "ために和ように的区别 — 表目的用法总结与自测题",
    desc: "ために vs ように (tame ni vs you ni): when to use each for purpose — volitional vs potential and negative verbs, different subjects, ために for cause, plus a quiz.",
    descZh: "ために和ように表目的有什么区别？意志动词与可能形・ない形、前后主语是否相同、ために表原因，附例句对比和10道自测题。",
    level: "N4",
  },
  "hazu-vs-wake": {
    en: "はずだ vs わけだ (hazu da vs wake da) — Meaning & Negatives | JLPT",
    zh: "はずだ和わけだ的区别 — はずがない・わけがない・わけではない对比与自测题",
    desc: "はずだ vs わけだ (hazu da vs wake da): expectation vs \"no wonder\", plus はずがない, わけがない and わけではない compared, with examples and a self-test.",
    descZh: "はずだ和わけだ的区别：根据依据推测 vs \"难怪/也就是说\"，再对比はずがない・わけがない・わけではない，附例句和10道自测题。",
    level: "N4/N3",
  },
  "aida-ni-vs-uchi-ni": {
    en: "あいだ vs あいだに vs うちに (aida vs uchi ni) — Explained | JLPT",
    zh: "あいだ・あいだに・うちに的区别 — 用法总结与自测题",
    desc: "あいだ vs あいだに vs うちに (aida, aida ni, uchi ni): whole period vs a point in it, \"while it lasts\", ないうちに and ているうちに, with examples and a quiz.",
    descZh: "あいだ・あいだに・うちに的区别：整段期间 vs 期间中的某一点 vs 趁状态未变，含ないうちに・ているうちに，附例句和自测题。",
    level: "N4/N3",
  },
};
