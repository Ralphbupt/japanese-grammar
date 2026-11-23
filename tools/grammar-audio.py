#!/usr/bin/env python3
"""Grammar audio (/{level}-grammar-audio/): every grammar point of a level read as
a podcast — the pattern (Japanese) → its meaning (Chinese or English) → two
examples (Japanese), each followed by its translation — one mp3 per level and
language, with line timing.

Source: the lessons' grammar points and examples (dist/anki/.cards.json from
build-anki.js; run `npm run build` first) + notes per point written for this
page (questions/grammar-audio/src/{level}*.json: connection, a meaning written to
be read aloud, confusables, which two examples to read, optional cleaned
translations; exam sittings are added by build.js from questions/exam-grammar/). Gemini TTS, one request per
line, cached by voice + text, so the Japanese clips are shared by both tracks.

  python3 tools/grammar-audio.py n2 [n3 …] [--upload]     (no level = all five)

Writes audio/grammar/{level}-{lang}.mp3 (not in git; --upload puts them on R2
as grammar/… on audio.jpnotes.dev) and questions/grammar-audio/{level}.json
(text + timing, committed; build.js reads it).
Key: $GEMINI_API_KEY or ~/.config/storyanim/gemini_key.
"""

import base64, concurrent.futures as cf, hashlib, html, json, os, re, struct, subprocess, sys, time
import urllib.error, urllib.request, wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://generativelanguage.googleapis.com/v1beta/models"
TTS_MODEL = os.environ.get("TTS_MODEL", "gemini-3.8-flash-tts")
RATE = 24000
VOICE = {"ja": "Leda", "zh": "Kore", "en": "Kore"}
GAP = {"g": 500, "m": 800, "e": 600, "t": 1000, "end": 1800}     # silence after a line, ms
EXAMPLES = 2
CACHE = os.path.join(ROOT, ".cache", "grammar-audio")
OUT_AUDIO = os.path.join(ROOT, "audio", "grammar")
OUT_DATA = os.path.join(ROOT, "questions", "grammar-audio")


def api_key():
    k = os.environ.get("GEMINI_API_KEY")
    return k.strip() if k else open(os.path.expanduser("~/.config/storyanim/gemini_key")).read().strip()


def post(model, body):
    req = urllib.request.Request(f"{API}/{model}:generateContent", json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "x-goog-api-key": api_key()})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=200) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if attempt == 5 or e.code not in (429, 500, 503):
                raise
        except (TimeoutError, urllib.error.URLError):
            if attempt == 5:
                raise
        time.sleep(15 * (attempt + 1))


def pcm_of(data):
    """3.x TTS returns a whole WAV file; keep only its data chunk."""
    if data[:4] != b"RIFF":
        return data
    i = 12
    while i + 8 <= len(data):
        cid, size = data[i:i + 4], struct.unpack("<I", data[i + 4:i + 8])[0]
        if cid == b"data":
            return data[i + 8:i + 8 + size]
        i += 8 + size + (size & 1)
    raise ValueError("WAV without data chunk")


