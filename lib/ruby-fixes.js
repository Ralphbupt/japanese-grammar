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
  // ── Furigana audit (2026-11-25), third pass: single kanji read on their own
  // where a compound or the context asks for another reading. ──
  // Compounds with rendaku: 料理好き ずき, 紙皿 ざら, ビニール傘 がさ, いちご狩り がり,
  // 遠慮深い ぶかい, 衝動買い がい, 会社勤め づとめ, 背表紙 びょうし, 心配性 しょう.
  { kanji: "好", from: /^す$/, before: /(料理|映画|音楽|読書|旅行|動物|世話)$/, after: /^きの/, to: "ず" },
  { kanji: "皿", from: /^さら$/, before: /(紙|小|取り|灰)$/, to: "ざら" },
  { kanji: "傘", from: /^かさ$/, before: /(ビニール|折りたたみ|折り畳み)$/, to: "がさ" },
  { kanji: "狩", from: /^か$/, before: /(いちご|イチゴ|苺|ぶどう|ブドウ|りんご|梨|みかん|紅葉|もみじ|潮干|きのこ|松茸)$/, after: /^り/, to: "が" },
  { kanji: "深", from: /^ふか$/, before: /(遠慮|用心|注意|思慮|疑り|欲|情け|罪|執念)$/, after: /^[いくさかけ]/, to: "ぶか" },
  { kanji: "買", from: /^か$/, before: /(衝動|まとめ|ついで|爆)$/, after: /^い/, to: "が" },
  { kanji: "勤", from: /^つと$/, before: /(会社|役所|銀行|工場|宮仕え)$/, after: /^め/, to: "づと" },
  { kanji: "表紙", from: /^ひょうし$/, before: /背$/, to: "びょうし" },
  { kanji: "性", from: /^せい$/, before: /(心配|冷え|凝り|苦労|飽き|貧乏)$/, to: "しょう" },
  // 〜人 as a role: 保証人, 案内人 … にん (joins 料理人 / 依頼人 below).
  { kanji: "人", from: /^じん$/, before: /(保証|案内|世話|仲介|代理|見物|受取|立会|後見|相続|差出|発起|弁護)$/, to: "にん" },
  // A lone 人 opening a quoted phrase: (人は老いるものだ), (人目もかまわず), 「人をばかにする」.
  { kanji: "人", from: /^じん$/, before: /(^|[（(「『])\s*$/, after: /^(は|を|が|目|に|の|も)/, to: "ひと" },
  // Kana-mixed spellings as the N4/N5 tests write them: 水とう すいとう, 先ぱい せんぱい.
  { kanji: "水", from: /^みず$/, after: /^とう(?!ど|がらし|もろこし)/, to: "すい" },
  { kanji: "先", from: /^さき$/, after: /^ぱい/, to: "せん" },
  // Numbers: 1泊 / 3泊 / 4泊 / 6泊 / 8泊 / 10泊 -ぱく (二泊 stays はく); 何軒 / 三軒 げん;
  // 二、三日 にさんにち (an approximate count, not the 3rd).
  { kanji: "泊", from: /^はく$/, before: /[134680１３４６８０]$/, to: "ぱく" },
  { kanji: "軒", from: /^けん$/, before: /[三何]$/, to: "げん" },
  { kanji: "三日", from: /^みっか$/, before: /二\s*[、,]\s*$/, to: "さんにち" },
  // 一時間の会議で…関係あるのは十分だけ = ten minutes.
  { kanji: "十分", from: /^じゅうぶん$/, before: /関係あるのは$/, to: "じゅっぷん" },
  // 降: お降りの際 (getting off) おり; 降りそう(だ) quoted on its own in the
  // appearance-そうだ notes is the rain one, ふりそう.
  { kanji: "降", from: /^ふ$/, before: /お$/, after: /^り(の\s*(際|方|お客)|に\s*な|ください)/, to: "お" },
  { kanji: "降", from: /^お$/, before: /(^|[^ぁ-んァ-ヶ一-龯々])$/, after: /^りそう/, to: "ふ" },
  // One reading each in the contexts named.
  { kanji: "音", from: /^おと$/, after: /^を\s*(上|あ)げ/, to: "ね" },             // 音を上げる (give up)
  { kanji: "口", from: /^ぐち$/, before: /排水$/, to: "こう" },                   // 排水口
  { kanji: "他", from: /^た$/, after: /^の\s*(お客|人|方)/, to: "ほか" },          // 他のお客様
  { kanji: "分", from: /^わ$/, before: /の$/, after: /^から[、,]/, to: "ぶん" },   // 朝ごはんの分から、
  { kanji: "表", from: /^ひょう$/, after: /^の革/, to: "おもて" },                // 表の革 (of a shoe)
  { kanji: "宝物", from: /^ほうもつ$/, to: "たからもの" },
  { kanji: "一昨年", from: /^いっさくねん$/, to: "おととし" },                     // as the N5 word list gives it
  { kanji: "義父", from: /^ぎふ$/, before: /お$/, after: /^さん/, to: "おとう" },  // お義父さん
  { kanji: "博士", from: /^はかせ$/, after: /^(論文|課程|号)/, to: "はくし" },
  { kanji: "気味", from: /^きみ$/, after: /^の\s*[+＋]\s*Noun/, to: "ぎみ" },     // 〜気味の + Noun (lesson42)
  // ── Furigana audit (2026-11-25): readings two review passes flagged in
  // context. Listed first so they win over the broader rules below; a rule
  // whose `to` equals its reading is a guard that keeps a later rule away. ──
  // 一 + counter read with a small っ: 一か月 いっかげつ, 一階 いっかい, 一分 いっぷん …
  { kanji: "一", from: /^いち$/, after: /^\s*(か月|ヶ月|カ月|か所|ヶ所|カ所|階|かい(?![しぎだもわ])|分(?!の)|曲|きょく|社|さつ|件|千万)/, to: "いっ" },
  { kanji: "一", from: /^いち$/, before: /第$/, after: /^週/, to: "いっ" },        // 第一週
  // 一晩 / 一通り / 一皿 / 一切れ, 二枚一組, 一学年一クラス: ひと-.
  { kanji: "一", from: /^いち$/, after: /^(晩|通り|皿|切れ)/, to: "ひと" },
  { kanji: "一", from: /^いち$/, before: /枚$/, after: /^組/, to: "ひと" },
  { kanji: "一", from: /^いち$/, before: /学年$/, after: /^クラス/, to: "ひと" },
  { kanji: "一声", from: /^いっせい$/, before: /鶴の$/, to: "ひとこえ" },
  // 六 / 八 / 十 before a counter that takes っ (六本 ろっぽん, 八歳 はっさい,
  // 十か所 じゅっかしょ, 四十歳 よんじゅっさい); the counter's own p-/b- reading
  // is set by the 本 / 箱 / 分 rules.
  { kanji: "六", from: /^ろく$/, after: /^\s*(本|個|か月|ヶ月|カ月|杯|匹|分|箱|回)/, to: "ろっ" },
  { kanji: "八", from: /^はち$/, after: /^\s*(さい|歳|本|箱|杯|個)/, to: "はっ" },
  { kanji: "十", from: /^じゅう$/, after: /^\s*(か所|ヶ所|カ所|か国|ヶ国|カ国|回|こ(?=[\s、。をはもがので]|$)|個|本|箱|杯|匹|歳|さい)/, to: "じゅっ" },
  { kanji: "十", from: /^じゅう$/, before: /[二三四五六七八九数]$/, after: /^分(?!\s*の\s*[0-9０-９一二三四五六七八九十])/, to: "じゅっ" },   // 二十分, 数十分
  { kanji: "百", from: /^ひゃく$/, before: /(^|[^三六八何])$/, after: /^本/, to: "ひゃっ" },     // 二百本 にひゃっぽん
  // Digits + 本: 3本 さんぼん; 1本 / 6本 / 8本 / 10本 / 百本 -っぽん.
  { kanji: "本", from: /^ほん$/, before: /[3３]$/, to: "ぼん" },
  { kanji: "本", from: /^ほん$/, before: /([1１6６8８0０]|百)$/, to: "ぽん" },
  { kanji: "箱", from: /^はこ$/, before: /[1-9１-９][0０]$/, to: "ぱこ" },       // 10箱 じゅっぱこ
  { kanji: "杯", from: /^はい$/, before: /何$/, to: "ばい" },                    // 何杯
  // 十分 = ten minutes (not じゅうぶん "enough") after a numeral or with a time phrase.
  { kanji: "十分", from: /^じゅうぶん$/, before: /([二三四五六七八九数]|歩いて|時間をもう)\s*$/, to: "じゅっぷん" },
  { kanji: "十分", from: /^じゅうぶん$/, after: /^\s*(以内|も\s*かかり|じゃとても収)/, to: "じゅっぷん" },
  // 分 after a number: ふん / ぷん by the last digit (3分 さんぷん, 25分 にじゅうごふん,
  // 20分 にじゅっぷん); never in a fraction (2分の1, 三分の一).
  { kanji: "分", from: /^(ふん|ぶん)$/, before: /[134680１３４６８０]$/, after: /^(?!\s*の\s*[0-9０-９一二三四五六七八九十])/, to: "ぷん" },
  { kanji: "分", from: /^ぶん$/, before: /[2579２５７９]$/, after: /^(?!\s*の\s*[0-9０-９一二三四五六七八九十])/, to: "ふん" },
  { kanji: "分", from: /^(ふん|ぶん)$/, before: /([一三六八何]|[二三四五六七八九数]十)$/, after: /^(?!\s*の\s*([0-9０-９一二三四五六七八九十]|隙))/, to: "ぷん" },
  { kanji: "分", from: /^(ふん|ぶん)$/, after: /^刻み/, to: "ふん" },             // 分刻み
  { kanji: "分", from: /^ぶん$/, after: /^から(ない|る|な)/, to: "わ" },          // 分からない
  { kanji: "分間", from: /^ふんかん$/, before: /[1１3３4４6６8８0０一三六八十何]$/, to: "ぷんかん" },
  { kanji: "四", from: /^よん$/, after: /^年/, to: "よ" },                      // 四年前 よねん
  { kanji: "九", from: /^きゅう$/, after: /^時/, to: "く" },                     // 九時 くじ, 九時間 くじかん
  // 引 / 下 / 何 / 家 …: one reading each, in the contexts named.
  { kanji: "引", from: /^ひ$/, before: /割$/, after: /^き/, to: "び" },          // 三割引き
  { kanji: "下", from: /^くだ$/, before: /(階段を(ゆっくり)?|上り)$/, after: /^り/, to: "お" },
  { kanji: "下", from: /^した$/, before: /「(の)?$/, after: /^(で」|に」|」\s*read)/, to: "もと" },   // 「の下で」 read もと (lesson67)
  { kanji: "下", from: /^もと$/, before: /机の$/, to: "した" },
  { kanji: "何", from: /^なに$/, after: /^か国/, to: "なん" },                   // 何か国語
  { kanji: "何", from: /^なん$/, before: /色は$/, after: /^色でも/, to: "なに" },  // 色は何色でも
  { kanji: "色", from: /^しょく$/, before: /色は何$/, after: /^でも/, to: "いろ" },
  { kanji: "家", from: /^か$/, before: /(毎日|毎朝|日中|全部|どおり)\s*$/, after: /^\s*[でにか]/, to: "いえ" },
  { kanji: "家中", from: /^かちゅう$/, to: "いえじゅう" },
  { kanji: "悔", from: /^く$/, after: /^や/, to: "くや" },                      // 悔やむ
  // 店を開く (open a shop) is ひらく: keeps the 開 → あ rule below away.
  { kanji: "開", from: /^ひら$/, before: /店を[^。]*$/, to: "ひら" },
  // 開く as the intransitive of 開ける (あく) in the explanations, and a shop,
  // library or lid that is open.
  { kanji: "開", from: /^ひら$/, after: /^く\s*(・\s*閉まる|\)|is intrans|窓を開ける)/, to: "あ" },
  { kanji: "開", from: /^ひら$/, before: /(^[^を]*(まで|から|だけ|まだ|毎日|夜も|上が)|除いて毎日)\s*$/, after: /^\s*(い[てた]|く\s*よう)/, to: "あ" },
  { kanji: "外", from: /^がい$/, before: /(あまり|夜)\s*$/, after: /^\s*[にを]/, to: "そと" },
  { kanji: "額", from: /^がく$/, after: /^に手/, to: "ひたい" },
  { kanji: "巻", from: /^まき$/, before: /最終$/, to: "かん" },
  { kanji: "顔", from: /^がお$/, before: /毎回$/, to: "かお" },
  { kanji: "義", from: /^よし$/, before: /類$/, to: "ぎ" },                      // 類義
  { kanji: "橋", from: /^きょう$/, before: /机・$/, to: "はし" },
  { kanji: "橋", from: /^きょう$/, before: /みどり$/, to: "ばし" },
  { kanji: "局", from: /^つぼね$/, to: "きょく" },
  { kanji: "空", from: /^す$/, before: /(駐車場は、?|ホールが|両手も)\s*$/, to: "あ" },   // a space or hands come free: あく
  { kanji: "係", from: /^がかり$/, before: /(^|[）)」、。\s])$/, after: /^の人/, to: "かかり" },   // 係の人
  { kanji: "隙", from: /^ひま$/, before: /乱れた$/, to: "すき" },
  { kanji: "建", from: /^だ$/, after: /^て替/, to: "た" },
  { kanji: "古", from: /^こ$/, after: /^新聞/, to: "ふる" },
  // 後 = あと: 後のこと (the latter), すぐ後に, 後から, 後になって, 会場を後にした, た後.
  { kanji: "後", from: /^(ご|のち)$/, before: /(^|[^の])\s*$/, after: /^の(こと|判断|結果|もの)/, to: "あと" },
  { kanji: "後", from: /^ご$/, before: /(〜|すぐ)$/, to: "あと" },
  { kanji: "後", from: /^ご$/, after: /^(から|になって)/, to: "あと" },
  { kanji: "後", from: /^ご$/, before: /を$/, after: /^にし/, to: "あと" },
  { kanji: "後", from: /^のち$/, before: /[たっ]\s*$/, to: "あと" },
  { kanji: "港町", from: /^みなとちょう$/, to: "みなとまち" },
  // 行く, also in its wrong te-form 行いて (lesson04): い.
  { kanji: "行", from: /^おこな$/, after: /^(いて|っ(たり来|ちゃ))/, to: "い" },
  { kanji: "行", from: /^くだり$/, before: /違う\s*$/, to: "ぎょう" },           // a table row
  { kanji: "高山", from: /^たかやま$/, after: /^植物/, to: "こうざん" },
  { kanji: "国", from: /^こく$/, before: /最近$/, after: /^の/, to: "くに" },
  { kanji: "済", from: /^す$/, before: /〜$/, after: /^み/, to: "ず" },           // 〜済み
  { kanji: "済", from: /^すみ$/, after: /^む/, to: "す" },
  // 市場: the market place (いちば) vs the economic market (しじょう).
  { kanji: "市場", from: /^しじょう$/, before: /(駅前の|地元の|朝早く|朝の)\s*$/, to: "いちば" },
  { kanji: "市場", from: /^しじょう$/, after: /^\s*(から仕入|はあきらめ|やカフェ)/, to: "いちば" },
  { kanji: "市場", from: /^いちば$/, after: /^\s*(に出せ|では円|の調査)/, to: "しじょう" },
  { kanji: "時計", from: /^とけい$/, before: /目覚まし$/, to: "どけい" },
  { kanji: "治", from: /^なお$/, before: /完$/, to: "ち" },                      // 完治
  { kanji: "者", from: /^しゃ$/, before: /(教師|弁護士)（\s*）$/, to: "もの" },     // 教師（たる）者
  { kanji: "者", from: /^しゃ$/, before: /担当の\s*$/, after: /^\s*が/, to: "もの" },
  { kanji: "車", from: /^しゃ$/, before: /(毎日|日中)$/, to: "くるま" },
  { kanji: "手", from: /^しゅ$/, before: /聴き$/, to: "て" },
  { kanji: "手不足", from: /^てぶそく$/, before: /運転$/, to: "しゅぶそく" },
  { kanji: "臭", from: /^くさ$/, before: /written\s*$/, after: /^いいい匂/, to: "にお" },
  { kanji: "出", from: /^だ$/, before: /会には$/, after: /^させ/, to: "で" },     // 発表会には出させず
  { kanji: "場", from: /^じょう$/, before: /(踏み|、水)$/, to: "ば" },            // 足の踏み場, 水場
  { kanji: "場代", from: /^ばだい$/, before: /駐車$/, to: "じょうだい" },
  { kanji: "心中", from: /^しんじゅう$/, before: /彼の$/, to: "しんちゅう" },
  { kanji: "診", from: /^み$/, before: /健$/, to: "しん" },
  { kanji: "数", from: /^すう$/, before: /注文の$/, to: "かず" },
  { kanji: "数", from: /^すう$/, after: /^多く/, to: "かず" },
  { kanji: "星", from: /^ぼし$/, before: /ぼんやり$/, to: "ほし" },
  { kanji: "正", from: /^まさ$/, after: /^しく/, to: "ただ" },
  { kanji: "生", from: /^なま$/, after: /^(\s*is せい|協)/, to: "せい" },
  { kanji: "声", from: /^ごえ$/, before: /毎晩$/, to: "こえ" },
  { kanji: "前", from: /^ぜん$/, before: /この\s*$/, to: "まえ" },
  { kanji: "蔵", from: /^ぞう$/, before: /お$/, after: /^入り/, to: "くら" },
  { kanji: "代", from: /^かわ$/, before: /修理$/, to: "だい" },
  { kanji: "台", from: /^うてな$/, to: "だい" },
  { kanji: "値", from: /^ね$/, before: /(測定の|同じ)$/, to: "あたい" },
  { kanji: "築", from: /^きづ$/, to: "きず" },
  { kanji: "預", from: /^あづ$/, to: "あず" },
  { kanji: "着", from: /^ぎ$/, before: /試$/, to: "ちゃく" },
  { kanji: "着", from: /^ちゃく$/, after: /^方/, to: "き" },
  { kanji: "中", from: /^ちゅう$/, before: /一日$/, to: "じゅう" },
  { kanji: "中", from: /^ちゅう$/, before: /忙しい\s*$/, to: "なか" },
  { kanji: "中", from: /^なか$/, after: /^\s*\(じゅう\)/, to: "じゅう" },        // lesson33: 〜中 (じゅう)
  { kanji: "中", from: /^なか$/, after: /^\s*\(ちゅう\)/, to: "ちゅう" },
  { kanji: "町中", from: /^まちなか$/, before: /世界中,\s*$/, to: "まちじゅう" },
  { kanji: "朝", from: /^ちょう$/, after: /^薬を飲/, to: "あさ" },
  { kanji: "通", from: /^かよ$/, before: /(向こうに|話は)$/, to: "とお" },
  { kanji: "通", from: /^とお$/, before: /(これまで|今まで|いつも)$/, after: /^り/, to: "どお" },
  { kanji: "通帳", from: /^かよいちょう$/, to: "つうちょう" },
  { kanji: "土", from: /^ど$/, before: /グラウンドの$/, to: "つち" },
  { kanji: "土", from: /^ど$/, after: /^で服/, to: "つち" },
  { kanji: "怒", from: /^いか$/, after: /^り(は|も)しない/, to: "おこ" },
  { kanji: "灯火", from: /^ともしび$/, before: /無$/, to: "とうか" },
  { kanji: "道", from: /^どう$/, after: /^が混/, to: "みち" },
  { kanji: "二名", from: /^にみょう$/, to: "にめい" },
  // 日中 (daytime) = にっちゅう; not after a number (3日中に).
  { kanji: "日", from: /^にち$/, before: /(^|[^0-9０-９一二三四五六七八九十何毎今])\s*$/, after: /^中[はもにの、]/, to: "にっ" },
  // "That day": その日, 次の日, 雨の日, 着いた日 … = ひ.
  { kanji: "日", from: /^にち$/, before: /(の|同じ|た|んだ)\s*$/, to: "ひ" },
  // The weekday in a date: 6日（日）, 〇月△日（金）.
  { kanji: "日", from: /^.+$/, before: /[（(]$/, after: /^[）)]/, to: "にち" },
  { kanji: "日", from: /^ひ$/, before: /[△〇○×]$/, to: "にち" },
  // 入れる = can enter (はいれる), お入り; 気に入る = いる.
  { kanji: "入", from: /^い$/, before: /お$/, after: /^り/, to: "はい" },
  { kanji: "入", from: /^い$/, before: /(会場には|志望校には|入ろうにも|車が|待たないと|様まで|でないと|ホテルに|中には|人まで|円で|クラスには|過ぎると|がたくさん|代わりに|昼に)\s*$/, after: /^れ(る|ない|ます|ません|なかっ)/, to: "はい" },
  { kanji: "入", from: /^い$/, before: /(大学に|もう|いつ|残りが半年以上ないと)\s*$/, after: /^れる(よう|ん|か)/, to: "はい" },
  { kanji: "入", from: /^い$/, before: /ないと$/, after: /^れないこと/, to: "はい" },
  { kanji: "入", from: /^はい$/, before: /気に\s*$/, to: "い" },
  { kanji: "馬", from: /^ば$/, after: /^に乗/, to: "うま" },
  { kanji: "否", from: /^いな$/, after: /^定/, to: "ひ" },                      // 否定形
  { kanji: "物", from: /^ぶつ$/, before: /(洗濯|炒め)$/, to: "もの" },
  { kanji: "並", from: /^な$/, after: /^べ/, to: "なら" },                      // 並べる
  { kanji: "米", from: /^べい$/, after: /^(の収穫|作り|屋)/, to: "こめ" },
  { kanji: "辺", from: /^あたり$/, before: /(この|長い|つの)\s*$/, after: /^\s*[はにのがをで]/, to: "へん" },
  { kanji: "抱", from: /^だ$/, before: /夢を$/, to: "いだ" },
  // 方: 先生方 がた; a direction or side stays ほう (北の方で); a person is かた.
  { kanji: "方", from: /^かた$/, before: /先生$/, to: "がた" },
  { kanji: "方", from: /^(ほう|かた)$/, before: /(北|南|東|西|右|左|前|後ろ|(?<!以)上|(?<!以)下|向こう|こっち|そっち|あっち|どっち|こちら|そちら|あちら|私|僕|わたし|駅)の\s*$/, to: "ほう" },
  { kanji: "方", from: /^かた$/, before: /(使い|書き|読み|やり|作り|考え|言い|話し|食べ|飲み|教え|生き)$/, to: "かた" },   // 使い方がよく分からない
  { kanji: "方", from: /^ほう$/, before: /(くださった|くださる|いらっしゃる|いらした|された|される)\s*$/, to: "かた" },
  { kanji: "方", from: /^ほう$/, before: /(担当|外部|個人|依頼者|近所|出版社|解説員|仕事帰り|専門|職員|団員|年配|指揮者|コレクター|制作|登山者|代表|視聴者|地元|外国|予約|プラン|初めて|四人|途中|以上|以下|未満)の\s*$/, to: "かた" },
  { kanji: "方", from: /^ほう$/, before: /あの\s*$/, after: /^\s*(の言葉|なら)/, to: "かた" },
  { kanji: "方", from: /^ほう$/, before: /その\s*$/, after: /^\s*(の\s*(都合|しりょう|資料)|とじっくり)/, to: "かた" },
  { kanji: "方", from: /^ほう$/, before: /(た|る|ない)\s*$/, after: /^\s*(の多く|がその瞬間|が増え|から|ばかり|の\s*クラス|が\s*いる|と話|が\s*いま)/, to: "かた" },
  { kanji: "方", from: /^ほう$/, before: /(思っている|思う|考える|する|いう)\s*$/, after: /^\s*(が\s*(多|、?思いのほか)|なん)/, to: "かた" },
  { kanji: "明", from: /^あ$/, after: /^かり/, to: "あか" },                    // 明かり
  { kanji: "明後日", from: /^みょうごにち$/, to: "あさって" },
  { kanji: "木", from: /^こ$/, before: /木と$/, to: "き" },
  { kanji: "目下", from: /^もっか$/, before: /目上[^。]{0,4}$/, to: "めした" },
  { kanji: "訳", from: /^わけ$/, before: /(彼女|アプリ)の$/, to: "やく" },
  { kanji: "来", from: /^き$/, after: /^園/, to: "らい" },                      // 来園者
  { kanji: "来", from: /^(き|こ)$/, before: /日本に$/, after: /^（/, to: "き" },   // 日本に来（て以来）
  { kanji: "梁", from: /^やな$/, to: "はり" },
  // Rules below that are too wide for a few phrases: 負けず嫌い ぎらい, 思い描く /
  // 克明に描く えがく, 身に堪える こたえる, 如何に いかに, いい気味 きみ, 弾ける
  // (burst) はじける, 今月末 まつ.
  { kanji: "嫌", from: /^ぎら$/, before: /負けず$/, to: "ぎら" },
  { kanji: "描", from: /^えが$/, before: /(思い|克明に)$/, to: "えが" },
  { kanji: "堪", from: /^こた$/, before: /身に$/, to: "こた" },
  { kanji: "如何", from: /^いか$/, after: /^に/, to: "いか" },
  { kanji: "気味", from: /^きみ$/, before: /(いい|良い)$/, to: "きみ" },
  { kanji: "弾", from: /^はじ$/, after: /^(けるような|け(飛|散|出)|き(出|返|飛))/, to: "はじ" },
  { kanji: "末", from: /^まつ$/, before: /(月|年|週|期|学期|年度)$/, to: "まつ" },
  // 紅葉 in lesson25 is もみじ (its word table, and the grammar audio reads it so);
  // lesson51 keeps こうよう. Reader report 2026-11-24.
  { kanji: "紅葉", from: /^こうよう$/, before: /やっぱり\s*$/, to: "もみじ" },
  { kanji: "紅葉", from: /^こうよう$/, after: /^を思い出す/, to: "もみじ" },
  // Days of the week with 曜 in kana, as N5 tests write them (水よう日): kuromoji
  // reads the lone kanji as a word (みず, き …). Reader reports 2026-11-24.
  { kanji: "月", from: /^つき$/, after: /^よう日/, to: "げつ" },
  { kanji: "火", from: /^ひ$/, after: /^よう日/, to: "か" },
  { kanji: "水", from: /^みず$/, after: /^よう日/, to: "すい" },
  { kanji: "木", from: /^(き|こ)$/, after: /^よう日/, to: "もく" },
  { kanji: "金", from: /^(かね|かな)$/, after: /^よう日/, to: "きん" },
  { kanji: "土", from: /^つち$/, after: /^よう日/, to: "ど" },
  { kanji: "日", from: /^(ひ|か)$/, after: /^よう日/, to: "にち" },
  // 百 / 千 after a numeral that changes their sound, when kuromoji reads them
  // apart: 三百 さんびゃく, 六百 ろっぴゃく, 八百 はっぴゃく, 何百 なんびゃく,
  // 三千 さんぜん, 八千 はっせん. Reader report 2026-11-24 (三百 さんひゃく).
  { kanji: "百", from: /^ひゃく$/, before: /(三|何)$/, to: "びゃく" },
  { kanji: "百", from: /^ひゃく$/, before: /(六|八)$/, to: "ぴゃく" },
  { kanji: "六", from: /^ろく$/, after: /^百/, to: "ろっ" },
  { kanji: "八", from: /^はち$/, after: /^(百|千)/, to: "はっ" },
  { kanji: "千", from: /^せん$/, before: /(三|何)$/, to: "ぜん" },
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
  { kanji: "分", from: /^ぶん$/, before: /[二五九]\s*$/, after: /^(?!\s*の\s*[0-9０-９一二三四五六七八九十]|九厘)/, to: "ふん" },   // 五分 = ごふん; not 二分の一, 九分九厘
  { kanji: "間", from: /^(ま|かん)$/, before: /(その|この)\s*$/, after: /^\s*[、,]?\s*(私|わたし|僕|ぼく|連絡|に|は|、|ずっと|や|の|見)/, to: "あいだ" },
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
  { kanji: "所", from: /^しょ$/, before: /(給水|印刷|診療|避難)$/, to: "じょ" },
  { kanji: "印刷所", from: /^いんさつしょ$/, to: "いんさつじょ" },
  { kanji: "場", from: /^じょう$/, before: /稽古$/, to: "ば" },
  { kanji: "一言", from: /^いちげん$/, after: /^(?!居士)/, to: "ひとこと" },
  { kanji: "帰", from: /^き$/, after: /^す/, to: "かえ" },
  { kanji: "軽", from: /^けい$/, after: /^め/, to: "かる" },
  { kanji: "年", from: /^とし$/, after: /^に[数一二三何]/, to: "ねん" },
  { kanji: "大", from: /^だい$/, after: /^ごと/, to: "おお" },
  // ── N1 lessons (76–92): context-specific readings; listed first so they win
  // over the general rules below. ──
  { kanji: "店", from: /^(てん|みせ)$/, before: /(号|人気|高級|飲食|専門|支|本|料理|模擬|量販|加盟|洋食|家具|菓子|時計|電器)$/, to: "てん" },
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
  { kanji: "降", from: /^(くだ|お)$/, before: /[雨雪槍][がはも]$/, after: /^ろう/, to: "ふ" },
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
  { kanji: "一", from: /^いち$/, after: /^(歩|球|着|戸|泊|本|冊|軒|国|点|回|滴|杯|発|家)/, to: "いっ" },
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
    before: /(ます|ない|たり|辞[書书]|可能|使役|受身|受け身|命令|意[向志]|普通|丁寧|仮定|条件|連用|基本|否定|原|過去|ている|でいる|[VＶ]|(?<!っ)[たて]|[ばイ])$/,
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
  { kanji: "弾", from: /^はじ$/, after: /^[きけい]/, to: "ひ" },
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
  // Not あっという間に / いつの間に / 瞬く間に, and not 間に 合う written apart.
  { kanji: "間", from: /^ま$/, before: /(?<!あっという|いつの|瞬く|つかの|束の)\s*$/, after: /^に(?!\s*(合|あ[わいうえっ]))/, to: "あいだ" },
  { kanji: "間", from: /^ま$/, before: /時間の$/, after: /^を表す/, to: "あいだ" },   // ある時間の間を表す
  // 〜の間 / 待つ間 / 歩いている間 / 長い間 / 少しの間 = あいだ; 茶の間, 寝る間も
  // 惜しんで, 間をあける, 間もなく keep ま.
  { kanji: "間", from: /^ま$/, before: /((?<!いつ|茶|床|つか|束|一定)の|[るつく]|長い|短い)\s*$/, after: /^\s*(?!に\s*(合|あ[わいうえっ])|を|も\s*(惜|な))/, to: "あいだ" },
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
  [["二", "十", "歳"], "はたち"],
];

