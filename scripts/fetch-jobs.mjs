#!/usr/bin/env node
/**
 * 每日远程职位抓取脚本
 * 数据来源（均为公开免费接口，无需 API Key）：
 *   1. Remotive API        https://remotive.com/api/remote-jobs
 *   2. We Work Remotely RSS https://weworkremotely.com/categories/remote-programming-jobs.rss 等
 *   3. Remote OK API       https://remoteok.com/api
 *   4. Hacker News「Who is hiring?」 Algolia API（每月一帖，取最新一帖）
 *
 * 运行：node scripts/fetch-jobs.mjs
 * 输出：data/daily-updates.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "daily-updates.json");
const TIMEOUT_MS = 15000;
const MAX_PER_SOURCE = 12;

const errors = [];

const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchText(url, { ua = UA_BROWSER } = {}) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": ua,
        Accept: "application/json, application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) {
      const hint = res.status === 403 ? "blocked (403)" : `HTTP ${res.status}`;
      throw new Error(hint);
    }
    // 显式按 UTF-8 解码，避免 res.text() 依赖响应头 charset 导致乱码
    const buf = await res.arrayBuffer();
    return new TextDecoder("utf-8").decode(buf);
  } finally {
    clearTimeout(tm);
  }
}

/** 修复双重编码乱码：Remote OK 部分标题是 UTF-8 被误读为 Latin-1 后再编码的结果（如 MecÃ¡nico → Mecánico） */
function fixMojibake(s = "") {
  if (!/[Ãâ€“]/.test(s)) return s; // 含 Ã/Â/â€‹ 等典型乱码字符才处理
  try {
    const fixed = Buffer.from(s, "latin1").toString("utf8");
    // 修复后不应再出现替换符，且长度合理才采用
    if (!fixed.includes("\uFFFD") && fixed.length >= s.length - 2) return fixed;
  } catch { /* keep original */ }
  return s;
}

function decodeXml(s = "") {
  const cp = (n) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "");
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

/** ---------- 来源 1：Remotive ---------- */
async function fetchRemotive() {
  const raw = await fetchText("https://remotive.com/api/remote-jobs?limit=30");
  const data = JSON.parse(raw);
  return (data.jobs || []).slice(0, MAX_PER_SOURCE).map((j) => ({
    title: j.title || "Untitled",
    company: j.company_name || "",
    location: j.candidate_required_location || "Anywhere",
    category: j.category || "",
    url: j.url,
    date: (j.publication_date || "").slice(0, 10),
    source: "Remotive",
  }));
}

/** ---------- 来源 2：Remote OK ---------- */
async function fetchRemoteOK() {
  const raw = await fetchText("https://remoteok.com/api", {
    ua: "ai-sidehustle-hub/1.0 (daily job updater)",
  });
  const list = JSON.parse(raw)
    .filter((x) => x && x.position && x.url && x.slug)
    // 过滤掉公司招聘聚合类占位帖，只保留真实职位
    .filter((x) => !/^(all other|new) jobs$/i.test(x.position || ""));
  return list.slice(0, MAX_PER_SOURCE).map((j) => ({
    title: fixMojibake(j.position),
    company: fixMojibake(j.company || ""),
    location: j.location || "Anywhere",
    category: Array.isArray(j.tags) ? j.tags.slice(0, 3).join(" · ") : "",
    url: j.url.startsWith("http") ? j.url : `https://remoteok.com${j.url}`,
    date: j.date ? j.date.slice(0, 10) : "",
    source: "Remote OK",
  }));
}

/** ---------- 来源 3：We Work Remotely RSS（取招聘类目） ---------- */
const WWR_FEEDS = [
  ["编程", "https://weworkremotely.com/categories/remote-programming-jobs.rss"],
  ["设计/UX", "https://weworkremotely.com/categories/remote-design-and-ux-jobs.rss"],
];
async function fetchWWR() {
  const out = [];
  for (const [cat, feed] of WWR_FEEDS) {
    try {
      const xml = await fetchText(feed);
      const items = xml.split(/<item>/i).slice(1, 9);
      for (const it of items) {
        const title = tag(it, "title");
        const link = tag(it, "link");
        if (!title || !link) continue;
        // WWR 标题形如 "公司: 职位"
        const idx = title.indexOf(":");
        out.push({
          title: idx > 0 ? title.slice(idx + 1).trim() : title,
          company: idx > 0 ? title.slice(0, idx).trim() : "",
          location: tag(it, "region") || "Anywhere",
          category: cat,
          url: link,
          date: (tag(it, "pubDate") || "").slice(5, 16),
          source: "We Work Remotely",
        });
      }
    } catch (e) {
      errors.push(`WWR(${cat}): ${e.message}`);
    }
  }
  return out.slice(0, MAX_PER_SOURCE);
}

