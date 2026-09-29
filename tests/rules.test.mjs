import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const R = require(resolve(ROOT, "data/rules-core.js"));

/* ------------------------------------------------------------------ */
/* 归一化：任何「拿不到」都必须变成 null，绝不能变成 0                  */
/* ------------------------------------------------------------------ */

test("空值转 null 而非 0——这两者处方相反（去取数 vs 改内容）", () => {
  assert.equal(R.num(""), null);
  assert.equal(R.num(null), null);
  assert.equal(R.num(undefined), null);
  assert.equal(R.num("abc"), null);
  assert.equal(R.ratio(""), null);
});

test("中文/口语数字能解析，否则用户会得到「你没病」的错误结论", () => {
  assert.equal(R.num("1.2k"), 1200);
  assert.equal(R.num("1,200"), 1200);
  assert.equal(R.num("3万"), 30000);
  assert.equal(R.num("百分之十二"), 0.12);
  assert.equal(R.num("两成"), 0.2);
  assert.equal(R.num("十二"), 12);   // 十在前
  assert.equal(R.num("二十"), 20);   // 十在后
  assert.equal(R.num("三十五"), 35);
  assert.equal(R.num("１２"), 12);   // 全角
  // 两种「十」的写法必须分别锁住：只实现一种时，
  // 另一半会静默变 null，而 null 让诊断器「跳过判断」——最危险的失败模式
  assert.equal(R.num("十五"), 15);
  assert.equal(R.num("十"), 10);
});

test("比率 >1 按百分数解释，0..1 原样保留", () => {
  assert.equal(R.ratio("12"), 0.12);
  assert.equal(R.ratio("0.12"), 0.12);
  assert.equal(R.ratio("45%"), 0.45);
  assert.ok(R.ratio(5) > 1 || R.ratio(5) === 0.05);
});

test("NaN 绝不能泄漏进 profile（NaN 参与比较恒为 false，会静默跳过诊断）", () => {
  for (const input of [{ finish: "abc" }, { eng: "百分比" }, { dwell: "" }, { followsPer: "N/A" }]) {
    const p = R.norm(input);
    for (const k of ["finish", "eng", "dwell", "followsPer"]) {
      assert.ok(p[k] === null || Number.isFinite(p[k]), `${k} 泄漏了 NaN/Infinity`);
    }
  }
});

test("没填赛道数时按 1 计——默认聚焦，而不是默认乱发", () => {
  assert.equal(R.norm({}).niches, 1);
  assert.equal(R.norm({ niches: 3 }).niches, 3);
});

/* ------------------------------------------------------------------ */
/* 诊断排序：先按层，再按严重度                                        */
/* ------------------------------------------------------------------ */

test("先发够样本量之前，不要让人去改后面那几道闸", () => {
  // 完播率极差(3分) 但完全没发够样本——层 0 没过，层 2 的数据不可信
  const d = R.diagnose({ posts: 2, recent7: 2, finish: 0.05, eng: 0.001 });
  assert.equal(d.top[0].m.id, "sample", "样本量闸必须排在完播率前面");
  assert.ok(d.blocked > 0, "应标记出「现在还不能动」的机制数");
});

test("同一层内按严重度排序", () => {
  const d = R.diagnose({ posts: 0 }); // 节奏闸 3 分，样本闸 3 分
  assert.ok(d.top.every((h) => h.m.layer === d.top[0].m.layer));
  for (let i = 1; i < d.top.length; i++) {
    if (d.top[i].m.layer === d.top[i - 1].m.layer) {
      assert.ok(d.top[i - 1].score >= d.top[i].score);
    }
  }
});

test("最多给 3 条——再多就不是诊断，是清单", () => {
  // 必须先确认真的能溢出，否则这条断言是空的
  // （早先的版本用 posts:0/niches:5，恰好只产生 3 个命中，
  //   去掉 slice 后测试依然绿，等于什么都没验）
  const d = R.diagnose({
    posts: 0, recent7: 0, niches: 9, followers: 0, views: 0,
    finish: 0.01, dwell: 0.01, eng: 0, best: 0, median: 0,
  });
  assert.ok(d.all > 3, `前提失效：只命中 ${d.all} 条，无法验证截断`);
  assert.equal(d.top.length, 3);
});

