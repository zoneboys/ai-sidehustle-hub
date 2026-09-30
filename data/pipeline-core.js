/* ============================================================================
 * 行动管线 · 学→做→发→收（纯函数，无 DOM、无 localStorage、无网络）
 *
 * 这是八项需求里的最后一环。诊断器解决的是「发了没流量，卡在哪」；
 * 这一层解决的是「诊断说改了之后，然后呢」。
 *
 * 没有这层时的真实循环是这样的：
 *   诊断说「前 3 秒闸没过」→ 把结论放第一句 → 发出去 → 有没有用？
 *   → 没有地方记录改了什么，7 天后数据有没有动。
 *   → 三周后再诊断，还是这道闸——同一个坑第二次踩，因为上次怎么爬出来的
 *     （或根本没爬出来）没有任何记录。
 *
 * 所以一张行动卡就是一次完整的「假设→实验→回看」循环：
 *   do（去做）→ published（观察中）→ reviewed（已结，有结论）
 *
 * 三个阶段之间是**强制递进**的，跟诊断器的分层是同一个哲学：
 *   - 没写「这次具体改了什么」，不许标已发——否则「改了」会退化成「发了」，
 *     回看时分不清是改法起了作用还是运气；
 *   - 没满 7 天，不许回看——平台数据前三天还在滚动，提前看等于用
 *     样本量不足的数下结论，然后按错误结论放弃一个本来有效的改法。
 *
 * 判定数字（完播率过线 0.25 等）**不在这里复制**：
 * 页面调用时从 RULES_CORE.MECHANISM 取对应机制的 need 传进来。
 * 复制一份，改门槛时漏一处，两个结论就会互相矛盾——这正是
 * 诊断器「两个默认值打架」教训的翻版，由跨文件测试盯住。
 * ========================================================================== */
