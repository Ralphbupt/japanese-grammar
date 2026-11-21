#!/usr/bin/env python3
"""Pick and check how each word of a vocabulary list is spoken (the "g" line of
tools/vocab-audio.py). Spoken as kana, TTS reads a leading は / へ as the
particles (はへん → "wa-en"); spoken as kanji it can pick the wrong reading
(辛い つらい / からい). So for every word try, in order, the kanji form, the
katakana reading and the hiragana reading; Gemini listens to each clip and
writes what it hears in hiragana; the first that matches the reading wins and
is stored as `say` in questions/vocab-list/src/{level}.json (vocab-audio.py
speaks `say`). Words where nothing matches are listed for a human.
Listening is multimodal work, so Gemini; clips cached like the TTS ones.
  python3 tools/vocab-audio-check.py n2
"""
import base64, concurrent.futures as cf, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile, wave

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ga", os.path.join(HERE, "grammar-audio.py"))
ga = importlib.util.module_from_spec(spec); spec.loader.exec_module(ga)
LISTEN = os.environ.get("LISTEN_MODEL", "gemini-3.8-flash")
# Said alone, an all-kanji word (討論, 破片, 違反) is often read as Chinese, and asked
# for "the hiragana" a listener transliterates that too — so ask the language first.
ASK = "One word is read aloud in this clip. Is it spoken in Japanese or in Chinese (Mandarin)? Answer with exactly one line: 'ja <hiragana>' if Japanese (its pronunciation in hiragana, standard kana spelling), or 'zh <pinyin>' if Chinese."


def hira(s):
    s = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)
    return re.sub(r"[^ぁ-ゖ]", "", s)


def loose(s):
    # ignore long-vowel spelling differences (おう/おお, えい/ええ, ー)
    s = hira(s)
    return re.sub(r"(?<=[おこそとのほもよろごぞどぼぽょ])[うお]|(?<=[えけせてねへめれげぜでべぺ])[いえ]", "", s)


def heard(text):
    key = hashlib.md5(f"{ga.TTS_MODEL}|{ga.VOICE['ja']}|{text}".encode()).hexdigest()[:16]
    out = os.path.join(ga.CACHE, key + ".word2")
    if os.path.exists(out):
        return open(out, encoding="utf-8").read()
    pcm = ga.speak(ga.VOICE["ja"], text)
    with tempfile.TemporaryDirectory() as t:
        w, m = os.path.join(t, "a.wav"), os.path.join(t, "a.mp3")
        with wave.open(w, "wb") as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(ga.RATE); f.writeframes(pcm)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", w, "-b:a", "64k", m], check=True)
        b = base64.b64encode(open(m, "rb").read()).decode()
    r = ga.post(LISTEN, {"contents": [{"parts": [{"text": ASK}, {"inlineData": {"mimeType": "audio/mpeg", "data": b}}]}]})
    txt = "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"]).strip()
    open(out, "w", encoding="utf-8").write(txt)
    return txt


def options(x):
    kata = "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in x["r"])
    w = x["w"] + "。"
    # all kanji: katakana first (no Chinese reading, no は read as "wa"); with kana: the written form first
    order = [kata + "。", x["r"] + "。", w] if re.fullmatch(r"[一-龯々ヶ]+", x["w"]) else [w, kata + "。", x["r"] + "。"]
    out = []
    for o in order:
        if o not in out:
            out.append(o)
    return out


def pick(x):
    for o in options(x):
        h = heard(o).strip()
        if not h.startswith("ja"):
            continue
        h = h[2:]
        if hira(h) == hira(x["r"]) or loose(h) == loose(x["r"]):
            return o, h
    return None, heard(options(x)[0])


if __name__ == "__main__":
    lv = (sys.argv[1:] or ["n2"])[0]
    p = os.path.join(ga.ROOT, "questions", "vocab-list", "src", f"{lv}.json")
    src = json.load(open(p, encoding="utf-8"))
    todo = [x for x in src if not x.get("skip") and x.get("ex")]
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(pick, todo))
    bad = []
    for x, (o, h) in zip(todo, res):
        if o:
            x["say"] = o
        else:
            x.pop("say", None)
            bad.append(f"{x['w']}\t{x['r']}\theard {h}")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(src, f, ensure_ascii=False, indent=1)
        f.write("\n")
    kinds = {"kanji": 0, "kata": 0, "hira": 0}
    for x in todo:
        s = x.get("say", "")
        kinds["kanji" if re.search(r"[一-龯々]", s) else "kata" if re.search(r"[ァ-ヶ]", s) else "hira"] += bool(s)
    print(f"{lv}: {len(todo) - len(bad)} ok {kinds}, {len(bad)} unresolved")
    print("\n".join(bad))
