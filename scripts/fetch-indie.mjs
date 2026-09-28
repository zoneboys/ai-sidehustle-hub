#!/usr/bin/env node
/**
 * 每日「中国独立开发者在做什么」抓取脚本
 *
 * 抓 https://github.com/1c7/chinese-independent-developer 的 README（公开、无需 API Key），
 * 解析出最近 N 天的项目条目，回答用户最关心的问题：现在大家都在做什么、哪些方向还空着。
 *
 * 输出 data/indie.json：
 *   items[] —— 标题 / 链接 / 简介 / 作者 / 状态 / 日期 / 品类 / 变现信号
 *   stats   —— 品类分布（哪个方向最拥挤）、状态分布、开发者数
 *
 * 运行：node scripts/fetch-indie.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "indie.json");
const REPO_URL = "https://github.com/1c7/chinese-independent-developer";
// raw.githubusercontent 偶发 ECONNRESET（实测同一天内会好会坏），多镜像 + 重试兜住
const README_URLS = [
  "https://raw.githubusercontent.com/1c7/chinese-independent-developer/master/README.md",
  "https://github.com/1c7/chinese-independent-developer/raw/master/README.md",
  "https://api.github.com/repos/1c7/chinese-independent-developer/readme",
];
const README_URL = README_URLS[0];
const RETRIES = 1;
const TIMEOUT_MS = 15000;
const DAYS = 30; // 取最近多少天
const MAX_ITEMS = 120; // 上限，避免 README 存档区把主版面挤掉

const beijingDate = (d = new Date()) =>
  new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

/* 品类关键词表：中文为主，命中最多的一类胜出。
   顺序即优先级——「AI 视频」同时命中 video 和 ai，ai 在前就归 ai。 */
export const CATS = {
  ai: {
    name: "AI 工具",
    emoji: "🤖",
    kw: [
      "ai", "gpt", "llm", "claude", "gemini", "大模型", "智能体", "agent", "rag",
      "提示词", "prompt", "微调", "数字人", "语音识别", "转写", "神经网络", "机器学习",
    ],
  },
  content: {
    name: "内容创作",
    emoji: "✍️",
    kw: [
      "写作", "文案", "小说", "漫画", "动漫", "短剧", "视频", "剪辑", "字幕", "翻译",
      "博客", "文章", "公众号", "播客", "漫画生成", "分镜", "素材", "字体", "简历",
    ],
  },
  image: {
    name: "图像设计",
    emoji: "🎨",
    kw: [
      "图片", "图像", "头像", "壁纸", "绘画", "生图", "修图", "抠图", "美颜", "相机",
      "照片", "像素画", "贴纸", "表情包", "插画", "海报", "logo", "设计工具", "psd",
    ],
  },
  audio: {
    name: "音频音乐",
    emoji: "🎧",
    kw: ["音频", "音乐", "声音", "语音", "播客", "tts", "midi", "音效", "变声", "唱", "乐器"],
  },
  life: {
    name: "生活效率",
    emoji: "🏠",
    kw: [
      "笔记", "待办", "todo", "书签", "阅读", "记账", "账本", "日程", "习惯", "打卡",
      "睡眠", "健身", "饮食", "菜谱", "宠物", "旅行", "地图", "相册", "纪念", "记录",
      "文件", "压缩", "转换", "格式", "二维码", "倒计时", "单位换算", "屏幕",
    ],
  },
  biz: {
    name: "商业工具",
    emoji: "💼",
    kw: [
      "saas", "crm", "erp", "报价", "发票", "报销", "合同", "发票", "订单", "库存",
      "招聘", "求职", "简历筛选", "crm", "数据大屏", "看板", "项目管理", "客户",
      "代理", "出海", "跨境", "电商", "选品", " seo", "独立站", "落地页", "表单",
    ],
  },
  game: { name: "游戏娱乐", emoji: "🎮", kw: ["游戏", "手游", "steam", "攻略", "关卡", "玩家", "minecraft", "抽卡"] },
  devtool: {
    name: "开发者工具",
    emoji: "🧑‍💻",
    kw: [
      "api", "sdk", "插件", "扩展", "浏览器扩展", "chrome 扩展", "命令行", "代码",
      "开发者", "部署", "托管", "数据库", "爬虫", "调试", "开源工具", "自托管", "工作台",
    ],
  },
};

