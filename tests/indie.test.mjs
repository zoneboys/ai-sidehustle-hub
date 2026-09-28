/**
 * 「🇨🇳 独立开发」栏目 · 全链路测试
 *
 * 两层：
 *   1) 解析层：scripts/fetch-indie.mjs 的 parseReadme / buildStats 纯函数，
 *      喂一段手工造的 README 样本，验证日期窗口、状态映射、品类归类、去重。
 *   2) 渲染层：把 index.html 里真实的 renderIndie 抽出来在最小 DOM 上跑，
 *      验证 KPI / 拥挤榜 / 筛选 / HTML 转义 / 空数据降级。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseReadme, buildStats, CATS, publicCats, PAY_LABELS } from "../scripts/fetch-indie.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/* ---------- 测试辅助 ---------- */

function day(offset) {
  return new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}
const D0 = day(0);
const D1 = day(-1);
const OLD = day(-90); // 远在 30 天窗口之外

// README 日期头格式是「### 2026 年 9 月 27 号添加」，从 ISO 日期还原成中文
const cnDate = iso => {
  const [y, m, d] = iso.split("-");
  return `### ${y} 年 ${Number(m)} 月 ${Number(d)} 号添加`;
};

const SAMPLE = [
  cnDate(D0),
  `#### 张三(北京) - [Github](https://github.com/zhangsan)`,
  `* :white_check_mark: [AI 头像生成器](https://a.example.com)：上传自拍自动生成职业头像，去水印下载一次性付费`,
  `* :clock8: [本地待办工具](https://b.example.com)：还在开发中，浏览器本地处理，不上传`,
  `* :x: [已关闭的项目](https://c.example.com)：维护者跑路`,
  ``,
  cnDate(OLD),
  `#### 不该被收录 - [Github](https://github.com/old)`,
  `* :white_check_mark: [老项目](https://old.example.com)：早于窗口期`,
].join("\n");

/* ---------- 解析层 ---------- */

test("parseReadme：只取窗口期内的条目，越界的直接停", () => {
  const { items } = parseReadme(SAMPLE, { days: 30 });
  assert.equal(items.length, 3, "3 个窗口内条目");
  assert.equal(items.some((i) => i.url.includes("old.example.com")), false, "90 天前的不该进来");
});

test("parseReadme：状态 emoji 正确映射成中文标签", () => {
  const { items } = parseReadme(SAMPLE, { days: 30 });
  const by = Object.fromEntries(items.map((i) => [i.url, i]));
  assert.equal(by["https://a.example.com"].status, "live");
  assert.equal(by["https://b.example.com"].statusLabel, "开发中");
  assert.equal(by["https://c.example.com"].statusEmoji, "❌");
});

test("parseReadme：作者名与 GitHub 主页一起抽出", () => {
  const { items } = parseReadme(SAMPLE, { days: 30 });
  assert.equal(items[0].author, "张三(北京)");
  assert.equal(items[0].authorUrl, "https://github.com/zhangsan");
});

test("parseReadme：简介砍掉「- [更多介绍]」尾巴", () => {
  const { items } = parseReadme(SAMPLE, { days: 30 });
  const a = items.find((i) => i.url === "https://a.example.com");
  assert.equal(a.desc.includes("更多介绍"), false);
  assert.ok(a.desc.includes("一次性付费"), "正文保留：" + a.desc);
});

test("parseReadme：重复 url 只保留一条", () => {
  const dup = SAMPLE + `\n${cnDate(D0)}\n#### 再来一次 - [Github](https://github.com/zhangsan)\n* :white_check_mark: [AI 头像生成器](https://a.example.com)：重复提交`;
  const { items } = parseReadme(dup, { days: 30 });
  assert.equal(items.filter((i) => i.url === "https://a.example.com").length, 1);
});

test("parseReadme：空输入与垃圾输入不抛异常", () => {
  for (const bad of ["", null, undefined, "### 乱七八糟\n#### 没有链接\n* 没有冒号"]) {
    const { items } = parseReadme(bad, { days: 30 });
    assert.ok(Array.isArray(items));
  }
});

test("classify：AI 工具 / 生活效率能分开，不全落 other", () => {
  const { items } = parseReadme(SAMPLE, { days: 30 });
  const by = Object.fromEntries(items.map((i) => [i.url, i]));
  assert.equal(by["https://a.example.com"].cat, "ai", "AI 头像 → ai");
  assert.equal(by["https://b.example.com"].cat, "life", "本地待办工具 → life");
});

test("monetizeSignals：付费 / 免费 / 本地 三种信号都抓得到", () => {
  const { items } = parseReadme(SAMPLE, { days: 30 });
  const a = items.find((i) => i.url === "https://a.example.com");
  assert.ok(a.pay.includes("pay"), "一次性付费 → pay");
  const b = items.find((i) => i.url === "https://b.example.com");
  assert.ok(b.pay.includes("local"), "本地处理 → local");
});

