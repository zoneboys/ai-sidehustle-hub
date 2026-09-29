/* ============================================================================
 * 打开即更新 · 核心逻辑（纯函数，无 DOM / 无网络）
 *
 * 起因：用户说「保证每次打开都进行数据更新」。
 *
 * 先说清楚现在到底发生了什么，因为这句话很容易被"已经做了"糊弄过去：
 * 页面里每个加载器都写了 `?t=Date.now()` + `cache:"no-store"`。
 * 看起来每次都在拉新东西，其实那只是**绕开浏览器缓存，把同一份字节又下一遍**——
 * 内容还是上次 workflow 提交的那一版。所以「每次打开都重新下」做到了，
 * 「每次打开都是最新数据」并没有做到。这两件事差得很远。
 *
 * 静态站能做到的上限，以及本文件的边界：
 *   能做到  每次打开都与线上仓库做一次条件校验（ETag/304，几乎 0 字节），
 *           所以只要每日 workflow 提交过，你今天第一次打开看到的就是提交后的版本，
 *           哪怕你的标签页是昨天开的。
 *   做不到  纯静态 + 无后端，无法在请求发生的瞬间去问上游。
 *           「秒级实时」必须有一个在动的服务端，本项目没有。
 * 所以这里不假装实时，而是**如实标注每份数据的新鲜度**：
 *   实时候选  这次真的重新校验过
 *   已是最新  校验过，线上与本地一致（304）
 *   离线快照  网络失败或超时，用的是仓内快照，并显示它有多旧
 * 三种状态必须一眼可分，否则「更新」就只是个说法。
 *
 * 另一条硬规则：**校验失败绝不能降级成空数据**。
 * 之前就踩过同形状的坑（#NaN 被静默豁免、!important 让整块审计失效）——
 * 一个"取不到就当没有"的分支，会让整块功能悄悄消失而不报任何错。
 * 所以 parse 失败一律**保留旧数据 + 亮黄标**，绝不覆盖。
 * ========================================================================== */
