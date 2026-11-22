# JLPT 估分器||JLPT Score Calculator

:::zh
刚考完 JLPT，想知道自己能不能过？在下面选级别，填上每个部分大概答对了几道题，马上算出各科估分、总分，以及有没有过**总分线和单科线**。题量默认按正式考试的题型设置，和你那场不一样可以直接改。也可以用它给模拟题、真题估分。
:::
:::en
Just sat the JLPT and wondering whether you passed? Pick your level, enter roughly how many questions you got right in each part, and see your estimated section scores, your total, and whether you clear **both the overall pass mark and every section minimum**. Question counts default to the real test's layout; change them if your paper differed. It works for practice tests and past papers too.
:::

<div id="sc-app" class="sc-app" aria-live="polite"></div>

## 怎么算的||How the Estimate Works

:::zh
- 每个计分科目：**答对题数 ÷ 总题数 × 该科满分**。N1–N3 有三个计分科目（言语知识、阅读、听力，各 60 分）；N4、N5 的言语知识和阅读合在一起算（120 分），听力 60 分。
- 合格要两条都满足：总分达到合格线，**并且**每个计分科目都不低于单科最低分（60 分的科目是 19 分，N4/N5 的 120 分科目是 38 分）。
- 这是**估算**。正式成绩是"尺度得点"：不同题型、不同题目的分值不一样，还会按整场考试的难度做等化处理，所以没人能从答对题数精确算出分数。经验上每科可能差 ±5 分左右，离线越近越要当心。
:::
:::en
- Each scored section: **correct ÷ total × that section's maximum**. N1–N3 have three scored sections (Language Knowledge, Reading, Listening, 60 points each); N4 and N5 score Language Knowledge and Reading together (120) plus Listening (60).
- To pass you need both: the overall pass mark **and** at least the minimum in every scored section (19 for a 60-point section, 38 for the 120-point section at N4/N5).
- It's an **estimate**. Real JLPT scores are scaled: item types and individual questions carry different weights and scores are equated across test forms, so nobody can turn a count of correct answers into an exact score. Expect roughly ±5 points per section; the closer you are to a cut-off, the less the estimate tells you.
:::

## 合格线一览||Pass Marks at a Glance

:::zh
| 级别 | 总分合格线 | 单科最低分 |
|------|------|------|
| N1 | 100 / 180 | 言语知识 19・阅读 19・听力 19 |
| N2 | 90 / 180 | 言语知识 19・阅读 19・听力 19 |
| N3 | 95 / 180 | 言语知识 19・阅读 19・听力 19 |
| N4 | 90 / 180 | 言语知识・阅读 38・听力 19 |
| N5 | 80 / 180 | 言语知识・阅读 38・听力 19 |
:::
:::en
| Level | Overall pass mark | Section minimums |
|------|------|------|
| N1 | 100 / 180 | Language Knowledge 19, Reading 19, Listening 19 |
| N2 | 90 / 180 | Language Knowledge 19, Reading 19, Listening 19 |
| N3 | 95 / 180 | Language Knowledge 19, Reading 19, Listening 19 |
| N4 | 90 / 180 | Language Knowledge & Reading 38, Listening 19 |
| N5 | 80 / 180 | Language Knowledge & Reading 38, Listening 19 |
:::

## 常见问题||FAQ

### N2 错几道还能过？||How many questions can I miss and still pass N2?

:::zh
没有固定答案，因为分值不是每题一样。粗略地说，N2 总分要 90 / 180，也就是平均每科一半；如果三科都答对一半左右，估分就在线附近。比"错几道"更要紧的是单科线：任何一科低于 19 分，总分再高也不合格。
:::
:::en
There's no fixed number, because questions aren't worth the same. Roughly, N2 needs 90 of 180 — half of each section on average — so about half right in all three puts you near the line. The section minimum matters more than the count: under 19 in any section is a fail whatever your total.
:::

### 什么时候出成绩？||When do December results come out?

