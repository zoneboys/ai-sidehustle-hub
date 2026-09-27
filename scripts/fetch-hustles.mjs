#!/usr/bin/env node
/**
 * 每日副业动态抓取脚本
 *
 * 输出 data/daily-hustles.json：每天抓取「可复用的新玩法 / 新工具 / 新机会」，
 * 让副业板块不只是一份静态精选库，而是每天有新东西落进来：
 *   1. GitHub 新仓库   —— 副业/AI 变现相关的开源项目（含 star、描述、更新时间）
 *   2. Hacker News     —— Show HN 新产品（工具类机会）
 *   3. Product Hunt RSS —— 新上线产品（验证过的付费需求）
 *
 * 全部公开免费接口，无需 API Key。可选 GITHUB_TOKEN 提升 GitHub 速率限制。
 * 运行：node scripts/fetch-hustles.mjs
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "daily-hustles.json");
const PREV = join(__dirname, "..", "data", "daily-hustles.json");
const TIMEOUT_MS = 18000;
const PER_SOURCE = 10;

const errors = [];
const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* 副业关键词 → 分类映射：命中即归类，用于前端「今日新机会」筛选 */
export const TRACKS = {
  content: { name: "视频/内容", emoji: "🎬", kw: ["video", "shorts", "reels", "tiktok", "youtube", "content", "creator", "subtitle", "dubbing", "story", "comic", "manga", "anime"] },
  image: { name: "AI 图片", emoji: "🎨", kw: ["image", "photo", "portrait", "avatar", "stable-diffusion", "comfyui", "midjourney", "diffusion", "wallpaper", "art", "design"] },
  writing: { name: "文案写作", emoji: "✍️", kw: ["writing", "copywriting", "translate", "seo", "blog", "newsletter", "ghostwriting", "pdf", "resume", "ebook"] },
  audio: { name: "音频/音乐", emoji: "🎧", kw: ["tts", "voice", "audio", "music", "podcast", "speech", "sound", "dubbing"] },
  live: { name: "直播/电商", emoji: "📺", kw: ["live", "stream", "commerce", "shopify", "ecommerce", "dropship", "affiliate", "virtual", "avatar", "goods"] },
  tech: { name: "技术变现", emoji: "👨‍💻", kw: ["api", "sdk", "plugin", "extension", "app", "saas", "automation", "workflow", "agent", "llm", "scraper", "bot", "dashboard", "tool"] },
  biz: { name: "出版/咨询", emoji: "📦", kw: ["book", "ebook", "publishing", "course", "consult", "agency", "dataset", "data", "niche", "template", "product"] },
};

function classify(text) {
  const t = String(text).toLowerCase();
  let best = null;
  let bestHits = 0;
  for (const [cat, cfg] of Object.entries(TRACKS)) {
    let hits = 0;
    for (const k of cfg.kw) if (t.includes(k)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      best = cat;
    }
  }
  return best || "tech";
}

async function fetchOnce(url, headers = {}) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA_BROWSER, Accept: "*/*", ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return new TextDecoder("utf-8").decode(buf);
  } finally {
    clearTimeout(tm);
  }
}

async function fetchText(url, headers = {}, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchOnce(url, headers);
    } catch (e) {
      const msg = String((e && e.message) || e);
      // 4xx（除限流）与 5xx 中的 500/501/505 不重试；429/502/503/504 属于临时故障，值得重试
      const retriable = /HTTP (429|502|503|504)/.test(msg) || !/HTTP [45]/.test(msg);
      if (!retriable || i === retries) throw e;
      await new Promise((r) => setTimeout(r, 900 * (i + 1)));
    }
  }
}

const strip = (s = "") => String(s).replace(/\s+/g, " ").trim();
const cut = (s = "", n = 130) => (strip(s).length > n ? strip(s).slice(0, n) + "…" : strip(s));

