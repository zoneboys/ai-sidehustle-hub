#!/usr/bin/env node
/**
 * sieve 每日侦察任务（可选功能；未配置 SIEVE_API_KEY 时自动跳过，不影响其他功能）
 *
 * 用 sieve 对每个副业点子做一次深度侦察，补充 fetch-jobs.mjs 拿不到的内容：
 *   - 该副业最近真实发生的平台规则/收益变化（带来源链接，供读者核验）；
 *   - 本周适合新人上手的公开机会（征稿/需求/榜单），带原文链接；
 *   - 两条可直接照做的本周行动建议。
 *
 * 运行：node scripts/sieve-daily-scout.mjs [--once | --resume <session_id> | --print <session_id>]
 * 输出：data/daily-scout.json
 *
 * 安全要点：
 *   - SIEVE_API_KEY 只从环境变量（或 .env）读取，绝不打印、绝不入库（json 里不落 key）；
 *   - POST /api/scrapes 受理即计费且无幂等键：超时/网络错误后绝不自动重试；
 *     session_id 先写入 data/sieve-sessions.json，再开始轮询，崩溃后 --resume 接着轮询；
 *   - sieve 挂了 / 未配置 / 拒绝：任务静默退出（退出码 0），不阻塞 CI 与其他功能。
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SieveClient, SieveError, loadDotEnv } from "./lib/sieve-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "daily-scout.json");
const SESSIONS = join(__dirname, "..", "data", "sieve-sessions.json");

loadDotEnv(join(__dirname, "..", ".env"));

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const FLAG_ONCE = args.includes("--once");
const RESUME_ID = argVal("--resume");
const PRINT_ID = argVal("--print");

/** 今日要侦察的副业（精选，与 index.html 副业库呼应） */
const TOPICS = [
  "AI 脚本短视频（LLM 写脚本 + AI 生成画面/配音）",
  "AI 头像/海报定制（闲鱼/小红书接单）",
  "AI 儿童绘本（Amazon KDP 出海）",
  "新媒体 AI 代写（公众号/小红书文案代运营）",
  "AI 配音/声音克隆服务",
  "AI 套壳小工具站（订阅制出海）",
];

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function saveSessions(rec) {
  mkdirSync(dirname(SESSIONS), { recursive: true });
  writeFileSync(SESSIONS, JSON.stringify(rec, null, 2), "utf8");
}

/** 先持久化 session 再轮询：崩溃可恢复，绝不重复开跑 */
function persistSession(sessionId, stage) {
  saveSessions({ sessionId, stage, updatedAt: new Date().toISOString() });
}

function buildInstruction(dateKey) {
  return [
    `你在为中文读者维护一个「AI 副业信息库」。今天是 ${dateKey}。`,
    `请针对下面这些 AI 副业方向，各做一次简要的近期情报侦察：`,
    ...TOPICS.map((t, i) => `${i + 1}. ${t}`),
    ``,
    `对每个方向输出：`,
    `- status：一句话概括该方向当前（本月）是否仍然值得新人尝试；`,
    `- changes：最近 1-2 个月内平台规则、收益分成或获客渠道的真实变化（若无就写"无明显变化"）；`,
    `- opportunities：本周内新人可以立刻查看/申请的公开机会（征稿、需求榜、悬赏、招募页等），`,
    `  每条给出标题、日期、来源站点名和原文 URL（必须是真实存在的公开网页，禁止编造链接）；`,
    `- actions：本周可执行的两条具体行动（每条不超过 40 字，能落地、可验证）。`,
    ``,
    `所有结论必须给出可点击的来源 URL；找不到就明确写"未找到"，不要猜测。`,
  ].join("\n");
}

function buildOutputSchema() {
  const topicEnum = TOPICS.map((t) => t.split("（")[0]);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["date", "topics"],
    properties: {
      date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      topics: {
        type: "array",
        minItems: TOPICS.length,
        maxItems: TOPICS.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["topic", "status", "changes", "opportunities", "actions"],
          properties: {
            topic: { type: "string", enum: topicEnum },
            status: { type: "string" },
            changes: { type: "string" },
            opportunities: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "url", "source", "date"],
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  source: { type: "string" },
                  date: { type: "string" },
                },
              },
            },
            actions: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
          },
        },
      },
    },
  };
}

const SOURCE_WHITELIST = [
  "tencent.com", "bytedance.com", "kuaishou.com", "xiaohongshu.com", "kdp.amazon.com",
  "amazon.com", "weixin.qq.com", "alipay.com", "bilibili.com", "zcool.com.cn",
  "github.com", "douban.com", "zhihu.com", "douyin.com",
];

