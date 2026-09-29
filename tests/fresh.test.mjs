import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const F2 = require(resolve(ROOT, "data/fresh-core.js"));

const NOW = Date.parse("2026-09-29T12:00:00Z");
const DAY = 86400000;

/* ------------------------------------------------------------------ */
test("hash：稳定、区分、且是 8 位十六进制", () => {
  assert.equal(F2.hash("abc"), F2.hash("abc"), "同输入必须同输出，否则每次打开都判成已更新");
  assert.notEqual(F2.hash("abc"), F2.hash("abd"));
  assert.match(F2.hash(""), /^[0-9a-f]{8}$/);
  assert.match(F2.hash("很长的一段中文内容，重复一次：很长的一段中文内容"), /^[0-9a-f]{8}$/);
});

/* ------------------------------------------------------------------ */
test("decide：线上与本地一致 → keep（不重渲染、不闪烁）", () => {
  const s = JSON.stringify({ a: 1 });
  const d = F2.decide(s, s);
  assert.equal(d.action, "keep");
  assert.equal(d.reason, "已是最新");
});

/* ------------------------------------------------------------------ */
test("decide：线上更新了 → replace，并带上前后指纹", () => {
  const d = F2.decide(JSON.stringify({ a: 1 }), JSON.stringify({ a: 2 }));
  assert.equal(d.action, "replace");
  assert.ok(d.detail.includes(F2.hash(JSON.stringify({ a: 1 }))));
  assert.ok(d.detail.includes(F2.hash(JSON.stringify({ a: 2 }))));
});

/* ------------------------------------------------------------------ */
test("decide：取不到线上 → offline，用本地快照", () => {
  for (const bad of [undefined, null, "", 0, 123, {}]) {
    const d = F2.decide(JSON.stringify({ a: 1 }), bad);
    assert.equal(d.action, "offline", "线上=" + JSON.stringify(bad) + " 时必须降级而不是崩溃");
  }
});

/* ------------------------------------------------------------------
 * 这一条是本文件最重要的不变量。
 * 场景：GitHub 正在提交、CDN 正在刷新、上游脚本写坏了一行。
 * 那时线上字节 ≠ 本地字节，但**不是合法 JSON**。
 * 如果这里选择替换，页面会拿到一个解析失败的对象，
 * 于是整块数据消失——而用户看到的可能只是一个空列表，
 * 没有任何错误提示。这正是本站之前 #NaN / !important 那两次
 * 「静默失效」的同一个形状。
 * ------------------------------------------------------------------ */
test("decide：线上不是合法 JSON → 保留旧快照，绝不替换", () => {
  const local = JSON.stringify({ items: [1, 2, 3] });
  for (const broken of [
    "{",
    "null",
    "[1,2,3]",          // 合法 JSON 但是数组，不是数据对象
    '"字符串"',
    "<html>404</html>",  // CDN 返回了错误页而不是 JSON
    "\u0000",
  ]) {
    const d = F2.decide(local, broken);
    assert.equal(d.action, "offline", "线上=" + JSON.stringify(broken) + " 不该触发替换");
    assert.ok(!d.reason.includes("已更新"), "失败原因不能写成『已更新』");
  }
});

/* ------------------------------------------------------------------
 * HTML 错误页是最阴险的一种：它是合法字符串，parse 会抛，
 * 但如果哪天有人给 decide 加了个"宽松解析"分支，它就会以
 * "成功"的身份把整站数据换成一段 HTML。所以单独锁一条。
 * ------------------------------------------------------------------ */
test("decide：CDN 的 HTML 错误页不会被当成数据", () => {
  const d = F2.decide("{}", "<!DOCTYPE html><html><body>503</body></html>");
  assert.equal(d.action, "offline");
});

/* ------------------------------------------------------------------ */
test("badge：四种状态互斥且可区分", () => {
  const gen = NOW - 2 * 3600000;
  const keep = F2.badge({ action: "keep" }, gen, NOW);
  const rep = F2.badge({ action: "replace" }, gen, NOW);
  const off = F2.badge({ action: "offline", reason: "网络不可用" }, gen, NOW);
  assert.notEqual(keep.text, rep.text);
  assert.notEqual(keep.text, off.text);
  assert.equal(keep.tone, "ok");
  assert.equal(rep.tone, "ok");
  assert.equal(off.tone, "warn", "刚过期 2 小时不该报红");
});

/* ------------------------------------------------------------------
 * 「陈旧」和「离线」必须分开：
 * 前者是**上游**的问题（没人提交新数据），后者是**你**的网络问题。
 * 提示混为一谈，用户会去怪错的对象。
 * ------------------------------------------------------------------ */
test("badge：快照本身陈旧时，离线要升级为红色告警", () => {
  const old = NOW - 9 * DAY;
  const off = F2.badge({ action: "offline" }, old, NOW);
  assert.equal(off.tone, "hot");
  assert.ok(off.text.includes("离线"));
  const keep = F2.badge({ action: "keep" }, old, NOW);
  assert.equal(keep.tone, "hot", "校验通过但数据 9 天没更新，同样是坏状态");
  assert.ok(keep.text.includes("陈旧"));
});

/* ------------------------------------------------------------------ */
test("badge：null 决策 → 未校验，不冒充已更新", () => {
  const b = F2.badge(null, NOW, NOW);
  assert.equal(b.text, "未校验");
  assert.equal(b.tone, "muted");
});

