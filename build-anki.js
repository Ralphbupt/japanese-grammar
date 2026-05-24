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

const SITE = "https://jpnotes.dev/";
const OUT_DIR = path.join(__dirname, "dist", "anki");
const LEVELS = ["N5", "N4", "N3", "N2"];

// ─── Markdown parsing ───

function stripMd(text) {
  return text
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

  function flush() {
    if (!current) return;
    const content = buffer.join("\n");
    const subSections = content.split(/^### /m);
    let meaning = null;
    let examples = null;
    for (let i = 1; i < subSections.length; i++) {
      const sub = subSections[i];
      const headerLine = sub.split("\n")[0];
      const subBody = sub.split("\n").slice(1).join("\n");
      if (/^(接[续続]|Conjugation)/i.test(headerLine)) continue;
      const bilingual = extractBilingual(subBody);
      if (!meaning && /含义|含意|用法|核心|意味|Meaning|Usage|Nuance/i.test(headerLine)) {
        meaning = bilingual.zh || bilingual.en;
      } else if (!examples && /例句|例文|Example/i.test(headerLine)) {
        examples = bilingual.zh || bilingual.en;
      }
    }
    if (!meaning) {
      const fallback = extractBilingual(content);
      meaning = fallback.zh;
    }
    if (meaning) {
      sections.push({ ...current, meaning, examples });
    }
    current = null;
    buffer = [];
  }

  for (const line of lines) {
    const h2 = line.match(/^## (\d+)\.\s*(.+?)(?:\|\|.*)?$/);
    if (h2) {
      flush();
      const headingText = h2[2].trim();
      // Include 〜 in the body character class so terms like
      // "〜です / 〜ではありません" don't get truncated at the second 〜.
      const termMatch = headingText.match(/^([〜～]?[〜～぀-ゟ゠-ヿー一-鿿/・\s,，、]+)/);
      const term = termMatch ? termMatch[1].trim() : headingText;
      const descMatch = headingText.match(/[（(]([^）)]+)[）)]/);
      const description = descMatch ? descMatch[1].trim() : null;
      current = { term, description };
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

function formatExamples(text) {
  if (!text) return "";
  const stripped = stripMd(text);
  const lines = stripped.split("\n").filter(l => l.trim());
  if (lines.length === 0) return "";
  const items = lines
    .map(line => {
      const m = line.match(/^\d+[.、．]\s*(.+)$/);
      const content = m ? m[1] : line.replace(/^[\-•・]\s*/, "");
      const splitMatch = content.match(/^([\s\S]+?)[（(]([^）)]+)[）)]\s*$/);
      if (splitMatch) {
        return `<li>${escapeHtml(splitMatch[1].trim())}<br><span style="color:#888;font-size:.88em;">${escapeHtml(splitMatch[2].trim())}</span></li>`;
      }
      return `<li>${escapeHtml(content)}</li>`;
    })
    .join("");
  return `<ol style="padding-left:1.4em;margin:.4em 0;">${items}</ol>`;
}

function makeFront(term, level, lessonNum) {
  return `<div style="text-align:center;padding:1em;">
<div style="font-size:2.2em;color:#e94560;font-weight:700;line-height:1.3;">${escapeHtml(term)}</div>
<div style="color:#888;margin-top:.8em;font-size:.9em;">JLPT ${level} · Lesson ${lessonNum}</div>
</div>`;
}

function makeBack(term, description, meaning, examples, lessonNum, lessonUrl) {
  const descBlock = description
    ? `<div style="color:#555;font-size:.95em;margin:.2em 0 .6em;">${escapeHtml(description)}</div>`
    : "";
  const meaningBlock = meaning
    ? `<div style="margin:.6em 0;">${escapeHtml(stripMd(meaning)).replace(/\n+/g, "<br>")}</div>`
    : "";
  const examplesBlock = examples
    ? `<div style="font-weight:700;color:#1a1a2e;margin:1em 0 .3em;font-size:.9em;">例句</div>${formatExamples(examples)}`
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

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  const summary = [];

  for (const level of LEVELS) {
    const dir = path.join(__dirname, "grammar", level);
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter(f => /^lesson\d+_.*\.md$/.test(f))
      .sort();

    // Anki's import format: comments / headers prefixed with `#`
    // - #separator:tab        — tab between fields
    // - #html:true            — fields contain HTML, don't escape
    // - #deck:Name            — target deck name
    // - #notetype:Name        — note type
    // - #columns:Front\tBack  — field names
    const rows = [
      "#separator:tab",
      "#html:true",
      `#deck:日语语法 ${level} · jpnotes.dev`,
      "#notetype:Basic",
      "#columns:Front\tBack",
    ];

    let count = 0;
    for (const f of files) {
      const md = fs.readFileSync(path.join(dir, f), "utf-8");
      const lessonMatch = f.match(/^lesson(\d+)/);
      if (!lessonMatch) continue;
      const lessonNum = lessonMatch[1];
      const lessonUrl = `${SITE}lesson${lessonNum}/`;
      const sections = parseGrammarSections(md);
      for (const s of sections) {
        const front = tsvField(makeFront(s.term, level, lessonNum));
        const back = tsvField(makeBack(s.term, s.description, s.meaning, s.examples, lessonNum, lessonUrl));
        rows.push(`${front}\t${back}`);
        count++;
      }
    }

    const outPath = path.join(OUT_DIR, `jpnotes-${level}.txt`);
    fs.writeFileSync(outPath, rows.join("\n"), "utf-8");
    console.log(`  Generated ${outPath} (${count} cards)`);
    summary.push({ level, count });
    total += count;
  }

  // Landing page at /anki/ for users browsing jpnotes.dev/anki/
  const cardCells = summary
    .map(
      s => `  <a class="anki-card" href="jpnotes-${s.level}.txt" download>
    <span class="anki-level">${s.level}</span>
    <span class="anki-title">JLPT ${s.level} 文法卡组</span>
    <span class="anki-count">${s.count} 张卡</span>
    <span class="anki-dl">⬇ jpnotes-${s.level}.txt</span>
  </a>`
    )
    .join("\n");
  const cardCellsEn = summary
    .map(
      s => `  <a class="anki-card" href="jpnotes-${s.level}.txt" download>
    <span class="anki-level">${s.level}</span>
    <span class="anki-title"><span class="lang-zh">JLPT ${s.level} 文法卡组</span><span class="lang-en">JLPT ${s.level} Grammar Deck</span></span>
    <span class="anki-count"><span class="lang-zh">${s.count} 张卡</span><span class="lang-en">${s.count} cards</span></span>
    <span class="anki-dl">⬇ jpnotes-${s.level}.txt</span>
  </a>`
    )
    .join("\n");
  const landingHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Anki 卡组下载 / Anki Decks — 日语语法笔记 · jpnotes.dev</title>
<meta name="description" content="免费下载 JLPT N5/N4/N3/N2 文法 Anki 卡组（共 ${total} 张）/ Free JLPT N5–N2 grammar Anki decks (${total} cards total). Each card: grammar point + meaning + examples + link to jpnotes.dev lesson.">
<link rel="canonical" href="${SITE}anki/">
<meta property="og:title" content="Anki 卡组下载 / Anki Decks — jpnotes.dev">
<meta property="og:description" content="免费 JLPT 文法 Anki 卡组 / Free JLPT grammar Anki decks (${total} cards), covering N5–N2.">
<meta property="og:url" content="${SITE}anki/">
<meta property="og:image" content="${SITE}og-image.png">
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
.anki-dl { color: var(--accent); font-size: .85rem; font-weight: 600; }
ol, ul { padding-left: 1.4rem; }
ol li, ul li { margin: .5rem 0; }
code { background: var(--card-bg); border: 1px solid var(--border); padding: .1rem .35rem; border-radius: 3px; font-size: .9em; }
a { color: var(--accent); }
.note { background: rgba(233,69,96,.04); border-left: 3px solid var(--accent); padding: .8rem 1.1rem; margin: 1.2rem 0; border-radius: 0 6px 6px 0; }
/* Bilingual visibility: same rules as the rest of jpnotes.dev */
.lang-en { display: none; }
body.lang-en .lang-zh { display: none; }
body.lang-en span.lang-en { display: inline; }
body.lang-en div.lang-en, body.lang-en p.lang-en, body.lang-en li.lang-en, body.lang-en h2.lang-en { display: block; }
/* Bottom toggles (theme + lang) — mirror the main site's bottom-controls */
#bottom-controls { position: fixed; bottom: 1.2rem; right: 1.2rem; display: flex; gap: .5rem; z-index: 200; }
#lang-toggle, #theme-toggle { background: #1a1a2e; color: #fff; padding: .5rem 1rem; border-radius: 20px; font-size: .8rem; box-shadow: 0 2px 10px rgba(0,0,0,.2); }
#lang-btn, #theme-btn { background: none; border: none; color: #fff; cursor: pointer; padding: 0; line-height: 1; }
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
  <h1><span class="lang-zh">Anki 卡组下载</span><span class="lang-en">Anki Flashcard Decks</span></h1>
  <p class="subtitle">
    <span class="lang-zh">JLPT N5 → N2 共 ${total} 张卡 · 每张语法点配含义、例句和跳回 jpnotes.dev 详细讲解的链接</span>
    <span class="lang-en">JLPT N5 → N2, ${total} cards in total · each card has the grammar point, its meaning, examples, and a link back to the full lesson on jpnotes.dev</span>
  </p>

  <h2><span class="lang-zh">选择级别下载</span><span class="lang-en">Pick a level to download</span></h2>
  <div class="anki-grid">
${cardCellsEn}
  </div>

  <h2><span class="lang-zh">手机端怎么导入（最简流程）</span><span class="lang-en">Mobile: how to import (easiest path)</span></h2>
  <ol>
    <li><span class="lang-zh">先在桌面 Anki <code>File → Import</code> 导入 <code>.txt</code> 文件</span><span class="lang-en">First import the <code>.txt</code> on desktop Anki: <code>File → Import</code></span></li>
    <li><span class="lang-zh">桌面 Anki 顶部点 <code>Sync</code>，注册免费的 <a href="https://ankiweb.net/">AnkiWeb</a> 账号</span><span class="lang-en">Click <code>Sync</code> in desktop Anki and create a free <a href="https://ankiweb.net/">AnkiWeb</a> account</span></li>
    <li><span class="lang-zh">手机装 <strong>AnkiDroid</strong>（Android，免费）或 <strong>AnkiMobile</strong>（iOS，付费）</span><span class="lang-en">Install <strong>AnkiDroid</strong> (Android, free) or <strong>AnkiMobile</strong> (iOS, paid)</span></li>
    <li><span class="lang-zh">手机端登录同一 AnkiWeb 账号 → Sync → 自动同步全部卡组</span><span class="lang-en">Log in with the same AnkiWeb account on mobile → Sync → all decks appear automatically</span></li>
  </ol>
  <p class="lang-zh"><strong>这是 Anki 标准用法</strong>——桌面是源，手机是消费端。一次设置永久同步。</p>
  <p class="lang-en"><strong>This is the canonical Anki workflow</strong> — desktop is the source, mobile is the reader. Configure once and sync forever.</p>

  <h2><span class="lang-zh">桌面 Anki 直接导入</span><span class="lang-en">Desktop Anki direct import</span></h2>
  <ol>
    <li><span class="lang-zh">下载上面对应级别的 <code>.txt</code> 文件</span><span class="lang-en">Download the <code>.txt</code> file for the level you want</span></li>
    <li><span class="lang-zh">打开 Anki 桌面版 → <code>File → Import</code></span><span class="lang-en">Open desktop Anki → <code>File → Import</code></span></li>
    <li><span class="lang-zh">导入对话框确认 <strong>Type</strong> = <code>Basic</code>、<strong>Field 1</strong> → Front、<strong>Field 2</strong> → Back</span><span class="lang-en">In the import dialog confirm <strong>Type</strong> = <code>Basic</code>, <strong>Field 1</strong> → Front, <strong>Field 2</strong> → Back</span></li>
    <li><span class="lang-zh">勾选 <strong>"Allow HTML in fields"</strong></span><span class="lang-en">Tick <strong>"Allow HTML in fields"</strong></span></li>
    <li><span class="lang-zh">Import 完成，卡组自动叫 <code>日语语法 N5 · jpnotes.dev</code></span><span class="lang-en">Click Import — the deck is named <code>日语语法 N5 · jpnotes.dev</code> automatically</span></li>
  </ol>

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

  console.log(`\nTotal: ${total} cards across ${LEVELS.length} files.`);
  console.log(`Output: ${OUT_DIR}/`);
}

main();