test("buildStats：拥挤榜取前三，冷门方向只留 1~2 条的品类", () => {
  const items = [
    { cat: "ai", status: "live", author: "甲" },
    { cat: "ai", status: "live", author: "乙" },
    { cat: "ai", status: "live", author: "丙" },
    { cat: "content", status: "live", author: "丁" },
    { cat: "game", status: "live", author: "戊" },
  ];
  const s = buildStats(items);
  assert.equal(s.total, 5);
  assert.equal(s.devs, 5);
  assert.equal(s.topCats[0], "ai", "最多的是最挤的");
  assert.equal(s.byCat.ai, 3);
  assert.deepEqual(s.gapCats.sort(), ["content", "game"]);
});

test("buildStats：空数组不崩", () => {
  const s = buildStats([]);
  assert.equal(s.total, 0);
  assert.equal(s.devs, 0);
  assert.deepEqual(s.topCats, []);
});

test("publicCats 不泄露关键词表，只给 name/emoji", () => {
  const c = publicCats();
  assert.ok(c.ai && c.ai.name && c.ai.emoji);
  assert.equal(c.ai.kw, undefined, "前端不需要关键词，别把几百字塞进 JSON");
  assert.equal(Object.keys(c).length, Object.keys(CATS).length);
  assert.ok(PAY_LABELS.pay);
});

/* ---------- 渲染层 ---------- */

function extract(startMark, endMark) {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark, a);
  assert.ok(a > 0 && b > a, `找不到代码块: ${startMark}`);
  return html.slice(a, b);
}

// index.html 在 Windows 上是 CRLF，endMark 里不能写死换行符
const INDIE_BLOCK = extract(
  "/* ---------- 独立开发在做什么",
  "/* ====================================================="
);

function makeEl(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
}

const REAL = JSON.parse(readFileSync(new URL("../data/indie.json", import.meta.url), "utf8"));

