/* ============================================================================
 * 学习单元 · 核心逻辑（纯函数，无 DOM、无 localStorage、无网络）
 *
 * 为什么要有这个：用户明确指出「K12 还只是停留在打开资源链接的阶段」，
 * 整个站还是个分类站。症结不是样式，是**学习动作本身不存在**：
 * 卡片只有 <a href>，点开、看完、关掉，站内不留任何痕迹，
 * 所以既没有「学会了吗」的判据，也没有「和别人学」的入口。
 *
 * 这里把一张死链变成一个学习单元，四步、每一步都有站内留下的证据：
 *
 *   ① 答（retrieval）  先不看原文，用自己的话写一句要点。
 *                      这是整个设计的核心：提取练习必须发生在接触材料**之前**。
 *                      先看再答，学到的是「认得出来」；先答再看，学到的才是「想得起来」。
 *   ② 读（exposure）  带着自己那一句去读原文。
 *   ③ 照（compare）   回来和自己的答案并排看，差在哪。
 *   ④ 传（transfer）  产出一个最小可交付物，并可把卡点抛给同伴。
 *
 * 与「刷题」的区别：刷题考的是能不能背下标准答案；
 * 这里第 ① 步没有标准答案可比，用户写什么都算过，
 * 真正被检验的是第 ③ 步「你以为自己懂了」和「实际懂了」的落差。
 *
 * 全部数据留在 localStorage：不上传、不注册、不建账号。
 * ========================================================================== */
