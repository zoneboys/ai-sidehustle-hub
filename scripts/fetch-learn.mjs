#!/usr/bin/env node
/**
 * 每日在线学习内容抓取脚本
 *
 * 学习区（data/daily-learn.json）由本脚本每日自动刷新，分 5 条赛道：
 *   1. code  编程      —— dev.to API（programming/webdev/tutorial）、freeCodeCamp news RSS
 *   2. ai    AI 学习   —— dev.to API（ai/llm/machine-learning）、arXiv cs.AI/cs.LG/cs.CL
 *   3. k12   K12 学习  —— 哔哩哔哩公开搜索接口（小学/初中/高中同步课、奥数、语法）
 *   4. lang  语言/考证 —— wordfeel.cc 场景剧场 API、TapTapGo 打字课程 API
 *   5. cn    中文效率  —— 少数派 RSS、36氪 RSS
 *
 * 全部为公开免费接口，无需 API Key。运行：node scripts/fetch-learn.mjs
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "daily-learn.json");
const PREV = join(__dirname, "..", "data", "daily-learn.json");
const TIMEOUT_MS = 18000;
const PER_TRACK = 12;

const errors = [];
const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const TRACKS = {
  code: { name: "编程", emoji: "💻" },
  ai: { name: "AI 学习", emoji: "🤖" },
  k12: { name: "K12 学习", emoji: "🎒" },
  lang: { name: "语言/考证", emoji: "🗣️" },
  cn: { name: "中文效率", emoji: "📰" },
};

async function fetchOnce(url, headers) {
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

/** 网络抖动重试：只对超时/连接失败重试，HTTP 4xx/5xx 直接抛出不浪费配额 */
async function fetchText(url, headers = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchOnce(url, headers);
    } catch (e) {
      const msg = String((e && e.message) || e);
      // 4xx 不重试；429/502/503/504 属于临时故障，值得重试
      const retriable = /HTTP (429|502|503|504)/.test(msg) || !/HTTP [45]/.test(msg);
      if (!retriable || i === retries) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

/** 每日稳定产出的兜底快照：抓取全挂时页面仍能看到完整的学习模块 */
function fallback() {
  const prev = existsSync(PREV) ? JSON.parse(readFileSync(PREV, "utf8")) : null;
  if (prev && prev.items && prev.items.length) {
    return { ...prev, stale: true, note: prev.note + "（本次抓取全部失败，展示上一次成功抓取的内容）" };
  }
  return { generatedAt: new Date().toISOString(), date: new Date().toISOString().slice(0, 10), items: [], errors: ["首次抓取失败"], note: "本次抓取失败，已生成空快照以保底" };
}

/* ---------- 通用小工具 ---------- */

const strip = (s = "") =>
  String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp|ldquo|rdquo|hellip);/g, (_, e) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", nbsp: " ", ldquo: "“", rdquo: "”", hellip: "…" }[e])
    )
    .replace(/\s+/g, " ")
    .trim();

const cut = (s = "", n = 118) => (strip(s).length > n ? strip(s).slice(0, n) + "…" : strip(s));

/** 去重键用「链接 + 标题」：同一站点（如 wordfeel / TapTapGo）下多条内容共享首页 URL，只看 url 会误杀 */
const uniqKey = (it) => `${it.url || ""}|${it.title || ""}`.toLowerCase().trim();

