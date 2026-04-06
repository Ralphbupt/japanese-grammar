const fs = require("fs");
const path = require("path");
const { Marked } = require("marked");
const KuroshiroMod = require("kuroshiro");
const Kuroshiro = KuroshiroMod.default || KuroshiroMod;
const KuromojiMod = require("kuroshiro-analyzer-kuromoji");
const KuromojiAnalyzer = KuromojiMod.default || KuromojiMod;

// ─── Config ───
const GRAMMAR_DIRS = [
  { dir: "grammar/week01-02", label: "N5（第1〜2週）" },
  { dir: "grammar/week03-04", label: "N4（第3〜4週）" },
  { dir: "grammar/week05-06", label: "N3（第5〜6週）" },
  { dir: "grammar/week07-08", label: "N2（第7〜8週）" },
];
const OUT = "dist/index.html";

// Japanese sidebar titles (keyed by file id)
const JA_TITLES = {
  day00: "五十音図（参考）",
  day01: "基礎文型 — です・は/が・助詞",
  day02: "動詞ます形とて形",
  day03: "て形応用・ない形・義務表現",
  day04: "た形・形容詞活用・比較表現",
  day05: "条件表現 — と/ば/たら/なら",
  day06: "可能形・受身形・意向形",
  day07: "推測と様態 — でしょう/そうだ/ようだ/らしい",
  day08: "N5補充文法＋総復習",
  day12: "使役形・使役受身形",
  day13: "授受表現 — あげる/もらう/くれる",
  day14: "ように系列 — ようにする/ようになる",
  day15: "ことにする/ことになる/はずだ",
  day16: "ばかり/ところだ/てしまう/ておく/てある",
  day17: "受身形詳解・という/ということ",
  day18: "N4補充文法 — て以来/にかけて/において",
  day19: "わけだ/ものだ — N4→N3過渡文法",
  day20: "N4文法総復習",
};

// ─── Helpers ───
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

      // Add furigana (kana-based detection)
      console.log(`  Processing ${file.id}...`);
      html = await addFurigana(kuro, html);

      const dayMatch = file.id.match(/^day(\d+)/);
      const dayNum = dayMatch ? dayMatch[1] : "";
      const jaTitle = JA_TITLES[file.id];
      const sidebarTitle = jaTitle
        ? `Day ${dayNum} – ${jaTitle}`
        : shortTitle;
      sidebarHtml.push(
        `<a class="nav-item" href="#${file.id}" data-target="${file.id}">${sidebarTitle}</a>`
      );
      articlesHtml.push(
        `<article id="${file.id}" class="lesson">${html}</article>`
      );
    }
  }

  // ─── Assemble ───
  const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>日语语法笔记 – N5→N2</title>
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
</body>
</html>`;

  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, OUT), fullHtml, "utf-8");
  console.log(`Done! Output: ${OUT}`);
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
  var isEn = prefs.isEn || false;
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

  // Init
  updateDayDates();
  var hash = location.hash.slice(1);
  var first = items[0] ? items[0].getAttribute('data-target') : null;
  show(hash || first);
})();
`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
