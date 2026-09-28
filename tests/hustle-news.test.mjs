/**
 * 副业动态区 · 徽章与排序测试
 *
 * 用户第一诉求是「用星数增速判定真风口」。这条路径最容易出的不是崩溃，
 * 而是「静悄悄地说假话」：拿不到增速时把平均日增当成增速报出去，
 * tooltip 里还漏出字面量 null。所以这里跑真实的 renderHustleNews，
 * 盯住它到底对用户说了什么。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const a = html.indexOf("function renderHustleNews(){");
const b = html.indexOf("function setHustleNewsCat", a);
assert.ok(a > 0 && b > a, "抽不出 renderHustleNews");
const FN = html.slice(a, b);

const CATEGORIES = {
  content: { name: "视频/内容", emoji: "🎬" },
  tech: { name: "技术变现", emoji: "👨‍💻" },
};

/** 在最小 DOM 上跑一次真实的 renderHustleNews，返回渲染出的 HTML 与统计行 */
function render(items) {
  const box = { innerHTML: "" };
  const els = {
    "#hustleNews": box,
    "#hustleNewsFilters": { innerHTML: "" },
    "#hustlesDate": { textContent: "" },
    "#hustlesSource": { innerHTML: "" },
  };
  const ctx = {
    state: { hustleNews: { date: "2026-09-28", generatedAt: "2026-09-28T01:30:00Z", items }, hustleNewsCat: null },
    $: (sel) => els[sel] || null,
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
    stamp: () => "09:30",
    CATEGORIES,
    setHustleNewsCat: () => {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(FN, ctx);
  ctx.renderHustleNews();
  return { cards: box.innerHTML, source: els["#hustlesSource"].innerHTML };
}

const mk = (over) => ({
  url: "https://github.com/a/b",
  title: "a/b",
  desc: "d",
  cat: "tech",
  source: "GitHub",
  date: "2026-09-28",
  streak: 1,
  growth: null,
  ...over,
});

test("日增 30%：打「🔥 风口加速中」并报百分比", () => {
  const { cards } = render([mk({ streak: 1, growth: { count: 1300, base: 1000, daily: 30, perDay: 130, ageDays: 10 } })]);
  assert.match(cards, /🔥 风口加速中 日增 30%/);
  assert.match(cards, /1000 → 1300/, "tooltip 要能让人自己核对");
  assert.doesNotMatch(cards, /持续热度/);
});

test("拿不到增速（daily=null）时绝不谎称「加速中」，也不漏出字面量 null", () => {
  const { cards } = render([
    mk({ streak: 3, growth: { count: 261, base: null, daily: null, perDay: 47.45, ageDays: 5.5 } }),
  ]);
  assert.doesNotMatch(cards, /风口加速中/, "没有日环比就不能叫加速中");
  assert.doesNotMatch(cards, /null/, "页面上不能出现字面量 null");
  assert.match(cards, /🔥 持续热度 3 天/);
  assert.match(cards, /日增速要明天的快照才能算出来/, "要说清楚为什么没数");
  assert.match(cards, /平均 47\.45\/天/, "平均日增是另一回事，单独标出来");
});

test("增速低于阈值：算持续热度而不是加速中", () => {
  const { cards } = render([mk({ streak: 4, growth: { count: 1000, base: 1000, daily: 0, perDay: 20, ageDays: 50 } })]);
  assert.doesNotMatch(cards, /加速中/);
  assert.match(cards, /🔥 持续热度 4 天/);
  assert.match(cards, /日均仅 \+0%/, "放缓要说放缓");
});

test("增速为负（掉粉/掉星）也不能叫加速中", () => {
  const { cards } = render([mk({ streak: 5, growth: { count: 900, base: 1000, daily: -10, perDay: 15, ageDays: 60 } })]);
  assert.doesNotMatch(cards, /加速中/);
  assert.match(cards, /持续热度 5 天/);
});

test("排序：增速优先，其次连续上榜天数", () => {
  const items = [
    mk({ title: "slow-5d", streak: 9, growth: { count: 1, base: 1, daily: 6, perDay: 1, ageDays: 1 } }),
    mk({ title: "fast-30d", streak: 1, growth: { count: 1, base: 1, daily: 30, perDay: 1, ageDays: 1 } }),
    mk({ title: "newborn", streak: 1, growth: { count: 1, base: null, daily: null, perDay: 50, ageDays: 1 } }),
  ];
  const { cards } = render(items);
  const order = (cards.split('<div class="ft">').slice(1).map((h) => h.split("</div>")[0]))
    .map((h) => ["slow-5d", "fast-30d", "newborn"].find((t) => h.includes(t)));
  assert.deepEqual(order.slice(0, 3), ["fast-30d", "slow-5d", "newborn"], "增速高的排最前，newborn 垫底");
  // 增速接近时用连续上榜天数兜底：6%/9天 应排在 4%/1天 之后
  const tie = render([
    mk({ title: "a-4pct-1d", streak: 1, growth: { count: 1, base: 1, daily: 4, perDay: 1, ageDays: 1 } }),
    mk({ title: "b-4pct-9d", streak: 9, growth: { count: 1, base: 1, daily: 4, perDay: 1, ageDays: 1 } }),
  ]).cards.split('<div class="ft">').slice(1).map((h) => h.split("</div>")[0]);
  assert.ok(tie[0].includes("b-4pct-9d"), "同增速时天数多的排前面");
});

test("统计行：加速中 / 新上榜的条数与徽章口径一致", () => {
  const items = [
    mk({ title: "hot", streak: 1, growth: { count: 2, base: 1, daily: 30, perDay: 2, ageDays: 1 } }),
    mk({ title: "warm", streak: 3, growth: { count: 2, base: 2, daily: 0, perDay: 2, ageDays: 2 } }),
    mk({ title: "new1", streak: 1 }),
    mk({ title: "new2", streak: 1 }),
  ];
  const { source } = render(items);
  assert.match(source, /🔥 风口加速中 1 条/);
  assert.match(source, /🆕 今日首次上榜 2 条/);
  assert.doesNotMatch(source, /undefined|NaN|null/);
});

test("阈值 5%：4.9% 不算风口，5% 算", () => {
  const just = render([mk({ streak: 1, growth: { count: 1, base: 1, daily: 4.9, perDay: 1, ageDays: 1 } })]).cards;
  const at = render([mk({ streak: 1, growth: { count: 1, base: 1, daily: 5, perDay: 1, ageDays: 1 } })]).cards;
  assert.doesNotMatch(just, /加速中/);
  assert.match(at, /加速中/);
});

test("Product Hunt（无票数、growth 为 null）在页面上干净降级", () => {
  const { cards, source } = render([mk({ source: "Product Hunt", title: "Some App", streak: 1 })]);
  assert.match(cards, /🆕 今日新上榜/);
  assert.doesNotMatch(cards, /null|undefined|NaN|Infinity/);
  assert.doesNotMatch(source, /null|undefined|NaN/);
});

test("数据缺失时给提示，不白屏", () => {
  const els = { "#hustleNews": { innerHTML: "" }, "#hustleNewsFilters": { innerHTML: "" }, "#hustlesDate": { textContent: "" }, "#hustlesSource": { innerHTML: "" } };
  const ctx = { state: { hustleNews: null }, $: (s) => els[s] || null, esc: String, stamp: () => "", CATEGORIES };
  vm.createContext(ctx);
  vm.runInContext(FN, ctx);
  ctx.renderHustleNews();
  assert.match(els["#hustleNews"].innerHTML, /今日新机会暂不可用/);
  assert.match(els["#hustlesSource"].innerHTML, /fetch-hustles\.mjs/, "要告诉用户怎么生成");
});
