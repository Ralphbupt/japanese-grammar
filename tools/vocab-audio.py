#!/usr/bin/env python3
"""Vocabulary list audio (/{level}-vocabulary-list/): every word of a level's
high-frequency list read as a track — the word (its reading, so the voice can't
misread the kanji) → its meaning (Chinese or English) → an example (Japanese) →
the example's translation — one mp3 per level and language, with line timing.
Source: questions/vocab-list/src/{level}.json — [{w, r, n (times the real JLPT
tested it), years, zh, en, ex: {ja (word marked **…**), zh, en}}], written by
Claude (original examples); entries with "skip" are left out.
Same TTS, cache, gaps and upload as tools/grammar-audio.py.
  python3 tools/vocab-audio.py n2 [--lang=zh] [--upload]
(--lang: build only that track; the other language's track already in the data file
is kept, and build.js leaves out the page of a language that has no track yet)
Writes audio/vocab/{level}-{lang}.mp3 (not in git; --upload → R2 vocab/… on
audio.jpnotes.dev) and questions/vocab-list/{level}.json (text + timing, committed;
build.js renders the page from it).
"""
import concurrent.futures as cf, hashlib, importlib.util, json, os, re, subprocess, sys, wave

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ga", os.path.join(HERE, "grammar-audio.py"))
ga = importlib.util.module_from_spec(spec); spec.loader.exec_module(ga)
ROOT = ga.ROOT
OUT_AUDIO = os.path.join(ROOT, "audio", "vocab")
OUT_DATA = os.path.join(ROOT, "questions", "vocab-list")
GAP = {"g": 500, "m": 700, "e": 600, "t": 900, "end": 1400}
# Groups on the page (and "play this group"), by how often the real tests asked the word.
GROUPS = [(3, "3+"), (2, "2"), (1, "1")]


def items_of(level):
    src = json.load(open(os.path.join(OUT_DATA, "src", f"{level}.json"), encoding="utf-8"))
    out = []
    for x in src:
        if x.get("skip") or not x.get("ex"):
            continue
        g = next(k for n, k in GROUPS if x["n"] >= n)
        out.append({"w": x["w"], "r": x["r"], "n": x["n"], "years": x.get("years", []), "group": g,
                    "mean": {"zh": x["zh"], "en": x["en"], **({"ja": x["ja"]} if x.get("ja") else {})}, "ex": x["ex"], **({"say": x["say"]} if x.get("say") else {})})
    return out


def lines_of(items, lang):
    """Line kinds as in grammar audio: g word, m meaning, e example, t its translation."""
    out = []
    for i, it in enumerate(items):
        # `say`: the form checked by tools/vocab-audio-check.py (kanji / katakana / hiragana)
        out.append((i, "g", ga.VOICE["ja"], it.get("say") or it["r"] + "。"))
        if lang == "ja":   # Japanese-only track: monolingual definition, no translation (empty t line)
            out.append((i, "m", ga.VOICE["ja"], it["mean"]["ja"]))
            out.append((i, "e", ga.VOICE["ja"], ga.say_example(it["ex"]["ja"].replace("**", ""))))
            out.append((i, "t", None, ""))
            continue
        out.append((i, "m", ga.VOICE[lang], ga.say_text(it["mean"][lang], lang)))
        out.append((i, "e", ga.VOICE["ja"], ga.say_example(it["ex"]["ja"].replace("**", ""))))
        out.append((i, "t", ga.VOICE[lang], ga.say_text(it["ex"][lang], lang)))
    return out


def build(level, langs=("zh", "en", "ja")):
    items = items_of(level)
    data = {"level": level.upper(), "items": items, "tracks": {}}
    old = os.path.join(OUT_DATA, f"{level}.json")
    if os.path.exists(old):   # keep the other language's track (same items → same line count)
        prev = json.load(open(old, encoding="utf-8"))
        for k, tr in prev.get("tracks", {}).items():
            if k not in langs and len(tr["lines"]) == 4 * len(items) and "?v=test" not in tr["src"]:
                data["tracks"][k] = tr
    for lang in langs:
        lines = lines_of(items, lang)
        with cf.ThreadPoolExecutor(6) as ex:
            pcms = list(ex.map(lambda l: ga.speak(l[2], l[3]) if l[3] else b"", lines))
        buf, t, timing = bytearray(b"\0\0" * (ga.RATE // 2)), 0.5, []
        for n, ((i, k, _, _), pcm) in enumerate(zip(lines, pcms)):
            d = len(pcm) / 2 / ga.RATE
            timing.append([k, round(t, 2), round(t + d, 2)])
            buf += pcm
            last = n + 1 == len(lines) or lines[n + 1][0] != i
            gap = GAP["end"] if last else 0 if not lines[n + 1][3] else GAP[k]   # no pause before an empty line
            buf += b"\0\0" * (ga.RATE * gap // 1000)
            t += d + gap / 1000
        wav = os.path.join(ga.CACHE, f"vocab-{level}-{lang}.wav")
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(ga.RATE); w.writeframes(bytes(buf))
        mp3 = os.path.join(OUT_AUDIO, f"{level}-{lang}.mp3")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wav, "-b:a", "48k", mp3], check=True)
        os.remove(wav)
        ver = hashlib.md5(open(mp3, "rb").read()).hexdigest()[:8]
        data["tracks"][lang] = {"src": f"vocab/{level}-{lang}.mp3?v={ver}", "duration": round(t, 1), "lines": timing}
        print(f"  {level} {lang}: {len(items)} words, {len(lines)} lines, {t / 60:.1f} min", flush=True)
    with open(os.path.join(OUT_DATA, f"{level}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def upload(level, langs=("zh", "en", "ja")):
    for lang in langs:
        subprocess.run(["npx", "wrangler", "r2", "object", "put", f"jpnotes-audio/vocab/{level}-{lang}.mp3",
                        "--file", os.path.join(OUT_AUDIO, f"{level}-{lang}.mp3"), "--content-type", "audio/mpeg",
                        "--remote"], cwd=os.path.join(ROOT, "worker"), check=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for d in (ga.CACHE, OUT_AUDIO, OUT_DATA):
        os.makedirs(d, exist_ok=True)
    langs = next((a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--lang=")), ["zh", "en", "ja"])
    for lv in args or ["n2"]:
        build(lv, langs)
        if "--upload" in sys.argv:
            upload(lv, langs)
