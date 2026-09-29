/**
 * 主动回忆训练 · 核心逻辑测试
 *
 * 目标不是「页面能渲染」，而是保证三件事：
 *   1) 题目答案唯一且确定（不是随机的四选一）
 *   2) 判题不会给出错误反馈（错题不会记成掌握）
 *   3) SM-2 不会因为答错一次就清空已有积累
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadQuiz() {
  const src = readFileSync(new URL("../data/quiz-core.js", import.meta.url), "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.QUIZ_CORE;
}
function loadPlaybooks() {
  const out = [];
  for (const f of ["playbooks-core.js", "playbooks-2.js", "playbooks-3.js"]) {
    const src = readFileSync(new URL("../data/" + f, import.meta.url), "utf8");
    const w = {};
    new Function("window", src)(w);
    for (const k of Object.keys(w)) if (k.startsWith("PLAYBOOKS")) out.push(...w[k]);
  }
  return out;
}

const Q = loadQuiz();
const PBS = loadPlaybooks();
const BANK = Q.buildBank(PBS);
const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);

test("题库非空且覆盖全部 5 种题型", () => {
  assert.ok(BANK.count >= 100, "题量过少: " + BANK.count);
  const types = new Set(BANK.questions.map((q) => q.type));
  for (const t of ["trap", "next", "tool", "who", "income"]) {
    assert.ok(types.has(t), "缺少题型: " + t);
  }
});

test("每题恰好一个正确项，且下标合法", () => {
  for (const q of BANK.questions) {
    const n = q.options.filter((o) => o.id === "correct").length;
    assert.equal(n, 1, q.qid + " 正确项数异常: " + n);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, q.qid + " 答案下标越界");
    assert.equal(q.options[q.answer].id, "correct", q.qid + " 答案没指向正确项");
  }
});

test("选项不重复，且不是都长一个样", () => {
  for (const q of BANK.questions) {
    const texts = q.options.map((o) => o.text);
    assert.equal(new Set(texts).size, texts.length, q.qid + " 选项重复: " + JSON.stringify(texts));
    assert.ok(q.options.length >= 3, q.qid + " 选项太少");
  }
});

test("题库构建是确定性的（否则 SM-2 记忆会错位）", () => {
  const again = Q.buildBank(PBS);
  assert.equal(JSON.stringify(again.questions), JSON.stringify(BANK.questions));
});

test("干扰项必须来自站内真实内容，不允许出现占位文本", () => {
  const realTools = new Set(), realTexts = new Set();
  for (const p of PBS) {
    (p.tools || []).forEach((t) => realTools.add(t.n));
    (p.traps || []).forEach((t) => realTexts.add(t));
    (p.phases || []).forEach((ph) => realTexts.add(ph.do));
    realTexts.add(p.prereq); realTexts.add(p.who); realTexts.add(p.time);
  }
  for (const q of BANK.questions) {
    if (q.type === "tool") {
      const names = q.options.map((o) => o.text.split("（")[0]);
      for (const n of names) assert.ok(realTools.has(n), "工具不在手册里: " + n);
    } else if (q.type === "income") {
      /* 选项 = 「时间预估 （收益说明）」，两者都得是真的 */
      for (const o of q.options) {
        const t = o.text.split("　（")[0].trim();
        assert.ok([...realTexts].some((x) => x && String(x).startsWith(t.slice(0, 8))), "时间预估非手册原文: " + t);
      }
    } else {
      for (const o of q.options) {
        const head = o.text.replace(/…$/, "");
        assert.ok(
          [...realTexts].some((t) => t && String(t).startsWith(head.slice(0, 12))),
          q.qid + " 选项非站内原文: " + head.slice(0, 40)
        );
      }
    }
  }
});

test("题干问「哪个是坑」时，正确项一定真的是坑", () => {
  for (const q of BANK.questions) {
    if (q.type !== "trap") continue;
    const p = PBS.find((x) => x.id === q.pb);
    const right = q.options[q.answer].text.replace(/…$/, "");
    assert.ok(
      p.traps.some((t) => t.startsWith(right.slice(0, 12))),
      q.qid + " 正确答案不是手册列出的坑"
    );
  }
});

