#!/usr/bin/env node
/**
 * 同伴互助区抓取（data/peer-qa.json）
 *
 * 解决「学习板块只是打开外链、没有互相学习」的问题。
 *
 * 纯静态站没有后端，凭空造不出「互相学习」。但本站本身就托管在公开
 * GitHub 仓库上，而 GitHub Issues 是**匿名可读**的（实测 200，无需 token），
 * 于是可以零成本、零后端地把 Issues 当成问答通道：
 *
 *   1) 访客在本站点「我卡在这」→ 打开预填好的 GitHub 新建 issue 链接
 *      （用 GitHub 自己的登录，本站不碰账号、不存任何隐私）
 *   2) 别人在 GitHub 上回复这条 issue —— 这就是「互相学习」的真实发生地
 *   3) 本脚本每天把 issue + 评论抓下来，站点渲染成「谁问了什么、谁答了什么」
 *
 * 只有被打了 `question` 标签的 issue 才会进来，避免把 bug 报告混进学习区。
 * 运行：node scripts/fetch-qa.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "peer-qa.json");
const TIMEOUT_MS = 20000;
const KEEP_DAYS = 60;
const PER_PAGE = 50;

export const REPO = "zoneboys/ai-sidehustle-hub";
export const QA_LABEL = "question";
/** 访客点「提问」时跳过去的预填链接。只带 label，不带 title/body —— 带上会被
 *  GitHub 当成「已填内容」而不再显示输入框，用户反而没法改。 */
export const ASK_URL = `https://github.com/${REPO}/issues/new?labels=${QA_LABEL}`;

const beijingDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const errors = [];
const UA = "Mozilla/5.0 (compatible; ai-sidehustle-hub/1.0)";

/* ---------------- 解析 ---------------- */

/** GitHub 会在 issue 正文里塞 HTML 注释（模板残留）。
 * 不去掉的话，占位提示会被当成用户的真实提问抓进正文。 */
export function stripComments(s = "") {
  return String(s || "").replace(/<!--[\s\S]*?-->/g, " ").replace(/[ \t]+/g, " ").trim();
}

/** 剥掉标题里预填的占位提示。留着的后果是列表里每个标题都长一个尾巴，
 * 一眼就看出是模板而不是真问题。 */
export function stripPrompt(s = "") {
  return String(s || "").replace(/[（(][^（()）]{0,24}[)）]\s*$/, "").trim();
}

/** 标题里的赛道标签。访客点「提问」时预填 [k12] 这类前缀，
 * 纯粹为了把互助区分流；解析不出来也不该丢内容。 */
export const TRACK_TAGS = {
  k12: { name: "K12 学习", emoji: "🎒" },
  ai: { name: "AI 学习", emoji: "🤖" },
  code: { name: "编程", emoji: "💻" },
  cn: { name: "中文效率", emoji: "📰" },
  lang: { name: "语言/考证", emoji: "🗣️" },
  hustle: { name: "副业变现", emoji: "💰" },
};

export function parseTags(title = "") {
  // 字符类必须含数字：赛道里最常用的就是 k12，写成 [a-z] 会让它永远匹配不上，
  // 结果 [k12] 前缀原样留在标题里、track 永远是 null。
  const m = String(title || "").match(/^\s*\[([a-z0-9]{2,8})\]\s*/i);
  if (!m) return { track: null, title: String(title || "").trim() };
  const key = m[1].toLowerCase();
  return { track: TRACK_TAGS[key] ? key : null, title: String(title).slice(m[0].length).trim() };
}