/* ------------------------------------------------------------------ */
test("ago：跨四个量级，且未来时间不崩", () => {
  assert.equal(F2.ago(NOW, NOW), "刚刚");
  assert.equal(F2.ago(NOW - 5 * 60000, NOW), "5 分钟前");
  assert.equal(F2.ago(NOW - 3 * 3600000, NOW), "3 小时前");
  assert.equal(F2.ago(NOW - 2 * DAY, NOW), "2 天前");
  assert.equal(F2.ago(NOW + 100000, NOW), "刚刚", "时钟回拨不能显示负数");
  assert.equal(F2.ago(null, NOW), "未知时间");
  assert.equal(F2.ago(NaN, NOW), "未知时间");
});

/* ------------------------------------------------------------------
 * 兜底值比空值更有害的第二个实例。
 * 取不到时间就返回 0 → 1970 年 → isStale 恒真 → 全站标红。
 * 取不到就必须返回 null，让 badge 说"未知时间"。
 * ------------------------------------------------------------------ */
test("generatedAt：取不到返回 null 而非 0，且不触发恒真告警", () => {
  assert.equal(F2.generatedAt(null), null);
  assert.equal(F2.generatedAt({}), null);
  assert.equal(F2.generatedAt({ foo: 1 }), null);
  assert.equal(F2.generatedAt({ generatedAt: "不是日期" }), null);
  assert.equal(F2.isStale(F2.generatedAt({}), NOW), true, "未知就该当成未知（需要复查）");
  const b = F2.badge({ action: "keep" }, F2.generatedAt({}), NOW);
  assert.ok(b.text.includes("未知") || b.text.includes("陈旧"), "不能显示成刚刚");
});

/* ------------------------------------------------------------------ */
test("generatedAt：秒级与毫秒级时间戳都要认", () => {
  const iso = "2026-09-29T11:00:00Z";
  const ms = Date.parse(iso);
  assert.equal(F2.generatedAt({ generatedAt: iso }), ms);
  assert.equal(F2.generatedAt({ generatedAt: ms }), ms);
  assert.equal(F2.generatedAt({ generatedAt: Math.floor(ms / 1000) }), ms, "秒要被放大成毫秒");
  assert.equal(F2.generatedAt({ updatedAt: iso }), ms, "字段名不统一，要挨个试");
  assert.equal(F2.generatedAt({ fetchedAt: iso }), ms);
  assert.equal(F2.generatedAt({ date: iso }), ms);
});

/* ------------------------------------------------------------------
 * ISO 日期串不能被当成时区不同的另一天：
 * "2026-09-29" 在 UTC 解析成当天 0 点，和 Date.now() 混用时
 * 会凭空少 12 小时，逼近 3 天的阈值就可能误报陈旧。
 * 这里锁住"至少要认得出是同一天"，具体时区交给 Date.parse。
 * ------------------------------------------------------------------ */
test("generatedAt：纯日期串可解析且不返回 NaN", () => {
  const t = F2.generatedAt({ date: "2026-09-29" });
  assert.equal(typeof t, "number");
  assert.ok(isFinite(t));
  assert.equal(F2.isStale(t, NOW, 3), false);
});

/* ------------------------------------------------------------------ */
test("liveUrls：jsDelivr 主源在前、raw 备源在后，且都带完整路径", () => {
  const src = { file: "data/life.json" };
  const urls = F2.liveUrls(src, "zoneboys/ai-sidehustle-hub", "main");
  assert.equal(urls.length, 2);
  assert.ok(urls[0].startsWith("https://cdn.jsdelivr.net/gh/"));
  assert.ok(urls[1].startsWith("https://raw.githubusercontent.com/"));
  for (const u of urls) assert.ok(u.endsWith("/data/life.json"), "路径被截断: " + u);
  assert.deepEqual(F2.liveUrls(src, ""), [], "没配仓库时不该编出一个假地址");
});

/* ------------------------------------------------------------------
 * 清单本身是契约：每份数据都得有 key / file / label / 过期天数。
 * 少一个 label，页面上就会出现一个"数据"这样的匿名按钮，
 * 用户不知道刷新的是什么 —— 那等于没做。
 * ------------------------------------------------------------------ */
test("SOURCES：字段齐全、file 不重复", () => {
  const seen = new Set();
  for (const s of F2.SOURCES) {
    assert.ok(s.key && typeof s.key === "string", "缺 key");
    assert.ok(s.label && typeof s.label === "string", s.key + " 缺 label");
    assert.match(s.file, /^data\/[\w.-]+\.json$/, s.key + " 的 file 形状不对: " + s.file);
    assert.ok(s.maxAgeDays > 0, s.key + " 缺 maxAgeDays");
    assert.ok(!seen.has(s.file), "file 重复: " + s.file);
    seen.add(s.file);
  }
  // 人生指南与同伴问答是本次新增的两份，必须在清单里，
  // 否则它们永远不会参与"每次打开都更新"
  assert.ok(seen.has("data/life.json"), "人生指南不在更新清单里");
  assert.ok(seen.has("data/peer-qa.json"), "同伴问答不在更新清单里");
});

/* ------------------------------------------------------------------ */
test("index.html 的加载器不再用 Date.now() 冒充刷新", () => {
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
  const bust = html.match(/data\/[\w.-]+\.json\?t="?\s*\+\s*Date\.now\(\)/g) || [];
  assert.equal(
    bust.length, 0,
    "还有 " + bust.length + " 处用 ?t=Date.now() 绕缓存——那不是更新，是重下同一份字节"
  );
});
