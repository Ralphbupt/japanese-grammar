#!/usr/bin/env python3
"""Check the Japanese lines of the grammar audio (tools/grammar-audio.py) for
misreadings: transcribe each cached clip with Gemini and compare its reading
(kana, via pykakasi) with the script's. Prints lines below the threshold.

  ~/japanese-daily-news/.venv/bin/python tools/grammar-audio-check.py [n5 …]
"""
import base64, concurrent.futures as cf, difflib, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ga", os.path.join(HERE, "grammar-audio.py"))
ga = importlib.util.module_from_spec(spec); spec.loader.exec_module(ga)
import pykakasi
kk = pykakasi.kakasi()
ASR = "gemini-3.5-transcribe"
MIN = float(os.environ.get("MIN_MATCH", "0.88"))


def kana(s):
    return re.sub(r"[^ぁ-んー0-9a-z]", "", "".join(w["hira"] for w in kk.convert(s)).lower())


def asr(text):
    key = hashlib.md5(f"{ga.TTS_MODEL}|{ga.VOICE['ja']}|{text}".encode()).hexdigest()[:16]
    out = os.path.join(ga.CACHE, key + ".asr")
    if os.path.exists(out):
        return open(out, encoding="utf-8").read()
    pcm = ga.speak(ga.VOICE["ja"], text)
    with tempfile.TemporaryDirectory() as t:
        import wave
        w = os.path.join(t, "a.wav"); m = os.path.join(t, "a.mp3")
        with wave.open(w, "wb") as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(ga.RATE); f.writeframes(pcm)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", w, "-b:a", "64k", m], check=True)
        b = base64.b64encode(open(m, "rb").read()).decode()
    r = ga.post(ASR, {"contents": [{"parts": [{"inlineData": {"mimeType": "audio/mpeg", "data": b}}]}]})
    txt = "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])
    open(out, "w", encoding="utf-8").write(txt)
    return txt


if __name__ == "__main__":
    bad = 0
    for lv in sys.argv[1:] or ["n5", "n4", "n3", "n2", "n1"]:
        items = ga.items_of(lv)
        lines = [(items[i]["key"], t) for i, k, v, t in ga.lines_of(items, "zh") if k == "e"]
        with cf.ThreadPoolExecutor(6) as ex:
            heard = list(ex.map(lambda l: asr(l[1]), lines))
        for (key, text), h in zip(lines, heard):
            r = difflib.SequenceMatcher(None, kana(text), kana(h)).ratio()
            if r < MIN:
                bad += 1
                print(f"{lv} {r:.2f} {key}\n   script: {text}\n   heard:  {h.strip()}")
        print(f"{lv}: {len(lines)} examples checked", flush=True)
    print("flagged", bad)
