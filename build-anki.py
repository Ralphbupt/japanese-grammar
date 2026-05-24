#!/usr/bin/env python3
"""Generate Anki .apkg decks from the lesson markdown files.

Output: dist/anki/jpnotes-{N5,N4,N3,N2}.apkg — one deck per JLPT level.

Why a separate Python script (vs. doing this in build.js):
  - The Node anki-apkg-export library uses a 16MB-limited sql.js and
    crashes once you add ~150 cards (we have 372 total).
  - genanki-js is AGPL — incompatible with the project's MIT/CC-BY mix.
  - Python genanki is mature, MIT-licensed, and produces .apkg files
    that import in one tap on AnkiMobile (iOS) and AnkiDroid (Android).
  - The TSV files in build-anki.js stay as a fallback for users who
    prefer that workflow.

Card design matches build-anki.js:
  Front: 〜term, JLPT level, lesson number
  Back:  description, meaning, examples, link to jpnotes.dev/lessonNN/
"""

import os
import re
import sys
import html

try:
    import genanki
except ImportError:
    print("ERROR: genanki not installed. Run: pip install genanki", file=sys.stderr)
    sys.exit(1)


SITE = "https://jpnotes.dev/"
LEVELS = ["N5", "N4", "N3", "N2"]
OUT_DIR = os.path.join(os.path.dirname(__file__), "dist", "anki")

