# 关于本站||About

## 这是什么||What is this

:::zh
「日语语法笔记」是一份免费、双语（中文 + 日语）的 JLPT N5 → N2 语法学习材料，按 **8 周节奏**规划，共 **73 课、400+ 个语法点**。每个语法点包含：

- **接续规则**：动词 / 形容词 / 名词的具体接续方式
- **3+ 例句**：覆盖日常对话和考试常见语境
- **辨析**：和易混淆语法的对比（如「は」vs「が」、「たら」vs「なら」）
- **易错点**：中文母语者特别容易踩的坑
- **间隔复习**：当天 → 1 → 4 → 7 → 14 → 30 天勾选清单

内容免费、无广告、无追踪。
:::

:::en
"Japanese Grammar Notes" is a free, bilingual (Chinese + Japanese) JLPT N5 → N2 grammar study set, structured as an **8-week curriculum** of **73 lessons covering 400+ grammar points**. Each grammar point includes:

- **Conjugation rules**: how it combines with verbs / adjectives / nouns
- **3+ example sentences**: covering daily conversation and exam-style contexts
- **Comparisons**: side-by-side with easily confused grammar (e.g. は vs. が, たら vs. なら)
- **Common pitfalls**: mistakes Chinese native speakers tend to make
- **Spaced repetition**: review checklist for day 0 → 1 → 4 → 7 → 14 → 30

Free, no ads, no tracking.
:::

## 为什么做这个||Why I built it

:::zh
我从 2026 年 4 月开始系统学日语，目标 8 周内拿下 JLPT N2。准备过程中发现：

- 中文圈的日语语法资料要么过于碎片化（散落在各种论坛、知乎回答），要么过于学院派
- 教科书（《大家的日本语》《新完全マスター》等）对中文母语者来说，「中文翻译」和「中文讲解」之间有断层——很多语感差异翻译里讲不清楚
- 没有一份完整覆盖 N5 → N2、又用**中文母语者视角**讲解的免费在线资料

所以我决定**边学边记**，把整套笔记开源出来。最初是给自己复习用，后来发现可能对其他中文母语日语学习者也有用，于是托管成网站。
:::

:::en
I started studying Japanese seriously in April 2026, aiming for JLPT N2 in 8 weeks. While preparing, I noticed:

- Chinese-language Japanese grammar material online is either too fragmented (scattered across forums and Q&A sites) or too academic
- Textbooks (*Minna no Nihongo*, *Shin Kanzen Master*) leave a gap between "Chinese translation" and "explanation tuned for Chinese speakers" — much of the nuance gets lost
- No single resource covers N5 → N2 completely while explaining from a **Chinese-native-speaker perspective**

So I decided to **take notes as I learn** and open-source everything. It started as a personal study aid; publishing it as a website was a side effect.
:::

## 关于作者||About the author

