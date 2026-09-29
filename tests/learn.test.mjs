/**
 * 学习单元 · 核心逻辑测试
 *
 * 目标不是「页面能渲染」，而是保证三件事：
 *   1) 状态机不会把「只点开链接」算成学会（那正是原来的死链行为）
 *   2) 交付物选择稳定 —— 刷新一次用户的进度就断掉，是最伤的体验 bug
 *   3) 提问链接在中文/特殊字符下不拼坏，且一定带上可识别的标签
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadLearn() {
  const src = readFileSync(new URL("../data/learn-core.js", import.meta.url), "utf8");
  // vm 沙箱默认没有 URLSearchParams，askUrl 在里面会直接抛。
  // 这类差异正是要防的：浏览器有、旧环境（部分阅读器/测试）没有。
  const ctx = { window: {}, module: { exports: {} }, URLSearchParams, URL };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.LEARN_CORE;
}

const L = loadLearn();

/* ---------------- 状态机：不能把点开链接当成学会 ---------------- */

test("没写过任何东西 = 未开始，不管有没有点开链接", () => {
  assert.equal(L.unitState(null, Date.now()), "new");
  assert.equal(L.unitState({ text: "   " }, Date.now()), "new");
  // 关键：只点开原文、没动笔，仍然是 new —— 否则退回死链行为
  assert.equal(L.unitState(null, 1700000000000), "new");
});

test("四步顺序：先答 → 才允许算读过 → 交付后完成", () => {
  const r = { text: "讲了怎么用 AI 做副业" };
  assert.equal(L.unitState(r, null), "recalled", "答了还没读");
  assert.equal(L.unitState(r, 1700000000000), "compared", "读了还没交付");
  assert.equal(L.unitState({ ...r, delivered: "card" }, 1700000000000), "done");
});

test("进度比例单调递增，且 done 才是 1", () => {
  const r = { text: "x" };
  const seq = [
    L.unitProgress(null, null),
    L.unitProgress(r, null),
    L.unitProgress(r, 1),
    L.unitProgress({ ...r, delivered: "card" }, 1),
  ].map((p) => p.ratio);
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i] >= seq[i - 1], `第 ${i} 步比例倒退了：${seq[i - 1]} → ${seq[i]}`);
  }
  assert.equal(seq[seq.length - 1], 1);
  assert.ok(seq[0] === 0);
});

test("每种状态都有对应提示，不出现空字符串", () => {
  for (const s of ["new", "recalled", "compared", "done"]) {
    assert.ok(L.nudge(s).length > 0, `${s} 没有提示语`);
  }
});

/* ---------------- 交付物：必须稳定 ---------------- */

test("同一条内容多次调用返回同一个交付物（刷新不丢进度）", () => {
  const item = { id: "x1", title: "三年级数学", track: "k12", stage: "primary" };
  const first = L.deliverableFor(item);
  for (let i = 0; i < 50; i++) {
    assert.equal(L.deliverableFor(item).id, first.id, "交付物在多次调用之间漂移了");
  }
});

test("不同内容拿到不同交付物（不是所有人同一句）", () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    seen.add(L.deliverableFor({ id: "i" + i, track: "ai" }).id);
  }
  assert.ok(seen.size > 1, "所有条目交付物都一样，等于没个性化");
});

test("K12 低学段偏向「讲给一个人听」，成人/工作场景偏向「自己试」", () => {
  const oral = L.deliverableFor({ id: "a", track: "k12", stage: "primary" });
  const apply = L.deliverableFor({ id: "b", track: "ai", stage: "work" });
  assert.equal(oral.id, "teach");
  assert.equal(apply.id, "apply");
});

test("未知赛道/学段不崩，且仍给出可用交付物", () => {
  const d = L.deliverableFor({ id: "z", track: "???", stage: "???" });
  assert.ok(d && d.text && d.text.length > 0);
  assert.ok(d.hint && d.hint.length > 0, "交付物必须带「怎么算完成」的判据");
});

/* ---------------- 提问链接 ---------------- */