/* 变现信号：从简介里抓「他靠什么收钱」，这是选题时最该看的部分 */
export const MONETIZE = [
  { k: "pay", label: "付费", kw: ["付费", "订阅", "月付", "年付", "定价", "价格", "计费", "购买", "套餐"] },
  { k: "free", label: "免费引流", kw: ["免费", "免费试用", "免费无限", "开源", "无需注册", "免注册", "免费开始"] },
  { k: "ads", label: "广告", kw: ["广告", "赞助"] },
  { k: "local", label: "本地隐私", kw: ["本地", "不上传", "离线", "浏览器内", "本地处理", "数据不出"] },
];

/* ---------- 解析 ---------- */

const STATUS_MAP = {
  white_check_mark: { k: "live", label: "已上线", emoji: "✅" },
  clock8: { k: "dev", label: "开发中", emoji: "🕘" },
  x: { k: "closed", label: "已关闭", emoji: "❌" },
};

const clean = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

function classify(text) {
  const low = text.toLowerCase();
  let best = null;
  for (const [key, c] of Object.entries(CATS)) {
    let n = 0;
    for (const k of c.kw) if (low.includes(k.toLowerCase())) n++;
    if (n > 0 && (!best || n > best.n)) best = { key, n };
  }
  return best ? best.key : "other";
}

function monetizeSignals(text) {
  const low = text.toLowerCase();
  return MONETIZE.filter((m) => m.kw.some((k) => low.includes(k.toLowerCase()))).map((m) => m.k);
}

/**
 * 解析 README 文本。
 * 结构固定为：### YYYY 年 M 月 D 号添加 → #### 作者 → * :emoji: [标题](url)：简介
 * 纯函数，导出以便单测直接喂样本，不用联网。
 */
export function parseReadme(md, { days = DAYS, max = MAX_ITEMS } = {}) {
  const lines = String(md || "").split(/\r?\n/);
  const out = [];
  let date = "";
  let author = "";
  let authorUrl = "";
  let stop = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (stop) break;

    const d = line.match(/^###\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*号/);
    if (d) {
      // README 是倒序的，一旦日期越过窗口就停，避免把 2018 年的存档算进来
      const cur = `${d[1]}-${String(d[2]).padStart(2, "0")}-${String(d[3]).padStart(2, "0")}`;
      const end = new Date();
      const floor = new Date(end.getTime() + 8 * 3600 * 1000 - days * 86400000)
        .toISOString()
        .slice(0, 10);
      if (cur < floor) { stop = true; continue; }
      date = cur;
      author = "";
      continue;
    }

    const a = line.match(/^####\s+(.*)$/);
    if (a) {
      const head = a[1];
      const gh = head.match(/\[(?:Github|GitHub)\]\((https?:\/\/[^)]+)\)/);
      const other = head.match(/\[(?!Github\]|GitHub\])([^\]]*)\]\((https?:\/\/[^)]+)\)/);
      author = clean(head.replace(/\[.*?\]\([^)]*\)/g, "").replace(/[,，\-–]\s*$/, "").trim()) || "匿名开发者";
      authorUrl = (gh && gh[1]) || (other && other[2]) || "";
      continue;
    }

    const p = line.match(/^\*\s+:([a-z_0-9]+):\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*[：:]\s*(.*)$/);
    if (p) {
      const st = STATUS_MAP[p[1]] || { k: "live", label: "已上线", emoji: "✅" };
      const title = clean(p[2]);
      const url = p[3].trim();
      // 简介里常带「- [更多介绍](url)」尾巴，只取第一句
      let desc = clean(p[4].split(/\s+-\s+\[/) [0] || "");
      if (desc.length > 220) desc = desc.slice(0, 220) + "…";
      if (!title || !url) continue;
      const text = `${title} ${desc}`;
      out.push({
        title,
        url,
        desc,
        author: author || "匿名开发者",
        authorUrl,
        status: st.k,
        statusLabel: st.label,
        statusEmoji: st.emoji,
        date,
        cat: classify(text),
        pay: monetizeSignals(text),
      });
    }
  }

  // 同一项目可能重复出现（作者改了名字又提交），按 url 去重，保留最新那条
  const seen = new Map();
  for (const it of out) if (!seen.has(it.url)) seen.set(it.url, it);
  const items = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { items: items.slice(0, max) };
}

