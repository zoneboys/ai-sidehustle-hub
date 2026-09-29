/* ============================================================================
 * 平台规则雷达 + 冷启动诊断 · 核心逻辑（纯函数，无 DOM / localStorage / 网络）
 *
 * 起因：用户说「实操之后没效果——发公众号 / 视频号 / 小红书 / 抖音，没流量」。
 * 这是一个可诊断的问题，但市面上给的是通用建议：「多发点」「优化内容」「坚持三个月」。
 * 这些不解决问题，因为**没流量通常不是不努力，是某一个具体机制没过**。
 *
 * 这一层只做两件可证伪的事：
 *
 * 1) 机制库 MECHANISM
 *    推荐系统的判定环节是稳定的（冷启动池 → 完播/停留 → 互动 → 涨粉 → 复访），
 *    这一层是可解释的因果，也是唯一值得写代码教的东西。
 *
 * 2) 门槛 GATE
 *    激励计划的硬门槛是**平台随时会改的数字**。本文件的数字来源是公开资料整理，
 *    不是从官方后台抓的——因此每一条都必须带 verify 链接与 checkedOn 日期，
 *    页面上一键可核。**断言一个我没验证过的数字，比不给数字更糟。**
 *
 * 诊断器的原则：只输出「你缺的是哪个数 + 差多少」，不输出「你要努力」。
 * ========================================================================== */
