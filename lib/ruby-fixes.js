// Furigana corrections shared by the site build and build-anki (cards, and
// through them the grammar-audio pages): kuroshiro/kuromoji output in, the
// site's readings out.
//
//   const { fixReadings } = require("./lib/ruby-fixes");
//   html = fixReadings(await kuro.convert(text, { to: "hiragana", mode: "furigana" }));

// Context-sensitive reading corrections.
//
// kuromoji picks the wrong reading for a handful of words even with the whole
// sentence for context — 行った as おこなった, 後で as のちで, 来られる as
// きたられる. Each entry rewrites one <ruby> whose kanji, current reading and
// surrounding plain text all match; `before`/`after` see the text with tags
// and readings stripped, so a neighbouring ruby reads as its bare kanji.
const RUBY_FIXES = [
  // 紅葉 in lesson25 is もみじ (its word table, and the grammar audio reads it so);
  // lesson51 keeps こうよう. Reader report 2026-11-24.
  { kanji: "紅葉", from: /^こうよう$/, before: /やっぱり\s*$/, to: "もみじ" },
  { kanji: "紅葉", from: /^こうよう$/, after: /^を思い出す/, to: "もみじ" },
  // ── Furigana vs audio audit (2026-11-24): kuromoji's reading differs from what
  // the sentence says (and what Edge/Gemini read). ──
  // 何でも / 何だった / 何でしたっけ / 何ですか / 何と言われようと / 何としても /
  // 何曜日 / 何度 … are なん; 何も / 何か / 何を / 何が / 何とぞ stay なに.
  { kanji: "何", from: /^なに$/, after: /^(でも|だ|でし|です|と\s*言|としても|曜日|度|号|名|杯|冊|さつ)/, to: "なん" },
  // 大勢 on this site always means "a crowd" (おおぜい), never 大勢 (たいせい) "the trend".
  { kanji: "大勢", from: /^たいせい$/, to: "おおぜい" },
  // 〜ともあろう者が / 〜たる者 is もの (also in 「ともあろう＋者」 tables).
  { kanji: "者", from: /^しゃ$/, before: /(あろう|たる)\s*[＋+]?\s*$/, to: "もの" },
  // Money: 会社の金を / 預かった金を / だまして金を — かね (奨学金, 金メダル, 月〜金 untouched).
  { kanji: "金", from: /^きん$/, before: /(の|た|て)$/, after: /^[をで]/, to: "かね" },
  // 図書館に通った = かよった (going regularly).
  { kanji: "通", from: /^とお$/, before: /(図書館|学校|塾|ジム|病院|大学|会社|教室)に$/, to: "かよ" },
  // 放っておく / 放っておけない = ほうって.
  { kanji: "放", from: /^はな$/, after: /^ってお[いかきくけこ]/, to: "ほう" },
  // テーブルの角に / 次の角で / 角が立つ = かど.
  { kanji: "角", from: /^かく$/, before: /の$/, after: /^[にでを]/, to: "かど" },
  { kanji: "角", from: /^かく$/, after: /^が立/, to: "かど" },
  // 十個, 五十個 = じゅっこ.
  { kanji: "十", from: /^じゅう$/, after: /^個/, to: "じゅっ" },
  // ── Lesson review (2026-11-09) ──
  { kanji: "長", from: /^た$/, after: /^ければ/, to: "なが" },                    // 長ければ (kuromoji: 長けれ)
  { kanji: "愛", from: /^め$/, after: /^で/, to: "あい" },                       // 母の愛でなくて (not 愛でる)
  { kanji: "堪", from: /^こた$/, to: "た" },                                     // 堪える on this site is always たえる
  // ── Mock tests 2 (2026-11-08): readings Gemini flagged in context ──
  { kanji: "分", from: /^ぶん$/, before: /[二五九]\s*$/, to: "ふん" },              // 五分 = ごふん
  { kanji: "間", from: /^(ま|かん)$/, before: /(その|この)\s*$/, after: /^\s*[、,]?\s*(私|わたし|僕|ぼく|連絡|に|は|、)/, to: "あいだ" },
  { kanji: "後", from: /^ご$/, before: /の\s*$/, to: "あと" },                      // テストの後, 仕事の後
  { kanji: "四", from: /^よん$/, after: /^(時|人)/, to: "よ" },                     // 四時間, 四人
  { kanji: "日", from: /^にち$/, before: /(ある|\]\])\s*$/, to: "ひ" },              // ある日 (also with the blank before it)
  { kanji: "月", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "げつ" },        // dates: (月)(火)…
  { kanji: "火", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "か" },
  { kanji: "水", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "すい" },
  { kanji: "木", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "もく" },
  { kanji: "金", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "きん" },
  { kanji: "土", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "ど" },
  { kanji: "行", from: /^こう$/, before: /[二三四五六七八九十何数]$/, to: "ぎょう" },   // 三行
  { kanji: "何人", from: /^なにびと$/, after: /^(?!たりとも)/, to: "なんにん" },
  { kanji: "国", from: /^こく$/, after: /^\s*[へに]\s*(帰|かえ)/, to: "くに" },
  { kanji: "表", from: /^おもて$/, after: /^計算/, to: "ひょう" },
  { kanji: "私", from: /^わたし$/, after: /^ども/, to: "わたくし" },
  { kanji: "本", from: /^ほん$/, before: /[三何]$/, to: "ぼん" },
  { kanji: "本", from: /^ほん$/, before: /[一六八十]$/, to: "ぽん" },
  { kanji: "方", from: /^ほう$/, before: /(る|ない)$/, after: /^(の多く|なんです)/, to: "かた" },
  { kanji: "箱", from: /^はこ$/, before: /十$/, to: "ぱこ" },
  { kanji: "八", from: /^はち$/, after: /^百/, to: "はっ" },
  { kanji: "空", from: /^あ$/, before: /(電車|バス|道|店)[がもは]?$/, to: "す" },
  { kanji: "夜市", from: /^.+$/, to: "よいち" },
  { kanji: "市", from: /^し$/, before: /夜$/, to: "いち" },
  { kanji: "夜", from: /^よる$/, after: /^市/, to: "よ" },
  { kanji: "札", from: /^さつ$/, before: /(番号|名|整理|値)の?$/, to: "ふだ" },
  { kanji: "山道", from: /^さんどう$/, to: "やまみち" },
  { kanji: "何", from: /^なに$/, after: /^であれ/, to: "なん" },
  { kanji: "市場", from: /^いちば$/, after: /^(を開拓|に参入|規模|調査|の拡大|経済|価格|シェア)/, to: "しじょう" },
  { kanji: "口", from: /^くち$/, before: /(入り|出|窓|改札|非常|裏)$/, to: "ぐち" },
  { kanji: "所", from: /^しょ$/, before: /(給水|印刷)$/, to: "じょ" },
  { kanji: "印刷所", from: /^いんさつしょ$/, to: "いんさつじょ" },
  { kanji: "場", from: /^じょう$/, before: /稽古$/, to: "ば" },
  { kanji: "一言", from: /^いちげん$/, after: /^(?!居士)/, to: "ひとこと" },
  { kanji: "帰", from: /^き$/, after: /^す/, to: "かえ" },
  { kanji: "軽", from: /^けい$/, after: /^め/, to: "かる" },
  { kanji: "年", from: /^とし$/, after: /^に[数一二三何]/, to: "ねん" },
  { kanji: "大", from: /^だい$/, after: /^ごと/, to: "おお" },
  // ── N1 lessons (76–92): context-specific readings; listed first so they win
  // over the general rules below. ──
  { kanji: "店", from: /^(てん|みせ)$/, before: /(号|人気|高級|飲食|専門|支|本|料理)$/, to: "てん" },
  { kanji: "階", from: /^かい$/, before: /([3３三]|何)$/, to: "がい" },   // 3階・何階 = さんがい・なんがい
  { kanji: "今", from: /^(いま|こん)$/, after: /^(シーズン|大会|年度|世紀|学期|週|期)/, to: "こん" },
  { kanji: "形", from: /^(がた|かたち|けい)$/, before: /(といい|といわず)$/, to: "かたち" },
  { kanji: "手", from: /^しゅ$/, after: /^といい/, to: "て" },
  { kanji: "人", from: /^じん$/, after: /^に譲/, to: "ひと" },
  { kanji: "人", from: /^(じん|にん)$/, before: /(料理|依頼)$/, to: "にん" },
  // 何人（なんぴと）たりとも
  { kanji: "人", from: /^(にん|じん|ひと)$/, before: /何$/, after: /^(たりとも|\s*[（(]なんぴと|」 is read)/, to: "ぴと" },
  { kanji: "来", from: /^(き|きた|く)$/, after: /^(よう|ず|（　+）)/, to: "こ" },
  { kanji: "中", from: /^ちゅう$/, before: /(部屋|会社|今夜|世界|日本|町|家|学校|体)$/, to: "じゅう" },
  { kanji: "方", from: /^ほう$/, before: /(立派な|あろう)$/, to: "かた" },
  { kanji: "物", from: /^ぶつ$/, after: /^も言/, to: "もの" },
  { kanji: "入", from: /^にゅう$/, after: /^ろう/, to: "はい" },
  { kanji: "降", from: /^(くだ|お)$/, before: /[雨雪][がはも]$/, after: /^ろう/, to: "ふ" },
  { kanji: "然", from: /^しか$/, after: /^る」/, to: "さ" },
  { kanji: "付", from: /^づ$/, before: /盛り$/, to: "つ" },
  { kanji: "日当", from: /^ひなた$/, after: /^たり/, to: "ひあ" },
  { kanji: "額", from: /^がく$/, after: /^が汗/, to: "ひたい" },
  { kanji: "我", from: /^わが$/, after: /^ながら/, to: "われ" },
  { kanji: "故", from: /^こ$/, after: /^(（に）|に|の)/, to: "ゆえ" },
  { kanji: "得", from: /^う$/, after: /^ん/, to: "え" },
  { kanji: "如何", from: /^いか$/, to: "いかん" },
  { kanji: "堪", from: /^こた$/, before: /に$/, to: "た" },
  { kanji: "愛", from: /^め$/, before: /の$/, to: "あい" },
  { kanji: "皆", from: /^かい$/, after: /^(独立|そろ|で|が|、)/, to: "みな" },
  { kanji: "剥", from: /^へ$/, after: /^が/, to: "は" },
  { kanji: "遣", from: /^や$/, before: /気を$/, to: "つか" },
  { kanji: "謝", from: /^しゃ$/, after: /^ろう/, to: "あやま" },
  { kanji: "一目", from: /^いちもく$/, after: /^(見|で)/, to: "ひとめ" },
  // 一 + counter: 一歩 いっぽ, 一着 いっちゃく, 一回戦 いっかいせん …; 一駅 ひとえき.
  { kanji: "一", from: /^いち$/, after: /^(歩|球|着|戸|泊|本|冊|軒|国|点|回|滴|杯|切|発|家)/, to: "いっ" },
  { kanji: "一", from: /^いち$/, after: /^駅/, to: "ひと" },
  { kanji: "歩", from: /^ほ$/, before: /一$/, to: "ぽ" },
  { kanji: "本", from: /^ほん$/, before: /一$/, to: "ぽん" },
  { kanji: "泊", from: /^はく$/, before: /一$/, to: "ぱく" },
  { kanji: "杯", from: /^はい$/, before: /一$/, to: "ぱい" },
  { kanji: "発", from: /^はつ$/, before: /一$/, to: "ぱつ" },
  // 行って/行った is いって/いった — except after を (調査を行った = おこなった).
  { kanji: "行", from: /^(おこな|くだり|ゆ)$/, after: /^っ[たて]/, before: /[^を]$/, to: "い" },
  // 〜た後で / 〜の後で is あとで, never のちで.
  { kanji: "後", from: /^のち$/, after: /^で/, to: "あと" },
  // 来られる = こられる, 来る = くる.
  { kanji: "来", from: /^きた$/, after: /^られ/, to: "こ" },
  { kanji: "来", from: /^きた$/, after: /^る/, to: "く" },
  // 勝てる/勝った is か-, not かち-.
  { kanji: "勝", from: /^かち$/, after: /^[てた]/, to: "か" },
  // 割る is わる (kuromoji gives 割(われ)る).
  { kanji: "割", from: /^われ$/, after: /^る/, to: "わ" },
  // 電車が空いている = すいている (uncrowded), not あいている.
  { kanji: "空", from: /^あ$/, before: /(電車|バス|道|店)が$/, after: /^い/, to: "す" },
  // 〜分 after 1/3/4/6/8/10 (and 0-ending numbers) is ぷん: 10分 = じゅっぷん.
  { kanji: "分", from: /^ふん$/, before: /[134680]$/, to: "ぷん" },
  // 雨/雪が降る is ふる (kuromoji reaches for 降りる).
  { kanji: "降", from: /^お$/, before: /[雨雪]が$/, after: /^[りるら]/, to: "ふ" },
  // 〜方がいい is ほうがいい (the comparative), …
  { kanji: "方", from: /^かた$/, after: /^が(いい|よ|良)/, to: "ほう" },
  // …while the honorific 方 = "person" is かた. Restricted to 方 followed by
  // a non-が particle: every comparative 方 in these lessons takes が, and a
  // topic-contrast 「〜の方は」(ほう) would need an exception here.
  { kanji: "方", from: /^ほう$/, after: /^[はをにもで、。]/, to: "かた" },
  // Grammar-term 〜形 is けい (ますけい, てけい, ないけい). kuromoji offers
  // がた or かたち; the real 「形」 (shape) keeps かたち because no form name
  // precedes it — 星の形, した。形.
  {
    kanji: "形",
    from: /^(がた|かたち)$/,
    before: /(ます|ない|たり|辞[書书]|可能|使役|受身|受け身|命令|意[向志]|普通|丁寧|仮定|条件|連用|基本|否定|原|ている|でいる|[VＶ]|[たてばないなイい])$/,
    to: "けい",
  },
  // 来させる/来させられる is こさせる.
  { kanji: "来", from: /^きた$/, after: /^させ/, to: "こ" },
  { kanji: "雨", from: /^う$/, to: "あめ" },
  { kanji: "薬", from: /^やく$/, to: "くすり" },
  { kanji: "水", from: /^すい$/, to: "みず" },
  { kanji: "店", from: /^てん$/, to: "みせ" },
  { kanji: "際", from: /^きわ$/, to: "さい" },
  { kanji: "嫌", from: /^ぎら$/, to: "きら" },
  // お腹/店が空く is すく; 席が空く (あく) would need an exception here.
  { kanji: "空", from: /^あ$/, before: /[腹店]/, after: /^い[たてる]/, to: "す" },
  // 〜た後だ / 〜の後に / 地震の後は / 後から is あと. 後ほど (のちほど) is left alone.
  { kanji: "後", from: /^のち$/, after: /^([だにではも、。]|から)/, to: "あと" },
  { kanji: "熱", from: /^ねっ$/, after: /^そう/, to: "あつ" },
  { kanji: "難", from: /^かた$/, after: /^し/, to: "むずか" },
  { kanji: "書", from: /^が$/, before: /お$/, to: "か" },
  { kanji: "話", from: /^ばなし$/, after: /^[さしすせ]/, to: "はな" },
  // ピアノを弾く is ひく.
  { kanji: "弾", from: /^はじ$/, after: /^[けい]/, to: "ひ" },
  // A digit in front makes 時/歳 a counter: 10時 = じゅうじ, 18歳 = じゅうはっさい.
  { kanji: "時", from: /^とき$/, before: /[0-9０-９]\s*$/, to: "じ" },
  { kanji: "歳", from: /^とし$/, before: /[0-9０-９]\s*$/, to: "さい" },
  { kanji: "帰", from: /^き$/, after: /^[てた]/, to: "かえ" },
  { kanji: "美味", from: /^うま$/, to: "おい" },
  { kanji: "買", from: /^がい$/, to: "か" },
  { kanji: "見", from: /^みる$/, to: "み" },
  // Every 辛 in these lessons means "spicy" (からい), never つらい.
  { kanji: "辛", from: /^(つら|からし)$/, to: "から" },
  // 日本 is にほん in ordinary speech (日本語/日本人 already are).
  { kanji: "日本", from: /^にっぽん$/, to: "にほん" },
  { kanji: "日本人", from: /^にっぽんじん$/, to: "にほんじん" },
  // Month names: 3月 / 何月 = さんがつ / なんがつ.
  { kanji: "月", from: /^つき$/, before: /[0-9０-９何〇○]$/, to: "がつ" },
  { kanji: "何", from: /^なに$/, after: /^(月|の|て|って)/, to: "なん" },
  { kanji: "何時", from: /^いつ$/, to: "なんじ" },
  // 絵を描く = かく (the lessons' vocab lists give かく).
  { kanji: "描", from: /^えが$/, to: "か" },
  { kanji: "夜中", from: /^やちゅう$/, to: "よなか" },
  { kanji: "怒", from: /^いか$/, after: /^り[っ（]/, to: "おこ" },
  { kanji: "今", from: /^こん$/, to: "いま" },
  { kanji: "手数", from: /^てかず$/, to: "てすう" },
  { kanji: "召", from: /^めし$/, after: /^し/, to: "め" },
  // Grammar terms: 疑問詞, 数量詞, 助詞 … are 〜し.
  { kanji: "詞", from: /^ことば$/, to: "し" },
  // Suffix 〜気味 is ぎみ; 気味が悪い keeps きみ.
  { kanji: "気味", from: /^きみ$/, after: /^(?![がの悪])/, to: "ぎみ" },
  // 間に = あいだに ("during"); 間に合う stays まにあう.
  { kanji: "間", from: /^ま$/, after: /^に(?![合あ])/, to: "あいだ" },
  { kanji: "間", from: /^ま$/, before: /長い$/, to: "あいだ" },
  { kanji: "末", from: /^まつ$/, after: /^に/, to: "すえ" },
  { kanji: "大事", from: /^だいじ$/, after: /^にならず/, to: "おおごと" },
  { kanji: "角", from: /^かく$/, after: /^を曲/, to: "かど" },
  { kanji: "杯", from: /^はい$/, before: /[3３]$/, to: "ばい" },
  { kanji: "世論", from: /^せろん$/, to: "よろん" },
  // 来（く）れば / 来（こ）ない: the reading is spelled out right after.
  { kanji: "来", from: /^き$/, after: /^（く）/, to: "く" },
  { kanji: "来", from: /^き$/, after: /^（こ）/, to: "こ" },
  { kanji: "名", from: /^な$/, after: /^・な/, to: "めい" },
  { kanji: "長", from: /^ちょう$/, after: /^＿/, to: "なが" },
  { kanji: "出", from: /^で$/, after: /^さ（/, to: "だ" },
  { kanji: "刃", from: /^は$/, before: /鬼滅の$/, to: "やいば" },
  // A door/window opening by itself is あく.
  { kanji: "開", from: /^ひら$/, before: /(ドア|窓|戸|扉|門|店|鍵|開け|押すと|押せば|押したら)(?![^。]*を$)[^。]*$/, after: /^[かきくけい]/, to: "あ" },
  // Chinese 去 ("drop") in conjugation notes — 去る+ます, ます去ます — isn't
  // Japanese at all: no reading.
  { kanji: "去", from: /^さ$/, after: /^(る|い)?\s*[+＋]|^ます/, to: "" },
  { kanji: "去", from: /^さ$/, before: /ます$/, to: "" },
  // ひとし is a name reading; 等 in these notes is Chinese "etc.".
  { kanji: "等", from: /^ひとし$/, to: "" },
  // Rain/snow 降り続ける, 降りそう — ふる, not おりる.
  { kanji: "降", from: /^お$/, before: /[雨雪][がはも][^。]*$/, after: /^[りるら]/, to: "ふ" },
];