window.FRESH_CORE = (function () {
  "use strict";

  /* ------------------------------------------------------------------
   * 内容指纹（FNV-1a，32 位）
   *
   * 为什么不用 ETag 单独判断：ETag 是服务端给的，不保证随内容变
   * （同一个 commit 的 ETag 就固定）。而我们要回答的是
   * 「线上那份和我手上这份是不是同一件事」，所以必须自己算一次。
   * 32 位对本用途足够：碰撞概率低到可以忽略，真撞上了也只是
   * 少更新一次，不会造成错误展示。
   * ------------------------------------------------------------------ */
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      // h *= 16777619，用移位实现，避免大整数精度问题
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  /* ------------------------------------------------------------------
   * 时间格式化 · 「多久之前」
   *
   * 只说「已更新」而不说「更新于多久前」，用户无法判断该不该信。
   * 超过 7 天直接标成「已陈旧」——放在首页角落的提示里，
   * 过期的事实比新鲜的承诺更有用。
   * ------------------------------------------------------------------ */
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  function ago(fromMs, nowMs) {
    if (typeof fromMs !== "number" || !isFinite(fromMs)) return "未知时间";
    var d = Math.max(0, nowMs - fromMs);
    if (d < 2 * MIN) return "刚刚";
    if (d < HOUR) return Math.floor(d / MIN) + " 分钟前";
    if (d < DAY) return Math.floor(d / HOUR) + " 小时前";
    var day = Math.floor(d / DAY);
    return day + " 天前";
  }

  function isStale(fromMs, nowMs, limitDays) {
    if (typeof fromMs !== "number" || !isFinite(fromMs)) return true;
    return (nowMs - fromMs) > (limitDays || 3) * DAY;
  }

  /* ------------------------------------------------------------------
   * 决定：本地 vs 线上，该用哪份
   *
   * 全部是纯函数，所以这张决策表能被穷举测试——
   * 这正是它容易出错的地方（4 个输入组合 × 3 种失败模式），
   * 靠手动点页面是点不出来的。
   *
   *   action  keep    线上与本地一致，用本地的（省流量，也避免闪烁）
   *           replace 线上更新了，替换
   *           offline 取不到线上，保留本地 + 标注离线
   *   reason  会直接进 UI，所以必须是**能区分**的短词，
   *           不能都塌缩成"更新失败"
   * ------------------------------------------------------------------ */
  function decide(localText, remoteText, opts) {
    opts = opts || {};
    if (typeof remoteText !== "string" || !remoteText) {
      return { action: "offline", reason: "网络不可用", detail: "用的是仓内快照" };
    }
    // 线上字节与本地字节一致 —— 最常见的情况，走 keep，不触发重渲染
    if (remoteText === localText) {
      return { action: "keep", reason: "已是最新", detail: "" };
    }
    // 解析失败：线上有东西但不是合法 JSON。
    // 关键在这一步——**不替换**。GitHub 正在提交、CDN 正在刷新、
    // 或者上游脚本写坏了一行，都会走到这里。
    var remote = null, bad = false;
    try {
      remote = JSON.parse(remoteText);
    } catch (e) {
      bad = true;
    }
    if (bad || remote === null || typeof remote !== "object" || Array.isArray(remote)) {
      return {
        action: "offline",
        reason: "线上数据读不出来",
        detail: "保留旧快照，未替换",
      };
    }
    // 合法但与本地不同 → 更新
    return {
      action: "replace",
      reason: opts.label ? opts.label + " 已更新" : "已更新到线上最新",
      detail: "指纹 " + hash(localText || "") + " → " + hash(remoteText),
    };
  }

  /* ------------------------------------------------------------------
   * 徽标：把决策翻译成人话
   *
   * 状态只有四个，且**必须互斥且穷尽**：
   *   fresh     实时候选（这次真的校验过且内容变了）
   *   current   校验过，一致
   *   stale     校验过但仓内快照本身已陈旧（workflow 挂了/没人提交）
   *   offline   没校验成
   * 「陈旧」和「离线」是两回事：前者是**上游的问题**，后者是**你的网络问题**，
   * 提示文案必须分开，否则用户会去怪错的对象。
   * ------------------------------------------------------------------ */
  function badge(decision, generatedAt, nowMs) {
    var when = ago(generatedAt, nowMs);
    var stale = isStale(generatedAt, nowMs, 3);
    if (!decision) {
      return { tone: "muted", text: "未校验", title: "这次打开没有发起数据校验" };
    }
    if (decision.action === "offline") {
      return {
        tone: stale ? "hot" : "warn",
        text: "离线快照 · " + when,
        title: (decision.detail || decision.reason) + "（快照生成于 " + when + "）",
      };
    }
    if (decision.action === "keep") {
      return {
        tone: stale ? "hot" : "ok",
        text: stale ? "已是最新，但快照已陈旧" : "已是最新 · " + when,
        title: "线上与仓内快照一致；数据生成于 " + when,
      };
    }
    // replace
    return {
      tone: "ok",
      text: "已更新 · " + when,
      title: "本次打开重新校验并换成了线上版本；数据生成于 " + when,
    };
  }

  /* ------------------------------------------------------------------
   * 从 JSON 里取生成时间
   *
   * 各份数据的字段名不统一（generatedAt / date / ts / updatedAt），
   * 全部试一遍；**取不到就返回 null 而不是 0**——
   * 0 会被当成 1970 年，进而 isStale 恒真，把所有数据都标成陈旧。
   * 这类"兜底值比空值更有害"的问题在本项目里已经出现过两次。
   * ------------------------------------------------------------------ */
  function generatedAt(obj) {
    if (!obj || typeof obj !== "object") return null;
    var keys = ["generatedAt", "updatedAt", "fetchedAt", "ts", "date", "day"];
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === "number" && isFinite(v)) {
        // 小于 1e11 的是秒（1970-2001 之后不可能有秒级时间戳）
        return v < 1e11 ? v * 1000 : v;
      }
      if (typeof v === "string") {
        var t = Date.parse(v);
        if (!isNaN(t)) return t;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------
   * 源码清单
   *
   * 每份数据一个 key，live 指向**线上仓库的同一路径**。
   * 静态站没有后端，页面要确认"线上是不是变了"就只能问线上，
   * 而 GitHub raw / jsDelivr 都带 CORS 头，可以跨域条件请求。
   * 顺序即优先级：先校验体积小的，避免一次打开就下几十兆。
   * ------------------------------------------------------------------ */
  var SOURCES = [
    { key: "versions", file: "data/versions.json", label: "版本流", maxAgeDays: 3 },
    { key: "daily-updates", file: "data/daily-updates.json", label: "远程职位", maxAgeDays: 2 },
    { key: "daily-hustles", file: "data/daily-hustles.json", label: "副业机会", maxAgeDays: 2 },
    { key: "daily-learn", file: "data/daily-learn.json", label: "学习流", maxAgeDays: 3 },
    { key: "indie", file: "data/indie.json", label: "独立开发", maxAgeDays: 3 },
    { key: "labs", file: "data/labs.json", label: "实验室源码树", maxAgeDays: 7 },
    { key: "peer-qa", file: "data/peer-qa.json", label: "同伴问答", maxAgeDays: 7 },
    { key: "life", file: "data/life.json", label: "人生指南", maxAgeDays: 14 },
  ];

  /* 构造线上地址
   * jsDelivr 作主源、raw 作备源：两者都是 GitHub 的公开镜像，
   * 都带 access-control-allow-origin: *，任一可用即可。
   * 单源失效不应该让整站显示"离线"——那是把外部依赖放大成全站故障。 */
  function liveUrls(src, repo, branch, ref) {
    var b = branch || "main";
    var r = repo || "";
    var path = src.file;
    var out = [];
    if (r) {
      out.push("https://cdn.jsdelivr.net/gh/" + r + "@" + (ref || b) + "/" + path);
      out.push("https://raw.githubusercontent.com/" + r + "/" + b + "/" + path);
    }
    return out;
  }

  return {
    SOURCES: SOURCES,
    liveUrls: liveUrls,
    hash: hash,
    ago: ago,
    isStale: isStale,
    decide: decide,
    badge: badge,
    generatedAt: generatedAt,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = window.FRESH_CORE;
