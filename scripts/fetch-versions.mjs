#!/usr/bin/env node
/**
 * 版本变更自动抓取（data/versions.json）
 *
 * 解决「知识库全是写死的、模型/工具版本信息永不更新」的问题。
 * 抓各家官方 changelog（RSS / Atom），产出带【影响分级】的变更流。
 *
 * 关键点：不是又一条 RSS 列表。每条变更都会被判定成
 *   - 影响级别：break / api / security / feature / perf / fix
 *   - 对「用 AI 做副业的人」意味着什么：impact 标签 + 一句人话解读
 * 例如「OpenAI 把某模型下线」会被标成 api+弃用，并提示
 * 「你现有调用会 404，今天就该换模型」——这是纯信息流给不出的东西。
 *
 * 全部为公开免费源，无需 API Key。运行：node scripts/fetch-versions.mjs
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "versions.json");
const PREV = OUT;
const TIMEOUT_MS = 20000;
/** 每个源最多保留条数：OpenAI 的 news feed 有 1200+ 条历史，全收会让文件膨胀到几百 KB。
 * 博客源比 release 源噪声大（夹带市场软文），取更少。 */
const PER_RELEASE = 6;
const PER_FEED = 4;

const beijingDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const errors = [];
const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* ---------------- 数据源（全部经 curl 实测 200 + 有条目） ----------------
 * Anthropic 没有官方 RSS，Google/HuggingFace 的 feed 在本机网络不可达，
 * 所以没有收录——宁可少收几个源，也不要让脚本看起来在跑其实是空的。 */
export const SOURCES = [
  // kind=release：GitHub Releases，是真·版本发布
  { id: "openai", name: "OpenAI", kind: "feed", url: "https://openai.com/news/rss.xml", group: "大模型" },
  { id: "cloudflare", name: "Cloudflare", kind: "feed", url: "https://blog.cloudflare.com/rss/", group: "基础设施" },
  { id: "vscode", name: "VS Code", kind: "feed", url: "https://code.visualstudio.com/feed.xml", group: "开发工具" },
  { id: "ollama", name: "Ollama", kind: "release", url: "https://github.com/ollama/ollama/releases.atom", group: "本地模型" },
  { id: "vllm", name: "vLLM", kind: "release", url: "https://github.com/vllm-project/vllm/releases.atom", group: "本地模型" },
  { id: "llamacpp", name: "llama.cpp", kind: "release", url: "https://github.com/ggml-org/llama.cpp/releases.atom", group: "本地模型" },
  { id: "langchain", name: "LangChain", kind: "release", url: "https://github.com/langchain-ai/langchain/releases.atom", group: "开发框架" },
  { id: "openai-py", name: "OpenAI Python SDK", kind: "release", url: "https://github.com/openai/openai-python/releases.atom", group: "开发框架" },
  { id: "transformers", name: "Transformers", kind: "release", url: "https://github.com/huggingface/transformers/releases.atom", group: "开发框架" },
  { id: "unsloth", name: "Unsloth", kind: "release", url: "https://github.com/unslothai/unsloth/releases.atom", group: "开发框架" },
  { id: "fastapi", name: "FastAPI", kind: "release", url: "https://github.com/fastapi/fastapi/releases.atom", group: "开发框架" },
  { id: "openwebui", name: "Open WebUI", kind: "release", url: "https://github.com/open-webui/open-webui/releases.atom", group: "AI 应用" },
  { id: "dify", name: "Dify", kind: "release", url: "https://github.com/langgenius/dify/releases.atom", group: "AI 应用" },
  { id: "react", name: "React", kind: "release", url: "https://github.com/facebook/react/releases.atom", group: "开发框架" },
];

/** 页面上的分组顺序（不按字母排） */
export const GROUPS = ["大模型", "本地模型", "AI 应用", "开发框架", "开发工具", "基础设施"];

/* ---------------- 网络 ---------------- */