// Runs of adjacent rubies kuromoji should have read as one word. Each part is
// "kanji" or "kanji:reading" (the reading must match too).
const RUBY_MERGES = [
  [["彼", "女"], "かのじょ"],
  [["一", "人"], "ひとり"],
  [["二", "人"], "ふたり"],
  [["一", "日", "中"], "いちにちじゅう"],
  [["一", "晩", "中"], "ひとばんじゅう"],
  [["今日", "中"], "きょうじゅう"],
  [["今年", "中"], "ことしじゅう"],
  [["一", "回"], "いっかい"],
  [["一", "週間"], "いっしゅうかん"],
  [["一", "匹"], "いっぴき"],
  [["一", "通:つう"], "いっつう"],
  [["一", "泊", "二", "日"], "いっぱくふつか"],
  [["夜", "更"], "よふ"],
  [["疑問", "詞"], "ぎもんし"],
  [["空", "所"], "くうしょ"],
  [["鬼", "滅"], "きめつ"],
];

// 3日 / 3日間: kuromoji reads the digit and 日 separately (にち).
const DAY_COUNTS = { 2: "ふつか", 3: "みっか", 4: "よっか", 5: "いつか", 6: "むいか", 7: "なのか", 8: "ようか", 9: "ここのか", 10: "とおか", 20: "はつか" };

