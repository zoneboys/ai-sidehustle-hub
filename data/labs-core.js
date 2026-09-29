/* ============================================================================
 * 三轨深度学习 · 核心逻辑（纯函数，无 DOM、无 localStorage、无网络）
 *
 * 起因：用户指出「K12 还只是打开资源链接的阶段，整个站就是个分类网站」。
 * 分类站和深度学习的分界线只有一条——**学习动作是否发生在站内**。
 *
 * 这一层把三个真实开源仓库接进来，方式是「读它们的源码」而不是「介绍它们」：
 * 每条课的 `src` 字段都是该仓库里真实存在的文件/目录路径。
 * 深度学习由此可核对，不是我编的知识点。
 *
 * 三轨性质完全不同，不能一视同仁：
 *   轨1 聪聪学堂   已上线的可运行产品（MIT）→ 站内 iframe 当引擎，只加前后两层
 *   轨2 EduAgent   arXiv 2404.07963 学术研究 → 只能读源码，不能嵌
 *   轨3 EduAgentX  Java 后端微服务（10 个）→ 同上，且只面向想自己做产品的人
 * ========================================================================== */
window.LABS_CORE = (function () {
  "use strict";

  /* ---------- 三个来源（全部经 GitHub API 实测，非引用） ---------- */
  var SRC = {
    k12: {
      id: "k12",
      repo: "ObservingTheSea/ObservingTheSea.github.io",
      name: "聪聪学堂",
      sub: "小学全科 AI 学习平台（语文/数学/英语/科学）",
      license: "MIT",
      site: "https://observingthesea.github.io",
      /* 无 X-Frame-Options / frame-ancestors，实测可 iframe 嵌入 */
      embeddable: true,
      stack: "Next.js monorepo（apps/web · apps/mobile · packages/core）",
    },
    eduagent: {
      id: "eduagent",
      repo: "EduAgent/EduAgent",
      name: "EduAgent",
      sub: "智能体仿真 710 名合成学生，研究 AI 家教怎么起作用",
      paper: "arXiv:2404.07963",
      license: "研究代码",
      site: "https://github.com/EduAgent/EduAgent",
      /* 需要自备 OpenAI/Gemini/HF key，单 agent 约 $0.2 —— 不可当产品嵌 */
      embeddable: false,
      why_not: "它是仿真脚本，不是 Web 服务；跑一次要烧 API 费用",
    },
    eduagentx: {
      id: "eduagentx",
      repo: "EduAgentX-Remake/EduAgentX-BackEnd",
      name: "EduAgentX 后端",
      sub: "Java 教育智能体微服务（10 个）",
      license: "见仓库",
      site: "https://github.com/EduAgentX-Remake/EduAgentX-BackEnd",
      embeddable: false,
      why_not: "该 org 下只有后端仓库，没有前端，无法嵌入",
    },
  };

  /* ---------- K12 深链 ---------- */
  var K12_BASE = SRC.k12.site;
  var K12_GRADES = ["1", "2", "3", "4", "5", "6"];

  /**
   * 拼 K12 深链。
   * 实测坑：Next.js 静态导出下不带尾斜杠会 404（/grade/3 → 404，/grade/3/ → 200），
   * 所以这里统一补斜杠。path 为空时回到首页，而不是产出 /undefined/。
   */
  function k12Url(path) {
    var p = String(path || "").replace(/^\/+/, "");
    if (!p) return K12_BASE + "/";
    if (p.charAt(p.length - 1) !== "/") p += "/";
    return K12_BASE + "/" + p;
  }

  /* 站内 iframe 允许加载的路径白名单。
     白名单而不是拼字符串：路径是代码里写死的常量，但白名单能在
     k12Url 被改坏时立刻失败，而不是默默嵌出一个 404 页面。 */
  var K12_ROUTES = {
    home: "",
    grade: "grade",
    review: "review",
    shop: "shop",
    league: "league",
    profile: "profile",
  };
  function k12Route(key, arg) {
    var base = K12_ROUTES[key];
    if (base === undefined) return null;              // 未知 key 不给链接
    if (key === "grade") {
      var g = String(arg == null ? "" : arg);
      if (K12_GRADES.indexOf(g) < 0) return null;    // 非法年级不给链接
      return k12Url(base + "/" + g);
    }
    return k12Url(base);
  }

  /* ---------- 四步状态机：读源码 → 动手改 → 产出 → 自测 ---------- */
  var STEPS = ["read", "try", "deliver", "check"];

  /**
   * rec = { readAt, triedAt, delivered, passed }
   * 返回**下一个待办步骤**（不是「历史状态」）。
   * 之前这里返回的是 new/tried/delivered/checked 这种「已完成到哪」的名字，
   * 但值又是下一步的名字，两套语义混在一起，读代码的人必然理解错。
   * 统一成「下一步」之后，渲染层只要按 STEPS 顺序画进度即可。
   *
   * 顺序是有意的：没读过源码就不给「动手」打点。
   * 理由和 learn-core 一样——谁都能点开一个链接，读过才叫读过。
   */
  function nextStep(rec) {
    rec = rec || {};
    // 逐步递进：每一步都要求前一步已经完成。
    // 不能写成 if (rec.triedAt) ... —— 那样一个只有 triedAt 的残缺记录
    // 会被当成「已读过源码」，直接跳到交付。用户从没打开过源码行
    // 就能勾掉四步里的两步，这个洞比功能缺失更坏。
    if (rec.readAt && rec.triedAt && rec.delivered && rec.passed) return "done";
    if (rec.readAt && rec.triedAt && rec.delivered) return "check";
    if (rec.readAt && rec.triedAt) return "deliver";
    if (rec.readAt) return "try";
    return "read";
  }

  /** 已完成步数 / 总步数，以及当前该做哪一步。 */
  function stepProgress(rec) {
    var s = nextStep(rec);
    if (s === "done") return { done: true, ratio: 1, step: "check", index: 4 };
    var i = STEPS.indexOf(s);
    return { done: false, ratio: i / STEPS.length, step: s, index: i };
  }

  var NUDGE = {
    read: "先去 GitHub 打开这一课的源码行，读完再回来打点",
    try: "读完源码：动手改一处配置或参数，看会发生什么",
    deliver: "改动能跑通了吗？产出一个别人能看的东西",
    check: "最后一步：用自己的话答一遍自测题，答不出就回去重读",
    done: "已完成 —— 这条已经能给别人讲了",
  };
  function nudge(state) { return NUDGE[state] || NUDGE.read; }

  /* 卡片折叠时显示的短提示，和 nudge 同源但更短 */
  var SHORT = { read: "去读源码", try: "去动手改", deliver: "做交付物", check: "答自测", done: "已完成 ✓" };
  function nudgeShort(state) { return SHORT[state] || SHORT.read; }

  return {
    SRC: SRC, STEPS: STEPS, K12_BASE: K12_BASE, K12_ROUTES: K12_ROUTES, K12_GRADES: K12_GRADES,
    k12Url: k12Url, k12Route: k12Route,
    nextStep: nextStep, stepProgress: stepProgress,
    nudge: nudge, nudgeShort: nudgeShort,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = window.LABS_CORE;
