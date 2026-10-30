#!/usr/bin/env python3
"""Generate TTS audio (.mp3) for Japanese example sentences.

Reads dist/.audio-requests.json (written by build.js) which contains
{ id, text } entries; the id is a hash of the text (see audioIdFor in
build.js), so an existing file is always the right audio for its id.

Output: audio/{id}.mp3 (committed to repo, copied to dist/audio/ by CI)
"""

import asyncio
import json
import os
import re
import sys

try:
    import edge_tts
except ImportError:
    print("ERROR: edge-tts not installed. Run: pip install edge-tts", file=sys.stderr)
    sys.exit(1)

# Since 2026-10 Microsoft refuses the old readaloud endpoint (403) in some
# regions, Japan included; Edge itself now talks to api.msedgeservices.com,
# which accepts the same client key and Sec-MS-GEC token. Drop this override
# once edge-tts ships the new endpoint.
import edge_tts.communicate
from edge_tts.constants import TRUSTED_CLIENT_TOKEN
edge_tts.communicate.WSS_URL = (
    "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
    f"?Ocp-Apim-Subscription-Key={TRUSTED_CLIENT_TOKEN}"
)

VOICE = "ja-JP-NanamiNeural"

# Words Nanami misreads, rewritten in kana before the text goes to TTS. The
# request text (and so the audio id) stays as written; only what is spoken
# changes. Found by transcribing every mp3 with Whisper and Gemini (2026-10-30).
# A new rule doesn't touch existing mp3s: delete the ones it should fix and
# rerun. Standalone 町 is まち, in words (町内, 市町村, 町名) ちょう.
KANJI = r"一-鿿々"
TTS_READINGS = [
    (r"何時(?!間|でも|か(?!ら)|も)", "なんじ"),             # not いつ
    (r"みどり町", "みどりちょう"),                           # place name in an N5 reading
    (rf"(?<![{KANJI}])町(?![{KANJI}])", "まち"),
    (r"(?<=[ぁ-ん])気味", "ぎみ"),                  # 遅れ気味, not きみ
    (r"(?<=て)来(?=な)", "こ"),                             # 持って来なければ
    (r"気を遣", "気をつか"),
    (r"寒気(?=[もが]する)", "さむけ"),
    (rf"(?:(?<![{KANJI}])|(?<=毎朝))家から", "いえから"),        # not 専門家から, 農家から
    (r"間違", "まちが"),
    (r"小さな", "ちいさな"),
    (r"平仮名", "ひらがな"),
    (r"お父様", "おとうさま"),
    (r"お応え", "おこたえ"),
    (r"餞", "はなむけ"),
    (r"過疎化", "かそか"),
    (r"正々堂々", "せいせいどうどう"),
    (r"感動作", "かんどうさく"),
    (r"忘るべからず", "わするべからず"),
    (r"めったに空いて", "めったにすいて"),
    (r"辛(?=い|く)", "から"),                                # every 辛い here is spicy
    (r"大事にならず", "おおごとにならず"),
    (r"体を大事に", "体をだいじに"),
    (r"ポストには入れないで", "ポストには いれないで"),
    (r"人にプレゼント", "ひとにプレゼント"),
    (r"(?<=暑い)日", "ひ"),
    (r"人が少ない", "ひとが少ない"),
    (r"半年", "はんとし"),
    (r"になって行ってきた", "になっておこなってきた"),
    (r"ごろ会社", "ごろ、会社"),                             # else read as one word, がいしゃ
]


def spoken(text):
    for pattern, kana in TTS_READINGS:
        text = re.sub(pattern, kana, text)
    return text
OUT_DIR = os.path.join(os.path.dirname(__file__), "audio")
REQUESTS_PATH = os.path.join(os.path.dirname(__file__), "dist", ".audio-requests.json")
MAX_CONCURRENT = 8


async def generate_one(text, filepath, semaphore):
    async with semaphore:
        try:
            communicate = edge_tts.Communicate(spoken(text), VOICE)
            await communicate.save(filepath)
            return True
        except Exception as e:
            # save() creates the file before streaming; don't leave an empty
            # mp3 that the next run would skip as "already generated".
            if os.path.exists(filepath):
                os.remove(filepath)
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
        # An empty file is a failed earlier run, not audio.
        if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
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