const RUBY_TAG = /<ruby>([^<]*)<rp>\(<\/rp><rt>([^<]*)<\/rt><rp>\)<\/rp><\/ruby>/g;
const RUBY_KANA = /^[ぁ-んァ-ヶーゔ・]+$/;

function ruby(kanji, reading) {
  return `<ruby>${kanji}<rp>(</rp><rt>${reading}</rt><rp>)</rp></ruby>`;
}

// Plain text (no tags, no readings) around a position, for fix context.
function plainAround(str, start, end) {
  const strip = (s) => s.replace(/<rp>[^<]*<\/rp>|<rt>[^<]*<\/rt>/g, "").replace(/<[^>]+>/g, "");
  return {
    before: strip(str.slice(Math.max(0, start - 200), start)).slice(-16),
    after: strip(str.slice(end, end + 80)).slice(0, 16),
  };
}

function fixReadings(html) {
  for (const [parts, reading] of RUBY_MERGES) {
    const kanji = parts.map((p) => p.split(":")[0]).join("");
    const re = new RegExp(
      parts.map((p) => { const [k, r] = p.split(":"); return ruby(k, r || "[^<]*"); }).join("").replace(/[()]/g, "\\$&"),
      "g"
    );
    html = html.replace(re, ruby(kanji, reading));
  }
  // 一日中外に: kuromoji reads 中外 (ちゅうがい) as one word.
  html = html.replace(new RegExp("(日<rp>\\(</rp><rt>[^<]*</rt><rp>\\)</rp></ruby>)" + ruby("中外", "ちゅうがい").replace(/[()]/g, "\\$&"), "g"), (m, d) => d + ruby("中", "じゅう") + ruby("外", "そと"));
  // 昔々 = むかしむかし (kuromoji leaves 々 bare).
  html = html.replace(new RegExp(ruby("昔", "むかし").replace(/[()]/g, "\\$&") + "々", "g"), ruby("昔々", "むかしむかし"));
  // Digit + 日 / 日間 counts days: 3日 = みっか, 3日間 = みっかかん.
  html = html.replace(
    /(^|[^0-9０-９])([0-9０-９]{1,2})<ruby>(日|日間)<rp>\(<\/rp><rt>にち(?:かん)?<\/rt><rp>\)<\/rp><\/ruby>/g,
    (m, pre, num, kanji) => {
      const n = Number(num.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
      const r = DAY_COUNTS[n];
      if (!r) return m;
      return pre + ruby(num + kanji, r + (kanji === "日間" ? "かん" : ""));
    }
  );
  // The same with a kanji numeral, which kuromoji also reads apart: 三(さん)日(にち)
  // もあれば → 三日(みっか). Not after another numeral (十三日 = じゅうさんにち).
  html = html.replace(
    /<ruby>(二十|[二三四五六七八九十])<rp>\(<\/rp><rt>[^<]*<\/rt><rp>\)<\/rp><\/ruby><ruby>(日|日間)<rp>\(<\/rp><rt>にち(?:かん)?<\/rt><rp>\)<\/rp><\/ruby>/g,
    (m, num, kanji, offset, str) => {
      if (/[0-9０-９一二三四五六七八九十百千何]$/.test(plainAround(str, offset, offset).before)) return m;
      const r = DAY_COUNTS[num === "二十" ? 20 : "〇一二三四五六七八九十".indexOf(num)];
      return r ? ruby(num + kanji, r + (kanji === "日間" ? "かん" : "")) : m;
    }
  );
  // A date's 1日 (3月1日) is ついたち; elsewhere (1日で, 1日おきに) it stays いちにち.
  html = html.replace(/(<ruby>月<rp>\(<\/rp><rt>がつ<\/rt><rp>\)<\/rp><\/ruby>)([1１])<ruby>日<rp>\(<\/rp><rt>にち<\/rt><rp>\)<\/rp><\/ruby>/g,
    (m, month, one) => month + ruby(one + "日", "ついたち"));
  // kuroshiro echoes text it cannot read — a Chinese gloss that slipped into a
  // data-ja element comes back annotated with itself (刚(刚)). Keep the text,
  // drop the ruby.
  html = html.replace(RUBY_TAG, (m, kanji, reading) => (RUBY_KANA.test(reading) ? m : kanji));

  return html.replace(RUBY_TAG, (m, kanji, reading, offset, str) => {
    const ctx = plainAround(str, offset, offset + m.length);
    for (const f of RUBY_FIXES) {
      if (f.kanji !== kanji || !f.from.test(reading)) continue;
      if (f.after && !f.after.test(ctx.after)) continue;
      if (f.before && !f.before.test(ctx.before)) continue;
      return f.to ? ruby(kanji, f.to) : kanji;
    }
    return m;
  });
}

module.exports = { RUBY_FIXES, RUBY_MERGES, DAY_COUNTS, RUBY_TAG, RUBY_KANA, ruby, plainAround, fixReadings };
