#!/usr/bin/env node
/**
 * sieve scrape API 客户端（零依赖，Node 18+ 原生 fetch）
 *
 * 设计约束（与本项目现有模式一致）：
 *  - 不引入任何新依赖 / 第二个 HTTP 客户端：只用全局 fetch；
 *  - fetch 与 sleep 均可注入，测试时仅在 HTTP 边界替换，被测逻辑全部是真实代码；
 *  - SIEVE_API_KEY 只从环境变量读取，永不打印 / 永不写入 git；
 *  - sieve 未配置（无 key）时所有入口都能安全跳过，不影响其他功能。
 *
 * 契约要点（https://scrape.usesieve.com）：
 *  - 所有请求带 Authorization: Bearer <key>；
 *  - POST /api/scrapes 无幂等键、受理即计费 → 超时/网络错误绝不自动重试；
 *    429 / 5xx 重试是安全的（运行未被创建）；
 *  - 202 返回 session_id → 先持久化再轮询 GET /api/scrapes/<id>（5s 起步退避到 ~30s）；
 *  - 轮询 status："running" 继续轮；"done" 终态；"refused" 终态（从未启动）；
 *    其余任何值一律视为错误；
 *  - 追问：先记录 turns，再轮询到 status==="done" 且 turns 前进，否则读到的是上一轮答案；
 *    409 = 上一轮进行中，等待后重发。
 */

import { readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_BASE_URL = "https://scrape.usesieve.com";

/** 统一错误：kind 用于调用方分流（bad_request / unauthorized / payment / not_found / * rate_limited / server / network / refused / unknown_status / protocol） */
export class SieveError extends Error {
  constructor(kind, message, { status = null, retryAfter = null, refusal = null, body = null } = {}) {
    super(message);
    this.name = "SieveError";
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.refusal = refusal;
    this.body = body;
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function sleepDefault(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 简单递增退避：initial → cap（毫秒） */
export function nextDelay(delay, { initial = 5000, cap = 30000, factor = 1.6 } = {}) {
  const d = delay == null ? initial : delay * factor;
  return Math.min(cap, Math.round(d));
}

export function turnCount(snapshot) {
  const t = snapshot && snapshot.turns;
  if (Array.isArray(t)) return t.length;
  if (typeof t === "number") return t;
  return 0;
}

export class SieveClient {
  constructor({
    apiKey = process.env.SIEVE_API_KEY || "",
    baseUrl = process.env.SIEVE_BASE_URL || DEFAULT_BASE_URL,
    fetchImpl = globalThis.fetch,
    sleep = sleepDefault,
    log = () => {},
    maxRetries = 3,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.log = log;
    this.maxRetries = maxRetries;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...extra,
    };
  }

  /** 底层请求：网络错误统一映射为 SieveError("network") */
  async _raw(url, init) {
    let res;
    try {
      res = await this.fetchImpl(url, init);
    } catch (e) {
      throw new SieveError("network", `sieve 网络请求失败: ${e && e.message ? e.message : e}`);
    }
    const text = await res.text();
    return { res, text, data: safeJson(text) };
  }

  /** 同 _raw，但按二进制读取：真实 fetch 的 body 只能读一次，
   *  所以 text 由 bytes 解码而来，不能先 text() 再 arrayBuffer()。 */
  async _rawBinary(url, init) {
    let res;
    try {
      res = await this.fetchImpl(url, init);
    } catch (e) {
      throw new SieveError("network", `sieve 网络请求失败: ${e && e.message ? e.message : e}`);
    }
    let bytes;
    try {
      bytes = await res.arrayBuffer();
    } catch (e) {
      throw new SieveError("network", `sieve 响应读取失败: ${e && e.message ? e.message : e}`);
    }
    const text = new TextDecoder().decode(bytes);
    return { res, bytes, text, data: safeJson(text) };
  }

  _mapHttp(res, data) {
    const status = res.status;
    const retryAfter = Number(res.headers && res.headers.get ? res.headers.get("retry-after") : "") || null;
    const msg = (data && (data.error || data.message)) || `HTTP ${status}`;
    if (status === 400) return new SieveError("bad_request", `sieve 请求有误（不要重试，请修正请求）: ${msg}`, { status, body: data });
    if (status === 401) return new SieveError("unauthorized", "SIEVE_API_KEY 缺失或已吊销（请到 sieve 设置里检查/重建 key）", { status, body: data });
    if (status === 402) return new SieveError("payment", "sieve 额度已用尽（GET /api/me/credits 可查看 plan/limit/used/remaining）", { status, body: data });
    if (status === 404) return new SieveError("not_found", `sieve 资源不存在或不属于当前账号: ${msg}`, { status, body: data });
    if (status === 429) return new SieveError("rate_limited", `sieve 限流: ${msg}`, { status, retryAfter, body: data });
    if (status >= 500) return new SieveError("server", `sieve 服务端错误: ${msg}`, { status, retryAfter, body: data });
    return new SieveError("protocol", `sieve 返回了意外状态: HTTP ${status}`, { status, body: data });
  }

  /**
   * 启动一次抓取。POST /api/scrapes 没有幂等键，受理即计费：
   *  - 超时 / 网络错误 → 绝不自动重试（第一次调用可能已经成功）；
   *  - 429 / 5xx → 自动重试是安全的（运行未被创建），带退避，最多 maxRetries 次；
   *  - 202 → 如提供 persist 回调，立即持久化 session_id（先于任何后续动作），再返回。
   */
  async startScrape(body, { persist, maxRetries } = {}) {
    if (!this.configured) throw new SieveError("unauthorized", "未配置 SIEVE_API_KEY，跳过 sieve 调用");
    const url = `${this.baseUrl}/api/scrapes`;
    const retries = maxRetries == null ? this.maxRetries : maxRetries;
    let delayMs = 2000;
    for (let attempt = 0; ; attempt++) {
      const { res, data } = await this._raw(url, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 202) {
        const sessionId = data && data.session_id;
        if (!sessionId) throw new SieveError("protocol", "sieve 返回 202 但缺少 session_id", { status: 202, body: data });
        if (persist) await persist(sessionId, data); // 崩溃后可恢复轮询，避免重复开跑
        return { sessionId, poll: data.poll || null, raw: data };
      }
      const err = this._mapHttp(res, data);
      const retryable = err.kind === "rate_limited" || err.kind === "server";
      if (retryable && attempt < retries) {
        const wait = err.retryAfter ? err.retryAfter * 1000 : delayMs;
        this.log(`  sieve POST ${res.status}，${Math.round(wait / 1000)}s 后重试（安全：运行未创建）`);
        await this.sleep(wait);
        delayMs = nextDelay(delayMs, { initial: 2000, cap: 8000 });
        continue;
      }
      throw err; // 400/401/402/404/网络错误等：不重试
    }
  }

  /** GET /api/scrapes/<id>：5xx / 网络错误 / 429 按指数退避重试；401/402/404 立即抛出 */
  async getScrape(sessionId, { maxRetries } = {}) {
    const url = `${this.baseUrl}/api/scrapes/${encodeURIComponent(sessionId)}`;
    const retries = maxRetries == null ? this.maxRetries : maxRetries;
    let delayMs = 1000;
    for (let attempt = 0; ; attempt++) {
      let out;
      try {
        out = await this._raw(url, { method: "GET", headers: this.headers(), signal: AbortSignal.timeout(60000) });
      } catch (e) {
        if (attempt < retries) {
          await this.sleep(delayMs);
          delayMs = nextDelay(delayMs, { initial: 1000, cap: 15000 });
          continue;
        }
        throw e;
      }
      const { res, data } = out;
      if (res.status === 200) return data;
      const err = this._mapHttp(res, data);
      const retryable = err.kind === "rate_limited" || err.kind === "server" || err.kind === "protocol";
      if (retryable && attempt < retries) {
        const wait = err.retryAfter ? err.retryAfter * 1000 : delayMs;
        await this.sleep(wait);
        delayMs = nextDelay(delayMs, { initial: 1000, cap: 15000 });
        continue;
      }
      throw err;
    }
  }

  /**
   * 轮询一次抓取直到终态。5s 起步，指数退避到 ~30s 封顶（运行可能持续数分钟，禁止短超时）。
   * - "running" → 继续轮询（schema 修复轮次也会短暂处于 running）；
   * - "done"    → 返回完整快照（summary / files[] / schema_conformance / result）；
   * - "refused" → 终态、运行从未启动：抛 SieveError("refused")，refusal.code 说明原因；
   * - 其他任何值 → 视为错误（unknown_status）。
   */
  async pollScrape(sessionId, {
    initialDelayMs = 5000,
    maxDelayMs = 30000,
    factor = 1.6,
    maxAttempts = Infinity,
    onPoll = null,
  } = {}) {
    let delay = initialDelayMs;
    for (let i = 0; i < maxAttempts; i++) {
      const snap = await this.getScrape(sessionId);
      const status = snap && snap.status;
      if (status === "done") return snap;
      if (status === "refused") {
        const code = (snap.refusal && snap.refusal.code) || "unknown";
        throw new SieveError("refused", `sieve 拒绝了本次运行（未启动、不计费）: ${code}`, { refusal: snap.refusal || { code }, body: snap });
      }
      if (status === "running") {
        if (onPoll) onPoll(snap, delay);
        await this.sleep(delay);
        delay = nextDelay(delay, { initial: initialDelayMs, cap: maxDelayMs, factor });
        continue;
      }
      throw new SieveError("unknown_status", `sieve 返回了未知状态: ${JSON.stringify(status ?? snap)}`, { body: snap });
    }
    throw new SieveError("protocol", "sieve 轮询超出最大次数仍未到达终态");
  }

  /**
   * 追问一轮：POST /api/scrapes/<id>/messages。
   *  - 409（上一轮进行中）→ 等待后重发（最多 maxConflicts 次）；
   *  - 网络错误 / 超时 / 5xx → 与 POST /api/scrapes 同理不自动重试（可能已受理计费）；
   *  - 成功后由调用方用 pollForTurn 轮询到 done 且 turns 前进。
   */
  async sendMessage(sessionId, body, { maxConflicts = 6, conflictWaitMs = 5000 } = {}) {
    if (!this.configured) throw new SieveError("unauthorized", "未配置 SIEVE_API_KEY，跳过 sieve 调用");
    const url = `${this.baseUrl}/api/scrapes/${encodeURIComponent(sessionId)}/messages`;
    for (let i = 0; ; i++) {
      const { res, data } = await this._raw(url, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 409) {
        if (i >= maxConflicts) throw new SieveError("protocol", "sieve 上一轮追问长时间未结束（409 重试次数用尽）", { status: 409, body: data });
        const ra = Number(res.headers && res.headers.get ? res.headers.get("retry-after") : "") || null;
        await this.sleep(ra ? ra * 1000 : conflictWaitMs);
        continue;
      }
      if (res.status >= 200 && res.status < 300) return data;
      const err = this._mapHttp(res, data);
      if (err.kind === "rate_limited") {
        await this.sleep(err.retryAfter ? err.retryAfter * 1000 : 2000);
        continue; // 429 未受理，等待后重发安全
      }
      throw err; // 400/401/402/404/5xx/网络：不自动重试
    }
  }

  /**
   * 轮询追问结果：必须等到 status==="done" 且 turns 相比 prevTurns 前进，
   * 否则读到的仍是上一轮的答案。
   */
  async pollForTurn(sessionId, prevTurns, {
    initialDelayMs = 5000,
    maxDelayMs = 30000,
    maxAttempts = Infinity,
    onPoll = null,
  } = {}) {
    let delay = initialDelayMs;
    for (let i = 0; i < maxAttempts; i++) {
      const snap = await this.getScrape(sessionId);
      const status = snap && snap.status;
      if (status === "refused") {
        const code = (snap.refusal && snap.refusal.code) || "unknown";
        throw new SieveError("refused", `sieve 拒绝了本次追问（未启动）: ${code}`, { refusal: snap.refusal || { code }, body: snap });
      }
      if (status === "done" && turnCount(snap) > prevTurns) return snap;
      if (status === "running" || status === "done") {
        if (onPoll) onPoll(snap, delay);
        await this.sleep(delay);
        delay = nextDelay(delay, { initial: initialDelayMs, cap: maxDelayMs });
        continue;
      }
      throw new SieveError("unknown_status", `sieve 返回了未知状态: ${JSON.stringify(status ?? snap)}`, { body: snap });
    }
    throw new SieveError("protocol", "sieve 追问轮询超出最大次数仍未拿到新答案");
  }

  /** files[] 里的 url 是相对路径：补全 base URL（调用方请求时必须带 Bearer） */
  fileUrl(urlOrFile) {
    const u = typeof urlOrFile === "string" ? urlOrFile : urlOrFile && urlOrFile.url;
    if (!u) throw new SieveError("protocol", "file 缺少 url 字段");
    if (/^https?:\/\//i.test(u)) return u;
    return `${this.baseUrl}/${String(u).replace(/^\/+/, "")}`;
  }

  /** 下载交付文件（带 Bearer；受 key 保护，浏览器/访客无法直接访问） */
  async downloadFile(urlOrFile) {
    const url = this.fileUrl(urlOrFile);
    const { res, data, text, bytes } = await this._rawBinary(url, { method: "GET", headers: this.headers(), signal: AbortSignal.timeout(120000) });
    if (res.status !== 200) throw this._mapHttp(res, data || text);
    const name = (urlOrFile && urlOrFile.name) || decodeURIComponent(url.split("/").pop() || "file");
    return { name, bytes, text };
  }

  /** GET /api/me/credits：{ plan, limit, used, remaining } */
  async getCredits() {
    if (!this.configured) throw new SieveError("unauthorized", "未配置 SIEVE_API_KEY");
    const { res, data } = await this._raw(`${this.baseUrl}/api/me/credits`, { method: "GET", headers: this.headers(), signal: AbortSignal.timeout(30000) });
    if (res.status === 200) return data;
    throw this._mapHttp(res, data);
  }
}

/* =====================================================
   .env 读写（本项目的"密钥库"：gitignore 掉的 .env 文件）
   ===================================================== */

/** 把 KEY=VALUE 合并进 .env 文件（已存在则替换该行，不存在则追加） */
export function upsertEnvFile(envPath, vars) {
  let text = "";
  try { text = readFileSync(envPath, "utf8"); } catch { text = ""; }
  const lines = text.split(/\r?\n/);
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^\\s*${key}\\s*=.*$`);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(envPath, lines.filter((l, i, a) => !(l === "" && i === a.length - 1)).join("\n") + "\n", "utf8");
}

/** 读取 .env（不覆盖已有环境变量），供脚本启动时调用 */
export function loadDotEnv(envPath = ".env") {
  let text = "";
  try { text = readFileSync(envPath, "utf8"); } catch { return {}; }
  const loaded = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    loaded[m[1]] = val;
    if (process.env[m[1]] == null || process.env[m[1]] === "") process.env[m[1]] = val;
  }
  return loaded;
}