async function fetchOnce(url) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA_BROWSER, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return new TextDecoder("utf-8").decode(buf);
  } finally {
    clearTimeout(tm);
  }
}

/** GitHub 的 releases.atom 很容易被连接重置/限流（实测 14 个源能挂 6~9 个），
 * 重试次数给足，退避也拉长一点。 */
async function fetchText(url, retries = 4) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchOnce(url);
    } catch (e) {
      const msg = String((e && e.message) || e);
      const retriable = /HTTP (429|502|503|504)/.test(msg) || !/HTTP [45]/.test(msg);
      if (!retriable || i === retries) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

/* ---------------- XML 解析 ---------------- */

export function stripTags(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp|hellip|mdash|ndash|#8217|#8211);/g, (_, e) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", "#8217": "’", "#8211": "—" }[e])
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 清理摘要。RSS 描述里大量套话尾巴（"Read the full article" / "Continue reading →" /
 * "The post X appeared first on Y."），直接显示在卡片上很难看，而且会把真正有用的
 * 首句往后挤。只截首句，不截字数。
 */
export function cleanSummary(s = "") {
  let t = String(s).trim();
  t = t
    .replace(/^the post .*? appeared first on .*$/i, "")
    .replace(/\b(read (the )?(full )?article|continue reading|read more|learn more)\b\.?/gi, "")
    .replace(/[»>→]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // 取第一个句子（句号后跟空格且后面还有内容），避免半句截断
  const m = t.match(/^[\s\S]{0,180}?[.!?](?=\s|$)/);
  if (m) t = m[0];
  return t.slice(0, 200).trim();
}

const unescapeXml = (s = "") =>
  String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const tagText = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? unescapeXml(m[1]) : "";
};

/** Atom 的 <link href="..."/> 没有正文，RSS 的 <link>xxx</link> 有——两种都要认 */
function linkOf(block) {
  const href = block.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\s*\/>/i);
  if (href) return unescapeXml(href[1]);
  const alt = block.match(/<link[^>]*\bhref=["']([^"']+)["']/i);
  if (alt) return unescapeXml(alt[1]);
  const txt = tagText(block, "link");
  if (txt && /^https?:/i.test(txt)) return txt.trim();
  const guid = tagText(block, "guid");
  return /^https?:/i.test(guid) ? guid.trim() : "";
}

/** 源里一共有多少条（不管有没有被噪声过滤器丢掉），用于区分「结构变了」和「全是噪声」 */
export function countFeedBlocks(xml) {
  return (String(xml).match(/<(item|entry)(?:\s[^>]*)?>/gi) || []).length;
}

/** RSS 用 <item>，Atom 用 <entry>，两者字段名还不一样 */
export function parseFeed(xml, src) {
  const blocks = String(xml).match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = stripTags(tagText(b, "title"));
    const url = linkOf(b);
    if (!title || !url || isJunk(title)) continue;
    const rawDate = tagText(b, "updated") || tagText(b, "pubDate") || tagText(b, "published") || tagText(b, "date");
    // 没日期的条目不能当成 1970 年：withinDays 会把它们全滤掉，
    // 于是那个源静默变成 0 条，而页面上只看得到「今天没新东西」。
    // 宁可按「今天」算（当天抓到的就是最新），也不能让整个源凭空消失。
    const parsed = rawDate ? Date.parse(rawDate) : NaN;
    const ts = Number.isFinite(parsed) ? parsed : Date.now();
    const summary = cleanSummary(stripTags(tagText(b, "description") || tagText(b, "summary") || tagText(b, "content")));
    out.push({
      sourceId: src.id,
      source: src.name,
      group: src.group,
      kind: src.kind,
      title,
      url,
      summary,
      // 用 beijingDate 而不是 toISOString().slice(0,10)：后者是 UTC。
      // 北京时间早上 8 点前发布的变更会被标成前一天，而全站其他口径都是 UTC+8。
      date: beijingDate(new Date(ts)),
      ts,
    });
  }
  return out;
}