function makeCtx(data) {
  const els = new Map();
  const q = sel => {
    const id = sel.replace(/^#/, "");
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  const ctx = {
    console, document: { querySelector: q, querySelectorAll: () => [] },
    $: q,
    esc: s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    state: { indie: data, indieCat: null, indiePay: null },
    toast: () => {},
    stamp: () => "更新于 10:00",
    Date, Math, JSON, Number, Array, String, Object, Boolean, Set, Map, fetch: async () => { throw new Error("no net"); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(INDIE_BLOCK, ctx);
  vm.runInContext("Object.assign(globalThis,{renderIndie,indieBars,safeUrl,INDIE_CATS})", ctx);
  ctx._els = els;
  return ctx;
}

test("渲染：真实数据下 KPI、拥挤榜、卡片都出得来", () => {
  const ctx = makeCtx(REAL);
  ctx.renderIndie();
  const kpi = ctx._els.get("indieKpi").innerHTML;
  assert.ok(kpi.includes(String(REAL.stats.total)), "KPI 里要有项目总数");
  assert.ok(kpi.includes("独立开发者"));
  assert.ok(ctx._els.get("indieHot").innerHTML.includes("ib-bar"), "拥挤榜画出来了");
  assert.ok(ctx._els.get("indieGap").innerHTML.includes("ib-bar"), "冷门方向画出来了");
  const list = ctx._els.get("indieList").innerHTML;
  assert.ok(list.includes("feed-card"));
  assert.equal(list.includes("undefined"), false, "不能有 undefined");
  assert.equal(list.includes("NaN"), false, "不能有 NaN");
  assert.ok(ctx._els.get("indieSource").innerHTML.includes("1c7/chinese-independent-developer"));
});

test("渲染：条形宽度按最大值归一，最大的一定是 110px", () => {
  const ctx = makeCtx(REAL);
  ctx.renderIndie();
  const html2 = ctx._els.get("indieHot").innerHTML;
  const widths = [...html2.matchAll(/width:(\d+)px/g)].map(m => Number(m[1]));
  assert.ok(widths.length > 0);
  assert.equal(Math.max(...widths), 110);
  assert.ok(widths.every(w => w >= 4), "0 也要留 4px，否则条子消失");
});

test("渲染：品类筛选后条目确实变少", () => {
  const ctx = makeCtx(REAL);
  ctx.renderIndie();
  const all = ctx._els.get("indieList").innerHTML.match(/feed-card/g).length;
  const hotCat = REAL.stats.topCats[0];
  ctx.state.indieCat = hotCat;
  ctx.renderIndie();
  const filtered = ctx._els.get("indieList").innerHTML.match(/feed-card/g).length;
  assert.ok(filtered > 0, `${hotCat} 下至少有 1 条`);
  assert.ok(filtered <= all);
  assert.equal(ctx._els.get("indieCatFilters").innerHTML.includes("chip on"), true, "选中态要体现");
});

test("渲染：选了品类后出现「变现方式」二级筛选", () => {
  const ctx = makeCtx(REAL);
  ctx.state.indieCat = REAL.stats.topCats[0];
  ctx.renderIndie();
  assert.notEqual(ctx._els.get("indiePayFilters").style.display, "none");
  assert.ok(ctx._els.get("indiePayFilters").innerHTML.includes("变现方式"));
});

test("渲染：按变现方式筛选只留含该信号的条目", () => {
  const ctx = makeCtx(REAL);
  ctx.state.indiePay = "local";
  ctx.renderIndie();
  const n = ctx._els.get("indieList").innerHTML.match(/feed-card/g) || [];
  const expect = REAL.items.filter(i => (i.pay || []).includes("local")).length;
  assert.equal(n.length, Math.min(36, expect), `local 命中 ${expect} 条`);
});

test("渲染：品类 + 变现方式叠加，两个条件都要满足", () => {
  const ctx = makeCtx(REAL);
  ctx.state.indiePay = "free";
  const want = REAL.items.filter(i => (i.pay || []).includes("free"));
  if (!want.length) return; // 数据里没有免费项时跳过
  const cat = want[0].cat;
  ctx.state.indieCat = cat;
  ctx.renderIndie();
  const shown = ctx._els.get("indieList").innerHTML.match(/feed-card/g) || [];
  assert.equal(shown.length, Math.min(36, want.filter(i => i.cat === cat).length));
});

test("渲染：空数据走降级文案，不白屏也不报错", () => {
  const ctx = makeCtx(null);
  ctx.renderIndie();
  assert.ok(ctx._els.get("indieList").innerHTML.includes("暂不可用"));
  assert.ok(ctx._els.get("indieSource").innerHTML.includes("fetch-indie.mjs"));
  assert.equal(ctx._els.get("indieDate").textContent, "暂无数据");
});

test("渲染：items 为空数组同样降级（不是只有 null 才降级）", () => {
  const ctx = makeCtx({ items: [], stats: {} });
  ctx.renderIndie();
  assert.ok(ctx._els.get("indieList").innerHTML.includes("暂不可用"));
});

test("渲染：缺 cats / payLabels 时用内置兜底，不出现 undefined", () => {
  const ctx = makeCtx({ items: REAL.items, stats: REAL.stats });
  ctx.renderIndie();
  const out = ctx._els.get("indieList").innerHTML + ctx._els.get("indieHot").innerHTML;
  assert.equal(out.includes("undefined"), false);
});

test("渲染：恶意的 title/author 被转义，不会破坏页面", () => {
  const evil = JSON.parse(JSON.stringify(REAL));
  evil.items = [{
    title: '<img src=x onerror="alert(1)">', url: "javascript:alert(1)",
    desc: '"><script>bad()</script>', author: "<b>hack</b>", authorUrl: 'javascript:alert(1)',
    status: "live", statusEmoji: "✅", date: D0, cat: "ai", pay: ["pay"],
  }];
  evil.stats = { total: 1, devs: 1, byCat: { ai: 1 }, byStatus: { live: 1 }, topCats: ["ai"], gapCats: [] };
  const ctx = makeCtx(evil);
  ctx.renderIndie();
  const list = ctx._els.get("indieList").innerHTML;
  assert.equal(list.includes("<script>"), false);
  assert.equal(list.includes("<img src=x"), false);
  assert.equal(list.includes('href="javascript:'), false);
  assert.ok(list.includes("&lt;script&gt;"));
  assert.ok(list.includes("链接已失效"), "非法 url 的标题降级成不可点的纯文本");
  // 嵌套 <a> 会被浏览器拆成两段，DOM 直接坏掉，所以卡片本身必须是 div
  assert.equal(/<a[^>]*>\s*<a/.test(list), false, "不能有嵌套 <a>");
  assert.equal((list.match(/<div class="feed-card">/g) || []).length, 1, "每条一个卡片 div");
});

test("safeUrl：只放行 http/https，其余一律拦掉", () => {
  const ctx = makeCtx(null);
  assert.equal(ctx.safeUrl("https://a.com"), "https://a.com");
  assert.equal(ctx.safeUrl("http://a.com"), "http://a.com");
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "  javascript:x", "", null]) {
    assert.equal(ctx.safeUrl(bad), "", "必须拦掉：" + bad);
  }
});

test("渲染：超过 36 条时脚注说明被截断的数量", () => {
  const big = JSON.parse(JSON.stringify(REAL));
  big.items = Array.from({ length: 90 }, (_, i) => ({
    ...REAL.items[i % REAL.items.length], url: `https://x${i}.example.com`, title: `项目${i}`,
  }));
  const ctx = makeCtx(big);
  ctx.renderIndie();
  const shown = ctx._els.get("indieList").innerHTML.match(/feed-card/g).length;
  assert.equal(shown, 36, "只渲染 36 条，避免一次性塞 100+ 个 DOM");
  assert.ok(ctx._els.get("indieSource").innerHTML.includes("还有 54 条"));
});
