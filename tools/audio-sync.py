#!/usr/bin/env python3
"""Upload audio/ to the R2 bucket behind https://audio.jpnotes.dev.

    python3 tools/audio-sync.py            upload what is new or changed
    python3 tools/audio-sync.py --dry      only say what would be uploaded
    python3 tools/audio-sync.py --tracked  only files git tracks (leave out unshipped drafts)

Keys mirror the folder: audio/s….mp3 → s….mp3, audio/choukai/c….mp3 →
choukai/c….mp3. A file is sent when the bucket has no object of that name or
its MD5 differs (a re-recorded listening item keeps its name). Run it after
build-audio.py / tools/choukai-audio.py and BEFORE pushing: pages only point
at audio that is already in the bucket.

Uses wrangler's login (run `npx wrangler login` in worker/ if it has expired).
The Cloudflare API allows 1,200 calls per 5 minutes, so a full upload of
~6,700 files takes about half an hour; a normal run sends a handful.
"""
import argparse, concurrent.futures as cf, hashlib, json, re, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"
BUCKET = "jpnotes-audio"
API = "https://api.cloudflare.com/client/v4"
# Sentence audio is named by a hash of its text and never changes; a listening
# item can be re-recorded under the same name, so it is cached for a day only.
CACHE_FOREVER = "public, max-age=31536000, immutable"
CACHE_DAY = "public, max-age=86400"


_tok = {"value": None, "at": 0}
_tok_lock = threading.Lock()


def token(stale=None):
    """wrangler's OAuth token. It lasts about an hour and any other wrangler run
    replaces it, so a 401 comes back here with the token that failed."""
    with _tok_lock:
        if _tok["value"] and _tok["value"] != stale:
            return _tok["value"]
        subprocess.run(["npx", "wrangler", "whoami"], cwd=ROOT / "worker", capture_output=True, timeout=90)   # refreshes it
        conf = (Path.home() / "Library/Preferences/.wrangler/config/default.toml").read_text()
        _tok["value"] = re.search(r'oauth_token\s*=\s*"([^"]+)"', conf).group(1)
        return _tok["value"]


def call(method, path, tok, data=None, headers=None):
    for attempt in range(8):
        req = urllib.request.Request(API + path, data=data, method=method, headers={"Authorization": "Bearer " + tok, "User-Agent": "jpnotes-audio-sync", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 401 and attempt < 3:
                tok = token(stale=tok)
                continue
            if e.code in (429, 500, 502, 503, 504) and attempt < 7:
                time.sleep(20 if e.code == 429 else 3 * (attempt + 1))
                continue
            raise RuntimeError(f"{method} {path}: HTTP {e.code} {e.read()[:300]!r}")
        except (urllib.error.URLError, TimeoutError):
            if attempt == 7:
                raise
            time.sleep(3 * (attempt + 1))


def remote(tok, account):
    have, cursor = {}, None
    while True:
        q = "?per_page=1000" + ("&cursor=" + urllib.parse.quote(cursor) if cursor else "")
        res = call("GET", f"/accounts/{account}/r2/buckets/{BUCKET}/objects{q}", tok)
        for o in res.get("result") or []:
            have[o["key"]] = o.get("etag", "").strip('"')
        info = res.get("result_info") or {}
        cursor = info.get("cursor")
        if not cursor or not info.get("is_truncated"):
            return have


def local(tracked):
    if tracked:
        names = subprocess.run(["git", "ls-files", "audio"], cwd=ROOT, capture_output=True, text=True).stdout.split()
        files = [ROOT / n for n in names if n.endswith(".mp3")]
    else:
        files = [p for p in AUDIO.rglob("*.mp3") if not any(part.startswith(".") for part in p.relative_to(AUDIO).parts)]
    return {p.relative_to(AUDIO).as_posix(): p for p in files if p.exists()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--tracked", action="store_true")
    args = ap.parse_args()
    tok = token()
    account = call("GET", "/accounts", tok)["result"][0]["id"]
    have, files = remote(tok, account), local(args.tracked)
    todo = [k for k, p in sorted(files.items()) if have.get(k) != hashlib.md5(p.read_bytes()).hexdigest()]
    print(f"{len(files)} local, {len(have)} in the bucket, {len(todo)} to upload", flush=True)
    if args.dry or not todo:
        for k in todo[:20]:
            print("  ", k)
        return
    done, lock, start = [0], threading.Lock(), time.time()

    def send(key):
        # Stay under the API's 1,200 calls / 5 min.
        with lock:
            wait = start + done[0] * 0.27 - time.time()
            done[0] += 1
            n = done[0]
        if wait > 0:
            time.sleep(wait)
        call("PUT", f"/accounts/{account}/r2/buckets/{BUCKET}/objects/{urllib.parse.quote(key)}", tok, files[key].read_bytes(),
             {"Content-Type": "audio/mpeg", "Cache-Control": CACHE_DAY if key.startswith("choukai/") else CACHE_FOREVER})
        if n % 200 == 0:
            print(f"  {n}/{len(todo)}", flush=True)

    with cf.ThreadPoolExecutor(6) as ex:
        list(ex.map(send, todo))
    print(f"uploaded {len(todo)} files in {int(time.time() - start)} s")


if __name__ == "__main__":
    sys.exit(main())