/* ---------------- 影响分级：这块是脚本存在的理由 ----------------
 * 纯信息流只会告诉你「X 发布了 v2.0」。这里要回答的是
 * 「一个用 AI 搞副业的人，今天要不要动他的代码/流程/选题」。 */

/** 破坏性变更 > 弃用 > 安全 > 新能力 > 性能 > 修复。前两个必须立刻看。
 * notice 只用于博客/新闻源（它们本来就不是版本发布）。 */
export const LEVELS = {
  break: { name: "破坏性变更", emoji: "🔴", rank: 6 },
  deprecate: { name: "弃用/下线", emoji: "🟠", rank: 5 },
  security: { name: "安全", emoji: "🟡", rank: 4 },
  feature: { name: "新能力", emoji: "🟢", rank: 3 },
  perf: { name: "性能", emoji: "🔵", rank: 2 },
  fix: { name: "修复", emoji: "⚪", rank: 1 },
  notice: { name: "官方发布", emoji: "📣", rank: 2 },
};

/** 顺序即优先级：先命中 break 就不会再被判成 fix */
const LEVEL_RULES = [
  ["break", /breaking change|backward[- ]incompatibl|不兼容|破坏性|\bBREAKING\b/i],
  ["deprecate", /deprecat|sunset|end of life|eol\b|retire|下线|弃用|停止服务|will be removed/i],
  ["security", /\bCVE-\d{4}-\d+|security (fix|vulnerab|advisory)|vulnerab|漏洞|安全修复/i],
  ["feature", /introduc|add(s|ed)? (support|new)|new (feature|model|api)|支持|新增|上线|发布|now (supports|available)|支持了|GA\b|general availability/i],
  ["perf", /performance|faster|optimi[sz]|speedup|throughput|latency|提速|优化|性能/i],
  ["fix", /\bfix(es|ed)?\b|bug|crash|修复|修正|patch/i],
];

/** 对「做副业的人」的直接影响。value 就是页面上显示的那句人话。 */
export const IMPACTS = {
  code: "⚠️ 影响代码：你现有的调用可能直接报错，优先验证自己的项目",
  security: "🔒 安全：如果你部署过带用户数据的服务，这条必须看",
  cost: "💰 影响成本：你写进报价单里的单价可能变了，今天该重算一遍",
  compat: "🧩 需要适配：老项目要跟着改，否则升级反而更慢",
  capability: "🚀 新能力：这是能直接变现的新选题，去看它能做成什么",
  info: "ℹ️ 动态：扫一眼就行，不需要你动手",
};

const IMPACT_RULES = [
  ["code", /breaking change|backward[- ]incompatibl|sunset|deprecat|end of life|\bremoved\b|migration|不兼容|破坏性|下线|弃用|停止服务|will be removed|no longer supported/i],
  ["security", /\bCVE-\d{4}-\d+|security (fix|vulnerab|advisory|release)|vulnerab|漏洞|安全修复/i],
  ["cost", /pricing|\bprice\b|billing|quota|rate limit|token cost|free tier|deprecat|sunset|价格|计费|配额|限额|涨价|免费额度/i],
  ["compat", /\bupgrade\b|migrat|renamed|requires? (node|python)|bump (node|python)|升级|迁移|改名|依赖/i],
  ["capability", /introduc|new (feature|model|api|tool|capabilit)|now (supports|available)|general availability|支持了|新增|上线了|正式发布/i],
];

