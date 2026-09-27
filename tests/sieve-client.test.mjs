#!/usr/bin/env node
/**
 * sieve 客户端测试 —— 仅在 HTTP 边界注入假 fetch / 假 sleep，
 * 被测逻辑全部是 scripts/lib/sieve-client.mjs 的真实代码。
 *
 * 运行：node --test "tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SieveClient,
  SieveError,
  nextDelay,
  turnCount,
  upsertEnvFile,
  loadDotEnv,
} from "../scripts/lib/sieve-client.mjs";
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 构造一个假 Response（HTTP 边界；headers 与真实 Headers 一样大小写不敏感）。
 *  body 只能读一次——与真实 fetch 的单读流一致，否则重读 bug 测不出来。 */
function jsonRes(status, body, headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = String(v);
  const bytes = new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body));
  let consumed = false;
  const take = () => {
    if (consumed) throw new Error("Body is unusable: Body has already been read");
    consumed = true;
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (lower[String(k).toLowerCase()] == null ? null : lower[String(k).toLowerCase()]) },
    text: async () => { take(); return new TextDecoder().decode(bytes); },
    arrayBuffer: async () => { take(); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

/** 录制型 fetch：按脚本回放响应并记录所有请求（method/url/headers/body） */
function scriptedFetch(script) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (typeof step === "function") return step(calls.length - 1, { url, init });
    return step;
  };
  impl.calls = calls;
  return impl;
}

const NO_SLEEP = async () => {};
const NO_KEY = { apiKey: "test_key_dc_sk", baseUrl: "https://scrape.test", sleep: NO_SLEEP };

/* ===================== 请求构建 ===================== */

