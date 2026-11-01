#!/usr/bin/env python3
"""Catch a line spoken in the wrong voice: median pitch of every segment vs the scripted speaker's sex.

    ~/media/replaceable/.venv/bin/python tools/choukai-pitch.py N2 [id,id]   (needs librosa)

Gemini TTS now and then gives a line the other speaker's voice; the listening check
(choukai-audio-check.py) misses some of them. Flags men above 165 Hz and women below
150 Hz; ! marks clear cases (men above 195, women below 130) — excited men reach 180,
so look again at the rest. Redo a flagged item with choukai-audio.py --only … --redo --fresh.
"""
import sys, json, glob, pathlib, numpy as np, librosa
ROOT = pathlib.Path(__file__).resolve().parent.parent
lvl = sys.argv[1]; only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
qs = {}
for f in glob.glob(f"{ROOT}/questions/{lvl}/**/choukai-*.json", recursive=True):
    for q in json.load(open(f)): qs[q["id"]] = q
idx = json.load(open(ROOT / "audio/choukai/index.json"))
bad = 0
for qid, e in sorted(idx.items()):
    if qid not in qs or (only and qid not in only) or e.get("engine") != "gemini": continue
    q = qs[qid]
    y, sr = librosa.load(ROOT / "audio/choukai" / e["file"], sr=16000)
    out = []
    for s in e["segs"]:
        if s["k"] == "line": spk = q["lines"][s["i"]][0]
        elif s["k"] == "opt": spk = q.get("respond") or "N"
        else: continue
        a = y[int(s["t"] * sr): int((s["t"] + s["d"]) * sr)]
        f0, v, _ = librosa.pyin(a, fmin=60, fmax=400, sr=sr)
        f0 = f0[~np.isnan(f0)]
        if len(f0) < 5: continue
        m = float(np.median(f0)); male = spk.startswith("M")
        if (male and m > 165) or (not male and m < 150):
            clear = (male and m > 195) or (not male and m < 130)
            out.append(f"{'!' if clear else ''}{s['k']}{s['i']}:{spk}={m:.0f}Hz")
    if out: bad += 1; print(qid, " ".join(out), flush=True)
print("items flagged:", bad)
