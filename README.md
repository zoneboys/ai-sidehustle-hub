# 🧭 AI 副业指南针 · SideHustle Hub

一个纯静态、零依赖、可直接部署到 **GitHub Pages / Vercel / Cloudflare Pages** 的交互式网站：

- 💰 **AI 副业思路库** —— 精选自 [XiaomingX/ai-money-maker-handbook](https://github.com/XiaomingX/ai-money-maker-handbook)：36 个经过验证的 AI 副业方案，每个都带**分步操作**（目标 / 做法 / 完成标志）、成本、周期、收入区间、工具链接、定价、风险与第一周计划，并附**对标账号**（去哪里找、搜什么关键词、盯什么细节），支持分类、搜索、排序与收藏。
- 💼 **远程工作渠道板** —— 精选自 [lukasz-madon/awesome-remote-job](https://github.com/lukasz-madon/awesome-remote-job)：48+ 个正规远程求职网站、聚合器与自由职业平台。
- 📡 **每日自动更新（三条链路）** —— GitHub Actions 每天北京时间 09:30 自动抓取：
  - **工作板** `scripts/fetch-jobs.mjs` → `data/daily-updates.json`：Remotive / Remote OK / We Work Remotely / HN「Who is hiring?」远程职位；
  - **副业新机会** `scripts/fetch-hustles.mjs` → `data/daily-hustles.json`：GitHub 新仓库 + HN Show HN + Product Hunt，自动归类到 7 个副业分类；
  - **在线学习流** `scripts/fetch-learn.mjs` → `data/daily-learn.json`：5 个赛道（编程 / AI 学习 / K12 学习 / 语言考证 / 中文效率），接入 dev.to、freeCodeCamp、arXiv、哔哩哔哩、[wordfeel.cc](https://wordfeel.cc/) 场景剧场、[TapTapGo](https://taptapgo.yldm.ai/app/)、少数派、36氪。
  
  数据提交后网站即自动更新，无需服务器。
- 🔭 **深度情报（可选）** —— 配置 [sieve](https://scrape.usesieve.com) 后，每天用 scrape API 对热门 AI 副业做一次情报侦察（平台规则变化、本周公开机会、可执行行动），写入 `data/daily-scout.json`；所有机会带原文链接可核验真伪。未配置时该板块自动隐藏，站点与其他数据源完全不受影响。
- 📚 **学习成长区** —— 远程工作必读文章、书籍、播客、Newsletter 与面试工具。
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
```

两个脚本同样零依赖，单个数据源失败只会在产物 `errors` 字段里记录，不影响其他源；页面上的「部分来源失败：N」角标就是这个计数。

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

## 自动更新原理

1. **静态精选库**：副业思路（含分步操作与对标账号）、求职网站、精选学习资源内置于 `index.html` / `data/*.js`，人工精选、不依赖接口、永远可用。
2. **抓取脚本**（全部零依赖、单源失败不影响整体、全部失败也会生成保底快照）：
   - `scripts/fetch-jobs.mjs` → `data/daily-updates.json`（工作板）
   - `scripts/fetch-hustles.mjs` → `data/daily-hustles.json`（副业新机会）
   - `scripts/fetch-learn.mjs` → `data/daily-learn.json`（在线学习流）
3. **GitHub Actions**：`.github/workflows/daily-update.yml` 每天 09:30（北京时间）依次运行上述三个脚本，并把实际生成的 JSON 提交回仓库（产物缺失时自动跳过，不让 `git add` 失败）；也支持在 Actions 页面手动触发（workflow_dispatch）。部署在 GitHub Pages 时，数据提交后网站即自动更新。
4. **前端降级**：三个每日区块在数据文件缺失时不会白屏，而是显示运行提示；`data/daily-scout.json`（sieve）缺失时整块隐藏，与未配置时的行为一致。

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
