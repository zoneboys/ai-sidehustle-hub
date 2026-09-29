/**
 * 人生指南 · 解析层 + 检索层测试
 *
 * 接入 github.com/eternity4719/HowToLiveBetter（CC-BY-4.0）。
 * 这里的断言分两类，用途不同：
 *
 *   1) 对**真实抓下来的 data/life/** 做交叉校验
 *      「少解析几条」是这类接入最隐蔽的故障：脚本不报错、页面照常显示，
 *      只是悄悄少了内容。所以要钉住条数与字段完整率，
 *      并且与上游自己 README 里写的条数对照——两边对不上就是解析器错了。
 *
 *   2) 对**纯逻辑**（排序 / 分列 / 急症 / 筛选）做穷举
 *      这部分最容易出「看起来对、其实反了」的错误：
 *      比如把不同口径混排成一个总榜，等于凭空造出一个第一名。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync } from "node:fs";

import { parseSection, costScore, ratioOf, linksOf, COST_W } from "../scripts/lib/life-parse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const L = require(resolve(ROOT, "data/life-core.js"));

const manifest = JSON.parse(readFileSync(resolve(ROOT, "data/life.json"), "utf8"));
const sectionFiles = readdirSync(resolve(ROOT, "data/life")).filter(f => f.endsWith(".json"));
const allEntries = sectionFiles.flatMap(f =>
  JSON.parse(readFileSync(resolve(ROOT, "data/life", f), "utf8")).entries,
);

/* ------------------------------------------------------------------ */
/* 1. 与真实数据交叉校验                                                 */
/* ------------------------------------------------------------------ */

test("抓取完整：34 节 / 630 条，与上游自报条数一致", () => {
  assert.equal(manifest.sectionCount, 34, "节数不对");
  assert.equal(sectionFiles.length, 34, "分节文件数与目录不符");
  assert.equal(allEntries.length, 630, "实际条目数与目录里写的 entryCount 不符");
  assert.equal(manifest.entryCount, allEntries.length);
  assert.deepEqual(manifest.errors, [], "抓取过程有失败项却被提交了");
});

test("每条都有标题、说人话、收益、来源——空字段就是漏解析", () => {
  const missing = { title: [], human: [], gain: [], src: [] };
  for (const e of allEntries) {
    for (const k of Object.keys(missing)) if (!e[k]) missing[k].push(`${e.sec}-${e.n}`);
  }
  for (const [k, list] of Object.entries(missing)) {
    assert.equal(list.length, 0, `${k} 为空的有 ${list.length} 条：${list.slice(0, 5).join(", ")}`);
  }
});

test("成本标签三项齐全，且取值都在 COST_W 的定义域内", () => {
  // 解析器遇到没见过的档位时不能默默塞个 0——那会让一条很贵的事显得零成本。
  const bad = [];
  for (const e of allEntries) {
    if (e.money && !(e.money in COST_W.money)) bad.push(`钱=${e.money} @${e.sec}-${e.n}`);
    if (e.time && !(e.time in COST_W.time)) bad.push(`时间=${e.time} @${e.sec}-${e.n}`);
    if (e.will && !(e.will in COST_W.will)) bad.push(`毅力=${e.will} @${e.sec}-${e.n}`);
  }
  assert.deepEqual(bad.slice(0, 8), [], "出现了未定义的档位");
});

test("分节文件的 sec/n 与所在文件一致——放错节会让跳转落到别人的内容上", () => {
  for (const f of sectionFiles) {
    const j = JSON.parse(readFileSync(resolve(ROOT, "data/life", f), "utf8"));
    const n = Number(f.replace(/\.json$/, ""));
    assert.equal(j.n, n, `${f} 里的 n=${j.n}`);
    for (const e of j.entries) assert.equal(e.sec, n, `${f} 里混进了第 ${e.sec} 节的条目`);
  }
});

/* ------------------------------------------------------------------ */
/* 2. 性价比算法：必须与上游逐行一致                                    */
/* ------------------------------------------------------------------ */

