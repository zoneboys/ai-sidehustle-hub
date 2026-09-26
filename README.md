# 🧭 AI 副业指南针 · SideHustle Hub

一个纯静态、零依赖、可直接部署到 **GitHub Pages / Vercel / Cloudflare Pages** 的交互式网站：

- 💰 **AI 副业思路库** —— 精选自 [XiaomingX/ai-money-maker-handbook](https://github.com/XiaomingX/ai-money-maker-handbook)：36 个经过验证的 AI 副业方案，每个都带「怎么做 / 推荐工具 / 变现方式」，支持分类、搜索、排序与收藏。
- 💼 **远程工作渠道板** —— 精选自 [lukasz-madon/awesome-remote-job](https://github.com/lukasz-madon/awesome-remote-job)：48+ 个正规远程求职网站、聚合器与自由职业平台。
- 📡 **每日自动更新** —— GitHub Actions 每天北京时间 09:30 自动抓取 Remotive / Remote OK / We Work Remotely / HN「Who is hiring?」的最新远程职位，写入 `data/daily-updates.json`，网站打开即是最新数据，无需服务器。
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

## 自动更新原理

1. **静态精选库**：副业思路、求职网站、学习资源内置于 `index.html`，人工精选、不依赖接口。
2. **抓取脚本**：`scripts/fetch-jobs.mjs` 调用 4 个公开免费数据源（无需 API Key），单源失败不影响整体，全部失败也会生成保底空快照。
3. **GitHub Actions**：`.github/workflows/daily-update.yml` 每天 09:30（北京时间）运行脚本并自动提交数据；也支持在 Actions 页面手动触发（workflow_dispatch）。部署在 GitHub Pages 时，数据提交后网站即自动更新。

## 部署

- **GitHub Pages（推荐，自动更新链路最完整）**：仓库 Settings → Pages → Source 选 GitHub Actions 或 `main` 分支根目录。
- **Vercel / Cloudflare Pages**：直接导入仓库，无构建命令，输出目录为根目录。注意托管平台上 Actions 的每日提交会自动触发重新部署。

## 数据来源致谢

- [ai-money-maker-handbook](https://github.com/XiaomingX/ai-money-maker-handbook) —— AI 副业赚钱大集合
- [awesome-remote-job](https://github.com/lukasz-madon/awesome-remote-job) —— 精选远程工作资源清单

## 免责声明

副业有风险，入场需谨慎；请遵守当地法律法规与各平台规则。职位数据来自公开接口，投递前请自行甄别。
