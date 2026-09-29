/**
 * 人生指南正文解析（纯函数，无网络、无文件系统）
 *
 * 接入的是 github.com/eternity4719/HowToLiveBetter（CC-BY-4.0，27k star）。
 * 那本书把每条建议写成固定格式，其中有一行**给机器读的注释**：
 *
 *   ### 5. 把家里的食盐换成低钠盐（钾盐）
 *   <!-- 成本标签: 钱=少 时间=少 毅力=否 收益=中 口径=死亡率 -->
 *   - 成本：每袋贵几元
 *   - 说人话：……死亡的概率低约 12%……
 *   - 收益：脑卒中降 14%，心血管事件降 13%，总死亡率降 12%
 *   - 证据等级：A
 *   - 来源：Neal B, et al. (2021). NEJM. <https://doi.org/...>
 *   - 备注：争议。肾功能不全、正在吃保钾利尿剂的人不要用。……
 *
 * 上游自己的 skill 文档也确认这就是权威格式。本文件的正则**逐条对齐
 * 上游 index.html 的实现**（第 540~570 行），不是自己另发明一套：
 * 两边解析出不同的结果，就等于我们给用户看了另一本书。
 *
 * 单独抽成 lib 是为了让测试能直接测解析器。解析错误是这类接入最隐蔽的
 * 故障——少解析几条不会报错，页面照常显示，只是悄悄少了内容。
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/* 复用页面侧的链接抽取（理由见本文件末尾 linksOf 的注释：
 * 曾经写成两份，结果 848 个链接全被截成一个字符）。
 * data/life-core.js 是 IIFE + CommonJS 导出，这里用 require 桥接；
 * 它里面写的是 `window.LIFE_CORE =`，所以先把 window 指回自己。 */
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
const _req = createRequire(import.meta.url);
const sharedLinksOf = _req(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../data/life-core.js")
).linksOf;

/* 成本权重：三项相加得到成本分 cs。
 * 取值与上游 COST_W 完全一致，改动会让「性价比」与原书对不上。 */
export const COST_W = {
  money: { "0": 0, "少": 1, "多": 2 },
  time: { "少": 0, "中": 1, "多": 2 },
  will: { "否": 0, "些": 1, "是": 2 },
};

/* 口径：书里明确要求「不同口径之间不排序」。
 * 换寿命的和换钱的分开列，各排各的。 */
export const LENS_LABEL = {
  死亡率: "换寿命",
  金钱: "换钱",
  时间: "换时间精力",
  自由: "换人身自由",
};

export const GRADE_LABEL = {
  A: "荟萃/RCT",
  B: "有研究",
  C: "共识",
};

/** 去掉 Markdown 强调与转义，让页面直接显示纯文本。
 *  上游在算搜索索引时也做了同样的两步（去掉双星号强调 + 去掉反斜杠转义）。 */
function clean(s) {
  return String(s == null ? "" : s)
    .replace(/\*\*/g, "")
    .replace(/\\([*_])/g, "$1")
    .trim();
}

/**
 * 解析一本《高性价比人生指南》的正文。
 * @param {string} md  一节的内容（book/NN-xxx.md）
 * @returns {{n:number,title:string,intro:string[],entries:object[]}[]}
 */