test("性价比：收益大+零成本=极高；收益大+成本≤2=高；其余一般", () => {
  // 这四条是上游 index.html 的判定分支，改动会让「性价比」与原书对不上
  assert.equal(ratioOf({ level: "大", cs: 0 }), "极高");
  assert.equal(ratioOf({ level: "大", cs: 2 }), "高");
  assert.equal(ratioOf({ level: "大", cs: 3 }), "一般");
  assert.equal(ratioOf({ level: "中", cs: 0 }), "高");
  assert.equal(ratioOf({ level: "中", cs: 1 }), "一般");
  assert.equal(ratioOf({ level: "小", cs: 0 }), "一般");
  // 没写收益 = 不知道，不是「收益为零」
  assert.equal(ratioOf({ cs: 0 }), "一般");
});

test("成本分缺项按 0 计（=没标注，不等于零成本）", () => {
  assert.equal(costScore({ money: "少", time: "少", will: "否" }), 1);
  assert.equal(costScore({ money: "多", time: "多", will: "是" }), 6);
  assert.equal(costScore({}), 0);
});

test("每条算出的性价比确实落在三个档位之一（不是随便一个字符串）", () => {
  const bad = allEntries.filter(e => !["极高", "高", "一般"].includes(e.ratio));
  assert.deepEqual(bad.map(e => `${e.sec}-${e.n}:${e.ratio}`).slice(0, 5), []);
});

/* ------------------------------------------------------------------ */
/* 3. 口径分列：书里最硬的一条规则                                      */
/* ------------------------------------------------------------------ */

test("byLens 绝不产生跨口径的总榜——每个分组口径唯一", () => {
  const groups = L.byLens(allEntries);
  const seen = new Set();
  for (const g of groups) {
    assert.ok(!seen.has(g.label), g.label + " 出现了两次");
    seen.add(g.label);
    for (const e of g.entries) {
      assert.equal((e.lens || ""), g.lens, `条目 ${e.sec}-${e.n} 被放进了不属于它的口径`);
    }
  }
  // 630 条必须一条不漏地分配出去，不能凭空丢
  const total = groups.reduce((s, g) => s + g.entries.length, 0);
  assert.equal(total, allEntries.length, "分列后条目数对不上（有丢失或重复）");
});

test("口径顺序固定为 寿命→钱→时间→自由，未标注永远垫底", () => {
  const labels = L.byLens(allEntries).map(g => g.label);
  const known = labels.filter(l => ["换寿命", "换钱", "换时间精力", "换人身自由"].includes(l));
  assert.deepEqual(known, L.LENS_ORDER.map(k => L.LENS_LABEL[k]));
});

test("真实数据里每条都有口径——不需要「未标注」兜底", () => {
  // 630 条全部标注了口径。这意味着分列是无损的，也意味着
  // 上面那条「未标注垫底」的排序规则在真实数据上不会被触发，
  // 所以必须用构造数据单独验证（见下一条），否则就是空测。
  const unlabeled = allEntries.filter(e => !e.lens);
  assert.deepEqual(unlabeled.map(e => `${e.sec}-${e.n}`), [], "有条目没标口径");
});

test("构造数据下，未标注口径的分组排在最后（真实数据触发不到，故单独验）", () => {
  const mixed = [
    { sec: 1, n: 1, lens: "自由", ratio: "高", grade: "A" },
    { sec: 1, n: 2, lens: "", ratio: "高", grade: "A" },
    { sec: 1, n: 3, lens: "死亡率", ratio: "高", grade: "A" },
  ];
  const labels = L.byLens(mixed).map(g => g.label);
  assert.deepEqual(labels, ["换寿命", "换人身自由", "未标注口径（不参与跨口径比较）"]);
});

