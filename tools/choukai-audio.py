#!/usr/bin/env python3
"""Audio for listening items (docs/quiz-listening-spec.md §6).

    python3 tools/choukai-audio.py N5 --engine gemini   every N5 item (practice + mock) without Gemini audio
    python3 tools/choukai-audio.py N5 --only n5-ck-101,n5-ck-501
    python3 tools/choukai-audio.py N5 --engine edge     the free Edge TTS trial voices

One mp3 per item, in test order:
  課題理解 / ポイント理解: scene, question, pause, the dialogue, pause, question again
  発話表現: scene, question, then 1 / 2 / 3 and the three replies
  即時応答: the line, then 1 / 2 / 3 and the three replies
Lines are spoken one by one, so the start and length of every segment is known
exactly; they go to audio/choukai/index.json with the script text the mp3 was
made from (build-quiz.js uses the audio only while that text still matches).
Mock tests use the same files; the page adds the answering pause after each item.

Gemini (gemini-3.8-flash-tts; narrator Kore, women Leda, men Charon): the
dialogue is one multi-speaker request (at most 2 voices), the narrator's scene
and question one request, the three spoken replies one request; the numbers
いち/に/さん are made once and reused. Gemini gives no timings, so each request
is cut into its lines at the silences closest to where the lines should end
(by length); the cut clips are then joined with our own pauses like Edge's.
Quota is ~100 requests a day and 10 a minute: requests are spaced 6.5 s apart,
and the run stops cleanly when the day's quota is used up (rerun tomorrow; it
picks up where it stopped). `--model lite` (gemini-3.8-flash-lite-tts) has its
own quota and the same voices, a little quicker between turns; use one model
per level.

Edge has two Japanese voices: Nanami (women, and the narrator at a lower pitch)
and Keita (men). N5/N4 dialogue is slowed down.
"""
import argparse, asyncio, base64, hashlib, importlib.util, json, pathlib, re, subprocess, sys, tempfile, time, urllib.error, urllib.request

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

GEMINI_MODELS = {"flash": "gemini-3.8-flash-tts", "lite": "gemini-3.8-flash-lite-tts"}   # separate daily quotas, same voices
GEMINI_MODEL = GEMINI_MODELS["flash"]
GEMINI_VOICES = {"N": "Kore", "F": "Leda", "F1": "Leda", "F2": "Aoede", "M": "Charon", "M1": "Charon", "M2": "Puck"}
GEMINI_NAMES = {"N": "アナウンス", "F": "女", "F1": "女1", "F2": "女2", "M": "男", "M1": "男1", "M2": "男2"}
# N5/N4 must sound clearly slower than natural speech (spec §6: 3.4 / 3.8 chars a second).
GEMINI_STYLE = {"N5": "ゆっくり、はっきりと話す", "N4": "少しゆっくり、はっきりと話す", "N3": "落ち着いた自然な速さで、はっきりと話す",
                "N2": "自然な速さで話す", "N1": "自然な速さで話す"}
NARRATOR_STYLE = "落ち着いた試験のアナウンス。ゆっくり、はっきり"
CACHE = OUT / ".cache"   # the number clips; not committed
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
        # 概要理解 / 統合理解: the question only after the talk; a recording with
        # two questions reads 質問1 / 質問2 (their options are printed).
        if q.get("questions"):
            out += [("q", i, "N", f"質問{'一二三'[i]}。" + re.sub(r"^質問\s*[1-3１-３一二三][:：。、\s]*", "", p["question"]))
                    for i, p in enumerate(q["questions"])]
        elif t in ("gaiyou", "tougou"):
            out.append(("q", 0, "N", q["question"]))
    if t in ("hatsuwa", "sokuji") or spoken_after(q):
        for i, o in enumerate(q["options"]):
            out.append(("num", i, "N", NUMS[i]))
            out.append(("opt", i, q.get("respond", "N"), o))
    return out


def spoken_after(q):
    """概要理解 and 統合理解 1番: the narrator reads the options after the question."""
    return q["type"] in ("gaiyou", "tougou") and bool(q.get("spokenOptions")) and not q.get("questions")


def source(q):
    """What the audio was made from; build-quiz.js compares it with the current script."""
    src = {k: q.get(k) for k in ("scene", "question", "lines", "options", "respond") if q.get(k) is not None}
    if q.get("questions"): src["questions"] = [p["question"] for p in q["questions"]]
    if spoken_after(q): src["spoken"] = True
    return src