function fallback() {
  if (existsSync(PREV)) {
    const prev = JSON.parse(readFileSync(PREV, "utf8"));
    if (prev.items && prev.items.length) {
      return { ...prev, stale: true, note: prev.note + "（本次抓取全部失败，展示上一次成功结果）" };
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    items: [],
    errors: ["首次抓取失败"],
    note: "本次抓取失败，已生成空快照以保底",
  };
}
/* ================= 数据源 1：GitHub 新仓库（副业可复用的开源项目） ================= */
/** GitHub 搜索要求 pushed:>YYYY-MM-DD，不能用 7d 相对写法 */
const since7d = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const GH_QUERIES = [
  `ai in:name,description pushed:>${since7d} stars:>80`,
  `automation workflow in:name,description pushed:>${since7d} stars:>60`,
  `generator ai in:name,description pushed:>${since7d} stars:>50`,
];

async function fromGithub() {
  const token = process.env.GITHUB_TOKEN;
  const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const out = [];
  for (const q of GH_QUERIES) {
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=8`;
      const json = JSON.parse(await fetchText(url, headers, 3));
      for (const r of json.items || []) {
        if (!r.description) continue;
        const text = `${r.name} ${r.description} ${(r.topics || []).join(" ")}`;
        out.push({
          title: r.full_name,
          url: r.html_url,
          desc: cut(r.description, 140),
          source: "GitHub",
          author: r.owner && r.owner.login,
          cat: classify(text),
          metrics: `⭐ ${r.stargazers_count} · fork ${r.forks_count} · ${r.language || "多语言"}`,
          date: r.pushed_at ? r.pushed_at.slice(0, 10) : "",
          score: Math.min(10, Math.round((Math.log10(Math.max(1, r.stargazers_count)) - 1) * 2 * 10) / 10),
        });
      }
    } catch (e) {
      errors.push(`github/${q.split(" ")[0]}: ${e.message}`);
    }
  }
  return out;
}

/* ================= 数据源 2：Hacker News Show HN（新产品 = 新机会） ================= */
async function fromHackerNews() {
  try {
    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    const url =
      "https://hn.algolia.com/api/v1/search_by_date" +
      `?tags=show_hn&numericFilters=created_at_i%3E${since}&hitsPerPage=25`;
    const json = JSON.parse(await fetchText(url));
    const out = [];
    for (const h of json.hits || []) {
      const title = strip(h.title);
      if (!title) continue;
      const link = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`;
      const text = `${title} ${h.story_text || ""}`;
      out.push({
        title,
        url: link,
        desc: cut(h.story_text || `${h.points || 0} 分 · ${h.num_comments || 0} 条讨论 · 作者 ${h.author || "-"}`, 140),
        source: "Hacker News",
        author: h.author,
        cat: classify(text),
        metrics: `▲ ${h.points || 0} · 💬 ${h.num_comments || 0}`,
        date: h.created_at ? h.created_at.slice(0, 10) : "",
        score: Math.min(10, Math.round((Math.log10(Math.max(1, h.points || 0)) + 1) * 2 * 10) / 10),
      });
      if (out.length >= PER_SOURCE) break;
    }
    return out;
  } catch (e) {
    errors.push(`hackernews: ${e.message}`);
    return [];
  }
}

/* ================= 数据源 3：Product Hunt RSS（已验证的付费需求） ================= */
async function fromProductHunt() {
  try {
    const xml = await fetchText("https://www.producthunt.com/feed");
    const out = [];
    for (const b of xml.split(/<item[\s>]/i).slice(1)) {
      const pick = (tag) => {
        const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
        return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
      };
      const title = strip(pick("title"));
      const link = strip(pick("link"));
      if (!title || !link) continue;
      const date = pick("pubDate");
      out.push({
        title,
        url: link,
        desc: cut(pick("description"), 140),
        source: "Product Hunt",
        author: "",
        cat: classify(title + " " + pick("description")),
        metrics: "今日上线",
        date: Number.isNaN(Date.parse(date)) ? "" : new Date(Date.parse(date)).toISOString().slice(0, 10),
        score: 6.5,
      });
      if (out.length >= PER_SOURCE) break;
    }
    return out;
  } catch (e) {
    errors.push(`producthunt: ${e.message}`);
    return [];
  }
}
/* ================= 主流程 ================= */
const SOURCES = [
  { name: "GitHub", run: fromGithub },
  { name: "Hacker News", run: fromHackerNews },
  { name: "Product Hunt", run: fromProductHunt },
];

async function main() {
  const started = Date.now();
  const results = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        return await s.run();
      } catch (e) {
        errors.push(`${s.name}: ${e.message}`);
        return [];
      }
    })
  );

  const seen = new Set();
  const items = [];
  for (const list of results) {
    for (const it of list) {
      const key = `${it.url}|${it.title}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  }
  items.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
  const top = items.slice(0, 40);

  if (top.length < 4) {
    console.warn("⚠️ 抓取条目过少，使用上一次成功快照兜底");
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(fallback(), null, 2), "utf8");
    console.log(`💾 已写入兜底快照 ${OUT}`);
    return;
  }

  const now = new Date();
  const payload = {
    generatedAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    total: top.length,
    items: top,
    errors,
    note:
      "由 scripts/fetch-hustles.mjs 每日自动抓取（GitHub Actions）。来源：GitHub 新仓库 / Hacker News Show HN / Product Hunt；cat 为关键词自动归类，score 为热度自动评分。点开原帖核验后再决定是否跟进。",
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`💾 已写入 ${OUT}：共 ${top.length} 条新机会，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (errors.length) console.warn(`⚠️ ${errors.length} 个来源失败：`, errors.join(" | "));
}

main().catch((e) => {
  console.error("抓取失败：", e);
  try {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ ...fallback(), errors: [String((e && e.message) || e)] }, null, 2), "utf8");
    process.exit(0);
  } catch {
    process.exit(1);
  }
});
