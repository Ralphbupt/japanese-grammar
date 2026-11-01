#!/usr/bin/env python3
"""Listen to every listening mp3 against its script (docs/quiz-listening-spec.md §7 step 5).

    python3 tools/choukai-audio-check.py N5                 every item in audio/choukai/index.json for N5
    python3 tools/choukai-audio-check.py N5 --only n5-ck-101

A listening model gets the mp3 and the script and reports words read with the
wrong reading (何時 → いつ), words skipped or added, and a speaker in the wrong
voice. Prints only items with problems; results also go to
audio/choukai/check-{level}.json (not committed) so a rerun can skip clean items.
Fix a misreading with a TTS_READINGS rule in build-audio.py (or kana in the
script), then regenerate that item with tools/choukai-audio.py --only … --redo.
"""
import argparse, base64, json, pathlib, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio" / "choukai"
KEY = (pathlib.Path.home() / ".config/storyanim/gemini_key").read_text().strip()
MODEL = "gemini-3.8-flash"
WHO = {"N": "narrator", "M": "man", "M1": "man 1", "M2": "man 2", "F": "woman", "F1": "woman 1", "F2": "woman 2"}


def script(src):
    out = []
    if src.get("scene"): out.append(f"narrator: {src['scene']}")
    if src.get("question"): out.append(f"narrator: {src['question']}")
    out += [f"{WHO.get(s, s)}: {t}" for s, t in src.get("lines", [])]
    if src.get("respond"):
        out += [f"narrator: {n} / {WHO[src['respond']]}: {o}" for n, o in zip(["いち", "に", "さん", "よん"], src["options"])]
    return "\n".join(out).replace(" ", "").replace("　", "")


def check(qid, entry):
    audio = base64.b64encode((AUDIO / entry["file"]).read_bytes()).decode()
    prompt = ("This mp3 is a Japanese listening-test item read by text-to-speech. The script is below (the narrator may "
              "say the question twice). Listen carefully and report ONLY real problems: a word read with a wrong reading "
              "(e.g. 何時 read as いつ, 一日 as いちにち where ついたち is meant, a number or date read wrongly), words "
              "skipped, added or garbled, or a line spoken by the wrong kind of voice (a woman's line in a man's voice). "
              "Ignore small pitch-accent or intonation differences.\n\nScript:\n" + script(entry["src"])
              + '\n\nReply JSON {"ok": true|false, "issues": [{"text": "word as written", "heard": "what was said", "note": "..."}]}')
    body = {"contents": [{"parts": [{"inlineData": {"mimeType": "audio/mpeg", "data": audio}}, {"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json"}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
    for wait in (0, 10, 30, 60):
        time.sleep(wait)
        try:
            r = json.load(urllib.request.urlopen(req, timeout=180))
            return qid, json.loads(r["candidates"][0]["content"]["parts"][0]["text"])
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
            err = e
    return qid, {"ok": False, "issues": [{"note": f"check failed: {err}"}]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("level")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    index = json.loads((AUDIO / "index.json").read_text())
    out_f = AUDIO / f"check-{a.level}.json"
    done = json.loads(out_f.read_text()) if out_f.exists() else {}
    todo = {k: v for k, v in index.items() if k.startswith(a.level.lower() + "-") and (not only or k in only)
            and not (done.get(k, {}).get("file") == v["file"] and done[k].get("ok"))}
    print(f"{len(todo)} to check", flush=True)
    with ThreadPoolExecutor(4) as pool:
        for qid, res in pool.map(lambda kv: check(*kv), todo.items()):
            done[qid] = {"file": index[qid]["file"], **res}
            if not res.get("ok"):
                print(qid, json.dumps(res.get("issues"), ensure_ascii=False), flush=True)
            out_f.write_text(json.dumps(done, ensure_ascii=False, indent=1) + "\n")
    bad = [k for k in todo if not done[k].get("ok")]
    print(f"{len(todo) - len(bad)} ok, {len(bad)} with issues")


if __name__ == "__main__":
    main()
