import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// labs-core.js / labs-curriculum.js 挂在 window 上，node 里没有 window，先补一个
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const CORE = require(resolve(ROOT, "data/labs-core.js"));
const LABS = require(resolve(ROOT, "data/labs-curriculum.js"));
const labsJson = require(resolve(ROOT, "data/labs.json"));

/* ------------------------------------------------------------------ */
/* K12 深链：尾斜杠是硬约束                                          */
/* ------------------------------------------------------------------ */

test("k12Url 补尾斜杠——不带斜杠实测 404", () => {
  assert.equal(CORE.k12Url("grade/3"), "https://observingthesea.github.io/grade/3/");
  assert.equal(CORE.k12Url("review"), "https://observingthesea.github.io/review/");
  // 已经带斜杠的不许变成双斜杠
  assert.equal(CORE.k12Url("review/"), "https://observingthesea.github.io/review/");
  assert.equal(CORE.k12Url("/shop"), "https://observingthesea.github.io/shop/");
});

test("k12Url 空路径回首页，不产出 /undefined/", () => {
  assert.equal(CORE.k12Url(""), "https://observingthesea.github.io/");
  assert.equal(CORE.k12Url(), "https://observingthesea.github.io/");
  assert.equal(CORE.k12Url(null), "https://observingthesea.github.io/");
  // 之前这里直接字符串拼接，路径为空时会产出 "...github.io//" 或 "/undefined"
  assert.ok(!CORE.k12Url("").includes("undefined"));
  assert.ok(!CORE.k12Url("").endsWith("//"));
});

test("k12Route 只对白名单里的 key 给链接", () => {
  assert.equal(CORE.k12Route("home"), "https://observingthesea.github.io/");
  assert.equal(CORE.k12Route("review"), "https://observingthesea.github.io/review/");
  // 未知 key 必须给 null，让渲染层画成纯文本而不是一个 404 链接
  assert.equal(CORE.k12Route("evil"), null);
  assert.equal(CORE.k12Route(""), null);
});

test("k12Route 年级白名单拦截非法值", () => {
  assert.equal(CORE.k12Route("grade", "3"), "https://observingthesea.github.io/grade/3/");
  assert.equal(CORE.k12Route("grade", 1), "https://observingthesea.github.io/grade/1/");
  // 越界年级 / 非数字都不给链接
  assert.equal(CORE.k12Route("grade", "9"), null);
  assert.equal(CORE.k12Route("grade", "abc"), null);
  assert.equal(CORE.k12Route("grade"), null);
});

test("K12_PORTS 里每一项都能解析出真实可用的深链", () => {
  for (const p of LABS.K12_PORTS) {
    const url = p.key === "grade" ? CORE.k12Route("grade", "3") : CORE.k12Route(p.key);
    assert.ok(url, p.id + " (" + p.key + ") 解析不出链接");
    assert.ok(url.startsWith("https://observingthesea.github.io/"), p.id + " 域名不对：" + url);
  }
});

/* ------------------------------------------------------------------ */
/* 四步状态机                                                          */
/* ------------------------------------------------------------------ */

test("nextStep 严格按 读→动手→交付→自测 的顺序推进", () => {
  assert.equal(CORE.nextStep({}), "read");
  assert.equal(CORE.nextStep(null), "read");
  assert.equal(CORE.nextStep({ readAt: 1 }), "try");
  assert.equal(CORE.nextStep({ readAt: 1, triedAt: 2 }), "deliver");
  assert.equal(CORE.nextStep({ readAt: 1, triedAt: 2, delivered: "x" }), "check");
  assert.equal(CORE.nextStep({ readAt: 1, triedAt: 2, delivered: "x", passed: true }), "done");
});

test("nextStep 返回的值一定是 STEPS 里的成员（渲染层按它画进度）", () => {
  const cases = [
    {}, { readAt: 1 }, { readAt: 1, triedAt: 2 },
    { readAt: 1, triedAt: 2, delivered: "d" },
    { readAt: 1, triedAt: 2, delivered: "d", passed: true },
  ];
  for (const rec of cases) {
    const s = CORE.nextStep(rec);
    assert.ok(s === "done" || CORE.STEPS.includes(s), "非法状态：" + s);
  }
});

test("没读过源码就不给「动手」打点——triedAt 不能凭空出现", () => {
  // 只给了 triedAt 没给 readAt：应回落到 read，而不是当成已完成读
  assert.equal(CORE.nextStep({ triedAt: 2 }), "read");
  assert.equal(CORE.nextStep({ delivered: "x" }), "read");
  assert.equal(CORE.nextStep({ passed: true }), "read");
});

