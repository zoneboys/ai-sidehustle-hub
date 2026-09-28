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
/* 做「禁止出现某个写法」的断言前先剔注释：注释里为了解释原因而写的反例会误伤 */
const bare = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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

test("宽屏放得下就收成单行——两行里第一行只剩 logo 和按钮，中间空 890px", () => {
  const mq = style.match(/@media\(min-width:1374px\)\{[\s\S]*?\n  \}/);
  assert.ok(mq, "缺少宽屏单行媒体查询");
  assert.match(mq[0], /nav\.tabs\{flex:1 1 auto/, "单行时标签要参与同一行的弹性分配；写死 flex:1 0 100% 会永远强制换行");
  assert.match(mq[0], /order:0/, "单行时标签要回到 logo 和按钮之间，order:2 会把它甩到第二行");
  assert.match(mq[0], /:root\{--header-h:64px\}/, "单行形态头部只有 64px，--header-h 必须跟着改");
  assert.ok(
    !/flex-wrap:nowrap/.test(mq[0]),
    "不要在宽屏锁 nowrap：用户放大字号时应该折行，而不是横向溢出",
  );
});

test("吸顶元素要给 header 让位，否则整条钻进 header 底下看不见", () => {
  assert.match(style, /:root\{[\s\S]*?--header-h:102px/, "根上要有 --header-h 基线，取两行形态的值");
  assert.match(
    style,
    /html\{[^}]*scroll-padding-top:calc\(var\(--header-h\)/,
    "锚点滚动要避开吸顶的 header，否则跳过去的标题正好落在它下面",
  );
  const pb = style.match(/\.plan-bar\{[^}]*\}/);
  assert.ok(pb, "找不到 .plan-bar（7 天清单）");
  assert.ok(!/top:0[;}]/.test(pb[0]), "7 天清单写死 top:0，吸顶后会整条藏到 header 后面");
  assert.match(pb[0], /top:calc\(var\(--header-h\)/, "7 天清单要按 --header-h 让位");
});

test("抽屉展开时锁住背景滚动", () => {
  const mq = style.match(/@media\(max-width:1023px\)\{[\s\S]*?\n  \}/);
  assert.ok(mq, "缺少窄屏媒体查询");
  assert.match(
    mq[0],
    /body\.nav-open\{overflow:hidden\}/,
    "抽屉开着时背景还能滑，手指一划就误触到下面的内容",
  );
  assert.match(mq[0], /:root\{--header-h:57px\}/, "手机形态头部 57px，--header-h 要对齐");
});

test("断点只在 CSS 和 JS 里各写一次，且 JS 走同源判定", () => {
  assert.match(
    bare,
    /matchMedia\("\(min-width:1024px\)"\)/,
    "JS 应复用与媒体查询同源的 matchMedia，而不是自己算 innerWidth",
  );
  assert.ok(
    !/innerWidth\s*>\s*1023/.test(bare),
    "别在 JS 里另写一个阈值：它与媒体查询在亚像素宽度上判定不一致，会残留一个盖住的抽屉",
  );
});

/* ---------- 行为层：跑 index.html 里真实的抽屉逻辑 ---------- */

function extract(startMark, endMark) {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark, a);
  assert.ok(a > 0 && b > a, `找不到代码块: ${startMark}`);
  return html.slice(a, b);
}
const NAV_JS = extract("function closeNav(){", "window.switchView=switchView;");

function makeCtx({ withBurger = true, wide = false } = {}) {
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
  // 抽屉里的第一个 tab：openNav 要把焦点移进来
  const firstTab = {
    focused: false,
    focus(o) { this.focused = true; this.focusOpts = o; ctx.document.activeElement = this; },
    closest: s => (s === "#tabs" ? {} : null), // 在抽屉里 → 焦点会随抽屉消失
  };
  const burger = withBurger
    ? {
        id: "navBurger",
        textContent: "☰",
        attrs: {},
        focused: false,
        setAttribute(k, v) { this.attrs[k] = v; },
        focus(o) { this.focused = true; this.focusOpts = o; },
      }
    : null;
  const body = {
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
    },
  };
  // 与 CSS 同源的断点对象：wide=true 表示当前是桌面形态（没有抽屉）
  const wideScreen = { matches: wide, addEventListener() {} };
  const ctx = {
    console,
    document: {
      body,
      activeElement: body, // 焦点在 body 上 = 焦点会随抽屉消失，应该交还给 ☰
      querySelector: s => (s === "#navBurger" ? burger : s === "nav.tabs .tab" ? firstTab : null),
      querySelectorAll: () => [],
    },
    scrollTo() {}, // switchView 会调 window.scrollTo；下面 ctx.window = ctx，故需挂在顶层
    state: { view: "home" },
    wideScreen,
    $: s => (s === "#navBurger" ? burger : null),
    $$: sel => (sel === ".tab" ? tabs : sections),
    renderFavs() {}, renderMatch() {}, renderPlaybooks() {}, renderPlan() {},
    renderPits() {}, renderEarn() {}, renderIndie() {},
    _classes: classes, _burger: burger, _tabs: tabs, _firstTab: firstTab,
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

test("openNav 把焦点移进抽屉，closeNav 交还给 ☰", () => {
  const c = makeCtx();
  c.openNav();
  assert.equal(c._firstTab.focused, true, "打开后焦点应落在抽屉第一项，否则 Tab 键会跑到被遮挡的内容上");
  // 注意：不能对 focus 参数用 deepStrictEqual——vm 内构造的对象与本 realm 原型不同，必然不等
  assert.equal(c._firstTab.focusOpts?.preventScroll, true, "focus 要带 preventScroll，否则会把页面拽上去");
  c.closeNav();
  assert.equal(c._burger.focused, true, "关闭后焦点应交还给触发它的 ☰");
  assert.equal(c._burger.focusOpts?.preventScroll, true);
});

test("点搜索框收起抽屉时不能把焦点抢走——否则用户根本打不了字", () => {
  const c = makeCtx();
  c.openNav();
  // 模拟：用户点了顶部搜索框（焦点在输入框上），document 点击处理器收起抽屉
  c.document.activeElement = { tagName: "INPUT", closest: () => null };
  c.closeNav();
  assert.equal(c._classes.has("nav-open"), false, "抽屉还是应该收起");
  assert.equal(c._burger.focused, false, "焦点在可交互元素上时不能抢回 ☰，否则输入框会失焦");
});

test("桌面形态下 openNav 拒绝打开，并顺手清掉残留的 nav-open", () => {
  const c = makeCtx({ wide: true });
  c.document.body.classList.add("nav-open"); // 模拟窄屏开过、但没收到 resize 事件
  assert.equal(c._classes.has("nav-open"), true);
  assert.equal(c.openNav(), false, "桌面没有抽屉，不该打开");
  assert.equal(c._classes.has("nav-open"), false, "残留的 class 必须清掉");
  c.toggleNav();
  assert.equal(c._classes.has("nav-open"), false, "否则拉回窄屏时 ☰ 第一次点击只会把已关的抽屉再关一次");
});
