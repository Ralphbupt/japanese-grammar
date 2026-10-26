# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and Codex (`AGENTS.md` is a symlink to it) when working with code in this repository.

## Project Overview

This is a Japanese language learning project: structured JLPT N5–N2 grammar notes (written 2026-04-05 → 06-05 while the author learned them), published as jpnotes.dev with Anki decks and TTS audio. The author retakes N2 on 2026-12-06; the site's audience is now other learners (English-speaking first, Chinese second).

## Website

The grammar notes are published as a static site at **https://jpnotes.dev/** (custom domain on GitHub Pages, migrated from ralphbupt.github.io/japanese-grammar/ on 2026-05-22).

- **Build**: `npm run build` → runs `build.js` + `build-anki.js` → outputs `dist/`
- **Stack**: marked (markdown→HTML), kuroshiro + kuromoji (furigana generation), sharp (OG images)
- **Deploy**: GitHub Pages via GitHub Actions (`dist/` folder)

### Features
- Sidebar navigation by JLPT level (hover-to-expand, available on all pages)
- Element-level furigana on Japanese text via `data-ja` attribute
- Bilingual content (Chinese + English): lessons, checklists, guides, the N5–N2 overviews, `/guides/` and `/about/` are published once per language (below); the home page and `/anki/` stay bilingual with a language toggle
- Dark mode (3-state: auto/light/dark) with `theme-dark`/`theme-light` classes on `<html>`
- 🔊 TTS audio on example sentences (pre-generated Edge TTS, fallback: none)
- Cross-links between related grammar points (25 per page, descriptive anchor text)
- Guides (`grammar/guides/*.md` → `/<slug>/`, hub at `/guides/`, sidebar group 专题): A-vs-B comparison pages (は vs が, から vs ので …) and the JLPT exam guide (`jlpt-*` sorts first). Same markdown format as lessons; prev/next stay inside the group; not read by build-anki.js
- One page per language for those pages, from `PAGE_LANGS` in build.js (`langVariant()` / `writeLangPage()`): `/<page>/` English only, `/zh/<page>/` Chinese only (`localizePage()` strips the other languages' blocks inside `<main>`; non-root copies get their own `<title>`/description and internal links rewritten to `/zh/`). `data-force-lang` pins the UI language and `data-alt-<code>` is where the language switch goes; `LANG_REDIRECT_JS` in `<head>` sends a reader to their language's copy (saved pref; a zh browser with no pref only on the root page); the 中文/EN button saves the choice and navigates there. hreflang en / zh-Hans / x-default on every copy and in the sitemap; giscus thread and AI chat history are shared across copies. A new language = a `PAGE_LANGS` entry + `:::xx` blocks + lang-xx CSS, and the `isEn` pref becoming a language code. Every visible string needs both sides — `:::zh`/`:::en` blocks, `中文||English` headings, `中文 // English` table cells (td/th) and list items — or the English page shows Chinese
- SEO titles: `seo-titles.js` maps page id → `{ en, zh, desc?, descZh?, level? }`, phrased like real searches (pattern + romaji + vs/meaning; zh: 区别/用法). Pages without an entry fall back to the template. `python3 tools/gsc-report.py` lists high-impression / low-click pages and their queries — the pages worth retitling
- Per-lesson meta: last-updated date + reading time
- SEO: unique meta descriptions, Article+LearningResource + BreadcrumbList schema in the page's own language (no FAQ schema: Google shows FAQ rich results only for government/health sites)
- Giscus comments (GitHub Discussions-backed)
- Anki flashcard decks (TSV + .apkg downloads at `/anki/`)
- 🤖 Ask-AI side panel on lesson pages (`site/ai-assistant.{js,css}`, bundled into `dist/ai-assistant.js` — the CSS is injected by the script, not inlined in pages): works with no setup via the `jpnotes` preset → free relay at `ai.jpnotes.dev` (Cloudflare Worker in `worker/`, runs `@cf/openai/gpt-oss-120b` on Workers AI — no third-party key, budget = Free plan's 10k neurons/day ≈ 20–40 questions, errors rather than bills when exhausted; Origin-locked to jpnotes.dev/localhost, per-IP 6/min + 50/day plus a 9,500-neuron/day site budget via a SQLite Durable Object, no logging; deploy with `cd worker && npx wrangler deploy`, secret `IP_SALT`). Readers can instead add their own API key (localStorage only), browser calls the provider directly; 19 presets grouped 国际/国内/本地/聚合 (Anthropic, OpenAI, Gemini, xAI, Mistral, Groq, DeepSeek, Qwen, Kimi, GLM, 豆包, MiniMax, 混元, 文心, Ollama, LM Studio, OpenRouter, SiliconFlow, custom) plus a ⟳ button that fetches `{base}/models` live. The "用自己的 API key" link opens a 3-step wizard (3 recommended providers per UI language from `RECOMMEND`, link to the provider's `keyUrl`, paste key, one test request before saving). Config is v2: several providers can be configured at once (`cfg.profiles`, one active), switched from the header menu. Context scope (📎 row above the input): auto (the numbered `## N.` grammar point on screen, default), whole lesson, or one grammar point; quick prompts always send the whole lesson; selecting text inside a grammar point pins the scope to it, and the quoted text is cleaned (no furigana / 🔊, trimmed to the Japanese sentence). History lives in localStorage per lesson (24 msgs kept, last 6 turns sent). Replies render `漢字（かな）` as ruby; thinking/reasoning deltas show in a collapsible block; answers have copy / regenerate, errors have retry
- Security for the AI panel: every page carries a `<meta http-equiv="Content-Security-Policy">` with a `connect-src` allowlist (self, GA, provider hosts parsed from `site/ai-assistant.js`, localhost/127.0.0.1). Adding a provider = adding its `base:` (and optional `altBase:`) URL in the JS; the CSP picks both up at build time. Preset model IDs were last verified against official docs on 2026-09-16; the ⟳ button fetches the live list. `effortParams()` maps the 快速/标准/深入 setting onto each provider's reasoning knob. Settings only accept https or local base URLs, warn on non-official hosts, and offer session-only key storage. Privacy explanation lives in `pages/about.md` (#ai-privacy)
- Performance: inline CSS minified by `minifyCss()`; Giscus `client.js` loads only when comments near the viewport (IntersectionObserver); `SPECULATION_RULES` prefetch internal pages on hover and prerender on pointerdown; 🔊 mp3 / search index start loading on hover; AI panel preconnects to the active provider on open
- Service worker `site/sw.js` (→ `dist/sw.js`, registered by `SW_REGISTER`): audio cache-first forever (hash-named, serves 206 for Range), `*.js?v=` cache-first, search index stale-while-revalidate, pages network-first with offline fallback. Bump `V` in sw.js to drop all caches
- Lighthouse 100/100 on all 4 categories

## Build System Architecture

### build.js — Static site generator

Key concepts:

1. **File discovery**: Reads `grammar/N5/`, `grammar/N4/`, `grammar/N3/`, `grammar/N2/` directories
2. **Sidebar titles**: `JA_TITLES` maps file IDs (e.g. `lesson01`) to Japanese sidebar labels
3. **SEO keywords**: `LESSON_KEYWORDS` maps file IDs to per-lesson keyword strings
4. **Furigana**: kuroshiro adds ruby annotations to `data-ja` elements. Chinese text inside （…） is protected
5. **Audio tagging**: Example `<li data-ja>` sentences get `data-audio="s{sha1(text)[:12]}"` — the ID is a hash of the spoken text, so editing/reordering examples never misaligns audio, and zh/en copies of a sentence share one mp3. Practice/answer sections (h2/h3 matching `PRACTICE_HEADING`) and non-model lines (blanks, ❌/△, →/=/+, a–d options, English, Chinese) get no audio (`audioText()`). The 🔊 attribute is only emitted when `audio/{id}.mp3` exists; every eligible sentence is still written to `dist/.audio-requests.json` for `build-audio.py`.
6. **TTS JS**: Injects 🔊 buttons on elements with `data-audio`, plays `/audio/{id}.mp3` on click
7. **Old URL redirects**: `DAY_TO_LESSON` map generates meta-refresh stubs at `/dayNN/` → `/lessonNN/`
8. **CNAME**: Auto-generates `dist/CNAME` when `SITE` points to a non-github.io domain

When adding a new lesson file, update **four things**:
- Add entry in `JA_TITLES` in `build.js` (Japanese sidebar title)
- Add entry in `LESSON_KEYWORDS` in `build.js` (SEO keywords)
- Add `{ en, zh }` titles in `seo-titles.js`
- The file itself in the appropriate `grammar/N{level}/` directory

A new guide: the file in `grammar/guides/`, a `JA_TITLES` entry, and a `seo-titles.js` entry with `desc` / `descZh` / `level` (they feed the `/guides/` hub card).

### build-anki.js — Anki flashcard generator

- Parses lesson markdown, extracts grammar points from `## N.` sections
- Filters: must have examples, must not be a section heading
- Adds furigana to examples via kuroshiro
- Outputs TSV files (`dist/anki/jpnotes-{N5,N4,N3,N2}.txt`) + `.cards.json` cache
- Generates bilingual landing page at `dist/anki/index.html`

### build-anki.py — Anki .apkg generator

- Reads `.cards.json` (written by build-anki.js) — single source of truth
- Generates `.apkg` files via Python `genanki` library
- Stable model/deck IDs so re-imports update rather than duplicate

### build-audio.py — TTS audio generator

- Reads `dist/.audio-requests.json` (written by build.js)
- Generates `.mp3` via `edge-tts` (ja-JP-NanamiNeural voice)
- Incremental: skips already-generated files
- Output stored in `audio/` (committed to repo, copied to `dist/audio/` by CI)

## CI Pipeline (`.github/workflows/deploy.yml`, on every push to main)

```
npm ci
npm run build          # build.js (site HTML) + build-anki.js (TSV + .cards.json)
cp -r audio dist/audio # pre-generated TTS audio (committed, not regenerated in CI)
python build-anki.py   # .apkg from .cards.json
upload dist/           # deploy to GitHub Pages
node indexnow.mjs      # ping Bing/Yandex with URLs whose sitemap lastmod changed
```

Audio regeneration is LOCAL only (requires `edge-tts`):
```
python build-audio.py          # generates to audio/
git add audio/ && git commit   # commit new .mp3 files
```

## Structure

```
grammar/
  N5/   lesson00-lesson17  (18 lessons, week 1-2)
  N4/   lesson18-lesson34  (17 lessons incl. keigo 27/28/29, week 3-4)
  N3/   lesson35-lesson58  (24 lessons, week 5-6)
  N2/   lesson59-lesson75  (17 lessons, week 7-8)
  guides/ comparison pages + JLPT exam guide (not a level)
pages/
  about.md               (bilingual About page source)
data/
  anki-cards.json         (curated Anki card data, WIP)
audio/
  s{hash}.mp3             (pre-generated TTS, one file per distinct sentence)
site/                     (ai-assistant.{js,css}, settings-modal.js, sw.js — copied/bundled into dist/)
worker/                   (Cloudflare Worker behind ai.jpnotes.dev, the free AI relay)
docs/                     (roadmap-2026h2.md — current plan; content-review notes)
build.js                  (main static site generator)
build-anki.js             (Anki TSV + landing page generator)
build-anki.py             (Anki .apkg generator, reads .cards.json)
build-audio.py            (Edge TTS audio generator)
seo-titles.js             (hand-written <title>s per page, en + zh)
indexnow.mjs              (CI: IndexNow ping)
tools/
  gsc-report.py           (Search Console: what to retitle next, countries)
  lesson-dropoff.py       (GA4 + Search Console per-lesson engagement)
  lesson-audience.py      (lookup vs sequential readers per lesson)
  audit-readings.js       (checks the 读音 column of word tables)
  audit-furigana.js       (checks the furigana build.js emitted, reads dist/)
```

## Lesson File Format

Each grammar lesson file follows this template:
- `# Lesson NN – Title||English Title` (bilingual H1)
- `:::zh ... :::` / `:::en ... :::` bilingual lead paragraph
- `## 本课单词表||Vocabulary` (word table)
- For each grammar point: `## N. 〜term（description）||N. 〜term (English)`
  - `### 接続||Conjugation` (:::zh/:::en)
  - `### 含義||Meaning` (:::zh/:::en)
  - `### 例句||Example Sentences` (:::zh/:::en, 3+ numbered examples)
  - `### 辨析||Comparison` (optional)
- `## 今日练習||Today's Practice` (optional)
- `## 复习计划||Review Schedule` (checkbox list: 当天/+1/+4/+7/+14/+30 天)

Filename convention: `lessonNN_topic.md`

Bilingual syntax — every visible Chinese string needs its English side, or the English page (`/lessonNN/`) shows Chinese:
- Blocks: `:::zh` … `:::` followed by `:::en` … `:::` (paragraphs, lists, diagrams, practice blocks; each marker on its own line)
- Headings: `## 中文||English` (any level)
- Table cells (td/th) and list items: `中文全文 // English full text` — the whole cell/item on both sides; `//` must not sit inside markup; vocab meanings are `练习//practice`
- The English side of a `## N. 〜pattern (gloss)` heading gets the pattern's romaji added by the build (`addRomaji()`); don't type romaji there by hand
- Changing a Japanese example sentence changes its audio hash → run `python build-audio.py`

## Content Guidelines

- All notes are bilingual: Chinese explanations + English translations
- Grammar progression: N5 (00–17) → N4 (18–34) → N3 (35–58) → N2 (59–75)
- Each grammar point needs: meaning, conjugation rules, 3+ example sentences, and comparison with easily confused grammar
- Example sentences should have both Chinese and English translations in parens
- After adding/editing examples: `npm run build:site` then `python build-audio.py` to generate the missing mp3s, commit `audio/`. Stale mp3s (no longer requested) can be deleted.
- Furigana misreadings are patched in `build.js` (`RUBY_FIXES`, `RUBY_MERGES`); Chinese-line detection uses `SC_CHARS` (simplified-only chars — never add a kanji used in Japanese) plus the 「」/gloss-segment rules

## Domain & SEO

- Domain: `jpnotes.dev` (Cloudflare DNS → GitHub Pages)
- Old domain: `ralphbupt.github.io/japanese-grammar/` (auto-redirects via stubs)
- Google Search Console: domain-level property verified via DNS TXT
- Bing Webmaster Tools: configured
- Sitemap: auto-generated at `/sitemap.xml` (every page and its `/zh/` copy, with hreflang). Resubmit via the Search Console API (service account `jpnotes-analytics@gen-lang-client-0593149740.iam.gserviceaccount.com`, scope `webmasters`): `PUT https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Ajpnotes.dev/sitemaps/https%3A%2F%2Fjpnotes.dev%2Fsitemap.xml`
- GA: `G-D1KNQTFN1R` — no gtag.js; `GTAG_DEFERRED` in build.js is a ~3 KB sender that posts hits to GA4 `/g/collect` (engagement-gated, bot-filtered, reuses old `_ga` cookie client id, `?ga_debug` → DebugView; sends only on jpnotes.dev — localhost only with `?ga_debug`; `?ga_off` opts a browser out for good, `?ga_on` undoes it). `window.gaEvent(name, params)` is the event API