test("stepProgress 比例单调不倒退", () => {
  const seq = [
    {}, { readAt: 1 }, { readAt: 1, triedAt: 2 },
    { readAt: 1, triedAt: 2, delivered: "d" },
    { readAt: 1, triedAt: 2, delivered: "d", passed: true },
  ];
  let last = -1;
  for (const rec of seq) {
    const p = CORE.stepProgress(rec);
    assert.ok(p.ratio >= last, "进度倒退了：" + p.ratio + " < " + last);
    assert.ok(p.ratio >= 0 && p.ratio <= 1, "比例越界：" + p.ratio);
    last = p.ratio;
  }
  assert.equal(CORE.stepProgress({}).ratio, 0);
  assert.equal(CORE.stepProgress(seq[4]).ratio, 1);
  assert.equal(CORE.stepProgress(seq[4]).done, true);
});

test("每一步都有对应的提示语，折叠卡片不会显示空白", () => {
  for (const s of CORE.STEPS.concat(["done"])) {
    assert.ok(CORE.nudge(s) && CORE.nudge(s).length > 4, "缺长提示：" + s);
    assert.ok(CORE.nudgeShort(s) && CORE.nudgeShort(s).length > 0, "缺短提示：" + s);
  }
  // 未知状态兜底，不能返回 undefined
  assert.equal(typeof CORE.nudge("???"), "string");
  assert.equal(typeof CORE.nudgeShort("???"), "string");
});

/* ------------------------------------------------------------------ */
/* 课程内容：src 必须是真实存在的路径                                  */
/* ------------------------------------------------------------------ */

const ALL = LABS.PRINCIPLES.concat(LABS.ENGINEERING);

test("每条课都有 id / title / why / read / try / deliver / check", () => {
  for (const l of ALL) {
    for (const k of ["id", "title", "why", "read", "try", "deliver", "check", "src"]) {
      assert.ok(l[k] && String(l[k]).trim(), l.id + " 缺字段 " + k);
    }
  }
});

test("课程 id 不重复", () => {
  const ids = ALL.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "有重复 id：" + ids.join(","));
});

test("课程里的 src 在上游仓库中真实存在", () => {
  // 这是本文件最关键的一条：三轨全部价值都在于「去读真实源码」，
  // 路径一旦失效，页面上写着「去读源码」而点开是空白 —— 比不做更糟。
  const byRepo = {};
  for (const r of labsJson.repos) byRepo[r.id] = r;
  const owner = { PRINCIPLES: "eduagent", ENGINEERING: "eduagentx" };
  let checked = 0;
  for (const [group, repoId] of Object.entries(owner)) {
    const repo = byRepo[repoId];
    assert.ok(repo, "labs.json 缺仓库 " + repoId + "（先跑 node scripts/fetch-labs.mjs）");
    for (const l of LABS[group]) {
      const hit = repo.used.find((u) => u.lesson === l.id);
      assert.ok(hit, l.id + " 没有出现在 labs.json 的校验清单里");
      assert.equal(hit.src, l.src, l.id + " 的 src 与抓取清单不一致");
      assert.equal(hit.ok, true, l.id + " 的源码路径在上游已失效：" + l.src);
      checked++;
    }
  }
  assert.equal(checked, ALL.length);
});

test("labs.json 结构完整（抓取失败也要有可渲染的形状）", () => {
  for (const k of ["generatedAt", "date", "repos", "errors"]) {
    assert.ok(k in labsJson, "labs.json 缺字段 " + k);
  }
  assert.equal(labsJson.repos.length, 3, "三个来源都要在");
  for (const r of labsJson.repos) {
    for (const k of ["id", "repo", "branch", "stars", "fileCount", "used", "missing"]) {
      assert.ok(k in r, r.id + " 缺字段 " + k);
    }
    assert.ok(r.fileCount > 0, r.id + " fileCount 为 0");
  }
});

/* ------------------------------------------------------------------ */
/* 来源标注：不能把「不可嵌入」说成可嵌入                              */
/* ------------------------------------------------------------------ */

test("来源信息里 embeddable 的判断与 why_not 自洽", () => {
  for (const id of ["k12", "eduagent", "eduagentx"]) {
    const s = CORE.SRC[id];
    assert.ok(s && s.repo && s.name, "缺来源 " + id);
    assert.equal(typeof s.embeddable, "boolean", id + " 的 embeddable 必须是布尔");
    // 不可嵌入的必须写清原因，否则页面上只能显示一个打不开的 iframe
    if (!s.embeddable) {
      assert.ok(s.why_not && s.why_not.length > 4, id + " 不可嵌入但没写原因");
    }
  }
  // 实测只有聪聪学堂能嵌；这一条锁住事实，别让 iframe 指向一个 404 页面
  assert.equal(CORE.SRC.k12.embeddable, true);
  assert.equal(CORE.SRC.eduagent.embeddable, false);
  assert.equal(CORE.SRC.eduagentx.embeddable, false);
});

test("不可嵌入的来源不给 site 之外的可嵌地址", () => {
  // k12 有 site（用于 iframe / 深链），另两个只给 GitHub 地址
  assert.ok(CORE.SRC.k12.site.startsWith("https://"));
  assert.ok(CORE.SRC.eduagent.site.includes("github.com"));
  assert.ok(CORE.SRC.eduagentx.site.includes("github.com"));
});
