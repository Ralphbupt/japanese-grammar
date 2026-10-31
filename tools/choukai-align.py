#!/usr/bin/env python3
"""Where each line ends in one TTS clip that speaks several lines (Gemini gives no timings).

    <venv with mlx_whisper>/bin/python tools/choukai-align.py clip.wav lines.json
    → prints a JSON list of cut times (seconds), one between each pair of lines

Whisper transcribes the clip with word timestamps, prompted with the script so it
spells things the way the script does; the transcript is matched to the script
character by character, and each line's last character gives the time of its end.
Called by tools/choukai-audio.py, which snaps the times to the nearest pause.
"""
import difflib, json, re, sys

import mlx_whisper

MODEL = "mlx-community/whisper-large-v3-turbo"
norm = lambda s: re.sub(r"[\s　、。，,.？?！!…「」『』（）()〜~ー-]", "", s)


def main():
    wav, lines = sys.argv[1], json.load(open(sys.argv[2]))
    r = mlx_whisper.transcribe(wav, path_or_hf_repo=MODEL, language="ja", word_timestamps=True,
                               initial_prompt="".join(lines), condition_on_previous_text=False)
    chars, times = [], []   # transcript characters and the end time of the word each belongs to
    for seg in r["segments"]:
        for w in seg.get("words", []):
            for c in norm(w["word"]):
                chars.append(c); times.append(w["end"])
    script = "".join(norm(l) for l in lines)
    ends = [len("".join(norm(l) for l in lines[:k + 1])) - 1 for k in range(len(lines) - 1)]
    sm = difflib.SequenceMatcher(None, script, "".join(chars), autojunk=False)
    # script index → transcript index, through the matching blocks (nearest earlier match otherwise).
    mapped = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): mapped[a + k] = b + k
    cuts = []
    for e in ends:
        i = e
        while i >= 0 and i not in mapped: i -= 1
        cuts.append(times[mapped[i]] if i >= 0 and times else None)
    print(json.dumps(cuts))


if __name__ == "__main__":
    main()
