# 🧭 AI 副业指南针 · SideHustle Hub

一个纯静态、零依赖、可直接部署到 **GitHub Pages / Vercel / Cloudflare Pages** 的交互式网站：

- 💰 **AI 副业思路库** —— 精选自 [XiaomingX/ai-money-maker-handbook](https://github.com/XiaomingX/ai-money-maker-handbook)：36 个经过验证的 AI 副业方案，每个都带**分步操作**（目标 / 做法 / 完成标志）、成本、周期、收入区间、工具链接、定价、风险与第一周计划，并附**对标账号**（去哪里找、搜什么关键词、盯什么细节），支持分类、搜索、排序与收藏。
- 💼 **远程工作渠道板** —— 精选自 [lukasz-madon/awesome-remote-job](https://github.com/lukasz-madon/awesome-remote-job)：48+ 个正规远程求职网站、聚合器与自由职业平台。
- 📡 **每日自动更新（四条链路）** —— GitHub Actions 每天北京时间 09:30 自动抓取：
  - **工作板** `scripts/fetch-jobs.mjs` → `data/daily-updates.json`：Remotive / Remote OK / We Work Remotely / HN「Who is hiring?」远程职位；
  - **副业新机会** `scripts/fetch-hustles.mjs` → `data/daily-hustles.json`：GitHub 新仓库 + HN Show HN + Product Hunt，自动归类到 7 个副业分类；**用「星数增速」而不是「在榜天数」判定真风口** —— 记录每天的星数快照（`data/hustle-history.json`，保留 30 天），算出日环比增速：日增超过阈值的打 **🔥 风口加速中（+x%）**，增速放缓但仍在榜的打 **🔥 持续热度 N 天**，首天上榜的打 🆕；列表默认按增速排序，一次性噪声会被直接压到后面；
  - **在线学习流** `scripts/fetch-learn.mjs` → `data/daily-learn.json`：5 个赛道（编程 / AI 学习 / K12 学习 / 语言考证 / 中文效率），接入 dev.to、freeCodeCamp、arXiv、哔哩哔哩、[wordfeel.cc](https://wordfeel.cc/) 场景剧场、[TapTapGo](https://taptapgo.yldm.ai/app/)、少数派、36氪。K12 赛道额外拆了**学段二级筛选**（小学 / 初中 / 高中 / 跨学段），家长不用在一堆卡片里翻“三年级数学”；

  - **中国独立开发动态** `scripts/fetch-indie.mjs` → `data/indie.json`：抓取公开仓库 [1c7/chinese-independent-developer](https://github.com/1c7/chinese-independent-developer)（中文独立开发者项目清单），按关键词自动归成 8 个品类，并识别简介里的**变现信号**（收费 / 免费引流 / 广告 / 本地交付）。看板的核心不是罗列项目，而是给出两个判断：**拥挤榜**（AI 类 49 个、内容类 16 个扎堆 = 别硬冲）与**冷门方向**（游戏类只有 2 个 = 还能做什么），用来回答“我现在做这个会不会太晚”。
  
  数据提交后网站即自动更新，无需服务器。
- 🔭 **深度情报（可选）** —— 配置 [sieve](https://scrape.usesieve.com) 后，每天用 scrape API 对热门 AI 副业做一次情报侦察（平台规则变化、本周公开机会、可执行行动），写入 `data/daily-scout.json`；所有机会带原文链接可核验真伪。未配置时该板块自动隐藏，站点与其他数据源完全不受影响。
- 🛠️ **落地手册页**（少介绍、多实操）—— 端到端教程（每步带「做到什么程度算完成」的可验证标志 + 真实工具成本 + 这一步最容易卡住的地方 + 一个诚实的收入预期）、7 天启动清单（可勾选、进度存本机、可一键复制带走）、踩坑墙（11 条高频坑 + 自己记的坑，可导出分享）。副业库回答「能赚多少」，这里回答「第一天打开什么软件、卡住了怎么办、第一个钱从哪来」。
- 📈 **变现看板（把「读了」变成「赚了」）** —— 站点内置的唯一闭环环节：记一笔收入（分类 / 投入时长 / 金额 / 日期 / 备注），自动算出**累计收入、有效时薪、本月收入、单均收入、累计投入**五个 KPI，再对比「你的时薪 vs 平台平均」，配 8 个阶段里程碑（从第一笔 1 元到月入过万）逐步点亮，还能一键导出成就页发到朋友圈。**纯浏览器 localStorage，不上传任何数据、没有服务器**，隐私在页面上写清楚。
- 💬 **人人可参与的交流入口** —— 不用注册、不用登录：预填好标题正文的 GitHub Issue 按钮（提问 / 分享跑通经验 / 报 bug），后来人搜到同一个坑能少走一遍弯路。
- 📚 **学习成长区** —— 远程工作必读文章、书籍、播客、Newsletter 与面试工具。

- 🇨🇳 **中国独立开发者在做什么** —— 抓取 [1c7/chinese-independent-developer](https://github.com/1c7/chinese-independent-developer) 每天的新提交，目前 119 个项目 / 104 位开发者。**拥挤榜告诉你别冲什么，冷门方向告诉你还能做什么**，再叠一层变现方式筛选（明说收费 / 免费引流 / 广告 / 本地交付）。有意思的结论是：119 个项目里超过一半明说「免费」——先免费跑通再谈钱，是这批人的主流打法而不是失败。
- ⭐ **收藏 + 深色模式 + 全文搜索** —— 数据保存在浏览器本地。

## 快速开始

```bash
# 本地预览（任选其一）
npx serve .
python3 -m http.server 8080
```

> 直接双击打开 index.html 也可以，但由于浏览器的 fetch 限制，「今日更新」会显示内置降级数据；起一个本地静态服务器即可看到完整效果。

## 手动更新职位数据

```bash
node scripts/fetch-jobs.mjs
```

脚本会把最新职位写入 `data/daily-updates.json`（Node 18+ 原生 fetch，无任何依赖）。

## 手动更新副业新机会与学习流

```bash
node scripts/fetch-hustles.mjs   # → data/daily-hustles.json（副业新机会）
node scripts/fetch-learn.mjs      # → data/daily-learn.json（在线学习流）

node scripts/fetch-indie.mjs     # → data/indie.json（中国独立开发动态）
```

三个脚本同样零依赖，单个数据源失败只会在产物 `errors` 字段里记录，不影响其他源；页面上的「部分来源失败：N」角标就是这个计数。

## 可选：配置 GITHUB_TOKEN（强烈建议）

`fetch-hustles.mjs` 会用 GitHub Search 找近期新仓库。**匿名调用只有 10 次/分钟**，容易触发 403/504，导致当天少几条新机会。配置 token 后限流提到 5000 次/分钟：

1. GitHub 右上角头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token；
2. 只需勾 **Public repositories (read-only)**（纯只读搜索，用不到写权限）；
3. 复制 token 到仓库 **Settings → Secrets and variables → Actions → New repository secret**，名字填 `GITHUB_TOKEN`；
4. 下次定时任务自动生效。也可直接复制 `.env.example` 为 `.env` 在本地填 `GITHUB_TOKEN=`（`.env` 已被 gitignore）。

不配置也能跑，脚本会自动退回匿名模式。

## 可选：启用 sieve 深度情报

1. 手动配置 API key（key 只进 `.env`，不进 git / 日志 / 前端）：

   在 sieve 控制台 Settings → API keys 创建一个 key，复制 `.env.example` 为 `.env`，把 key 填进 `SIEVE_API_KEY=`：

```bash
# .env
SIEVE_API_KEY=dc_sk_xxxxxxxxxxxxxxxx
```

2. 手动跑一次侦察（约几分钟，消耗少量 sieve 额度）：

```bash
node scripts/sieve-daily-scout.mjs --once
```

3. 中断可恢复：session 会先持久化到 `data/sieve-sessions.json`，崩溃后重跑同一命令会继续轮询而不是重复开跑（POST /api/scrapes 受理即计费，故绝不盲目重试）。

4. GitHub Actions：在仓库 Settings → Secrets → Actions 添加 `SIEVE_API_KEY`，每日任务会自动带上深度情报；不配置则该步骤自动跳过。

测试：

```bash
node --test "tests/*.test.mjs"
```

覆盖抓取脚本的容错、增速计算、独立开发榜的解析与渲染（含 `javascript:` 伪协议拦截、卡片不得嵌套 `<a>` 的 DOM 结构校验），以及变现看板的全部核心逻辑（脏数据容错、非法输入拒绝、有效时薪算法、里程碑点亮、时薪对比、导出成就页、HTML 转义防注入）。测试直接从 `index.html` 里抽出**真实运行的那段看板代码**执行，而不是复制一份副本，避免「测的和跑的不是一个东西」。

## 自动更新原理

1. **静态精选库**：副业思路（含分步操作、对标账号、已验证案例）、落地教程、7 天清单、踩坑墙、求职网站、精选学习资源内置于 `index.html` / `data/*.js`，人工精选、不依赖接口、永远可用。**变现看板**的数据存在用户浏览器本地（`shh_earn` / `shh_goal`），因此既不需要接口也不需要服务器：换设备不跟随是刻意的取舍，隐私优先。
2. **抓取脚本**（全部零依赖、单源失败不影响整体、全部失败也会生成保底快照）：
   - `scripts/fetch-jobs.mjs` → `data/daily-updates.json`（工作板）
   - `scripts/fetch-hustles.mjs` → `data/daily-hustles.json`（副业新机会），并维护 `data/hustle-history.json`（星数快照，保留 30 天）用于计算日环比增速（🔥 风口加速中 / 🔥 持续热度 / 🆕 今日新上榜，默认按增速排序）
   - `scripts/fetch-learn.mjs` → `data/daily-learn.json`（在线学习流）

   - `scripts/fetch-indie.mjs` → `data/indie.json`（中国独立开发动态），解析 README 条目、统计品类分布与变现信号，输出拥挤榜 / 冷门方向
3. **GitHub Actions**：`.github/workflows/daily-update.yml` 每天 09:30（北京时间）依次运行上述四个脚本，**并先执行一次 `node --test "tests/*.test.mjs"` 做数据与看板逻辑校验（校验不通过则不提交，避免把坏数据推上生产）**，再把实际生成的 JSON 提交回仓库（产物缺失时自动跳过，不让 `git add` 失败）；也支持在 Actions 页面手动触发（workflow_dispatch）。部署在 GitHub Pages 时，数据提交后网站即自动更新。
4. **前端降级**：四个每日区块在数据文件缺失时不会白屏，而是显示运行提示；`data/daily-scout.json`（sieve）缺失时整块隐藏，与未配置时的行为一致。

## 部署

- **GitHub Pages（推荐，自动更新链路最完整）**：仓库 Settings → Pages → Source 选 GitHub Actions 或 `main` 分支根目录。
- **Vercel / Cloudflare Pages**：直接导入仓库，无构建命令，输出目录为根目录。注意托管平台上 Actions 的每日提交会自动触发重新部署。

## 数据来源致谢

- [ai-money-maker-handbook](https://github.com/XiaomingX/ai-money-maker-handbook) —— AI 副业赚钱大集合
- [awesome-remote-job](https://github.com/lukasz-madon/awesome-remote-job) —— 精选远程工作资源清单
- [wordfeel.cc](https://wordfeel.cc/) —— 场景英语学习（本站「语言/考证」赛道数据源之一）
- [TapTapGo](https://taptapgo.yldm.ai/app/) —— 儿童分级阅读课程（本站「K12 学习」赛道数据源之一）

## 免责声明

副业有风险，入场需谨慎；请遵守当地法律法规与各平台规则。职位数据来自公开接口，投递前请自行甄别。