/** 相关度评分：关键词命中 + 时效（越新分越高），0-10 */
function score(text, iso, kws) {
  let s = 4;
  const t = String(text).toLowerCase();
  let hit = 0;
  for (const k of kws) if (t.includes(k)) hit++;
  s += Math.min(4, hit * 1.5);
  if (iso) {
    const days = (Date.now() - new Date(iso).getTime()) / 86400000;
    if (!Number.isNaN(days)) s += days < 2 ? 2 : days < 8 ? 1.2 : days < 30 ? 0.5 : -1;
  }
  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

/* ---------- RSS 解析（无依赖） ---------- */
function parseRss(xml, { source, track, urlBase = "", keywords = [], limit = PER_TRACK }) {
  const out = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      if (!m) return "";
      return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    };
    const link = strip(pick("link"));
    const title = strip(pick("title"));
    if (!title || !link) continue;
    const date = pick("pubDate") || pick("dc:date") || "";
    const t = Date.parse(date);
    out.push({
      title,
      url: urlBase ? new URL(link, urlBase).href : link,
      desc: cut(pick("description") || pick("content:encoded"), 130),
      source,
      track,
      date: Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10),
      score: score(title + " " + pick("description"), date, keywords),
    });
    if (out.length >= limit) break;
  }
  return out;
}
/* ================= 数据源 1：dev.to（编程 / AI 双赛道） ================= */
const DEVTO_TAGS = {
  code: {
    tags: ["programming", "webdev", "tutorial", "beginners", "career"],
    keywords: ["learn", "tutorial", "beginner", "roadmap", "guide", "how to", "build", "ship", "project", "interview"],
  },
  ai: {
    tags: ["ai", "llm", "machinelearning", "gpt", "agents", "rag"],
    keywords: ["ai", "llm", "gpt", "agent", "rag", "prompt", "model", "fine-tun", "vector", "embedding", "mcp"],
  },
};

async function fromDevTo(track) {
  const { tags, keywords } = DEVTO_TAGS[track];
  const out = [];
  for (const tag of tags.slice(0, 3)) {
    try {
      const url = `https://dev.to/api/articles?tag=${tag}&top=30&per_page=6`;
      const list = JSON.parse(await fetchText(url));
      for (const a of list) {
        out.push({
          title: strip(a.title),
          url: a.url,
          desc: cut(a.description, 130),
          source: "dev.to",
          author: a.user && a.user.name,
          track,
          date: a.published_at ? a.published_at.slice(0, 10) : "",
          score: score(`${a.title} ${a.description} ${(a.tag_list || []).join(" ")} ${(a.tags || "").replace(/<[^>]+>/g, " ")}`, a.published_at, keywords),
        });
      }
    } catch (e) {
      errors.push(`dev.to/${tag}(${track}): ${e.message}`);
    }
  }
  return out;
}

/* ================= 数据源 2：freeCodeCamp news RSS（编程） ================= */
async function fromFreeCodeCamp() {
  try {
    return parseRss(await fetchText("https://www.freecodecamp.org/news/rss/"), {
      source: "freeCodeCamp",
      track: "code",
      urlBase: "https://www.freecodecamp.org",
      keywords: ["learn", "tutorial", "learner", "course", "career", "project", "guide", "beginner"],
      limit: PER_TRACK,
    });
  } catch (e) {
    errors.push(`freeCodeCamp: ${e.message}`);
    return [];
  }
}
/* ================= 数据源 3：arXiv（AI 学习：最新论文摘要） ================= */
const ARXIV_CATS = [
  { q: "cat:cs.AI", label: "cs.AI" },
  { q: "cat:cs.LG", label: "cs.LG" },
  { q: "cat:cs.CL", label: "cs.CL" },
];

async function fromArxiv() {
  const out = [];
  for (const c of ARXIV_CATS) {
    try {
      const url =
        `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(c.q)}` +
        `&sortBy=submittedDate&sortOrder=descending&max_results=6`;
      const xml = await fetchText(url);
      for (const e of xml.split(/<entry>/i).slice(1)) {
        const pick = (tag) => {
          const m = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
          return m ? m[1].replace(/\s+/g, " ").trim() : "";
        };
        const title = strip(pick("title"));
        const link = strip(pick("id"));
        if (!title || !link) continue;
        const date = pick("published");
        out.push({
          title,
          url: link.replace(/^http:/, "https:"),
          desc: cut(pick("summary"), 150),
          source: `arXiv ${c.label}`,
          track: "ai",
          date: date ? date.slice(0, 10) : "",
          score: score(title + " " + pick("summary"), date, ["agent", "llm", "rag", "fine-tun", "multimodal", "reasoning", "training", "efficien", "benchmark"]),
        });
      }
    } catch (e) {
      errors.push(`arxiv/${c.label}: ${e.message}`);
    }
  }
  return out;
}

