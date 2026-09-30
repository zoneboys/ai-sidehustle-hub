import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const P = require("../data/pipeline-core.js");
const R = require("../data/rules-core.js");

/* ---------- 建卡 ---------- */

test("createCard：基线快照被冻结，之后改输入不影响旧卡", () => {
  const base = { finish: "18", eng: "0.6" };
  const card = P.createCard({ platform: "douyin", gateId: "hook", gateName: "前 3 秒 / 首屏闸", gateLayer: 2, baseline: base });
  base.finish = "99"; // 用户回头改了输入框
  assert.equal(card.before, 18, "卡的基线必须停留在建卡那一刻");
  assert.equal(card.metric, "finish");
  assert.equal(card.stage, "do");
  assert.ok(card.id.startsWith("pc-"));
});

test("createCard：不认识的闸 id 给 null 指标而不是崩", () => {
  const card = P.createCard({ gateId: "nonexistent", baseline: {} });
  assert.equal(card.metric, null);
  assert.equal(card.before, null);
});

/* ---------- 强制递进：没写改动不许发 ---------- */

test("advance：改动少于 4 个字不许标已发", () => {
  const card = P.createCard({ gateId: "hook", baseline: { finish: 18 } });
  card.changed = "改了";
  const r = P.advance(card);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes("至少 4 个字"), "reason 要给人看");
  assert.equal(card.stage, "do", "状态不许被推进");
});

test("advance：写清改动后进入观察期，记录发布时间", () => {
  const card = P.createCard({ gateId: "hook", baseline: { finish: 18 } });
  card.changed = "把结论放到第一句，删掉铺垫";
  const t0 = Date.now();
  const r = P.advance(card, t0);
  assert.equal(r.ok, true);
  assert.equal(card.stage, "published");
  assert.equal(card.publishedAt, t0);
});

/* ---------- 观察期：没满 7 天不许回看 ---------- */

test("review：观察期未满被拒绝，且拒绝理由里有剩余天数", () => {
  const card = P.createCard({ gateId: "hook", baseline: { finish: 18 } });
  card.changed = "把结论放到第一句，删掉铺垫";
  const t0 = Date.now();
  P.advance(card, t0);
  const r = P.review(card, 30, 0.25, t0 + 3 * 86400000);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes("4"), "第 3 天回看应报还剩 4 天");
  assert.equal(card.stage, "published", "状态不许被推进");
});

test("review：满 7 天后可以回看并产生判定", () => {
  const card = P.createCard({ gateId: "hook", baseline: { finish: 18 } });
  card.changed = "把结论放到第一句，删掉铺垫";
  const t0 = Date.now();
  P.advance(card, t0);
  // need 按页面传入原值（0.25 分数口径）：26 >= 0.25 → 过线即 pass，不看涨幅
  const r = P.review(card, 26, 0.25, t0 + 7 * 86400000);
  assert.equal(r.ok, true);
  assert.equal(card.verdict, "pass");
  assert.ok(Math.abs(card.after - 26) < 1e-9);
  assert.ok(card.reviewedAt >= t0 + 7 * 86400000);
});

test("review：判定口径用 need 原值，页面传什么就是什么", () => {
  // need 的单位由页面负责换算（percent→分数），核心只做比较。
  // 这里验证「没过线但涨幅够」这条路径：need 设一个达不到的值。
  const j = P.judge(10, 14, 20); // 涨 40%，但 14 < 20
  assert.equal(j.verdict, "improved");
  assert.ok(Math.abs(j.delta - 0.4) < 1e-9);
});

test("review：已结的卡不能再回看", () => {
  const card = P.createCard({ gateId: "hook", baseline: { finish: 18 } });
  card.changed = "把结论放到第一句，删掉铺垫";
  const t0 = Date.now();
  P.advance(card, t0);
  P.review(card, 26, 0.25, t0 + 7 * 86400000);
  const r = P.review(card, 30, 0.25, t0 + 8 * 86400000);
  assert.equal(r.ok, false);
});

/* ---------- 四种判定 ---------- */

test("judge：过线 = pass（不看涨幅）", () => {
  assert.equal(P.judge(10, 30, 25).verdict, "pass");
  assert.equal(P.judge(null, 30, 25).verdict, "pass", "没基线也能按过线判");
});

