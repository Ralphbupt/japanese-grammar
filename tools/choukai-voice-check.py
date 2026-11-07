#!/usr/bin/env python3
"""Ask Gemini, segment by segment, whether each line of a listening item is in
a male or female voice, and compare with the script (M/F speakers, `respond`
for spoken options). Use it to confirm what tools/choukai-pitch.py flags: its
F0 rule misfires on rising questions and very short lines.

    python3 tools/choukai-voice-check.py n2-m2-ck-101 n2-m2-ck-501 …

Prints one line per segment; MISMATCH marks a real swap (then regenerate:
tools/choukai-audio.py LEVEL --only ID --redo --fresh).
"""
import base64, json, pathlib, subprocess, sys, tempfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
TMP = pathlib.Path(tempfile.mkdtemp(prefix="voice-check-"))
KEY = (pathlib.Path.home() / ".config/storyanim/gemini_key").read_text().strip()
MODEL = "gemini-3.8-flash"


def check(qid, e):
    src, parts, labels = e["src"], [{"text": "Japanese audio clips follow, each labelled. For each clip say male or female voice. Reply as JSON {label: 'male'|'female'}."}], []
    for s in e["segs"]:
        if s["k"] not in ("line", "opt"):
            continue
        lab = f'{s["k"]}{s["i"]}'
        out = TMP / f"{qid}-{lab}.mp3"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(s["t"]), "-t", str(s["d"]), "-i", str(ROOT / "audio/choukai" / e["file"]), str(out)], check=True)
        parts += [{"text": lab}, {"inline_data": {"mime_type": "audio/mp3", "data": base64.b64encode(out.read_bytes()).decode()}}]
        labels.append(lab)
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps({"contents": [{"parts": parts}], "generationConfig": {"responseMimeType": "application/json"}}).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
    got = json.loads(json.load(urllib.request.urlopen(req, timeout=180))["candidates"][0]["content"]["parts"][-1]["text"])
    want = {f"line{i}": l[0] for i, l in enumerate(src.get("lines", []))}
    for i, _ in enumerate(src.get("options", [])):
        want[f"opt{i}"] = src.get("respond", "?")
    bad = 0
    print(qid)
    for lab in labels:
        w, g = want.get(lab, "?"), str(got.get(lab))
        ok = w[:1] == ("M" if g.startswith("male") else "F")
        bad += not ok
        print(f"   {lab:6} script {w:3} heard {g}{'' if ok else '   <-- MISMATCH'}")
    return bad


def main():
    index = json.loads((ROOT / "audio/choukai/index.json").read_text())
    bad = sum(check(q, index[q]) for q in sys.argv[1:])
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
