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

<a id="ai-setup"></a>

## 「问 AI」两分钟上手||"Ask AI" in two minutes

:::zh
课程页右上角的 🤖 按钮会打开一个侧栏，AI 已经读过这一课，可以直接问；在正文里选中一句例句再点「问 AI」，它会针对那一节回答。它需要你自己的一个模型服务商 API key，推荐 **Groq**：免费、不用绑卡、回答基本秒出。

1. 打开 [console.groq.com/keys](https://console.groq.com/keys)，用 Google 或 GitHub 账号登录。
2. 点 **Create API Key**，起个名字，复制生成的 key（以 `gsk_` 开头）。
3. 回到任意课程页，点右上 🤖，选「Groq」，粘贴 key，点「连接并开始」。

注意别选成 **xAI Grok**，那是马斯克家的付费模型，名字只差一个字母。

**其他免费选择**

- 在国内：**智谱 GLM** 的 glm-4.7-flash 永久免费、不限量，在 [open.bigmodel.cn](https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys) 创建 key。
- **Google Gemini**：Flash 系列有免费额度，在 [aistudio.google.com](https://aistudio.google.com/apikey) 创建 key。
- 完全不出本机：装 [Ollama](https://ollama.com)，`ollama pull qwen3:14b`，然后按设置里的提示用 `OLLAMA_ORIGINS=https://jpnotes.dev ollama serve` 启动。本地 14B 模型一个问题要等 30 秒左右，设置里选「快速」可以跳过思考。

**常见问题**

- *提示 429 / rate limit*：Groq 免费档每分钟 8000 token，整课提问一次要 5–6k，所以约一分钟只能问一次。输入框上方的 📎 默认「跟随阅读位置」，只发送你正在看的那一节，字数少得多；也可以手动选某一节。
- *提示 Failed to fetch*：服务商不允许浏览器直连，或本地 Ollama 没有带 OLLAMA_ORIGINS 启动。换 Groq / OpenRouter 这类明确支持浏览器直连的服务商即可。
- *换服务商或模型*：点侧栏标题里的模型名，已配置的几家都在菜单里，随时切换；「思考深度」三档也在那里。

密钥只存在你的浏览器里，本站没有服务器，详见下面的隐私说明。
:::

:::en
The 🤖 button on every lesson page opens a side panel; the AI has already read the lesson, so just ask. Select an example sentence in the text and click "Ask AI" to ask about that grammar point specifically. It needs your own API key from a model provider. **Groq** is the easy choice: free, no card, answers in about a second.

1. Open [console.groq.com/keys](https://console.groq.com/keys) and sign in with Google or GitHub.
2. Click **Create API Key**, give it a name and copy the key (it starts with `gsk_`).
3. Back on any lesson page, click 🤖, pick "Groq", paste the key and click "Connect and start".

Do not pick **xAI Grok** by mistake; that is Elon Musk’s paid model, one letter apart.

**Other free options**

- **Google Gemini**: the Flash models have a free tier; create a key at [aistudio.google.com](https://aistudio.google.com/apikey).
- **OpenRouter**: one key for every model; models ending in `:free` cost nothing (50 requests a day).
- Fully local: install [Ollama](https://ollama.com), run `ollama pull qwen3:14b`, then start it as the settings hint says with `OLLAMA_ORIGINS=https://jpnotes.dev ollama serve`. A local 14B model takes about 30 s per question; the Quick setting skips its thinking phase.

**Troubleshooting**

- *429 / rate limit*: Groq’s free tier allows 8,000 tokens a minute and a whole-lesson question uses 5–6k, so roughly one question per minute. The 📎 selector above the input defaults to "follow my reading", which sends only the grammar point on screen and uses far fewer tokens; you can also pick a section by hand.
- *Failed to fetch*: the provider blocks browser calls, or local Ollama was started without OLLAMA_ORIGINS. Switch to a provider that supports browser calls, such as Groq or OpenRouter.
- *Switching providers or models*: click the model name in the panel header; every provider you have configured is in that menu, along with the three thinking-depth settings.

Your key never leaves your browser; this site has no server. See the privacy section below.
:::

<a id="ai-privacy"></a>

## 「问 AI」功能的隐私与安全||"Ask AI" privacy & security

:::zh
课程页右上角的 🤖「问 AI」侧栏可以把当前课的内容连同你的问题发给一个大模型。它的设计原则是：**本站永远拿不到你的密钥，也看不到你的对话。**

- **没有服务器。** 整站是 GitHub Pages 上的静态 HTML，没有后端、没有数据库。你填的 API key 只存在你这台设备的浏览器里（默认 localStorage；勾选「只在本次会话保存」则关闭标签页即清除）。
- **请求直连服务商。** 提问时，你的浏览器把这一课的正文和你的问题直接发到你选的服务商（Anthropic、OpenAI、DeepSeek、通义千问……或你本机的 Ollama）。中间没有任何中转。
- **浏览器层面的白名单。** 每个页面都带有 Content-Security-Policy 的 `connect-src` 规则，只允许连接本站、Google Analytics、预设的服务商域名，以及 localhost / 127.0.0.1。即使页面上某段脚本被篡改，浏览器也会拒绝把数据发往白名单之外的任何地址。
- **明文保护。** 设置里只接受 https:// 或本机地址；把服务商地址改成非官方域名时会显示醒目警告。
- **自行验证。** 按 F12 打开开发者工具的 Network 面板，再提一个问题：你只会看到对该服务商域名的请求。侧栏的[全部源码](https://github.com/Ralphbupt/japanese-grammar/blob/main/site/ai-assistant.js)只有一个文件，欢迎审阅。
- **本地方案。** 想完全不出本机，用 Ollama / LM Studio 跑本地模型即可，浏览器只会访问 localhost。

费用由你和服务商结算，本站不参与、不抽成。
:::

:::en
The 🤖 "Ask AI" side panel on lesson pages sends the current lesson plus your question to a large language model. Its design rule: **this site never receives your key and never sees your conversation.**

- **No server.** The whole site is static HTML on GitHub Pages: no backend, no database. Your API key exists only in your browser on your device (localStorage by default; tick "keep for this tab only" and it is cleared when the tab closes).
- **Direct to the provider.** When you ask, your browser sends the lesson text and your question straight to the provider you picked (Anthropic, OpenAI, DeepSeek, Qwen… or Ollama on your own machine). Nothing sits in between.
- **A browser-enforced allowlist.** Every page ships a Content-Security-Policy `connect-src` rule that only permits connections to this site, Google Analytics, the preset provider hosts, and localhost / 127.0.0.1. Even if a script on the page were tampered with, the browser would refuse to send data anywhere else.
- **No plain-text keys.** Settings accept only https:// or local URLs, and changing a provider's host to a non-official domain shows a prominent warning.
- **Verify it yourself.** Open DevTools (F12) → Network and ask a question: the only requests you will see go to that provider's domain. The panel's [entire source](https://github.com/Ralphbupt/japanese-grammar/blob/main/site/ai-assistant.js) is one file; reviews welcome.
- **Fully local option.** To keep everything on your machine, run a local model with Ollama or LM Studio; the browser then only talks to localhost.

Billing is between you and the provider; this site takes no part and no cut.
:::

## 播客||Podcast

:::zh
**[Japanese Daily News](https://podcast.jpnotes.dev/)** 是本站的姊妹播客——慢速日语新闻 + 英语解说，帮助学习者边听边学。网站上提供逐句精听、transcript 和 furigana 标注，Spotify / Apple Podcasts 同步更新。
:::

:::en
**[Japanese Daily News](https://podcast.jpnotes.dev/)** is our companion podcast — slow Japanese news with English commentary, designed for learners. The website offers sentence-by-sentence listening, transcripts with furigana, while episodes are also available on Spotify / Apple Podcasts.
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