function isPublicHttpUrl(u) {
  return /^https?:\/\//i.test(typeof u === "string" ? u : "");
}

function normalize(snapshot, dateKey) {
  const result = snapshot && snapshot.result;
  const sc = (snapshot && snapshot.schema_conformance) || {};
  const base = {
    generatedAt: new Date().toISOString(),
    date: dateKey,
    sessionId: snapshot && snapshot.session_id,
    turns: Array.isArray(snapshot && snapshot.turns) ? snapshot.turns.length : 0,
    conformance: sc.status || "not_checkable",
    topics: [],
    errors: [],
    note: "由 scripts/sieve-daily-scout.mjs 通过 sieve scrape API 生成（可选增强数据源；未配置 SIEVE_API_KEY 时本文件不会更新）。所有机会均附原文链接，点击可核验。",
  };
  if (!result || typeof result !== "object") {
    base.errors.push("运行完成但未返回结构化 result");
    return base;
  }
  const rawTopics = Array.isArray(result.topics) ? result.topics : [];
  for (const t of rawTopics) {
    const title = String((t && t.topic) || "").trim();
    if (!title) continue;
    base.topics.push({
      topic: title,
      status: String((t && t.status) || "").slice(0, 400),
      changes: String((t && t.changes) || "").slice(0, 800),
      opportunities: (Array.isArray(t && t.opportunities) ? t.opportunities : [])
        .map((o) => ({
          title: String((o && o.title) || "").slice(0, 200),
          url: String((o && o.url) || "").slice(0, 500),
          source: String((o && o.source) || "").slice(0, 80),
          date: String((o && o.date) || "").slice(0, 40),
        }))
        .filter((o) => o.title && isPublicHttpUrl(o.url))
        .slice(0, 8),
      actions: (Array.isArray(t && t.actions) ? t.actions : []).map((a) => String(a).slice(0, 120)).slice(0, 4),
    });
  }
  if (sc.status === "fail") base.errors.push("schema 校验未通过（该轮输出不作为干净数据展示，仅显示摘要）");
  if (sc.status === "partial") base.errors.push("schema 校验部分通过（存在未获取到的声明字段）");
  return base;
}

const FILES_DIR = join(__dirname, "..", "data", "daily-scout-files");

// 下载交付文件到 data/daily-scout-files/，并把文件清单写进 payload.files
// 单个文件失败只记入 errors，不影响其余文件与整次运行
async function downloadFiles(client, files, payload) {
  payload.files = payload.files || [];
  for (const f of files || []) {
    try {
      const dl = await client.downloadFile(f);
      payload.files.push({ name: dl.name, size: dl.bytes.byteLength, ext: f.ext || (f.name || "").split(".").pop() || "" });
      mkdirSync(FILES_DIR, { recursive: true });
      writeFileSync(join(FILES_DIR, dl.name.replace(/[^\w.\-]+/g, "_")), Buffer.from(dl.bytes));
      console.log(`📄 已下载 ${dl.name}（${dl.bytes.byteLength} 字节）——写入 data/daily-scout-files/`);
    } catch (e) {
      payload.errors.push(`下载 ${f.name || f.url} 失败: ${e.message}`);
    }
  }
  return payload;
}