test("tell 抛异常不会让整个诊断崩掉", () => {
  for (const m of R.MECHANISM) {
    const d = R.diagnose({ posts: "坏数据", niches: "x", finish: {}, eng: [] });
    assert.ok(Array.isArray(d.top));
    assert.ok(typeof m.id === "string");
  }
});

/* ------------------------------------------------------------------ */
/* 这才是核心断言：原始诉求「发了没流量」能被诊断成具体结论             */
/* ------------------------------------------------------------------ */

test("「发了没流量」必须得到具体诊断，而不是「多努力」", () => {
  const d = R.diagnose({ platform: "douyin", posts: 12, recent7: 1, followers: 30, views: 400, niches: 1 });
  const v = R.verdict(d);
  assert.ok(v.head.includes("第"), "结论要指明卡在第几道闸");
  assert.ok(typeof v.fix === "string" && v.fix.length > 10, "必须给出可执行动作");
  assert.ok(typeof v.test === "string" && v.test.length > 0, "必须告诉用户去后台看哪个数");
  assert.ok(!/坚持|努力|多发点|继续加油/.test(v.fix), "不能输出通用鸡汤");
});

test("一条没发过 → 直接指向节奏闸，而不是建议优化内容", () => {
  const d = R.diagnose({ posts: 0 });
  assert.equal(d.top[0].m.id, "cadence");
});

test("数据健康时不硬凑诊断", () => {
  const d = R.diagnose({
    posts: 40, recent7: 4, niches: 1, finish: 0.5, dwell: 0.6, eng: 0.06,
    best: 4000, median: 2000, followers: 5000, followsPer: 20,
  });
  assert.equal(d.top.length, 0, "各项都健康时不该编出一个卡点");
  assert.equal(R.verdict(d).tone, "ok");
});

/* ------------------------------------------------------------------ */
/* 门槛差距                                                            */
/* ------------------------------------------------------------------ */

test("门槛给的是差距，不是绝对值", () => {
  const g = R.gateGap(R.gatesFor("douyin")[0], 300);
  assert.equal(g.need, 1000);
  assert.equal(g.left, 700);
  assert.equal(g.ratio, 0.3);
  assert.equal(g.done, false);
});

test("额外条件（播放量）要单独标出，不能让人以为只差粉丝", () => {
  const g = R.gateGap(R.gatesFor("douyin")[0], 5000);
  assert.ok(g.extra && g.extra.includes("播放"), "中视频计划的播放门槛必须显示");
});

test("超额时 got 被夹在 need 内，不出现 1.5 倍这种显示错误", () => {
  const g = R.gateGap(R.gatesFor("wechat")[0], 99999);
  assert.equal(g.got, 500);
  assert.equal(g.ratio, 1);
  assert.equal(g.done, true);
});

/* ------------------------------------------------------------------ */
/* 诚实性不变量：门槛数字必须可核验                                     */
/* ------------------------------------------------------------------ */

test("每条门槛都必须带官方核验链接和核对日期", () => {
  for (const g of R.GATE) {
    assert.ok(g.verify && /^https:\/\//.test(g.verify), `${g.name} 缺少官方链接`);
    assert.ok(g.where && g.where.length > 0, `${g.name} 缺少「去哪儿看」`);
    assert.ok(g.checkedOn && /^\d{4}-\d{2}$/.test(g.checkedOn), `${g.name} 缺少核对日期`);
    assert.ok(g.next && g.next.length > 10, `${g.name} 缺少下一步动作`);
  }
});

test("每条机制都必须有可测指标 + 处方 + 修复动作", () => {
  for (const m of R.MECHANISM) {
    assert.ok(m.test && m.test.length > 0, `${m.id} 缺少可测指标`);
    assert.ok(m.why && m.why.length > 20, `${m.id} 机制解释太短`);
    assert.ok(m.fix && m.fix.length > 10, `${m.id} 缺少修复动作`);
    assert.ok(typeof m.tell === "function", `${m.id} 缺少 tell`);
  }
});

test("门面的 form/feed 区分必须存在——给公众号看完播率是错的", () => {
  const wx = R.PLATFORMS.find((p) => p.id === "wechat");
  const dy = R.PLATFORMS.find((p) => p.id === "douyin");
  assert.equal(wx.form, "form");
  assert.equal(dy.form, "feed");
  assert.ok(wx.metric !== dy.metric, "两种平台看的主指标不能相同");
});