/* ---------------- 判题 ---------------- */
test("判题：选对选错都返回可用的讲解与出处", () => {
  const q = BANK.questions[0];
  const ok = Q.grade(q, q.answer);
  assert.equal(ok.correct, true);
  assert.ok(ok.explain.length > 10, "答对也要有讲解");
  const no = Q.grade(q, (q.answer + 1) % q.options.length);
  assert.equal(no.correct, false);
  assert.equal(no.answer, q.answer, "答错时也要告诉正确答案");
  assert.ok(no.explain.includes("判断依据"), "讲解里要有可迁移的判断依据");
});

test("判题：没作答 / 越界 / 脏数据不崩，也不能算对", () => {
  const q = BANK.questions[0];
  for (const bad of [undefined, null, -1, 99, 1.5, "1", {}]) {
    const r = Q.grade(q, bad);
    assert.equal(r.correct, false, "非法输入被判为正确: " + String(bad));
  }
  assert.equal(Q.grade(null, 0).correct, false);
  assert.equal(Q.grade({ options: [] }, 0).correct, false);
});

/* ---------------- SM-2 ---------------- */
test("SM-2：连续答对间隔 1→6→倍数增长", () => {
  let c = undefined;
  c = Q.sm2(c, 5, T0);
  assert.equal(c.interval, 1);
  c = Q.sm2(c, 5, T0);
  assert.equal(c.interval, 6);
  const third = Q.sm2(c, 5, T0);
  assert.ok(third.interval > 6 && third.interval < 180, "第三次应按 ef 放大: " + third.interval);
});

test("SM-2：间隔封顶 180 天（不允许一劳永逸）", () => {
  let c = { ef: 2.5, reps: 10, interval: 300, lapses: 0, due: T0 };
  const r = Q.sm2(c, 5, T0);
  assert.equal(r.interval, 180);
});

test("SM-2：答错回到起点，但不抹掉已积累的熟练度", () => {
  let c = Q.sm2(Q.sm2(Q.sm2(undefined, 5, T0), 5, T0), 5, T0);
  const efBefore = c.ef, repsBefore = c.reps;
  const r = Q.sm2(c, 1, T0);
  assert.equal(r.reps, 0, "答错后连续次数应归零");
  assert.equal(r.interval, 1, "明天就要重来");
  assert.equal(r.lapses, 1);
  assert.ok(r.ef >= 1.3 && r.ef <= efBefore, "ef 不应因一次答错就崩掉");
  assert.ok(repsBefore >= 3);
});

test("SM-2：脏卡片输入不产生 NaN", () => {
  for (const c of [null, {}, { ef: 0 }, { ef: -3, reps: NaN, due: 0 }, { reps: 2, interval: NaN }]) {
    const r = Q.sm2(c, 4, T0);
    for (const k of ["ef", "reps", "interval", "due"]) {
      assert.ok(Number.isFinite(r[k]), "字段非有限数: " + k + " = " + r[k]);
    }
  }
});

test("SM-2：due 按天推进，不会因时区/夏令时漂移", () => {
  const c = Q.sm2(undefined, 5, T0);
  assert.equal(c.due - T0, DAY);
});

test("质量分：答错必须小于 3，否则 SM-2 会把错题当成「已掌握」拉长间隔", () => {
  const q = BANK.questions[0];
  const wrong = Q.grade(q, (q.answer + 1) % q.options.length);
  const right = Q.grade(q, q.answer);
  assert.ok(Q.qualityOf(wrong, true) < 3, "首次答错的质量分必须 < 3");
  assert.ok(Q.qualityOf(wrong, false) < 3, "重试后仍答错的质量分必须 < 3");
  assert.equal(Q.qualityOf(right, true), 5);
  assert.equal(Q.qualityOf(right, false), 3);
  assert.equal(Q.qualityOf({ ok: false }, true), 0);
});