:::zh
日本国内考生的成绩单 2 月上旬寄出，MyJLPT 一般更早可以在网上查；海外考生由当地主办机构发布，很多地区（包括中国大陆）可以先在报名网站查询。详见 [12 月 JLPT 考前指南](/jlpt-december-2026/)。
:::
:::en
In Japan, score reports are mailed in early February and MyJLPT usually shows results online earlier; overseas, the local host institution publishes them, and many regions (including mainland China) post results on the registration site first. See the [December JLPT guide](/jlpt-december-2026/).
:::

### 想在考前知道自己大概几分？||Want a score before the exam?

:::zh
做一套 [模拟题](/mock-test/)：按正式考试的题型和时间，交卷后直接按科目给出估分和合格判断。平时练习也会在 [练习题](/n2-practice/) 的「做题分析」里显示各科的大致分数。
:::
:::en
Take a [mock test](/mock-test/): the real test's item types and timing, with a score per section and a pass/fail estimate when you submit. The practice pages (for example [N2 practice](/n2-practice/)) also show a rough score per section under "Analysis".
:::

## 相关页面||Related Pages

:::zh
- [12 月 JLPT 考前指南](/jlpt-december-2026/)：考试时长、合格线、考试当天清单
- [JLPT 模拟题](/mock-test/)・[听力练习](/listening/)
- 做题技巧：[文字词汇与语法](/jlpt-vocabulary-grammar-tips/)・[阅读](/jlpt-reading-tips/)・[听力](/jlpt-listening-tips/)
:::
:::en
- [December JLPT guide](/jlpt-december-2026/): timing, pass marks, exam-day checklist
- [JLPT mock tests](/mock-test/) · [listening practice](/listening/)
- Tips: [vocabulary & grammar](/jlpt-vocabulary-grammar-tips/) · [reading](/jlpt-reading-tips/) · [listening](/jlpt-listening-tips/)
:::

