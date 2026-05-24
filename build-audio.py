#!/usr/bin/env python3
"""Generate TTS audio (.mp3) for every Japanese example sentence.

Uses Microsoft Edge TTS (edge-tts) — free, neural, high quality.
Output: dist/audio/*.mp3 + dist/audio/manifest.json

The manifest maps cleaned Japanese text → audio filename so the site's
TTS JS can look up pre-generated audio on 🔊 click and fall back to
browser TTS only when no pre-generated file exists.
"""

import asyncio
import hashlib
import json
import os
import re
import sys

try:
    import edge_tts
except ImportError:
    print("ERROR: edge-tts not installed. Run: pip install edge-tts", file=sys.stderr)
    sys.exit(1)

VOICE = "ja-JP-NanamiNeural"
OUT_DIR = os.path.join(os.path.dirname(__file__), "dist", "audio")
GRAMMAR_DIR = os.path.join(os.path.dirname(__file__), "grammar")
LEVELS = ["N5", "N4", "N3", "N2"]
MAX_CONCURRENT = 8


def strip_md(text):
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    return re.sub(r"[*_`]", "", text).strip()


def extract_bilingual(text):
    m = re.search(r"^:::zh\s*\n([\s\S]*?)^:::\s*$", text, re.MULTILINE)
    return m.group(1).strip() if m else None


def extract_examples_from_section(section_text):
    """Extract Japanese sentences from a ### 例句 section."""
    subs = re.split(r"^### ", section_text, flags=re.MULTILINE)
    for sub in subs[1:]:
        header = sub.split("\n", 1)[0]
        if not re.search(r"例句|例文|Example", header, re.IGNORECASE):
            continue
        body = sub.split("\n", 1)[1] if "\n" in sub else ""
        zh_text = extract_bilingual(body)
        if not zh_text:
            continue
        stripped = strip_md(zh_text)
        for line in stripped.split("\n"):
            line = line.strip()
            if not line:
                continue
            # Match "N. sentence（translation）" or "- sentence（translation）"
            m = re.match(r"^\d+[.、．]\s*(.+)$", line)
            content = m.group(1) if m else re.sub(r"^[-•・]\s*", "", line)
            # Split Japanese from Chinese parenthetical
            split = re.match(r"^([\s\S]+?)[（(]([^）)]+)[）)]\s*$", content)
            if split:
                ja = split.group(1).strip()
            else:
                ja = content.strip()
            # Clean for TTS
            ja = re.sub(r"[→❌✓✗⚠️📖↑↓←●■□▶︎•·]", "", ja)
            ja = re.sub(r"\s+", " ", ja).strip()
            if len(ja) < 4:
                continue
            # Skip lines that are pure Chinese or annotations
            if not re.search(r"[぀-ヿ]", ja):
                continue
            yield ja


def parse_lessons():
    """Yield (lesson_id, section_idx, example_idx, japanese_text) for all lessons."""
    for level in LEVELS:
        level_dir = os.path.join(GRAMMAR_DIR, level)
        if not os.path.isdir(level_dir):
            continue
        for fname in sorted(os.listdir(level_dir)):
            if not re.match(r"^lesson\d+_.*\.md$", fname):
                continue
            lesson_match = re.match(r"^lesson(\d+)", fname)
            if not lesson_match:
                continue
            lesson_id = f"lesson{lesson_match.group(1)}"
            with open(os.path.join(level_dir, fname), "r", encoding="utf-8") as f:
                md = f.read()
            # Split by ## headings (grammar sections)
            sections = re.split(r"^## ", md, flags=re.MULTILINE)
            ex_idx = 0
            for sec_i, sec in enumerate(sections[1:], 1):
                # Only process numbered grammar sections
                if not re.match(r"\d+\.", sec):
                    continue
                for ja in extract_examples_from_section("## " + sec):
                    ex_idx += 1
                    yield lesson_id, ex_idx, ja


async def generate_one(text, filepath, semaphore):
    async with semaphore:
        try:
            communicate = edge_tts.Communicate(text, VOICE)
            await communicate.save(filepath)
            return True
        except Exception as e:
            print(f"  WARN: failed to generate for '{text[:30]}...': {e}", file=sys.stderr)
            return False


async def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # Collect all sentences
    sentences = []
    seen_texts = set()
    for lesson_id, ex_idx, ja_text in parse_lessons():
        # Deduplicate (same sentence across lessons)
        if ja_text in seen_texts:
            continue
        seen_texts.add(ja_text)
        filename = f"{lesson_id}_ex{ex_idx:03d}.mp3"
        sentences.append((ja_text, filename))

    print(f"Found {len(sentences)} unique example sentences to generate audio for.")

    # Check which files already exist (skip regeneration)
    to_generate = []
    manifest = {}
    for ja_text, filename in sentences:
        filepath = os.path.join(OUT_DIR, filename)
        manifest[ja_text] = filename
        if os.path.exists(filepath):
            continue
        to_generate.append((ja_text, filepath))

    print(f"  {len(sentences) - len(to_generate)} already exist, {len(to_generate)} to generate.")

    if to_generate:
        semaphore = asyncio.Semaphore(MAX_CONCURRENT)
        tasks = [generate_one(text, path, semaphore) for text, path in to_generate]
        results = await asyncio.gather(*tasks)
        success = sum(1 for r in results if r)
        print(f"  Generated {success}/{len(to_generate)} audio files.")

    # Write manifest
    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=None)
    print(f"  Wrote {manifest_path} ({len(manifest)} entries)")
    print(f"\nDone. Output: {OUT_DIR}/")


if __name__ == "__main__":
    asyncio.run(main())