export function classify(text = "", srcKind = "release", title = "") {
  const t = String(text);
  let level;
  if (srcKind === "feed") {
    // 博客/新闻源不是版本发布：命中强信号才升级，否则就是「官方发布」。
    // （之前所有条目都落到 fix，读起来像「43 条修复」，完全没用。）
    level = "notice";
    for (const [k, re] of LEVEL_RULES) {
      if (k === "fix" || k === "perf") continue; // 博客里的 fix/perf 词太泛，不采信
      if (re.test(t)) { level = k; break; }
    }
  } else {
    level = "fix";
    for (const [k, re] of LEVEL_RULES) {
      if (re.test(t)) { level = k; break; }
    }
  }
  // 默认不是一律 info：否则 6 个影响档里 5 个恒为空（实测 34 条里 32 条 info），
  // 页面上的「需要你动手」筛选器永远点不出东西——那等于没分级。
  // 但也不能反过来给每条都贴「🚀 新能力」：先跑具体规则，命不中才从 level 推导，
  // 而 level 本身已经是「这条到底算不算个变更」的判断。
  let impact = null;
  for (const [k, re] of IMPACT_RULES) {
    if (re.test(t)) { impact = k; break; }
  }
  if (!impact) impact = IMPACT_BY_LEVEL[level] || "info";
  // 「langchain-core==1.6.3」这种只有包名+版本号的标题，即使 changelog 里
  // 飘过一个「支持」也不该被判成「能直接变现的新选题」——版本号本身不是能力。
  if (impact === "capability" && isVersionBump(title)) impact = "info";
  return { level, impact };
}

/** 具体规则都没命中时的兜底：level 已经说明了「这条有多大动静」。 */
const IMPACT_BY_LEVEL = {
  break: "code",
  deprecate: "code",
  security: "security",
  feature: "capability",
  perf: "capability",
  fix: "info",
  notice: "info",
};

/** 标题实质上就是「名字 + 版本号」（monorepo 会一次发十几个这种），没有描述性内容 */
export function isVersionBump(title = "") {
  const t = String(title);
  if (!/\d+\.\d+/.test(t)) return false;
  const words = t
    .replace(/\d[\d.\-+]*/g, " ")
    .replace(/[^A-Za-z㐀-鿿]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length <= 2;
}

/**
 * 噪声过滤。
 * llama.cpp 每天发十几个 b11232 / b11229 这样的夜间构建标签，标题里没有一个词，
 * 挤在列表里毫无信息量（实测占了 43 条里的 6 条）。一律丢。
 */
export function isJunk(title = "") {
  const t = String(title).trim();
  if (t.length < 4) return true;
  // 去掉版本号/构建号后，必须还剩下一个长度≥3 的英文单词，否则就是纯数字标签
  const rest = t.replace(/[0-9][0-9.\-+]*/g, " ").replace(/[^A-Za-z㐀-鿿]+/g, " ");
  const words = rest.split(/\s+/).filter(Boolean);
  if (!words.some((w) => w.length >= 3)) return true;
  // 「Release 5.17.0」「19.3.0 (September 9, 2026)」「proto-v0.3.0」这类
  // 剥掉版本号、发布日期和 Release/Update 等套话后什么都不剩的标题，
  // 跟 b11232 一样没有信息量。
  const filler = /^(release|version|update|build|publish|january|february|march|april|may|june|july|august|september|october|november|december|发布|更新|版本|v)$/i;
  if (!words.some((w) => w.length >= 3 && !filler.test(w))) return true;
  // 「proto-v0.3.0」：GitHub 把一个裸 release tag 当标题发出来，
  // 去掉版本号后只剩一个包名，没有描述性内容。
  return /^[\w.]+-v?\d[\w.+-]*$/.test(t);
}

/** 从标题里抽版本号（v1.2.3 / 0.5.4 / v0.30.1rc0），抽不到返回空 */
export function extractVersion(title = "") {
  const m = String(title).match(/(?:^|[^\w.])v?(\d+\.\d+(?:\.\d+)?)/i);
  return m ? m[1] : "";
}

/* ---------------- 降噪：折叠与去重 ----------------
 * 实测一天 34 条里有 9 条是噪声：
 *   - langchain-core==1.6.5 / langchain-openai==1.6.4 / ... monorepo 一天发十几个包，
 *     标题只有一个包名一个版本号，对「用 AI 做副业的人」零信息量。
 *   - 「Qwen-Image-2.1 + Skills」在 vllm/llama.cpp 等多个源重复出现 3 次。
 * 真正要做副业的人看的是「发生了什么」，不是「哪个包又长了一号」。 */

/** 「langchain-core==1.6.5」这种纯包名+版本号的标题 */
export function isPackageBump(title = "") {
  return /^[A-Za-z0-9_.-]+==\s*v?\d[\w.+-]*$/.test(String(title).trim());
}

/**
 * 降噪总入口：对「合并后的全集」跑一遍 折叠 → 跨源去重 → 噪声过滤 → 重排。
 *
 * 关键：必须作用在合并后的全集上，而不是只对新抓的条目。
 * 只对新条目降噪的话，已经写进快照的历史噪声会一直被 mergeItems 带回来，
 * 规则上线一次也治不干净。测试也直接调这个函数，而不是只看产物数据——
 * 后者在管线改坏时会跟着一起变，测不出任何东西。
 */
export function cleanItems(merged) {
  const { kept, rolled } = rollupPackageBumps(merged);
  return sortItems(dedupeAcrossSources([...kept, ...rolled].filter((i) => !isJunk(i.title))));
}

/** ISO 周键。用周而不是「同一天」：langchain 的 Atom 源一天只发一个包，
 *  一串包版本会横跨好几天才陆续出现（实测 09-22~09-25 每天一个）。 */
function weekKey(date) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(date);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // 移到本周四
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}

