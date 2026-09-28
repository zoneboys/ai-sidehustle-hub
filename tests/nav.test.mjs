/**
 * 顶部导航 · 测试
 *
 * 分两层：
 *   1) 结构层：直接读 index.html，验证「10 个栏目不会被静默截断」。
 *      曾经的 bug 是 nav.tabs 用了 overflow-x:auto 又把滚动条 display:none，
 *      1280px 下最后两个栏目直接消失且毫无提示——用户只会以为「网站坏了」。
 *   2) 行为层：把 index.html 里真实的 openNav/closeNav/switchView 抽进 vm 跑，
 *      验证窄屏抽屉的开合、幂等性，以及切视图后自动收起。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const NAV_HTML = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf("</nav>"));
const tabViews = [...NAV_HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]);

/* ---------- 结构层 ---------- */

test("导航栏目与视图一一对应：不多、不少、不重复", () => {
  assert.equal(tabViews.length, 10, "应有 10 个栏目 tab");
  assert.equal(new Set(tabViews).size, 10, "data-view 不能重复，否则点第二个会切到同一个视图");
  for (const v of tabViews) {
    assert.ok(html.includes(`id="view-${v}"`), `tab 指向了不存在的视图 #view-${v}`);
  }
  const sectionIds = [...html.matchAll(/<section class="view[^"]*" id="view-([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(
    [...new Set(sectionIds)].sort(),
    [...tabViews].sort(),
    "存在没有导航入口的孤儿视图（用户找不到）"
  );
});

test("每个 tab 都有可见文字，不能是空按钮", () => {
  const labels = [...NAV_HTML.matchAll(/<button class="tab[^"]*"[^>]*>([^<]*)</g)].map(m => m[1].trim());
  assert.equal(labels.length, tabViews.length, "标签数与 tab 数对不上");
  labels.forEach((l, i) => assert.ok(l.length >= 2, `第 ${i + 1} 个 tab 文案为空（${tabViews[i]}）`));
});

test("☰ 按钮存在、可访问、且在 .nav-actions 里", () => {
  const burger = html.match(/<button class="nav-burger"[^>]*>/);
  assert.ok(burger, "缺少 .nav-burger 按钮");
  assert.match(burger[0], /id="navBurger"/, "☰ 按钮缺 id");
  assert.match(burger[0], /aria-controls="tabs"/, "☰ 按钮应声明它控制哪个区域");
  assert.match(burger[0], /aria-expanded="false"/, "初始态应向读屏软件声明为收起");
  const start = html.indexOf('<div class="nav-actions">');
  const actions = html.slice(start, html.indexOf("</div>", start));
  assert.ok(actions.includes("navBurger"), "☰ 必须在 .nav-actions 内，否则窄屏会被一起挤没");
});

test("导航不再用「隐藏滚动条的横向滚动」——那会静默截断栏目", () => {
  assert.ok(!/nav\.tabs\{[^}]*overflow-x:auto/.test(style), "nav.tabs 不应再有 overflow-x:auto");
  assert.ok(!/nav\.tabs::-webkit-scrollbar/.test(style), "不应再把滚动条藏起来");
  assert.match(style, /\.nav\{[^}]*flex-wrap:wrap/, "桌面需要 flex-wrap:wrap 才能换行");
  assert.match(style, /\.nav\{[^}]*min-height:/, "要用 min-height，改固定 height 换行时会被裁掉");
});

test("窄屏有下拉面板规则，且复用同一批 tab 按钮（不复制第二份）", () => {
  assert.match(style, /body\.nav-open nav\.tabs\{/, "缺少抽屉展开态");
  assert.match(style, /body\.nav-open nav\.tabs \.tab\{/, "抽屉里的 tab 没有撑满");
  const mq = style.match(/@media\(max-width:1023px\)\{[\s\S]*?\n  \}/);
  assert.ok(mq, "缺少窄屏媒体查询");
  assert.match(mq[0], /nav\.tabs\{display:none\}/, "窄屏应隐藏内联导航");
  assert.match(mq[0], /\.nav-burger\{display:flex\}/, "窄屏应显示 ☰");
  // 只允许一套 <button class="tab">，保证桌面行与抽屉的选中态不会不同步
  assert.equal(NAV_HTML, html.slice(html.indexOf('<nav class="tabs"'), html.indexOf("</nav>")));
  assert.equal((html.match(/<nav class="tabs"/g) || []).length, 1, "不允许出现第二个导航容器");
});

/* ---------- 行为层：跑 index.html 里真实的抽屉逻辑 ---------- */

function extract(startMark, endMark) {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark, a);
  assert.ok(a > 0 && b > a, `找不到代码块: ${startMark}`);
  return html.slice(a, b);
}
const NAV_JS = extract("function closeNav(){", "window.switchView=switchView;");

function makeCtx({ withBurger = true } = {}) {
  const classes = new Set();
  // 每个 tab 需独立的 classList：真实 DOM 里 toggle(false) 只影响自己那个元素，
  // 若共用一个集合，后面的未选中 tab 会把已选中的抹掉。
  const mk = v => {
    const own = new Set();
    return {
      dataset: { view: v },
      classList: { toggle: (c, add) => (add ? own.add(c) : own.delete(c)) },
      has: c => own.has(c),
    };
  };
  const tabs = tabViews.map(mk);
  const sections = tabViews.map(v => ({ id: "view-" + v, classList: { toggle: () => {} } }));
  const burger = withBurger
    ? { textContent: "☰", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }
    : null;
  const body = {
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
    },
  };
  const ctx = {
    console,
    document: { body, querySelector: s => (s === "#navBurger" ? burger : null), querySelectorAll: () => [] },
    scrollTo() {}, // switchView 会调 window.scrollTo；下面 ctx.window = ctx，故需挂在顶层
    state: { view: "home" },
    $: s => (s === "#navBurger" ? burger : null),
    $$: sel => (sel === ".tab" ? tabs : sections),
    renderFavs() {}, renderMatch() {}, renderPlaybooks() {}, renderPlan() {},
    renderPits() {}, renderEarn() {}, renderIndie() {},
    _classes: classes, _burger: burger, _tabs: tabs,
    _activeTab: () => (tabs.find(t => t.has("active")) || {}).dataset?.view || null,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(NAV_JS, ctx);
  // const/function 声明落在全局词法环境里，不会挂成 globalThis 属性，要主动导出
  vm.runInContext("Object.assign(globalThis,{openNav,closeNav,toggleNav,switchView})", ctx);
  return ctx;
}

test("openNav：加 class、图标变 ✕、同步 aria-expanded", () => {
  const c = makeCtx();
  c.openNav();
  assert.equal(c._classes.has("nav-open"), true);
  assert.equal(c._burger.textContent, "✕");
  assert.equal(c._burger.attrs["aria-expanded"], "true");
});

test("closeNav：完全还原，且重复调用不报错（幂等）", () => {
  const c = makeCtx();
  c.openNav();
  assert.equal(c.closeNav(), true, "从打开态关闭应返回 true");
  assert.equal(c._classes.has("nav-open"), false);
  assert.equal(c._burger.textContent, "☰");
  assert.equal(c._burger.attrs["aria-expanded"], "false");
  assert.equal(c.closeNav(), false, "已经关着时再关应返回 false 而不是抛错");
  assert.equal(c.closeNav(), false);
});

test("toggleNav：反复点击来回切换", () => {
  const c = makeCtx();
  for (let i = 0; i < 3; i++) {
    c.toggleNav();
    assert.equal(c._classes.has("nav-open"), true, `第 ${i + 1} 次点开失败`);
    c.toggleNav();
    assert.equal(c._classes.has("nav-open"), false, `第 ${i + 1} 次关上失败`);
  }
});

test("switchView 自动收起抽屉——否则在手机上点完栏目菜单还盖着", () => {
  const c = makeCtx();
  c.openNav();
  c.switchView("indie");
  assert.equal(c._classes.has("nav-open"), false, "切视图后抽屉没收起");
  assert.equal(c._burger.textContent, "☰");
  assert.equal(c.state.view, "indie");
  assert.equal(c._activeTab(), "indie", "应恰好只有目标 tab 被标记为选中");
  // 切回首页也照常收起（幂等路径）
  c.switchView("home");
  assert.equal(c._classes.has("nav-open"), false);
  assert.equal(c.state.view, "home");
  assert.equal(c._activeTab(), "home", "旧的选中态必须被清掉");
});

test("开关不存在时不崩（降级：抽屉打不开也别白屏）", () => {
  const c = makeCtx({ withBurger: false });
  c.openNav();
  assert.equal(c._classes.has("nav-open"), true);
  assert.equal(c.closeNav(), true);
  assert.equal(c._classes.has("nav-open"), false);
  c.switchView("jobs");
  assert.equal(c.state.view, "jobs");
});