export function parseSection(md) {
  const lines = String(md || "").split(/\r?\n/);
  const sections = [];
  let sec = null;
  let entry = null;

  const flush = () => {
    if (entry && sec) sec.entries.push(entry);
    entry = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;

    // 节标题：`# 18. 养孩子划不划算`（上游允许 # 或 ##）
    if ((m = /^#{1,2} (\d+)\. (.+)$/.exec(line))) {
      flush();
      sec = { n: Number(m[1]), title: clean(m[2]), intro: [], entries: [] };
      sections.push(sec);
      continue;
    }
    // 其它任意标题 → 本节正文结束（导读文字不该被算成条目）
    if (/^#{1,2} /.test(line)) {
      flush();
      sec = null;
      continue;
    }
    if (!sec) continue;

    // 条目标题：`### 1. 先把能领的算进来：……`
    if ((m = /^### (\d+)\. (.+)$/.exec(line))) {
      flush();
      entry = {
        sec: sec.n,
        n: Number(m[1]),
        title: clean(m[2]),
        cost: "", human: "", gain: "", grade: "", src: "", note: "",
        money: "", time: "", will: "", level: "", lens: "",
      };
      continue;
    }

    // 机器可读的成本标签
    if ((m = /^<!--\s*成本标签:\s*(.*?)\s*-->/.exec(line)) && entry) {
      for (const kv of m[1].split(/\s+/)) {
        const i = kv.indexOf("=");
        if (i < 0) continue;
        const k = kv.slice(0, i);
        const v = kv.slice(i + 1);
        if (k === "钱") entry.money = v;
        if (k === "时间") entry.time = v;
        if (k === "毅力") entry.will = v;
        if (k === "收益") entry.level = v;
        if (k === "口径") entry.lens = v;
      }
      continue;
    }

    if (entry) {
      if ((m = /^- 成本：(.*)$/.exec(line))) entry.cost = clean(m[1]);
      else if ((m = /^- 说人话：(.*)$/.exec(line))) entry.human = clean(m[1]);
      else if ((m = /^- 收益：(.*)$/.exec(line))) entry.gain = clean(m[1]);
      else if ((m = /^- 证据等级：\s*([ABC])/.exec(line))) entry.grade = m[1];
      else if ((m = /^- 来源：(.*)$/.exec(line))) entry.src = clean(m[1]);
      else if ((m = /^- 备注：(.*)$/.exec(line))) entry.note = clean(m[1]);
      continue;
    }
    // 第一条之前的每一段导读都收
    if (line.trim()) sec.intro.push(clean(line));
  }
  flush();

  for (const s of sections) {
    for (const e of s.entries) {
      e.dispute = /^争议/.test(e.note);
      e.todo = /待核实|TODO/.test(e.src + e.gain + e.note + e.cost);
      e.cs = costScore(e);
      e.ratio = ratioOf(e);
    }
  }
  return sections;
}

/** 成本分：钱 + 时间 + 毅力。缺项按 0 算（= 没标注，不是"零成本"，
 *  但也不能瞎猜一个数——上游同样用 ?? 0，所以口径一致）。 */
export function costScore(e) {
  return (
    (COST_W.money[e.money] ?? 0) +
    (COST_W.time[e.time] ?? 0) +
    (COST_W.will[e.will] ?? 0)
  );
}

/** 性价比档位：收益量级 × 成本分。
 *
 *  这是**作者的判断**，与证据等级是两回事——上游 index.html 明确写了
 *  「『一般』不等于不该做」。所以页面上必须两者分开显示，
 *  不能拿「证据 C 级」去暗示「不值得做」。
 *
 *  逻辑逐行对齐上游：
 *    收益大 → 成本 0 = 极高；成本 ≤2 = 高；否则 一般
 *    收益中 → 成本 0 = 高；否则 一般
 *    其余    → 一般
 */
export function ratioOf(e) {
  if (e.level === "大") return e.cs === 0 ? "极高" : e.cs <= 2 ? "高" : "一般";
  if (e.level === "中") return (e.cs === 0 ? "高" : "一般");
  return "一般";
}

/** 从正文里抽出所有 URL（来源 / 备注里都可能带链接）
 *
 *  这里**不再自己写正则**，直接转调 LIFE_CORE.linksOf。
 *
 *  原因是一次真实的线上事故：原来这里写的是
 *      /<?(https?:\/\/[^\s>）)]+?)>?/g
 *  那个 `+?` 是惰性量词，后面又跟了个可选的 `>?`，
 *  于是引擎走最短匹配——**每个链接都被截成「https://c」一个字符**。
 *  630 条、848 个链接无一幸免，而脚本不报错、测试也全绿：
 *  因为测试只断言了「有链接」，没断言「链接是完整的」。
 *  页面上它会渲染成一排点开 404 的蓝色字。
 *
 *  同一个函数当时在 data/life-core.js 里是对的（用的是贪婪量词），
 *  两份实现分叉就是这个 bug 的来源。教训很具体：
 *  **同一段逻辑只能有一个实现**，跨 scripts/ 与 data/ 也不例外。
 *  所以现在解析侧与页面侧共用同一份，测试再钉住「两个入口结果必须一致」。
 */
export function linksOf(text) {
  return sharedLinksOf(text);
}