/** 只导出前端要用的字段，丢掉关键词表 */
export function publicCats() {
  return Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, { name: v.name, emoji: v.emoji }]));
}
export const PAY_LABELS = Object.fromEntries(MONETIZE.map((m) => [m.k, m.label]));

export function buildStats(items) {
  const byCat = {};
  const byStatus = {};
  const devs = new Set();
  for (const it of items) {
    byCat[it.cat] = (byCat[it.cat] || 0) + 1;
    byStatus[it.status] = (byStatus[it.status] || 0) + 1;
    devs.add(it.author);
  }
  const ranked = Object.entries(byCat)
    .map(([k, n]) => ({ key: k, n }))
    .sort((a, b) => b.n - a.n);
  return {
    total: items.length,
    devs: devs.size,
    byCat,
    byStatus,
    // 头部 + 长尾：前三名 = 最挤的赛道
    topCats: ranked.slice(0, 3).map((r) => r.key),
    // 冷门方向：只出现 1~2 次的品类，通常是空白位
    gapCats: ranked.filter((r) => r.n <= 2).map((r) => r.key).slice(0, 5),
  };
}

/* ---------- 主流程 ---------- */

function fallback() {
  if (existsSync(OUT)) {
    try { return JSON.parse(readFileSync(OUT, "utf8")); } catch {}
  }
  return {
    generatedAt: null, date: null, repo: REPO_URL, items: [],
    cats: publicCats(), payLabels: PAY_LABELS,
    stats: { total: 0, devs: 0, byCat: {}, byStatus: {}, topCats: [], gapCats: [] },
    note: "抓取失败，暂无数据。",
  };
}

async function main() {
  const started = Date.now();
  const errors = [];
  let md = "";
  for (const url of README_URLS) {
    for (let i = 0; i <= RETRIES; i++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { "user-agent": "ai-sidehustle-hub", accept: "text/plain,*/*" },
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        // API 端点返回的是 base64，这里只需 README 原文，base64 特征明显就跳过
        if (body.length < 5000) throw new Error("内容异常短");
        md = body;
        break;
      } catch (e) {
        const msg = String((e && (e.cause?.code || e.message)) || e);
        if (i === RETRIES) errors.push(`${url.split("/")[2]}: ${msg}`);
        else await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    if (md) break;
  }
  if (!md) console.warn("⚠️ 所有镜像均失败，沿用上一次快照");

  let payload = fallback();
  if (md) {
    const { items } = parseReadme(md);
    if (items.length < 10) {
      errors.push(`只解析到 ${items.length} 条，可能是 README 结构变了`);
    } else {
      const stats = buildStats(items);
      const now = new Date();
      payload = {
        generatedAt: now.toISOString(),
        date: beijingDate(now),
        repo: REPO_URL,
        days: DAYS,
        cats: publicCats(),
        payLabels: PAY_LABELS,
        items,
        stats,
        errors,
        note:
          "由 scripts/fetch-indie.mjs 每日自动抓取。来源：1c7/chinese-independent-developer（中文独立开发者项目列表，公开仓库）。cat 由简介关键词自动归类，pay 为简介里出现的变现信号词。「拥挤榜」= 近 30 天提交最多的品类，「冷门方向」= 只出现 1~2 次的品类。",
      };
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  const s = payload.stats || {};
  console.log(
    `💾 已写入 ${OUT}：${s.total || 0} 个项目 / ${s.devs || 0} 位开发者，` +
      `拥挤：${(s.topCats || []).join(">")}，冷门：${(s.gapCats || []).join(",") || "无"}，` +
      `用时 ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
  if (errors.length) console.warn(`⚠️ ${errors.length} 个问题：`, errors.join(" | "));
}

/* 入口守卫：只在被直接执行时跑 main()。
 * 否则测试文件 import 本模块的纯函数时，会连带真的联网抓取并改写 data/*.json——
 * 单元测试因此变慢几十秒，还会让工作区凭空多出改动。 */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch((e) => {
  console.error("抓取失败：", e);
  try {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ ...fallback(), errors: [String((e && e.message) || e)] }, null, 2), "utf8");
    process.exit(0);
  } catch { process.exit(1); }
});
