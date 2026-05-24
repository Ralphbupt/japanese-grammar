#!/usr/bin/env python3
"""Generate Anki .apkg decks from the card cache produced by build-anki.js.

Reads dist/anki/.cards.json (front/back HTML pre-formatted with furigana
by the Node build) and writes one .apkg per JLPT level. By reusing the
JS-side cache we guarantee .apkg cards match the .txt cards exactly,
and avoid running kuroshiro from two separate language runtimes.

Run order: build-anki.js first (writes .cards.json), then this script.
"""

import json
import os
import sys

try:
    import genanki
except ImportError:
    print("ERROR: genanki not installed. Run: pip install genanki", file=sys.stderr)
    sys.exit(1)


LEVELS = ["N5", "N4", "N3", "N2"]
OUT_DIR = os.path.join(os.path.dirname(__file__), "dist", "anki")
CACHE_PATH = os.path.join(OUT_DIR, ".cards.json")

# Stable IDs — re-importing a regenerated deck updates existing cards
# rather than duplicating.
MODEL_ID = 1729384756
DECK_IDS = {
    "N5": 1729384701,
    "N4": 1729384702,
    "N3": 1729384703,
    "N2": 1729384704,
}

DECK_CSS = """
.card {
  font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP",
               "PingFang SC", sans-serif;
  line-height: 1.7;
  padding: 1em;
  color: #2d2d2d;
  background: #fafaf8;
}
ruby { ruby-align: center; }
rt { font-size: .6em; color: #e94560; font-weight: 400; }
.nightMode .card { color: #d4d4dc; background: #14141e; }
.nightMode rt { color: #ff7088; }
"""


def main():
    if not os.path.exists(CACHE_PATH):
        print(
            f"ERROR: {CACHE_PATH} not found. Run `node build-anki.js` first.",
            file=sys.stderr,
        )
        sys.exit(1)

    with open(CACHE_PATH, "r", encoding="utf-8") as fp:
        cache = json.load(fp)

    model = genanki.Model(
        MODEL_ID,
        "jpnotes Basic",
        fields=[{"name": "Front"}, {"name": "Back"}],
        templates=[
            {
                "name": "Card 1",
                "qfmt": "{{Front}}",
                "afmt": '{{FrontSide}}<hr id="answer">{{Back}}',
            }
        ],
        css=DECK_CSS,
    )

    total = 0
    for level in LEVELS:
        cards = cache.get(level, [])
        if not cards:
            continue

        deck = genanki.Deck(
            DECK_IDS[level],
            f"日语语法 {level} · jpnotes.dev",
        )

        for card in cards:
            note = genanki.Note(model=model, fields=[card["front"], card["back"]])
            deck.add_note(note)

        out_path = os.path.join(OUT_DIR, f"jpnotes-{level}.apkg")
        genanki.Package(deck).write_to_file(out_path)
        print(f"  Generated {out_path} ({len(cards)} cards)")
        total += len(cards)

    print(f"\nTotal: {total} cards across {len(LEVELS)} .apkg decks.")
    print(f"Output: {OUT_DIR}/")


if __name__ == "__main__":
    main()