test("startScrape builds POST with Bearer auth and JSON body", async () => {
  const f = scriptedFetch([jsonRes(202, { status: "queued", session_id: "abc123", poll: "/api/scrapes/abc123" })]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  const out = await c.startScrape({ instruction: "x" });
  const call = f.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://scrape.test/api/scrapes");
  assert.equal(call.headers.Authorization, "Bearer test_key_dc_sk");
  assert.equal(call.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(call.body), { instruction: "x" });
  assert.equal(out.sessionId, "abc123");
});

test("client without key reports unconfigured and refuses to call", async () => {
  const f = scriptedFetch([]);
  const c = new SieveClient({ apiKey: "", fetchImpl: f });
  assert.equal(c.configured, false);
  await assert.rejects(() => c.startScrape({ instruction: "x" }), (e) => e.kind === "unauthorized");
  assert.equal(f.calls.length, 0); // 未配置时完全不发请求
});

/* ===================== 202 受理 + 持久化 ===================== */

test("startScrape persists session_id before returning", async () => {
  const persisted = [];
  const f = scriptedFetch([jsonRes(202, { status: "queued", session_id: "sess_persist" })]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  await c.startScrape({ instruction: "x" }, { persist: async (sid) => persisted.push(sid) });
  assert.deepEqual(persisted, ["sess_persist"]);
});

/* ===================== never retry POST on timeout / network error ===================== */

test("startScrape NEVER retries after a network error (run may have been created)", async () => {
  const f = scriptedFetch([
    async () => { throw new Error("simulated timeout"); },
    jsonRes(202, { status: "queued", session_id: "should_not_happen" }),
  ]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  await assert.rejects(() => c.startScrape({ instruction: "x" }), (e) => e.kind === "network");
  assert.equal(f.calls.length, 1, "必须只调用一次 POST，绝不自动重试");
});

/* ===================== 429/5xx 是安全重试（运行未创建） ===================== */

test("startScrape retries on 429 honoring Retry-After, succeeds on 2nd call", async () => {
  const sleeps = [];
  const f = scriptedFetch([
    jsonRes(429, { error: "too many" }, { "Retry-After": "7" }),
    jsonRes(202, { status: "queued", session_id: "after429" }),
  ]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f, sleep: async (ms) => sleeps.push(ms) });
  const out = await c.startScrape({ instruction: "x" });
  assert.equal(out.sessionId, "after429");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(sleeps, [7000]); // 用 Retry-After
});

test("startScrape retries on 5xx with backoff", async () => {
  const f = scriptedFetch([
    jsonRes(503, { error: "overloaded" }),
    jsonRes(503, { error: "overloaded" }),
    jsonRes(202, { status: "queued", session_id: "after5xx" }),
  ]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  const out = await c.startScrape({ instruction: "x" });
  assert.equal(out.sessionId, "after5xx");
  assert.equal(f.calls.length, 3);
});

/* ===================== 400/401/402/404 错误映射（不重试） ===================== */

test("error mapping: 400 bad_request, no retry", async () => {
  const f = scriptedFetch([jsonRes(400, { error: "instruction required" })]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  await assert.rejects(() => c.startScrape({}), (e) => {
    assert.equal(e.kind, "bad_request");
    assert.equal(e.status, 400);
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test("error mapping: 401 unauthorized, 402 payment, 404 not_found", async () => {
  for (const [status, kind] of [[401, "unauthorized"], [402, "payment"], [404, "not_found"]]) {
    const f = scriptedFetch([jsonRes(status, { error: "x" })]);
    const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
    await assert.rejects(() => c.startScrape({ instruction: "x" }), (e) => e.kind === kind);
  }
});

/* ===================== 轮询状态机 ===================== */

test("pollScrape: running → done, with backoff 5s→8s→~12.8s→cap 30s", async () => {
  const sleeps = [];
  const f = scriptedFetch([
    jsonRes(200, { status: "running" }),
    jsonRes(200, { status: "running" }),
    jsonRes(200, { status: "running" }),
    jsonRes(200, { status: "done", summary: "ok", files: [{ name: "a.csv", size: 10, ext: "csv", url: "/api/files/x" }], result: { rows: [] } }),
  ]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f, sleep: async (ms) => sleeps.push(ms) });
  const snap = await c.pollScrape("s1", { initialDelayMs: 5000, maxDelayMs: 30000 });
  assert.equal(snap.status, "done");
  assert.equal(f.calls.filter((k) => k.method === "GET").length, 4);
  assert.deepEqual(sleeps, [5000, 8000, 12800]); // 1.6 倍退避
});

test("pollScrape: refused is terminal with refusal.code", async () => {
  const f = scriptedFetch([jsonRes(200, { status: "refused", refusal: { code: "quota_exceeded", quota: { remaining: 0 } } })]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  await assert.rejects(() => c.pollScrape("s2"), (e) => {
    assert.equal(e.kind, "refused");
    assert.equal(e.refusal.code, "quota_exceeded");
    return true;
  });
});

test("pollScrape: unknown status value is an error", async () => {
  const f = scriptedFetch([jsonRes(200, { status: "what_is_this" })]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  await assert.rejects(() => c.pollScrape("s3"), (e) => e.kind === "unknown_status");
});

test("pollScrape: GET 5xx retries with backoff then succeeds", async () => {
  const f = scriptedFetch([
    jsonRes(500, { error: "boom" }),
    jsonRes(200, { status: "done" }),
  ]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  const snap = await c.pollScrape("s4");
  assert.equal(snap.status, "done");
  assert.equal(f.calls.length, 2);
});

/* ===================== 追问轮次检查（防止读到上一轮答案） ===================== */

test("pollForTurn waits until done AND turns advanced", async () => {
  const f = scriptedFetch([
    jsonRes(200, { status: "running", turns: [{}] }),
    jsonRes(200, { status: "done", turns: [{}] }),         // done 但 turns 未前进 → 继续等
    jsonRes(200, { status: "done", turns: [{}, {}] }),     // done 且 turns 前进 → 返回
  ]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  const snap = await c.pollForTurn("s5", 1);
  assert.equal(snap.status, "done");
  assert.equal(turnCount(snap), 2);
  assert.equal(f.calls.length, 3);
});

test("sendMessage handles 409 turn-in-flight by waiting and resending", async () => {
  const f = scriptedFetch([
    jsonRes(409, { error: "turn in flight" }),
    jsonRes(200, { ok: true }),
  ]);
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  const out = await c.sendMessage("s6", { instruction: "follow up" });
  assert.deepEqual(out, { ok: true });
  assert.equal(f.calls.filter((k) => k.method === "POST").length, 2);
});

/* ===================== 文件 URL / 下载 ===================== */

test("fileUrl prefixes base URL and download sends Bearer", async () => {
  let sawAuth = null;
  const f = async (url, init = {}) => {
    sawAuth = init.headers.Authorization;
    return jsonRes(200, { ok: true });
  };
  const c = new SieveClient({ ...NO_KEY, fetchImpl: f });
  const url = c.fileUrl({ url: "/api/files/abc", name: "quotes.csv" });
  assert.equal(url, "https://scrape.test/api/files/abc");
  await c.downloadFile({ url: "/api/files/abc", name: "quotes.csv" });
  assert.equal(sawAuth, "Bearer test_key_dc_sk");
});

test("downloadFile returns bytes and text from a single body read", async () => {
  const c = new SieveClient({ ...NO_KEY, fetchImpl: async () => jsonRes(200, "a,b\n1,2\n") });
  const out = await c.downloadFile({ url: "/api/files/abc", name: "quotes.csv" });
  assert.equal(out.name, "quotes.csv");
  assert.equal(out.text, "a,b\n1,2\n");
  assert.equal(new TextDecoder().decode(out.bytes), "a,b\n1,2\n");
  assert.equal(out.bytes.byteLength, 8);
});

test("fileUrl passes through absolute URLs unchanged", () => {
  const c = new SieveClient(NO_KEY);
  assert.equal(c.fileUrl("https://cdn.scrape.test/f/1.csv"), "https://cdn.scrape.test/f/1.csv");
});

/* ===================== .env 密钥库 ===================== */

test("upsertEnvFile creates/updates SIEVE_API_KEY line", () => {
  const dir = mkdtempSync(join(tmpdir(), "sieve-env-"));
  const p = join(dir, ".env");
  upsertEnvFile(p, { SIEVE_API_KEY: "dc_sk_a" });
  assert.match(readFileSync(p, "utf8"), /^SIEVE_API_KEY=dc_sk_a$/m);
  upsertEnvFile(p, { SIEVE_API_KEY: "dc_sk_b", SIEVE_KEY_NAME: "dev" });
  const text = readFileSync(p, "utf8");
  assert.match(text, /^SIEVE_API_KEY=dc_sk_b$/m);
  assert.match(text, /^SIEVE_KEY_NAME=dev$/m);
  assert.equal(text.match(/SIEVE_API_KEY=/g).length, 1, "不产生重复行");
  rmSync(dir, { recursive: true, force: true });
});

test("loadDotEnv fills missing env vars without overriding existing ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "sieve-env2-"));
  const p = join(dir, ".env");
  writeFileSync(p, "SIEVE_API_KEY=from_file\nOTHER_X=1\n", "utf8");
  process.env.OTHER_X = "from_env";
  loadDotEnv(p);
  assert.equal(process.env.SIEVE_API_KEY, "from_file");
  assert.equal(process.env.OTHER_X, "from_env", "已有环境变量优先");
  rmSync(dir, { recursive: true, force: true });
});

/* ===================== 退避工具 ===================== */

test("nextDelay grows to cap", () => {
  assert.equal(nextDelay(null, { initial: 5000 }), 5000); // 首次：返回 initial
  assert.equal(nextDelay(5000, { initial: 5000, cap: 30000 }), 8000);
  assert.equal(nextDelay(30000, { initial: 5000, cap: 30000 }), 30000);
});
