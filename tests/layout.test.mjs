/**
 * 吸顶让位 · 全站自动审计
 *
 * 背景：header 是 position:sticky;top:0。任何同样吸顶到顶部的元素，如果
 * 自己的 top 写死 0，就会整条钻进 header 底下——页面上表现为「内容凭空消失」，
 * 而且不报任何错。.plan-bar（落地手册的 7 天清单）就是这么消失过一整轮。
 *
 * 这里不做点修，而是把规则本身变成可执行的约束：
 *   1) 全站每一条 position:sticky 都必须走 --sticky-top（header 本身除外）；
 *   2) --sticky-top 必须由 --header-h 派生——单一真相源，不允许第二份 calc；
 *   3) 锚点滚动用同一个 --sticky-top，和吸顶元素对齐到同一间隙；
 *   4) --header-h 只能写在媒体查询里（行内 style 写入会永久盖掉媒体查询）；
 *   5) 凡是真正改变头部高度属性的媒体查询，都必须同步 --header-h。
 *
 * 新增吸顶内容时，正确做法是 class="sticky-under"，裸写 position:sticky 会被本文件拦下。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
/* 从开标签「之后」切：否则第一对大括号会被配成 "<style> :root" */
const styleRaw = html.slice(
  html.indexOf("<style>") + "<style>".length,
  html.indexOf("</style>"),
);
/* 注释里为了解释原因而写的反例会误伤断言，先剔掉 */
const style = styleRaw.replace(/\/\*[\s\S]*?\*\//g, "");

/* 把内联样式摊平成 {selector, body} 列表。
   本项目样式表没有嵌套，@media 里的规则会被自然拍平——本审计只关心声明本身，
   不关心它属于哪个断点（断点相关的断言单独走 mediaBlocks）。 */
function rules(src) {
  const out = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2].trim() });
  }
  return out;
}
/* 带断点上下文的媒体查询块 */
function mediaBlocks(src) {
  return [...src.matchAll(/@media([^{]+)\{([\s\S]*?)\n\s*\}/g)].map(m => ({
    condition: m[1].trim(),
    body: m[2],
    selectors: rules(m[2]).map(r => r.selector),
  }));
}

const allRules = rules(style);
const medias = mediaBlocks(style);

const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

test("解析器本身靠谱：能拍平 @media 里的规则，且不把注释/开标签当规则", () => {
  assert.ok(allRules.length > 100, `只解析出 ${allRules.length} 条规则，正则多半坏了`);
  assert.ok(medias.length >= 4, `只解析出 ${medias.length} 个媒体查询`);
  assert.ok(
    !allRules.some(r => r.selector.includes("@media")),
    "@media 前缀泄漏进了选择器：拍平失败，下面的断言会在错误的粒度上运行",
  );
  assert.ok(
    !allRules.some(r => r.selector.includes("/*")),
    "注释没有被剔除干净",
  );
  assert.ok(
    !allRules.some(r => r.selector.includes("<style")),
    "开标签被当成了选择器的一部分（切片起点错了）",
  );
  // 拍平后应该能拿到只存在于媒体查询里的规则，否则等于没拍平
  assert.ok(
    allRules.some(r => r.selector === "body.nav-open"),
    "拍平结果里找不到媒体查询内部的规则，解析器没真的展开 @media",
  );
});

test("全站每条 position:sticky 都必须让开 header（header 本身除外）", () => {
  // 白名单里的两条是「贴顶」本身：header 自己，以及提供该行为的工具类。
  // .plan-bar 是当前唯一的消费者；以后新增吸顶内容应改用 .sticky-under。
  const ALLOWED = new Set(["header", ".sticky-under", ".plan-bar"]);
  const stickies = allRules.filter(r => /\bposition\s*:\s*sticky\b/.test(r.body));
  assert.ok(stickies.length >= 2, `只找到 ${stickies.length} 条 sticky，解析可能失效`);

  for (const r of stickies) {
    assert.ok(
      ALLOWED.has(r.selector),
      `${r.selector} 裸写了 position:sticky。改用 class="sticky-under"，` +
        `或至少 top:var(--sticky-top)`,
    );
    if (r.selector === "header") {
      assert.equal(decl(r.body, "top"), "0", "header 自己就该贴顶");
      continue;
    }
    const top = decl(r.body, "top");
    assert.ok(
      top === "var(--sticky-top)" || /var\(--header-h\)/.test(top || ""),
      `${r.selector} 吸顶后会被 header 盖住：top=${top}`,
    );
  }
});

test("吸顶的 fixed 元素也不能顶到 header 底下", () => {
  // 整屏遮罩（inset:0）和底部 toast 不受影响，这里只抓「顶部锚定」的 fixed
  for (const r of allRules.filter(x => /\bposition\s*:\s*fixed\b/.test(x.body))) {
    const top = decl(r.body, "top");
    if (top === null) continue; // inset:0 之类的整屏定位
    assert.ok(
      top === "0" || /var\(--sticky-top\)|var\(--header-h\)/.test(top),
      `${r.selector} 是顶部锚定的 fixed，top=${top} 会被 header 盖住`,
    );
  }
});

test("--sticky-top 由 --header-h 派生：全站只有一份让位表达式", () => {
  const root = allRules.find(r => r.selector === ":root");
  assert.ok(root, "找不到 :root");
  const headerH = decl(root.body, "--header-h");
  const stickyTop = decl(root.body, "--sticky-top");
  const stickyGap = decl(root.body, "--sticky-gap");
  assert.match(headerH || "", /^\d+px$/, "--header-h 必须是具体像素，不能是 auto/未知值");
  assert.match(stickyGap || "", /^\d+px$/, "--sticky-gap 必须是具体像素");
  assert.equal(
    stickyTop,
    "calc(var(--header-h) + var(--sticky-gap))",
    "--sticky-top 必须由 --header-h 派生；另起一份 calc 就是「日后改间隙漏改一处」的起点",
  );

  // 不允许在别处重新手写一遍让位表达式
  const handWritten = allRules.filter(
    r => /calc\(var\(--header-h\)/.test(r.body),
  );
  assert.deepEqual(
    handWritten.map(r => r.selector),
    [":root"],
    "让位表达式只允许出现在 :root 里定义一次",
  );
});

test("锚点滚动与吸顶元素对齐到同一个间隙", () => {
  const htmlRule = allRules.find(r => r.selector === "html");
  assert.ok(htmlRule, "找不到 html 规则");
  assert.equal(
    decl(htmlRule.body, "scroll-padding-top"),
    "var(--sticky-top)",
    "锚点滚动要和吸顶元素用同一个 --sticky-top，否则标题会落在 header 底下或多留一段空隙",
  );
});

test(".sticky-under 工具类存在且已正确接线", () => {
  const u = allRules.find(r => r.selector === ".sticky-under");
  assert.ok(u, "缺少 .sticky-under 工具类，以后新增吸顶内容只能裸写 position:sticky");
  assert.equal(decl(u.body, "position"), "sticky");
  assert.equal(decl(u.body, "top"), "var(--sticky-top)");
  assert.ok(
    /--sticky-gap/.test(style),
    "工具类要能靠内联 --sticky-gap 覆盖间隙，否则不同场景只能各写一条规则",
  );
});

test("--header-h 只能写在媒体查询里，不能由 JS 写进行内 style", () => {
  const inlineWrites = [...html.matchAll(/setProperty\(\s*["']--header-h/g)];
  assert.deepEqual(
    inlineWrites.map(m => m[0]),
    [],
    "行内 style 一旦写入就会永久盖掉媒体查询，--header-h 必须纯 CSS 驱动",
  );
  const inScript = html
    .slice(html.indexOf("<script>", html.indexOf("</style>")))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/--header-h\s*:/.test(inScript),
    "JS 里出现 --header-h 赋值会盖掉媒体查询的断点值",
  );
});

test("凡是真正改变头部高度属性的断点，都必须同步 --header-h", () => {
  // 只看「真的决定高度」的属性。max-width:400px 那块只缩了 logo 字号、
  // 藏了 GitHub 按钮、调了 gap，而 .nav 的 min-height 仍然生效（实测 56.7px，
  // 与 1023 断点声明的 57px 只差亚像素），所以它不该被算进来——
  // 否则测试会教人「看到几何就补一行」，补着补着就没人信它了。
  const HEIGHT_CHANGING = [
    { re: /^\.nav\{[^}]*\b(min-height|height|padding)\b/, why: "改了 .nav 的高度/内边距" },
    { re: /^header\{[^}]*\b(min-height|height|padding)\b/, why: "改了 header 的高度/内边距" },
    { re: /^\.nav-burger\{[^}]*\bdisplay\b/, why: "☰ 从隐藏变成显示，头部重排" },
    { re: /^nav\.tabs\{[^}]*\b(display|flex|order)\b/, why: "标签行换行/隐藏方式变了，头部高度随之变" },
  ];

  for (const mq of medias) {
    const offenders = mq.selectors.filter(sel =>
      HEIGHT_CHANGING.some(h => h.re.test(sel)),
    );
    if (offenders.length === 0) continue;
    assert.ok(
      mq.body.includes("--header-h"),
      `@media${mq.condition} 里 ${offenders.join("、")} 改变了头部高度，` +
        `但没同步 --header-h——吸顶元素会错位`,
    );
  }
});

test("--header-h 必须与同一断点下的 .nav 高度一致（防陈旧值）", () => {
  // 上一条只能保证「改高度时写了 --header-h」，管不住「改了却沿用旧值」。
  // 这里把两个数绑在一起：头部实际高度 = .nav 的 min-height + header 的下边框
  // （*{box-sizing:border-box}，所以 padding 已经在 min-height 里面了）。
  const baseNav = allRules.find(r => r.selector === ".nav");
  const baseMinH = parseInt(decl(baseNav.body, "min-height"), 10);
  const headerRule = allRules.find(r => r.selector === "header");
  const borderM = decl(headerRule.body, "border-bottom").match(/(\d+)px/);
  const borderW = parseInt(borderM[1], 10);
  assert.ok(baseMinH > 0 && borderW >= 0, "解析 header 下边框宽度失败");

  for (const mq of medias) {
    if (!mq.body.includes("--header-h")) continue;
    const own = mq.selectors
      .map(s => rules(mq.body).find(r => r.selector === s))
      .find(r => r && r.selector === ".nav" && decl(r.body, "min-height"));
    const effective = own ? parseInt(decl(own.body, "min-height"), 10) : baseMinH;
    const declared = parseInt(mq.body.match(/--header-h:\s*(\d+)px/)[1], 10);
    assert.ok(
      Math.abs(declared - effective) <= borderW,
      `@media${mq.condition} 里 --header-h:${declared}px，但该断点下 .nav 实际是 ` +
        `${effective}px（+${borderW}px 边框）。留着旧值会让吸顶元素错位`,
    );
  }
});

test("三个头部形态的 --header-h 都与实测一致（回归护栏）", () => {
  const wide = medias.find(m => /min-width:1374px/.test(m.condition));
  const narrow = medias.find(m => /max-width:1023px/.test(m.condition));
  assert.ok(wide && narrow, "缺少宽屏/窄屏断点");
  assert.match(wide.body, /--header-h:64px/, "宽屏单行头部实测 65px（含边框），应声明 64px");
  assert.match(narrow.body, /--header-h:57px/, "手机形态头部实测 57px");
  // 窄屏必须早于宽屏生效，否则 1024~1373px 会命中宽屏单行却仍是两行布局
  assert.ok(
    parseInt(narrow.condition.match(/max-width:(\d+)/)[1], 10) <
      parseInt(wide.condition.match(/min-width:(\d+)/)[1], 10),
    "窄屏断点必须小于宽屏断点，否则中间那段宽度会拿到错误的 --header-h",
  );
});
