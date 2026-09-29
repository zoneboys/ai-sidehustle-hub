// 对比度回归测试
//
// 为什么要有这个：深色主题下 --primary/--ok/--hot 会被调亮以保证「色块本身在深底上可见」，
// 于是「白字压实心色」会静默失效。之前答题区就踩了这个坑：底色写死 #ecfdf5/#fef2f2，
// 而 var(--text) 在深色下是近白的 #e7eaf3，对比度 1.1:1，整段讲解在屏幕上等于消失。
//
// 这里做的是把「看起来对」换成「算出来对」：把全站 CSS 里每条能解析的
// 「文字压底色」在**两个主题**下都算一遍对比度，任何一条低于 4.5 就红。
// 配套的不变量：变量块之外不允许出现字面 hex —— 否则某条规则可能因为
// 解析不了而被静默跳过，审计就成了空转。

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
// 注释里会出现 @media、{、}、字面 hex…… 不先剥掉，注释就会被当成选择器粘在规则上，
// 「首个 @media」也会被注释里的那个骗到（实测 baseCss 被截到 1KB，78 条规则全部查不到祖先）。
const css = html
  .split("<style>")[1]
  .split("</style>")[0]
  .replace(/\/\*[\s\S]*?\*\//g, "");

const decl = (body) => {
  const out = {};
  // 必须能收数字：--primary2 / --header-h 这类变量名
  for (const m of body.matchAll(/(--?[a-z0-9-]+|[a-z-]+)\s*:\s*([^;}]+)/gi)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const lum = (h) => {
  const c = hex(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) =>
  +(((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)).toFixed(2));

// 括号感知的顶层逗号切分。用正则切会被 var()/color-mix() 内部的逗号骗到，
// 而这个解析器的正确性直接决定审计是不是空转，所以宁可写笨一点。
function topSplit(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const fnArgs = (s) => topSplit(s.slice(s.indexOf("(") + 1, s.lastIndexOf(")")));

// 解析成该主题下的具体颜色数组；null = 解析不了（调用方须跳过，且须由不变量测试兜底）
function resolve(val, tv, depth = 0) {
  if (!val || depth > 6) return null;
  const p = val.trim();
  // transparent / none 都视作卡片底：徽章、标签、关闭按钮都是浮在卡片上的，
  // 按「背后是 --card」计算，而不是直接跳过——否则这些控件就没人管了。
  if (p === "none" || p === "transparent") return [tv["--card"]];
  // color-mix 两种写法都要认：
  //   color-mix(in srgb, <颜色> <百分比>, <底色>)   ← 站内实际用的
  //   color-mix(in srgb, <颜色>, <百分比> <底色>)
  // 百分比可能紧跟在颜色后面，必须先剥离再解析颜色，否则 var(--ok) 12% 解析不出来。
  const cm = p.match(/^color-mix\(in srgb,\s*(.+?)\s*,(.+)\)$/);
  if (cm) {
    const strip = (s) => {
      const t = s.trim();
      const pre = t.match(/^([\d.]+)%\s*(.+)$/);   // 12% var(--ok)
      if (pre) return { pct: +pre[1] / 100, color: pre[2].trim() };
      const suf = t.match(/^(.+?)\s+([\d.]+)%$/);   // var(--ok) 12%  ← 站内写法
      if (suf) return { pct: +suf[2] / 100, color: suf[1].trim() };
      return { pct: null, color: t };
    };
    const g1 = strip(cm[1]), g2 = strip(cm[2]);
    const pct = g1.pct !== null ? g1.pct : g2.pct;
    if (pct === null) return null;
    const a = resolve(g1.color, tv, depth + 1);
    const b = resolve(g2.color, tv, depth + 1);
    if (!a || !b) return null;
    return [toHex(a.map((x, i) => x * pct + b[i] * (1 - pct)))];
  }
  const vm = p.match(/^var\((--[a-z0-9-]+)\)$/i);
  // 变量的值本身可能还是表达式（--primary-ink 就是 color-mix(...)），
  // 直接把原串包进数组返回的话，下游会拿到一个非 hex 的字符串。
  if (vm) return tv[vm[1]] ? resolve(tv[vm[1]], tv, depth + 1) : null;
  if (/^#[0-9a-f]{6}$/i.test(p)) return [p.toLowerCase()];
  if (/^[a-z-]*gradient\(/i.test(p)) {
    const all = [];
    for (const s of fnArgs(p).slice(1)) {
      const r = resolve(s, tv, depth + 1);
      if (!r) return null;
      all.push(...r);
    }
    return all.length ? all : null;
  }
  return null;
}

const themes = {};
for (const m of css.matchAll(/(:root|\[data-theme="dark"\])\s*\{([^{}]*)\}/g)) {
  // 只认顶层的主题块：@media 里也有 :root{--header-h:64px}，那不是主题定义
  const before = css.slice(0, m.index);
  const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
  if (depth > 0) continue;
  const name = m[1] === ":root" ? "light" : "dark";
  themes[name] = { ...(themes[name] || {}) };
  for (const [k, val] of Object.entries(decl(m[2]))) if (k.startsWith("--")) themes[name][k] = val;
}
// CSS 层叠：[data-theme="dark"] 只覆写它列出的变量，其余从 :root 继承。
// 不合并的话，两个主题无关的 --on-ok 会被当成「深色主题缺失」而误报。
if (themes.light && themes.dark) themes.dark = { ...themes.light, ...themes.dark };

function rules() {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (sel.startsWith("@") || /^(from|to|\d+%)$/.test(sel)) continue;
    out.push({ sel, d: decl(m[2]) });
  }
  return out;
}

// 渐变裁切文字（.logo b / .stat b / .principle .num）：文字本身就是背景，
// 不存在「文字压底色」，算对比度是伪失败，必须排除。
const isGradientText = (d) =>
  /text/.test(d["background-clip"] || d["-webkit-background-clip"] || "") || d.color === "transparent";

/* 背景会「继承」：.q-explain b 只声明 color，底色来自父选择器 .q-explain。
   之前的版本对这类规则直接 continue，于是 78 条 color-only 规则全部逃过审计——
   包含 .q-explain b，它在浅色主题下只有 3.34:1 却一直是绿的。
   这里补一层「祖先查找」：把选择器从右往左逐段剥掉，找到最近的、自己带背景的祖先。
   刻意只在**首个 @media 之前的基础样式**里查找：断点里的背景覆盖会因机型而异，
   静态解析判定不了，硬要算只会产出没法修的误报。 */
const baseCss = css.slice(0, css.search(/@media/) === -1 ? css.length : css.search(/@media/));
const baseBg = new Map();
for (const m of baseCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, " ");
  if (sel.startsWith("@")) continue;
  const d = decl(m[2]);
  const bg = d["background-color"] || d.background;
  // 同名选择器取**最后**一条：层叠里后写的赢，先写的早被覆盖了。
  if (bg) baseBg.set(sel, bg);
}
// 末尾复合选择器逐级降级：.fav.on -> .fav；.imp.act -> .imp
function qualifiers(sel) {
  const out = [sel];
  const m = /^([^\s]+?)((?:[.#][\w-]+)+)$/.exec(sel);
  if (m) {
    const quals = m[2].match(/[.#][\w-]+/g) || [];
    for (let i = quals.length - 1; i >= 0; i--) out.push(m[1] + quals.slice(0, i).join(""));
  }
  return out;
}
/* 返回祖先背景的**候选列表**，而不是单个值。
   为什么要多个：.q-explain b 在真实 DOM 里永远落在 .q-explain.ok 或 .q-explain.no 里，
   而这两个变体各有自己的淡化底色。只拿基础 .q-explain 的 --bg 去算，
   浅色主题下 --primary 会算出 8.68:1 一路绿灯，而真实底色是 12% 红/绿，结果只有 3.34。
   所以命中一个祖先后，把它的单层修饰变体（.ok / .no / .on…）的底色一并算进去。 */
function inheritedBgs(sel) {
  const variants = (x) => {
    const out = [];
    for (const k of baseBg.keys()) {
      const m = new RegExp("^" + x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([.#][\\w-]+)$").exec(k);
      if (m) out.push(baseBg.get(k));
    }
    return out;
  };
  const toks = sel.split(/\s+/).filter(Boolean);
  for (let i = toks.length; i > 0; i--) {
    for (const cand of qualifiers(toks.slice(0, i).join(" "))) {
      if (cand !== sel && baseBg.has(cand)) return [baseBg.get(cand), ...variants(cand)];
    }
  }
  const body = baseBg.get("body");
  return body ? [body] : [];
}

const pairs = [];
const skipped = [];
for (const { sel, d } of rules()) {
  if (!d.color || isGradientText(d)) continue;
  const own = d["background-color"] || d.background;
  const bgVals = own ? [own] : inheritedBgs(sel);
  if (!bgVals.length) { skipped.push(`${sel} { color:${d.color} }`); continue; }
  for (const theme of ["light", "dark"]) {
    const fg = resolve(d.color, themes[theme]);
    const bgs = bgVals.flatMap((v) => resolve(v, themes[theme]) || []);
    if (!bgs.length || !fg) { skipped.push(`${sel} { color:${d.color} }`); continue; }
    for (const b of bgs) for (const f of fg) pairs.push({ sel, theme, cr: contrast(f, b), f, b });
  }
}

test("变量块之外不允许字面 hex —— 否则审计可能静默空转", () => {
  const stripped = css
    .replace(/:root\s*\{[^{}]*\}/, "")
    .replace(/\[data-theme="dark"\]\s*\{[^{}]*\}/, "");
  const found = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const d = decl(m[2]);
    for (const k of ["color", "background", "background-color"]) {
      if (!d[k]) continue;
      for (const h of d[k].matchAll(/#[0-9a-f]{3,8}\b/gi)) {
        found.push(`${m[1].trim().slice(0, 40)} { ${k}: ${h[0]} }`);
      }
    }
  }
  // 颜色必须来自主题变量或 color-mix，否则一个主题合格不代表另一个也合格
  assert.deepEqual(found, [], "这些颜色写死了，换主题就会失效：\n" + found.join("\n"));
});

test("两个主题都被解析出来，且审计不是空转", () => {
  for (const t of ["light", "dark"]) {
    for (const v of ["--text", "--card", "--primary", "--ok", "--hot", "--on-primary", "--on-ok", "--on-hot"]) {
      assert.match(themes[t]?.[v] || "", /^#[0-9a-f]{6}$/i, `${t} 缺变量 ${v}`);
    }
  }
  // 解析器一旦坏掉，pairs 会变成 0，测试就会「全部通过」而什么也没测
  assert.ok(pairs.length >= 30, `可解析的组合只有 ${pairs.length} 条，解析器可能坏了`);
  // 唯一可以接受的「解析不了」：color:inherit / currentColor。
  // 这类规则的颜色完全由父元素决定，静态分析里没有固定值可算；
  // 它们的实际颜色会在祖先那条规则上被单独审计到。
  const ALLOWED_SKIP = /:\s*(inherit|currentColor)\s*\}?$/;
  assert.deepEqual(
    [...new Set(skipped.filter((s) => !ALLOWED_SKIP.test(s)))],
    [],
    "有规则解析不了（非 inherit），审计覆盖不完整",
  );
});

test("全站每条「文字压底色」在两个主题下都过 4.5:1", () => {
  const bad = pairs.filter((p) => p.cr < 4.5);
  const lines = bad.map((b) => `  ${b.cr}  ${b.theme}  ${b.sel}  ${b.f} on ${b.b}`);
  assert.deepEqual(
    [...new Set(lines.map((l) => l.replace(/^[\d.]+/, "")))],
    [],
    `以下对比度不足 4.5:1：\n${[...new Set(lines)].join("\n")}`,
  );
});

test("语义色上的前景色 token 真的过 AA（防止 token 被改坏）", () => {
  const cases = [
    ["--on-ok", "--ok"],
    ["--on-hot", "--hot"],
    ["--on-primary", "--primary"],
    ["--on-primary", "--primary2"],
  ];
  const bad = [];
  for (const theme of ["light", "dark"]) {
    for (const [fg, bg] of cases) {
      const cr = contrast(themes[theme][fg], themes[theme][bg]);
      if (cr < 4.5) bad.push(`  ${cr}  ${theme}  ${fg} 压 ${bg}`);
    }
  }
  assert.deepEqual(bad, [], "实心色块上的文字色不合格：\n" + bad.join("\n"));
});
test("凡被 var() 引用的 token，都必须在顶层主题块里定义", () => {
  // 我先写过一版「两个主题都必须有定义」，跑变异时发现它是空转：
  // themes.dark 是 { ...themes.light, ...themes.dark }，模拟了 CSS 自定义属性
  // 从 :root 继承的层叠，所以「深色缺 --on-ok」这种写法本来就该解析成功 ——
  // 拿它当断言，只会让人误以为深色块漏定义是真 bug，其实不是。
  //
  // 真正会坏的是另一种：把 token 定义在 .foo{--x:red} 或 @media 里。
  // 那种定义只在该选择器/断点下存在，被 var() 引用时整条声明失效，
  // color 退回继承色 —— 正是「浅底 + 近白字」这类看不清的问题。
  // 所以这里查的是「有没有落在顶层 :root / [data-theme] 块里」，
  // 而不是要求每个主题各写一份。
  const top = new Set();
  for (const m of css.matchAll(/(:root|\[data-theme="dark"\])\s*\{([^{}]*)\}/g)) {
    const before = css.slice(0, m.index);
    const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
    if (depth > 0) continue; // @media 里的 :root 不是主题定义
    for (const k of m[2].matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) top.add(k[1]);
  }
  const used = [...new Set([...css.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => m[1]))];
  assert.ok(used.length > 20, `只解析到 ${used.length} 个 var()，这条测试就是空转`);
  const missing = used.filter((t) => !top.has(t)).sort();
  assert.deepEqual(missing, [], "被 var() 引用但没在顶层主题块定义的 token（会静默失效）：\n" + missing.join("\n"));
});