function links(s = "") {
  return (String(s).match(/https?:\/\//g) || []).length;
}

/** 纯灌水。不靠长度判：短但有链接的回复（贴了个官方文档）是有用的，
 * 而长篇大论的「学习了」是噪声——判「内容」而不是「字数」。 */
const SPAM_RE = /^\s*(?:\+1|same|顶|支持|同问|有用|学到了?|谢谢(?:大家|大佬)?|thanks?|thank you|ok|okay|good|nice|👌|🙏)+[\s!！.。]*$/i;

export function scoreAnswer(c = {}) {
  const body = String(c.body || "");
  if (!body || SPAM_RE.test(body)) return 0;
  // 无链接、无代码、又短于 8 字：没有可复用的实质信息
  if (body.length < 8 && !links(body) && !/```/.test(body)) return 0;
  let s = Math.min(body.length / 120, 3);                // 太短没信息，太长也不是回答
  if (/```/.test(body)) s += 1.5;                        // 给了可运行的命令/代码
  if (links(body)) s += Math.min(links(body), 2) * 0.5;  // 给了出处
  if (/[。！？.!?]/.test(body) && body.length > 60) s += 0.5;
  return s;
}

/** 只保留够格的评论，按「是否回答了问题 + 质量」排序。
 * 同一个人重复刷同样的话只留一条。 */
export function pickAnswers(comments = [], limit = 3) {
  const seen = new Set();
  const scored = [];
  for (const c of comments || []) {
    if (!c) continue;
    if (c.author === "github-actions[bot]" || c.author === "Copilot") continue;
    const body = stripComments(c.body);
    if (!body) continue;
    const key = body.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    const q = scoreAnswer({ ...c, body });
    if (q <= 0) continue;
    scored.push({ author: c.author, body, at: c.at, url: c.url, score: Math.round(q * 10) / 10 });
  }
  scored.sort((a, b) => b.score - a.score || (a.at < b.at ? -1 : 1));
  return scored.slice(0, limit);
}

/** 单条 issue → 一条互助区条目。issue 被 close 视为「已解决」。 */
export function parseIssue(issue = {}, comments = []) {
  const { track, title } = parseTags(issue.title);
  const answers = pickAnswers(comments);
  return {
    num: issue.num,
    track,
    title: stripPrompt(title),
    detail: stripComments(issue.body),
    asker: issue.author,
    at: issue.at,
    url: issue.url,
    solved: !!issue.closed || answers.length > 0,
    answerCount: Math.max(issue.commentCount || 0, answers.length),
    answers,
  };
}

/** 只保留打了 question 标签的 issue，并剔除 spam：bot 作者、
 * 标题太短、正文空到没法回答的，一律不进互助区。 */
export function buildItems(issues = [], commentsByNum = {}) {
  const out = [];
  let skipped = 0;
  for (const it of issues || []) {
    if (it.pull_request) { skipped++; continue; }        // PR 不是提问
    if (it.author === "github-actions[bot]") { skipped++; continue; }
    if (!it.title || String(it.title).trim().length < 6) { skipped++; continue; }
    const item = parseIssue(it, commentsByNum[it.num] || []);
    if (!item.title) { skipped++; continue; }
    out.push(item);
  }
  return { items: out, skipped };
}

/** 互助区只看最近 N 天：一年前的提问没人再会答，挂在那里只是噪音。 */
export function withinDays(items, now, days = KEEP_DAYS) {
  const cut = now - days * 86400000;
  return (items || []).filter((i) => {
    const t = Date.parse(i.at || "");
    // 解析不出来的丢掉而不是当最新：把老问题当新的展示比不展示更糟
    return Number.isFinite(t) && t >= cut;
  });
}

/* ---------------- 拉取 ---------------- */

function toIssue(i) {
  return {
    num: i.number,
    title: i.title,
    body: i.body || "",
    author: (i.user && i.user.login) || "匿名",
    at: i.created_at,
    url: i.html_url,
    commentCount: i.comments || 0,
    closed: i.state === "closed",
  };
}

async function fetchJson(url, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const retriable = /HTTP (429|403|502|503|504)/.test(msg) || !/HTTP 4/.test(msg);
      if (!retriable || i === retries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    } finally {
      clearTimeout(tm);
    }
  }
}

async function loadComments(num) {
  const url = `https://api.github.com/repos/${REPO}/issues/${num}/comments?per_page=50`;
  const arr = await fetchJson(url);
  return (arr || []).map((c) => ({
    author: (c.user && c.user.login) || "匿名",
    body: c.body || "",
    at: c.created_at,
    url: c.html_url,
  }));
}

async function main() {
  const now = Date.now();
  // 匿名 API 只有 60 次/小时。先只对「有人回答的」issue 拉评论——
  // 评论数 0 的拉了也是空请求，白白烧掉配额。
  const url = `https://api.github.com/repos/${REPO}/issues?state=all&labels=${QA_LABEL}&per_page=${PER_PAGE}&sort=updated&direction=desc`;
  const raw = await fetchJson(url);
  const issues = (raw || []).map(toIssue);
  const commentsByNum = {};
  for (const it of issues) {
    if (!it.commentCount) continue;
    try {
      commentsByNum[it.num] = await loadComments(it.num);
    } catch (e) {
      errors.push(`#${it.num} 评论抓取失败：${e && e.message}`);
    }
  }
  const { items, skipped } = buildItems(issues, commentsByNum);
  items.sort((a, b) => {
    // 未解决的排前面：互助区首先是一块「等人来答」的地方，
    // 已解决的沉到后面当参考，不该占住首屏。
    if (a.solved !== b.solved) return a.solved ? 1 : -1;
    return (b.at || "") < (a.at || "") ? -1 : 1;
  });
  const kept = withinDays(items, now);
  const unanswered = kept.filter((i) => !i.solved).length;
  const payload = {
    generatedAt: new Date(now).toISOString(),
    date: beijingDate(new Date(now)),
    repo: REPO,
    askUrl: ASK_URL,
    counts: { total: kept.length, unanswered, answered: kept.length - unanswered, skipped },
    items: kept,
    errors,
    note: `问题通过 GitHub Issues 提交（无需注册本站），每天自动拉取一次；最新更新于 ${beijingDate(new Date(now))}`,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`✅ 同伴互助：${kept.length} 条（待答 ${unanswered}）→ data/peer-qa.json${errors.length ? `（${errors.length} 个源失败）` : ""}`);
  if (skipped) console.log(`   过滤掉 ${skipped} 条非提问/灌水内容`);
}

/** 抓取失败也要写出一份结构完整的产物：页面读的是固定字段，
 * 缺文件会让整个互助区渲染成报错而不是「暂时取不到」。 */
function fallback(errs) {
  const now = Date.now();
  return {
    generatedAt: new Date(now).toISOString(),
    date: beijingDate(new Date(now)),
    repo: REPO,
    askUrl: ASK_URL,
    counts: { total: 0, unanswered: 0, answered: 0, skipped: 0 },
    items: [],
    errors: errs,
    note: "暂时取不到问答数据；提问入口仍然可用。",
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
// 成功时不调 process.exit：fetch 的 keep-alive 句柄还没关，强制退出会触发
// Windows 上的 libuv 断言（exit 127），而且和其余脚本的写法不一致。
if (isMain) main().catch((e) => {
  console.error("抓取失败：", e);
  try {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(fallback([String((e && e.message) || e)]), null, 2), "utf8");
  } catch { process.exit(1); }
});
