# Practice questions

Question files live in `questions/N{level}/`: grammar per lesson, vocabulary and reading in their own files (below). `node build-quiz.js` validates every file (the build runs the same check and stops on errors). Product spec: `docs/quiz-practice-spec.md`.

## Files and types

Field-level format: the header comment in `build-quiz.js`. Reference examples: `N5/lesson05.json` (grammar), `N5/moji-goi.json` (one of each vocabulary type), `N5/dokkai.json` (文章の文法, 短文, 情報検索).

| file | `type` | JLPT item | stem | answer |
|---|---|---|---|---|
| `lessonNN.json` | `bunpou` | 文の文法1 | one `（　）` | `answer` 0–3 |
| | `narabe` | 文の文法2 | `[_] [_] [★] [_]` (★ in any slot) | `order`; the answer is what lands on ★ |
| `moji-goi*.json` | `kanji` | 漢字読み | `<<漢字>>` underlined | readings (kana only) |
| | `hyouki` | 表記 | `<<かな>>` underlined | spellings (kanji or katakana) |
| | `gokeisei` | 語形成 (N2) | one `（　）` next to a word: `（　）社会`, `会議（　）` | prefixes / suffixes / compound parts |
| | `bunmyaku` | 文脈規定 | one `（　）` | words |
| | `iikae` | 言い換え類義 | `<<whole sentence or phrase>>` | whole sentences |
| | `youhou` | 用法 (N4+) | just the word: `<<けしき>>` | four sentences using it; one uses it correctly |
| `dokkai*.json` | `bunshou` | 文章の文法 | passage with `[[1]] [[2]] …`, one question per blank | |
| | `short` / `mid` / `long` / `info` | 内容理解（短文 / 中文 / 長文 (N3)）/ 情報検索 | passage (+ optional `intro` line); each question has `q` | |
| | `tougou` | 統合理解 (N2) | two texts in one passage, headed `A` and `B` on their own lines | |
| | `shuchou` | 主張理解（長文）(N2) | one argumentative text | |

Furigana follows the real test: none in vocabulary; N5/N4 grammar and reading have it; N3/N2 have none in the question (the finished sentence and explanations shown after answering keep it). Never write readings yourself.

Several files of the same kind (`moji-goi-kanji.json`, `dokkai-info.json` …) are fine; ids must be unique per level. Ranges used for N5: `n5-mg-1xx` kanji, `2xx` hyouki, `3xx` bunmyaku, `4xx` iikae; `n5-dk-1xx` bunshou, `2xx` short, `3xx` mid, `4xx` info.

## Mock tests

`questions/N{level}/mock-N/` holds one test: `moji-goi.json`, `bunpou.json` (grammar, same shape as a lesson file) and `dokkai.json`, with as many questions of each type as the real test:

| | vocabulary | grammar | reading |
|---|---|---|---|
| N5 | kanji 7, hyouki 5, bunmyaku 6, iikae 3 | bunpou 9, narabe 4, bunshou 1×4 | short 2×1, mid 1×2, info 1×1 |
| N4 | kanji 7, hyouki 5, bunmyaku 8, iikae 4, youhou 4 | bunpou 13, narabe 4, bunshou 1×4 | short 3×1, mid 1×3, info 1×2 |
| N3 | kanji 8, hyouki 6, bunmyaku 11, iikae 5, youhou 5 | bunpou 13, narabe 5, bunshou 1×5 | short 4×1, mid 2×3, long 1×4, info 1×2 |
| N2 | kanji 5, hyouki 5, gokeisei 5, bunmyaku 7, iikae 5, youhou 5 | bunpou 12, narabe 5, bunshou 1×5 | short 5×1, mid 3×3, tougou 1×2, shuchou 1×3, info 1×2 |
| N1 | kanji 6, bunmyaku 7, iikae 6, youhou 6 | bunpou 10, narabe 5, bunshou 1×5 | short 4×1, mid 3×3, long 1×4, tougou 1×3, shuchou 1×4, info 1×2 |

