/* ============================================================================
 * 人生指南 · 核心逻辑（纯函数，无 DOM / 无网络）
 *
 * 接入 github.com/eternity4719/HowToLiveBetter（CC-BY-4.0，27k star）的
 * 《高性价比人生指南》34 节 630 条。这一层不复述书里的内容，只做三件
 * 书本身**不适合替用户做**的事：
 *
 * 1) 先判断要不要停止算账（emergencyFirst）
 *    上游 skill 文档的第 0 步写得很明确：正在发生的急症、提到自杀念头、
 *    已经在走法律程序——这三种情况下**先说打什么电话、先做什么动作**，
 *    不要先讲性价比。一个「先算划不划算」的人生指南，在这种时刻是帮倒忙。
 *    所以把它做成一等公民：命中就不给排序，直接给出口径。
 *
 * 2) 不同口径之间不排序（byLens + rank）
 *    书里反复强调「换寿命的」和「换钱的」不在一把尺子上。
 *    「总死亡率降 12%」和「每年省 500 元」直接排个先后是没有意义的，
 *    排出来那个名次是假的。所以这里的排序**永远在单个口径内部进行**。
 *
 * 3) 性价比与证据等级分开（rank 的两个 key）
 *    性价比是作者的判断、只算 C 级；证据等级是文献强度。
 *    两者既不同向也不等价，书里明确「『一般』不等于不该做」。
 *    所以 rank 的主序是性价比、副序是证据等级，UI 上也必须分开显示，
 *    不能拿「证据 C 级」去暗示「不值得做」——那是误导性排序。
 * ========================================================================== */