test("提问链接带 question 标签和赛道标签，否则抓取脚本认不出来", () => {
  const u = new URL(L.askUrl({ title: "T", track: "k12", stage: "primary", url: "https://e.com" }));
  assert.equal(u.origin + u.pathname, "https://github.com/zoneboys/ai-sidehustle-hub/issues/new");
  const labels = u.searchParams.get("labels");
  assert.ok(labels.includes("question"), "缺 question 标签");
  assert.ok(labels.includes("k12"), "赛道标签没带上，这条提问就白提了");
});

test("提问链接把用户写的卡点原样带进去（别人不用先读原文）", () => {
  const u = new URL(L.askUrl({ title: "T", track: "k12" }, "我不理解为什么这里要用分母"));
  assert.ok(u.searchParams.get("body").includes("我不理解为什么这里要用分母"));
});

test("没写卡点时也有兜底文案，不发空正文", () => {
  const u = new URL(L.askUrl({ title: "T", track: "ai" }, "   "));
  assert.ok(u.searchParams.get("body").trim().length > 0);
});

test("中文 / 特殊字符 / 井号 不会把链接拼坏", () => {
  const nasty = '标题有 # 号 & 问号? 还有 "引号" 和 100%';
  const raw = L.askUrl({ title: nasty, track: "ai" }, "卡点 #1 & 2?");
  assert.ok(!/[ #&?]/.test(raw.split("?")[1].split("&")[0].replace(/&(amp|lt|gt|quot|#39);/g, "")),
    "query 里出现了未转义的裸字符");
  const u = new URL(raw);
  assert.equal(u.searchParams.get("title").includes("# 号"), true);
  assert.ok(u.searchParams.get("body").includes("卡点 #1 & 2?"));
});

/* ---------------- 同伴互助排序 ---------------- */

test("没人回答的排前面 —— 那里最缺人", () => {
  const items = [
    { num: 1, solved: true, answerCount: 5, at: "2026-09-01T00:00:00Z" },
    { num: 2, solved: false, answerCount: 0, at: "2026-09-02T00:00:00Z" },
  ];
  assert.equal(L.peerSort(items)[0].num, 2);
});

test("指定赛道时同赛道优先", () => {
  const items = [
    { num: 1, track: "ai", solved: false, answerCount: 0, at: "2026-09-01T00:00:00Z" },
    { num: 2, track: "k12", solved: false, answerCount: 0, at: "2026-09-01T00:00:00Z" },
  ];
  assert.equal(L.peerSort(items, "k12")[0].num, 2);
});

test("排序不改原数组，且缺 at 的条目沉到末尾而不是 NaN", () => {
  const items = [
    { num: 1, solved: false, answerCount: 0 },
    { num: 2, solved: false, answerCount: 0, at: "2026-09-01T00:00:00Z" },
  ];
  const copy = items.slice();
  const out = L.peerSort(items, null, Date.parse("2026-09-03T00:00:00Z"));
  assert.equal(items.length, copy.length);
  assert.equal(items[0].num, copy[0].num, "排序就地改了入参");
  assert.equal(out[out.length - 1].num, 1, "没有时间戳的条目没沉底");
});

test("空数据不崩", () => {
  // 跨 realm 的数组原型不同，deepEqual 会误报，用长度断言
  assert.equal(L.peerSort(null).length, 0);
  assert.equal(L.peerSort([]).length, 0);
});

/* ---------------- 统计 ---------------- */

test("统计覆盖四种状态并给出整体进度", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const recs = {
    a: { text: "x" },                              // recalled
    b: { text: "x", readAt: 1 },                   // compared
    c: { text: "x", readAt: 1, delivered: "card" },// done
    // d 未开始
  };
  const s = L.stats(items, recs);
  assert.equal(s.total, 4);
  assert.equal(s.recalled, 1);
  assert.equal(s.compared, 1);
  assert.equal(s.done, 1);
  assert.equal(s.new, 1);
  assert.ok(s.ratio > 0 && s.ratio < 1, "进度应在 0 和 1 之间");
});

test("没有数据时进度为 0 而不是 NaN", () => {
  const s = L.stats([], {});
  assert.equal(s.total, 0);
  assert.equal(s.ratio, 0);
});

/* ---------------- 空态 ---------------- */

test("空态给出可执行的第一步，不是空白区块", () => {
  const h = L.peerEmptyHint();
  assert.ok(h.title.length > 0);
  assert.ok(h.steps.length >= 2, "空态必须说明怎么开始");
});
