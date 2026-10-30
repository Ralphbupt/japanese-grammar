#!/usr/bin/env python3
"""Audio for listening items (docs/quiz-listening-spec.md §6) — Edge TTS trial version.

    python3 tools/choukai-audio.py N5            every N5 item (practice + mock) without audio
    python3 tools/choukai-audio.py N5 --only n5-ck-101,n5-ck-501

One mp3 per item, in test order:
  課題理解 / ポイント理解: scene, question, pause, the dialogue, pause, question again
  発話表現: scene, question, then 1 / 2 / 3 and the three replies
  即時応答: the line, then 1 / 2 / 3 and the three replies
Lines are spoken one by one, so the start and length of every segment is known
exactly; they go to audio/choukai/index.json with the script text the mp3 was
made from (build-quiz.js uses the audio only while that text still matches).
Mock tests use the same files; the page adds the answering pause after each item.

Edge has two Japanese voices: Nanami (women, and the narrator at a lower pitch)
and Keita (men). N5/N4 dialogue is slowed down. The Gemini version (§6) will
replace these files; ids and the manifest stay the same.
"""
import argparse, asyncio, hashlib, importlib.util, json, pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "audio" / "choukai"
INDEX = OUT / "index.json"

# build-audio.py patches edge-tts onto the endpoint that works from Japan and
# holds the misreading fixes (何時 …); reuse both.
_spec = importlib.util.spec_from_file_location("build_audio", ROOT / "build-audio.py")
build_audio = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(build_audio)
edge_tts = build_audio.edge_tts

SLOW = {"N5": "-12%", "N4": "-8%"}
VOICES = {  # speaker → (voice, pitch)
    "N": ("ja-JP-NanamiNeural", "-18Hz"),
    "F": ("ja-JP-NanamiNeural", "+0Hz"), "F1": ("ja-JP-NanamiNeural", "+0Hz"), "F2": ("ja-JP-NanamiNeural", "+25Hz"),
    "M": ("ja-JP-KeitaNeural", "+0Hz"), "M1": ("ja-JP-KeitaNeural", "+0Hz"), "M2": ("ja-JP-KeitaNeural", "-20Hz"),
}
NUMS = ["いち", "に", "さん", "よん"]
GAP = {"line": 0.45, "after_q": 1.5, "before_q2": 1.2, "opt": 0.9}


def say_text(t):
    # Keep the 分かち書き spaces: N5/N4 scripts are mostly kana, and without
    # them the voice can't tell the words apart (はしって → わしって, 先月 車 →
    # せんげつしゃ, topic は read as ha). 「……」 stays so it trails off.
    return build_audio.spoken(t)


def plan(q):
    """The item as a list of (kind, index, speaker, text) to speak, with pauses between."""
    out = []
    t = q["type"]
    if q.get("scene"): out.append(("scene", 0, "N", q["scene"]))
    if t in ("kadai", "point"):
        out.append(("q", 0, "N", q["question"]))
        out += [("line", i, s, txt) for i, (s, txt) in enumerate(q["lines"])]
        out.append(("q2", 0, "N", q["question"]))
    elif t == "hatsuwa":
        out.append(("q", 0, "N", q["question"]))
    else:
        out += [("line", i, s, txt) for i, (s, txt) in enumerate(q["lines"])]
    if t in ("hatsuwa", "sokuji"):
        for i, o in enumerate(q["options"]):
            out.append(("num", i, "N", NUMS[i]))
            out.append(("opt", i, q["respond"], o))
    return out


def source(q):
    """What the audio was made from; build-quiz.js compares it with the current script."""
    return {k: q.get(k) for k in ("scene", "question", "lines", "options", "respond") if q.get(k) is not None}


def pause_before(kind, prev):
    if prev is None: return 0
    if kind == "line" and prev in ("q", "scene"): return GAP["after_q"]
    if kind == "q2": return GAP["before_q2"]
    if kind == "num": return GAP["opt"]
    if kind == "opt": return 0.25
    return GAP["line"]