test("judge：没基线且没过线 = flat，绝不拿 0 当基线", () => {
  const j = P.judge(null, 0.5, 3);
  assert.equal(j.verdict, "flat");
  assert.equal(j.delta, null, "delta 必须是「不知道」而不是 0");
});

test("judge：变差 10% 以上 = worse", () => {
  assert.equal(P.judge(10, 8.5, 25).verdict, "worse");
});

test("judge：±10% 内的波动 = flat（社交平台自然波动就能到这个幅度）", () => {
  assert.equal(P.judge(10, 10.8, 25).verdict, "flat");
  assert.equal(P.judge(10, 9.2, 25).verdict, "flat");
});

/* ---------- 聚合与「有效改动清单」 ---------- */

test("stats：三个阶段计数正确，有效清单去重", () => {
  const mk = (stage, verdict, changed) => {
    const c = P.createCard({ gateId: "hook", baseline: { finish: 10 } });
    c.stage = stage;
    c.changed = changed;
    if (stage !== "do") c.publishedAt = Date.now() - 8 * 86400000;
    if (stage === "reviewed") { c.verdict = verdict; c.after = 40; c.reviewedAt = Date.now(); }
    return c;
  };
  const cards = [
    mk("do"),
    mk("published"),
    mk("reviewed", "pass", "把结论放到第一句"),
    mk("reviewed", "improved", "把结论放到第一句"), // 同文，应被去重
    mk("reviewed", "improved", "结尾留一个能被回答的问题"),
    mk("reviewed", "flat", "多发一点"), // 无效改法不进清单
  ];
  const s = P.stats(cards);
  assert.equal(s.doing, 1);
  assert.equal(s.watching, 1);
  assert.equal(s.done, 4);
  assert.deepEqual(s.effective, ["把结论放到第一句", "结尾留一个能被回答的问题"]);
});

/* ---------- sanitize：localStorage 里的坏数据不能炸清单 ---------- */

test("sanitize：丢坏卡、留好卡、修字段类型", () => {
  const out = P.sanitize([
    null,
    { id: "a", gateId: "hook", stage: "do" },                        // 好
    { id: "b", gateId: "hook", stage: "published" },                 // published 没 publishedAt → 丢
    { id: "c", gateId: "hook", stage: "xxx" },                       // 非法阶段 → 丢
    { id: "e", gateId: "hook", stage: "done", publishedAt: 123 },    // 非法阶段但带了发布时间：只有白名单能拦住
    { gateId: "hook", stage: "do" },                                 // 没 id → 丢
    { id: "d", gateId: "hook", stage: "do", before: "12.5", gateLayer: "2" }, // 字符串数字要归位
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1].before, 12.5);
  assert.equal(out[1].gateLayer, 2);
});

test("sanitize：非数组输入返回空数组", () => {
  assert.deepEqual(P.sanitize(null), []);
  assert.deepEqual(P.sanitize("junk"), []);
});

/* ---------- 跨文件不变量：need 数字只存在于 rules-core 一处 ---------- */

test("管线文档承诺的指标字段与诊断器输入字段一致", () => {
  // hook 闸的回看指标必须是 RZ_FIELDS 里的 finish，否则建卡基线和回看对比的根本不是同一个数
  const rzKeys = ["posts", "recent7", "gapDays", "followers", "views", "finish", "eng", "dwell", "best", "median"];
  for (const [gate, m] of Object.entries(P.GATE_METRIC)) {
    if (gate === "follow") continue;      // followsPer 是 norm 派生的，不在 RZ_FIELDS
    if (gate === "ceiling") continue;     // bestOverMedian 是 best/median 派生的
    assert.ok(rzKeys.includes(m.field), gate + " 闸的回看指标 " + m.field + " 必须是诊断器输入字段");
  }
});

test("mechanism 的 id 全部能在管线的指标表里找到", () => {
  for (const m of R.MECHANISM) {
    assert.ok(P.GATE_METRIC[m.id], "诊断器有闸 " + m.id + " 但管线没有它的回看指标——新闸上线必须同步管线");
  }
});

test("管线不复制 need 数字：OBSERVE_DAYS 与 IMPROVE_RATIO 的变异有效性", () => {
  // 这两条是行为锚点：如果有人改了核心里的数字，这里的期望值也要跟着改——
  // 逼着改动者看过注释里写的原因，而不是悄悄漂移。
  assert.equal(P.OBSERVE_DAYS, 7);
  assert.equal(P.IMPROVE_RATIO, 0.3);
});