(function () {
  "use strict";

  /* 每道闸的回看指标：回看时用户该填哪个数。
   * need 不写在这里（从 RULES_CORE 取），但 metric 字段名必须与
   * 诊断器输入字段（RZ_FIELDS 的 k）一致——回看对比的就是同一个数。
   * cadence/sample 的回看指标是「最近 7 天条数 / 总条数」本身。 */
  var GATE_METRIC = {
    cadence:    { field: "recent7", label: "最近 7 天发布条数" },
    sample:     { field: "posts",   label: "已发布总条数" },
    niche:      { field: "median",  label: "最近 10 条的中位播放量" },
    hook:       { field: "finish",  label: "完播率 %（图文填读完率%）" },
    engagement: { field: "eng",     label: "互动率 %" },
    retain:     { field: "dwell",   label: "平均停留/读完 %" },
    follow:     { field: "followsPer", label: "单条涨粉数" },
    ceiling:    { field: "bestOverMedian", label: "最高/中位播放倍数" },
  };

  var DAY = 86400000;
  /* 观察期：平台数据前 3 天还在滚动，7 天才基本稳定。
     这个数字只有这里一份；测试会变异它来验证自己不是空测。 */
  var OBSERVE_DAYS = 7;
  /* 「明显变好」的涨幅线：低于它视为「没动」。
     定 30% 的原因：社交平台的自然波动就能到 ±10~20%，
     拿波动当改进，会让人反复使用无效改法。 */
  var IMPROVE_RATIO = 0.3;

  /* 建卡。baseline 是诊断那一刻的输入快照（rzStore() 的浅拷贝即可，
     这里会再冻结一层），卡与它共存亡：之后用户改了输入框，
     旧卡的基线也不能跟着漂——否则「改进了 30%」就无从谈起。 */
  function createCard(input) {
    var t = Date.now();
    var base = {};
    var src = input.baseline || {};
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) base[k] = src[k];
    }
    return {
      id: "pc-" + t.toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36),
      createdAt: t,
      stage: "do",                 // do → published → reviewed
      platform: String(input.platform || ""),
      gateId: String(input.gateId || ""),
      gateName: String(input.gateName || ""),
      gateLayer: input.gateLayer == null ? null : input.gateLayer,
      /* 该闸对应的回看指标与当时基线值（可能为 null = 当时有没填） */
      metric: (GATE_METRIC[input.gateId] || {}).field || null,
      metricLabel: (GATE_METRIC[input.gateId] || {}).label || "回看指标",
      before: numOrNull(base[input.gateId ? (GATE_METRIC[input.gateId] || {}).field : null]),
      baseline: base,
      changed: "",                 // 这次具体改了什么（publish 前必须填）
      publishedAt: null,
      after: null,                 // 回看时填的数
      reviewedAt: null,
      verdict: null,               // pass / improved / flat / worse
      note: String(input.note || ""),
    };
  }

  function numOrNull(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /* 推进阶段。返回 {ok, reason}：不 ok 时 reason 是给人看的一句话，
     页面原样展示——违反递进条件不该是静默失败。 */
  function advance(card, now) {
    now = now == null ? Date.now() : now;
    if (!card) return { ok: false, reason: "卡不存在" };
    if (card.stage === "do") {
      var c = String(card.changed || "").trim();
      if (c.length < 4) {
        return { ok: false, reason: "先写清楚这次具体改了什么（至少 4 个字）。没写改动，「改了」就会退化成「发了」，回看时分不清作用。" };
      }
      card.stage = "published";
      card.publishedAt = now;
      return { ok: true, reason: "" };
    }
    if (card.stage === "published") {
      var left = daysLeft(card, now);
      if (left > 0) {
        return { ok: false, reason: "还剩 " + left + " 天观察期。平台数据前 3 天还在滚动，提前看会用样本量不足的数下结论。" };
      }
      return { ok: false, reason: "观察期已满：请填「现在的 " + card.metricLabel + "」再点回看。" };
    }
    return { ok: false, reason: "这张卡已经结了。" };
  }

  /* 回看：填入 after（该闸指标现在的值）与 need（该闸的过线值，
     由页面从 RULES_CORE 取——这里不复制数字）。 */
  function review(card, after, need, now) {
    now = now == null ? Date.now() : now;
    if (!card || card.stage !== "published") {
      return { ok: false, reason: "只有「观察中」的卡能回看" };
    }
    if (daysLeft(card, now) > 0) {
      return { ok: false, reason: "观察期未满（还剩 " + daysLeft(card, now) + " 天），数据还在滚动" };
    }
    var a = numOrNull(after);
    if (a == null) return { ok: false, reason: "请填现在的 " + card.metricLabel };
    card.after = a;
    card.reviewedAt = now;
    /* card.verdict 只存字符串（sanitize/stats 都按它匹配）；
       判定对象（含 delta）从返回值给页面展示。之前把整个对象存进卡里，
       聚合永远匹配不上——单测抓到的。 */
    var j = judge(card.before, a, need);
    card.verdict = j.verdict;
    card.stage = "reviewed";
    return { ok: true, verdict: j.verdict, delta: j.delta };
  }

  /* 单次判定。
     pass     过线了（after >= need）——改法有效且达标
     improved 没过线但涨幅 >= 30% ——改法方向对，继续按这个改
     flat     基本没动 ——这个改法对这道闸没用，别再重复
     worse    变差了 ——回诊断器重看
     before 为 null（建卡时没填基线）时只能按过线判：
     拿不到涨幅就拿不到，不能拿 0 当基线——那会把「不知道」算成「很差」。 */
  function judge(before, after, need) {
    var passed = need != null && isFinite(need) && after >= need;
    var delta = null;
    if (before != null && before > 0) {
      delta = (after - before) / before;
    }
    if (passed) return { verdict: "pass", delta: delta };
    if (delta == null) return { verdict: "flat", delta: null };
    if (delta >= IMPROVE_RATIO) return { verdict: "improved", delta: delta };
    if (delta <= -0.1) return { verdict: "worse", delta: delta };
    return { verdict: "flat", delta: delta };
  }

  function daysLeft(card, now) {
    now = now == null ? Date.now() : now;
    if (!card || !card.publishedAt) return 0;
    var end = card.publishedAt + OBSERVE_DAYS * DAY;
    return Math.max(0, Math.ceil((end - now) / DAY));
  }

  /* 聚合：页面顶部一条概览 + 「有效改动清单」。
     有效清单是这层的真正产出：用户自己的「什么改法对我有效」手册，
     从所有 improved/pass 的卡里提取改法文本，同文去重。 */
  function stats(cards, now) {
    cards = cards || [];
    var doing = 0, watching = 0, done = 0, effective = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.stage === "do") doing++;
      else if (c.stage === "published") watching++;
      else {
        done++;
        if (c.verdict === "pass" || c.verdict === "improved") {
          var key = String(c.changed || "").trim();
          if (key && !seen[key]) { seen[key] = true; effective.push(key); }
        }
      }
    }
    return { total: cards.length, doing: doing, watching: watching, done: done, effective: effective };
  }

  /* 从 localStorage 读回来的数据不能直接信：坏卡丢掉，好卡保留。
     一个损坏的条目不应该炸掉整个清单。 */
  function sanitize(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (!c || typeof c !== "object") continue;
      if (!c.id || !c.gateId || !c.stage) continue;
      if (["do", "published", "reviewed"].indexOf(c.stage) < 0) continue;
      if (c.stage !== "do" && !c.publishedAt) continue;   // 观察中的卡必须有发布时间，否则观察期算不出来
      out.push({
        id: String(c.id),
        createdAt: +c.createdAt || Date.now(),
        stage: c.stage,
        platform: String(c.platform || ""),
        gateId: String(c.gateId),
        gateName: String(c.gateName || c.gateId),
        gateLayer: c.gateLayer == null ? null : +c.gateLayer,
        metric: String(c.metric || ""),
        metricLabel: String(c.metricLabel || ""),
        before: numOrNull(c.before),
        baseline: (c.baseline && typeof c.baseline === "object") ? c.baseline : {},
        changed: String(c.changed || ""),
        publishedAt: c.publishedAt ? +c.publishedAt : null,
        after: numOrNull(c.after),
        reviewedAt: c.reviewedAt ? +c.reviewedAt : null,
        verdict: ["pass", "improved", "flat", "worse"].indexOf(c.verdict) >= 0 ? c.verdict : null,
        note: String(c.note || ""),
      });
    }
    return out;
  }

  window.PIPELINE_CORE = {
    GATE_METRIC: GATE_METRIC,
    OBSERVE_DAYS: OBSERVE_DAYS,
    IMPROVE_RATIO: IMPROVE_RATIO,
    createCard: createCard,
    advance: advance,
    review: review,
    judge: judge,
    daysLeft: daysLeft,
    stats: stats,
    sanitize: sanitize,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = window.PIPELINE_CORE;
})();