/** ---------- 来源 4：HN Who is hiring（最新一帖的条目数统计 + 精选） ---------- */
async function fetchHNHiring() {
  const res = await fetchText(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=3"
  );
  const hits = JSON.parse(res).hits || [];
  const latest = hits.find((h) => /who.*hiring/i.test(h.title || ""));
  if (!latest) return [];
  // 用 Items API 拉取完整楼层（search API 不保证返回 children）
  let kids = 0;
  let threads = [];
  try {
    const tree = JSON.parse(await fetchText(`https://hn.algolia.com/api/v1/items/${latest.objectID}`));
    threads = (tree.children || []).filter((c) => c && (c.id || c.objectID) && (c.text || c.comment_text));
    kids = threads.length;
  } catch (e) {
    errors.push(`HN(threads): ${e.message}`);
  }
  // 只取前几条做展示，并附带帖子链接
  const items = threads
    .slice(0, 6)
    .map((c) => {
      const text = decodeXml(c.comment_text || c.text || "");
      const m = text.match(/^(?:[A-Z][\w&.\- ]{1,40})/);
      return {
        title: (c.title || text).slice(0, 110) || "(see post)",
        company: m ? m[0] : "",
        location: /remote|anywhere/i.test(text) ? "Remote" : "See post",
        category: "HN Who is hiring",
        url: `https://news.ycombinator.com/item?id=${c.objectID || c.id}`,
        date: c.created_at_i
          ? new Date(c.created_at_i * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        source: "Hacker News",
      };
    });
  if (items.length) items.unshift({
    title: `🧵 HN「Who is hiring?」${new Date().toISOString().slice(0, 7)} 月度招聘楼已更新`,
    company: "news.ycombinator.com",
    location: "共 " + kids + " 条新职位",
    category: "月更",
    url: `https://news.ycombinator.com/item?id=${latest.objectID}`,
    date: new Date().toISOString().slice(0, 10),
    source: "Hacker News",
  });
  return items;
}

/** ---------- 来源 5：Jobicy（公开 JSON API，无需 Key） ---------- */
async function fetchJobicy() {
  const raw = await fetchText("https://jobicy.com/api/v2/remote-jobs?count=15", {
    ua: "ai-sidehustle-hub/1.0 (daily job updater)",
  });
  const data = JSON.parse(raw);
  return (data.jobs || []).slice(0, MAX_PER_SOURCE).map((j) => ({
    title: j.jobTitle || "Untitled",
    company: j.companyName || "",
    location: j.jobGeo || "Anywhere",
    category: j.jobLevel || j.jobIndustry?.[0] || "",
    url: j.url,
    date: (j.pubDate || "").slice(0, 10),
    source: "Jobicy",
  }));
}

/** ---------- 主流程 ---------- */
async function main() {
  const started = Date.now();
  console.log("📡 开始抓取远程职位…");

  const sources = [
    ["Remotive", fetchRemotive],
    ["Remote OK", fetchRemoteOK],
    ["Jobicy", fetchJobicy],
    ["We Work Remotely", fetchWWR],
    ["Hacker News", fetchHNHiring],
  ];

  let jobs = [];
  await Promise.all(
    sources.map(async ([name, fn]) => {
      try {
        const list = await fn();
        console.log(`  ✅ ${name}: ${list.length} 条`);
        jobs = jobs.concat(list);
      } catch (e) {
        console.error(`  ❌ ${name}: ${e.message}`);
        errors.push(`${name}: ${e.message}`);
      }
    })
  );

  // 去重（按 url）
  const seen = new Set();
  jobs = jobs.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url));

  const now = new Date();
  const payload = {
    generatedAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    total: jobs.length,
    jobs,
    errors,
    note: "由 scripts/fetch-jobs.mjs 每日自动抓取（GitHub Actions），来源：Remotive / Remote OK / We Work Remotely / HN Who is hiring",
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`💾 已写入 ${OUT}：共 ${jobs.length} 条职位，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (errors.length) {
    console.warn(`⚠️ ${errors.length} 个来源失败：`, errors.join(" | "));
    process.exitCode = 0; // 部分失败不阻塞 CI
  }
}

main().catch((e) => {
  console.error("抓取失败：", e);
  // CI 中即使全部失败也生成空快照，保证页面可降级显示
  try {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
        total: 0,
        jobs: [],
        errors: [String(e && e.message || e)],
        note: "本次抓取失败，已生成空快照以保底",
      }, null, 2)
    );
    process.exit(0);
  } catch {
    process.exit(1);
  }
});