test("端到端：答错一道题，它的卡片必须重置而不是被推远", () => {
  /* 用单题题库构造可重复场景：先答对拿到正常卡片，再答错看卡片怎么变 */
  const one = BANK.questions[0];
  const mini = { questions: [one], byId: { [one.qid]: one }, count: 1 };
  let s = Q.startSession(mini, {}, { size: 1, now: T0 });
  s = Q.submitAnswer(s, one.answer, T0).session;        /* 先答对一次 */
  const good = s.cards[one.qid];
  assert.ok(good.reps >= 1 && good.interval >= 1, "答对应建立正常卡片");
  /* 再开一轮，同一道题答错 */
  let s2 = Q.startSession(mini, good, { size: 1, now: T0 + 10 * DAY });
  assert.equal(s2.items[0].q.qid, one.qid);
  s2 = Q.submitAnswer(s2, (one.answer + 1) % one.options.length, T0 + 10 * DAY).session;
  const bad = s2.cards[one.qid];
  assert.equal(bad.reps, 0, "答错后连续次数必须归零");
  assert.equal(bad.interval, 1, "答错后必须明天重来");
  assert.equal(bad.lapses, 1, "答错要记为 lapse");
  assert.equal(bad.due - (T0 + 10 * DAY), DAY, "答错的题不能被推到很久以后");
  /* 而且它必须被重新排进队，否则错题就消失了 */
  const st = Q.stats(mini, bad, T0 + 10 * DAY);
  assert.equal(st.mastered, 0, "答错后不能仍算已掌握");
  assert.equal(Q.pickDue(mini, bad, T0 + 10 * DAY, 1)[0].q.qid, one.qid, "错题必须优先重现");
});

/* ---------------- 选题队列 ---------------- */
test("选题：未做过的题优先于已掌握的题", () => {
  const all = BANK.questions;
  const cards = {};
  all.slice(0, 30).forEach((q) => { cards[q.qid] = { reps: 5, interval: 90, due: T0 + 90 * DAY, lapses: 0 }; });
  const picked = Q.pickDue(BANK, cards, T0, 10).map((i) => i.q);
  assert.ok(picked.every((q) => !cards[q.qid]), "已掌握的题不应排在未学题前面");
  assert.equal(picked.length, 10);
});

test("选题：到期的排在没到期的前面", () => {
  const all = BANK.questions;
  const cards = {};
  all.forEach((q, i) => { cards[q.qid] = { reps: 2, interval: 10, due: T0 + (i % 2 ? 5 : -5) * DAY, lapses: 0 }; });
  const picked = Q.pickDue(BANK, cards, T0, 8).map((i) => i.q);
  assert.ok(picked.every((q) => cards[q.qid].due <= T0), "逾期题未优先");
});

test("选题：做错过的题会被重新排进队（lapses>0 且未重新掌握）", () => {
  const q0 = BANK.questions[0];
  const cards = {};
  cards[q0.qid] = { reps: 0, interval: 1, due: T0 + DAY, lapses: 1 };
  const picked = Q.pickDue(BANK, cards, T0, 3).map((i) => i.q);
  assert.equal(picked[0].qid, q0.qid, "错题必须优先重现");
});

test("选题：题量被夹在 1..30，脏数据不崩", () => {
  assert.equal(Q.pickDue(BANK, {}, T0, 0).length, 1);
  assert.equal(Q.pickDue(BANK, {}, T0, 999).length, Math.min(30, BANK.count));
  assert.equal(Q.pickDue(null, null, T0, 5).length, 0, "空题库应返回 0 题而不是造题");
  assert.equal(Q.pickDue({ questions: [] }, {}, T0, 5).length, 0);
});

/* ---------------- 统计 ---------------- */
test("统计：掌握线卡在 reps>=3 且间隔>=21 天，没到线不算掌握", () => {
  const q0 = BANK.questions[0], q1 = BANK.questions[1], q2 = BANK.questions[2];
  const cards = {};
  cards[q0.qid] = { reps: 3, interval: 21, due: T0 + DAY, lapses: 0 };
  cards[q1.qid] = { reps: 5, interval: 5, due: T0 + DAY, lapses: 0 };
  cards[q2.qid] = { reps: 0, interval: 1, due: T0 - DAY, lapses: 1 };
  const s = Q.stats(BANK, cards, T0);
  assert.equal(s.total, BANK.count);
  assert.equal(s.seen, 3);
  assert.equal(s.mastered, 1, "间隔只有 5 天的不能算掌握");
  assert.equal(s.due, 1);
  assert.equal(s.lapsed, 1);
  assert.equal(s.fresh, BANK.count - 3);
});