def speak(voice, text):
    key = hashlib.md5(f"{TTS_MODEL}|{voice}|{text}".encode()).hexdigest()[:16]
    path = os.path.join(CACHE, key + ".pcm")
    if os.path.exists(path):
        return open(path, "rb").read()
    r = post(TTS_MODEL, {"contents": [{"parts": [{"text": text}]}],
                         "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {
                             "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}})
    pcm = pcm_of(base64.b64decode(r["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]))
    with open(path, "wb") as f:
        f.write(pcm)
    return pcm


def plain(h):
    """Ruby HTML → the written sentence."""
    h = re.sub(r"<rt>.*?</rt>|<rp>.*?</rp>", "", h or "")
    return html.unescape(re.sub(r"<[^>]+>", "", h)).strip()


def say_pattern(t):
    # Alone, the particles は and へ would be read "ha" and "he"; 〜方 (やり方) is かた.
    t = {"は": "わ", "へ": "え", "〜方": "かた"}.get(t, t)
    t = re.sub(r"[（(]よ[）)]", "よ", t)                  # 〜（よ）うが → ようが
    t = re.sub(r"[（(][^）)]*[）)]", "", t)
    t = re.sub(r"[〜～~…]", "", t)
    t = re.sub(r"\s*[/／・;；]\s*", "、", t)
    return re.sub(r"、+", "、", t).strip("、 ") + "。"


def say_text(t, lang):
    """A meaning or translation as the voice should read it."""
    t = re.sub(r"[（(][^）)]*[）)]", "", plain(t))
    t = re.sub(r"\[([^,\]]+)[^\]]*\]", r"\1", t)          # "[you, them]" → "you"
    t = re.sub(r"(?<=[。.!?！？])\s*[—–→].*$", "", t)       # a note after the sentence: "他是学生。— 简体"
    t = re.sub(r"\s*[—–]\s*", "，" if lang == "zh" else ", ", t)  # a dash inside one: read as a pause
    t = re.sub(r"…+", "、" if lang == "zh" else " ", t).replace("~", "").replace("〜", "")
    t = re.sub(r"^、|、(?=[，。、！？]|$)", "", t)
    t = re.sub(r"\s*[;；/]\s*", "，" if lang == "zh" else ", ", t).strip("，, ")
    return t if re.search(r"[。.!?！？」\"]$", t) else t + ("。" if lang == "zh" else ".")


def say_example(t):
    t = re.sub(r"[（(][^）)]*[）)]", "", t)                 # stage directions
    return re.sub(r"^[A-ZＡ-Ｚ][：:]\s*|(?<=[。」？！])\s*[A-ZＡ-Ｚ][：:]\s*", "", t).strip()


def items_of(level):
    cards = json.load(open(os.path.join(ROOT, "dist", "anki", ".cards.json"), encoding="utf-8"))[level.upper()]
    # Notes are in the cards' order (a key can repeat: two points named 使役形).
    notes = []
    for f in sorted(os.listdir(os.path.join(OUT_DATA, "src"))):
        if re.fullmatch(level + r"[a-z]?\.json", f):
            notes += json.load(open(os.path.join(OUT_DATA, "src", f), encoding="utf-8"))
    if len(notes) != len(cards["zh"]):
        raise SystemExit(f"{level}: {len(notes)} notes for {len(cards['zh'])} grammar points — the lessons changed; update src/")
    notes = iter(notes)
    # Exam sittings are not stored here: build.js adds them from our own count
    # of the past papers (questions/exam-grammar/, EXAM_SEEN / gaExam).
    out = []
    for a, b in zip(cards["zh"], cards["en"]):
        key = f"lesson{a['lessonNum']}:{a['term']}"
        n = next(notes)
        if n["key"] != key:
            raise SystemExit(f"{level}: notes say {n['key']}, the lessons have {key} — update src/")
        ex = [{"ja": x.get("cloze") or x["jpHtml"], "zh": x.get("zh", ""), "en": y.get("en", ""), "audio": x.get("audio", "")}
              for x, y in zip(a["examples"], b["examples"])]
        if n.get("ex"):     # the card data missed the lesson's examples: the notes copy them (**…** = the pattern)
            ex = [{"ja": re.sub(r"\*\*(.+?)\*\*", r'<b class="cl">\1</b>', html.escape(e["ja"])), "zh": e["zh"], "en": e["en"], "audio": ""} for e in n["ex"]]
        pick = [i for i in n["pick"] if 0 <= i < len(ex)][:EXAMPLES] or [0]
        for i, tr in (n.get("tr") or {}).items():
            for lang in ("zh", "en"):
                if tr.get(lang) and int(i) < len(ex):
                    ex[int(i)]["say_" + lang] = tr[lang]
                    if not ex[int(i)][lang]:            # no translation in the lesson: show the notes' one
                        ex[int(i)][lang] = tr[lang]
        # Folded extras: skip sub-headings the lessons list among examples (【としては】) and untranslated lines.
        ok = lambda i: not plain(ex[i]["ja"]).startswith("【") and ex[i]["zh"] and ex[i]["en"]
        order = pick + [i for i in range(len(ex)) if i not in pick and ok(i)]
        out.append({"key": key, "lesson": "lesson" + a["lessonNum"], "term": n.get("term") or a["term"], "form": n["form"], "mean": n["mean"],
                    "vs": n.get("vs") or {"zh": "", "en": ""},
                    "ex": [ex[i] for i in order], "read": len(pick)})
    return out


# Short kana patterns said alone get misread (つつ → "chichi", たまま → "tamago"); src/say.json
# maps the spoken pattern to a form a listening check (Gemini) heard right — katakana or in 「」.
# It also holds whole example sentences the voice misread, keyed by the written sentence
# (明日は雨ですよ。 → あしたは…: Gemini said あす in 8 of 25 明日 lines, 2026-11-24). Per line,
# so the lines it already read right keep their cached clips.
_say = os.path.join(OUT_DATA, "src", "say.json")
SAY = json.load(open(_say, encoding="utf-8")) if os.path.exists(_say) else {}


def lines_of(items, lang):
    """Line kinds: g pattern, m meaning, e example, t its translation."""
    out = []
    for i, it in enumerate(items):
        p = say_pattern(it["term"])
        out.append((i, "g", VOICE["ja"], SAY.get(p, p)))
        out.append((i, "m", VOICE[lang], say_text(it["mean"][lang], lang)))
        for e in it["ex"][:it["read"]]:
            s = say_example(plain(e["ja"]))
            out.append((i, "e", VOICE["ja"], SAY.get(s, s)))
            out.append((i, "t", VOICE[lang], say_text(e.get("say_" + lang) or e[lang], lang)))
    return out


def build(level):
    items = items_of(level)
    data = {"level": level.upper(), "items": items, "tracks": {}}
    for lang in ("zh", "en"):
        lines = lines_of(items, lang)
        with cf.ThreadPoolExecutor(6) as ex:
            pcms = list(ex.map(lambda l: speak(l[2], l[3]), lines))
        buf, t, timing = bytearray(b"\0\0" * (RATE // 2)), 0.5, []
        for n, ((i, k, _, _), pcm) in enumerate(zip(lines, pcms)):
            d = len(pcm) / 2 / RATE
            timing.append([k, round(t, 2), round(t + d, 2)])
            buf += pcm
            last = n + 1 == len(lines) or lines[n + 1][0] != i
            gap = GAP["end"] if last else GAP[k]
            buf += b"\0\0" * (RATE * gap // 1000)
            t += d + gap / 1000
        wav = os.path.join(CACHE, f"{level}-{lang}.wav")
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(bytes(buf))
        mp3 = os.path.join(OUT_AUDIO, f"{level}-{lang}.mp3")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wav, "-b:a", "48k", mp3], check=True)
        os.remove(wav)
        ver = hashlib.md5(open(mp3, "rb").read()).hexdigest()[:8]
        data["tracks"][lang] = {"src": f"grammar/{level}-{lang}.mp3?v={ver}", "duration": round(t, 1), "lines": timing}
        print(f"  {level} {lang}: {len(lines)} lines, {t / 60:.1f} min", flush=True)
    with open(os.path.join(OUT_DATA, f"{level}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def upload(level):
    for lang in ("zh", "en"):
        subprocess.run(["npx", "wrangler", "r2", "object", "put", f"jpnotes-audio/grammar/{level}-{lang}.mp3",
                        "--file", os.path.join(OUT_AUDIO, f"{level}-{lang}.mp3"), "--content-type", "audio/mpeg",
                        "--remote"], cwd=os.path.join(ROOT, "worker"), check=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for d in (CACHE, OUT_AUDIO, OUT_DATA):
        os.makedirs(d, exist_ok=True)
    for lv in args or ["n5", "n4", "n3", "n2", "n1"]:
        build(lv)
        if "--upload" in sys.argv:
            upload(lv)