test("未标注口径的条目被单列，不会被塞进第一个口径", () => {
  // 硬塞进去等于替它选了一个口径，那正是书里禁止的折算
  const mixed = allEntries.concat([{ sec: 99, n: 1, title: "无口径测试", lens: "" }]);
  const groups = L.byLens(mixed);
  const unlabeled = groups.find(g => g.lens === "");
  assert.ok(unlabeled, "无口径条目应当有自己的分组");
  assert.equal(unlabeled.entries.length, 1);
  for (const g of groups) {
    if (g.lens === "") continue;
    assert.ok(!g.entries.some(e => e.title === "无口径测试"));
  }
});

/* ------------------------------------------------------------------ */
/* 4. 排序：必须稳定，且性价比与证据是两个独立轴                          */
/* ------------------------------------------------------------------ */

test("rank 稳定：同样的输入连跑三次顺序完全一致", () => {
  // 排序键最后落到条号上。少了这一键，两条性价比和证据都相同的条目
  // 会随引擎的排序实现跳动，用户会以为页面在乱跳。
  const input = [
    { sec: 1, n: 3, ratio: "高", grade: "A" },
    { sec: 1, n: 1, ratio: "高", grade: "A" },
    { sec: 2, n: 1, ratio: "高", grade: "A" },
    { sec: 1, n: 2, ratio: "极高", grade: "C" },
  ];
  const key = a => a.map(e => `${e.sec}-${e.n}`).join(",");
  const first = key(L.rank(input));
  for (let i = 0; i < 3; i++) assert.equal(key(L.rank(input)), first);
  assert.equal(first, "1-2,1-1,1-3,2-1", "性价比最高的第一；同档内先证据 A 再条号");
});

test("rank 不会改动传入的数组", () => {
  const input = [{ sec: 2, n: 1, ratio: "一般" }, { sec: 1, n: 1, ratio: "极高" }];
  const before = input.map(e => e.sec + "-" + e.n).join(",");
  L.rank(input);
  assert.equal(input.map(e => e.sec + "-" + e.n).join(","), before, "排序污染了原数组");
});

test("证据 C 级不会把极高性价比压到一般之后——两者不是同一个轴", () => {
  // 书里明确「『一般』不等于不该做」。如果把证据混进性价比主序，
  // 高性价比但证据一般的条目就会被系统性沉底。
  const out = L.rank([
    { sec: 1, n: 1, ratio: "极高", grade: "C" },
    { sec: 1, n: 2, ratio: "高", grade: "A" },
  ]);
  assert.equal(out[0].ratio, "极高", "性价比是主序，证据只在同档内比较");
});

/* ------------------------------------------------------------------ */
/* 5. 急症优先：命中就不给排序，先给出口径                               */
/* ------------------------------------------------------------------ */

test("急症词命中时先给该做的事，而不是给攻略", () => {
  const hits = L.emergencyFirst("我爸爸刚才倒地不起，怀疑心梗，要不要去医院划算？");
  assert.ok(hits.length >= 1, "心梗 + 倒地应当命中");
  assert.equal(hits[0].id, "acute");
  assert.match(hits[0].action, /120/);
});

test("自伤类表述命中另一条，且给出热线而不是攻略", () => {
  const hits = L.emergencyFirst("我不想活了");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "selfharm");
  assert.match(hits[0].action, /12356/);
});

test("法律程序命中，且不假装能替代律师", () => {
  const hits = L.emergencyFirst("我被传唤了，下周开庭");
  assert.equal(hits[0].id, "legal");
  assert.match(hits[0].action, /律师/);
});

test("普通的算账提问不误伤", () => {
  // 这是本模块最危险的失败方向：一个会误报急症的分类器
  // 会让每次问「怎么省钱」都弹出一段急救指引，用户三次之后就再也不信它了。
  for (const q of [
    "怎么降低家庭开支",
    "房贷提前还款划不划算",
    "买保险还是存钱",
    "换工作涨薪多少合适",
    "孩子上学要不要择校",
  ]) {
    assert.deepEqual(L.emergencyFirst(q), [], `「${q}」被误判成急症`);
  }
});

test("空查询不返回任何急症（空串不该命中任何词）", () => {
  assert.deepEqual(L.emergencyFirst(""), []);
  assert.deepEqual(L.emergencyFirst(null), []);
  assert.deepEqual(L.emergencyFirst(undefined), []);
});

