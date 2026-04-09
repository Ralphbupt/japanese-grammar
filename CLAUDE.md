# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Japanese language learning project (not a code repo). It contains structured grammar notes and review tracking for a learner targeting JLPT N2 proficiency within 8 weeks (2026-04-05 to 2026-06-05).

## Website

The grammar notes are published as a static site at **https://ralphbupt.github.io/japanese-gramma**.

- **Build**: `npm run build` → runs `build.js` → outputs `dist/index.html`
- **Stack**: marked (markdown→HTML), kuroshiro + kuromoji (furigana generation)
- **Features**: sidebar navigation by week/level, element-level furigana, word tables (单词/读音/含义), SEO meta per lesson, Japanese sidebar titles
- **Deploy**: GitHub Pages from the `dist/` folder

## Structure

- `schedule.md` — Master 8-week schedule with daily topics and spaced repetition intervals
- `grammar/week01-02/` through `grammar/week07-08/` — Grammar lesson notes organized by week, one file per day
- `review/复习追踪.md` — Spaced repetition tracking table
- `build.js` — Static site generator script
- `dist/index.html` — Built site output

## Lesson File Format

Each grammar lesson file follows this template:
- Title with day number and topic
- For each grammar point: **接续** (conjugation pattern), **含义** (meaning), **例句** (example sentences), and **辨析** (comparison with similar grammar) where applicable
- Practice exercises at the end
- Checkbox-style review schedule based on spaced repetition (当天→+1天→+4天→+7天→+14天→+30天)

## Content Guidelines

- All notes are bilingual: Japanese grammar explanations written in Chinese
- Grammar progression: N5 (weeks 1-2) → N4 (weeks 3-4) → N3 (weeks 5-6) → N2 (weeks 7-8)
- The learner handles vocabulary independently; Claude teaches grammar
- Each grammar point needs: meaning, conjugation rules, 3+ example sentences, and comparison with easily confused grammar
- New lessons should be added as `dayNN_topic.md` in the appropriate week folder
- Update `review/复习追踪.md` when adding new grammar points