def pause_before(kind, prev):
    if prev is None: return 0
    if kind == "line" and prev in ("q", "scene"): return GAP["after_q"]
    if kind == "q2" or (kind == "q" and prev in ("line", "q")): return GAP["before_q2"]
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


def edge_clips(q, level, steps, tmp):
    rate = SLOW.get(level, "+0%")

    async def run():
        out = []
        for n, (kind, i, spk, text) in enumerate(steps):
            raw, p = tmp / f"{n:02d}.mp3", tmp / f"{n:02d}.wav"
            await tts(text, spk, "+0%" if spk == "N" and kind == "num" else rate, raw)
            trim_to(raw, p)
            out.append(p)
        return out
    return run()


def trim_to(src, dst, extra="", db=-45):
    """Both ends' silence off (Edge pads each clip with ~0.7 s), mono 24 kHz wav. Cut Gemini
    clips use a much lower threshold: a soft first syllable (the い of いいえ) is quieter than -45 dB."""
    trim = f"silenceremove=start_periods=1:start_threshold={db}dB:start_silence=0.05"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), *extra.split(), "-af",
                    f"{trim},areverse,{trim},areverse", "-ac", "1", "-ar", "24000", str(dst)], check=True)


class QuotaUsedUp(Exception):
    pass


_last_call = [0.0]
FRESH = False   # --fresh: ask again instead of reusing the cached response (a wrong voice, a garbled word)


