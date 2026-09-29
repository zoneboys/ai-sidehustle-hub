/* ============================================================================
 * 主动回忆训练 · 核心逻辑（纯函数，无 DOM、无 localStorage）
 *
 * 设计前提：用户明确不要「刷题」。
 * 刷题考的是「能不能背下答案」，而 AI 让「拿到答案」变得免费，
 * 真正稀缺的是「能不能判断一个答案对不对」。
 * 所以这里所有题目都从手册的真实数据反向生成，答案是唯一确定的，
 * 干扰项也全部取自站内真实内容——没有编造的假知识。
 *
 * 五种题型都指向判断力，不是记忆力：
 *   trap    坑位识别 —— 这句话是「警告」还是「正确建议」？
 *   next    下一步   —— 刚做完这一步，接下来该做什么？
 *   tool    工具匹配 —— 这个动作用哪个工具？（干扰项来自别的手册）
 *   who     适配筛查 —— 哪个人最不适合做这件事？
 *   income  收益预期 —— 第一笔钱的时间预期，避免「实操后没效果」的落差
 *
 * 题目 id 由「手册 id + 题型 + 下标」组成，与干扰项无关：
 * 站内以后新增手册，已有题目的正确答案不会漂移，SM-2 记忆卡不会错位。
 * ========================================================================== */