async function main() {
  const dateKey = todayKey();

  // --print <id>：只下载并展示某次运行结果，不新开运行
  if (PRINT_ID) {
    const client = new SieveClient({ log: (m) => console.log(m) });
    const snap = await client.getScrape(PRINT_ID);
    const out = normalize(snap, dateKey);
    await downloadFiles(client, snap.files, out);
    writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
    console.log(`💾 已写入 ${OUT}`);
    return;
  }

  // 已有今日数据：除非 --once（强制重跑），否则跳过，避免每天烧额度
  const existing = readJson(OUT, null);
  if (!FLAG_ONCE && !RESUME_ID && existing && existing.date === dateKey && (existing.topics || []).length) {
    console.log(`⏭️ 今日（${dateKey}）侦察数据已存在，跳过（--once 可强制重跑）`);
    return;
  }

  const client = new SieveClient({
    log: (m) => console.log(m),
  });

  if (!client.configured) {
    console.log("⏭️ 未配置 SIEVE_API_KEY，跳过 sieve 侦察任务（功能保持可选，不影响其他数据源）。");
    console.log("   如需启用：在 .env 或环境变量里设置 SIEVE_API_KEY（见 .env.example）。");
    return; // 退出码 0：CI 不因 sieve 未配置而失败
  }

  // --resume：接着既有 session 轮询，不重复开跑
  if (RESUME_ID) {
    console.log(`🔁 恢复轮询已有 session：${RESUME_ID}`);
    const snap = await client.pollScrape(RESUME_ID, {
      onPoll: (_s, d) => process.stdout.write(`\r⏳ 运行中…（${Math.round(d / 1000)}s 间隔）   `),
    });
    process.stdout.write("\n");
    writeFileSync(OUT, JSON.stringify(normalize(snap, dateKey), null, 2), "utf8");
    console.log(`💾 已写入 ${OUT}（conformance=${snap.schema_conformance ? snap.schema_conformance.status : "?"}）`);
    return;
  }

  // 常规路径：检查崩溃恢复
  const prev = readJson(SESSIONS, null);
  if (prev && prev.sessionId && prev.stage === "polling") {
    console.log(`🔁 检测到上次运行中断（session ${prev.sessionId}），恢复轮询而不是重复开跑。`);
    const snap = await client.pollScrape(prev.sessionId, {
      onPoll: (_s, d) => process.stdout.write(`\r⏳ 运行中…（${Math.round(d / 1000)}s 间隔）   `),
    });
    process.stdout.write("\n");
    persistSession(prev.sessionId, "done");
    writeFileSync(OUT, JSON.stringify(normalize(snap, dateKey), null, 2), "utf8");
    console.log(`💾 已写入 ${OUT}`);
    return;
  }

  // 开跑：接受即计费 → 先写 sessions 再等待任何后续动作
  console.log("📡 开始 sieve 每日侦察（1 次运行，约几分钟）…");
  let sessionId;
  try {
    const { sessionId: sid } = await client.startScrape(
      {
        instruction: buildInstruction(dateKey),
        output_schema: buildOutputSchema(),
        compliance_mode: "regular",
      },
      {
        persist: (sid2) => persistSession(sid2, "polling"),
        maxRetries: 3, // 仅 429/5xx 安全重试；网络错误/超时绝不重试
      }
    );
    sessionId = sid;
    console.log(`✅ 已受理：session ${sessionId}（已先持久化到 data/sieve-sessions.json）`);
  } catch (e) {
    if (e instanceof SieveError && e.kind === "network") {
      console.warn(`⚠️ POST /api/scrapes 网络错误/超时：按契约绝不重试（首次调用可能已成功）。今天先跳过，明日自动再试。`);
      return; // 退出码 0
    }
    if (e instanceof SieveError && e.kind === "refused") {
      console.warn(`⚠️ sieve 拒绝了运行（${e.refusal && e.refusal.code}）：未启动、不计费。跳过。`);
      return;
    }
    if (e instanceof SieveError && e.kind === "payment") {
      console.warn("⚠️ sieve 额度用尽：请在 sieve 控制台查看 GET /api/me/credits（plan/limit/used/remaining）。跳过今日侦察。");
      return;
    }
    if (e instanceof SieveError && e.kind === "unauthorized") {
      console.warn("⚠️ SIEVE_API_KEY 无效或已被吊销：请到 sieve 控制台 Settings → API keys 重建并更新 .env。跳过今日侦察。");
      return;
    }
    throw e;
  }

  // 轮询到终态
  let snapshot;
  try {
    snapshot = await client.pollScrape(sessionId, {
      onPoll: (_s, d) => process.stdout.write(`\r⏳ sieve 运行中…（每 ${Math.round(d / 1000)}s 轮询）   `),
    });
    process.stdout.write("\n");
  } catch (e) {
    if (e instanceof SieveError && e.kind === "refused") {
      persistSession(sessionId, "refused");
      console.warn(`⚠️ sieve 拒绝了运行（${e.refusal && e.refusal.code}）：跳过。`);
      return;
    }
    persistSession(sessionId, "poll-error");
    throw e;
  }
  persistSession(sessionId, "done");

  // 下载交付文件（带 Bearer）
  const payload = normalize(snapshot, dateKey);
  await downloadFiles(client, snapshot.files, payload);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`💾 已写入 ${OUT}：${payload.topics.length} 个方向，conformance=${payload.conformance}`);
  if (payload.conformance === "fail") {
    console.warn("⚠️ schema 校验 fail：输出不作为干净数据展示，请检查 summary。");
  }
}

main().catch((e) => {
  console.error("❌ sieve 侦察任务失败：", e && e.message ? e.message : e);
  // sieve 故障绝不阻塞 CI（fetch-jobs.mjs 的同款约定）
  process.exit(0);
});