window.LEARN_CORE = (function () {
  "use strict";

  /* ---------- 交付物：每个赛道一个「最小可完成」的产出 ----------
     设计依据：读了不算学会，能产出一个别人能看的东西才算。
     交付物必须小到「今天就能做完」，否则又回到收藏夹里吃灰。 */
  var DELIVERABLES = {
    k12: [
      { id: "teach", text: "讲给一个人听（口播 1 分钟）", hint: "能把 3 年级讲明白，才算真懂" },
      { id: "card", text: "做一张知识卡（正面问题 / 背面答案）", hint: "明天能考自己" },
      { id: "demo", text: "现场演示一遍（讲义/实验/操作）", hint: "能跑通才算学会" },
    ],
    default: [
      { id: "teach", text: "用自己的话复述一遍（3 句话）", hint: "复述不出来 = 没读懂" },
      { id: "card", text: "做一张知识卡（正面问题 / 背面答案）", hint: "明天能考自己" },
      { id: "apply", text: "在自己的场景里试一次", hint: "能跑通才算学会" },
    ],
  };

  /* 学段越低，交付物越偏「讲给别人听」而不是「写给自己看」——
     家长陪着学的场景里，能讲出口比能写出来更能暴露没懂的地方。
     取值必须和上面 DELIVERABLES 里的 id 对得上：之前这里写的是 "oral"，
     而池子里根本没有这个 id，filter 落空就静默退回整池随机，
     于是「低学段要讲给孩子听」这条设计等于没生效。 */
  var STAGE_KIND = {
    preschool: "teach", primary: "teach", junior: "teach",
    senior: "card", college: "apply", adult: "apply", work: "apply",
  };
  /* 每个学段在该赛道池里的替代项：主选项不存在时的退路。
     k12 池里没有 apply，用 demo 顶上，语义上是「跑一遍给家长看」。 */
  var STAGE_FALLBACK = { apply: "demo" };

  /* ---------- 赛道/学段归一 ---------- */
  function normTrack(t) {
    return String(t || "").trim().toLowerCase();
  }
  function deliverableFor(item) {
    item = item || {};
    var track = normTrack(item.track);
    var pool = DELIVERABLES[track] || DELIVERABLES.default;
    var kind = STAGE_KIND[normTrack(item.stage)] || "";
    // 用 id 做稳定选择：同一条内容每次刷新给的是同一个交付物，
    // 否则用户昨天做的「知识卡」今天变成「演示」，进度就断了。
    var seed = 0;
    var key = String(item.id || item.url || item.title || "");
    for (var i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
    if (kind) {
      var alt = STAGE_FALLBACK[kind];
      var pref = pool.filter(function (d) { return d.id === kind || d.id === alt; });
      if (pref.length) return pref[seed % pref.length];
    }
    // 没有学段信息（或该赛道没有对应交付物）时，在整池里按 id 稳定取。
    // 这里刻意不塌缩到某一个固定项：所有人拿到同一句「去做张知识卡」，
    // 就退化成了换个壳的刷题，正好是这块要摆脱的东西。
    return pool[seed % pool.length];
  }

  /* ---------- 四步状态机 ----------
     rec = { text, at }，read = { at }（用户点开原文时打点）
     顺序是有意的：先答才允许打「已读」，否则「读了」这个状态毫无意义
     —— 谁都能点开一个链接。 */
  var STEPS = ["answer", "read", "compare", "deliver"];

  function unitState(rec, readAt) {
    if (!rec || !String(rec.text || "").trim()) return "new";
    if (!readAt) return "recalled";
    if (!rec.delivered) return "compared";
    return "done";
  }

  /** 进度：已完成 / 进行中 / 未开始。用于卡片角标和总览统计。 */
  function unitProgress(rec, readAt) {
    var s = unitState(rec, readAt);
    if (s === "done") return { done: true, ratio: 1, step: "deliver" };
    if (s === "new") return { done: false, ratio: 0, step: "answer" };
    var i = s === "recalled" ? 1 : 2;
    return { done: false, ratio: i / STEPS.length, step: s === "recalled" ? "read" : "compare" };
  }

  /** 提示语：卡在哪一步就说什么，不说空话。 */
  function nudge(state) {
    return {
      new: "先别点开原文，用一句话写出这篇讲了什么",
      recalled: "现在去读原文，回来和你的答案并排看",
      compared: "还差最后一步：产出一个别人能看的东西",
      done: "已完成",
    }[state] || "";
  }

  /* ---------- 提问链接 ----------
     纯静态站没有后端，凭空造不出「互相学习」。
     但本站托管在公开 GitHub 仓库上，Issues 匿名可读，
     于是把 Issues 当问答通道：用户点一下跳到预填好的新建页，
     用 GitHub 自己的账号，不碰本站账号体系。
     预填必须带上赛道/学段标签，否则抓取脚本认不出来、这条提问就白提了。 */
  var REPO = "zoneboys/ai-sidehustle-hub";
  var TRACK_TAGS = { k12: "k12", indie: "indie", remote: "remote", ai: "ai" };

  function askUrl(item, recallText) {
    item = item || {};
    var track = normTrack(item.track);
    var tag = TRACK_TAGS[track];
    var title = String(item.title || "这个问题").trim();
    var body = [
      "**赛道**：" + (track || "general"),
      item.stage ? "**学段**：" + item.stage : "",
      "**卡在哪**：" + (String(recallText || "").trim() || "（读原文时没读懂）"),
      item.url ? "**原文**：" + item.url : "",
      "",
      "<!-- 请把问题写在这里。上面的「卡在哪」会自动带上你写的那句，",
      "     这样别人不用先读一遍原文就知道你卡在哪个点上。 -->",
    ].filter(Boolean).join("\n");
    // 用 URLSearchParams 而不是手拼：标题里有 # & ? 中文空格时会拼坏
    var qs = new URLSearchParams({
      labels: "question" + (tag ? "," + tag : ""),
      title: "[" + (item.stage ? item.stage + " " : "") + track + "] " + title,
      body: body,
    });
    return "https://github.com/" + REPO + "/issues/new?" + qs.toString();
  }

  /* ---------- 同伴互助区排序 ----------
     排序目标不是「热门」，而是「我此刻能帮上忙的那条」。
     1) 没人回答的排前面 —— 那里最缺人；
     2) 同赛道优先 —— 我能看懂才有资格回答；
     3) 再按时间近。 */
  function peerSort(items, track, now) {
    var list = (items || []).slice();
    var t = normTrack(track);
    var n = now || Date.now();
    function age(it) {
      var v = Date.parse(it && it.at);
      return Number.isFinite(v) ? Math.abs(n - v) : Number.MAX_SAFE_INTEGER;
    }
    list.sort(function (a, b) {
      var au = (a.answerCount || 0), bu = (b.answerCount || 0);
      var aOpen = a.solved ? 1 : 0, bOpen = b.solved ? 1 : 0;
      if (aOpen !== bOpen) return aOpen - bOpen;          // 未解决在前
      if (t) {
        var am = normTrack(a.track) === t ? 0 : 1, bm = normTrack(b.track) === t ? 0 : 1;
        if (am !== bm) return am - bm;                     // 同赛道优先
      }
      if (au !== bu) return au - bu;                       // 回答少的更缺人
      return age(a) - age(b);
    });
    return list;
  }

  /** 空态文案：仓库还没有提问时，要明确告诉用户「怎么开始」，
      而不是显示一个空白区块让人以为功能坏了。 */
  function peerEmptyHint() {
    return {
      title: "还没有人提问 —— 你可以是第一个",
      steps: [
        "在上面任意一张学习卡片点「卡住了？问同伴」",
        "内容会带着你写的那句卡点预填好，直接提交即可",
        "别人回答后，每日定时任务会自动把它抓回这里",
      ],
    };
  }

  /* ---------- 总览统计 ---------- */
  function stats(items, recs) {
    var n = (items || []).length;
    var c = { total: n, new: 0, recalled: 0, compared: 0, done: 0 };
    (items || []).forEach(function (it) {
      var s = unitState(recs && recs[it.id], recs && recs[it.id] && recs[it.id].readAt);
      c[s] = (c[s] || 0) + 1;
    });
    c.ratio = n ? (c.recalled + c.compared * 2 + c.done * 4) / (n * 4) : 0;
    return c;
  }

  return {
    DELIVERABLES: DELIVERABLES, STEPS: STEPS,
    deliverableFor: deliverableFor,
    unitState: unitState, unitProgress: unitProgress, nudge: nudge,
    askUrl: askUrl,
    peerSort: peerSort, peerEmptyHint: peerEmptyHint, stats: stats,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = window.LEARN_CORE;
