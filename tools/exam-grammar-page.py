#!/usr/bin/env python3
"""Write grammar/guides/jlpt-{lv}-past-exam-grammar.md from questions/exam-grammar/{lv}.json.

Each data file is our own count of the grammar section of every paper of
that level 2010–2026 (N1 問題5–7, N2 問題7–9, N3 問題1–3 of the grammar and
reading booklet): for each item, the pattern it tests (read from the paper
and its answer key by Claude subagents, 2026-11-23), grouped per lesson point
or per pattern — display name, the sittings (YYYY-07 / YYYY-12), form, a
meaning written for this site (zh + en) and, when a lesson teaches it,
{ id, no, level } (+ `also`: more lesson points it covers). The page never
carries exam sentences (the papers are copyrighted), only which pattern came
up when.

The same data tags lesson headings (build.js EXAM_SEEN), the grammar audio
pages (gaExam) and practice questions (build-quiz.js examTag).

    python3 tools/exam-grammar-page.py [n1 n2 n3]   (default: every data file)
"""
import json, re, glob, os, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDER = ["N5", "N4", "N3", "N2", "N1"]
# the grammar section's もんだい numbers per level: form, sentence composition, text grammar
MONDAI = {"N1": (5, 6, 7), "N2": (7, 8, 9), "N3": (1, 2, 3), "N4": (1, 2, 3), "N5": (1, 2, 3)}
FULL = 30   # fewer sittings than this: the set is partial (N4 / N5), and the page says which ones

# lesson heading anchors: build.js slugs the zh side of the h2
heads = {}
for f in glob.glob(os.path.join(ROOT, "grammar", "N*", "lesson*.md")):
    lid = re.search(r"(lesson\d+)", f).group(1)
    for line in open(f, encoding="utf-8"):
        m = re.match(r"## (\d+)\. (.+?)(?:\|\||$)", line.rstrip("\n"))
        if m:
            zh = f"{m.group(1)}. {m.group(2)}".strip()
            # marked escapes the text (" → &quot;) before build.js drops [<>"'&]
            zh = zh.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;")
            heads[(lid, int(m.group(1)))] = re.sub(r"[<>\"'&]", "", re.sub(r"[\s　]+", "_", zh))


def years(r, en):
    out = [f"{'Jul' if y[5:] == '07' else 'Dec'} {y[:4]}" if en else f"{y[:4]}.{int(y[5:])}" for y in sorted(r["years"])]
    return ", ".join(out) if en else "、".join(out)


def lesson(r):
    L = r.get("lesson")
    if not L:
        return "—"
    a = heads.get((L["id"], L["no"]))
    return f"[{L['level']} · L{int(L['id'][6:]):02d}](/{L['id']}/{'#' + a if a else ''})"


def esc(s):
    return s.replace("|", "\\|")


def gm(r, L):
    """The "got it" toggle of a row: key = its lesson point, else x:<level>:<pattern> (build.js gm script)."""
    Ls = r.get("lesson")
    key = f"{Ls['id']}#{Ls['no']}" if Ls else f"x:{L}:{r['g']}"
    key = key.replace("&", "&amp;").replace('"', "&quot;")
    return f'<button type="button" class="gotit" data-g="{key}" data-n="{len(r["years"])}" aria-pressed="false"></button>'