async def tts(text, speaker, rate, path):
    voice, pitch = VOICES[speaker]
    for attempt in range(3):
        try:
            await edge_tts.Communicate(say_text(text), voice, rate=rate, pitch=pitch).save(str(path))
            if path.stat().st_size > 1000: return
        except Exception as e:
            err = e
        await asyncio.sleep(2 + attempt * 3)
    raise RuntimeError(f"TTS failed for {text[:20]}: {err if 'err' in dir() else 'empty file'}")


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


async def make(q, level, sem):
    async with sem:
        rate = SLOW.get(level, "+0%")
        steps = plan(q)
        key = hashlib.sha1(json.dumps([source(q), rate, "edge-3"], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
        mp3 = OUT / f"c{key}.mp3"
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            parts = []
            for n, (kind, i, spk, text) in enumerate(steps):
                raw, p = tmp / f"{n:02d}.mp3", tmp / f"{n:02d}.wav"
                await tts(text, spk, "+0%" if spk == "N" and kind == "num" else rate, raw)
                # Edge pads each clip with ~0.7 s of silence; trim both ends so the pauses are ours.
                trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05"
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af",
                                f"{trim},areverse,{trim},areverse", "-ac", "1", "-ar", "24000", str(p)], check=True)
                parts.append(p)
            # Join with silences, all re-encoded to one format; record where each segment lands.
            segs, t, inputs, filt, prev = [], 0.0, [], [], None
            for n, ((kind, i, spk, text), p) in enumerate(zip(steps, parts)):
                gap = pause_before(kind, prev); prev = kind
                d = duration(p)
                t += gap
                segs.append({"k": kind, "i": i, "t": round(t, 2), "d": round(d, 2)})
                inputs += ["-i", str(p)]
                filt.append(f"aevalsrc=0:d={gap:.2f}:s=24000[s{n}];[{n}:a]aresample=24000,aformat=channel_layouts=mono[a{n}];")
                t += d
            chain = "".join(filt) + "".join(f"[s{n}][a{n}]" for n in range(len(parts))) + f"concat=n={2 * len(parts)}:v=0:a=1[out]"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", chain, "-map", "[out]",
                            "-ac", "1", "-ar", "24000", "-b:a", "48k", str(mp3)], check=True)
        return q["id"], {"file": mp3.name, "dur": round(t, 2), "segs": segs, "engine": "edge", "src": source(q)}


def items(level):
    base = ROOT / "questions" / level
    for d in [base] + sorted(x for x in base.glob("mock-*") if x.is_dir()):
        for f in sorted(d.glob("choukai-*.json")):
            yield from json.loads(f.read_text())


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("level")
    ap.add_argument("--only", default="")
    ap.add_argument("--redo", action="store_true", help="regenerate even if up to date")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    OUT.mkdir(parents=True, exist_ok=True)
    index = json.loads(INDEX.read_text()) if INDEX.exists() else {}
    todo = [q for q in items(a.level) if (not only or q["id"] in only)
            and (a.redo or q["id"] not in index or index[q["id"]]["src"] != source(q)
                 or not (OUT / index[q["id"]]["file"]).exists())]
    print(f"{len(todo)} to generate")
    sem = asyncio.Semaphore(6)
    done = 0
    for coro in asyncio.as_completed([make(q, a.level, sem) for q in todo]):
        try:
            qid, entry = await coro
        except Exception as e:
            print("  FAILED", e, file=sys.stderr); continue
        old = index.get(qid)
        if old and old["file"] != entry["file"] and (OUT / old["file"]).exists():
            (OUT / old["file"]).unlink()
        index[qid] = entry; done += 1
        if done % 10 == 0:
            print(f"  {done}/{len(todo)}", flush=True)
            INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=0, sort_keys=True) + "\n")
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=0, sort_keys=True) + "\n")
    print(f"done: {done}/{len(todo)}")


if __name__ == "__main__":
    asyncio.run(main())
