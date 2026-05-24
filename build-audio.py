#!/usr/bin/env python3
"""Generate TTS audio (.mp3) for Japanese example sentences.

Reads dist/.audio-requests.json (written by build.js) which contains
{ id, text } entries with deterministic IDs matching the data-audio
attributes in the built HTML. No text-matching needed at runtime.

Output: audio/{id}.mp3 (committed to repo, copied to dist/audio/ by CI)
"""

import asyncio
import json
import os
import sys

try:
    import edge_tts
except ImportError:
    print("ERROR: edge-tts not installed. Run: pip install edge-tts", file=sys.stderr)
    sys.exit(1)

VOICE = "ja-JP-NanamiNeural"
OUT_DIR = os.path.join(os.path.dirname(__file__), "audio")
REQUESTS_PATH = os.path.join(os.path.dirname(__file__), "dist", ".audio-requests.json")
MAX_CONCURRENT = 8


async def generate_one(text, filepath, semaphore):
    async with semaphore:
        try:
            communicate = edge_tts.Communicate(text, VOICE)
            await communicate.save(filepath)
            return True
        except Exception as e:
            print(f"  WARN: failed '{text[:30]}...': {e}", file=sys.stderr)
            return False


async def main():
    if not os.path.exists(REQUESTS_PATH):
        print(f"ERROR: {REQUESTS_PATH} not found. Run `npm run build:site` first.", file=sys.stderr)
        sys.exit(1)

    with open(REQUESTS_PATH, "r", encoding="utf-8") as f:
        requests = json.load(f)

    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Audio requests: {len(requests)} sentences")

    # Skip already-generated files (incremental)
    to_generate = []
    for entry in requests:
        filepath = os.path.join(OUT_DIR, f"{entry['id']}.mp3")
        if os.path.exists(filepath):
            continue
        to_generate.append((entry["text"], filepath))

    print(f"  {len(requests) - len(to_generate)} already exist, {len(to_generate)} new.")

    if to_generate:
        semaphore = asyncio.Semaphore(MAX_CONCURRENT)
        tasks = [generate_one(text, path, semaphore) for text, path in to_generate]
        results = await asyncio.gather(*tasks)
        success = sum(1 for r in results if r)
        print(f"  Generated {success}/{len(to_generate)} audio files.")

    print(f"\nDone. Output: {OUT_DIR}/ ({len(requests)} total files)")


if __name__ == "__main__":
    asyncio.run(main())