/* ================= 数据源 4：哔哩哔哩公开搜索（K12 同步课 / 编程 / AI 教学） ================= */
const BILI_QUERIES = [
  { k: "小学数学 思维 同步", track: "k12" },
  { k: "初中数学 二次函数 精讲", track: "k12" },
  { k: "初中物理 八年级 同步", track: "k12" },
  { k: "高中英语 语法 系统", track: "k12" },
  { k: "小学语文 阅读 写作", track: "k12" },
  { k: "python 入门 零基础", track: "code" },
  { k: "前端 开发 实战 教程", track: "code" },
  { k: "大模型 应用开发 教程", track: "ai" },
];

async function fromBilibili() {
  const out = [];
  for (const q of BILI_QUERIES) {
    try {
      const url =
        "https://api.bilibili.com/x/web-interface/wbi/search/type" +
        `?search_type=video&keyword=${encodeURIComponent(q.k)}&page=1`;
      const json = JSON.parse(await fetchText(url, { Referer: "https://www.bilibili.com/" }));
      const res = (json.data && json.data.result) || [];
      for (const v of res.slice(0, 6)) {
        const title = strip(v.title);
        if (!title) continue;
        out.push({
          title,
          url: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : (v.arcurl || "").replace(/^http:/, "https:"),
          desc: `${v.author || "UP主"} · ${v.play || 0} 播放 · 时长 ${v.duration || "-"}`,
          source: "哔哩哔哩",
          author: v.author,
          track: q.track,
          date: v.pubdate ? new Date(v.pubdate * 1000).toISOString().slice(0, 10) : "",
          score: Math.min(10, Math.round((Math.log10(Math.max(1, v.play || 0)) - 3) * 1.6 * 10) / 10),
        });
      }
    } catch (e) {
      errors.push(`bilibili/${q.k}: ${e.message}`);
    }
  }
  return out;
}

/* ================= 数据源 5：wordfeel.cc 场景剧场（英语真实对白） ================= */
async function fromWordFeel() {
  try {
    const out = [];
    for (const s of ["s01", "s02", "s03", "s04"]) {
      try {
        const raw = await fetchText(`https://wordfeel.cc/api/scene-theater/v1/seasons/${s}`);
        const j = JSON.parse(raw);
        const pub = j.publication || {};
        if (pub.canPublic === false) continue;
        const eps = (j.episodes || []).slice(0, 8);
        for (const ep of eps) {
          const first = (ep.scenes || [])[0] || {};
          out.push({
            title: `第 ${ep.episodeNumber} 集 · ${first.titleZh || first.titleEn || "真实对白场景"}`,
            url: `https://wordfeel.cc/`,
            desc: cut(first.titleEn ? `${first.titleEn} —— ${first.titleZh}` : first.titleZh || "真实对白拆解练习", 120),
            source: "wordfeel 场景剧场",
            track: "lang",
            date: "",
            score: 7.5,
            meta: `共 ${j.episodeCount || eps.length} 集 / ${j.sceneCount || 0} 个场景`,
          });
        }
      } catch (e) {
        // 季号不存在（404）是正常情况，不算来源故障
        if (!/HTTP 404/.test(e.message)) errors.push(`wordfeel/${s}: ${e.message}`);
      }
    }
    return out;
  } catch (e) {
    errors.push(`wordfeel: ${e.message}`);
    return [];
  }
}

