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

/* 抽掉 @media / @supports 整块（带括号配平）。
   为什么必须抽而不是「截到第一个 @media」：本文件里第一个 @media 是
   `.quiz-cta` 的组件断点，位置在 229 行；而 .feed-card / .btn-sm 这些
   组件样式写在 327 行之后。截断会把后半张样式表全部排除出审计，
   于是新写的规则既查不到自己的底色、也拿不到祖先底色，审出一堆 1.07:1
   的伪失败——真正该拦的 bug 反而被放过了。 */
function stripAtRules(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf("@media", i);
    const at2 = src.indexOf("@supports", i);
    const starts = [at, at2].filter((p) => p >= 0);
    if (!starts.length) return out + src.slice(i);
    const start = Math.min(...starts);
    let depth = 0, j = src.indexOf("{", start);
    if (j < 0) return out + src.slice(i);
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) { j++; break; }
    }
    out += src.slice(i, start);
    i = j;
  }
  return out;
}

const decl = (body) => {
  const out = {};
  // 必须能收数字：--primary2 / --header-h 这类变量名
  for (const m of body.matchAll(/(--?[a-z0-9-]+|[a-z-]+)\s*:\s*([^;}]+)/gi)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
};
// 带透明度的颜色统一编码为 "#rrggbb@a"（a ∈ (0,1]）；不透明的就是普通 hex。
// 为什么要这个：color-mix(<色> 14%, transparent) 的结果**不是**实心色，而是
// rgba(<色>, .14) —— 直接当成不透明混色算，深色主题下会把浅灰底估得过亮，
// 于是 2.29:1 的 .badge-new 硬被判成合格（实测：白底估 4.55、暗底估 2.29，
// 只验浅色主题就永远不会发现）。所以解析层保留 alpha，对比度层再合成。
const isAlpha = (c) => typeof c === "string" && c.includes("@");
const alphaOf = (c) => (isAlpha(c) ? Number(c.split("@")[1]) : 1);
const baseOf = (c) => (isAlpha(c) ? c.split("@")[0] : c);
const hex = (h) => [1, 3, 5].map((i) => parseInt(baseOf(h).slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
// 把带 alpha 的前景合成到不透明底上。CSS 的 alpha compositing：out = fg*a + bg*(1-a)
const over = (fg, bg) => {
  const a = alphaOf(fg);
  if (a >= 1) return baseOf(fg);
  const F = hex(fg), B = hex(bg);
  return toHex(F.map((v, i) => v * a + B[i] * (1 - a)));
};
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
  // background:none / 单独的 transparent：元素自己不画底，按「背后是 --card」算，
  // 否则 .chip / .q-explain 这类「本身透明、活在卡片里」的规则就没人管了。
  if (p === "none" || p === "transparent") return [tv["--card"]];
  // 但作为 color-mix 的**成分**出现时，transparent 是真的 alpha 0，不能当卡片色。
  // （见上方 isAlpha 注释：这是 .badge-new / .pit-tag 在深色主题下漏审的根因。）
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
    // 成分里出现 transparent 时结果是带 alpha 的（见上方 isAlpha 注释），
    // 不能把它当不透明色去混 —— 那样会把深色主题的淡底估得过亮。
    const TRANSPARENT = (s) => /^transparent$/i.test(s.trim());
    if (TRANSPARENT(g1.color) || TRANSPARENT(g2.color)) {
      const col = TRANSPARENT(g1.color) ? g2 : g1;
      const src = resolve(col.color, tv, depth + 1);
      if (!src) return null;
      const a = TRANSPARENT(g1.color) ? 1 - pct : pct;
      return [a >= 1 ? baseOf(src[0]) : baseOf(src[0]) + "@" + a];
    }
    const a = resolve(g1.color, tv, depth + 1);
    const b = resolve(g2.color, tv, depth + 1);
    if (!a || !b) return null;
    // a / b 是 hex **字符串**，必须先转成数值再混。
    // 之前直接写 a[i]*pct + b[i]*(1-pct) 会算出 NaN，toHex 再把 NaN 变成 "#NaN"，
    // 而 `NaN < 4.5` 是 false —— 于是全站所有 color-mix 的对比度都被静默豁免，
    // 审计看着全绿、实际一条没算。混色是这个站的主力写法（每条 *.ink 都是），
    // 这里错了等于整个审计失效，所以下面用不变量单独锁住。
    const A = hex(a[0]), B = hex(b[0]);
    return [toHex(A.map((x, i) => x * pct + B[i] * (1 - pct)))];
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
  // 用抽掉断点后的 baseCss：审计的“文字压底色”必须和祖先查找读同一张表，
  // 否则同一份样式会出现「被当成规则、却查不到底色」的不一致。
  for (const m of baseCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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
   断点块里的背景覆盖会因机型而异，静态解析判定不了，所以整块抽掉（见 stripAtRules）。 */
const baseCss = stripAtRules(css);
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
  // 先剥掉伪类：:hover / :active / :focus 不会给元素换背景，
  // 它仍然继承基础规则声明的背景。不剥的话 `.btn-sm.primary:hover` 永远
  // 找不到底色，就会退到 body 去算，报出 1.07:1 这种不可能的数字。
  sel = sel.replace(/::?[\w-]+(\([^)]*\))?/g, "");
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
  // 只有**祖先**化合物的变体才是祖先。`:hover` / `.on` 这类是元素**自己**的状态，
  // 把它们的底色拿来算会把 .chip:hover 判成「白字压实心块」而误报：
  // .chip.on 靠「同特异性 + 写在后面」赢下 color，不是靠继承。
  // 判据：命中的那段如果不是最后一个 token，它才是祖先。
  const selfIsLast = (i) => i === toks.length;
  for (let i = toks.length; i > 0; i--) {
    for (const cand of qualifiers(toks.slice(0, i).join(" "))) {
      if (cand === sel || !baseBg.has(cand)) continue;
      return selfIsLast(i) ? [baseBg.get(cand)] : [baseBg.get(cand), ...variants(cand)];
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
  // 半透明底是「盖在背后那层之上」，所以两层都得取：
  // 只拿 --card 猜会高估 —— .pit-tag 活在 --bg 上而不是 --card 上，
  // 浏览器实测 4.42（< AA），按 --card 算却是 4.58，看着合格。
  const behind = inheritedBgs(sel);
  const bgVals = own ? [own] : behind;
  if (!bgVals.length) { skipped.push(`${sel} { color:${d.color} }`); continue; }
  for (const theme of ["light", "dark"]) {
    const fg = resolve(d.color, themes[theme]);
    const tops = bgVals.flatMap((v) => resolve(v, themes[theme]) || []);
    const backs = behind.flatMap((v) => resolve(v, themes[theme]) || []);
    if (!tops.length || !fg) { skipped.push(`${sel} { color:${d.color} }`); continue; }
    const card = themes[theme]["--card"];
    for (const t of tops) {
      const bases = alphaOf(t) < 1 && backs.length ? backs : [t];
      for (const b0 of bases) {
        const b = alphaOf(t) < 1 ? over(t, alphaOf(b0) < 1 ? over(b0, card) : b0) : t;
        for (const f0 of fg) {
          const f = alphaOf(f0) < 1 ? over(f0, b) : f0;
          pairs.push({ sel, theme, cr: contrast(f, b), f, b });
        }
      }
    }
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

test("color-mix 真的能解析出具体颜色（不是 #NaN）", () => {
  // 混色解析一旦坏掉，contrast() 返回 NaN，而 NaN 会被 `< 4.5` 静默放过，
  // 所以这里对解析器本身下断言，而不是指望对比度那条红。
  const cases = [
    ["var(--ok-ink)", "light"],
    ["var(--ok-ink)", "dark"],
    ["color-mix(in srgb,var(--ok) 10%,var(--card))", "light"],
    ["color-mix(in srgb,var(--hot) 12%,var(--bg))", "dark"],
    ["color-mix(in srgb, 12% var(--hot), var(--bg))", "light"],
  ];
  const bad = [];
  for (const [expr, theme] of cases) {
    const r = resolve(expr, themes[theme]);
    if (!r || r.length !== 1 || !/^#[0-9a-f]{6}$/.test(r[0]) || r[0].includes("a") && Number.isNaN(hex(r[0])[0]))
      bad.push(`  ${expr} @ ${theme} → ${JSON.stringify(r)}`);
    if (r) for (const c of r) if (hex(c).some(Number.isNaN)) bad.push(`  ${expr} @ ${theme} → ${c} 不是颜色`);
  }
  assert.deepEqual([...new Set(bad)], [], `color-mix 解析失败：\n${bad.join("\n")}`);
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
  // 显式拒绝 NaN/Infinity：比较运算对 NaN 恒为 false，会把「算不出来」当成「合格」。
  // 这正是 color-mix 混色算错时全站审计集体失效而不报错的原因。
  const notANumber = pairs.filter((p) => !Number.isFinite(p.cr));
  assert.deepEqual(
    [...new Set(notANumber.map((p) => `${p.theme}  ${p.sel}  ${p.f} on ${p.b}`))],
    [],
    "有对比度算不出来（NaN/Infinity），这些条目等于没被审计",
  );
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
