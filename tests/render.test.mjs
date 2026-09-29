/* ============================================================================
 * 渲染层回归测试 · 「真的跑一遍渲染函数」
 *
 * 为什么需要这个文件：仓库里已经有 227 个纯函数测试，但它们测不到渲染层。
 * 实际踩到的坑就长这样——
 *   ${gap.extra?" · "+esc(g.extra):""}     // 条件读 gap，值却读 g
 * 条件成立、表达式不报错、页面照常渲染，只是**默默多出���个 undefined**。
 * 纯函数测试全绿，浏览器里看得到，人类要盯着才看得出来。
 *
 * 所以这里换个思路：不静态分析，直接把 index.html 里的渲染函数抠出来，
 * 配一套极小的 DOM 桩（只要 innerHTML 和 textContent），真调一次，
 * 然后断言产物里没有 undefined / NaN / [object Object]。
 *
 * 桩写得极简是有意的：它一旦变复杂，就会变成一个要维护的假浏览器。
 * 只需要能接住 innerHTML 赋值就行。
 * ========================================================================== */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");

/* 从 index.html 里按名字抠出一个顶层 function 声明的源码。
   括号配对是自己数的，因为这个站没有构建步骤、没有 parser 依赖。 */
function grabFn(name) {
  const at = html.indexOf("function " + name + "(");
  assert.ok(at >= 0, "index.html 里找不到 " + name);
  let i = html.indexOf("{", at);
  let depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") {
      depth--;
      if (depth === 0) return html.slice(at, j + 1);
    }
  }
  throw new Error(name + " 的大括号没配平");
}

/* 抠出一个顶层 const 声明的值。渲染函数会引用同文件里的常量
   （如 renderRzResult 读 RZ_FIELDS），只抠函数必然 ReferenceError。 */
function grabConst(name) {
  const at = html.indexOf("const " + name + "=");
  assert.ok(at >= 0, "index.html 里找不到 const " + name);
  let i = html.indexOf("[", at);
  let depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "[") depth++;
    else if (html[j] === "]") {
      depth--;
      if (depth === 0) return vm.runInNewContext(html.slice(at, j + 1) + ";" + name);
    }
  }
  throw new Error(name + " 的方括号没配平");
}

/** 极简 DOM 桩：任何 querySelector 都返回同一个可写的盒子。 */
function makeBox(id) {
  return { id, innerHTML: "", textContent: "", value: "", options: { length: 0 }, style: {} };
}