# Stable model & deck ids — same numbers across runs so re-importing
# a regenerated deck updates existing cards rather than duplicating.
MODEL_ID = 1729384756  # arbitrary fixed int
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
.front { text-align: center; }
.term { font-size: 2.2em; color: #e94560; font-weight: 700; line-height: 1.3; }
.meta { color: #888; margin-top: .8em; font-size: .9em; letter-spacing: .05em; }
.term-back { font-size: 1.6em; color: #e94560; font-weight: 700; }
.description { color: #555; font-size: .95em; margin: .2em 0 .6em; }
.divider { border-top: 1px solid #ddd; margin: .8em 0; }
.meaning { font-size: 1em; color: #333; margin: .6em 0; }
.section-label {
  font-weight: 700; color: #1a1a2e;
  margin: 1em 0 .3em; font-size: .9em;
}
.examples { padding-left: 1.4em; margin: 0; }
.examples li { margin: .5em 0; }
.examples .cn { color: #888; font-size: .88em; margin-top: .1em; }
.footer {
  margin-top: 1.2em; padding-top: .8em;
  border-top: 1px solid #eee;
}
.footer a { color: #e94560; text-decoration: none; font-size: .85em; }
.nightMode .card { color: #d4d4dc; background: #14141e; }
.nightMode .meaning { color: #d4d4dc; }
.nightMode .description { color: #b8b8c4; }
.nightMode .section-label { color: #f0f0f5; }
.nightMode .examples .cn { color: #a8a8b8; }
.nightMode .footer a { color: #ff7088; }
.nightMode .divider { border-top-color: #2d2d44; }
.nightMode .footer { border-top-color: #2d2d44; }
"""


def strip_md(text):
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"[*_`]", "", text)
    return text.strip()


def extract_bilingual(text):
    zh_match = re.search(r"^:::zh\s*\n([\s\S]*?)^:::\s*$", text, re.MULTILINE)
    en_match = re.search(r"^:::en\s*\n([\s\S]*?)^:::\s*$", text, re.MULTILINE)
    zh = zh_match.group(1).strip() if zh_match else None
    en = en_match.group(1).strip() if en_match else None
    return zh, en


def parse_grammar_sections(md):
    """Extract grammar point sections from a lesson markdown."""
    sections = []
    lines = md.split("\n")
    current = [None]
    buffer = []

    def flush():
        if not current[0]:
            return
        content = "\n".join(buffer)
        sub_sections = re.split(r"^### ", content, flags=re.MULTILINE)
        meaning = None
        examples = None
        for sub in sub_sections[1:]:
            header_line = sub.split("\n", 1)[0]
            sub_body = sub.split("\n", 1)[1] if "\n" in sub else ""
            if re.match(r"^(接[续続]|Conjugation)", header_line, re.IGNORECASE):
                continue
            zh, en = extract_bilingual(sub_body)
            if not meaning and re.search(
                r"含义|含意|用法|核心|意味|Meaning|Usage|Nuance",
                header_line,
                re.IGNORECASE,
            ):
                meaning = zh or en
            elif not examples and re.search(
                r"例句|例文|Example", header_line, re.IGNORECASE
            ):
                examples = zh or en
        if not meaning:
            zh, _ = extract_bilingual(content)
            meaning = zh
        if meaning:
            sections.append({**current[0], "meaning": meaning, "examples": examples})
        current[0] = None
        buffer.clear()

    for line in lines:
        h2 = re.match(r"^## (\d+)\.\s*(.+?)(?:\|\|.*)?$", line)
        if h2:
            flush()
            heading_text = h2.group(2).strip()
            term_match = re.match(
                r"^([〜～]?[〜～぀-ゟ゠-ヿー一-鿿/・\s,，、]+)",
                heading_text,
            )
            term = term_match.group(1).strip() if term_match else heading_text
            desc_match = re.search(r"[（(]([^）)]+)[）)]", heading_text)
            description = desc_match.group(1).strip() if desc_match else None
            current[0] = {"term": term, "description": description}
            continue
        if line.startswith("## ") and current[0]:
            flush()
            continue
        if current[0] is not None:
            buffer.append(line)
    flush()
    return sections


def format_examples(text):
    if not text:
        return ""
    stripped = strip_md(text)
    lines = [l for l in stripped.split("\n") if l.strip()]
    if not lines:
        return ""
    items = []
    for line in lines:
        m = re.match(r"^\d+[.、．]\s*(.+)$", line)
        content = m.group(1) if m else re.sub(r"^[\-•・]\s*", "", line)
        split_match = re.match(
            r"^([\s\S]+?)[（(]([^）)]+)[）)]\s*$", content
        )
        if split_match:
            ja = html.escape(split_match.group(1).strip())
            cn = html.escape(split_match.group(2).strip())
            items.append(
                f'<li>{ja}<br><span class="cn">{cn}</span></li>'
            )
        else:
            items.append(f"<li>{html.escape(content)}</li>")
    return f'<ol class="examples">{"".join(items)}</ol>'


def make_front(term, level, lesson_num):
    return (
        f'<div class="front">'
        f'<div class="term">{html.escape(term)}</div>'
        f'<div class="meta">JLPT {level} · Lesson {lesson_num}</div>'
        f"</div>"
    )


def make_back(term, description, meaning, examples, lesson_num, lesson_url):
    desc_block = (
        f'<div class="description">{html.escape(description)}</div>'
        if description
        else ""
    )
    meaning_block = (
        f'<div class="meaning">{html.escape(strip_md(meaning)).replace(chr(10), "<br>")}</div>'
        if meaning
        else ""
    )
    examples_block = (
        f'<div class="section-label">例句</div>{format_examples(examples)}'
        if examples
        else ""
    )
    return (
        f'<div class="term-back">{html.escape(term)}</div>'
        f"{desc_block}"
        f'<div class="divider"></div>'
        f"{meaning_block}{examples_block}"
        f'<div class="footer">'
        f'<a href="{lesson_url}">📖 jpnotes.dev/lesson{lesson_num}/</a>'
        f"</div>"
    )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

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
        level_dir = os.path.join(
            os.path.dirname(__file__), "grammar", level
        )
        if not os.path.isdir(level_dir):
            continue
        files = sorted(
            f for f in os.listdir(level_dir)
            if re.match(r"^lesson\d+_.*\.md$", f)
        )

        deck = genanki.Deck(
            DECK_IDS[level],
            f"日语语法 {level} · jpnotes.dev",
        )

        count = 0
        for f in files:
            path = os.path.join(level_dir, f)
            with open(path, "r", encoding="utf-8") as fp:
                md = fp.read()
            lesson_match = re.match(r"^lesson(\d+)", f)
            if not lesson_match:
                continue
            lesson_num = lesson_match.group(1)
            lesson_url = f"{SITE}lesson{lesson_num}/"
            for s in parse_grammar_sections(md):
                front = make_front(s["term"], level, lesson_num)
                back = make_back(
                    s["term"],
                    s["description"],
                    s["meaning"],
                    s["examples"],
                    lesson_num,
                    lesson_url,
                )
                note = genanki.Note(model=model, fields=[front, back])
                deck.add_note(note)
                count += 1

        out_path = os.path.join(OUT_DIR, f"jpnotes-{level}.apkg")
        genanki.Package(deck).write_to_file(out_path)
        print(f"  Generated {out_path} ({count} cards)")
        total += count

    print(f"\nTotal: {total} cards across {len(LEVELS)} .apkg decks.")
    print(f"Output: {OUT_DIR}/")


if __name__ == "__main__":
    main()
