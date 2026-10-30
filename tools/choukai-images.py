#!/usr/bin/env python3
"""Pictures for listening items (docs/quiz-listening-spec.md §9).

    python3 tools/choukai-images.py N5            every N5 item (practice + mock) missing a picture
    python3 tools/choukai-images.py N5 --only n5-ck-211,n5-ck-401
    python3 tools/choukai-images.py N5 --dry-run  list what would be drawn

Two kinds of picture:

- `optionImages` (4 picture options): one Gemini call draws all four as a row
  of panels, so the person/object looks the same in each and only the tested
  detail changes; the row is cut into images/choukai/o{key}-1..4.webp.
- `picture` (発話表現): one scene, images/choukai/s{key}.webp, plus
  s{key}.json with the box of the person the arrow points at (the page draws
  the arrow, so it always points at the right person).

Every picture is checked by a second model that looks at it against the
descriptions; a mismatch is redrawn (up to 3 tries) and reported if it never
passes. {key} is a hash of the descriptions, so editing a description draws a
new picture and leaves the old file unused. Incremental: existing files are skipped.
Key: ~/.config/storyanim/gemini_key.
"""
import argparse, base64, hashlib, io, json, pathlib, sys, time, urllib.request, urllib.error
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "images" / "choukai"
DEBUG = ROOT / "images" / "choukai-debug"   # strips that couldn't be cut; not committed
# id → the files and the descriptions they were drawn from; build-quiz.js uses a
# picture only while its description still matches.
INDEX = OUT / "index.json"
KEY = (pathlib.Path.home() / ".config/storyanim/gemini_key").read_text().strip()
DRAW_MODEL = "gemini-3.1-flash-image"
CHECK_MODEL = "gemini-3.8-flash"
STYLE = ("Black-and-white line illustration in the style of a Japanese language-test booklet: clean even ink outlines, "
         "no shading or only light flat grey, white background, simple friendly figures, no text, no letters, "
         "no numbers, no logos, no speech bubbles.")
WIDTH = 480  # px per option picture; scenes 720


def api(model, body):
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
    for wait in (0, 10, 30, 60):
        time.sleep(wait)
        try:
            return json.load(urllib.request.urlopen(req, timeout=180))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 503):
                raise SystemExit(f"{model}: HTTP {e.code} {e.read()[:300]!r}")
            print(f"  {model}: HTTP {e.code}, retrying", flush=True)
        except (TimeoutError, urllib.error.URLError) as e:
            print(f"  {model}: {e}, retrying", flush=True)
    raise SystemExit(f"{model}: still failing after retries")