/* ------------------------------------------------------------------ */
/* 6. 筛选与搜索                                                        */
/* ------------------------------------------------------------------ */

test("pickBy 的语义是「不超过」：选 时间=少 不含 中/多", () => {
  const list = [
    { sec: 1, n: 1, time: "少" },
    { sec: 1, n: 2, time: "中" },
    { sec: 1, n: 3, time: "多" },
  ];
  assert.deepEqual(L.pickBy(list, "time", ["少"]).map(e => e.n), [1]);
  assert.deepEqual(L.pickBy(list, "time", ["少", "中"]).map(e => e.n), [1, 2]);
  assert.equal(L.pickBy(list, "time", []).length, 3, "空选集 = 不限");
});

test("未知档位被单列，而不是被当成合规混进结果", () => {
  // 「没标注」既可能是「其实很花时间」，也可能是「作者忘了写」。
  // 当成合规 = 骗用户说这条不占时间；当成不合规 = 漏报。
  // 所以两件事都要做：保留在结果里 + 明确告诉他有几条没数据。
  const list = [{ sec: 1, n: 1, money: "0" }, { sec: 1, n: 2 }];
  const kept = L.pickBy(list, "money", ["0"]);
  assert.equal(kept.length, 2);
  assert.deepEqual(L.unknownOn(kept, "money").map(e => e.n), [2], "必须能单独数出没标注的");
});

test("真实数据里三个成本维度都有标注——筛选是完备的", () => {
  for (const dim of ["money", "time", "will"]) {
    const miss = L.unknownOn(allEntries, dim);
    assert.equal(miss.length, 0, `${dim} 未标注 ${miss.length} 条`);
  }
});

test("搜索取交集：两个词都要命中，不是命中任一个", () => {
  const list = [
    { sec: 1, n: 1, title: "裁员补偿金怎么算" },
    { sec: 1, n: 2, title: "裁员后重新找工作的经验" },
    { sec: 1, n: 3, title: "业余时间做副业" },
  ];
  assert.deepEqual(L.search(list, "裁员").map(e => e.n), [1, 2]);
  assert.deepEqual(L.search(list, "裁员 补偿").map(e => e.n), [1], "取交集才算命中两个词");
});

test("搜索能命中正文与来源，不只是标题", () => {
  const list = [{ sec: 1, n: 1, title: "补维生素", human: "缺乏会导致疲劳", src: "NIH (2020)" }];
  assert.equal(L.search(list, "疲劳").length, 1);
  assert.equal(L.search(list, "nih").length, 1);
  assert.equal(L.search(list, "不存在的词").length, 0);
});

test("空查询返回全部，且是副本不是原数组", () => {
  const list = allEntries.slice(0, 5);
  const out = L.search(list, "");
  assert.equal(out.length, 5);
  assert.notEqual(out, list);
});

/* ------------------------------------------------------------------ */
/* 7. 描述与链接                                                        */
/* ------------------------------------------------------------------ */

test("describe 的口径标签有兜底，未标注不会显示成 undefined", () => {
  assert.equal(L.describe({ lens: "死亡率" }).lensLabel, "换寿命");
  assert.equal(L.describe({}).lensLabel, "未标注口径");
  assert.equal(L.describe({}).gradeLabel, "未分级");
  assert.equal(L.describe({}).ratio, "一般");
});

test("linksOf 抽出全部来源链接并去掉句末标点", () => {
  const t = "见 <https://doi.org/10.1/abc>。另见 https://x.org/y, 和 https://x.org/z";
  const links = L.linksOf(t);
  assert.equal(links.length, 3);
  assert.ok(links.includes("https://doi.org/10.1/abc"));
  assert.ok(links.every(u => !/[,.]$/.test(u)), "句末标点必须剥掉，否则链接点不开");
});

