// Generate Anki import TSV files from the lesson markdown.
// Output: dist/anki/jpnotes-{N5,N4,N3,N2}.txt — TSV with Anki front-matter.
//
// Users import these in Anki via File → Import (or drag-drop). Anki's
// native format supports HTML in fields, so card formatting is preserved.
// No third-party library — avoids genanki-js (AGPL) and anki-apkg-export
// (memory-limited sql.js).
//
// Each grammar point becomes one card:
//   Front: 〜term, JLPT level, lesson number
//   Back:  description, meaning prose, example sentences, link to jpnotes.dev

const fs = require("fs");
const path = require("path");
const KuroshiroMod = require("kuroshiro");
const Kuroshiro = KuroshiroMod.default || KuroshiroMod;
const KuromojiMod = require("kuroshiro-analyzer-kuromoji");
const KuromojiAnalyzer = KuromojiMod.default || KuromojiMod;

const SITE = "https://jpnotes.dev/";
const OUT_DIR = path.join(__dirname, "dist", "anki");
const LEVELS = ["N5", "N4", "N3", "N2"];

// Kuroshiro furigana — same engine as build.js so card readings match
// the website's. Init once, reuse for every example sentence.
let kuro = null;
async function initKuroshiro() {
  kuro = new Kuroshiro();
  await kuro.init(new KuromojiAnalyzer());
}

const HAS_KANJI = /[一-龯㐀-䶿]/;

// Simplified-Chinese-only characters (same set as build.js) — these never
// appear in Japanese text. An "example" line whose Japanese half contains
// any of them is actually Chinese prose (explanation paragraphs, table
// labels) and must not be furigana-annotated or turned into a card example.
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

async function withFurigana(text) {
  if (!text || !HAS_KANJI.test(text)) return text;
  try {
    return await kuro.convert(text, { to: "hiragana", mode: "furigana" });
  } catch {
    return text;
  }
}

// ─── Markdown parsing ───