def page(l):
    L = l.upper()
    allrows = json.load(open(os.path.join(ROOT, "questions", "exam-grammar", f"{l}.json")))
    # sec "other" (N4 / N5): conjunctions, conjugation forms, adverbs — their own table
    rows = [r for r in allrows if not r.get("sec")]
    other = sorted((r for r in allrows if r.get("sec") == "other"), key=lambda r: (-len(r["years"]), r["g"]))
    N = len(rows)
    by_n = collections.defaultdict(list)
    for r in rows:
        by_n[len(r["years"])].append(r)
    for k in by_n:
        by_n[k].sort(key=lambda r: (-int(max(r["years"]).replace("-", "")), r["g"]))
    lv = collections.Counter(r["lesson"]["level"] for r in rows if r.get("lesson"))
    lower = ORDER[:ORDER.index(L)]          # levels below this one
    below = sum(v for k, v in lv.items() if k in lower)
    many = sum(len(v) for k, v in by_n.items() if k >= 3)
    linked = sum(1 for r in rows if r.get("lesson"))
    first, last = min(min(r["years"]) for r in rows)[:4], max(max(r["years"]) for r in rows)[:4]
    sit_list = sorted({y for r in allrows for y in r["years"]})
    sittings, partial = len(sit_list), len(sit_list) < FULL
    sit_zh = "、".join(f"{y[:4]} 年 {int(y[5:])} 月" for y in sit_list)
    sit_en = ", ".join(f"{'July' if y[5:] == '07' else 'December'} {y[:4]}" for y in sit_list)
    m1, m2, m3 = MONDAI[L]
    nxt = lower[-1] if lower else None      # the level right below, named in the lead
    has_vl = os.path.exists(os.path.join(ROOT, "questions", "vocab-list", f"{l}.json"))
    has_key = os.path.exists(os.path.join(ROOT, "grammar", "guides", f"jlpt-{l}-key-grammar.md"))

    out = [f"# JLPT {L} 历年真题语法||JLPT {L} Grammar from Past Tests ({first}–{last})", ""]
    zh_below = f"而且有 **{below} 个其实是 {nxt} 及以下的语法**——{L} 并不只考 {L} 语法，{nxt} 的基础不牢，语法题照样丢分。" if below else ""
    en_below = f" And **{below} are {nxt}-or-lower grammar**: {L} doesn't only test {L} patterns, so gaps in {nxt} cost points too." if below else ""
    lead_zh = (f"本站收集到 {first}–{last} 年间 {sittings} 场 JLPT {L} 真题（不是每一场都有，场次见文末说明），逐场统计了语法题，一共考过 **{N} 个语法**。" if partial
               else f"本站逐场统计了 {first}–{last} 年 {sittings} 场 JLPT {L} 真题的语法题，一共考过 **{N} 个语法**。")
    lead_en = (f"We have {sittings} real JLPT {L} tests from {first}–{last} (not every sitting; the list is in the notes) and went through their grammar items: **{N} grammar patterns** came up." if partial
               else f"We went through the grammar items of all {sittings} real JLPT {L} tests from {first} to {last}: **{N} grammar patterns** came up.")
    out += [":::zh",
            f"{lead_zh}下面按考过的次数排列，每个都写了接续、意思、考过哪几次，并链接到本站的讲解。"
            f"其中 **{many} 个考过 3 次以上**，最值得先看；{zh_below}"
            + (f"另外还有 **{len(other)} 个其他考点**（助词用法、接续词、动词变形、副词等），列在后面单独一张表里。" if other else ""),
            "", f"用法建议：先把「考过 3 次以上」的过一遍，点进讲解看例句；再到 [{L} 练习题](/{l}-practice/) 做题，题目考到的语法如果在真题里出现过，答题后会标出「真题考过几次」。", ":::",
            ":::en",
            f"{lead_en} They're listed by how often each was tested, with its form, meaning, the sittings it appeared in, and a link to the lesson that teaches it. "
            f"**{many} came up three times or more** — start there.{en_below}"
            + (f" There are also **{len(other)} other test points** (particle uses, conjunctions, conjugation forms, adverbs and the like) in a separate table after them." if other else ""),
            "", f"How to use it: go through the patterns tested 3+ times first and open their lessons for examples; then drill in [{L} practice](/{l}-practice/) — a question on a pattern from this list shows how often the real test asked it.", ":::", ""]

    out += ['<div id="gotit-sum"></div>', ""]   # "got 12 of 247" + hide-known toggle (build.js gm script)
    for code, title, col, none in (("zh", "## 按课文级别统计||Where These Patterns Are Taught", "| 课文级别 | 语法数 |", "本站暂未单独讲"),
                                   ("en", None, "| Lesson level | Patterns |", "Not a lesson of its own yet")):
        if title:
            out += [title, ""]
        out += [f":::{code}", col, "|------|------|"]
        out += [f"| [{k}](/{k}/) | {lv[k]} |" for k in ORDER if lv.get(k)]
        out += [f"| {none} | {N - linked} |", ":::"]
    out.append("")

    groups = [(lambda k: k >= 4, "考过 4 次以上", "Tested 4+ times"), (lambda k: k == 3, "考过 3 次", "Tested 3 times"),
              (lambda k: k == 2, "考过 2 次", "Tested twice"), (lambda k: k == 1, "考过 1 次", "Tested once")]
    i = 0
    for test, zh, en in groups:
        rs = [r for k in sorted(by_n, reverse=True) if test(k) for r in by_n[k]]
        if not rs:
            continue
        out += [f"## {zh}（{len(rs)} 个）||{en} ({len(rs)})", "",
                "| # | 语法 // Pattern | 接续 // Form | 意思 // Meaning | 考过 // Sittings | 讲解 // Lesson | 掌握 // Got it |",
                "|------|------|------|------|------|------|------|"]
        for r in rs:
            i += 1
            form = "<br>".join(esc(f) for f in r["form"]) or "—"
            out.append(f"| {i} | {esc(r['g'])} | {form} | {esc(r['zh'])} // {esc(r['en'])} | {years(r, False)} // {years(r, True)} | {lesson(r)} | {gm(r, L)} |")
        out.append("")

    if other:
        out += [f"## 其他考点：助词、接续词、变形、副词（{len(other)} 个）||Other Test Points: Particles, Conjunctions, Forms, Adverbs ({len(other)})", "",
                ":::zh", "这些题考的不是某个句型，而是助词的某个用法、接续词怎么选、动词怎么变形（被动、可能、て形……）、用哪个副词或疑问词，同样是语法部分的常见考点。", ":::",
                ":::en", "These items test no named pattern but a particular use of a particle, which conjunction fits, how a verb or adjective changes form (passive, potential, the te-form …), or which adverb or question word to use — just as much a part of the grammar section.", ":::", "",
                "| # | 考点 // Point | 接续 // Form | 意思 // Meaning | 考过 // Sittings | 讲解 // Lesson | 掌握 // Got it |",
                "|------|------|------|------|------|------|------|"]
        for r in other:
            i += 1
            form = "<br>".join(esc(f) for f in r["form"]) or "—"
            out.append(f"| {i} | {esc(r['g'])} | {form} | {esc(r['zh'])} // {esc(r['en'])} | {years(r, False)} // {years(r, True)} | {lesson(r)} | {gm(r, L)} |")
        out.append("")

    booklet_zh ="（在「言语知识（语法）・阅读」那一场）" if L in ("N3", "N4", "N5") else ""
    booklet_en = " (in the grammar and reading booklet)" if L in ("N3", "N4", "N5") else ""
    rel_zh = [f"[{L} 语法清单](/{L}_grammar_list/)"] + ([f"[{L} 高频语法考点](/jlpt-{l}-key-grammar/)"] if has_key else []) + ([f"[{L} 高频词汇（真题词表）](/{l}-vocabulary-list/)"] if has_vl else [])
    rel_en = [f"[{L} grammar list](/{L}_grammar_list/)"] + ([f"[{L} key grammar](/jlpt-{l}-key-grammar/)"] if has_key else []) + ([f"[{L} vocabulary list from past tests](/{l}-vocabulary-list/)"] if has_vl else [])
    others = [x for x in ("n5", "n4", "n3", "n2", "n1") if x != l and os.path.exists(os.path.join(ROOT, "questions", "exam-grammar", f"{x}.json"))]
    out += ["## 说明||Notes", "", ":::zh",
            "- 年份是 7 月（第 1 回）和 12 月（第 2 回）考试，2020 年 7 月因疫情停考。"]
    if partial:
        out.append(f"- 收录的 {sittings} 场：{sit_zh}。其他场次我们没有找到可靠的真题，所以「考过几次」只是这几场里的次数，实际考过的次数可能更多。")
    scope_zh = f"这 {sittings} 场" if partial else f"{first}–{last} 年 {sittings} 场"
    scope_en = f"these {sittings}" if partial else f"all {sittings}"
    mz = "もんだい" if L in ("N4", "N5") else "問題"
    out += [f"- 本站逐场看了{scope_zh} {L} 真题的语法部分{booklet_zh}（{mz} {m1} 语法形式判断、{mz} {m2} 句子组合、{mz} {m3} 文章语法），按答案判断每道题考的语法再统计。只算语法题本身的考点，阅读、听力里出现的不算；一道题考的是单纯的时态、接续词等、说不出具体句型的，不列入。",
            "- 一个语法在同一场里考了两次，只算一次；同一个语法的不同形式合在一起算。判断难免有出入，发现错误欢迎留言。",
            "- 意思和接续由本站编写；不收录真题原题（试题版权属于国际交流基金和日本国际教育支援协会）。",
            ":::", ":::en",
            "- Sittings are the July (1st) and December (2nd) tests; July 2020 was cancelled."] + ([
            f"- The {sittings} sittings included: {sit_en}. We couldn't find reliable papers for the others, so a count here is within these sittings only; the real number may be higher."] if partial else []) + [
            f"- We went through the grammar section of {scope_en} {L} papers{'' if partial else f' from {first} to {last}'}{booklet_en} ({mz}{m1} grammar form, {mz}{m2} sentence composition, {mz}{m3} text grammar) and, using the answers, noted the pattern each item tests. Only the point of a grammar item counts, not patterns that appear in reading or listening; items testing plain tense, a connective or nothing nameable are left out.",
            "- A pattern tested twice in one sitting counts once; forms of one pattern count together. Some calls are judgment calls — if you spot a mistake, please leave a comment.",
            "- Meanings and forms are written for this site; no exam questions are reproduced (the papers are copyright of the Japan Foundation and JEES).",
            ":::", "",
            "## 相关页面||Related Pages", "", ":::zh",
            "- " + "・".join(rel_zh),
            f"- [{L} 练习题](/{l}-practice/)・[{L} 模拟题](/{l}-mock-test/)・[JLPT 估分器](/jlpt-score-calculator/)"]
    if others:
        out.append("- 其他级别：" + "・".join(f"[{x.upper()} 历年真题语法](/jlpt-{x}-past-exam-grammar/)" for x in others))
    out += [":::", ":::en", "- " + " · ".join(rel_en),
            f"- [{L} practice](/{l}-practice/) · [{L} mock test](/{l}-mock-test/) · [JLPT score calculator](/jlpt-score-calculator/)"]
    if others:
        out.append("- Other levels: " + " · ".join(f"[{x.upper()} grammar from past tests](/jlpt-{x}-past-exam-grammar/)" for x in others))
    out += [":::", ""]

    dst = os.path.join(ROOT, "grammar", "guides", f"jlpt-{l}-past-exam-grammar.md")
    open(dst, "w", encoding="utf-8").write("\n".join(out))
    print(f"wrote {dst}: {N} patterns in {sittings} sittings, {many} tested 3+, {below} taught below {L}, {linked} linked")


levels = sys.argv[1:] or sorted(os.path.basename(f)[:2] for f in glob.glob(os.path.join(ROOT, "questions", "exam-grammar", "n?.json")))
for l in levels:
    page(l.lower())