test("linksOf 抽出的链接是**完整**的 URL，而不只是「有东西」", () => {
  /* 回归测试。一次真实事故：scripts/lib/life-parse.mjs 里把 linksOf
   * 写成了 `<?(https?:\/\/[^\s>）)]+?)>?`，惰性量词 + 可选 `>?`
   * 走最短匹配，630 条里的 848 个链接全被截成「https://c」一个字符。
   * 当时的测试只断言了「有链接」「句末没标点」，两条都照样通过——
   * 因为它测的是 data/life-core.js 里**另一份正确的**实现。
   * 断言必须落在「完整」上，而不是「存在」上。 */
  const t = "来源 <https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813573> 。";
  for (const u of [linksOf(t), L.linksOf(t)]) {
    for (const link of u) {
      assert.match(link, /^https?:\/\/[^/\s]+\.[a-z]{2,}(\/|$)/i,
        `链接被截断了：${JSON.stringify(link)}`);
      assert.ok(link.length > 20, `链接短得不可能是完整 URL：${JSON.stringify(link)}`);
    }
  }
});

test("全库链接完整性：解析侧与页面侧必须完全一致", () => {
  /* 同一段逻辑只能有一个实现。分叉过一次，代价是全量静默损坏，
   * 所以把「两个入口结果逐字相同」本身钉成不变量。 */
  const all = allEntries.map(e => e.src || "").concat(allEntries.map(e => e.note || ""));
  let n = 0;
  for (const t of all) {
    const a = JSON.stringify(linksOf(t));
    const b = JSON.stringify(L.linksOf(t));
    assert.equal(a, b, "解析侧与页面侧的 linksOf 分叉了");
    n++;
  }
  assert.ok(n > 600, "样本太少，这条测试等于没跑");

  // 真实数据里一条都不能是残缺的
  let checked = 0;
  for (const e of allEntries) {
    for (const u of L.linksOf(e.src || "")) {
      assert.ok(u.length > 20, `data/life/*.json 里存在被截断的链接：${u}`);
      checked++;
    }
  }
  assert.ok(checked > 300, "真实数据里的链接少得可疑，解析器可能根本没在抽");

  /* 还要验**已落盘**的那个字段，而不只是现算一遍。
   * 解析器修好了但没重跑脚本，磁盘上仍是旧的坏数据——
   * 页面上就还是一排 404，这种错只有盯产物才能发现。 */
  const stored = allEntries.flatMap(e => e.links || []);
  assert.ok(stored.length > 300, "落盘的 links 字段几乎为空");
  for (const u of stored) {
    assert.ok(u.length > 20, `落盘数据里存在被截断的链接：${u}（重跑 node scripts/fetch-life.mjs）`);
  }
});

test("真实数据的争议条目被正确识别", () => {
  const d = allEntries.filter(e => e.dispute);
  assert.ok(d.length > 0, "上游明确标了争议条目，解析器却一个都没识别出来");
  for (const e of d.slice(0, 20)) assert.match(e.note, /^争议/);
});

/* ------------------------------------------------------------------ */
/* 8. 解析器本身的边界                                                  */
/* ------------------------------------------------------------------ */

test("parseSection 处理空输入与畸形输入不抛异常", () => {
  // 抓取脚本跑在每日 workflow 上，一次抛异常就意味着当天整站数据不更新
  assert.deepEqual(parseSection(""), []);
  assert.deepEqual(parseSection(null), []);
  assert.deepEqual(parseSection("随便一段没有结构的文字"), []);
});

test("parseSection 只在条目标题存在时收集成本标签", () => {
  // 成本标签紧跟在 ### 标题后面。若不判 entry 就收集，
  // 节导读里出现的 <!-- 成本标签: ... --> 会被误安到上一节末尾的条目上。
  const md = [
    "# 1. 测试节",
    "导读文字。",
    "<!-- 成本标签: 钱=多 时间=多 毅力=是 收益=中 口径=金钱 -->",
    "### 1. 真实条目",
    "- 成本：要花钱",
  ].join("\n");
  const secs = parseSection(md);
  assert.equal(secs[0].entries.length, 1);
  assert.equal(secs[0].entries[0].money, "", "导读里的标签不该落到条目上");
});
