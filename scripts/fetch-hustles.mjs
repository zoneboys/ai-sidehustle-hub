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
const HISTORY = join(__dirname, "..", "data", "hustle-history.json");
const TIMEOUT_MS = 18000;
const PER_SOURCE = 10;
const HISTORY_DAYS = 30; // 上榜记录保留天数，过期后清理避免文件无限膨胀

// 站点面向中文用户，产物里的「日期」按北京时间（UTC+8）计算。
// 之前直接用 toISOString() 取 UTC 日期，导致北京时间 00:00-08:00 之间抓到的数据
// 会被标成前一天，页面上看着像「数据没更新」。
const beijingDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

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
    date: beijingDate(),
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
        // 爆发速度：star / 存续天数。存续期由 created_at 起算（而不是 push 时间），
        // 这样「3 天涨 3000 star」和「3 年涨 3000 star」能被区分开——
        // 后者是大热老项目，前者才是真风口。
        const ageDays = r.created_at
          ? Math.max(1, (Date.now() - Date.parse(r.created_at)) / 86400000)
          : 365;
        const stars = r.stargazers_count || 0;
        const burst = Math.round((stars / ageDays) * 10) / 10;
        out.push({
          title: r.full_name,
          url: r.html_url,
          desc: cut(r.description, 140),
          source: "GitHub",
          author: r.owner && r.owner.login,
          cat: classify(text),
          metrics: `⭐ ${stars} · 🚀 ${burst}/天 · fork ${r.forks_count} · ${r.language || "多语言"}`,
          date: r.pushed_at ? r.pushed_at.slice(0, 10) : "",
          stars,
          burst,
          pop: stars,
          ageDays: +ageDays.toFixed(1),
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
      const link = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`;        const text = `${title} ${h.story_text || ""}`;
        // HN 上新产品的「分/时」是这批数据里最接近真实需求的即时信号
        const ageHours = h.created_at_i
          ? Math.max(1, (Date.now() / 1000 - h.created_at_i) / 3600)
          : 24;
        const points = h.points || 0;
        const rate = Math.round((points / ageHours) * 10) / 10;
        out.push({
          title,
          url: link,
          desc: cut(h.story_text || `${points} 分 · ${h.num_comments || 0} 条讨论 · 作者 ${h.author || "-"}`, 140),
          source: "Hacker News",
          author: h.author,
          cat: classify(text),
          metrics: `▲ ${points} · 🚀 ${rate}/时 · 💬 ${h.num_comments || 0}`,
          date: h.created_at ? h.created_at.slice(0, 10) : "",
          points,
          rate,
          pop: points,
          ageDays: +(ageHours / 24).toFixed(1),
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
        // Product Hunt RSS 不给票数，只给上线日期：pop 留 0，增速信号缺席
        pop: 0,
        ageDays: 1,
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

/* ---------- 跳天去重：持续热度 ----------
 * 每天的产物只保留当天条目，光看一天无法区分「真风口」和「一次性噪声」。
 * 这里维护一份上榜历史：同一 key 再次出现则 streak +1，首次出现则 streak=1，
 * 前端据此打 🔥（连续上榜）标记。历史只留近 30 天。
 */
function loadHistory() {
  if (!existsSync(HISTORY)) return {};
  try {
    return JSON.parse(readFileSync(HISTORY, "utf8")).entries || {};
  } catch {
    return {};
  }
}

/* 历史文件刚建立的第一天，所有条目 streak 都会是 1，页面全打「今日新上榜」，
 * 看不出谁是真风口。用前一天已经落盘的 daily-hustles.json 给历史播种一次：
 * 昨天就在榜的条目从 streak=2 起步（今天连续第 2 天），其余仍为 1。
 * 这样功能上线当天就能直接看到 🔥 标记，不必等第二天。 */
function seedHistoryFromSnapshot(today) {
  // 只有历史为空（首次运行 / 文件损坏）才播种
  if (Object.keys(loadHistory()).length) return;
  if (!existsSync(PREV)) return;
  let prev;
  try {
    prev = JSON.parse(readFileSync(PREV, "utf8"));
  } catch {
    return;
  }
  if (!Array.isArray(prev.items) || !prev.items.length) return;
  const prevDate = prev.date || today;
  // 快照本身就是今天的（当天重跑），播种没有意义，交给 applyStreak 正常判定
  if (prevDate >= today) return;
  const seed = {};
  for (const it of prev.items) {
    if (!it || !it.url || !it.title) continue;
    // 把昨天的热度一起播下去：否则今天第一次运行时这些条目没有可比基准，
    // 增速要再等一天才出得来，「🔥 风口加速中」会白白空一天。
    const pop = Number(it.pop ?? it.growth?.count);
    seed[`${it.url}|${it.title}`.toLowerCase()] = {
      firstSeen: prevDate,
      lastSeen: prevDate,
      streak: 1,
      title: it.title,
      url: it.url,
      cat: it.cat,
      ...(Number.isFinite(pop) && pop > 0 ? { pop } : {}),
    };
  }
  if (Object.keys(seed).length) {
    writeFileSync(
      HISTORY,
      JSON.stringify(
        { updatedAt: new Date().toISOString(), date: prevDate, total: Object.keys(seed).length, entries: seed },
        null,
        2
      ),
      "utf8"
    );
    console.log(`🌱 已用 ${prevDate} 的快照为上榜历史播种 ${Object.keys(seed).length} 条（streak 从 2 起步）`);
  }
}

/**
 * 判定「真风口」用增速，而不是在榜天数。
 * 在榜天数只能说明「被算法推过」，增速才说明「有人在真的抢」。
 *   daily   —— 互动量日环比，需要历史快照，第 2 天起可用
 *   perDay  —— 自创建以来（或首次观测以来）的平均日增，首日即可用
 * 只有带 metrics 的源（GitHub/HN/Product Hunt）才有这两个信号；
 * 拿不到就返回 null，前端据此只显示 🔥 而不谎报增速。
 */
function applyGrowth(it, old, today) {
  const now = Number(it.pop);
  const age = Number(it.ageDays);
  if (!Number.isFinite(now) || now <= 0 || !Number.isFinite(age) || age <= 0) {
    it.growth = null;
    it.growthBase = null;
    return;
  }
  // 基准 = 「上一次观测到的热度」。
  // 同一天重跑时 old.lastSeen === today，此时 old.pop 已经是今天的数了，
  // 拿它当基准等于自己比自己（+0.0%，是假信息），必须退回首次运行那天
  // 确立并存进历史的那一组基准 basePop / baseDay。
  const sameDay = !!old && old.lastSeen === today;
  const base = sameDay
    ? Number.isFinite(Number(old.basePop)) ? Number(old.basePop) : null
    : old && Number.isFinite(Number(old.pop)) ? Number(old.pop) : null;
  const baseDay = sameDay ? old.baseDay || null : old && old.lastSeen ? old.lastSeen : null;
  // 基准日必须严格早于今天才算「日环比」，同时排掉三种情况：
  //   1. 今天首次入库的新条目（没有 old，基准为空）
  //   2. 同一天重跑且没存下基准（宁可不出数，也不出假数）
  //   3. 基准为 0（Product Hunt 无票数）——除以 0 会得到 Infinity
  const comparable = base != null && base > 0 && !!baseDay && baseDay < today;
  const days = comparable
    ? Math.max(1, (Date.parse(today + "T00:00:00Z") - Date.parse(baseDay + "T00:00:00Z")) / 86400000)
    : null;
  // 统一成「日均增速」：间隔 1 天就是普通环比；间隔 3 天（断更后回榜）用开 3 次方
  // 折算，否则会把 3 天的涨幅当成 1 天的报给用户。
  const dailyRate = comparable
    ? days === 1
      ? (now - base) / base
      : Math.pow(now / base, 1 / days) - 1
    : null;
  it.growthBase = comparable ? base : null;
  it.growth = {
    count: now,
    base: comparable ? base : null,
    // 日均增速：上次观测 → 今天，null 表示首次观测（没有可比基准）
    daily: dailyRate != null ? +(dailyRate * 100).toFixed(1) : null,
    // 平均日增：首日即有量级参考，但增速是否「快」得看对比
    perDay: +(now / age).toFixed(2),
    ageDays: +age.toFixed(1),
  };
}

function applyStreak(items, today) {
  const prev = loadHistory();
  const entries = { ...prev };
  const seenToday = new Set();

  for (const it of items) {
    const key = `${it.url}|${it.title}`.toLowerCase();
    seenToday.add(key);
    const old = entries[key];
    if (old) {
      // 同一天重跑不重复累加；断更超过 2 天则重新从 1 开始（那不是「持续热度」，是隔周回潮）
      const gapDays = old.lastSeen ? (Date.parse(today + "T00:00:00Z") - Date.parse(old.lastSeen + "T00:00:00Z")) / 86400000 : 99;
      it.streak = old.lastSeen === today ? old.streak : gapDays > 2 ? 1 : (old.streak || 1) + 1;
      it.firstSeen = old.firstSeen || today;
      it.daysOnBoard = Math.max(1, it.streak);
    } else {
      it.streak = 1;
      it.firstSeen = today;
      it.daysOnBoard = 1;
    }
    // 热度增速：⭐/▲ 的日环比 + 自创建以来的平均日增
    const prevDay = old && old.lastSeen !== today ? old.lastSeen : null;
    applyGrowth(it, old, today);
    entries[key] = {
      firstSeen: it.firstSeen,
      lastSeen: today,
      streak: it.streak,
      title: it.title,
      url: it.url,
      cat: it.cat,
      pop: it.pop,
      // 基准一起存下来：同一天重跑时靠它复现同一组增速，
      // 否则第二天手动重跑会把前一天的百分比洗成 null。
      basePop: it.growthBase != null ? it.growthBase : old && old.lastSeen === today ? old.basePop || null : null,
      baseDay: old && old.lastSeen === today ? old.baseDay || null : prevDay,
    };
  }

  // 清理超过保留期的历史（保留今天出现的全部）
  const cutoff = new Date(Date.parse(today + "T00:00:00Z") - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  for (const [k, v] of Object.entries(entries)) {
    if (!seenToday.has(k) && v.lastSeen < cutoff) delete entries[k];
  }

  const total = Object.keys(entries).length;
  mkdirSync(dirname(HISTORY), { recursive: true });
  writeFileSync(
    HISTORY,
    JSON.stringify({ updatedAt: new Date().toISOString(), date: today, total, entries }, null, 2),
    "utf8"
  );
  return items;
}

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
  const today = beijingDate(now);
  seedHistoryFromSnapshot(today);
  applyStreak(top, today);
  const hot = top.filter((i) => i.streak >= 2).length;
  const payload = {
    generatedAt: now.toISOString(),
    date: beijingDate(now),
    total: top.length,
    items: top,
    errors,
    note:
      "由 scripts/fetch-hustles.mjs 每日自动抓取（GitHub Actions）。来源：GitHub 新仓库 / Hacker News Show HN / Product Hunt；cat 为关键词自动归类，score 为热度自动评分。streak 为连续上榜天数（🔥 持续热度），点开原帖核验后再决定是否跟进。",
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`💾 已写入 ${OUT}：共 ${top.length} 条新机会（其中 🔥 持续上榜 ${hot} 条），用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
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
