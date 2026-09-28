/**
 * 星数增速 · 全链路逻辑测试
 *
 * 核心命题：「用星数增速判定真风口」不能只在页面上看起来对。
 * 这里把 fetch-hustles.mjs 里真实的 applyGrowth / applyStreak / seedHistoryFromSnapshot
 * 抽出来，用内存文件系统跑，重点覆盖最容易悄悄失效的三处：
 *   1. 同一天重跑时基准日丢失 → 日环比永远 null → 「🔥 风口加速中」永不点亮
 *   2. 播种时没带热度 → 功能上线后空白一天
 *   3. 拿今天自己当基准 → 报出 +0.0% 这种假信息
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../scripts/fetch-hustles.mjs", import.meta.url), "utf8");

/* 抽出四个真实函数（loadHistory → applyStreak 这一段） */
const a = src.indexOf("function loadHistory()");
const b = src.indexOf("async function main()");
assert.ok(a > 0 && b > a, "抽不出 fetch-hustles 的历史/增速函数块");
const BLOCK = src.slice(a, b);

/** 用内存 fs 跑一遍真实代码，返回 { applyGrowth, applyStreak, seedHistoryFromSnapshot, read } */
function load(files = {}) {
  const store = { ...files };
  const ctx = {
    existsSync: (p) => Object.hasOwn(store, p),
    readFileSync: (p) => {
      if (!Object.hasOwn(store, p)) throw new Error("ENOENT " + p);
      return store[p];
    },
    writeFileSync: (p, content) => { store[p] = content; },
    mkdirSync: () => {},
    dirname: (p) => p.replace(/\/[^/]+$/, ""),
    HISTORY: "history.json",
    PREV: "prev.json",
    HISTORY_DAYS: 30,
    console: { log() {} },
    Date,
    Math,
    Number,
    Object,
    JSON,
    String,
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK, ctx);
  return Object.fromEntries([
    ["applyGrowth", ctx.applyGrowth],
    ["applyStreak", ctx.applyStreak],
    ["seedHistoryFromSnapshot", ctx.seedHistoryFromSnapshot],
    ["read", (p) => JSON.parse(store[p] || "null")],
    ["write", (p, v) => { store[p] = JSON.stringify(v); }],
    ["raw", store],
  ]);
}

const item = (over = {}) => ({
  url: "https://github.com/a/b",
  title: "a/b",
  cat: "tech",
  pop: 1000,
  ageDays: 10,
  ...over,
});
const key = (it) => `${it.url}|${it.title}`.toLowerCase();

test("有昨天基准时算出真实日环比（30% 增长）", () => {
  const { applyGrowth } = load();
  const it = item({ pop: 1300 });
  applyGrowth(it, { pop: 1000, lastSeen: "2026-09-27" }, "2026-09-28");
  assert.equal(it.growth.daily, 30);
  assert.equal(it.growth.base, 1000);
  assert.equal(it.growth.days ?? it.growth.ageDays, 10); // ageDays 不受基准影响
});

test("同一天重跑：取历史里的 basePop/baseDay，而不是拿今天自己当基准", () => {
  const { applyGrowth } = load();
  const a1 = item({ pop: 1300 });
  applyGrowth(a1, { pop: 1000, lastSeen: "2026-09-27" }, "2026-09-28");
  assert.equal(a1.growth.daily, 30);
  // 落盘后再重跑一次：old.pop 已经是今天的数了，必须退回 basePop
  const a2 = item({ pop: 1300 });
  applyGrowth(a2, { pop: 1300, lastSeen: "2026-09-28", basePop: 1000, baseDay: "2026-09-27" }, "2026-09-28");
  assert.equal(a2.growth.daily, 30, "同日重跑后增速应与首次一致");
  assert.equal(a2.growth.base, 1000);
});

test("同一天重跑且旧条目没有 baseDay：不报增速，而不是报 +0.0%", () => {
  const { applyGrowth } = load();
  const it = item({ pop: 1300 });
  applyGrowth(it, { pop: 1300, lastSeen: "2026-09-28" }, "2026-09-28");
  assert.equal(it.growth.daily, null, "拿今天自己当基准的假 +0% 必须挡住");
  assert.equal(it.growth.base, null, "没有可信基准时 base 也要置空");
  assert.equal(it.growth.perDay, 130, "perDay 首日即可用");
});