:::zh
- GitHub：[Ralphbupt](https://github.com/Ralphbupt)
- 邮箱：[pengcheng199@gmail.com](mailto:pengcheng199@gmail.com)
- 这是**个人项目**，无团队、无商业目的
- 目前 JLPT 级别：学习中（按本站节奏从 N5 推进到 N2）
- 反馈渠道首选 [GitHub Issues](https://github.com/Ralphbupt/japanese-grammar/issues)（公开追踪、其他读者也能看到），邮箱用于一对一的隐私沟通
:::

:::en
- GitHub: [Ralphbupt](https://github.com/Ralphbupt)
- Email: [pengcheng199@gmail.com](mailto:pengcheng199@gmail.com)
- This is a **personal project** — no team, no commercial intent
- Current JLPT level: studying (progressing N5 → N2 along with this site)
- Preferred channel: [GitHub Issues](https://github.com/Ralphbupt/japanese-grammar/issues) for public tracking; email for private discussion
:::

## 内容生产方式||How content is produced

:::zh
每节课的笔记结构来自我自己学日语的实际节奏。例句和辨析参考了：

- **教科书**：《大家的日本语 初级 I / II》、《新完全マスター 文法 N3 / N2》、《日本語総まとめ N3 / N2 文法》
- **在线参考**：[沪江日语](https://jp.hjenglish.com/)、[Bunpro](https://bunpro.jp/)、[Tofugu](https://www.tofugu.com/)、[日本語教師の広場](https://nihongokyoshi-net.com/)
- **真题**：JLPT 历年 N5 - N2 文法真题（公开发布部分）

每个语法点完成后，会在我自己的学习中先验证 **2-3 周**（用配套的间隔复习清单），确认讲解清晰、例句到位之后再公开发布。

> 如果你发现某个例句直接来自上述资料而我没标注出处，请提 issue，我会立刻修正。
:::

:::en
The lesson structure follows my actual study pace. Example sentences and comparisons reference:

- **Textbooks**: *Minna no Nihongo I/II*, *Shin Kanzen Master Bunpou N3/N2*, *Nihongo Sou Matome N3/N2 Bunpou*
- **Online**: [Hujiang Japanese](https://jp.hjenglish.com/), [Bunpro](https://bunpro.jp/), [Tofugu](https://www.tofugu.com/), [Nihongo Kyoushi no Hiroba](https://nihongokyoshi-net.com/)
- **Past exams**: publicly released JLPT N5–N2 grammar questions

Each grammar point is validated through **2–3 weeks** of my own study (using the built-in spaced-repetition checklist) before being published.

> If you find an example sentence that directly comes from a referenced source without proper attribution, please file an issue — I'll fix it immediately.
:::

## 站点开源||Open source

:::zh
整个站的源代码（build 脚本、全部 markdown 内容）都在 GitHub：

**[https://github.com/Ralphbupt/japanese-grammar](https://github.com/Ralphbupt/japanese-grammar)**

技术栈：

- **marked**：Markdown → HTML
- **kuroshiro + kuromoji**：自动给汉字加 furigana 注音
- **sharp**：生成 OG 图片
- **GitHub Pages + Cloudflare Registrar**：托管 + 自定义域名 jpnotes.dev

完全**静态站点**，无后端、无数据库、无 cookies。每次推送 main 分支，GitHub Actions 自动构建并部署。
:::

:::en
The full source code (build scripts, all markdown content) is on GitHub:

**[https://github.com/Ralphbupt/japanese-grammar](https://github.com/Ralphbupt/japanese-grammar)**

Tech stack:

- **marked**: Markdown → HTML
- **kuroshiro + kuromoji**: automatic furigana annotation on kanji
- **sharp**: OG image generation
- **GitHub Pages + Cloudflare Registrar**: hosting + custom domain (jpnotes.dev)

Pure **static site** — no backend, no database, no cookies. Every push to main triggers a GitHub Actions build and deploy.
:::

## 反馈与贡献||Feedback and contributions

:::zh
发现错别字？例句别扭？讲解不清楚？

- **GitHub Issues**：[提交 issue](https://github.com/Ralphbupt/japanese-grammar/issues)（推荐，公开追踪）
- **GitHub PR**：直接提交修复，特别欢迎补充例句和易错点对比
- **邮箱**：[pengcheng199@gmail.com](mailto:pengcheng199@gmail.com)

我会回复每一个反馈。
:::

:::en
Found a typo? Awkward example? Unclear explanation?

- **GitHub Issues**: [open an issue](https://github.com/Ralphbupt/japanese-grammar/issues) — recommended, publicly tracked
- **GitHub PR**: submit a fix directly; additions to examples and comparison notes especially welcome
- **Email**: [pengcheng199@gmail.com](mailto:pengcheng199@gmail.com)

I respond to every piece of feedback.
:::

## 许可||License

:::zh
内容采用 **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh)** 许可：

- ✅ 自由分享、引用、改编、用于教学（包括商业教学）
- ✅ 标注来源即可（链接到 jpnotes.dev）
- ❌ 不要做**全站镜像**——会稀释 Google 索引，对原站和镜像都没好处。引用任意片段、章节都欢迎，但请不要批量复制整个语法点列表
:::

:::en
Content is licensed under **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**:

- ✅ Free to share, quote, adapt, use for teaching (including commercial teaching)
- ✅ Just attribute the source (link to jpnotes.dev)
- ❌ Please don't mirror the entire site — full mirrors dilute Google's index and hurt both the original and the mirror. Quote any snippet or chapter freely, but please don't bulk-copy the entire grammar point catalog
:::