(N5/N4 from the JLPT's 2020 revision notice; N3/N2/N1 are the usual published counts — the JLPT no longer lists them and says they vary slightly.) Ids `n5-m1-001…` (passages `n5-m1-p1…`). Mock questions are new — never copied from or into the practice bank — and go through the same blind review (`node tools/quiz-blind.js sheet N5/mock-1 moji-goi`). The test's sittings, times and pass marks come from `MOCK` in `build-quiz.js`.

## How many

- Each numbered grammar point (`## N.` in the lesson) gets **3 questions**: 2 `bunpou` + 1 `narabe`. A point that is a big reference topic (e.g. particles, conjugation tables) may get up to 5.
- Skip `## N.` sections that are not a testable pattern (pure reference tables, "common mistakes" lists) — or test the mistakes they list, if they make good distractors.
- `refs`: `"lessonNN#K"` where K is the `## K.` number. A question may also cite a second point it contrasts with.

## Vocabulary (文字・語彙)

Like the real section there is no furigana, so write stems **in kana** except the tested word and words the level writes in kanji anyway (N5: very common ones only). The tested word is underlined with `<<…>>`.

- `kanji`: the underlined word uses kanji from the level's list (N5 ≈ 100 kanji: 日 月 火 水 木 金 土 山 川 田 人 子 女 男 目 口 耳 手 足 上 下 中 外 右 左 前 後 午 今 先 生 学 校 年 時 間 分 半 毎 何 週 曜 一〜十 百 千 万 円 大 小 長 高 安 新 古 多 少 白 父 母 友 名 国 語 本 天 気 雨 電 車 道 駅 社 店 食 飲 見 聞 読 書 話 言 行 来 出 入 休 会 買 立 東 西 南 北 花 魚 …). Distractors are the classic confusions: long vs short vowel (こうこう/こうこ), voicing (てんき/でんき), small っ, ゃゅょ, on vs kun reading, the reading of a look-alike word.
- `hyouki`: the underlined word is in hiragana (or a katakana loanword written in hiragana); options are look-alike kanji (外/夕/名/多) or wrong katakana (ホテル/ホテハ/ホラル).
- `bunmyaku`: options are four words of the same part of speech; only one fits the meaning (no grammar trick — that's the 文法 section).
- `iikae`: options are four full sentences; exactly one means the same as the underlined part. Typical: a word and its definition (つとめています → しごとをしています), opposites, おととい/きのう, time words.
- `refs`: optional, `lessonNN#vocab` when the word is in that lesson's 本课单词表.

Vocabulary ranges: N4 word ids `n4-mg-1xx` kanji, `2xx` hyouki, `3xx` bunmyaku, `4xx` iikae, `5xx` youhou (N2 adds `6xx` gokeisei); same pattern at each level. Reading: `nX-dk-1xx` bunshou, `2xx` short, `3xx` mid, `4xx` info, `5xx` long, `6xx` tougou, `7xx` shuchou.

- `youhou`: four sentences, each using the word; exactly one uses it in the right meaning/collocation. The wrong three must be clearly wrong (a word that would fit there instead is a good guide), not just a little odd.
- `gokeisei` (N2): prefixes/suffixes (未・非・不・無・再・〜的・〜化・〜性・〜感・〜済み・〜付き …) and compound parts; only one forms a real word with that meaning.

## Reading (読解) and 文章の文法

- Passages are original, everyday, at the level (N5: a note, a short diary/essay, a message, a timetable/menu/notice). Use furigana-free text — the build adds it.
- Lengths scale with the level (N5 numbers first; N4 ≈ ×1.2; N3 short ~150–200, mid ~350, long ~550, info ~600; N2 short ~200, mid ~500, tougou 2×~300, shuchou ~900, info ~700). Grammar and vocabulary at the level; topics adult and varied at N3/N2 (work, society, essays, notices).
- `short`: ~80–150 characters, 1 question. `mid`: ~250–350 characters, 2 questions. `info`: a table (`|` lines) plus a few notes and an `intro` saying who wants what; 1–2 questions that need two conditions combined. `bunshou`: an essay/letter of ~200 characters with 3–4 blanks testing connectors, tense, particles and set phrases in context.
- Each wrong option must be wrong *because of something in the text* (and `wrong[i]` says what). Avoid questions answerable without reading.
- `tr` on the passage: a full translation (zh + en), shown after answering.

## Writing rules

**One right answer, provably.** Every question must have exactly one option that a careful native speaker accepts. For each distractor, ask: "is there any reading of this sentence where this works?" If yes, change the context until it doesn't (add a reply, a time word, a preceding sentence). This is the most common failure — e.g. 「図書館で大きい声で話して（　）」: both 「はいけません」 and 「います」 are grammatical; adding 「静かにしてください。」 before it makes only the prohibition fit.

**Distractors a learner would actually pick.** Use forms that look plausible: a neighbouring grammar point from the same or an earlier lesson, the wrong conjugation of the right word, the wrong particle, a near-synonym. Not nonsense. All four options roughly the same length and shape.

**`narabe` has exactly one valid order.** Check that no other arrangement of the four pieces is also a correct sentence (adverbs and 「〜を」「〜に」 phrases often swap freely — avoid making two such phrases separate pieces). The pieces plus the stem must produce `full`.

**Level.** (Grammar questions.) Grammar and vocabulary at or below the question's level; for N5 only N5 grammar (lessons 00–17) and common N5 words. Write like the real test: spaces between phrases (分かち書き), kanji the level would use (N5: basic kanji like 学校・先生・行く・食べる; otherwise kana). Furigana is added by the build — never write readings in the text. Natural, everyday situations; dialogues as `A「…」\nB「…」`.

**Explanations.** `why`: one or two sentences — the clue in the sentence and the rule it triggers. `wrong[i]`: one sentence per distractor saying *why it's wrong here* (meaning / connection / doesn't fit the context) — not just "wrong". `tr`: natural translation of `full`. Chinese is simplified, no romaji anywhere. Japanese inside explanations goes in 「」.

**ids.** `n5-l05-001`, numbered in file order, never reused or renumbered once published (progress is keyed on them). If you change a published question's answer, bump `rev`.

## Review (before a question ships)

1. Write the questions.
2. **Blind solve**: someone who hasn't seen the answers takes the questions (stem + options only) and answers each, flagging anything ambiguous or unnatural.
3. Any disagreement or flag → fix or drop the question.
4. `node build-quiz.js` passes.
