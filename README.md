# Japanese Grammar Notes — jpnotes.dev

Free, bilingual JLPT grammar notes from N5 to N1, published at **[jpnotes.dev](https://jpnotes.dev/)** (English) and **[jpnotes.dev/zh/](https://jpnotes.dev/zh/)** (中文).

Every grammar point has how it attaches, what it means, example sentences with audio, a comparison with the patterns it gets confused with, and practice. The notes started as one learner's study log (N5 → N2 in 2026) and are now written for other learners.

## What's on the site

| | |
|---|---|
| **Grammar lessons** | 92 lessons, ~480 grammar points: N5 (lessons 0–17), N4 (18–34), N3 (35–58), N2 (59–75), N1 (76–92) |
| **Guides** | A-vs-B comparisons (は vs が, から vs ので …) and a JLPT exam guide |
| **Examples** | Furigana on every Japanese line (toggleable), 🔊 audio for every model sentence, translations on their own line |
| **Practice** | [/practice/](https://jpnotes.dev/practice/): 2,000+ exam-style questions for every non-listening JLPT item type, N5–N2, with an explanation for every option; timed mock tests with estimated scores; grammar flashcards with spaced repetition |
| **Ask AI** | A side panel on every lesson and after every practice question. Works with no setup (a free relay on Cloudflare Workers AI) or with your own API key, which stays in your browser |
| **Anki** | [/anki/](https://jpnotes.dev/anki/): `.apkg` and TSV decks per level, with audio and cloze cards |
| **Offline** | A service worker caches pages and audio as you read |

No sign-up, no ads. Progress (review checklists, practice history) stays in your browser.

## Repository

```
grammar/
  N5/ N4/ N3/ N2/ N1/   lessons (lessonNN_topic.md) + a checklist page per level
  guides/               comparison pages and the JLPT guide
questions/              practice and mock-test question bank (JSON), see questions/README.md
pages/                  About page
audio/                  pre-generated TTS for example sentences (s{hash}.mp3)
site/                   client scripts: quiz, AI panel, settings, feedback, service worker
worker/                 Cloudflare Worker behind ai.jpnotes.dev (free AI relay, reader feedback)
build.js                static site generator (markdown → HTML, furigana, audio tags, SEO)
build-quiz.js           validates and bundles the question bank
build-anki.js / .py     Anki decks
build-audio.py          Edge TTS for new example sentences
```

Lessons are plain markdown with a small bilingual syntax (`:::zh` / `:::en` blocks, `中文||English` headings); [CLAUDE.md](CLAUDE.md) documents the format and the build in full.

## Build

```sh
npm ci
npm run build              # site + Anki TSV → dist/
python build-anki.py       # .apkg decks (needs genanki)
python build-audio.py      # mp3 for new example sentences (needs edge-tts)
```

Every push to `main` builds and deploys to GitHub Pages.

## Mistakes and contributions

Found a wrong rule, an unnatural example or a bad translation? Use the 💬 Feedback link at the bottom of any page (anonymous, no account needed), comment on the lesson, or open an issue or pull request.

## License

Content and code: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
