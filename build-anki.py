#!/usr/bin/env python3
"""Generate Anki .apkg decks from the card cache produced by build-anki.js.

Reads dist/anki/.cards.json (structured cards with furigana HTML, plain
example text and matched TTS audio filenames, all produced by the Node
build) and writes one .apkg per JLPT level. By reusing the JS-side cache we
guarantee .apkg cards match the .txt cards exactly, and avoid running
kuroshiro from two separate language runtimes.

Each .apkg contains:
  - the recognition deck  日语语法 {level} · jpnotes.dev
  - a cloze subdeck       日语语法 {level} · jpnotes.dev::挖空练习
    (one production card per grammar point whose surface form appears
    verbatim in one of its example sentences)
  - the example-sentence TTS mp3s referenced via [sound:...] tags

Run order: build.js (writes dist/.audio-requests.json), build-anki.js
(writes .cards.json), then this script.
"""

import json
import os
import re
import sys

try:
    import genanki
except ImportError:
    print("ERROR: genanki not installed. Run: pip install genanki", file=sys.stderr)
    sys.exit(1)


LEVELS = ["N5", "N4", "N3", "N2"]
ROOT = os.path.dirname(__file__)
OUT_DIR = os.path.join(ROOT, "dist", "anki")
AUDIO_DIR = os.path.join(ROOT, "audio")
CACHE_PATH = os.path.join(OUT_DIR, ".cards.json")

# Stable IDs — re-importing a regenerated deck updates existing cards
# rather than duplicating.
MODEL_ID = 1729384756
CLOZE_MODEL_ID = 1729384757
DECK_IDS = {
    "N5": 1729384701,
    "N4": 1729384702,
    "N3": 1729384703,
    "N2": 1729384704,
}
CLOZE_DECK_IDS = {
    "N5": 1729384711,
    "N4": 1729384712,
    "N3": 1729384713,
    "N2": 1729384714,
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
.cloze { font-weight: 700; color: #e94560; }
.nightMode .card { color: #d4d4dc; background: #14141e; }
.nightMode rt { color: #ff7088; }
"""

KANA_KANJI = re.compile(r"[぀-ヿ一-鿿]")


def term_variants(term):
    """Surface forms a grammar term might take inside an example sentence.

    '〜たことがある / 〜たことがない' → ['たことがある', 'たことがない'];
    parentheticals and 〜 markers are stripped. Longest-first so the most
    specific variant is clozed when several match.
    """
    t = re.sub(r"[（(].*?[）)]", "", term)
    out = set()
    for part in re.split(r"[/／・、,，]", t):
        p = part.replace("〜", "").replace("～", "").strip()
        if len(p) >= 2 and KANA_KANJI.search(p):
            out.add(p)
    return sorted(out, key=len, reverse=True)


def make_cloze_note(model, card):
    """Build one production (cloze) note per grammar point, or None.

    Uses the first example whose plain text contains the term verbatim.
    Front: sentence with the grammar point blanked + 中文译文 as the prompt.
    Back extra: furigana sentence, audio, and a link to the full lesson.
    """
    variants = term_variants(card["term"])
    for ex in card["examples"]:
        for v in variants:
            if v in ex["jp"]:
                text = ex["jp"].replace(v, "{{c1::%s}}" % v, 1)
                if ex.get("zh"):
                    text += (
                        '<br><span style="color:#888;font-size:.9em;">%s</span>'
                        % ex["zh"]
                    )
                extra_parts = [ex["jpHtml"]]
                if ex.get("audio"):
                    extra_parts.append("[sound:%s]" % ex["audio"])
                extra_parts.append(
                    '<div style="margin-top:.6em;color:#555;">%s</div>'
                    % card["displayTerm"]
                )
                extra_parts.append(
                    '<div style="margin-top:.6em;"><a href="%s">📖 jpnotes.dev/lesson%s/</a></div>'
                    % (card["url"], card["lessonNum"])
                )
                note = genanki.Note(
                    model=model,
                    fields=[text, "".join(extra_parts)],
                    guid=genanki.guid_for("jpnotes-cloze", card["level"], card["lessonNum"], card["term"]),
                )
                return note, ex.get("audio")
    return None


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
    cloze_model = genanki.Model(
        CLOZE_MODEL_ID,
        "jpnotes Cloze",
        model_type=genanki.Model.CLOZE,
        fields=[{"name": "Text"}, {"name": "Extra"}],
        templates=[
            {
                "name": "Cloze",
                "qfmt": "{{cloze:Text}}",
                "afmt": '{{cloze:Text}}<hr id="answer">{{Extra}}',
            }
        ],
        css=DECK_CSS,
    )

    total = 0
    total_cloze = 0
    for level in LEVELS:
        cards = cache.get(level, [])
        if not cards:
            continue

        deck = genanki.Deck(
            DECK_IDS[level],
            f"日语语法 {level} · jpnotes.dev",
        )
        cloze_deck = genanki.Deck(
            CLOZE_DECK_IDS[level],
            f"日语语法 {level} · jpnotes.dev::挖空练习",
        )

        media = set()
        cloze_count = 0
        for card in cards:
            note = genanki.Note(
                model=model,
                fields=[card["front"], card.get("backApkg") or card["back"]],
                guid=genanki.guid_for("jpnotes", card["level"], card["lessonNum"], card["term"]),
            )
            deck.add_note(note)
            for ex in card.get("examples", []):
                if ex.get("audio"):
                    media.add(ex["audio"])

            cloze = make_cloze_note(cloze_model, card)
            if cloze:
                cloze_note, cloze_audio = cloze
                cloze_deck.add_note(cloze_note)
                cloze_count += 1
                if cloze_audio:
                    media.add(cloze_audio)

        media_files = []
        missing = 0
        for name in sorted(media):
            p = os.path.join(AUDIO_DIR, name)
            if os.path.exists(p):
                media_files.append(p)
            else:
                missing += 1

        out_path = os.path.join(OUT_DIR, f"jpnotes-{level}.apkg")
        pkg = genanki.Package([deck, cloze_deck])
        pkg.media_files = media_files
        pkg.write_to_file(out_path)
        size_mb = os.path.getsize(out_path) / 1024 / 1024
        print(
            f"  Generated {out_path} ({len(cards)} cards + {cloze_count} cloze, "
            f"{len(media_files)} audio files, {size_mb:.1f} MB)"
            + (f" — {missing} mp3 missing" if missing else "")
        )
        total += len(cards)
        total_cloze += cloze_count

    print(f"\nTotal: {total} cards + {total_cloze} cloze across {len(LEVELS)} .apkg decks.")
    print(f"Output: {OUT_DIR}/")


if __name__ == "__main__":
    main()