window.LIFE_CORE = (function () {
  "use strict";

  var LENS_ORDER = ["死亡率", "金钱", "时间", "自由"];

  var LENS_LABEL = {
    死亡率: "换寿命",
    金钱: "换钱",
    时间: "换时间精力",
    自由: "换人身自由",
  };

  var GRADE_LABEL = { A: "荟萃/RCT", B: "有研究", C: "共识" };

  var RATIO_ORDER = { 极高: 0, 高: 1, 一般: 2 };

  var GRADE_ORDER = { A: 0, B: 1, C: 2 };

  /* ------------------------------------------------------------------
   * 第 0 步：要不要立刻停下
   *
   * 判定只用「词命中」，不做语义理解——这是有意的：
   * 一个会误判急症的分类器比没有分类器危险得多。
   * 命中只意味着**多显示一段指引**，不是替用户下诊断；
   * 没命中也不代表没事，所以 UI 上永远保留「情况紧急」入口。
   * ------------------------------------------------------------------ */
  var URGENT = [
    {
      id: "acute",
      label: "正在发生的急症",
      hint: "倒地无呼吸、大出血、火灾、溺水、触电、中毒、卒中或心梗症状",
      // 词越具体越可靠，泛词（"疼""难受"）故意不给，避免误伤
      words: ["急救", "心梗", "心肌梗死", "卒中", "脑梗", "中风", "昏迷", "抽搐", "大出血",
        "止血", "溺水", "触电", "中毒", "窒息", "窒息", "烧伤", "烫伤", "地震", "火灾",
        "燃气", "一氧化碳", "煤气", "误服", "吞了", "异物卡", "过敏性休克", "哮喘发作",
        "抽搐", "心搏骤停", "没有呼吸", "120", "119", "110"],
      action: "先打 120 / 119，说清地址和症状；会 CPR 就先做心肺复苏。",
      sections: [13],
      book: "第 13 节「紧急情况」",
    },
    {
      id: "selfharm",
      label: "提到活不下去 / 自杀念头",
      hint: "任何形式的轻生念头、计划或遗言式表达",
      words: ["自杀", "轻生", "不想活", "活不下去", "结束生命", "自残", "割腕", "跳楼", "了结自己"],
      action: "先打全国心理援助热线 12356，或北京心理危机研究与干预中心 010-82951332。",
      sections: [1, 29],
      book: "第 1 节、第 29 节",
    },
    {
      id: "legal",
      label: "已经在走法律程序",
      hint: "已被传唤 / 拘留 / 起诉 / 面临处罚",
      words: ["传唤", "拘留", "逮捕", "起诉", "法院", "开庭", "律师", "强制措施", "取保", "拘留所"],
      action: "书上只给通用口径，个案必须找执业律师——书里也是这么写的。",
      sections: [8, 9],
      book: "第 8 节、第 9 节",
    },
  ];

  /**
   * 判定一句话是否需要先停下。
   * @returns {{id,label,hint,action,book,sections}[]} 命中项（可能多条）
   */
  function emergencyFirst(q) {
    var text = String(q == null ? "" : q).toLowerCase();
    if (!text.trim()) return [];
    var hits = [];
    for (var i = 0; i < URGENT.length; i++) {
      var u = URGENT[i];
      var found = null;
      for (var j = 0; j < u.words.length; j++) {
        if (text.indexOf(u.words[j].toLowerCase()) !== -1) {
          found = u.words[j];
          break;
        }
      }
      if (found) {
        // 命中词只用于内部判断，不回显——回显会让人觉得被算法审判
        hits.push({
          id: u.id, label: u.label, hint: u.hint, action: u.action,
          book: u.book, sections: u.sections,
        });
      }
    }
    return hits;
  }

  /* ------------------------------------------------------------------
   * 排序：性价比优先，证据等级次之
   *
   * 顺序刻意与上游 index.html 一致（先性价比、同档再按证据 A>B>C、
   * 再按与处境的贴合度）。第三键用条号，是为了让结果**稳定**：
   * 两个性价比和证据都一样的条目，按 id 排能保证每次打开顺序相同，
   * 否则用户会以为页面在乱跳。
   * ------------------------------------------------------------------ */
  function rank(entries) {
    return (entries || []).slice().sort(function (a, b) {
      var r = (RATIO_ORDER[a.ratio] ?? 3) - (RATIO_ORDER[b.ratio] ?? 3);
      if (r) return r;
      var g = (GRADE_ORDER[a.grade] ?? 3) - (GRADE_ORDER[b.grade] ?? 3);
      if (g) return g;
      return (a.sec || 0) * 1000 + (a.n || 0) - ((b.sec || 0) * 1000 + (b.n || 0));
    });
  }

  /* ------------------------------------------------------------------
   * 按口径分列
   *
   * 这是本文件最重要的一步。书里说得很清楚：寿命、时间与精力、金钱、
   * 人身自由四样分开算，不互相折算。所以**永远不要给用户一个跨口径的
   * 总榜**——那个第一名是算不出来的，展示了就是编造。
   *
   * 未标注口径的条目单独归到「未标注」，而不是塞进第一个口径：
   * 硬塞进去等于替它选了一个口径，那正是书里禁止的折算。
   * ------------------------------------------------------------------ */
  function byLens(entries) {
    var map = {};
    for (var i = 0; i < LENS_ORDER.length; i++) map[LENS_ORDER[i]] = [];
    map[""] = [];
    for (var j = 0; j < (entries || []).length; j++) {
      var e = entries[j];
      var k = e && e.lens ? e.lens : "";
      if (!map[k]) map[k] = [];
      map[k].push(e);
    }
    var out = [];
    for (var m = 0; m < LENS_ORDER.length; m++) {
      var key = LENS_ORDER[m];
      if (map[key] && map[key].length) {
        out.push({ lens: key, label: LENS_LABEL[key], entries: rank(map[key]) });
      }
    }
    if (map[""] && map[""].length) {
      out.push({ lens: "", label: "未标注口径（不参与跨口径比较）", entries: rank(map[""]) });
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * 搜索
   *
   * 命中范围与上游一致：标题、说人话、成本、收益、备注、来源、证据等级。
   * 不搜条号——用户搜「5」多半不是想找第 5 条。
   *
   * 空格分词后取交集：搜「裁员 补偿」应该是「同时含两个词」，
   * 而不是「含任意一个」——后者会返回一堆只沾一个词的噪音，
   * 而这个站的问题本来就是「给了一堆通用建议」。
   * ------------------------------------------------------------------ */
  function search(entries, q) {
    var query = String(q == null ? "" : q).trim().toLowerCase();
    if (!query) return (entries || []).slice();
    var terms = query.split(/\s+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < (entries || []).length; i++) {
      var e = entries[i];
      var hay = [
        e.title, e.human, e.cost, e.gain, e.note, e.src, e.grade, e.title,
      ].join("\n").toLowerCase();
      var all = true;
      for (var j = 0; j < terms.length; j++) {
        if (hay.indexOf(terms[j]) === -1) {
          all = false;
          break;
        }
      }
      if (all) out.push(e);
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * 按约束筛选
   *
   * 三个成本维度（钱/时间/毅力）都是**档位**而不是分数，
   * 语义是「不超过」：选「时间=少」= 我只接受几乎不占时间的条目。
   *
   * 这里用集合而不是布尔字段，是为了支持多选（同时要"不花钱"且
   * "不费毅力"）。空集合 = 不限。**未知不等于不满足**：
   * 档位缺失的条目在这个维度上不算被排除，而是被单列出来提示——
   * 因为「没标注」既可能是「其实很花时间」，也可能是「作者没写」。
   * ------------------------------------------------------------------ */
  function pickBy(entries, dim, want) {
    want = want || [];
    if (!want.length) return (entries || []).slice();
    var set = {};
    for (var i = 0; i < want.length; i++) set[want[i]] = true;
    return (entries || []).filter(function (e) {
      var v = e[dim];
      // 档位缺失 → 保留，但在结果里由 caller 用 unknown 标出来
      return !v || set[v];
    });
  }

  /** 哪些条目在某个维度上没标注——不能默默混进结果冒充合规 */
  function unknownOn(entries, dim) {
    return (entries || []).filter(function (e) {
      return !e[dim];
    });
  }

  /** 一条目的三个成本维度 + 性价比，页面直接显示 */
  function describe(e) {
    return {
      money: e.money || "",
      time: e.time || "",
      will: e.will || "",
      level: e.level || "",
      lens: e.lens || "",
      lensLabel: LENS_LABEL[e.lens] || (e.lens || "未标注口径"),
      ratio: e.ratio || "一般",
      grade: e.grade || "",
      gradeLabel: GRADE_LABEL[e.grade] || "未分级",
      cost: e.cs,
      // 有争议 = 备注以「争议」开头，上游用它做筛选
      dispute: !!e.dispute,
      todo: !!e.todo,
    };
  }

  /* ------------------------------------------------------------------
   * 从正文里抽出全部来源链接
   *
   * 上游把出处写在正文里，格式有三种混在一起：
   *   裸链 https://x.org/y
   *   Markdown 角括号 <https://x.org/y>
   *   角括号后面直接跟中文句号「。」或逗号
   *
   * 最后一种是坑：Markdown 规范里 <> 里的内容不算标点，
   * 但人写的时候会把句号一起敲进去。链接只要带上一个尾随的「。/，」，
   * 点开就是 404 —— 而页面上它看起来完全正常。
   * 所以这里统一剥掉尾部标点，且只剥一次（URL 本身以 / 结尾是合法的）。
   * ------------------------------------------------------------------ */
  function linksOf(text) {
    if (!text || typeof text !== "string") return [];
    var out = [];
    var re = /<((?:https?:\/\/|www\.)[^>\s]+)>|((?:https?:\/\/|www\.)[^\s<>）)]+)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var u = (m[1] || m[2] || "").replace(/[.,;:!?。，、；：！？）)\]]+$/, "");
      if (!u) continue;
      // 同一句话里常把同一个链接写两遍（角括号 + 裸链），去重
      if (out.indexOf(u) === -1) out.push(u);
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * 受益人四档
   *
   * 书里把好处回到谁身上的可能性分四档（你自己 / 配偶与直系亲属 /
   * 朋友同事 / 陌生人），并且明确「档次越低回报期望越小、风险要越写清」。
   *
   * 这**不是条目上的字段**，是书里的判断步骤。所以这里不做成计算，
   * 只把四档原样列出供页面提示——把判断步骤包装成算法，
   * 恰好会丢掉书最强调的那句「书里没写的不要拿常识冒充」。
   * ------------------------------------------------------------------ */
  var BENEFICIARY = [
    { tier: 1, who: "你自己", note: "回报期望最高" },
    { tier: 2, who: "配偶和直系亲属", note: "算家庭账时并进来" },
    { tier: 3, who: "朋友、同事和其他亲属", note: "回报期望较低" },
    { tier: 4, who: "陌生人", note: "书里要求：风险面和好处一起写，可能被讹、被卷进案子、被报复" },
  ];

  return {
    LENS_ORDER: LENS_ORDER,
    LENS_LABEL: LENS_LABEL,
    GRADE_LABEL: GRADE_LABEL,
    RATIO_ORDER: RATIO_ORDER,
    GRADE_ORDER: GRADE_ORDER,
    URGENT: URGENT,
    BENEFICIARY: BENEFICIARY,
    emergencyFirst: emergencyFirst,
    rank: rank,
    byLens: byLens,
    search: search,
    pickBy: pickBy,
    unknownOn: unknownOn,
    describe: describe,
    linksOf: linksOf,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = window.LIFE_CORE;