window.RULES_CORE = (function () {
  "use strict";

  /* ------------------------------------------------------------------
   * MECHANISM · 推荐系统的判定环节
   *
   * 每条机制有四个字段，都参与计算，不是文案：
   *   layer    在漏斗里的位置（0 = 第一道闸，越小越先卡）
   *   test     平台实际在量什么（页面直接显示，让用户知道去后台看哪个数）
   *   need     该机制触发所需的最低信号量（用于「你量还不够」这一类判断）
   *   tell     症状 → 病因的反向推断规则
   *
   * tell(p) 返回 0..3 的严重度：0 = 不像，3 = 高度疑似。
   * 用分数而不是布尔，是为了「两个机制都像」时能排出先后，
   * 也让「改了这条之后该看哪个数」有确定的指向。
   * ---------------------------------------------------------------- */
  var MECHANISM = [
    {
      id: "cadence",
      layer: 0,
      name: "发布节奏闸",
      test: "最近 7 天的发布条数",
      need: 2,
      why: "几乎所有平台都先给「近期活跃」的账号分发测试流量，连发中断会让账号退回静默池。这是最先过的一关，连这关过不了，后面所有优化都测不出来。",
      fix: "先别改内容。先把发布频率补上：未来 7 天至少发 2 条，其余问题在这一关过了之后才有诊断价值。",
      tell: function (p) {
        if (p.posts === 0) return 3;
        if (p.recent7 === 0) return 3;
        if (p.recent7 === 1) return 2;
        if (p.gapDays >= 14) return 2;
        return 0;
      },
    },
    {
      id: "sample",
      layer: 0,
      name: "样本量闸",
      test: "已发布条数",
      need: 10,
      why: "单个平台的测试流量池通常需要一批内容来判定标签。条数太少时平台还没给你贴标签，此时的「没流量」不含任何关于内容质量的信息。",
      fix: "在发够 10 条之前，不要用播放量判断「这条路行不行」——那个阶段的数字是噪声。先凑够样本。",
      tell: function (p) {
        if (p.posts === 0) return 3;
        if (p.posts < p.nichePosts) return 2;
        if (p.posts < 10) return 1;
        return 0;
      },
    },
    {
      id: "niche",
      layer: 1,
      name: "垂直度闸",
      test: "后台的「观众画像 / 兴趣标签」",
      need: 1,
      why: "平台靠内容打标签，再把内容推给同标签的人。一条内容里混多个话题，等于告诉系统「我不知道该推给谁」，于是谁都不推——这是冷启动最常见的死因。",
      fix: "选一个人群，把前 3 条都做成同一个话题。前 20 条不换赛道。",
      tell: function (p) {
        if (p.niches === null) return 0; // 不知道 ≠ 有病，见 norm() 里的说明
        if (p.niches >= 3) return 3;
        if (p.niches === 2) return 2;
        if (p.posts >= 10 && p.best === 0) return 2;
        return 0;
      },
    },
    {
      id: "hook",
      layer: 2,
      name: "前 3 秒 / 首屏闸",
      test: "完播率（短视频）或 跳出率（图文）",
      need: 0.25,
      why: "这是内容质量的第一道量化闸。完播率低意味着系统判定「观众不感兴趣」，直接不再给下一层流量。改中间段没用——观众在 3 秒内就走了。",
      fix: "把结论/冲突/结果放到第一句，删掉所有铺垫。改完只发一版对照，别一次改三处。",
      tell: function (p) {
        if (p.finish === null) return 0;
        if (p.finish < 0.15) return 3;
        if (p.finish < 0.25) return 2;
        return 0;
      },
    },
    {
      id: "engagement",
      layer: 2,
      name: "互动闸",
      test: "点赞率 / 评论率 / 收藏 / 转发",
      need: 0.03,
      why: "互动是系统判断「这条值得推给更多人」的主要信号。播放有但互动为零，等于告诉系统「大家点进来了但不想反应」，下一层流量就不会来。",
      fix: "结尾留一个能被回答的问题，或者一个需要保存的清单。互动不是喊出来的，是内容里留了缺口。",
      tell: function (p) {
        if (p.eng === null) return 0;
        if (p.eng < 0.01) return 3;
        if (p.eng < 0.03) return 2;
        return 0;
      },
    },
    {
      id: "retain",
      layer: 2,
      name: "停留/读完闸",
      test: "平均观看时长（视频）/ 读完率（图文）",
      need: 0.4,
      why: "和完播率是两个不同的闸：完播看的是「有没有被留住」，停留看的是「留了多久」。图文平台读者滑得太快，同样拿不到下一层。",
      fix: "把段落拆短、每段只讲一件事、在中段放一个「后面更关键」的钩子。",
      tell: function (p) {
        if (p.dwell === null) return 0;
        if (p.dwell < 0.2) return 3;
        if (p.dwell < 0.4) return 2;
        return 0;
      },
    },
    {
      id: "follow",
      layer: 3,
      name: "涨粉闸",
      test: "单条涨粉数 / 粉丝画像集中度",
      need: 1,
      why: "能拿流量但不涨粉，说明内容被当成了「一次性消费」。不涨粉就没有复访和私域，激励计划也开不了——收益断在这里。",
      fix: "每条内容明确「我是谁、接下来持续给你什么」，让人有理由关注而不是只看这一条。",
      tell: function (p) {
        if (p.views === 0) return 0;
        if (p.followsPer === null) return 0;
        if (p.followsPer < 1) return 3;
        if (p.followsPer < 5) return 2;
        return 0;
      },
    },
    {
      id: "ceiling",
      layer: 4,
      name: "天花板/复用闸",
      test: "最高一条 vs 中位一条的倍数",
      need: 3,
      why: "爆了一条但复制不出来，说明那条的差异来自偶然或热点，不是结构。靠等下一次爆款是碰运气；把爆款拆成「钩子/结构/选题」三段，才能变成可复制的模板。",
      fix: "把那条最高播放的拆成三段分别复用：换钩子重发、换选题复用结构、换人群换案例。",
      tell: function (p) {
        if (p.posts < 5) return 0;
        if (p.best === 0 || p.median === 0) return 0;
        if (p.best / p.median >= 5) return 3;
        if (p.best / p.median >= 3) return 2;
        return 0;
      },
    },
  ];

  /* ------------------------------------------------------------------
   * PLATFORMS · 平台画像
   *
   * feed / form 是两个决定性差异，不是标签：
   *   feed  抖音/视频号/小红书  靠推荐分发，完播和互动决定生死
   *   form  公众号              靠搜索+社交传播，打开率和读完率决定生死
   *
   * 诊断器据此换掉「该看后台哪个数」——给公众号看完播率是错的。
   * ---------------------------------------------------------------- */
  var PLATFORMS = [
    {
      id: "wechat", name: "公众号", emoji: "💬", form: "form",
      metric: "打开率 / 读完率 / 在看率",
      home: "https://mp.weixin.qq.com",
      ruleCenter: "https://mp.weixin.qq.com/cgi-bin/announce?action=getannouncement",
      note: "流量主要来自社交传播与搜一搜，标题决定打开率，首段决定读完率。没有冷启动池，但有「没有阅读来源就基本停更」的机制。",
    },
    {
      id: "douyin", name: "抖音", emoji: "🎵", form: "feed",
      metric: "完播率 / 点赞率 / 5 秒跳出",
      home: "https://creator.douyin.com",
      ruleCenter: "https://creator.douyin.com/creator-micro/content/manage",
      note: "流量池逐级放大：先给一小波，看完播和互动决定要不要进下一池。完播率是一切的前提。",
    },
    {
      id: "channels", name: "视频号", emoji: "📺", form: "feed",
      metric: "完播率 / 社交推荐 / 关注转化",
      home: "https://channels.weixin.qq.com",
      ruleCenter: "https://weixin.qq.com/",
      note: "社交属性最强：朋友点赞是主要启动量。内容要适合「被朋友转发」，而不是只适合被推荐。",
    },
    {
      id: "xiaohongshu", name: "小红书", emoji: "📕", form: "feed",
      metric: "点击率 / 互动率 / 搜索占比",
      home: "https://creator.xiaohongshu.com",
      ruleCenter: "https://creator.xiaohongshu.com",
      note: "一半流量来自搜索，一半来自推荐。封面和标题同时决定点击率，搜索词决定能否被反复找到——是四个平台里长尾效应最强的。",
    },
  ];

  /* ------------------------------------------------------------------
   * GATE · 激励计划门槛
   *
   * ⚠ 诚实声明：下面的数字来自公开资料整理，**不是**从官方后台抓取的实时值。
   * 平台随时会调整门槛，本文件无法自行感知。处理方式不是「藏起来」，
   * 而是：每条都带 verify（官方规则页）与 checkedOn（我核对过的日期），
   * 页面把链接摆在数字旁边，让人自己点开确认一次，而不是相信我。
   *
   * 这比写死一个看起来很确定的数字诚实得多——后者一旦过期，
   * 会让人按错误门槛做几个月无用功，而这正是本站要解决的那类问题。
   * ---------------------------------------------------------------- */
  var VERIFY_DAY = "2026-09";
  var GATE = [
    {
      id: "wechat-ad",
      platform: "wechat",
      name: "流量主（广告变现）",
      need: { followers: 500 },
      unit: "关注数",
      payout: "按展示计费，公众号阅读量级不同单价差异大",
      verify: "https://mp.weixin.qq.com",
      where: "公众号后台 → 收益 → 流量主 → 开通条件",
      checkedOn: VERIFY_DAY,
      next: "500 关注通常来自「转发到具体的人」，不是来自推荐流量。所以这一关的解法是内容要值得私发，不是要多发。",
    },
    {
      id: "douyin-mid",
      platform: "douyin",
      name: "中视频伙伴计划",
      need: { followers: 1000, views: 17000 },
      unit: "粉丝 + 累计播放",
      payout: "按播放分成，中视频单价高于短视频",
      verify: "https://creator.douyin.com",
      where: "抖音创作者中心 → 全部 → 中视频伙伴计划",
      checkedOn: VERIFY_DAY,
      next: "这是少数「发满一定量就会自然达成」的门槛，不需要技巧，只需要别断更。",
    },
    {
      id: "douyin-star",
      platform: "douyin",
      name: "星图 / 品牌合作",
      need: { followers: 10000 },
      unit: "粉丝",
      payout: "按单报价，与内容垂直度和粉丝画像强相关",
      verify: "https://www.xingtu.cn",
      where: "抖音创作者中心 → 巨量星图 → 达人入驻",
      checkedOn: VERIFY_DAY,
      next: "1 万粉的难点不是涨粉，是**粉丝画像集中**——品牌方看的是「谁的粉」，不是「多少粉」。赛道太宽会直接卡在这一关。",
    },
    {
      id: "channels-share",
      platform: "channels",
      name: "创作分成计划",
      need: { followers: 100 },
      unit: "关注数",
      payout: "按广告分成",
      verify: "https://channels.weixin.qq.com",
      where: "视频号助手 → 创作分成计划",
      checkedOn: VERIFY_DAY,
      next: "四个平台里门槛最低的。100 关注靠熟人转发就能到，适合作为第一条现金流验证。",
    },
    {
      id: "xhs-pgy",
      platform: "xiaohongshu",
      name: "蒲公英（品牌合作）",
      need: { followers: 1000 },
      unit: "粉丝",
      payout: "按单报价 + 部分笔记有分成",
      verify: "https://pgy.xiaohongshu.com",
      where: "小红书创作中心 → 蒲公英 → 创作者入驻",
      checkedOn: VERIFY_DAY,
      next: "蒲公英看的是「笔记数据」而不只是粉丝数：报备笔记的互动率是接单报价的直接输入。",
    },
  ];

  /* ------------------------------------------------------------------
   * 归一化：把用户随手填的一堆文本变成引擎能安全运算的 profile。
   *
   * 这一步不是洁癖。页面的输入框都是文本，用户会填 "1.2k"、"1,200"、
   * "百分之十二"、全角数字。不在这里清洗，后面每一次除法都可能算出 NaN，
   * 而 **NaN 参与任何比较都恒为 false** —— 诊断器会全部跳过，
   * 静默输出「你没病」。那是最有害的一种错误：让用户以为内容没问题。
   *
   * 所以两条硬规则：
   *   1) 拿不到的值一律转 null（=「不知道」），绝不转 0（=「很差」）。
   *      这两种情况的处方完全相反：不知道 → 去后台取数；很差 → 改内容。
   *   2) 比率入参统一转成 0..1 的小数。中文用户填 "12"，多半是 12%，
   *      不是 1200%。但 "0.12" 是真的 12%。>1 一律按百分数处理。
   * ---------------------------------------------------------------- */
  /* 1..99 的中文数字。只做这个区间，因为「一百二十」这种写法没人填，
     而「十二」「两」「十五」在「完播率十二」这种句子里很常见。
     遇到看不懂的返回 null，让上层当「不知道」处理——绝不能返回 0。 */
  var CN_D = { "\u96f6": 0, "\u4e00": 1, "\u4e8c": 2, "\u4e24": 2, "\u4e09": 3, "\u56db": 4, "\u4e94": 5, "\u516d": 6, "\u4e03": 7, "\u516b": 8, "\u4e5d": 9 };
  function cnNum(s) {
    if (!s) return null;
    /* 单字直接查表（含零） */
    if (s.length === 1) return CN_D.hasOwnProperty(s) ? CN_D[s] : (s === "\u5341" ? 10 : null);
    if (s.length > 3) return null;
    /* 两种写法都要收，因为两种都有人写：
         十二 / 十五  →  十在**前**（十位固定是 1）
         二十 / 三十五 →  十在**后**（零位可缺）
       早先只判了后一种，结果「完播率十二」被当成「不知道」而静默跳过诊断。 */
    if (s[0] === "\u5341") {
      var o1 = CN_D[s[1]];
      return o1 === undefined ? null : 10 + o1;
    }
    if (s[1] === "\u5341") {
      var t2 = CN_D[s[0]];
      var o2 = s.length > 2 ? CN_D[s[2]] : 0;
      if (t2 === undefined || o2 === undefined) return null;
      return t2 * 10 + o2;
    }
    return null;
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    var mult = 1;
    /* 中文数词：这是真实会出现的输入，不是假想输入。
       「百分之十二」「两成」都有人会填，而且填的人不会知道自己填错了格式。 */
    if (s.indexOf("百分之") === 0) { s = s.slice(3); mult = 0.01; }
    if (s.length === 2 && s[1] === "成") { s = s.slice(0, 1); mult = 0.1; }
    var cn = cnNum(s);
    if (cn !== null) s = String(cn);
    /* 全角数字 → 半角 */
    s = s.replace(/[\uff10-\uff19]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
    s = s.replace(/,/g, "").replace(/[\s%]/g, "");
    /* 万 / w / k / 千 */
    var tail = s.slice(-1).toLowerCase();
    if (tail === "万" || tail === "w") { mult *= 10000; s = s.slice(0, -1); }
    else if (tail === "k") { mult *= 1000; s = s.slice(0, -1); }
    else if (s.slice(-1) === "千") { mult *= 1000; s = s.slice(0, -1); }
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return n * mult;
  }

  /* 比率：把「百分数写法」转成 0..1 的小数。
   *
   * 这里曾经写的是「>1 才除以 100」的启发式，看着聪明，实际有害：
   * 输入框的标签就写着「互动率 %」「完播率 %」，placeholder 也是 1.2 / 18 / 45，
   * 所以**用户填的数字一律是百分数**。而启发式把 (0,1] 区间原样留下，
   * 于是真有人填 0.6（本意 0.6%）时，引擎读成 60%，判定「互动率健康」——
   *
   * 这是最坏的一种错：不是漏报，是**反向洗白**。用户填了真实数据，
   * 拿到的却是「你没病」，于是继续发同样的内容，流量继续不来。
   * 而这正是本站要解决的那个问题。
   *
   * 曾经有人提过「用 0.45 表示 45% 也很常见」——但那要求标签不写 %。
   * 标签写了 %，就按 % 解释；这不是猜测，是契约。
   * 宁可漏报（照填 0.6% 报互动率低，用户自己会核对）也不能假阴性。
   */
  function ratio(v) {
    var n = num(v);
    if (n === null) return null;
    if (n < 0) return null;
    if (n > 100) return null; // 115% 完播率不存在，多半是位数写错
    return n / 100;
  }

  /* 安全的正整数，至少 0。拿不到就是 0——计数类字段「不知道」没有意义，
     不知道发了几条本来就等于还没开始，这是唯一该转 0 的那类。 */
  function count(v) {
    var n = num(v);
    if (n === null) return 0;
    return Math.max(0, Math.round(n));
  }

  function norm(raw) {
    raw = raw || {};
    var follows = count(raw.followers);
    var views = count(raw.views);
    var likes = count(raw.likes);
    var comments = count(raw.comments);
    var shares = count(raw.shares);
    var posts = count(raw.posts);
    /* 互动率：优先用用户直接给的，否则用三个计数推。
       两者都拿不到就是 null，不猜。 */
    var eng = ratio(raw.eng);
    if (eng === null && views > 0) {
      var acts = likes + comments + shares;
      if (acts > 0) eng = acts / views;
    }
    /* 单条涨粉：直接填优先，否则用总涨粉除以发布数 */
    var fpp = num(raw.followsPer);
    if (fpp === null && posts > 0) fpp = follows / posts;
    return {
      platform: raw.platform || "",
      niche: raw.niche || "",
      /* 赛道数是一个**用户可能真的不知道**的字段：很多人说不清自己算几个赛道，
         因为「这条算 AI 还是算职场」本身就是模糊的。
         所以 null（「不知道」）在这里是一个正式状态，不是需要被猜掉的缺口。
         之前两个默认值互相打架：这里猜 1（假设你聚焦），
         页面 select 却选中「4 个以上」——于是用户什么都没填，
         第一次诊断就指着他说「你最可能卡在垂直度闸」。
         那是**凭空指控**，比漏报糟糕得多：他会以为自己已经确诊了。
         判 0 分（无证据）是这里唯一安全的默认。 */
      niches: raw.niches === undefined || raw.niches === "" || raw.niches === "0"
        ? null
        : Math.max(1, count(raw.niches)),
      posts: posts,
      recent7: count(raw.recent7),
      gapDays: raw.gapDays === undefined || raw.gapDays === "" ? 0 : count(raw.gapDays),
      followers: follows,
      views: views,
      best: count(raw.best),
      median: count(raw.median),
      finish: ratio(raw.finish),
      dwell: ratio(raw.dwell),
      eng: eng,
      followsPer: fpp,
    };
  }

  /* ------------------------------------------------------------------
   * 诊断主体
   *
   * 排序规则很关键，而且是有理由的：**先按 layer，再按严重度**。
   * 因为推荐系统是漏斗，前一道闸没过，后一道闸的数据根本不可信。
   * 一个完播率 3 分但卡在第 0 层（没发够样本量）的问题，
   * 先修完播率是白费力气——样本不够时测出来的完播率不可信。
   * 这就是「按严重度排」会给出的错误建议。
   * ---------------------------------------------------------------- */
  function diagnose(input) {
    var p = norm(input);
    var hits = [];
    for (var i = 0; i < MECHANISM.length; i++) {
      var m = MECHANISM[i];
      var s = 0;
      try { s = m.tell(p) || 0; } catch (e) { s = 0; }
      /* tell 永远不返回 NaN；这里再兜一次底，因为 NaN 排序会被静默吞掉 */
      if (!isFinite(s) || s <= 0) continue;
      hits.push({ m: m, score: s });
    }
    hits.sort(function (a, b) {
      if (a.m.layer !== b.m.layer) return a.m.layer - b.m.layer;
      return b.score - a.score;
    });
    var top = hits.slice(0, 3);
    /* 层号可能被跳过（层 0 没过时层 1 的分没意义），
       但要告诉用户「你现在只能看前 N 个」，否则他会去改后���闸。 */
    var firstLayer = top.length ? top[0].m.layer : null;
    var blocked = top.filter(function (h) { return h.m.layer > firstLayer; }).length;
    return { profile: p, top: top, blocked: blocked, all: hits.length };
  }

  /* 为什么「前 3 条」不是随便取前三条：
     后面的机制在当前层没过之前根本无法判定（数据不可信），
     所以 blocked 那部分要明确标为「先别动」。 */
  function verdict(d) {
    if (!d.top.length) {
      return { tone: "ok", head: "没发现结构性卡点", body: "各项指标都在正常区间。接下来该做的是把一条内容推到 3 倍中位数以上，找到可复制的结构。" };
    }
    var h = d.top[0];
    return {
      tone: "bad",
      head: "最可能卡在：第 " + (h.m.layer + 1) + " 道闸 · " + h.m.name,
      body: h.m.why,
      fix: h.m.fix,
      test: h.m.test,
      need: h.m.need,
      blocked: d.blocked,
    };
  }

  /* ------------------------------------------------------------------
   * 门槛差距：算出「还差多少」而不是「门槛是多少」
   * 因为用户能行动的是差距，不是绝对值。
   * ---------------------------------------------------------------- */
  function gatesFor(platformId) {
    return GATE.filter(function (g) { return g.platform === platformId; });
  }
  function gateGap(g, followers) {
    var f = count(followers);
    var need = (g.need && g.need.followers) || 0;
    var got = Math.min(f, need);
    var left = Math.max(0, need - f);
    var ratioDone = need > 0 ? got / need : 1;
    return {
      gate: g,
      need: need,
      got: got,
      left: left,
      ratio: ratioDone,
      /* 额外条件（如抖音中视频的累计播放）单独标出，
         避免用户以为只差粉丝数就够了。 */
      extra: g.need && g.need.views ? "另需累计播放 " + g.need.views + "" : null,
      done: left === 0,
    };
  }

  /* 未填平台时给出「全平台门槛」概览，而不是空列表 */
  function allGates() { return GATE.map(function (g) { return g; }); }

  return {
    MECHANISM: MECHANISM, PLATFORMS: PLATFORMS, GATE: GATE,
    num: num, ratio: ratio, norm: norm,
    diagnose: diagnose, verdict: verdict,
    gatesFor: gatesFor, gateGap: gateGap, allGates: allGates,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = window.RULES_CORE;
