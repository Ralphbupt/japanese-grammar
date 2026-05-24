# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Japanese language learning project. It contains structured grammar notes, Anki flashcard decks, and TTS audio for a learner targeting JLPT N2 proficiency within 8 weeks (2026-04-05 to 2026-06-05).

## Website

The grammar notes are published as a static site at **https://jpnotes.dev/** (custom domain on GitHub Pages, migrated from ralphbupt.github.io/japanese-grammar/ on 2026-05-22).

- **Build**: `npm run build` → runs `build.js` + `build-anki.js` → outputs `dist/`
- **Stack**: marked (markdown→HTML), kuroshiro + kuromoji (furigana generation), sharp (OG images)
- **Deploy**: GitHub Pages via GitHub Actions (`dist/` folder)

### Features
- Sidebar navigation by JLPT level (hover-to-expand, available on all pages)
- Element-level furigana on Japanese text via `data-ja` attribute
- Bilingual content (Chinese + English) with language toggle button
- Dark mode (3-state: auto/light/dark) with `theme-dark`/`theme-light` classes on `<html>`
- 🔊 TTS audio on example sentences (pre-generated Edge TTS, fallback: none)
- Cross-links between related grammar points (25 per page, descriptive anchor text)
- Per-lesson meta: last-updated date + reading time
- SEO: unique meta descriptions, Article+LearningResource schema, FAQ schema
- Giscus comments (GitHub Discussions-backed)
- Anki flashcard decks (TSV + .apkg downloads at `/anki/`)
- Lighthouse 100/100 on all 4 categories

## Build System Architecture

### build.js — Static site generator

Key concepts:

1. **File discovery**: Reads `grammar/N5/`, `grammar/N4/`, `grammar/N3/`, `grammar/N2/` directories
2. **Sidebar titles**: `JA_TITLES` maps file IDs (e.g. `lesson01`) to Japanese sidebar labels
3. **SEO keywords**: `LESSON_KEYWORDS` maps file IDs to per-lesson keyword strings
4. **Furigana**: kuroshiro adds ruby annotations to `data-ja` elements. Chinese text inside （…） is protected
5. **Audio tagging**: Reads `audio/manifest.json`, matches cleaned Japanese text to pre-generated .mp3 files, adds `data-audio` attributes to matching `<li>` elements
6. **TTS JS**: Injects 🔊 buttons on elements with `data-audio`, plays `/audio/{id}.mp3` on click
7. **Old URL redirects**: `DAY_TO_LESSON` map generates meta-refresh stubs at `/dayNN/` → `/lessonNN/`
8. **CNAME**: Auto-generates `dist/CNAME` when `SITE` points to a non-github.io domain

When adding a new lesson file, update **three things** in `build.js`:
- Add entry in `JA_TITLES` (Japanese sidebar title)
- Add entry in `LESSON_KEYWORDS` (SEO keywords)
- The file itself in the appropriate `grammar/N{level}/` directory

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

## CI Pipeline (`.github/workflows/deploy.yml`)

```
npm ci
npm run build          # build.js (site HTML) + build-anki.js (TSV + .cards.json)
cp -r audio dist/audio # pre-generated TTS audio (committed, not regenerated in CI)
python build-anki.py   # .apkg from .cards.json
upload dist/           # deploy to GitHub Pages
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
pages/
  about.md               (bilingual About page source)
  drafts/                 (work-in-progress lesson drafts)
data/
  anki-cards.json         (curated Anki card data, WIP)
audio/
  manifest.json           (text → filename mapping for TTS)
  l{NN}.{NNN}.mp3         (5522 pre-generated TTS files, ~134MB)
build.js                  (main static site generator)
build-anki.js             (Anki TSV + landing page generator)
build-anki.py             (Anki .apkg generator, reads .cards.json)
build-audio.py            (Edge TTS audio generator)
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

## Content Guidelines

- All notes are bilingual: Chinese explanations + English translations
- Grammar progression: N5 (00–17) → N4 (18–34) → N3 (35–58) → N2 (59–75)
- Each grammar point needs: meaning, conjugation rules, 3+ example sentences, and comparison with easily confused grammar
- Example sentences should have both Chinese and English translations in parens
- New lessons: add `lessonNN_topic.md` in `grammar/N{level}/`, update `JA_TITLES` and `LESSON_KEYWORDS` in `build.js`
- After adding lessons with new examples: run `build-audio.py` locally to generate TTS audio, commit `audio/` directory

## Domain & SEO

- Domain: `jpnotes.dev` (Cloudflare DNS → GitHub Pages)
- Old domain: `ralphbupt.github.io/japanese-grammar/` (auto-redirects via stubs)
- Google Search Console: domain-level property verified via DNS TXT
- Bing Webmaster Tools: configured
- Sitemap: auto-generated at `/sitemap.xml`
- GA: `G-D1KNQTFN1R` (deferred load, bot-filtered)
