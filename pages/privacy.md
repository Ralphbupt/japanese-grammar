# 隐私政策||Privacy Policy

:::zh
最后更新：2026 年 11 月 24 日

jpnotes.dev 是一个人维护的免费日语学习网站。这一页集中说明本站收集什么、为什么收集、存在哪里、你可以怎么删除。各功能更细的说明在[关于页](/about/)对应的小节里。有任何问题，请写信到 hello@jpnotes.dev。
:::

:::en
Last updated: 24 November 2026

jpnotes.dev is a free Japanese study site run by one person. This page sets out what the site collects, why, where it is kept and how to delete it. Each feature is described in more detail in the matching section of the [About page](/about/). Questions: hello@jpnotes.dev.
:::

## 不登录时||Without an account

:::zh
- **学习进度、设置、生词本、本机笔记**都存在你自己浏览器的 localStorage 里，本站服务器收不到。清除浏览器数据就会删除。
- **访问统计**：本站用 Google Analytics 4 统计页面浏览和功能使用（比如答了多少题、点了哪个按钮），用来改进网站。它会在浏览器里存一个随机编号的 Cookie（`_ga`），不包含你的姓名或邮箱。在任意页面网址后加 `?ga_off` 打开一次，这个浏览器就不再发送统计；`?ga_on` 可以恢复。本站还使用不设 Cookie 的 Cloudflare Web Analytics。
- **功能实验**：为了比较两种设计哪个更好用，页面会随机分组并在浏览器里记住分组（`jp_ab`），只发送匿名的计数（看到了哪一组、答了几题），不含任何个人标识。
- **服务器日志**：网站和接口运行在 Cloudflare 上，本站关闭了请求日志。Cloudflare 作为基础设施会处理 IP 地址等网络信息，见其[隐私政策](https://www.cloudflare.com/privacypolicy/)。
:::

:::en
- **Progress, settings, word list and notes kept on this device** live in your browser's localStorage; the site's server never receives them. Clearing your browser data deletes them.
- **Analytics**: the site uses Google Analytics 4 to count page views and feature use (questions answered, buttons pressed) so it can be improved. It stores a cookie with a random number (`_ga`), not your name or email. Open any page once with `?ga_off` added to the address and this browser stops sending analytics; `?ga_on` turns it back on. The site also uses Cloudflare Web Analytics, which sets no cookies.
- **Experiments**: to compare two designs, pages put each browser in a random group and remember it (`jp_ab`); only anonymous counts are sent (which group was shown, how many questions were answered), with no personal identifier.
- **Server logs**: the site and its APIs run on Cloudflare with request logging turned off. As the infrastructure provider, Cloudflare processes network data such as IP addresses; see its [privacy policy](https://www.cloudflare.com/privacypolicy/).
:::

## 广告||Advertising

:::zh
本站目前没有广告。将来如果通过 Google AdSense 展示广告：

- Google 等第三方供应商会使用 Cookie，根据你以前访问本站或其他网站的情况展示广告。
- Google 使用广告 Cookie，使它和合作伙伴能根据你访问本站和互联网上其他网站的情况向你展示广告。
- 你可以在 [Google 广告设置](https://adssettings.google.com/)里关闭个性化广告，也可以在 [www.aboutads.info](https://www.aboutads.info/) 退出部分第三方供应商的个性化广告 Cookie。
- 在需要征得同意的地区（如欧洲经济区、英国），展示个性化广告前会先请你同意。
:::

:::en
The site shows no ads at present. If it shows ads through Google AdSense in the future:

- Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this site or other websites.
- Google's use of advertising cookies enables it and its partners to serve ads to you based on your visits to this site and/or other sites on the Internet.
- You can opt out of personalised advertising in [Google's Ads Settings](https://adssettings.google.com/), and opt out of some third-party vendors' cookies at [www.aboutads.info](https://www.aboutads.info/).
- Where consent is required (such as the EEA and the UK), you will be asked before personalised ads are shown.
:::

## 登录、同步和笔记||Accounts, sync and notes

:::zh
登录完全可选（Google 账号或邮箱验证码）。登录后保存你的邮箱、做题进度和你写的笔记，用来在设备之间同步。笔记默认私有；你选择公开的笔记会先经过规则检查和 AI（Anthropic 的 Claude）审核，审核通过后所有人可见，只显示昵称和印章头像，不显示邮箱。详细说明见[登录与同步](/about/#account-privacy)和[笔记的隐私](/about/#notes-privacy)。
:::

:::en
Signing in is optional (a Google account or an email code). Once signed in, the site keeps your email address, your practice progress and the notes you write, so they sync across your devices. Notes are private by default; notes you choose to make public go through a few rules and an AI review (Anthropic's Claude) before others can see them, under your nickname and seal, never your email. Details: [sign-in and sync](/about/#account-privacy) and [notes](/about/#notes-privacy).
:::

## 「问 AI」和反馈||Ask AI and feedback

:::zh
- **问 AI**：你的问题和当前页面的相关内容会经本站的中转服务发给 AI 模型（Anthropic 的 Claude，或 Cloudflare Workers AI）来生成回答。中转服务不记录对话内容；对话记录只存在你的浏览器里。详见[问 AI 的隐私](/about/#ai-privacy)。
- **反馈**：你通过反馈框发送的文字会保存下来，方便站长阅读和回复。留了邮箱的，回复后会立刻删除邮箱，没回复的最多保留 90 天。为防止滥发，会保存一个按日期加盐的 IP 哈希，用来限制每天的提交次数。
:::

:::en
- **Ask AI**: your question and the relevant part of the page go through the site's relay to an AI model (Anthropic's Claude, or Cloudflare Workers AI) to produce the answer. The relay keeps no record of conversations; your chat history is kept only in your browser. See [Ask AI privacy](/about/#ai-privacy).
- **Feedback**: what you send through the feedback box is kept so the site owner can read and answer it. An email address you leave is deleted as soon as the reply is sent, and after 90 days at most otherwise. To stop abuse, a hash of your IP salted with the date is kept to cap submissions per day.
:::

## 你的权利||Your choices

:::zh
- 随时可以在账号面板导出、清空进度，或删除账号和云端数据（笔记一起删除）。
- 想要查看、更正或删除你的数据，或者对本站处理数据的方式有疑问，请写信到 hello@jpnotes.dev，一般几天内回复。
- 本站不出售任何个人信息，也不把它们交给第三方用于营销。
- 本站面向学习日语的一般用户，不针对 13 岁以下儿童。
:::

:::en
- You can export or clear your progress, or delete your account and synced data (notes included), from the account panel at any time.
- To see, correct or delete your data, or with any question about how it is handled, write to hello@jpnotes.dev; replies usually come within a few days.
- The site never sells personal information or passes it on for marketing.
- The site is for general learners of Japanese and is not directed at children under 13.
:::

## 变更||Changes

:::zh
这份政策如有变化，会更新本页顶部的日期，重要变化会写进[更新日志](/changelog/)。
:::

:::en
If this policy changes, the date at the top of this page is updated, and notable changes go into the [changelog](/changelog/).
:::
