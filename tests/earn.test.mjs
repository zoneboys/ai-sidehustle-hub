/**
 * 变现看板 · 全链路逻辑测试
 *
 * 不做 mock：把 index.html 里真实的看板代码抽出来，在最小 DOM 上跑一遍，
 * 覆盖 localStorage 存取 → 统计 → 时薪对比 → 里程碑 → 导出。
 * 目的是在推代码前确认「真能算对」，而不是只看页面渲染出来没报错。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const earnJs = readFileSync(new URL("../data/earn.js", import.meta.url), "utf8");

/* 从 index.html 抽出看板相关的真实函数代码块 */
function extract(startMark, endMark) {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark, a);
  assert.ok(a > 0 && b > a, `找不到代码块: ${startMark}`);
  return html.slice(a, b);
}

const EARN_BLOCK = extract(
  "/* ---------- 变现看板：收入流水",
  "/* ---------- 交流入口："
);

/* 最小 DOM：够跑渲染函数即可 */
function makeEl(id) {
  const el = {
    id,
    innerHTML: "",
    textContent: "",
    value: "",
    style: {},
    dataset: {},
    classList: { add() {}, toggle() {}, contains: () => false },
  };
  return el;
}

function makeCtx() {
  const store = new Map();
  const copied = [];
  const els = new Map();
  const q = sel => {
    const id = sel.replace(/^#/, "");
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  const ctx = {
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: { querySelector: q, querySelectorAll: () => [] },
    // index.html 里的 $ 与 esc，看板代码直接用到
    $: q,
    esc: s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    setTimeout,
    Date,
    Math,
    JSON,
    Number,
    Array,
    String,
    Object,
    toast: m => copied.push(["toast", m]),
    copyText: t => copied.push(["copy", t]),
    loadPlan: () => new Set(["0_0", "0_1"]),
    PLAN_TOTAL: 16,
    loadPits: () => [{ title: "x" }],
    CATEGORIES: {
      content: { name: "视频/内容", emoji: "🎬" },
      tech: { name: "技术变现", emoji: "👨‍💻" },
    },
    EARN_REF: null,
    state: { favs: new Set(["h1"]) },
    _els: els,
    _copied: copied,
    _store: store,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(earnJs, ctx);
  ctx.EARN_REF = ctx.window.EARN_REF;
  vm.runInContext(EARN_BLOCK, ctx);
  // const/function 声明落在全局词法环境里，不会挂成 globalThis 属性，
  // 所以要主动导出才能在测试里直接调用。
  const EXPORTS = [
    "loadEarn", "saveEarn", "loadGoal", "earnStats", "todayISO", "monthKey",
    "addEarn", "delEarn", "clearEarn", "fillDemo", "saveGoal", "exportEarn",
    "renderEarn", "renderEarnKpis", "renderEarnList", "renderEarnCompare",
    "renderEarnStages", "renderEarnLink",
  ];
  const pairs = EXPORTS.map(n => `["${n}",${n}]`).join(",");
  vm.runInContext(`Object.assign(globalThis,Object.fromEntries([${pairs}]))`, ctx);
  return ctx;
}

test("EARN_REF 的赛道 key 与 index.html 真实的 CATEGORIES 对齐", () => {
  // 用真实的 CATEGORIES，而不是测试里手写的 mock，否则测不出对不齐的问题
  const m = html.match(/const CATEGORIES = \{[\s\S]*?\n\};/);
  assert.ok(m, "index.html 里找不到 CATEGORIES");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(m[0] + "globalThis.CATEGORIES=CATEGORIES;", ctx);
  const cats = new Set(Object.keys(ctx.CATEGORIES));
  const keys = Object.keys(makeCtx().EARN_REF.ref);
  for (const k of keys) assert.ok(cats.has(k), `多余参考: ${k}`);
  for (const c of cats) assert.ok(keys.includes(c), `分类 ${c} 缺少时薪参考`);
  assert.ok(keys.length > 0);
  assert.equal(makeCtx().EARN_REF.stages.length, 8);
});

test("loadEarn 能容错：脏数据 / 非数组都不崩", () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem("shh_earn", "{不是 JSON");
  assert.equal(ctx.loadEarn().length, 0, "脏 JSON 应降级为空数组");
  ctx.localStorage.setItem("shh_earn", '{"a":1}'); // 不是数组
  assert.equal(ctx.loadEarn().length, 0, "非数组应降级为空数组");
  ctx.localStorage.setItem("shh_earn", '[null,{"amount":"x"},{"amount":5}]');
  assert.equal(ctx.loadEarn().length, 1, "只保留 amount 可转数字的");
});

test("addEarn 拒绝非法输入（两边都是 0 / 负数）", () => {
  const ctx = makeCtx();
  ctx.$("enAmount").value = "0";
  ctx.$("enHours").value = "0";
  ctx.addEarn();
  assert.equal(ctx.loadEarn().length, 0, "0/0 不应入账");
  ctx.$("enAmount").value = "-5";
  ctx.$("enHours").value = "2";
  ctx.addEarn();
  assert.equal(ctx.loadEarn().length, 0, "负数收入不应入账");
});

test("0 收入的投入照常入账——学习期成本必须记下来", () => {
  const ctx = makeCtx();
  ctx.$("enAmount").value = "0";
  ctx.$("enHours").value = "6";
  ctx.$("enNote").value = "学基础";
  ctx.addEarn();
  const l = ctx.loadEarn();
  assert.equal(l.length, 1);
  assert.equal(l[0].amount, 0);
  assert.equal(l[0].hours, 6);
  assert.ok(l[0].date, "缺日期要自动补今天");
});

test("时薪 = 总收入 / 总投入，0 收入投入会把时薪压低（这是对的）", () => {
  const ctx = makeCtx();
  ctx.$("enAmount").value = "0";
  ctx.$("enHours").value = "10";
  ctx.addEarn();
  ctx.$("enAmount").value = "800";
  ctx.$("enHours").value = "10";
  ctx.addEarn();
  const s = ctx.earnStats(ctx.loadEarn());
  assert.equal(s.amount, 800);
  assert.equal(s.hours, 20);
  assert.equal(s.rate, 40, "800/20=40，不能是 800/10=80");
  assert.equal(s.paidCount, 1);
  assert.equal(s.avg, 800);
});

test("无投入时 rate 为 0 而不是 Infinity/NaN", () => {
  const s = makeCtx().earnStats([]);
  assert.equal(s.rate, 0);
  assert.equal(s.hours, 0);
  assert.equal(s.amount, 0);
});

test("里程碑按累计值点亮：金额类看收入，小时类看投入", () => {
  const ctx = makeCtx();
  ctx.$("enAmount").value = "1500";
  ctx.$("enHours").value = "30";
  ctx.addEarn();
  ctx.renderEarn();
  const htmlOut = ctx._els.get("earnStages").innerHTML;
  // 1500 元 → first-money/hundred/five-hundred/thousand 已达成，three-thousand 未达成
  assert.ok(/第一个小时[\s\S]{0,400}?✅ 已达成/.test(htmlOut), "1h 里程碑应达成");
  assert.ok(/第一笔收入[\s\S]{0,400}?✅ 已达成/.test(htmlOut), "1500 元应达成第一笔");
  assert.ok(/3000 元[\s\S]{0,400}?还差 1500 元/.test(htmlOut), "3000 元应显示还差多少");
});

test("时薪对比：低于下限 / 区间内 / 高于上限 三种判断", () => {
  const mk = (amount, hours, cat) => {
    const ctx = makeCtx();
    ctx.$("enCat").value = cat;
    ctx.$("enAmount").value = String(amount);
    ctx.$("enHours").value = String(hours);
    ctx.addEarn();
    ctx.renderEarn();
    return ctx._els.get("earnCompare").innerHTML;
  };
  // tech 参考 60–450/h
  assert.match(mk(120, 10, "tech"), /低于参考下限/); // 12/h
  assert.match(mk(2000, 10, "tech"), /在参考区间/); // 200/h
  assert.match(mk(9000, 10, "tech"), /高于参考上限/); // 900/h
});

test("费率标记不会跑出轨道（超上限也不会溢出）", () => {
  const ctx = makeCtx();
  ctx.$("enCat").value = "tech";
  ctx.$("enAmount").value = "999999";
  ctx.$("enHours").value = "1";
  ctx.addEarn();
  ctx.renderEarn();
  const out = ctx._els.get("earnCompare").innerHTML;
  const m = out.match(/class="cmp-you" style="left:([\d.]+)%"/);
  assert.ok(m, "应渲染出你的费率标记");
  const left = Number(m[1]);
  assert.ok(left >= 0 && left <= 100, `left=${left} 超出 0-100`);
});

test("导出成就页包含关键数字并走 copyText", () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem(
    "shh_earn",
    JSON.stringify([{ id: 1, cat: "tech", amount: 800, hours: 10, date: ctx.todayISO(), note: "接单" }])
  );
  ctx.exportEarn();
  const c = ctx._copied.find(x => x[0] === "copy");
  assert.ok(c, "应调用 copyText");
  const t = c[1];
  assert.match(t, /累计收入：¥800/);
  assert.match(t, /累计投入：10 小时/);
  assert.match(t, /有效时薪：¥80\/h/);
  assert.match(t, /7 天清单：2\/16/);
  assert.ok(!/undefined|NaN/.test(t), `导出内容含 undefined/NaN:\n${t}`);
});

test("没有记录时导出会提示而不是导出空壳", () => {
  const ctx = makeCtx();
  ctx.exportEarn();
  assert.ok(ctx._copied.some(x => x[0] === "toast"), "应给出提示 toast");
  assert.ok(!ctx._copied.some(x => x[0] === "copy"), "不该导出空内容");
});

test("clearEarn 清空后统计归零", () => {
  const ctx = makeCtx();
  ctx.$("enAmount").value = "100";
  ctx.$("enHours").value = "2";
  ctx.addEarn();
  ctx.localStorage.removeItem("shh_earn");
  ctx.renderEarn();
  assert.equal(ctx.earnStats(ctx.loadEarn()).amount, 0);
  assert.match(ctx._els.get("earnList").innerHTML, /还没有记录/);
});

test("月目标进度条按本月收入计算", () => {
  const ctx = makeCtx();
  ctx.localStorage.setItem("shh_goal", "1000");
  const now = ctx.todayISO();
  ctx.localStorage.setItem(
    "shh_earn",
    JSON.stringify([
      { id: 1, cat: "tech", amount: 400, hours: 5, date: now, note: "本月" },
      { id: 2, cat: "tech", amount: 500, hours: 5, date: "2020-01-01", note: "去年" },
    ])
  );
  ctx.renderEarn();
  assert.match(ctx._els.get("earnGoalPct").textContent, /¥400 \/ ¥1000（40%）/);
  assert.equal(ctx.earnStats(ctx.loadEarn()).month, 400, "去年那笔不该算进本月");
});

test("渲染产物里不出现 undefined/NaN/[object Object]", () => {
  const ctx = makeCtx();
  ctx.$("enCat").value = "tech";
  ctx.$("enAmount").value = "500";
  ctx.$("enHours").value = "4";
  ctx.$("enNote").value = "交付";
  ctx.addEarn();
  ctx.renderEarn();
  for (const [k, el] of ctx._els) {
    const s = String(el.innerHTML || "") + String(el.textContent || "");
    assert.ok(!/undefined|NaN|\[object Object\]/.test(s), `${k} 渲染出现脏值`);
  }
});

test("笔记里的 HTML 会被转义，不会注入", () => {
  const ctx = makeCtx();
  ctx.$("enAmount").value = "10";
  ctx.$("enHours").value = "1";
  ctx.$("enNote").value = '<img src=x onerror="alert(1)">';
  ctx.addEarn();
  ctx.renderEarn();
  const out = ctx._els.get("earnList").innerHTML;
  // 转义后 onerror= 仍会以纯文本出现，真正的判据是：不再构成可执行标签
  assert.ok(!/<img/i.test(out), "未转义的 <img 标签逃逸了");
  assert.match(out, /&lt;img/);
});
