# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Japanese language learning project (not a code repo). It contains structured grammar notes and review tracking for a learner targeting JLPT N2 proficiency within 8 weeks (2026-04-05 to 2026-06-05).

## Website

The grammar notes are published as a static site at **https://ralphbupt.github.io/japanese-grammar/**.

- **Build**: `npm run build` → runs `build.js` → outputs `dist/index.html`
- **Stack**: marked (markdown→HTML), kuroshiro + kuromoji (furigana generation)
- **Features**: sidebar navigation by JLPT level, element-level furigana on Japanese text, word tables (单词/读音/含义), SEO meta per lesson, Japanese sidebar titles, checklist persistence via localStorage
- **Deploy**: GitHub Pages from the `dist/` folder

## Build System Architecture

`build.js` is a single-file static site generator (~600 lines). Key concepts:

1. **File discovery**: Reads `grammar/N5/`, `grammar/N4/`, `grammar/N3/`, `grammar/N2/` directories (configured in `GRAMMAR_DIRS`)
2. **Sidebar titles**: `JA_TITLES` object maps file IDs (e.g. `day01`) to Japanese sidebar labels — must be updated when adding lessons
3. **SEO keywords**: `LESSON_KEYWORDS` object maps file IDs to per-lesson keyword strings — must be updated when adding lessons
4. **Furigana**: Uses kuroshiro to add ruby annotations only to elements detected as Japanese (via `data-ja` attribute). Chinese text inside （…） is explicitly protected from furigana
5. **Language detection**: Heuristic using kana presence + a Simplified Chinese character set (`SC_CHARS`) to distinguish Japanese from Chinese content
6. **Output**: Single `dist/index.html` with all lessons inlined as `<article>` elements

When adding a new lesson file, you must update **three things** in `build.js`:
- Add entry in `JA_TITLES` (Japanese sidebar title)
- Add entry in `LESSON_KEYWORDS` (SEO keywords)
- The file itself in the appropriate `grammar/N{level}/` directory

## Structure

- `schedule.md` — Master 8-week schedule with daily topics and spaced repetition intervals
- `grammar/N5/` through `grammar/N2/` — Grammar lesson notes organized by JLPT level, one file per day
- `review/复习追踪.md` — Spaced repetition tracking table
- `build.js` — Static site generator script
- `dist/index.html` — Built site output

## Lesson File Format

Each grammar lesson file follows this template:
- Title with day number and topic
- For each grammar point: **接续** (conjugation pattern), **含义** (meaning), **例句** (example sentences), and **辨析** (comparison with similar grammar) where applicable
- Practice exercises at the end
- Checkbox-style review schedule based on spaced repetition (当天→+1天→+4天→+7天→+14天→+30天)

Filename convention: `dayNN_topic.md` (e.g. `day56_逆接_からといって_どころではない.md`)

## Content Guidelines

- All notes are bilingual: Japanese grammar explanations written in Chinese
- Grammar progression: N5 (days 00–17) → N4 (days 18–31) → N3 (days 32–55) → N2 (days 56–72)
- The learner handles vocabulary independently; Claude teaches grammar
- Each grammar point needs: meaning, conjugation rules, 3+ example sentences, and comparison with easily confused grammar
- New lessons should be added as `dayNN_topic.md` in the appropriate `grammar/N{level}/` folder
- Update `review/复习追踪.md` when adding new grammar points