test("新条目首次上榜：没有基准，daily 为 null，perDay 仍可用", () => {
  const { applyGrowth } = load();
  const it = item({ pop: 500, ageDays: 5 });
  applyGrowth(it, null, "2026-09-28");
  assert.equal(it.growth.daily, null);
  assert.equal(it.growth.base, null);
  assert.equal(it.growth.perDay, 100);
  assert.equal(it.growth.ageDays, 5);
});

test("基准日为 0（Product Hunt 无票数）时不产生 Infinity / 离谱百分比", () => {
  const { applyGrowth } = load();
  const it = item({ pop: 500 });
  applyGrowth(it, { pop: 0, lastSeen: "2026-09-27" }, "2026-09-28");
  assert.equal(it.growth.daily, null, "分母为 0 不能出百分比");
  assert.ok(Number.isFinite(it.growth.perDay));
});

test("基准日隔了 3 天（断更后回榜）：折算成日均，不把 3 天涨幅当成 1 天", () => {
  const { applyGrowth } = load();
  const it = item({ pop: 1300 });
  applyGrowth(it, { pop: 1000, lastSeen: "2026-09-25" }, "2026-09-28");
  // 1.3^(1/3)-1 = 9.14% -> 9.1
  assert.equal(it.growth.daily, 9.1);
  assert.equal(it.growth.base, 1000);
});

test("applyStreak 往返：写入 basePop 后同日重跑仍能复现同一组增速", () => {
  const { applyStreak, read } = load();
  const today = "2026-09-28";
  // 第一天：条目新上榜，没有基准
  const first = [item({ pop: 1000 })];
  applyStreak(first, today);
  assert.equal(first[0].growth.daily, null);
  const saved = read("history.json");
  assert.equal(saved.entries[key(first[0])].basePop, null);

  // 第二天：拿昨天的 1000 当基准，涨到 1300 -> +30%
  const second = [item({ pop: 1300 })];
  applyStreak(second, "2026-09-29");
  assert.equal(second[0].growth.daily, 30);
  const saved2 = read("history.json");
  assert.equal(saved2.entries[key(second[0])].basePop, 1000, "基准要落盘，供同日重跑复现");
  assert.equal(saved2.entries[key(second[0])].baseDay, "2026-09-28");

  // 同一天再重跑两次：old.pop 已是今天的数，必须用 basePop 而不是拿自己当基准
  for (const p of [1300, 1310]) {
    const rerun = [item({ pop: p })];
    applyStreak(rerun, "2026-09-29");
    assert.equal(rerun[0].growth.daily, +(((p - 1000) / 1000) * 100).toFixed(1), `重跑 pop=${p} 的增速应基于 1000`);
    assert.equal(rerun[0].growth.base, 1000);
  }
});

test("播种：把昨天快照的热度带进历史，今天第一次运行就有增速", () => {
  const prev = { date: "2026-09-27", items: [item({ pop: 1000 }), item({ pop: 0, title: "a/c", url: "https://ph/p" })] };
  const { applyStreak, seedHistoryFromSnapshot, read } = load({ "prev.json": JSON.stringify(prev) });
  seedHistoryFromSnapshot("2026-09-28");
  const seeded = read("history.json").entries;
  assert.equal(seeded[key(prev.items[0])].pop, 1000, "昨天有热度的必须带下去");
  assert.equal(seeded[key(prev.items[1])].pop, undefined, "昨天没热度的不能硬编一个");

  const today = [item({ pop: 1300 })];
  applyStreak(today, "2026-09-28");
  assert.equal(today[0].growth.daily, 30, "上线当天就该有增速，不必再等一天");
  assert.equal(today[0].streak, 2);
});

test("热度为 0 或缺失：整体降级，不给前端假信号", () => {
  const { applyGrowth } = load();
  const a = item({ pop: 0 });
  applyGrowth(a, { pop: 10, lastSeen: "2026-09-27" }, "2026-09-28");
  assert.equal(a.growth, null);
  const b = item({ pop: undefined });
  applyGrowth(b, { pop: 10, lastSeen: "2026-09-27" }, "2026-09-28");
  assert.equal(b.growth, null);
});