<style>
.sc-app{margin:1.2rem 0 1.6rem;padding:1rem 1.1rem;border:1px solid var(--border,#ddd);border-radius:12px;background:var(--surface-2,transparent)}
.sc-lv{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 .9rem}
.sc-lv button{font:inherit;padding:.35rem .9rem;border-radius:16px;border:1px solid var(--border,#ccc);background:transparent;color:var(--ui);cursor:pointer}
.sc-lv button[aria-pressed=true]{background:var(--ui);color:var(--ui-on);border-color:var(--ui)}
.sc-sec{display:grid;grid-template-columns:1fr auto;gap:.2rem .8rem;align-items:center;padding:.55rem 0;border-top:1px solid var(--border,#e5e5e5)}
.sc-sec h3{margin:0;font-size:1rem}.sc-sec .sc-parts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:.4rem 1rem;font-size:.9rem}
.sc-sec label{display:inline-flex;align-items:center;gap:.3rem}
.sc-sec input{width:3.6rem;font:inherit;padding:.25rem .35rem;border-radius:6px;border:1px solid var(--border,#ccc);background:var(--bg);color:inherit;text-align:right}
.sc-pts{font-weight:700;font-size:1.1rem;white-space:nowrap}.sc-pts small{font-weight:400;color:var(--text-muted)}
.sc-ok{color:var(--text-muted)}.sc-bad{color:var(--accent)}
.sc-res{margin-top:.8rem;padding:.8rem .9rem;border-radius:10px;background:var(--chip-bg)}
.sc-res .sc-big{font-size:1.5rem;font-weight:700;margin:0 0 .2rem}.sc-res p{margin:.25rem 0}
.sc-note{font-size:.82rem;color:var(--text-muted);margin:.6rem 0 0}
</style>
<script>
(function () {
  var app = document.getElementById("sc-app");
  if (!app) return;
  var zh = (document.documentElement.lang || "").indexOf("zh") === 0;
  var T = function (z, e) { return zh ? z : e; };
  // Default question counts follow the real test's layout (the same layout as the site's mock tests).
  var L = {
    N1: { pass: 100, secs: [
      { k: "gengo", zh: "言语知识（文字・语汇・语法）", en: "Language Knowledge (vocabulary & grammar)", max: 60, min: 19, parts: [["文字・语汇", "Vocabulary", 25], ["语法", "Grammar", 19]] },
      { k: "dokkai", zh: "阅读", en: "Reading", max: 60, min: 19, parts: [["阅读", "Reading", 22]] },
      { k: "choukai", zh: "听力", en: "Listening", max: 60, min: 19, parts: [["听力", "Listening", 30]] }] },
    N2: { pass: 90, secs: [
      { k: "gengo", zh: "言语知识（文字・语汇・语法）", en: "Language Knowledge (vocabulary & grammar)", max: 60, min: 19, parts: [["文字・语汇", "Vocabulary", 30], ["语法", "Grammar", 21]] },
      { k: "dokkai", zh: "阅读", en: "Reading", max: 60, min: 19, parts: [["阅读", "Reading", 20]] },
      { k: "choukai", zh: "听力", en: "Listening", max: 60, min: 19, parts: [["听力", "Listening", 30]] }] },
    N3: { pass: 95, secs: [
      { k: "gengo", zh: "言语知识（文字・语汇・语法）", en: "Language Knowledge (vocabulary & grammar)", max: 60, min: 19, parts: [["文字・语汇", "Vocabulary", 35], ["语法", "Grammar", 22]] },
      { k: "dokkai", zh: "阅读", en: "Reading", max: 60, min: 19, parts: [["阅读", "Reading", 16]] },
      { k: "choukai", zh: "听力", en: "Listening", max: 60, min: 19, parts: [["听力", "Listening", 28]] }] },
    N4: { pass: 90, secs: [
      { k: "gengo", zh: "言语知识（文字・语汇・语法）・阅读", en: "Language Knowledge & Reading", max: 120, min: 38, parts: [["文字・语汇", "Vocabulary", 28], ["语法", "Grammar", 21], ["阅读", "Reading", 8]] },
      { k: "choukai", zh: "听力", en: "Listening", max: 60, min: 19, parts: [["听力", "Listening", 28]] }] },
    N5: { pass: 80, secs: [
      { k: "gengo", zh: "言语知识（文字・语汇・语法）・阅读", en: "Language Knowledge & Reading", max: 120, min: 38, parts: [["文字・语汇", "Vocabulary", 21], ["语法", "Grammar", 17], ["阅读", "Reading", 5]] },
      { k: "choukai", zh: "听力", en: "Listening", max: 60, min: 19, parts: [["听力", "Listening", 24]] }] },
  };
  var KEY = "jp_score_calc", st = {};
  try { st = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { st = {}; }
  var lv = L[st.lv] ? st.lv : (L[(location.hash || "").slice(1).toUpperCase()] ? location.hash.slice(1).toUpperCase() : "N2");
  var vals = st.v || {}, sent = {};
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ lv: lv, v: vals })); } catch (e) {} }
  function num(x, d) { var n = parseInt(x, 10); return isNaN(n) ? d : n; }
  function render() {
    var cfg = L[lv], h = '<div class="sc-lv" role="group" aria-label="' + T("级别", "Level") + '">';
    Object.keys(L).forEach(function (k) { h += '<button type="button" data-lv="' + k + '" aria-pressed="' + (k === lv) + '">' + k + "</button>"; });
    h += "</div>";
    cfg.secs.forEach(function (s, i) {
      h += '<div class="sc-sec"><h3>' + (zh ? s.zh : s.en) + '</h3><span class="sc-pts" id="sc-p' + i + '"></span><div class="sc-parts">';
      s.parts.forEach(function (p, j) {
        var id = lv + "." + s.k + "." + j, v = vals[id] || {};
        h += "<label>" + (s.parts.length > 1 ? T(p[0] + " 答对", p[1] + ": correct") : T("答对", "Correct")) +
          ' <input type="number" inputmode="numeric" min="0" data-id="' + id + '" data-f="c" value="' + (v.c != null ? v.c : "") + '" placeholder="' + Math.round(p[2] / 2) + '"> / ' +
          '<input type="number" inputmode="numeric" min="1" data-id="' + id + '" data-f="t" value="' + (v.t != null ? v.t : p[2]) + '" aria-label="' + T("总题数", "questions") + '"></label>';
      });
      h += "</div></div>";
    });
    h += '<div class="sc-res" id="sc-res"></div><p class="sc-note">' +
      T("空着的格子按一半计算。估算：同一科里每题按相同分值算；正式成绩按题型加权并做等化，每科可能差 ±5 分左右。",
        "Empty boxes count as half right. An estimate: every question in a section counts the same here; real scores weight item types and are equated, so expect about ±5 per section.") + "</p>";
    app.innerHTML = h;
    calc();
  }
  function calc() {
    var cfg = L[lv], total = 0, fails = [], filled = 0;
    cfg.secs.forEach(function (s, i) {
      var c = 0, t = 0;
      s.parts.forEach(function (p, j) {
        var v = vals[lv + "." + s.k + "." + j] || {}, tt = Math.max(1, num(v.t, p[2])), cc = v.c == null || v.c === "" ? tt / 2 : Math.min(tt, Math.max(0, num(v.c, 0)));
        if (v.c != null && v.c !== "") filled++;
        c += cc; t += tt;
      });
      var pts = Math.round(c / t * s.max), ok = pts >= s.min;
      total += pts;
      if (!ok) fails.push(zh ? s.zh : s.en);
      document.getElementById("sc-p" + i).innerHTML = '<span class="' + (ok ? "sc-ok" : "sc-bad") + '">' + (ok ? "✓ " : "✗ ") + "</span>" + pts + " <small>/ " + s.max + T("（线 ", " (min ") + s.min + T("）", ")") + "</small>";
    });
    var res = document.getElementById("sc-res");
    if (!filled) {
      res.innerHTML = "<p>" + T("在上面填上每部分答对的题数（大概的数就行），这里显示估分和能不能过。" + lv + " 合格线 " + cfg.pass + " / 180。",
        "Enter how many you got right in each part above (a rough number is fine) to see your estimate. " + lv + " pass mark: " + cfg.pass + " / 180.") + "</p>";
      return;
    }
    var pass = total >= cfg.pass && !fails.length, gap = total - cfg.pass;
    var msg = pass
      ? (gap >= 15 ? T("按这个估分，比较稳。", "On this estimate, a comfortable pass.") : T("按这个估分能过，但离线不远，最终要看正式成绩。", "On this estimate you pass, but it's close — wait for the real score."))
      : fails.length
        ? T("单科没过线：", "Below a section minimum: ") + fails.join(T("、", ", ")) + T("。总分再高也不合格。", ". That's a fail whatever the total.")
        : T("总分差 ", "Short of the pass mark by ") + (-gap) + T(" 分。", " points.");
    res.innerHTML = '<p class="sc-big">' + (pass ? T("估计合格", "Likely pass") : T("估计不合格", "Likely fail")) + " · " + total + " / 180</p><p>" +
      T(lv + " 合格线 ", lv + " pass mark ") + cfg.pass + T(" 分（另需每科过单科线）。", " (plus every section minimum).") + "</p><p>" + msg + "</p>";
    if (!sent[lv] && window.gaEvent) { sent[lv] = 1; try { window.gaEvent("score_calc", { level: lv, pass: pass ? 1 : 0 }); } catch (e) {} }
  }
  app.addEventListener("click", function (e) {
    var b = e.target.closest("[data-lv]");
    if (!b) return;
    lv = b.getAttribute("data-lv"); save(); render();
  });
  app.addEventListener("input", function (e) {
    var el = e.target, id = el.getAttribute("data-id");
    if (!id) return;
    vals[id] = vals[id] || {};
    vals[id][el.getAttribute("data-f")] = el.value === "" ? null : el.value;
    save(); calc();
  });
  render();
})();
</script>