function harness(ids, extraGlobals = {}) {
  const boxes = {};
  for (const id of ids) boxes[id] = makeBox(id);
  const ctx = {
    window: null,
    document: {
      querySelector: (s) => boxes[String(s).replace(/^#/, "")] || null,
      querySelectorAll: () => [],
      getElementById: (id) => boxes[id] || null,
    },
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    console,
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    ...extraGlobals,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx, boxes };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* 真加载 rules-core，别在测试里重写一份——测的必须是页面实际用的那份 */
globalThis.window = globalThis;
const RULES_CORE = (await import("../data/rules-core.js")).default || (await import("../data/rules-core.js"));
const LEARN_CORE = (await import("../data/learn-core.js")).default || (await import("../data/learn-core.js"));

/* ---------------------------------------------------------------------------
 * 1. 门槛渲染：这是实际踩坑的那个函数
 *    gate 对象（g）和 gateGap 结果（gap）字段名很像，条件读 gap、值读 g
 *    就是这么来的。所以这个测试直接盯产物里有没有 undefined。
 * ------------------------------------------------------------------------- */
test("renderRzGates 产物里没有 undefined（回归：g.extra vs gap.extra）", () => {
  const { ctx, boxes } = harness(["rzGates"], {
    $: (s) => ctx.document.querySelector(s),
    esc,
    rzStore: () => ({ followers: "1200" }),
    rzPlatform: () => "douyin",
    RULES_CORE,
  });
  vm.runInContext(grabFn("renderRzGates"), ctx);

  ctx.renderRzGates();
  const html = boxes.rzGates.innerHTML;

  assert.ok(html.length > 0, "至少要渲染出东西");
  assert.ok(!/undefined/.test(html), "门槛条里出现了 undefined：" + html.slice(0, 200));
  assert.ok(!/NaN/.test(html), "门槛条里出现了 NaN");
  assert.ok(html.indexOf("另需累计播放 17000") >= 0, "有额外条件的门槛应把额外条件显示出来");
  assert.ok(html.indexOf("http") >= 0, "每条门槛必须带官方核验链接");
});

test("renderRzGates 在粉丝为 0 时也不产生 NaN 宽度", () => {
  const { ctx, boxes } = harness(["rzGates"], {
    $: (s) => ctx.document.querySelector(s),
    esc,
    rzStore: () => ({}),
    rzPlatform: () => "wechat",
    RULES_CORE,
  });
  vm.runInContext(grabFn("renderRzGates"), ctx);
  ctx.renderRzGates();
  assert.ok(!/NaN/.test(boxes.rzGates.innerHTML));
  assert.ok(!/undefined/.test(boxes.rzGates.innerHTML));
});

/* ---------------------------------------------------------------------------
 * 2. 诊断结果渲染：输入全部是用户手打的脏字符串
 * ------------------------------------------------------------------------- */
function renderRzResultWith(raw) {
  const { ctx, boxes } = harness(["rzResult", "rzGates", "rulesDate"], {
    $: (s) => ctx.document.querySelector(s),
    esc,
    rzStore: () => raw,
    rzPlatform: () => "douyin",
    renderRzGates: () => {},
    RZ_FIELDS: grabConst("RZ_FIELDS"),
    RULES_CORE,
  });
  vm.runInContext(grabFn("renderRzResult"), ctx);
  ctx.renderRzResult();
  return boxes.rzResult.innerHTML;
}

test("renderRzResult 对乱填输入不产出 undefined / NaN", () => {
  const out = renderRzResultWith({
    posts: "abc", finish: "百分之十二", followers: "1.2k", views: "1,200",
  });
  assert.ok(!/undefined/.test(out), "出现了 undefined：" + out.slice(0, 200));
  assert.ok(!/NaN/.test(out), "出现了 NaN");
  assert.ok(!/\[object Object\]/.test(out), "出现了 [object Object]");
});

test("renderRzResult 空表单不给结论（避免对着空白说「你没病」）", () => {
  assert.equal(renderRzResultWith({}).trim(), "");
});

test("renderRzResult 会点名没填的项，而不是默认可疑", () => {
  const out = renderRzResultWith({ posts: "12", recent7: "1" });
  assert.ok(out.indexOf("没填不等于没问题") >= 0, "缺字段时必须说明「没填≠没问题」");
  assert.ok(!/undefined/.test(out) && !/NaN/.test(out));
});

/* ---------------------------------------------------------------------------
 * 4. 页面与引擎的默认值必须一致
 *
 * 实际踩到的：norm() 猜 niches=1，页面 select 却选中「4 个以上」。
 * 两边各自都「有道理」，合起来就是用户什么都没填也会被报垂直度不合格。
 * 引擎测试测不到（它只看 norm），渲染测试也测不到（它 stub 掉了 #rzNiche），
 * 所以这里直接拿真实的 <select> 来测接线。
 * ------------------------------------------------------------------------- */

test("赛道 select 的默认项是「说不清」，不是最差的那个", () => {
  const at = html.indexOf('id="rzNiche"');
  assert.ok(at >= 0, "页面里找不到 #rzNiche");
  const block = html.slice(at, html.indexOf("</select>", at));
  const selected = block.match(/<option value="([^"]*)"\s+selected/);
  assert.ok(selected, "#rzNiche 必须有 selected 项，否则默认行为不确定");
  assert.equal(selected[1], "", "默认必须落在「说不清」上；选中「4 个以上」等于还没问就指控用户");
});

test("renderRzResult 不把空赛道数偷偷填成 1（||1 会让「不知道」变「你聚焦」）", () => {
  const src = grabFn("renderRzResult");
  assert.ok(
    /niches:\(\$\("#rzNiche"\)\|\|\{\}\)\.value\}/.test(src),
    "niches 必须原样传递空值；出现 ||1 就会把「不知道」改写成「1 个赛道」",
  );
});

test("赛道数没选时，诊断不会把它列成「已填」，反而会点名它没填", () => {
  const { ctx, boxes } = harness(["rzResult", "rzGates", "rzNiche"], {
    $: (s) => ctx.document.querySelector(s),
    esc,
    rzStore: () => ({ posts: "20", best: "100" }),
    rzPlatform: () => "douyin",
    renderRzGates: () => {},
    RZ_FIELDS: grabConst("RZ_FIELDS"),
    RULES_CORE,
  });
  boxes.rzNiche.value = ""; // 用户没选
  vm.runInContext(grabFn("renderRzResult"), ctx);
  ctx.renderRzResult();
  const out = boxes.rzResult.innerHTML;
  assert.ok(out.indexOf("同时在做几个赛道") >= 0, "赛道数没选时必须在未填清单里被点名");
  assert.ok(!/垂直度闸/.test(out), "不知道赛道数时不能报垂直度闸（凭空指控）");
});

/* ---------------------------------------------------------------------------
 * 3. 通用不变量：所有渲染函数都不能把 undefined 吐到页面上
 *    这条是给以后新写的渲染函数兜底的。人工列出的函数名，故意不用自动扫描——
 *    自动扫会把辅助函数也扫进来，而辅助函数不产 HTML，误报会让人不再看这条。
 * ------------------------------------------------------------------------- */
const RENDERERS = ["renderRzGates", "renderRzResult", "renderQa"];

test("所有已登记的渲染函数都能在桩环境里被抠出来（防止改名后测试静默失效）", () => {
  for (const name of RENDERERS) {
    assert.ok(grabFn(name).length > 20, name + " 抠出来的源码太短，可能抠错了");
  }
});