function stripMd(text) {
  return text
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\s*\|.*$/gm, "")
    .replace(/^\s*[-=—]{3,}\s*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

function extractBilingual(text) {
  const zh = text.match(/^:::zh\s*\n([\s\S]*?)^:::\s*$/m);
  const en = text.match(/^:::en\s*\n([\s\S]*?)^:::\s*$/m);
  return {
    zh: zh ? zh[1].trim() : null,
    en: en ? en[1].trim() : null,
  };
}

function parseGrammarSections(md) {
  const sections = [];
  const lines = md.split("\n");
  let current = null;
  let buffer = [];

  // Harvest numbered example lines from 用法①②③-style subsections when a
  // point has no dedicated ### 例句 header, merging dialogue continuation
  // lines (e.g. "1. A：…" + "B：…（译）") into one.
  function harvestExamples(subSections, lang) {
    const exItems = [];
    for (let i = 1; i < subSections.length; i++) {
      const sub = subSections[i];
      const headerLine = sub.split("\n")[0];
      if (/^(接[续続]|Conjugation)/i.test(headerLine)) continue;
      if (/例句|例文|Example/i.test(headerLine)) continue;
      const text = extractBilingual(sub.split("\n").slice(1).join("\n"))[lang];
      if (!text) continue;
      let cur = null;
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (/^\d+[.、．]/.test(line)) {
          if (cur) exItems.push(cur);
          cur = line;
        } else if (cur && line && /[぀-ヿ一-鿿]/.test(line)) {
          cur += " " + line;
        } else if (cur && !line) {
          exItems.push(cur);
          cur = null;
        }
      }
      if (cur) exItems.push(cur);
    }
    const jp = exItems.filter(s => /[぀-ヿ一-鿿]/.test(s));
    return jp.length ? jp.join("\n") : null;
  }

  // Strip numbered example lines that leak into a meaning harvested from a
  // 用法① subsection; fall back to the heading's parenthetical description.
  function cleanMeaning(meaning, fallbackDesc) {
    if (!meaning) return null;
    const cleaned = meaning
      .split("\n")
      .filter(l => !/^\d+[.、．]\s*.*[぀-ヿ一-鿿]/.test(l.trim()))
      .join("\n")
      .trim();
    return cleaned || fallbackDesc || null;
  }

  function flush() {
    if (!current) return;
    const content = buffer.join("\n");
    const subSections = content.split(/^### /m);
    let meaning = null;
    let meaningEn = null;
    let examples = null;
    let examplesEn = null;
    for (let i = 1; i < subSections.length; i++) {
      const sub = subSections[i];
      const headerLine = sub.split("\n")[0];
      const subBody = sub.split("\n").slice(1).join("\n");
      if (/^(接[续続]|Conjugation)/i.test(headerLine)) continue;
      const bilingual = extractBilingual(subBody);
      if (!meaning && /含义|含意|用法|核心|意味|Meaning|Usage|Nuance/i.test(headerLine)) {
        meaning = bilingual.zh || bilingual.en;
        meaningEn = bilingual.en;
      } else if (!examples && /例句|例文|Example/i.test(headerLine)) {
        examples = bilingual.zh || bilingual.en;
        examplesEn = bilingual.en;
      }
    }
    if (!meaning) {
      const fallback = extractBilingual(content);
      meaning = fallback.zh;
      meaningEn = meaningEn || fallback.en;
    }
    if (!examples) examples = harvestExamples(subSections, "zh");
    if (!examplesEn) examplesEn = harvestExamples(subSections, "en");
    meaning = cleanMeaning(meaning, current.description);
    meaningEn = cleanMeaning(meaningEn, current.descriptionEn);
    if (meaning) {
      sections.push({ ...current, meaning, meaningEn, examples, examplesEn });
    }
    current = null;
    buffer = [];
  }

  for (const line of lines) {
    const h2 = line.match(/^## (\d+)\.\s*(.+?)(?:\|\|(.*))?$/);
    if (h2) {
      flush();
      const headingText = h2[2].trim();
      // Include 〜 in the body character class so terms like
      // "〜です / 〜ではありません" don't get truncated at the second 〜.
      const termMatch = headingText.match(/^([〜～]?[〜～぀-ゟ゠-ヿー一-鿿/・\s,，、]+)/);
      const term = termMatch ? termMatch[1].trim() : headingText;
      const descMatch = headingText.match(/[（(]([^）)]+)[）)]/);
      const description = descMatch ? descMatch[1].trim() : null;
      // English description from the English heading half. Two formats exist:
      //   "…||1. 〜はもとより (Not to mention…)"   → trailing parenthetical
      //   "…||を — Object Particle"                → em-dash separated
      const enHeading = (h2[3] || "").replace(/^\d+\.\s*/, "").trim();
      let descriptionEn = null;
      const descEnParen = enHeading.match(/[（(]([^（）()]+)[）)]\s*$/);
      const descEnDash = enHeading.match(/\s[—–-]\s*(.+)$/);
      if (descEnParen) descriptionEn = descEnParen[1].trim();
      else if (descEnDash) descriptionEn = descEnDash[1].trim();
      current = { term, description, descriptionEn };
      continue;
    }
    if (line.startsWith("## ") && current) {
      flush();
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

// ─── Card formatting (HTML) ───

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Parse one example line into { jp, zh } — or null when the line is not a
// Japanese example sentence (table rows, headings, Chinese prose paragraphs
// from conjugation-table lessons). Only the Japanese half may be sent to
// kuroshiro; annotating Chinese produces garbage readings like 英(かずひで).
function parseExampleLine(line) {
  const m = line.match(/^\d+[.、．]\s*(.+)$/);
  const content = (m ? m[1] : line.replace(/^[\-•・]\s*/, "")).trim();
  if (!content || content.includes("|")) return null;
  // Split off the trailing （中文译文）; greedy jp match targets the LAST
  // paren pair so Japanese parentheticals earlier in the sentence survive.
  // Any tail after the paren (e.g. "→ 经过的场所") joins the translation.
  let jp = content;
  let zh = null;
  const split = content.match(/^([\s\S]+)[（(]([^（）()]+)[）)](.*)$/);
  if (split) {
    const cand = split[2].trim();
    // A translation is Chinese: no kana, or contains simplified-only chars.
    if (!/[぀-ゟ゠-ヿ]/.test(cand) || hasSC(cand)) {
      jp = split[1].trim();
      zh = cand + (split[3].trim() ? " " + split[3].trim() : "");
    }
  }
  // The Japanese half must actually look Japanese.
  if (!/[぀-ゟ゠-ヿ]/.test(jp) || hasSC(jp)) return null;
  return { jp, zh };
}

// Build both the structured example list and its rendered HTML.
// `lang` picks which translation to show; `withAudio` renders [sound:...]
// tags (only meaningful inside .apkg).
function renderExamples(items, lang, withAudio) {
  const lis = items.map(it => {
    const sound = withAudio && it.audio ? `[sound:${it.audio}]` : "";
    const trans = lang === "en" ? it.en : it.zh;
    const transHtml = trans
      ? `<br><span style="color:#888;font-size:.88em;">${escapeHtml(trans)}</span>`
      : "";
    return `<li>${it.jpHtml}${sound}${transHtml}</li>`;
  });
  return `<ol style="padding-left:1.4em;margin:.4em 0;">${lis.join("")}</ol>`;
}

function parseExampleLines(text) {
  const items = [];
  if (!text) return items;
  for (const line of stripMd(text).split("\n")) {
    if (!line.trim()) continue;
    const parsed = parseExampleLine(line.trim());
    if (parsed) items.push(parsed);
  }
  return items;
}

// The zh block is canonical (always present); the en block repeats the same
// Japanese sentences with English translations. Merge the English in by
// matching on the Japanese text so one item carries both translations.
async function buildExamples(textZh, textEn) {
  const items = parseExampleLines(textZh);
  const enItems = parseExampleLines(textEn || "");
  if (items.length === 0 && enItems.length) {
    // zh-less section (rare): base the cards on the en block instead.
    for (const it of enItems) items.push({ jp: it.jp, zh: null, en: it.zh });
  } else {
    const enMap = new Map(enItems.map(it => [it.jp.replace(/\s+/g, ""), it.zh]));
    for (const it of items) {
      it.en = enMap.get(it.jp.replace(/\s+/g, "")) || null;
    }
  }
  for (const it of items) {
    it.jpHtml = await withFurigana(it.jp);
  }
  return { items };
}

function makeFront(term, level, lessonNum) {
  return `<div style="text-align:center;padding:1em;">
<div style="font-size:2.2em;color:#e94560;font-weight:700;line-height:1.3;">${escapeHtml(term)}</div>
<div style="color:#888;margin-top:.8em;font-size:.9em;">JLPT ${level} · Lesson ${lessonNum}</div>
</div>`;
}

function makeBack(term, description, meaning, examplesHtml, lessonNum, lessonUrl, lang) {
  const descBlock = description
    ? `<div style="color:#555;font-size:.95em;margin:.2em 0 .6em;">${escapeHtml(description)}</div>`
    : "";
  const meaningBlock = meaning
    ? `<div style="margin:.6em 0;">${escapeHtml(stripMd(meaning)).replace(/\n+/g, "<br>")}</div>`
    : "";
  const exLabel = lang === "en" ? "Examples" : "例句";
  const examplesBlock = examplesHtml
    ? `<div style="font-weight:700;color:#1a1a2e;margin:1em 0 .3em;font-size:.9em;">${exLabel}</div>${examplesHtml}`
    : "";
  return `<div style="font-family:-apple-system,sans-serif;line-height:1.7;padding:.5em 1em;">
<div style="font-size:1.6em;color:#e94560;font-weight:700;">${escapeHtml(term)}</div>
${descBlock}
<hr style="border:0;border-top:1px solid #ddd;margin:.8em 0;">
${meaningBlock}${examplesBlock}
<div style="margin-top:1.2em;padding-top:.8em;border-top:1px solid #eee;"><a href="${lessonUrl}" style="color:#e94560;text-decoration:none;font-size:.85em;">📖 jpnotes.dev/lesson${lessonNum}/</a></div>
</div>`;
}

// TSV-safe field: replace tab/newline (Anki TSV is one-line-per-card by default)
function tsvField(html) {
  return html.replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

// ─── Main ───

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Initializing kuroshiro for example-sentence furigana...");
  await initKuroshiro();
  console.log("Kuroshiro ready.");

  let total = 0;
  const summary = [];
  const skippedNoExamples = [];
  // Card cache for the Python .apkg pass — avoids re-parsing markdown
  // and re-running furigana from a separate language runtime.
  const cardCache = {};

  // Example text → pre-generated TTS id. dist/.audio-requests.json is
  // rewritten by build.js on every run, so it always matches current lesson
  // content; matching by text (not position) keeps this immune to the
  // positional-ID shifting that plagues the site's data-audio attributes.
  const audioMap = new Map();
  try {
    const reqs = JSON.parse(
      fs.readFileSync(path.join(__dirname, "dist", ".audio-requests.json"), "utf-8")
    );
    for (const { id, text } of reqs) audioMap.set(text.replace(/\s+/g, ""), id);
  } catch {
    console.log("  (dist/.audio-requests.json missing — building decks without audio)");
  }
  const audioDir = path.join(__dirname, "audio");
  let audioHits = 0;
  let audioMisses = 0;
  let enMeaningFallbacks = 0;

  for (const level of LEVELS) {
    const dir = path.join(__dirname, "grammar", level);
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter(f => /^lesson\d+_.*\.md$/.test(f))
      .sort();

    // Anki's import format: comments / headers prefixed with `#`
    const tsvHeader = deckName => [
      "#separator:tab",
      "#html:true",
      `#deck:${deckName}`,
      "#notetype:Basic",
      "#columns:Front\tBack",
    ];
    const rows = tsvHeader(`日语语法 ${level} · jpnotes.dev`);
    const rowsEn = tsvHeader(`Japanese Grammar ${level} · jpnotes.dev`);

    let count = 0;
    cardCache[level] = { zh: [], en: [] };
    for (const f of files) {
      const md = fs.readFileSync(path.join(dir, f), "utf-8");
      const lessonMatch = f.match(/^lesson(\d+)/);
      if (!lessonMatch) continue;
      const lessonNum = lessonMatch[1];
      const lessonUrl = `${SITE}lesson${lessonNum}/`;
      const sections = parseGrammarSections(md);
      // Same-term points within one lesson (e.g. そうだ 样态 vs 传闻) would
      // produce identical fronts — ambiguous at review time and merged by
      // Anki's duplicate detection. Suffix the parenthetical description.
      const termCount = {};
      for (const s of sections) termCount[s.term] = (termCount[s.term] || 0) + 1;
      for (const s of sections) {
        const dup = termCount[s.term] > 1;
        s.displayTerm = dup && s.description ? `${s.term}（${s.description}）` : s.term;
        const descEn = s.descriptionEn || s.description;
        s.displayTermEn = dup && descEn ? `${s.term} (${descEn})` : s.term;
      }
      let lessonCards = 0;
      for (const s of sections) {
        // Filter out non-grammar cards:
        // 1. Must have examples (section overviews and summaries don't)
        // 2. Must not be a generic section heading (練習, 総結, etc.)
        const NOISE = /基本用法|常见错误|总结|総結|対比|对比|知識点|练习|練習|今日|辨析|详解|概论|入门|変形|动词分类|分类|副词化|用法总览|全部|总览|間違い|よくある|同一场景|切换规则/;
        if (!s.examples && !s.examplesEn) continue;
        if (NOISE.test(s.term)) continue;
        const ex = await buildExamples(s.examples, s.examplesEn);
        // 3. Must have at least one REAL Japanese example after filtering —
        //    conjugation-table lessons whose "examples" are Chinese prose or
        //    table cells produce none, and a card without examples is noise.
        if (ex.items.length === 0) continue;
        for (const it of ex.items) {
          const id = audioMap.get(it.jp.replace(/\s+/g, ""));
          if (id && fs.existsSync(path.join(audioDir, `${id}.mp3`))) {
            it.audio = `${id}.mp3`;
            audioHits++;
          } else {
            audioMisses++;
          }
        }
        const exampleData = ex.items.map(it => ({
          jp: it.jp,
          jpHtml: it.jpHtml,
          zh: it.zh || null,
          en: it.en || null,
          audio: it.audio || null,
        }));
        const shared = { level, lessonNum, term: s.term, url: lessonUrl, examples: exampleData };

        // 中文版
        const front = makeFront(s.displayTerm, level, lessonNum);
        const back = makeBack(s.displayTerm, s.description, s.meaning, renderExamples(ex.items, "zh", false), lessonNum, lessonUrl, "zh");
        const backApkg = makeBack(s.displayTerm, s.description, s.meaning, renderExamples(ex.items, "zh", true), lessonNum, lessonUrl, "zh");
        rows.push(`${tsvField(front)}\t${tsvField(back)}`);
        cardCache[level].zh.push({
          ...shared,
          front,
          back,
          backApkg,
          displayTerm: s.displayTerm,
          description: s.description || null,
        });

        // English edition — English meaning/description, falling back to the
        // Chinese text when a lesson lacks the :::en block (counted below).
        const meaningEn = s.meaningEn || s.meaning;
        if (!s.meaningEn) enMeaningFallbacks++;
        const descEn = s.descriptionEn || s.description;
        const frontEn = makeFront(s.displayTermEn, level, lessonNum);
        const backEn = makeBack(s.displayTermEn, descEn, meaningEn, renderExamples(ex.items, "en", false), lessonNum, lessonUrl, "en");
        const backEnApkg = makeBack(s.displayTermEn, descEn, meaningEn, renderExamples(ex.items, "en", true), lessonNum, lessonUrl, "en");
        rowsEn.push(`${tsvField(frontEn)}\t${tsvField(backEn)}`);
        cardCache[level].en.push({
          ...shared,
          front: frontEn,
          back: backEn,
          backApkg: backEnApkg,
          displayTerm: s.displayTermEn,
          description: descEn || null,
        });

        count++;
        lessonCards++;
      }
      // A lesson contributing 0 cards is silently absent from the deck — flag it
      // so it's caught rather than discovered by a confused user. Review/summary
      // lessons legitimately produce none, so this is a heads-up, not an error.
      if (lessonCards === 0) skippedNoExamples.push(`${level}/lesson${lessonNum} (${f})`);
    }

    const outPath = path.join(OUT_DIR, `jpnotes-${level}.txt`);
    fs.writeFileSync(outPath, rows.join("\n"), "utf-8");
    const outPathEn = path.join(OUT_DIR, `jpnotes-${level}-en.txt`);
    fs.writeFileSync(outPathEn, rowsEn.join("\n"), "utf-8");
    console.log(`  Generated ${outPath} + -en.txt (${count} cards each)`);
    summary.push({ level, count });
    total += count;
  }

  // Landing page at /anki/ for users browsing jpnotes.dev/anki/
  const cardCellsEn = summary
    .map(
      s => `  <div class="anki-card">
    <span class="anki-level">${s.level}</span>
    <span class="anki-title"><span class="lang-zh">JLPT ${s.level} 文法卡组</span><span class="lang-en">JLPT ${s.level} Grammar Deck</span></span>
    <span class="anki-count"><span class="lang-zh">${s.count} 张卡 × 中文/English 两版 · 🔊 含音频+挖空</span><span class="lang-en">${s.count} cards × 中文/English editions · 🔊 audio + cloze</span></span>
    <a class="anki-dl anki-dl-primary" href="jpnotes-${s.level}.apkg" onclick="trackDl('${s.level}','apkg','zh');return shareApkg(this, 'jpnotes-${s.level}.apkg')">⬇ <span class="lang-zh">.apkg 中文版（推荐 / 手机一键导入）</span><span class="lang-en">.apkg Chinese edition (one-tap import)</span></a>
    <a class="anki-dl anki-dl-primary anki-dl-en" href="jpnotes-${s.level}-en.apkg" onclick="trackDl('${s.level}','apkg','en');return shareApkg(this, 'jpnotes-${s.level}-en.apkg')">⬇ <span class="lang-zh">.apkg English 版（英文释义）</span><span class="lang-en">.apkg English edition (recommended)</span></a>
    <button class="anki-dl anki-copy" onclick="trackDl('${s.level}','apkg-link','zh');copyLink('${SITE}anki/jpnotes-${s.level}.apkg', this)"><span class="lang-zh">📋 复制 .apkg 链接（粘贴到 AnkiDroid "从URL导入"）</span><span class="lang-en">📋 Copy .apkg link (paste into AnkiDroid "Import from URL")</span></button>
    <span class="anki-dl-alt-row"><a class="anki-dl anki-dl-alt" href="jpnotes-${s.level}.txt" download onclick="trackDl('${s.level}','tsv','zh')"><span class="lang-zh">.txt 中文</span><span class="lang-en">.txt Chinese</span></a> · <a class="anki-dl anki-dl-alt" href="jpnotes-${s.level}-en.txt" download onclick="trackDl('${s.level}','tsv','en')"><span class="lang-zh">.txt English</span><span class="lang-en">.txt English</span></a></span>
  </div>`
    )
    .join("\n");
  const landingHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>日语语法 Anki 卡组下载（.apkg / TSV）| JLPT N5–N2 Japanese Grammar Anki Decks — jpnotes.dev</title>
<meta name="description" content="免费下载 JLPT N5/N4/N3/N2 日语语法 Anki 卡组：.apkg 一键导入，含例句日语音频和挖空练习（支持 AnkiDroid / AnkiMobile），共 ${total} 张。Free JLPT N5–N2 Japanese grammar Anki decks with example audio &amp; cloze practice (.apkg &amp; TSV, ${total} cards, works with AnkiDroid &amp; AnkiMobile).">
<link rel="canonical" href="${SITE}anki/">
<meta property="og:title" content="日语语法 Anki 卡组下载（.apkg）| JLPT N5–N2 Grammar Anki Decks">
<meta property="og:description" content="免费 JLPT 日语语法 Anki 卡组 / Free JLPT Japanese grammar Anki decks (.apkg, ${total} cards), covering N5–N2.">
<meta property="og:url" content="${SITE}anki/">
<meta property="og:image" content="${SITE}anki/og-image.png">
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "JLPT N5–N2 日语语法 Anki 卡组 / Japanese Grammar Anki Decks",
  description: `Free JLPT Japanese grammar Anki flashcard decks (${total} cards, N5–N2). Each card has the grammar point, meaning and example sentences, linked to the full lesson on jpnotes.dev.`,
  url: `${SITE}anki/`,
  license: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  creator: { "@type": "Organization", name: "jpnotes.dev", url: SITE },
  distribution: summary.flatMap(s => [
    { "@type": "DataDownload", name: `JLPT ${s.level} Grammar Anki Deck, Chinese edition (.apkg)`, contentUrl: `${SITE}anki/jpnotes-${s.level}.apkg`, encodingFormat: "application/x-anki-package" },
    { "@type": "DataDownload", name: `JLPT ${s.level} Grammar Anki Deck, English edition (.apkg)`, contentUrl: `${SITE}anki/jpnotes-${s.level}-en.apkg`, encodingFormat: "application/x-anki-package" },
    { "@type": "DataDownload", name: `JLPT ${s.level} Grammar Anki Deck, Chinese edition (TSV)`, contentUrl: `${SITE}anki/jpnotes-${s.level}.txt`, encodingFormat: "text/tab-separated-values" },
    { "@type": "DataDownload", name: `JLPT ${s.level} Grammar Anki Deck, English edition (TSV)`, contentUrl: `${SITE}anki/jpnotes-${s.level}-en.txt`, encodingFormat: "text/tab-separated-values" },
  ]),
}, null, 1)}
</script>
<script>
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark') document.documentElement.classList.add('theme-dark');
    else if (t === 'light') document.documentElement.classList.add('theme-light');
  } catch (e) {}
})();
</script>
<style>
:root {
  --bg: #fafaf8; --text: #2d2d2d; --accent: #e94560;
  --card-bg: #fff; --border: #e2e2e2; --muted: #666;
}
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) { --bg: #14141e; --text: #d4d4dc; --card-bg: #1f1f2e; --border: #2d2d44; --muted: #a8a8b8; }
}
html.theme-dark { --bg: #14141e; --text: #d4d4dc; --card-bg: #1f1f2e; --border: #2d2d44; --muted: #a8a8b8; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "PingFang SC", sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 2.5rem 1.5rem; line-height: 1.75; }
.container { max-width: 760px; margin: 0 auto; }
h1 { font-size: 1.8rem; margin: 0 0 .5rem; border-bottom: 2px solid var(--accent); padding-bottom: .6rem; }
.subtitle { color: var(--muted); margin-bottom: 2rem; }
.breadcrumb { font-size: .85rem; color: var(--muted); margin-bottom: 1rem; }
.breadcrumb a { color: var(--accent); text-decoration: none; }
h2 { font-size: 1.3rem; margin: 2rem 0 1rem; }
.anki-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.2rem; margin: 1.5rem 0 2rem; }
@media (max-width: 540px) { .anki-grid { grid-template-columns: 1fr; } }
.anki-card { display: flex; flex-direction: column; padding: 1.2rem 1.4rem; background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; text-decoration: none; color: inherit; transition: all .2s; }
.anki-card:hover { border-color: var(--accent); box-shadow: 0 4px 18px rgba(233,69,96,.12); transform: translateY(-2px); }
.anki-level { display: inline-block; padding: .2rem .65rem; background: #d6354c; color: #fff; font-size: .82rem; font-weight: 700; border-radius: 4px; align-self: flex-start; margin-bottom: .8rem; }
.anki-title { font-size: 1.1rem; font-weight: 600; margin-bottom: .3rem; }
.anki-count { color: var(--muted); font-size: .9rem; margin-bottom: .6rem; }
.anki-dl { color: var(--accent); font-size: .85rem; font-weight: 600; text-decoration: none; display: block; margin-top: .4rem; }
.anki-dl-primary { background: #d6354c; color: #fff; padding: .5rem .8rem; border-radius: 6px; text-align: center; }
.anki-dl-primary:hover { background: #c2304a; }
.anki-dl-en { background: transparent; color: #d6354c; border: 1.5px solid #d6354c; }
.anki-dl-en:hover { background: rgba(214,53,76,.08); }
.anki-dl-alt-row { font-size: .8rem; color: var(--muted); margin-top: .4rem; }
.anki-dl-alt-row .anki-dl-alt { display: inline; }
.anki-copy { border: 1px dashed var(--border); background: var(--card-bg); color: var(--muted); padding: .4rem .8rem; border-radius: 6px; cursor: pointer; font-size: .8rem; text-align: center; }
.anki-copy:hover { border-color: var(--accent); color: var(--accent); }
.anki-copy.copied { border-color: #4caf50; color: #4caf50; }
.anki-dl-alt { color: var(--muted); font-weight: 400; font-size: .8rem; }
.anki-dl-alt:hover { color: var(--accent); }
ol, ul { padding-left: 1.4rem; }
ol li, ul li { margin: .5rem 0; }
code { background: var(--card-bg); border: 1px solid var(--border); padding: .1rem .35rem; border-radius: 3px; font-size: .9em; }
a { color: var(--accent); }
.note { background: rgba(233,69,96,.04); border-left: 3px solid var(--accent); padding: .8rem 1.1rem; margin: 1.2rem 0; border-radius: 0 6px 6px 0; }
/* Bilingual visibility: same rules as the rest of jpnotes.dev.
   :not(body) is load-bearing — the toggle puts .lang-en on <body> itself,
   and a bare .lang-en rule would display:none the whole page. */
:not(body).lang-en { display: none; }
body.lang-en .lang-zh { display: none; }
body.lang-en span.lang-en { display: inline; }
body.lang-en div.lang-en, body.lang-en p.lang-en, body.lang-en li.lang-en, body.lang-en h2.lang-en { display: block; }
/* Toggles (theme + lang) — same top-right placement and pill look as the
   main site's #bottom-controls (the name is legacy; it sits top-right). */
#bottom-controls { position: fixed; top: .8rem; right: 1.2rem; display: flex; align-items: center; gap: .5rem; z-index: 200; }
#lang-toggle, #theme-toggle { background: var(--card-bg); color: inherit; padding: .4rem .8rem; border-radius: 8px; font-size: .8rem; border: 1px solid var(--border); box-shadow: 0 2px 10px rgba(0,0,0,.12); }
#lang-btn, #theme-btn { background: none; border: none; color: inherit; cursor: pointer; padding: 0; line-height: 1; }
#lang-btn { font-size: .8rem; font-weight: 700; }
#theme-btn { font-size: 1.05rem; }
</style>
</head>
<body>
<div class="container">
  <nav class="breadcrumb">
    <a href="${SITE}">日语语法笔记</a> ›
    <span class="lang-zh">Anki 卡组</span><span class="lang-en">Anki Decks</span>
  </nav>
  <h1><span class="lang-zh">日语语法 Anki 卡组下载</span><span class="lang-en">Japanese Grammar Anki Decks</span></h1>
  <p class="subtitle">
    <span class="lang-zh">JLPT N5 → N2 共 ${total} 张卡 · 中文版 / English 版两套独立卡组 · .apkg 版含 🔊 例句日语音频 + 挖空练习子卡组 · 支持 AnkiDroid、AnkiMobile · 每张语法点配含义、例句和跳回 jpnotes.dev 详细讲解的链接</span>
    <span class="lang-en">JLPT N5 → N2, ${total} cards · separate Chinese and English editions · .apkg includes 🔊 native-style TTS audio on examples + a cloze-practice subdeck · works with AnkiDroid &amp; AnkiMobile · each card has the grammar point, its meaning, examples, and a link back to the full lesson on jpnotes.dev</span>
  </p>

  <h2><span class="lang-zh">选择级别下载</span><span class="lang-en">Pick a level to download</span></h2>
  <div class="anki-grid">
${cardCellsEn}
  </div>

  <h2><span class="lang-zh">手机导入（2 步）</span><span class="lang-en">Mobile import (2 steps)</span></h2>
  <div class="note">
    <p class="lang-zh"><strong>第 1 步</strong>：点红色 <strong>下载 .apkg</strong> 按钮 → 弹出"保存到哪"对话框 → 选 <strong>文件极客</strong>（Google Files）/ 本地存储（不要选云端硬盘）→ 文件保存到手机下载文件夹。</p>
    <p class="lang-en"><strong>Step 1</strong>: Tap the red <strong>Download .apkg</strong> button → save dialog appears → choose <strong>Files</strong> (Google Files) / local storage (not Google Drive) → file saves to phone's Downloads.</p>
  </div>
  <div class="note">
    <p class="lang-zh"><strong>第 2 步</strong>：打开手机的<strong>文件管理器</strong>（Files / 文件极客 / 我的文件）→ 找到"下载"文件夹 → 点击 <code>jpnotes-XX.apkg</code> → 系统弹出"<strong>用什么打开</strong>" → 选 <strong>AnkiDroid</strong> → 自动导入完成。</p>
    <p class="lang-en"><strong>Step 2</strong>: Open your phone's <strong>file manager</strong> (Files / My Files) → navigate to Downloads → tap <code>jpnotes-XX.apkg</code> → system asks "<strong>Open with…</strong>" → pick <strong>AnkiDroid</strong> → imported.</p>
  </div>
  <p>
    <span class="lang-zh"><strong>⚠️ 为什么需要 2 步</strong>：手机浏览器出于安全策略，不能直接把下载的文件交给 AnkiDroid。必须先保存到本地，再从文件管理器打开。这是 <strong>所有 Anki 卡组</strong>（包括 AnkiWeb 共享卡组）的标准导入流程。</span>
    <span class="lang-en"><strong>⚠️ Why 2 steps</strong>: Mobile browsers can't hand downloaded files directly to AnkiDroid (security policy). You must save first, then open from the file manager. This is the standard import flow for <strong>all Anki decks</strong>, including AnkiWeb shared decks.</span>
  </p>
  <p>
    <span class="lang-zh"><strong>需要 Anki app</strong>：<a href="https://apps.apple.com/app/ankimobile-flashcards/id373493387">AnkiMobile</a>（iOS，付费）或 <a href="https://play.google.com/store/apps/details?id=com.ichi2.anki">AnkiDroid</a>（Android，免费）。</span>
    <span class="lang-en"><strong>You'll need an Anki app</strong>: <a href="https://apps.apple.com/app/ankimobile-flashcards/id373493387">AnkiMobile</a> (iOS, paid) or <a href="https://play.google.com/store/apps/details?id=com.ichi2.anki">AnkiDroid</a> (Android, free).</span>
  </p>

  <h2><span class="lang-zh">桌面 + 跨设备同步（推荐长期用）</span><span class="lang-en">Desktop + cross-device sync (best for long-term)</span></h2>
  <ol>
    <li><span class="lang-zh">桌面 Anki <code>File → Import</code> 选 <code>.apkg</code></span><span class="lang-en">Desktop Anki: <code>File → Import</code> → select the <code>.apkg</code></span></li>
    <li><span class="lang-zh">桌面 Anki 顶部点 <code>Sync</code>，注册免费的 <a href="https://ankiweb.net/">AnkiWeb</a> 账号</span><span class="lang-en">Click <code>Sync</code> in desktop Anki and create a free <a href="https://ankiweb.net/">AnkiWeb</a> account</span></li>
    <li><span class="lang-zh">手机端登录同一 AnkiWeb 账号 → Sync → 自动同步全部卡组 + 复习进度</span><span class="lang-en">Log in with the same AnkiWeb account on mobile → Sync → decks and review progress sync automatically</span></li>
  </ol>

  <h2><span class="lang-zh">.txt 备选格式（无 Anki app 时用）</span><span class="lang-en">.txt fallback (when you can't run the .apkg)</span></h2>
  <p>
    <span class="lang-zh">每张卡片的 TSV 文件。Anki 桌面 <code>File → Import</code> 也支持，但需要手动选 Type=Basic、Field 映射、勾选 Allow HTML。</span>
    <span class="lang-en">TSV file with the same cards. Anki Desktop <code>File → Import</code> supports it, but you'll need to set Type=Basic, map fields, and check Allow HTML manually.</span>
  </p>

  <div class="note">
    <p class="lang-zh"><strong>提示</strong>：所有内容来自 <a href="${SITE}">jpnotes.dev</a>，CC BY 4.0 许可。可以自由分享、改编、用于教学，但请标注来源。卡组每周可能更新，回这里看更新日期。</p>
    <p class="lang-en"><strong>Note</strong>: All content comes from <a href="${SITE}">jpnotes.dev</a>, licensed CC BY 4.0. Free to share, adapt, and use for teaching — just attribute the source. Decks may be updated weekly; check back here for the latest version.</p>
  </div>

  <h2><span class="lang-zh">卡片结构</span><span class="lang-en">Card structure</span></h2>
  <ul>
    <li><span class="lang-zh"><strong>正面</strong>：语法形式（例如「〜たら」）+ JLPT 级别 + lesson 编号</span><span class="lang-en"><strong>Front</strong>: grammar pattern (e.g. 〜たら), JLPT level, lesson number</span></li>
    <li><span class="lang-zh"><strong>背面</strong>：含义 + 3+ 例句（带中文翻译）+ jpnotes.dev 详细讲解链接</span><span class="lang-en"><strong>Back</strong>: meaning + 3+ example sentences (with Chinese translation) + link to the full lesson on jpnotes.dev</span></li>
  </ul>

  <h2><span class="lang-zh">反馈</span><span class="lang-en">Feedback</span></h2>
  <ul>
    <li>GitHub Issues：<a href="https://github.com/Ralphbupt/japanese-grammar/issues">github.com/Ralphbupt/japanese-grammar/issues</a></li>
    <li><span class="lang-zh">邮箱</span><span class="lang-en">Email</span>：<a href="mailto:pengcheng199@gmail.com">pengcheng199@gmail.com</a></li>
  </ul>

  <p style="margin-top:3rem;text-align:center;">
    <a href="${SITE}"><span class="lang-zh">← 返回 jpnotes.dev</span><span class="lang-en">← Back to jpnotes.dev</span></a>
  </p>
</div>

<div id="bottom-controls">
  <div id="theme-toggle"><button id="theme-btn" aria-label="切换主题 / Toggle theme">🌓</button></div>
  <div id="lang-toggle"><button id="lang-btn">EN</button></div>
</div>
<script>
// GA4, same property as the main site. The gtag stub queues events into
// dataLayer immediately, so download clicks fired before the (deferred)
// script loads are not lost. Mark anki_download as a key event in GA4 admin.
window.dataLayer = window.dataLayer || [];
window.gtag = function(){ dataLayer.push(arguments); };
gtag('js', new Date());
gtag('config', 'G-D1KNQTFN1R');
(function() {
  if (/bot|crawl|spider|headless|lighthouse/i.test(navigator.userAgent)) return;
  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=G-D1KNQTFN1R';
    document.head.appendChild(s);
  }
  ['pointerdown','scroll','keydown','touchstart'].forEach(function(ev) {
    window.addEventListener(ev, load, { once: true, passive: true });
  });
  setTimeout(load, 3000);
})();

function trackDl(deck, format, lang) {
  try {
    gtag('event', 'anki_download', { deck_level: deck, file_format: format, deck_lang: lang });
  } catch (e) {}
}

// Copy link to clipboard for "AnkiDroid → Import from URL" flow.
function copyLink(url, btn) {
  navigator.clipboard.writeText(url).then(function() {
    btn.classList.add('copied');
    var zh = btn.querySelector('.lang-zh');
    var en = btn.querySelector('.lang-en');
    if (zh) zh.textContent = '✓ 已复制！打开 AnkiDroid → 导入 → 从URL';
    if (en) en.textContent = '✓ Copied! Open AnkiDroid → Import → From URL';
    setTimeout(function() {
      btn.classList.remove('copied');
      if (zh) zh.textContent = '📋 复制 .apkg 链接（粘贴到 AnkiDroid "从URL导入"）';
      if (en) en.textContent = '📋 Copy .apkg link (paste into AnkiDroid "Import from URL")';
    }, 4000);
  });
}

// Web Share API: share the .apkg file via the system share sheet so
// AnkiDroid / AnkiMobile appears as a target — avoids the "save to
// Files / Google Drive" dialog that doesn't offer Anki as an option.
function shareApkg(link, filename) {
  // Only intercept on mobile (desktop should just download normally)
  if (!navigator.share || !navigator.canShare) return true;
  fetch(link.href)
    .then(function(r) { return r.blob(); })
    .then(function(blob) {
      var file = new File([blob], filename, { type: 'application/octet-stream' });
      if (!navigator.canShare({ files: [file] })) {
        window.location.href = link.href;
        return;
      }
      return navigator.share({ files: [file], title: filename });
    })
    .catch(function() {
      // If share fails, fallback to regular download
      window.location.href = link.href;
    });
  return false; // prevent default <a> navigation
}

(function(){
  var btn = document.getElementById('theme-btn');
  if (btn) {
    var html = document.documentElement;
    function current() { return html.classList.contains('theme-dark') ? 'dark' : html.classList.contains('theme-light') ? 'light' : 'auto'; }
    function paintIcon() { var c = current(); btn.textContent = c === 'dark' ? '🌙' : c === 'light' ? '☀️' : '🌓'; btn.title = c === 'dark' ? '当前: 深色 (点击切浅色)' : c === 'light' ? '当前: 浅色 (点击切自动)' : '当前: 跟随系统 (点击切深色)'; }
    paintIcon();
    btn.addEventListener('click', function() {
      var next = { auto: 'dark', dark: 'light', light: 'auto' }[current()];
      html.classList.remove('theme-dark', 'theme-light');
      if (next === 'dark') html.classList.add('theme-dark');
      else if (next === 'light') html.classList.add('theme-light');
      try { if (next === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch (e) {}
      paintIcon();
    });
  }
  var langBtn = document.getElementById('lang-btn');
  if (langBtn) {
    var STORE_KEY = 'jp_grammar_prefs';
    function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch(e) { return {}; } }
    function savePrefs(patch) { var p = loadPrefs(); for (var k in patch) p[k] = patch[k]; localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
    var prefs = loadPrefs();
    var isEn = ('isEn' in prefs) ? prefs.isEn : !/^zh/i.test(navigator.language || '');
    if (isEn) { document.body.classList.add('lang-en'); langBtn.textContent = '中'; }
    langBtn.addEventListener('click', function(){ isEn = !isEn; document.body.classList.toggle('lang-en', isEn); langBtn.textContent = isEn ? '中' : 'EN'; savePrefs({ isEn: isEn }); });
  }
})();
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), landingHtml, "utf-8");

  // Cache the front/back HTML for build-anki.py to reuse — avoids
  // running kuroshiro from two language runtimes and guarantees the
  // .apkg cards have identical content to the .txt cards.
  fs.writeFileSync(
    path.join(OUT_DIR, ".cards.json"),
    JSON.stringify(cardCache),
    "utf-8"
  );

  console.log(`\nTotal: ${total} cards × 2 editions (中文/English) across ${LEVELS.length} levels.`);
  console.log(`Audio: ${audioHits}/${audioHits + audioMisses} example sentences matched a pre-generated TTS mp3.`);
  if (enMeaningFallbacks) {
    console.log(`English edition: ${enMeaningFallbacks} cards fell back to the Chinese meaning (lesson lacks :::en block).`);
  }
  console.log(`Output: ${OUT_DIR}/`);

  if (skippedNoExamples.length) {
    console.warn(`\n⚠️  ${skippedNoExamples.length} lesson(s) produced 0 Anki cards (likely review/summary lessons — verify if unexpected):`);
    for (const s of skippedNoExamples) console.warn(`     - ${s}`);
  }

  // Inject the real card count into the homepage placeholder written by build.js.
  // build-anki.js runs after build.js (see `npm run build`), so `total` is the
  // single source of truth — avoids hardcoding a number that drifts out of sync.
  const indexPath = path.join(__dirname, "dist", "index.html");
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, "utf-8");
    if (html.includes("{{ANKI_CARDS}}")) {
      fs.writeFileSync(indexPath, html.split("{{ANKI_CARDS}}").join(total), "utf-8");
      console.log(`  Injected card count (${total}) into dist/index.html`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