/* ================= 数据源 6：TapTapGo 指尖冒险（打字 / 键位课程） ================= */
async function fromTapTapGo() {
  try {
    const out = [];
    const courses = JSON.parse(await fetchText("https://taptapgo.yldm.ai/api/v1/courses"));
    for (const c of (courses || []).slice(0, 8)) {
      out.push({
        title: `${c.titleZh || c.titleEn}（${c.unitCount || 0} 单元）`,
        url: "https://taptapgo.yldm.ai/app/",
        desc: cut(c.descriptionZh || c.descriptionEn, 120),
        source: "TapTapGo 指尖冒险",
        track: "lang",
        date: "",
        score: 7,
      });
    }
    try {
      const lessons = JSON.parse(await fetchText("https://taptapgo.yldm.ai/api/v1/lessons?limit=12"));
      for (const l of (lessons.items || []).slice(0, 10)) {
        out.push({
          title: `课文练习 · ${l.title}`,
          url: "https://taptapgo.yldm.ai/app/",
          desc: `${l.author || ""} · ${l.charCount || 0} 字 · 难度 ${l.difficulty || "-"} · 边打字边背课文`,
          source: "TapTapGo 课文库",
          track: "lang",
          date: "",
          score: 7.2,
        });
      }
    } catch (e) {
      errors.push(`taptapgo/lessons: ${e.message}`);
    }
    return out;
  } catch (e) {
    errors.push(`taptapgo: ${e.message}`);
    return [];
  }
}

/* ================= 数据源 7：中文效率 RSS（少数派 / 36氪） ================= */
const CN_FEEDS = [
  {
    url: "https://sspai.com/feed",
    source: "少数派",
    track: "cn",
    keywords: ["效率", "时间", "工具", "ai", "工作流", "自动化", "笔记", "方法"],
  },
  {
    url: "https://www.36kr.com/feed",
    source: "36氪",
    track: "cn",
    keywords: ["ai", "大模型", "编程", "教育", "学习", "编程", "token", "智能体", "开源"],
  },
];

async function fromCnFeeds() {
  const out = [];
  for (const f of CN_FEEDS) {
    try {
      out.push(...parseRss(await fetchText(f.url), { ...f, urlBase: "", limit: 8 }));
    } catch (e) {
      errors.push(`${f.source}: ${e.message}`);
    }
  }
  return out;
}
/* ================= 主流程 ================= */
const SOURCES = [
  { name: "dev.to/编程", run: () => fromDevTo("code") },
  { name: "dev.to/AI", run: () => fromDevTo("ai") },
  { name: "freeCodeCamp", run: fromFreeCodeCamp },
  { name: "arXiv", run: fromArxiv },
  { name: "哔哩哔哩", run: fromBilibili },
  { name: "wordfeel", run: fromWordFeel },
  { name: "TapTapGo", run: fromTapTapGo },
  { name: "中文RSS", run: fromCnFeeds },
];

async function main() {
  const started = Date.now();
  const perSource = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        return { name: s.name, items: await s.run() };
      } catch (e) {
        errors.push(`${s.name}: ${e.message}`);
        return { name: s.name, items: [] };
      }
    })
  );

  // 按赛道去重 + 排序 + 截断
  const byTrack = {};
  for (const t of Object.keys(TRACKS)) byTrack[t] = [];
  const seen = new Set();
  for (const { items } of perSource) {
    for (const it of items) {
      const k = uniqKey(it);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (!byTrack[it.track]) continue;
      byTrack[it.track].push(it);
    }
  }
  for (const t of Object.keys(byTrack)) {
    byTrack[t].sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
    byTrack[t] = byTrack[t].slice(0, t === "lang" ? 24 : PER_TRACK);
  }

  const flat = Object.values(byTrack).flat();
  if (flat.length < 5) {
    console.warn("⚠️ 抓取条目过少，使用上一次成功快照兜底");
    const fb = fallback();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(fb, null, 2), "utf8");
    console.log(`💾 已写入兜底快照 ${OUT}`);
    return;
  }

  const now = new Date();
  const payload = {
    generatedAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    tracks: TRACKS,
    counts: Object.fromEntries(Object.entries(byTrack).map(([k, v]) => [k, v.length])),
    total: flat.length,
    items: flat,
    errors,
    note:
      "由 scripts/fetch-learn.mjs 每日自动抓取（GitHub Actions）。来源：dev.to / freeCodeCamp / arXiv / 哔哩哔哩 / wordfeel.cc / TapTapGo / 少数派 / 36氪；score 为自动相关度评分（关键词命中 + 时效）",
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(
    `💾 已写入 ${OUT}：共 ${flat.length} 条（` +
      Object.entries(byTrack).map(([k, v]) => `${TRACKS[k].name} ${v.length}`).join(" / ") +
      `），用时 ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
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