window.QUIZ_CORE = (function () {
  "use strict";

  /* ---------- 确定性随机：同一个种子永远得到同一顺序 ---------- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rng(seed) {
    let a = typeof seed === "string" ? hash(seed) : seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /* 从 candidates 里取 n 个干扰项（与 correct 自身不重复） */
  function distractors(candidates, correct, n, rand) {
    const uniq = [];
    const seen = Object.create(null);
    /* 候选项不保证带 id（工具就是 {n,use}），所以用 id 优先、文本兜底 */
    const key = (c) => String(c && c.id != null ? c.id : c && c.n != null ? c.n : c && c.text);
    seen[key(correct)] = 1;
    const pool = shuffled(candidates, rand);
    for (const c of pool) {
      if (uniq.length >= n) break;
      if (!c || seen[key(c)]) continue;
      seen[key(c)] = 1;
      uniq.push(c);
    }
    return uniq;
  }
  function clip(s, n) {
    const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  }
  /* 手册里某些字段可能缺失，缺了就少出这种题，不硬凑 */
  function has(p, k) {
    const v = p && p[k];
    return Array.isArray(v) ? v.length > 0 : !!String(v == null ? "" : v).trim();
  }

  /* ---------- 题型 1：坑位识别 ----------
     拿手册里真实的「坑」和真实的「正确做法」混在一起，让用户判断
     哪句是该警惕的警告。选项内容全部来自原文，答案唯一。 */
  function genTrap(p, i) {
    const traps = p.traps || [];
    const rand = rng(p.id + ":trap:" + i);
    if (!traps.length) return null;
    const correct = traps[i % traps.length];
    /* 干扰项必须全部是「不是坑」的真实句子（阶段动作 / 前置条件），
     * 否则就会出现「题干问哪个是坑、答案却不是坑」的反转题。 */
    const good = (p.phases || []).map((ph) => ({ id: "ph:" + ph.d, text: ph.do }));
    if (has(p, "prereq")) good.push({ id: "pre", text: p.prereq });
    if (good.length < 2) return null;
    const others = distractors(good, { id: "x", text: correct }, 2, rand);
    if (others.length < 2) return null;
    const opts = shuffled(
      [{ id: "correct", text: clip(correct, 90) }]
        .concat(others.map((o) => ({ id: "w", text: clip(o.text, 90) }))),
      rand
    );
    return {
      qid: p.id + ":trap:" + i,
      pb: p.id, cat: p.cat, type: "trap", level: 1,
      stem: "下面哪一句是《" + p.title + "》明确警告你要避开的坑？",
      options: opts,
      answer: opts.findIndex((o) => o.id === "correct"),
      explain: "手册原文列为坑：" + correct +
        "　——判断依据：坑会让人<b>做错事或白花钱</b>；其余选项是正确做法，它们只会推进进度。",
      source: { pb: p.id, field: "traps", label: "踩坑清单" },
    };
  }

  /* ---------- 题型 2：下一步 ----------
     考的是顺序背后的逻辑：为什么不能跳步。干扰项是同本手册其他天的动作。 */
  function genNext(p, i) {
    const ph = p.phases || [];
    if (ph.length < 3) return null;
    const idx = 1 + (i % (ph.length - 2));   // 不出第 1 步（没有前置），不出最后一步（没有下一步）
    const cur = ph[idx - 1], next = ph[idx];
    const rand = rng(p.id + ":next:" + i);
    const pool = ph.map((x) => ({ id: "ph:" + x.d, text: x.do }));
    const others = distractors(pool, pool[idx], 3, rand);
    if (others.length < 3) return null;
    const opts = shuffled([{ id: "correct", text: clip(next.do, 90) }]
      .concat(others.map((o) => ({ id: "w", text: clip(o.text, 90) }))), rand);
    return {
      qid: p.id + ":next:" + i,
      pb: p.id, cat: p.cat, type: "next", level: 2,
      stem: "《" + p.title + "》里你刚完成「" + clip(cur.d + "：" + cur.do, 60) + "」，下一步应该做什么？",
      options: opts,
      answer: opts.findIndex((o) => o.id === "correct"),
      explain: "正确顺序是「" + next.d + "：" + next.do + "」　——完成标准：" + next.done +
        "　跳步的代价：这一步是为了让上一步的产出可验证，提前做等于没有依据。",
      source: { pb: p.id, field: "phases", label: "阶段清单" },
    };
  }

  /* ---------- 题型 3：工具匹配 ----------
     干扰项全部来自<b>其他手册</b>的真实工具，所以选错就意味着
     「你把这个场景的默认工具记成另一个赛道的」。 */
  function genTool(p, i, allTools) {
    const tools = p.tools || [];
    if (!tools.length) return null;
    const t = tools[i % tools.length];
    const rand = rng(p.id + ":tool:" + i);
    const others = distractors(allTools, t, 3, rand);
    if (others.length < 3) return null;
    const opts = shuffled([{ id: "correct", text: t.n + "（" + clip(t.use, 46) + "）" }]
      .concat(others.map((o) => ({ id: "w", text: o.n + "（" + clip(o.use, 46) + "）" }))), rand);
    return {
      qid: p.id + ":tool:" + i,
      pb: p.id, cat: p.cat, type: "tool", level: 2,
      stem: "在《" + p.title + "》里要做的事是「" + clip(t.use, 52) + "」，该用哪个工具？",
      options: opts,
      answer: opts.findIndex((o) => o.id === "correct"),
      explain: "选 " + t.n + "：" + t.use + "　——判断依据：先看用途再看名字，工具会换，用途不会。",
      source: { pb: p.id, field: "tools", label: "工具清单" },
    };
  }

  /* ---------- 题型 4：适配筛查 ----------
     「哪个人最不适合」。干扰项是其他手册真实的「适合人群」，
     逼用户读条件而不是看标题。 */
  function genWho(p, i, allWho) {
    if (!has(p, "who")) return null;
    const rand = rng(p.id + ":who:" + i);
    const others = distractors(allWho, { id: p.id, text: p.who }, 3, rand);
    if (others.length < 3) return null;
    const opts = shuffled([{ id: "correct", text: p.who }]
      .concat(others.map((o) => ({ id: "w", text: o.text }))), rand);
    return {
      qid: p.id + ":who:" + i,
      pb: p.id, cat: p.cat, type: "who", level: 1,
      stem: "下面哪个人<b>最不适合</b>做《" + p.title + "》？",
      options: opts,
      answer: opts.findIndex((o) => o.id === "correct"),
      explain: "本手册写明的前提是：" + p.prereq + "　——判断依据：先看前提能不能满足，再看想不想做。",
      source: { pb: p.id, field: "who", label: "适合人群 / 前置" },
    };
  }

  /* ---------- 题型 5：收益预期 ----------
     这条直接对着用户的痛点：实操后没效果，多数不是不努力，
     而是当初对第一笔收入的时间预期错了。 */
  function genIncome(p, i, allPb) {
    if (!has(p, "income")) return null;
    const rand = rng(p.id + ":income:" + i);
    const others = distractors(allPb, p, 3, rand);
    if (others.length < 3) return null;
    const opts = shuffled([{ id: "correct", text: p.time + "　（" + clip(p.income, 40) + "）" }]
      .concat(others.map((o) => ({ id: "w", text: o.time }))), rand);
    return {
      qid: p.id + ":income:" + i,
      pb: p.id, cat: p.cat, type: "income", level: 2,
      stem: "如果现在就按《" + p.title + "》的节奏做，多久能拿到<b>第一笔</b>收入？",
      options: opts,
      answer: opts.findIndex((o) => o.id === "correct"),
      explain: p.income + "　——判断依据：副业失败最常见的原因不是执行力差，是把「没到时间」误判成「这条路不行」。",
      source: { pb: p.id, field: "income", label: "收入预期" },
    };
  }

  /* ---------- 题库构建 ---------- */
  function buildBank(playbooks) {
    const list = (playbooks || []).filter(Boolean);
    const allTools = [], allWho = [];
    for (const p of list) {
      (p.tools || []).forEach((t) => { if (t && t.n) allTools.push(t); });
      if (has(p, "who")) allWho.push({ id: p.id, text: p.who });
    }
    const questions = [];
    for (const p of list) {
      const gens = [
        (i) => genTrap(p, i), (i) => genNext(p, i),
        (i) => genTool(p, i, allTools), (i) => genWho(p, i, allWho),
        (i) => genIncome(p, i, list),
      ];
      gens.forEach((gen) => {
        for (let i = 0; i < 4; i++) {
          const q = gen(i);
          if (q) questions.push(q);
        }
      });
    }
    /* 去重：不同 i 可能生成同一条（数据重复时），qid 相同会互相覆盖 */
    const byId = Object.create(null);
    for (const q of questions) if (!byId[q.qid]) byId[q.qid] = q;
    const final = Object.keys(byId).map((k) => byId[k]);
    return { questions: final, byId: byId, count: final.length };
  }

  /* ---------- 判题 ----------
     输入是用户点的选项下标；返回是否正确、正确答案下标、讲解。
     不会因为「选错」就终止——判题是产品的一部分，不是惩罚。 */
  function grade(q, picked) {
    if (!q || !Array.isArray(q.options) || !q.options.length) {
      return { ok: false, correct: false, reason: "bad-question" };
    }
    const i = Number(picked);
    if (!Number.isInteger(i) || i < 0 || i >= q.options.length) {
      return { ok: false, correct: false, reason: "no-answer" };
    }
    return {
      ok: true,
      correct: i === q.answer,
      picked: i,
      answer: q.answer,
      explain: q.explain || "",
      source: q.source || null,
    };
  }

  /* ---------- SM-2 间隔重复 ----------
     q 为 0-5 的质量分（这里由对错映射，见 qualityOf）。
     失败一次直接回到起点，但保留已积累的熟练度不会被清零，
     否则用户答错一次就前功尽弃，体验上等于惩罚。 */
  function sm2(card, quality, now) {
    const c = card && typeof card === "object" ? card : {};
    const t = Number(now || Date.now());
    let ef = typeof c.ef === "number" && c.ef >= 1.3 ? c.ef : 2.5;
    let reps = typeof c.reps === "number" && c.reps >= 0 ? c.reps : 0;
    let lapses = typeof c.lapses === "number" && c.lapses >= 0 ? c.lapses : 0;
    let interval = typeof c.interval === "number" && c.interval > 0 ? c.interval : 0;
    let due = typeof c.due === "number" && c.due > 0 ? c.due : 0;
    if (!due) { reps = 0; interval = 0; }          // 首次作答
    if (quality < 3) {
      reps = 0; lapses += 1; interval = 1;         // 明天重来
    } else {
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.round(interval * ef);
      if (interval > 180) interval = 180;           // 封顶 180 天，避免「一劳永逸」
    }
    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ef < 1.3) ef = 1.3;
    return {
      ef: Math.round(ef * 1000) / 1000,
      reps: reps, lapses: lapses, interval: interval,
      due: t + interval * 86400000,
      last: t,
    };
  }
  /* 对错 → SM-2 质量分。
   * 关键：答错必须 < 3，否则 SM-2 会当成「成功回忆」把复习间隔拉长——
   * 那是这套系统最不能出的错：用户答错了，下次却不再见到这道题。
   * 所以这里只区分「一次就对」和「重试后才对」，不区分错了几次。 */
  function qualityOf(gradeResult, firstTry) {
    if (!gradeResult || !gradeResult.ok) return 0;
    if (!gradeResult.correct) return 1;
    return firstTry ? 5 : 3;
  }

  /* ---------- 选题队列 ----------
     优先级：错题 > 到期复习 > 未学过 > 已掌握（拿来保持手感）。
     每次出题都带 firstTry=true；答错后重排到队尾并允许一次重试。 */
  function pickDue(bank, cards, now, limit) {
    const t = Number(now || Date.now());
    const n = limit == null ? 10 : Math.max(1, Math.min(30, Number(limit) || 0));
    const qs = (bank && bank.questions) || [];
    const c = cards || {};
    const fresh = [], due = [], mastered = [];
    for (const q of qs) {
      const card = c[q.qid];
      if (!card) { fresh.push(q); continue; }
      if ((card.lapses || 0) > 0 && card.reps < 2) { fresh.push(q); continue; }
      if (card.due && card.due <= t) due.push(q);
      else mastered.push(q);
    }
    const rank = (q) => ((c[q.qid] && c[q.qid].due) || 0) - t;
    due.sort((a, b) => rank(a) - rank(b));
    const picked = fresh.concat(due).concat(mastered).slice(0, n);
    return picked.map((q) => ({ q: q, firstTry: true, retry: false }));
  }

  /* ---------- 统计 ----------
     mastered 的判定用 reps>=3 且 lapse 长期不再发生（interval 达到 21 天），
     低于这个线就说「掌握」是自欺欺人。 */
  function stats(bank, cards, now) {
    const t = Number(now || Date.now());
    const qs = (bank && bank.questions) || [];
    const c = cards || {};
    let seen = 0, mastered = 0, fresh = 0, dueCount = 0, lapsed = 0;
    for (const q of qs) {
      const card = c[q.qid];
      if (!card) { fresh++; continue; }
      seen++;
      if ((card.lapses || 0) > 0) lapsed++;
      if (card.reps >= 3 && (card.interval || 0) >= 21) mastered++;
      if (card.due && card.due <= t) dueCount++;
    }
    return {
      total: qs.length, seen: seen, fresh: fresh,
      mastered: mastered, due: dueCount, lapsed: lapsed,
      pct: qs.length ? Math.round((mastered / qs.length) * 100) : 0,
    };
  }

  /* ---------- 一轮训练的会话状态机 ----------
     纯函数，不碰 DOM / localStorage，浏览器侧只负责存取快照。
     约定：submitAnswer 只判题不改进度，advance 才推进。
     合并成一步会导致「题还没看完就跳下一题」的竞态。 */
  function startSession(bank, cards, opts) {
    const o = opts || {};
    const n = o.size || 10;
    return {
      items: pickDue(bank, cards, o.now, n),
      idx: 0,
      right: 0, wrong: 0, firstRight: 0,
      picked: null, result: null,
      cards: Object.assign({}, cards || {}),
      done: false,
      startedAt: o.now || Date.now(),
    };
  }
  function submitAnswer(session, picked, now) {
    if (!session || session.done || session.result) return { session: session, grade: null };
    const item = session.items[session.idx];
    if (!item) return { session: session, grade: null };
    const g = grade(item.q, picked);
    const q = qualityOf(g, item.firstTry);
    const card = sm2(session.cards[item.q.qid], q, now);
    const cards = Object.assign({}, session.cards);
    cards[item.q.qid] = card;
    const next = Object.assign({}, session, {
      picked: picked, result: g,
      right: session.right + (g.correct ? 1 : 0),
      wrong: session.wrong + (g.correct ? 0 : 1),
      firstRight: session.firstRight + (g.correct && item.firstTry ? 1 : 0),
      cards: cards,
    });
    return { session: next, grade: g };
  }
  function advance(session, now) {
    if (!session || !session.result) return session;
    /* 答错的题排到队尾再给一次机会（firstTry=false，质量分下调）；
     * 但不无限重试：一轮里每题最多 2 次。
     * 当前槽位置 null 而不是删除——否则会话状态难以对齐，删了就只剩长度变化。 */
    const item = session.items[session.idx];
    const again = !session.result.correct && item && item.firstTry;
    const items = session.items.slice();
    items[session.idx] = null;
    if (again) {
      items.push({ q: item.q, firstTry: false, retry: true });
    }
    const idx = session.idx + 1;
    if (idx >= items.length) {
      return Object.assign({}, session, { items: items, idx: 0, picked: null, result: null, done: true });
    }
    return Object.assign({}, session, { items: items, idx: idx, picked: null, result: null });
  }

  return {
    buildBank: buildBank, grade: grade, sm2: sm2,
    qualityOf: qualityOf, pickDue: pickDue, stats: stats,
    startSession: startSession, submitAnswer: submitAnswer, advance: advance,
    /* 导出内部工具供测试白盒验证 */
    _hash: hash, _rng: rng,
  };
})();