def gemini(turns, out, level):
    """One request: turns = [(speaker, text)]; at most 2 distinct speakers. Writes the audio to `out`."""
    key = (pathlib.Path.home() / ".config/storyanim/gemini_key").read_text().strip()
    who = list(dict.fromkeys(s for s, _ in turns))
    style = NARRATOR_STYLE if who == ["N"] else GEMINI_STYLE.get(level)
    content = []
    for s_, t in turns:
        ann = {"type": "speech_metadata", "speaker": GEMINI_NAMES[s_]} if len(who) > 1 else {"type": "speech_metadata"}
        if style: ann["style"] = style
        content.append({"type": "text", "text": say_text(t), "annotations": [ann]})
    cfg = ({"speakers": [{"speaker": GEMINI_NAMES[w], "voice": GEMINI_VOICES[w]} for w in who]} if len(who) > 1
           else [{"voice": GEMINI_VOICES[who[0]]}])
    body = {"model": GEMINI_MODEL, "input": [{"type": "user_input", "content": content}],
            "response_format": {"type": "audio"}, "generation_config": {"speech_config": cfg}}
    # Every response is kept, so re-cutting or re-joining an item costs no quota.
    cached = CACHE / "raw" / (hashlib.sha1(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16] + ".wav")
    if cached.exists() and not FRESH:
        out.write_bytes(cached.read_bytes()); return
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key})
    for attempt in range(4):
        time.sleep(max(0, _last_call[0] + 6.5 - time.time()))   # 10 requests a minute
        _last_call[0] = time.time()
        try:
            resp = json.load(urllib.request.urlopen(req, timeout=180))
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code == 429 and ("day" in msg.lower() or "PerDay" in msg):
                raise QuotaUsedUp(msg)
            if e.code not in (429, 500, 503) or attempt == 3:
                raise RuntimeError(f"Gemini HTTP {e.code}: {msg}")
            time.sleep(20 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 3: raise RuntimeError(f"Gemini: {e}")
    data = find_audio(resp)
    if not data: raise RuntimeError("no audio in response")
    out.write_bytes(base64.b64decode(data))
    cached.parent.mkdir(parents=True, exist_ok=True); cached.write_bytes(out.read_bytes())


def find_audio(obj):
    if isinstance(obj, dict):
        if obj.get("type") == "audio" and isinstance(obj.get("data"), str): return obj["data"]
        obj = list(obj.values())
    if isinstance(obj, list):
        for v in obj:
            r = find_audio(v)
            if r: return r
    return None


def silences(path):
    r = subprocess.run(["ffmpeg", "-i", str(path), "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return list(zip(starts, ends))


def split(path, texts, tmp, tag):
    """Cut one Gemini clip into len(texts) clips at the silences nearest to where
    each text should end, judged by its length."""
    if len(texts) == 1:
        p = tmp / f"{tag}-0.wav"; trim_to(path, p, db=-62); return [p]
    total = duration(path)
    sil = [(a, b) for a, b in silences(path) if a > 0.2 and b < total - 0.2]
    cuts = aligned_cuts(path, texts, sil, tmp, tag)
    if cuts: return cut_at(path, cuts, total, len(texts), tmp, tag)
    w = [max(2, len(re.sub(r"[\s　、。？！?!…「」]", "", t))) for t in texts]
    exp = [sum(w[:k + 1]) / sum(w) * total for k in range(len(texts) - 1)]
    need = len(exp)
    if len(sil) < need: raise RuntimeError(f"{tag}: {len(sil)} pauses for {need} cuts")
    # DP: choose `need` silences in order, each near its expected cut, longer silences preferred.
    INF = float("inf")
    cost = lambda j, k: abs((sil[j][0] + sil[j][1]) / 2 - exp[k]) - 1.5 * min(sil[j][1] - sil[j][0], 0.8)
    best = [[INF] * len(sil) for _ in range(need)]; back = [[-1] * len(sil) for _ in range(need)]
    for j in range(len(sil)): best[0][j] = cost(j, 0)
    for k in range(1, need):
        for j in range(k, len(sil)):
            m = min(range(k - 1, j), key=lambda x: best[k - 1][x])
            best[k][j] = best[k - 1][m] + cost(j, k); back[k][j] = m
    j = min(range(need - 1, len(sil)), key=lambda x: best[need - 1][x]); picks = []
    for k in range(need - 1, -1, -1):
        picks.append(j); j = back[k][j]
    cuts = [(sil[j][0] + sil[j][1]) / 2 for j in reversed(picks)]
    print(f"    {tag}: cut by pauses only (no alignment)", flush=True)
    return cut_at(path, cuts, total, len(texts), tmp, tag)


def cut_at(path, cuts, total, n_parts, tmp, tag):
    bounds = [0.0] + cuts + [total]
    out = []
    for n in range(n_parts):
        p = tmp / f"{tag}-{n}.wav"
        trim_to(path, p, f"-ss {bounds[n]:.3f} -to {bounds[n + 1]:.3f}", db=-62)
        out.append(p)
    return out


# Whisper with word timings (tools/choukai-align.py) runs in the venv that has mlx_whisper.
ALIGN_PY = pathlib.Path.home() / "media/replaceable/.venv/bin/python"


def aligned_cuts(path, texts, sil, tmp, tag):
    """Each line's end from Whisper, moved to the pause it falls in or next to. None if that fails."""
    if not ALIGN_PY.exists(): return None
    lf = tmp / f"{tag}-lines.json"; lf.write_text(json.dumps(texts, ensure_ascii=False))
    r = subprocess.run([str(ALIGN_PY), str(ROOT / "tools/choukai-align.py"), str(path), str(lf)], capture_output=True, text=True)
    try:
        times = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return None
    if any(t is None for t in times): return None
    cuts = []
    for t in times:
        # The pause right after the line's last word (Whisper's word ends run a little early or late).
        # The longest one, not the first: a short gap inside the next line's first word (い|いえ) is not the end.
        near = [s for s in sil if s[1] >= t - 0.25 and s[0] <= t + 0.8]
        c = sum(max(near, key=lambda s: s[1] - s[0])) / 2 if near else t
        if cuts and c <= cuts[-1]: return None
        cuts.append(c)
    return cuts


def gemini_numbers(level, tmp):
    """いち / に / さん / よん in the narrator's voice, one request each (a single mora can't be
    cut reliably out of a longer clip); made once and reused for every item."""
    CACHE.mkdir(exist_ok=True)
    files = [CACHE / f"num-{GEMINI_VOICES['N']}-{i}.wav" for i in range(len(NUMS))]
    for n, f in zip(NUMS, files):
        if not f.exists():
            raw = tmp / f"num-{n}.wav"
            gemini([("N", n + "。")], raw, level)
            trim_to(raw, f)
    return files


def gemini_clips(q, level, steps, tmp):
    """Clips for `steps` (see plan()) from as few requests as possible."""
    clip = {}
    t = q["type"]
    # The narrator's part in one request: scene, question(s), and options it reads out.
    nar = [(("scene", 0) if k == "scene" else (k, i), x) for k, i, s, x in steps if s == "N" and k in ("scene", "q", "opt")]
    if nar:
        raw = tmp / "nar.wav"; gemini([("N", x) for _, x in nar], raw, level)
        for (k, _), p in zip(nar, split(raw, [x for _, x in nar], tmp, "nar")): clip[k] = p
        if ("q", 0) in clip: clip["q2"] = clip[("q", 0)]
    if t in ("kadai", "point", "sokuji", "gaiyou", "tougou"):
        lines = list(q["lines"])
        # 即時応答's replies are their own one-voice request (as in 発話表現): asked together with the
        # line, the model now and then gave a reply the other speaker's voice.
        turns = lines
        # At most 2 voices per request: a 3-person talk goes in runs of lines with 2 speakers each.
        runs, cur = [], []
        for s_, x in turns:
            if len({w for w, _ in cur} | {s_}) > 2: runs.append(cur); cur = []
            cur.append((s_, x))
        runs.append(cur)
        parts = []
        for n, run in enumerate(runs):
            raw = tmp / f"dlg{n}.wav"; gemini(run, raw, level)
            parts += split(raw, [x for _, x in run], tmp, f"dlg{n}")
        for i in range(len(lines)): clip[("line", i)] = parts[i]
    if t in ("hatsuwa", "sokuji"):
        raw = tmp / "opts.wav"; gemini([(q["respond"], o) for o in q["options"]], raw, level)
        for i, p in enumerate(split(raw, q["options"], tmp, "opts")): clip[("opt", i)] = p
    if t in ("hatsuwa", "sokuji") or spoken_after(q):
        for i, f in enumerate(gemini_numbers(level, tmp)): clip[("num", i)] = f
    return [clip.get((k, i), clip.get(k)) for k, i, _, _ in steps]


async def make(q, level, sem, engine):
    async with sem:
        steps = plan(q)
        tag = [engine, SLOW.get(level) if engine == "edge" else GEMINI_STYLE.get(level), "v3"]
        if engine == "gemini" and GEMINI_MODEL != GEMINI_MODELS["flash"]: tag.append(GEMINI_MODEL)
        key = hashlib.sha1(json.dumps([source(q), tag], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
        mp3 = OUT / f"c{key}.mp3"
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            if engine == "edge":
                parts = await edge_clips(q, level, steps, tmp)
            else:
                parts = await asyncio.to_thread(gemini_clips, q, level, steps, tmp)
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
        return q["id"], {"file": mp3.name, "dur": round(t, 2), "segs": segs, "engine": engine, "src": source(q),
                         **({"model": GEMINI_MODEL} if engine == "gemini" else {})}


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
    ap.add_argument("--engine", choices=["gemini", "edge"], default="gemini")
    ap.add_argument("--model", choices=list(GEMINI_MODELS), default="flash",
                    help="Gemini TTS model; keep one model per level so the voices match")
    ap.add_argument("--fresh", action="store_true", help="Gemini: new requests, not the cached responses (with --only)")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    global FRESH, GEMINI_MODEL; FRESH = a.fresh; GEMINI_MODEL = GEMINI_MODELS[a.model]
    OUT.mkdir(parents=True, exist_ok=True)
    index = json.loads(INDEX.read_text()) if INDEX.exists() else {}
    todo = [q for q in items(a.level) if (not only or q["id"] in only)
            and (a.redo or q["id"] not in index or index[q["id"]]["src"] != source(q)
                 or index[q["id"]].get("engine") != a.engine or not (OUT / index[q["id"]]["file"]).exists())]
    print(f"{len(todo)} to generate")
    sem = asyncio.Semaphore(6 if a.engine == "edge" else 1)   # Gemini: one request at a time (rate limit)
    done = 0
    for coro in asyncio.as_completed([make(q, a.level, sem, a.engine) for q in todo]):
        try:
            qid, entry = await coro
        except QuotaUsedUp:
            print("  Gemini quota for today is used up; rerun tomorrow to continue.", flush=True)
            break
        except Exception as e:
            print("  FAILED", e, file=sys.stderr, flush=True); continue
        # Re-read the manifest before each write, so runs for two levels at once (flash + lite) keep each other's entries.
        index = json.loads(INDEX.read_text()) if INDEX.exists() else {}
        old = index.get(qid)
        if old and old["file"] != entry["file"] and (OUT / old["file"]).exists():
            (OUT / old["file"]).unlink()
        index[qid] = entry; done += 1
        print(f"  {qid} ok ({done}/{len(todo)})", flush=True)
        INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=0, sort_keys=True) + "\n")
    print(f"done: {done}/{len(todo)}")


if __name__ == "__main__":
    asyncio.run(main())