// Runs of rubies cut at the wrong place: [kanji, reading regex] in → [kanji, reading] out.
const RUBY_RECUTS = [
  [[["一", "いち"], ["日", "にち"], ["中日", "ちゅうにち"], ["陰", "かげ"]], [["一日中", "いちにちじゅう"], ["日陰", "ひかげ"]]],
  [[["何", "なに|なん"], ["度外", "どがい"]], [["何度", "なんど"], ["外", "そと"]]],
  [[["今", "こん|いま"], ["日取", "ひど"]], [["今日", "きょう"], ["取", "と"]]],
  [[["一", "いち|いっ"], ["切口", "きりくち"]], [["一切", "いっさい"], ["口", "くち"]]],
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
    after: strip(str.slice(end, end + 240)).slice(0, 16),   // word-table cells carry long tags between words
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
  // Words kuromoji cuts in the wrong place, re-cut: 一日中日陰 (not 中日),
  // 何度外に (not 度外), 今日取りに (not 日取り), 一切口にせず (not 切口).
  for (const [from, to] of RUBY_RECUTS) {
    const re = new RegExp(from.map(([k, r]) => `<ruby>${k}<rp>\\(</rp><rt>(?:${r})</rt><rp>\\)</rp></ruby>`).join(""), "g");
    html = html.replace(re, to.map(([k, r]) => ruby(k, r)).join(""));
  }
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
