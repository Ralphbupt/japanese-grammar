# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and Codex (`AGENTS.md` is a symlink to it) when working with code in this repository.

## Project Overview

This is a Japanese language learning project: structured JLPT N5–N1 grammar notes (N5–N2 written 2026-04-05 → 06-05 while the author learned them; N1 lessons 76–92 added 2026-10-28, agent-written and agent-reviewed, plan in `docs/n1-plan.md`), published as jpnotes.dev with Anki decks and TTS audio. The author retakes N2 on 2026-12-06; the site's audience is now other learners (English-speaking first, Chinese second).

## Website

The grammar notes are published as a static site at **https://jpnotes.dev/** (custom domain on GitHub Pages, migrated from ralphbupt.github.io/japanese-grammar/ on 2026-05-22).

- **Build**: `npm run build` → runs `build.js` + `build-anki.js` → outputs `dist/`
- **Stack**: marked (markdown→HTML), kuroshiro + kuromoji (furigana generation), sharp (OG images)
- **Deploy**: GitHub Pages via GitHub Actions (`dist/` folder)

### Features
- Sidebar navigation by JLPT level (hover-to-expand, available on all pages); on phones (≤768px) it is a drawer: always starts closed, backdrop / Esc / Back close it, following a link closes it (desktop remembers open/closed in `localStorage.sb`); phones also get a top bar `#m-bar` (☰ = the sidebar's own button at its left end, page title → level overview, search / AI / share / settings proxying the sidebar buttons) that slides away while scrolling down (`html.mbar-hidden`; `.q-mockbar` sticks below it)
- Share: the share icon (sidebar toolbar + top bar) and 分享成绩 on practice / mock results call `window.jpShare()` in `site/settings-modal.js` — system share sheet on touch devices; inside WeChat a hint to use its ··· menu; else a menu — zh: copy, 微信扫一扫 (QR via `qrcode-generator`, copied to `dist/qrcode.js`, loaded on demand), copy blurb, X; en: copy, X, Facebook, LINE, Reddit; links get `?utm_source=share`; GA events `share_open` / `share` (src, method, page)
- Element-level furigana on Japanese text via `data-ja` attribute
- Bilingual content (Chinese + English): lessons, checklists, guides, the N5–N2 overviews, `/guides/` and `/about/` are published once per language (below); the home page and `/anki/` stay bilingual with a language toggle
- Themes (settings → 主题, and the top-bar theme menu): auto / white / paper / sepia / dark. `localStorage.theme` = `white|light|sepia|dark` (`light` is paper; absent = auto, i.e. paper by day, dark at night). Classes on `<html>`: `theme-dark`, or `theme-light` plus `tone-white` / `tone-sepia`, so every dark rule (`:root:not(.theme-light)` / `html.theme-dark`) keeps excluding the light tones. Colours are tokens (`--bg`, `--surface-2`, `--row-alt`, `--panel-bg`, `--chip-bg`, `--accent`, `--link` …); light themes use a deeper accent red so red text passes 4.5:1, dark switches back to `#e94560`. Red is reserved for the grammar point being taught (bold target in examples) plus links / active states; furigana, cross-link chips, answer summaries, breadcrumbs and sidebar level headings stay neutral and turn red only on hover
- 🔊 TTS audio on example sentences (pre-generated Edge TTS, fallback: none)
- Example sentence layout (build.js, same pass as audio tagging): model sentences get `data-ex` and are set in system Mincho (no web font); the trailing `(translation)` is wrapped in `.ex-tr` and shown as its own muted line, brackets hidden but kept in the text; 🔊 / 讲解 sit after the Japanese, before the translation. Tables are wrapped in `.table-scroll` so wide ones scroll on phones
- Cross-links between related grammar points (25 per page, descriptive anchor text)
- Guides (`grammar/guides/*.md` → `/<slug>/`, hub at `/guides/`, sidebar group 专题): A-vs-B comparison pages (は vs が, から vs ので …) and the JLPT exam guide (`jlpt-*` sorts first). Same markdown format as lessons; prev/next stay inside the group; not read by build-anki.js
- One page per language for those pages, from `PAGE_LANGS` in build.js (`langVariant()` / `writeLangPage()`): `/<page>/` English only, `/zh/<page>/` Chinese only (`localizePage()` strips the other languages' blocks inside `<main>`; non-root copies get their own `<title>`/description and internal links rewritten to `/zh/`). `data-force-lang` pins the UI language and `data-alt-<code>` is where the language switch goes; `LANG_REDIRECT_JS` in `<head>` sends a reader to their language's copy (saved pref; a zh browser with no pref only on the root page); the 中文/EN button saves the choice and navigates there. hreflang en / zh-Hans / x-default on every copy and in the sitemap; giscus thread and AI chat history are shared across copies. A new language = a `PAGE_LANGS` entry + `:::xx` blocks + lang-xx CSS, and the `isEn` pref becoming a language code. Every visible string needs both sides — `:::zh`/`:::en` blocks, `中文||English` headings, `中文 // English` table cells (td/th) and list items — or the English page shows Chinese
- SEO titles: `seo-titles.js` maps page id → `{ en, zh, desc?, descZh?, level? }`, phrased like real searches (pattern + romaji + vs/meaning; zh: 区别/用法). Pages without an entry fall back to the template. `python3 tools/gsc-report.py` lists high-impression / low-click pages and their queries — the pages worth retitling
- Per-lesson meta: last-updated date + reading time
- SEO: unique meta descriptions, Article+LearningResource + BreadcrumbList schema in the page's own language (no FAQ schema: Google shows FAQ rich results only for government/health sites)
- Giscus comments (GitHub Discussions-backed)
- Anki flashcard decks (TSV + .apkg downloads at `/anki/`)
- 🤖 Ask-AI side panel on lesson pages (`site/ai-assistant.{js,css}`, bundled into `dist/ai-assistant.js` — the CSS is injected by the script, not inlined in pages): works with no setup via the `jpnotes` preset → free relay at `ai.jpnotes.dev` (Cloudflare Worker in `worker/`, runs `@cf/openai/gpt-oss-120b` on Workers AI — no third-party key, budget = Free plan's 10k neurons/day ≈ 20–40 questions, errors rather than bills when exhausted; Origin-locked to jpnotes.dev (localhost only under `wrangler dev` with `ALLOW_LOCAL=1` in worker/.dev.vars; local pages reach it with `?ai=local`), per-IP 6/min + 50/day plus a 9,500-neuron/day site budget via a SQLite Durable Object, no logging; deploy with `cd worker && npx wrangler deploy`, secret `IP_SALT`). The same Worker takes reader feedback: `POST /feedback` → D1 `jpnotes-feedback` (schema in `worker/migrations/`, 20/day per daily-salted IP hash), sent by `site/feedback.js` (💬 box on the practice/mock/cards/hub pages, and quiz.js's 这题有问题？); read it with `tools/feedback-report.sh` (`--local` for wrangler dev; pages talk to the local worker with `?fb=local`). Readers can instead add their own API key (localStorage only), browser calls the provider directly; 19 presets grouped 国际/国内/本地/聚合 (Anthropic, OpenAI, Gemini, xAI, Mistral, Groq, DeepSeek, Qwen, Kimi, GLM, 豆包, MiniMax, 混元, 文心, Ollama, LM Studio, OpenRouter, SiliconFlow, custom) plus a ⟳ button that fetches `{base}/models` live. The "用自己的 API key" link opens a 3-step wizard (3 recommended providers per UI language from `RECOMMEND`, link to the provider's `keyUrl`, paste key, one test request before saving). Config is v2: several providers can be configured at once (`cfg.profiles`, one active), switched from the header menu. Context scope (📎 row above the input): auto (the numbered `## N.` grammar point on screen, default), whole lesson, or one grammar point; quick prompts always send the whole lesson; selecting text inside a grammar point pins the scope to it, and the quoted text is cleaned (no furigana / 🔊, trimmed to the Japanese sentence). History lives in localStorage per lesson (24 msgs kept, last 6 turns sent). Replies render `漢字（かな）` as ruby; thinking/reasoning deltas show in a collapsible block; answers have copy / regenerate, errors have retry
- Security for the AI panel: every page carries a `<meta http-equiv="Content-Security-Policy">` (`CSP_META`: scripts/styles/images/media/frames only from self + giscus.app, `object-src 'none'`, `base-uri`/`form-action 'self'`; /anki/ has its own in build-anki.js) with a `connect-src` allowlist (self, GA, provider hosts parsed from `site/ai-assistant.js`, localhost/127.0.0.1). Adding a provider = adding its `base:` (and optional `altBase:`) URL in the JS; the CSP picks both up at build time. Preset model IDs were last verified against official docs on 2026-09-16; the ⟳ button fetches the live list. `effortParams()` maps the 快速/标准/深入 setting onto each provider's reasoning knob. Settings only accept https or local base URLs, warn on non-official hosts, and offer session-only key storage. Privacy explanation lives in `pages/about.md` (#ai-privacy)
- Practice, mock tests and flashcards (`/n5-practice/`, `/n5-mock-test/`, `/n5-cards/`; spec in `docs/quiz-*.md`): `questions/N{level}/` holds grammar per lesson (`lessonNN.json`), vocabulary (`moji-goi*.json`) and reading (`dokkai*.json`); mock tests live in `questions/N{level}/mock-N/` (same files, grammar in `bunpou.json`, never in the practice bank). `build-quiz.js` validates (also `node build-quiz.js` alone, which also warns about test-taking cues: right option clearly longest/shortest in a type, ★ piling up in one slot, mock items copying practice ones), shuffles options with a per-id seed, adds furigana (none for vocabulary, like the real test; N3 only on words with kanji outside `BASIC_KANJI`; readings taken from the finished sentence `full`) → `dist/quiz/{level}.json`, `{level}-mock-N.json` + `.key.json` (answers, fetched after submitting); the mock layout and pass marks per level are `MOCK` in build-quiz.js. Flashcard data `dist/quiz/{level}-cards.json` comes from build-anki.js. One client, `site/quiz.js` (+ `quiz.css`, inlined), modes by `data-mode`; everything in localStorage `jp_quiz_v1`. After an answer (in mock tests: in the review), 🤖 AI 讲解 hands the question to the AI panel: `ai-assistant.js` runs in quiz mode on practice/mock pages (no lesson; `window.jpAI.explain(ctx, prompt)`, context = question + options + answer + the reader's choice + fixed explanation + the linked lesson section fetched from the lesson page; no chat history kept; relay `source` = `quiz`). Authoring + blind-review rules: `questions/README.md`; `tools/quiz-blind.js` exports an answer-free sheet (`sheet N5 lesson05` / `sheet N5/mock-1 bunpou`) and checks a reviewer's answers. After answering, 🔊 plays the finished sentence (`sa` = `audio/q{sha1[:12]}.mp3` of `kj` or `full`, dialogue labels and stage directions stripped; none for reading / 用法; requested via `AUDIO_REQUESTS` like the passages' `p…` files); 排序 keeps the reader's own order, wrong blanks marked, the right order spelled out. In a set, 上一题 (or ←) re-shows answered questions read-only; 查看错题 lists the review list; 做题分析 (from the progress line) is computed in the browser from `jp_quiz_v1` — accuracy and trend, a rough score per official section from `exam` in `dist/quiz/{level}.json` (scoring/pass/minutes from `MOCK`), weakest types and grammar points (by first non-vocab ref) with a 专练 set. `ABOVE_LEVEL` in build-quiz.js lists lessons/points that teach a higher level's grammar early (N5 lessons 09–11, 14 and points of 07/12/13/15/16 are N4): on the lower level's page those questions carry `pre` ("N4 预习" — in lesson practice and the review list, out of daily sets, practice by type, progress and analysis), the higher level's bank includes them as ordinary questions (same ids, shared progress), and the lesson page says so. `QUIZ_PUBLIC` in build.js: false = pages built but noindex, out of the sitemap, unlinked. Listening (聴解, spec `docs/quiz-listening-spec.md`): scripts in `questions/N{level}/choukai-*.json` (mock: `mock-N/choukai-*.json`, the test's last sitting with a timed answering pause after each item and listening in the pass/fail estimate); audio from `tools/choukai-audio.py` → `audio/choukai/` + `index.json`, pictures from `tools/choukai-images.py` → `images/choukai/` + `index.json` (build.js copies the used ones to `dist/images/choukai/`), scripts checked by `tools/choukai-check.js`. build-quiz.js uses an item only while its manifest `src` matches the current script (else a build warning, item left out); options keep their file order
- Performance: inline CSS minified by `minifyCss()`; Giscus `client.js` loads only when comments near the viewport (IntersectionObserver); `SPECULATION_RULES` prefetch internal pages on hover and prerender on pointerdown; 🔊 mp3 / search index start loading on hover; AI panel preconnects to the active provider on open
- Service worker `site/sw.js` (→ `dist/sw.js`, registered by `SW_REGISTER`): audio cache-first forever (hash-named, serves 206 for Range), `*.js?v=` cache-first, search index stale-while-revalidate, pages network-first with offline fallback. Bump `V` in sw.js to drop all caches
- Lighthouse 100/100 on all 4 categories

## Build System Architecture

### build.js — Static site generator

Key concepts:

1. **File discovery**: Reads `grammar/N5/` … `grammar/N1/` directories
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
- Generates `.mp3` via `edge-tts` (ja-JP-NanamiNeural voice); `TTS_READINGS` rewrites words Nanami misreads (何時, standalone 町, 〜気味 …) into kana before speaking — the id still hashes the written text, so after adding a rule delete the mp3s it should fix and rerun. Readings were checked by transcribing every mp3 with Whisper (2026-10-30)
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
  N1/   lesson76-lesson92  (17 lessons incl. 92 review)
  guides/ comparison pages + JLPT exam guide (not a level)
pages/
  about.md               (bilingual About page source)
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
  ai-usage-report.sh      (free-AI relay usage per day: requests, % of the neuron budget, limited / backup / error)
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
- Table cells (td/th) and list items: `中文全文 // English full text` — the whole cell/item on both sides; `//` must not sit inside markup
- Vocab meaning cells: `义项（词性）——说明；「搭配」释义//(POS) senses — note; 「搭配」 gloss` (see lesson35). Never one-word glosses; the note only when it says something real; 1–2 real collocations in 「」 (the only place Japanese may appear in the cell — the build renders each as its own line with furigana, `colloc-ja`); no romaji; kana-free Chinese POS labels (（名、可作动词）, not ・)
- The English side of a `## N. 〜pattern (gloss)` heading gets the pattern's romaji added by the build (`addRomaji()`); don't type romaji there by hand
- Changing a Japanese example sentence changes its audio hash → run `python build-audio.py`

## Content Guidelines

- All notes are bilingual: Chinese explanations + English translations
- Grammar progression: N5 (00–17) → N4 (18–34) → N3 (35–58) → N2 (59–75) → N1 (76–92)
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
