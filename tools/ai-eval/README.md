# AI-panel answer check

`cases.json` holds real questions readers (and the author) asked the 问 AI panel, with the exact messages the site sent: the system prompt with the lesson section or practice question, and the user turn. Each case says what a correct answer must do (`expect`). It also carries a few crude string checks: `must` / `mustNot`, matched after readings in （） are stripped.

```
GEMINI_API_KEY=… node tools/ai-eval/run.mjs cf:@cf/openai/gpt-oss-120b gemini:gemini-3.8-flash
```

Answers go to `results/<date>/<model>.md` (gitignored). The string checks only catch the obvious. Read every answer against `expect`, and look for wrong readings and invented rules.

- `anthropic:<model>` uses `ANTHROPIC_API_KEY`; `--effort` sets `output_config.effort`. Thinking counts against `max_tokens`, so 2048 can cut an answer off.
- `cf:` models spend the Cloudflare account's free daily neurons, the same pool the site's relay uses. That is about 1,000 neurons per model for the 13 cases. DeepSeek and GLM are not available on the Workers Free plan.
- The prompts are frozen. After changing a prompt in `site/ai-assistant.js` or `site/quiz.js`, re-capture: serve `dist/` locally, point a custom provider at a server that saves each request body, and trigger each case on its page.
- Add a case whenever someone finds a wrong answer. The ⚑ 有错 button saves them to `localStorage.jp_ai_flags`.

## 2026-11-02 results (13 cases, graded by reading)

| model | right | notes |
|---|---|---|
| gemini-3.8-flash | 13 | ~12 s; concise; followed the 【补充】/pitfall rules |
| gemini-3.1-pro-preview | 12.5 | ~12 s; one overclaim (最も "not for personal likes") |
| @cf/google/gemma-4-26b-a4b-it | 9 + 2 empty | ~40 s; two empty answers (token budget used up) |
| @cf/openai/gpt-oss-120b, reasoning medium | ~8 | ~10 s, +16% neurons; readings right (叱（しか）る), ます/です right, 〜通り right; still wrong: お忙しいところを "not allowed", 恐れ入（はい）る in one answer, よろしい as a form of 良い, 台風に降られた |
| @cf/openai/gpt-oss-120b (the relay) | ~6 | ~6 s; wrong readings (叱（し）られた, 恐れ入（はい）る); repeated "ます is politer than です"; an unnatural example (台風に降られて道路が冠水); tables despite the prompt |

## 2026-11-05 results (same 13 cases, graded by reading)

| model | right | notes |
|---|---|---|
| claude-haiku-5-5, effort medium | 11 of 13; 12 at `max_tokens` 4096 | ~7 s; one answer cut off at 2048 (fine at 4096, 15 s); wrong: お忙しいところ "can't take を", invented お忙しいところに; ~$0.0008 per question |
| claude-haiku-5-5, effort low | ~10.5 | ~6 s; readings right, ます/です right; say お忙しいところ "usually no を"; garbled sentences; one answer drifts into Japanese; おっしゃった wrongly called irregular |