/**
 * 把同一源同一周内的包版本变动折叠成一条。
 * 零星几条直接丢弃（langchain-openai==1.6.4 对「做副业的人」零信息量）。
 */
export function rollupPackageBumps(items, minGroup = 3) {
  const bumps = items.filter((i) => isPackageBump(i.title));
  if (!bumps.length) return { kept: items, rolled: [] };

  const groups = new Map();
  for (const it of bumps) {
    const k = `${it.sourceId}|${weekKey(it.date)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const consumed = new Set();
  const rolled = [];
  for (const [k, list] of groups) {
    for (const it of list) consumed.add(it.url);
    // 零星一两个包更新同样丢：langchain-openai==1.6.4 对「做副业的人」零信息量，
    // 摆在列表里只会让人以为今天「没发生什么」是因为漏了。
    if (list.length < minGroup) continue;
    const head = list.find((i) => i.title.startsWith("langchain")) || list[0];
    rolled.push({
      ...head,
      title: `${head.source} 生态 ${list.length} 个包本周更新`,
      summary: list.map((i) => i.title.replace(/==.*/, "")).join("、"),
      level: "fix",
      impact: "info",
      kind: "rollup",
      rolledCount: list.length,
    });
  }
  return { kept: items.filter((i) => !consumed.has(i.url)), rolled };
}

/** 标题指纹：忽略大小写、版本号与标点，用于跨源判重 */
function fingerprint(title = "") {
  return String(title)
    .toLowerCase()
    .replace(/[0-9][0-9.\-+]*/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim();
}

/** 跨源同名去重：同一条变更被多个项目转发时只留一条，附上其余来源。 */export function dedupeAcrossSources(items) {
  const byKey = new Map();
  const out = [];
  for (const it of items) {
    const k = fingerprint(it.title);
    if (!k || k.length < 6) { out.push(it); continue; }
    const hit = byKey.get(k);
    if (!hit) {
      byKey.set(k, it);
      out.push(it);
      continue;
    }
    if (hit.source !== it.source) {
      hit.alsoIn = [...new Set([...(hit.alsoIn || []), it.source])];
      // 转发源往往比原源描述得差，保留信息量更大的那个
      if (String(it.summary || "").length > String(hit.summary || "").length) hit.summary = it.summary;
    }
  }
  return out;
}

/* ---------------- 合并与排序 ---------------- */

/** 保留 30 天。变更是低频事件，存太久只会让 json 无限膨胀。 */
export const KEEP_DAYS = 30;

/** NEW 角标的有效期。超过 2 天就算「旧」——它对用户已经没有新鲜感了。 */
export const NEW_WINDOW_DAYS = 2;

/**
 * 与上次快照合并。
 * - 每条带 firstSeen（第一次出现的日期），isNew 由它与「今天」的距离推导，不直接存布尔值。
 *   存布尔值会出真 bug：条目被标 NEW 后如果源挂了（GitHub 限流时一挂就是 6 个），
 *   下一次合并会把它重置成「旧」，用户还没来得及看就静默降级了。
 * - 本次没被抓到的旧条目也要原样带过，不能因为某个源挂了就丢历史。
 */
export function mergeItems(prevItems, freshItems, day) {
  const today = day || beijingDate();
  const prev = new Map((prevItems || []).map((i) => [i.url, i]));
  const out = [];
  const seen = new Set();
  for (const it of freshItems) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    const old = prev.get(it.url);
    out.push({ ...it, firstSeen: old ? old.firstSeen || old.date || today : today });
  }
  for (const it of prevItems || []) {
    if (seen.has(it.url)) continue;
    out.push({ ...it, firstSeen: it.firstSeen || it.date || today });
  }
  return out;
}

/** ISO 日期字符串可直接按字典序比大小 */
export function isNewItem(firstSeen, now = new Date()) {
  const cutoff = beijingDate(new Date(now.getTime() - NEW_WINDOW_DAYS * 86400000));
  return String(firstSeen || "") >= cutoff;
}

export function withinDays(items, now, days = KEEP_DAYS) {
  const floor = now - days * 86400000;
  return items.filter((i) => timeOf(i) >= floor);
}

/** 上次快照里的条目只有 date 没有 ts（写文件时已剔除），比较器必须回退到 date，
 * 否则 undefined - undefined = NaN，Array.sort 遇到 NaN 会直接乱序。 */
const timeOf = (i) => i.ts || Date.parse(i.date) || 0;

function sortItems(items) {
  return items.sort((a, b) => timeOf(b) - timeOf(a) || String(a.source).localeCompare(String(b.source)));
}

function fallback(extraErrors) {
  if (existsSync(PREV)) {
    try {
      const prev = JSON.parse(readFileSync(PREV, "utf8"));
      if (prev && Array.isArray(prev.items) && prev.items.length) {
        return { ...prev, stale: true, errors: [...(prev.errors || []), ...extraErrors], note: (prev.note || "") + "（本次抓取全部失败，展示上一次成功抓取的结果）" };
      }
    } catch { /* 快照损坏则走空保底 */ }
  }
  return {
    generatedAt: new Date().toISOString(),
    date: beijingDate(),
    groups: GROUPS,
    levels: LEVELS,
    impacts: IMPACTS,
    counts: {},
    total: 0,
    newCount: 0,
    items: [],
    errors: extraErrors,
    stale: true,
    note: "首次抓取失败，已生成空快照保底",
  };
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const started = Date.now();
  let prevItems = [];
  if (existsSync(PREV)) {
    try { prevItems = JSON.parse(readFileSync(PREV, "utf8")).items || []; } catch { prevItems = []; }
  }

  const batches = await Promise.all(
    SOURCES.map(async (src) => {
      try {
        const xml = await fetchText(src.url);
        const items = parseFeed(xml, src);
        if (!items.length) {
          // 区分两种情况：源挂了/结构变了（要报错），源里全是 b11232 这种噪声（不算错）
          if (countFeedBlocks(xml) === 0) throw new Error("解析到 0 条（源结构可能已变）");
          return { src, items: [], error: null };
        }
        const kept = sortItems(items).slice(0, src.kind === "feed" ? PER_FEED : PER_RELEASE);
        return { src, items: kept, error: null };
      } catch (e) {
        const msg = (e && e.message) || String(e);
        errors.push(`${src.id}: ${msg}`);
        return { src, items: [], error: msg };
      }
    })
  );

  // 每源健康度：页面要能像其他模块一样显示「部分来源失败」，否则抓挂了完全看不出来
  const health = batches.map((b) => ({ id: b.src.id, name: b.src.name, url: b.src.url, group: b.src.group, ok: !b.error, n: b.items.length, error: b.error }));
  const okCount = health.filter((s) => s.ok).length;
  if (okCount < SOURCES.length) console.warn(`⚠️ ${SOURCES.length - okCount}/${SOURCES.length} 个源本轮失败`);

  let fresh = batches.flatMap((b) => b.items);
  console.log(`抓取完成：${SOURCES.length} 个源，${fresh.length} 条（${((Date.now() - started) / 1000).toFixed(1)}s）`);
  if (errors.length) console.warn(`⚠️ ${errors.length} 个源失败：`, errors.join(" | "));

  if (!fresh.length) {
    console.warn("⚠️ 全部源失败，沿用上一次快照");
    const fb = fallback(errors);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(fb, null, 2), "utf8");
    return;
  }

  // 先按「每源取前 PER_SOURCE 条」限制体量，再与历史合并，最后再按时间窗收窄
  const enriched = fresh.map((it) => ({ ...it, ...classify(`${it.title} ${it.summary}`, it.kind, it.title), version: extractVersion(it.title) }));

  // 降噪在分类之后：折叠/去重不改变每条的 level/impact
  const before = fresh.length;
  const now = Date.now();
  const merged = withinDays(sortItems(mergeItems(prevItems, enriched, beijingDate(new Date(now)))), now);
  // 降噪对「合并后的全集」做，而不是只对新抓的：
  // 这样上一轮已经写进快照的噪声（包版本刷屏、跨源重发）会被自然清掉，
  // 规则只需上线一次，历史数据会自愈；只对新条目降噪则永远治不干净。
  const deduped = cleanItems(merged);
  if (deduped.length !== before && before) {
    console.log(`降噪：本轮 ${before} 条 → 入库 ${deduped.length} 条`);
  }
  const items = deduped.map(({ ts, ...rest }) => ({ ...rest, isNew: isNewItem(rest.firstSeen, new Date(now)) }));

  const counts = {};
  for (const g of GROUPS) counts[g] = items.filter((i) => i.group === g).length;

  const payload = {
    generatedAt: new Date().toISOString(),
    date: beijingDate(),
    groups: GROUPS,
    levels: LEVELS,
    impacts: IMPACTS,
    counts,
    total: items.length,
    newCount: items.filter((i) => i.isNew).length,
    urgentCount: items.filter((i) => i.level === "break" || i.level === "deprecate").length,
    sources: health,
    items,
    errors,
    note: `由 scripts/fetch-versions.mjs 每日自动抓取（GitHub Actions）。共 ${SOURCES.length} 个官方源，本次成功 ${okCount} 个；level/impact 由关键词规则判定，仅供参考，具体以官方原文为准。保留最近 ${KEEP_DAYS} 天。`,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  const byLevel = {};
  for (const i of items) byLevel[i.level] = (byLevel[i.level] || 0) + 1;
  const byImpact = {};
  for (const i of items) byImpact[i.impact] = (byImpact[i.impact] || 0) + 1;
  console.log(
    `💾 已写入 ${OUT}：共 ${items.length} 条 / 新增 ${payload.newCount} 条 / 需立即处理 ${payload.urgentCount} 条`,
    Object.entries(byLevel).map(([k, v]) => `${LEVELS[k].name} ${v}`).join(" / ")
  );
  console.log(
    `   影响分级：`,
    Object.entries(byImpact).map(([k, v]) => `${k} ${v}`).join(" / ")
  );
}

/* 入口守卫：只在被直接执行时跑 main()。
 * 否则测试文件 import 本模块的纯函数时，会连带真的联网抓取并改写 data/*.json——
 * 单元测试因此变慢几十秒，还会让工作区凭空多出改动。 */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch((e) => {
  console.error("抓取失败：", e);
  try {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(fallback([String((e && e.message) || e)]), null, 2), "utf8");
    process.exit(0);
  } catch {
    process.exit(1);
  }
});