/* ---------------- 会话状态机 ---------------- */
test("会话：全程答对，进度条不倒退、卡片被写到会话里", () => {
  let s = Q.startSession(BANK, {}, { size: 5, now: T0 });
  assert.equal(s.items.length, 5);
  assert.equal(s.done, false);
  let guard = 0;
  while (!s.done && guard++ < 50) {
    const q = s.items[s.idx].q;
    s = Q.submitAnswer(s, q.answer, T0).session;
    assert.equal(s.result.correct, true);
    s = Q.advance(s, T0);
  }
  assert.equal(s.done, true, "会话没有结束（可能死循环）");
  assert.equal(s.wrong, 0);
  assert.ok(guard < 50);
  for (const q of BANK.questions.slice(0, 5)) {
    assert.ok(s.cards[q.qid], "答过的题必须有记忆卡");
  }
});

test("会话：答错会重排到队尾并允许一次重试，重试后不再无限循环", () => {
  let s = Q.startSession(BANK, {}, { size: 3, now: T0 });
  const q = s.items[0].q;
  s = Q.submitAnswer(s, (q.answer + 1) % q.options.length, T0).session;
  assert.equal(s.result.correct, false);
  const before = s.items.length;
  s = Q.advance(s, T0);
  assert.equal(s.items.length, before + 1, "答错的题应追加到队尾");
  assert.equal(s.items[s.idx].firstTry, true, "当前题应是新题");
  /* 找到被重排的那题，验证它在队尾且 firstTry 已降级 */
  const at = s.items.map((i) => (i ? i.q.qid : null)).lastIndexOf(q.qid);
  assert.equal(at, s.items.length - 1, "重排的题应在队尾");
  assert.equal(s.items[at].firstTry, false);
  assert.equal(s.items[at].retry, true);
  assert.equal(s.items[0], null, "已答过的槽位应清空，避免重复出题");
});

test("会话：未判题不能跳下一题（避免竞态丢进度）", () => {
  const s = Q.startSession(BANK, {}, { size: 3, now: T0 });
  const before = s.idx;
  const same = Q.advance(s, T0);
  assert.equal(same.idx, before, "没判题就 advance 不应推进");
  assert.equal(same.result, null);
  /* 已判完但未 advance 时，重复提交必须被拒——否则连点两下会改分 */
  const answered = Q.submitAnswer(s, s.items[0].q.answer, T0).session;
  assert.equal(Q.submitAnswer(answered, 0, T0).grade, null, "已判题未推进时不应再判");
  /* 整轮跑完后彻底锁死 */
  let done = Q.startSession(BANK, {}, { size: 1, now: T0 });
  let g = 0;
  while (!done.done && g++ < 10) {
    const q = done.items[done.idx].q;
    done = Q.advance(Q.submitAnswer(done, q.answer, T0).session, T0);
  }
  assert.equal(done.done, true);
  assert.equal(Q.submitAnswer(done, 0, T0).grade, null, "已结束的会话不应再判题");
});

test("会话：重复提交同一题的答案不会污染统计", () => {
  let s = Q.startSession(BANK, {}, { size: 3, now: T0 });
  const q = s.items[0].q;
  const a = Q.submitAnswer(s, q.answer, T0).session;
  const b = Q.submitAnswer(a, q.answer, T0).session;
  assert.equal(b.right, a.right, "重复判题不应重复计分");
  assert.equal(b.result, a.result, "重复判题不应改变结果");
});

test("会话：全答错也能正常收敛（不会出现死循环）", () => {
  let s = Q.startSession(BANK, {}, { size: 3, now: T0 });
  let guard = 0;
  while (!s.done && guard++ < 200) {
    const q = s.items[s.idx].q;
    s = Q.submitAnswer(s, (q.answer + 1) % q.options.length, T0).session;
    s = Q.advance(s, T0);
  }
  assert.ok(s.done, "全答错时会话不收敛");
  assert.ok(guard < 200, "重试次数失控: " + guard);
  /* 每题最多 2 次尝试 = 3 次排队 */
  assert.ok(guard <= 3 * 3 + 3, "重试次数过多: " + guard);
});