def draw(prompt):
    r = api(DRAW_MODEL, {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseModalities": ["IMAGE"]}})
    for p in r["candidates"][0]["content"]["parts"]:
        if "inlineData" in p:
            return Image.open(io.BytesIO(base64.b64decode(p["inlineData"]["data"]))).convert("L")
    raise RuntimeError("no image returned")


def look(images, question):
    """Ask the checking model about one or more images; returns parsed JSON."""
    parts = []
    for im in images:
        buf = io.BytesIO(); im.save(buf, "PNG")
        parts.append({"inlineData": {"mimeType": "image/png", "data": base64.b64encode(buf.getvalue()).decode()}})
    parts.append({"text": question})
    r = api(CHECK_MODEL, {"contents": [{"parts": parts}], "generationConfig": {"responseMimeType": "application/json"}})
    return json.loads(r["candidates"][0]["content"]["parts"][0]["text"])


def bands(values, min_gap):
    """Runs of True in `values` separated by at least `min_gap` Falses → [(start, end)]."""
    out, start, gap = [], None, 0
    for i, v in enumerate(values + [False] * (min_gap + 1)):
        if v:
            if start is None: start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap > min_gap:
                out.append((start, i - gap + 1)); start = None
    return out


def framed(img, y0, y1):
    """Panels in one row found by their frames: long vertical lines, paired left/right.
    Works even when something (a guitar neck) sticks out across the gap between frames."""
    px = img.load(); w = img.size[0]
    tall = [sum(px[x, y] < 128 for y in range(y0, y1, 2)) / ((y1 - y0) / 2) > 0.7 for x in range(w)]
    # Frame lines are thin; a wide dark run is a black shirt or a door, not a frame.
    lines = [(a + b) // 2 for a, b in bands(tall, 2) if b - a <= 8]
    if len(lines) < 2 or len(lines) % 2: return None
    return [img.crop((lines[i], y0, lines[i + 1] + 1, y1)) for i in range(0, len(lines), 2)]


def panels(img):
    """Cut a picture of separate panels (a row, or 2x2) into panels in reading order."""
    px = img.load(); w, h = img.size
    ink = lambda x, y: px[x, y] < 200
    rows = bands([any(ink(x, y) for x in range(0, w, 2)) for y in range(h)], h // 60)
    out = []
    for y0, y1 in rows:
        if y1 - y0 < h // 8: continue
        by_frame = framed(img, y0, y1)
        if by_frame and all(p.size[0] > w // 12 for p in by_frame):
            out += by_frame; continue
        cols = bands([any(ink(x, y) for y in range(y0, y1, 2)) for x in range(w)], w // 80)
        out += [img.crop((x0, y0, x1, y1)) for x0, x1 in cols if x1 - x0 > w // 12]
    return out


def save(im, path, width):
    im = im.copy(); im.thumbnail((width, width * 2))
    im.save(path, "WEBP", quality=80)


def key_of(obj):
    return hashlib.sha1(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]


def option_pictures(q):
    descs = [d.replace("Simple black-and-white line drawing, no text. ", "") for d in q["optionImages"]]
    key = key_of(descs)
    files = [OUT / f"o{key}-{i + 1}.webp" for i in range(4)]
    if all(f.exists() for f in files): return key, None
    prompt = (STYLE + " Exactly FOUR panels in total, in ONE single horizontal row (never two rows), each with a thin rectangular frame "
              "and exactly one subject per panel (one person, one object or one place — never two of the same thing). "
              "Panels side by side, left to right, "
              "and clear white space between frames. Draw the SAME character/object design in every panel; the panels "
              "differ ONLY in the details described. "
              + " ".join(f"Panel {i + 1}: {d}" for i, d in enumerate(descs)))
    problem = None
    for attempt in range(3):
        strip = draw(prompt)
        cut = panels(strip)
        if len(cut) != 4:
            problem = f"got {len(cut)} panels"
            DEBUG.mkdir(exist_ok=True); strip.save(DEBUG / f"{q['id']}-{attempt + 1}.png")
            continue
        verdict = look(cut, "These are four answer pictures of a listening test, in order 1–4. Intended content:\n"
                       + "\n".join(f"{i + 1}. {d}" for i, d in enumerate(descs))
                       + "\nCheck each picture against its description, above all the details that tell the four apart. "
                         "Also fail it if there is any text/letters, or if the pictures differ in some other obvious way "
                         "that a test taker could confuse with the tested detail. "
                         'Reply JSON {"ok": true|false, "problems": "..."}')
        if verdict.get("ok"):
            for im, f in zip(cut, files): save(im, f, WIDTH)
            return key, None
        problem = verdict.get("problems")
    return key, problem


def scene_picture(q):
    pic = q["picture"]
    key = key_of(pic)
    img_f, box_f = OUT / f"s{key}.webp", OUT / f"s{key}.json"
    if img_f.exists() and box_f.exists(): return key, None
    prompt = (STYLE + " A single scene, landscape 4:3, no frame. " + pic["desc"]
              + " Do not draw any arrow or marker; the people must be clearly separate.")
    problem = None
    for attempt in range(3):
        im = draw(prompt)
        verdict = look([im], f"Scene description: {pic['desc']}\nThe test will point an arrow at: {pic['arrow']}.\n"
                       "Does the picture match the description (people, what they are doing, the setting) with no text in it, "
                       "and is that person clearly identifiable? Give that person's bounding box as box_2d "
                       "[ymin, xmin, ymax, xmax], normalised 0–1000. "
                       'Reply JSON {"ok": true|false, "problems": "...", "box_2d": [..]}')
        if verdict.get("ok") and len(verdict.get("box_2d") or []) == 4:
            save(im, img_f, 720)
            box_f.write_text(json.dumps({"box": verdict["box_2d"]}) + "\n")
            return key, None
        problem = verdict.get("problems") or "no box"
    return key, problem


def items(level):
    base = ROOT / "questions" / level
    dirs = [base] + sorted(d for d in base.glob("mock-*") if d.is_dir())
    for d in dirs:
        for f in sorted(d.glob("choukai-*.json")):
            yield from json.loads(f.read_text())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("level")
    ap.add_argument("--only", default="")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    OUT.mkdir(parents=True, exist_ok=True)
    todo = [q for q in items(a.level) if (q.get("optionImages") or q.get("picture")) and (not only or q["id"] in only)]
    failed = []
    index = json.loads(INDEX.read_text()) if INDEX.exists() else {}
    for q in todo:
        kind = "options" if q.get("optionImages") else "scene"
        if a.dry_run:
            print(q["id"], kind); continue
        key, problem = (option_pictures if kind == "options" else scene_picture)(q)
        print(f"{q['id']} {kind} {key}: {'FAILED — ' + problem if problem else 'ok'}", flush=True)
        if problem: failed.append(q["id"]); continue
        if kind == "options":
            index[q["id"]] = {"opts": [f"o{key}-{i + 1}.webp" for i in range(4)], "src": q["optionImages"]}
        else:
            index[q["id"]] = {"scene": f"s{key}.webp", "box": json.loads((OUT / f"s{key}.json").read_text())["box"], "src": q["picture"]}
        INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=0, sort_keys=True) + "\n")
    if failed:
        print("not drawn (fix the description or retry):", ",".join(failed)); sys.exit(1)


if __name__ == "__main__":
    main()
