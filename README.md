# Japanese Grammar Notes

[![Website](https://img.shields.io/badge/site-jpnotes.dev-e94560)](https://jpnotes.dev/)
[![Deploy](https://github.com/Ralphbupt/japanese-grammar/actions/workflows/deploy.yml/badge.svg)](https://github.com/Ralphbupt/japanese-grammar/actions/workflows/deploy.yml)
[![License: CC BY 4.0](https://img.shields.io/badge/license-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

Free, bilingual JLPT grammar notes from N5 to N1, published at **[jpnotes.dev](https://jpnotes.dev/)** (English) and **[jpnotes.dev/zh/](https://jpnotes.dev/zh/)** (中文).

Every grammar point covers how it attaches, what it means, example sentences with audio, how it differs from the patterns it gets confused with, and practice questions. The notes began as one learner's study log (N5 → N2 in 2026) and are now written for other learners.

## Table of contents

- [Features](#features)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## Features

- **92 grammar lessons, ~480 grammar points**: N5 (lessons 0–17), N4 (18–34), N3 (35–58), N2 (59–75), N1 (76–92), plus A-vs-B comparison guides and a JLPT exam guide.
- **Example sentences** with furigana (can be toggled off), 🔊 audio for every model sentence, and translations.
- **[Practice](https://jpnotes.dev/practice/)**: 2,000+ exam-style questions covering every non-listening JLPT item type (N5–N2), with an explanation for every option. Also timed mock tests with estimated scores, and grammar flashcards with spaced repetition.
- **Ask AI**: a side panel on every lesson and after every practice question. It works with no setup (a free relay on Cloudflare Workers AI), or with your own API key, which stays in your browser.
- **[Anki decks](https://jpnotes.dev/anki/)**: `.apkg` and TSV per level, with audio and cloze cards.
- **No sign-up, no ads.** Your progress stays in your browser, and a service worker keeps pages and audio you've opened available offline.

## Getting started

### Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| [Node.js](https://nodejs.org/) | 20 or later | building the site (required) |
| [Python](https://www.python.org/) | 3.10 or later | local preview server; Anki `.apkg` and audio generation (optional) |
| Git | any | cloning |

The commands below are for macOS and Linux. On Windows, use WSL or Git Bash.

### Installation

```sh
git clone https://github.com/Ralphbupt/japanese-grammar.git
cd japanese-grammar
npm ci
```

The repository includes the pre-generated audio (`audio/`, about 3,000 mp3 files), so the first clone takes a moment.

### Build and preview

```sh
npm run build      # site + Anki TSV → dist/ (under a minute; furigana is generated here)
npm run preview    # copies audio/ into dist/ and serves it at http://localhost:8000
```

Open <http://localhost:8000/>. Pages use root paths (`/lesson05/`), so open them through the server, not by double-clicking the HTML files.

### Optional tools

```sh
pip install genanki      # Anki .apkg decks
python build-anki.py     # → dist/anki/*.apkg (run after npm run build)

pip install edge-tts     # audio for new or edited example sentences
python build-audio.py    # → audio/s{hash}.mp3, only the missing ones
```

## Usage

### Editing a lesson

Lessons are markdown files in `grammar/N{level}/lessonNN_topic.md`. The format uses a small bilingual syntax:

```markdown
## 1. 〜に過ぎない（只不过是……）||1. 〜に過ぎない (Merely…)

:::zh
1. これは私の個人的な意見**に過ぎない**。（这只不过是我个人的意见罢了。）
:::
:::en
1. これは私の個人的な意見**に過ぎない**。(This is merely my personal opinion.)
:::
```

- Every visible string needs both languages: `中文||English` headings, `:::zh` / `:::en` blocks, and `中文 // English` table cells and list items. Otherwise the English page shows Chinese.
- After you add or change an example sentence, run `npm run build` and then `python build-audio.py` to generate its audio. Audio files are named by a hash of the sentence, so editing or reordering examples never mixes them up.
- To add a lesson, also add its sidebar title (`JA_TITLES`) and keywords (`LESSON_KEYWORDS`) in `build.js`, and its page titles in `seo-titles.js`.

[CLAUDE.md](CLAUDE.md) documents the full lesson format, the build pipeline and every site feature.

### Adding practice questions

Questions are JSON files in `questions/N{level}/`. Authoring rules, item types and the review workflow are in [questions/README.md](questions/README.md). To check the question bank without building the site, run `node build-quiz.js`.

## Project structure

```
grammar/
  N5/ N4/ N3/ N2/ N1/   lessons + a checklist page per level
  guides/               comparison pages and the JLPT guide
questions/              practice and mock-test question bank (JSON)
pages/                  About page
audio/                  pre-generated TTS for example sentences
site/                   client scripts: quiz, AI panel, settings, feedback, service worker
worker/                 Cloudflare Worker behind ai.jpnotes.dev (free AI relay, reader feedback)
tools/                  audits (furigana, readings) and Search Console / analytics reports
build.js                static site generator (markdown → HTML, furigana, audio tags, SEO)
build-quiz.js           validates and bundles the question bank
build-anki.js / .py     Anki decks (TSV / .apkg)
build-audio.py          Edge TTS for example sentences
seo-titles.js           per-page titles and descriptions
```

## Deployment

Every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It runs `npm ci` and `npm run build`, copies `audio/` into `dist/`, builds the `.apkg` decks, and deploys `dist/` to GitHub Pages. Audio is never generated in CI: generate it locally and commit `audio/`.

The AI relay and the feedback endpoint are a separate Cloudflare Worker (`worker/`). They are deployed with `cd worker && npx wrangler deploy` and are not needed to build or preview the site.

## Contributing

If you find a wrong rule, an unnatural example or a bad translation, you can:

- use the **💬 Feedback** link at the bottom of any page (anonymous, no account needed);
- leave a comment under the lesson;
- open an issue or a pull request.

## License

Content and code are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See [LICENSE](LICENSE).
