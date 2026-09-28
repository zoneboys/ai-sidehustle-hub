/**
 * 模型/工具版本变更流 · 全链路测试
 *
 * 三层：
 *   1) 解析层：scripts/fetch-versions.mjs 的纯函数——RSS/Atom 双格式、链接回退、
 *      噪声过滤、影响分级、版本号抽取、跨日合并语义。
 *   2) 数据层：data/versions.json 的真实产物必须自洽（level/impact 都在声明的表里、
 *      排序不倒序、不出现噪声条目）。
 *   3) 接线层：index.html 里版本流区块、筛选器、启动加载、renderAll 钩子都在。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  parseFeed, countFeedBlocks, isJunk, classify, extractVersion,
  isVersionBump,  mergeItems, withinDays, stripTags, isNewItem, SOURCES, GROUPS, LEVELS, IMPACTS,
  isPackageBump, rollupPackageBumps, dedupeAcrossSources, cleanSummary, cleanItems,
} from "../scripts/fetch-versions.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
/** 与脚本里 beijingDate() 保持一致的口径（UTC+8） */
const beijingDateLike = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
const RSS_SRC = { id: "t1", name: "Test RSS", kind: "feed", group: "大模型" };
const REL_SRC = { id: "t2", name: "Test Rel", kind: "release", group: "开发框架" };

/* ================= 1. 解析层 ================= */

const RSS = `<?xml version="1.0"?><rss><channel>
  <item>
    <title><![CDATA[GPT-6 正式发布]]></title>
    <link>https://example.com/a</link>
    <pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate>
    <description>我们发布了 &lt;b&gt;GPT-6&lt;/b&gt;，上下文翻倍。</description>
  </item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>feat: add streaming</title>
    <link rel="alternate" href="https://example.com/b"/>
    <updated>2026-09-21T08:30:00Z</updated>
    <content type="html">新增 &amp; 修复流式输出</content>
  </entry>
  <entry>
    <title>b11232</title>
    <link href="https://example.com/junk"/>
    <updated>2026-09-21T08:31:00Z</updated>
  </entry>
</feed>`;

test("RSS 的 <item> 能解析出标题/链接/日期/摘要", () => {
  const [it] = parseFeed(RSS, RSS_SRC);
  assert.equal(it.title, "GPT-6 正式发布");
  assert.equal(it.url, "https://example.com/a");
  assert.equal(it.date, "2026-09-22");
  assert.match(it.summary, /GPT-6/);
  assert.equal(it.sourceId, "t1");
  assert.equal(it.group, "大模型");
});

test("Atom 的 <entry> 用 href 属性取链接，且能读到 content", () => {
  const [it] = parseFeed(ATOM, REL_SRC);
  assert.equal(it.title, "feat: add streaming");
  assert.equal(it.url, "https://example.com/b");
  assert.equal(it.date, "2026-09-21");
  assert.match(it.summary, /流式输出/);
});

test("CDATA 与 HTML 实体被正确还原，不把标签当正文", () => {
  assert.equal(stripTags("<![CDATA[<b>hi</b>]]>"), "hi");
  assert.equal(stripTags("a &amp; b &lt;c&gt;"), "a & b <c>");
  assert.equal(stripTags("<p>多\n  空格</p>"), "多 空格");
});

test("没有 <link> 时回退到 guid 的 URL", () => {
  const xml = `<rss><item><title>只有 guid 的条目</title><guid>https://example.com/g</guid></item></rss>`;
  const [it] = parseFeed(xml, RSS_SRC);
  assert.equal(it.url, "https://example.com/g");
});

test("缺标题或缺链接的条目被丢弃，不会产生半残卡片", () => {
  const xml = `<rss>
    <item><link>https://a.example.com</link></item>
    <item><title>只有标题没链接的条目</title></item>
    <item><title>标题和链接都正常的条目</title><link>https://ok.example.com</link></item>
  </rss>`;
  const out = parseFeed(xml, RSS_SRC);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://ok.example.com");
});

/* ================= 2. 噪声过滤 ================= */

test("isJunk 丢掉纯构建号标签（llama.cpp 的 b11232 曾刷满整个列表）", () => {
  for (const t of ["b11232", "b11229", "v0.3.0", "1.0.0", "2024.10.1", "rc"]) {
    assert.equal(isJunk(t), true, `应判为噪声: ${t}`);
  }
});

test("isJunk 保留真实标题", () => {
  for (const t of [
    "Visual Studio Code 1.140 (Insiders)",
    "Introducing cf: the agentic CLI",
    "langchain-core==1.6.5 修复若干问题",
    "GPT-6 正式发布",
  ]) {
    assert.equal(isJunk(t), false, `不应判为噪声: ${t}`);
  }
});

test("解析时噪声条目当场被剔除，countFeedBlocks 仍能数到原始条数", () => {
  // 区分「源结构变了」和「源里全是噪声」两种情况，前者要报错后者不能
  assert.equal(countFeedBlocks(ATOM), 2);
  assert.equal(parseFeed(ATOM, REL_SRC).length, 1);
});

/* ================= 3. 影响分级 ================= */

test("release 源按关键词判出 level，破坏性/弃用优先级最高", () => {
  assert.equal(classify("BREAKING CHANGE: drop node 16", "release").level, "break");
  assert.equal(classify("Breaking change: renamed parameter", "release").level, "break");
  assert.equal(classify("gpt-3.5-turbo is deprecated and will be removed", "release").level, "deprecate");
  assert.equal(classify("Security advisory CVE-2026-1234", "release").level, "security");
  assert.equal(classify("feat: add new streaming API", "release").level, "feature");
  assert.equal(classify("perf: 30% faster inference", "release").level, "perf");
  assert.equal(classify("fix: crash on empty input", "release").level, "fix");
});

test("feed 源默认 notice，不会把博客软文说成「修复」", () => {
  assert.equal(classify("Proaction boosts sales 60%", "feed").level, "notice");
  assert.equal(classify("How fast is the web?", "feed").level, "notice");
  // 但强信号仍然会升级——博客里官宣弃用同样要红
  assert.equal(classify("Announcing the sunset of the legacy API", "feed").level, "deprecate");
});

test("影响标签：代码/安全/成本优先，无信号时诚实标 info", () => {
  assert.equal(classify("BREAKING CHANGE: v2 removes the old field", "release").impact, "code");
  assert.equal(classify("Security advisory CVE-2026-1", "release").impact, "security");
  assert.equal(classify("New pricing and billing changes", "release").impact, "cost");
  assert.equal(classify("Proaction boosts sales 60%", "feed").impact, "info");
});

test("只写版本号的标题不会被当成「新能力」——版本号本身不是变现机会", () => {
  assert.equal(isVersionBump("langchain-core==1.6.5"), true);
  assert.equal(isVersionBump("proto-v0.3.0"), true);
  assert.equal(isVersionBump("19.3.0 (September 9, 2026)"), true);
  assert.equal(isVersionBump("Visual Studio Code 1.140 (Insiders)"), false);
  assert.equal(isVersionBump("Introducing cf: the agentic CLI"), false);

  // changelog 正文里飘一个「支持」，标题却只有版本号 → 仍然 info
  const r = classify("langchain-core==1.6.5 现在支持新的流式接口", "release", "langchain-core==1.6.5");
  assert.equal(r.impact, "info");
});

/* ================= 3b. 降噪：折叠与去重 =================
 * 实测一天 34 条里 9 条是噪声：monorepo 一天发十几个包（每个只写「包名==版本号」）、
 * 同一条模型发布被多个项目转发。真正要做副业的人看的是「发生了什么」。 */

test("isPackageBump 只认纯「包名==版本号」的标题", () => {
  assert.equal(isPackageBump("langchain-core==1.6.5"), true);
  assert.equal(isPackageBump("langchain-openai==1.6.6"), true);
  assert.equal(isPackageBump("langchain-core==1.6.5 修复若干问题"), false);
  assert.equal(isPackageBump("feat: add streaming API"), false);
});

test("monorepo 包版本按周折叠成一条，零星几条直接丢", () => {
  const mk = (title, date) => ({
    title, date, url: "u" + title, sourceId: "langchain",
    source: "LangChain", kind: "release", summary: "", level: "fix", impact: "info",
  });
  // 同一个源、同一个 ISO 周内陆续发出（实测它们会横跨 09-22~09-25 每天一个）
  const items = [
    mk("langchain-core==1.6.5", "2026-09-24"),
    mk("langchain-openai==1.6.6", "2026-09-24"),
    mk("langchain-anthropic==1.7.4", "2026-09-23"),
    mk("langchain-openai==1.6.5", "2026-09-23"),
    mk("feat: 真正有价值的新能力", "2026-09-23"),
  ];
  const { kept, rolled } = rollupPackageBumps(items);
  assert.equal(rolled.length, 1, "应折叠出 1 条汇总");
  assert.equal(rolled[0].rolledCount, 4);
  assert.match(rolled[0].title, /LangChain 生态 4 个包本周更新/);
  assert.equal(kept.length, 1, "非包版本条目必须原样保留");
  assert.equal(kept[0].title, "feat: 真正有价值的新能力");

  // 只剩 2 条（低于阈值）→ 不值得占位，直接丢
  const few = rollupPackageBumps([mk("langchain-a==1.0.0", "2026-09-24"), mk("langchain-b==1.0.1", "2026-09-24")]);
  assert.equal(few.rolled.length, 0);
  assert.equal(few.kept.length, 0, "零星包版本应被丢弃");
});

test("跨源同名去重：只留一条，并记录其他来源", () => {
  const items = [
    { title: "Qwen-Image-2.1 + Skills", source: "vLLM", sourceId: "vllm", url: "u1", summary: "短" },
    { title: "Qwen-Image-2.1 + Skills", source: "llama.cpp", sourceId: "llama", url: "u2", summary: "短" },
    { title: "Qwen-Image-2.1 + Skills", source: "Unsloth", sourceId: "unsloth", url: "u3", summary: "这条描述明显更详细" },
    { title: "完全不同的另一条变更", source: "OpenAI", sourceId: "openai", url: "u4", summary: "" },
  ];
  const out = dedupeAcrossSources(items);
  assert.equal(out.length, 2);
  assert.deepEqual([...out[0].alsoIn].sort(), ["Unsloth", "llama.cpp"]);
  assert.equal(out[0].summary, "这条描述明显更详细", "应保留信息量更大的描述");
  assert.equal(out[1].alsoIn, undefined);
});

test("isJunk 识别剥掉版本号和套话后什么都不剩的标题", () => {
  for (const t of ["Release 5.17.0", "proto-v0.3.0", "19.3.0 (September 9, 2026)", "version 1.2.3", "Update 2024.10.1"]) {
    assert.equal(isJunk(t), true, `应判为噪声: ${t}`);
  }
  // 不能误伤：真正的标题里可能含月份或 Release 字样
  for (const t of ["Release 5.17.0 adds streaming support", "September roadmap update", "Update your API key handling"]) {
    assert.equal(isJunk(t), false, `不应判为噪声: ${t}`);
  }
});

test("level 没被具体规则命中时，impact 从 level 推导（而不是一律 info）", () => {
  // 6 个影响档里如果 5 个恒为空，页面上的「需要你动手」筛选器就永远点不出东西
  assert.equal(classify("feat: introduce a new streaming API", "release").impact, "capability");
  assert.equal(classify("perf: 30% faster inference", "release").impact, "capability");
  assert.equal(classify("BREAKING: field removed", "release").impact, "code");
  assert.equal(classify("CVE-2026-1 advisory", "release").impact, "security");
  // 修复类仍然诚实地是 info——给每条都贴「🚀 新能力」等于没分级
  assert.equal(classify("fix: crash on empty input", "release").impact, "info");
});

/* ---- 管线级：直接跑 cleanItems，而不是只看产物数据。
 * 只断言 data/versions.json 的一个致命缺陷：它是由管线自己生成的，
 * 管线改坏时它会跟着一起变，测试仍然全绿——等于没测。 */

const RAW = [
  { title: "langchain-core==1.6.5", date: "2026-09-24", url: "u1", sourceId: "langchain", source: "LangChain", summary: "" },
  { title: "langchain-openai==1.6.6", date: "2026-09-24", url: "u2", sourceId: "langchain", source: "LangChain", summary: "" },
  { title: "langchain-anthropic==1.7.4", date: "2026-09-23", url: "u3", sourceId: "langchain", source: "LangChain", summary: "" },
  { title: "Qwen-Image-2.1 + Skills", date: "2026-09-22", url: "u4", sourceId: "vllm", source: "vLLM", summary: "短" },
  { title: "Qwen-Image-2.1 + Skills", date: "2026-09-22", url: "u5", sourceId: "llama", source: "llama.cpp", summary: "描述长得多" },
  { title: "Release 5.17.0", date: "2026-09-22", url: "u6", sourceId: "fastapi", source: "FastAPI", summary: "" },
  { title: "proto-v0.3.0", date: "2026-09-22", url: "u7", sourceId: "vllm", source: "vLLM", summary: "" },
  { title: "feat: 真正的新能力上线了", date: "2026-09-21", url: "u8", sourceId: "openai", source: "OpenAI", summary: "" },
  { title: "fix: 修复崩溃", date: "2026-09-20", url: "u9", sourceId: "openai", source: "OpenAI", summary: "" },
];

test("cleanItems 一条龙：折叠包版本 + 跨源去重 + 剔噪声 + 按时间倒序", () => {
  const out = cleanItems(RAW);
  const titles = out.map((i) => i.title);

  // 1) 三个 langchain 包版本折叠成一条
  assert.equal(titles.filter((t) => /langchain-\w+==/.test(t)).length, 0, "包版本没被折叠");
  assert.ok(titles.includes("LangChain 生态 3 个包本周更新"), `未生成汇总条目: ${titles}`);
  // 2) 跨源同名只留一条
  assert.equal(titles.filter((t) => t === "Qwen-Image-2.1 + Skills").length, 1);
  assert.deepEqual([...out.find((i) => i.title === "Qwen-Image-2.1 + Skills").alsoIn].sort(), ["llama.cpp"]);
  // 3) 噪声全清
  assert.ok(!titles.includes("Release 5.17.0"), "裸版本号未被剔除");
  assert.ok(!titles.includes("proto-v0.3.0"), "裸 release tag 未被剔除");
  // 4) 有内容的条目一条不能少
  assert.ok(titles.includes("feat: 真正的新能力上线了"));
  assert.ok(titles.includes("fix: 修复崩溃"));
  // 5) 时间倒序（降噪会重排，必须保证）
  const dates = out.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), `降噪后顺序乱了: ${dates}`);
  // 6) 输入不被就地修改（mergeItems 传进来的是共享引用）
  assert.equal(RAW.length, 9, "cleanItems 不得就地改动入参");
});

test("parseFeed 产出的摘要已经过套话清理（不只是函数本身对）", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
    <item><title>Introducing Vinext 1.0</title><link>https://a.dev/1</link>
    <description>Next.js apps powered by Vite. Read the full article</description></item>
  </channel></rss>`;
  const out = parseFeed(xml, { id: "t", name: "T", kind: "feed", group: "开发工具" });
  assert.equal(out.length, 1);
  assert.ok(!/Read the full article/i.test(out[0].summary), `摘要里还留着套话: ${out[0].summary}`);
  assert.equal(out[0].summary, "Next.js apps powered by Vite.");
});

test("源不提供日期时按今天算，不能静默变成 0 条", () => {
  // 旧写法：ts 置 0 → withinDays 把该源全部滤掉 → 页面只看到「今天没新东西」
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
    <item><title>A meaningful release note here</title><link>https://a.dev/1</link></item>
  </channel></rss>`;
  const out = parseFeed(xml, { id: "t", name: "T", kind: "feed", group: "开发工具" });
  assert.equal(out.length, 1);
  assert.ok(out[0].ts > 0, "ts 不能是 0");
  assert.match(out[0].date, /^\d{4}-\d{2}-\d{2}$/, "date 不能为空");
  assert.equal(out[0].date, beijingDateLike(out[0].ts));
  assert.equal(withinDays(out, Date.now()).length, 1, "无日期条目被时间窗滤掉了");
});

test("cleanSummary 去掉 RSS 套话尾巴，只留首句", () => {
  assert.equal(
    cleanSummary("Learn what's new in Visual Studio Code 1.140 (Insiders) Read the full article"),
    "Learn what's new in Visual Studio Code 1.140 (Insiders)"
  );
  assert.equal(cleanSummary("The post Foo appeared first on Bar."), "");
  assert.equal(cleanSummary("First sentence. Second sentence."), "First sentence.");
  assert.equal(cleanSummary("没有句号的一段摘要"), "没有句号的一段摘要");
  assert.equal(cleanSummary("Breakthrough in inference speed →"), "Breakthrough in inference speed");
});

test("页脚真的用上了每源健康度（源挂了要能看出来）", () => {
  const m = html.match(/const failed=srcs\.filter\([\s\S]{0,500}?<\/span>`/);
  assert.ok(m, "renderVersions 没有统计失败源");
  assert.ok(m[0].includes("本次成功"), "页脚应报出本次成功的源数量");
  assert.ok(m[0].includes("failed.join"), "页脚应列出取失败的源名");
});

test("extractVersion 能从 v0.30.1rc0 这类预发布标签里取到完整版本号", () => {
  assert.equal(extractVersion("v0.30.1rc0: add MI355"), "0.30.1");
  assert.equal(extractVersion("Visual Studio Code 1.140 (Insiders)"), "1.140");
  assert.equal(extractVersion("langchain-core==1.6.5"), "1.6.5");
  assert.equal(extractVersion(" Introducing cf "), "");
});

/* ================= 4. 合并语义 ================= */

test("mergeItems：新 url 记下 firstSeen，旧条目保留不丢，同一 url 不重复", () => {
  const prev = [
    { url: "https://a", title: "旧标题", date: "2026-09-01", firstSeen: "2026-09-01" },
    { url: "https://b", title: "上次的", date: "2026-09-27", firstSeen: "2026-09-27" },
  ];
  const fresh = [
    { url: "https://a", title: "新标题", date: "2026-09-28" },
    { url: "https://c", title: "全新的", date: "2026-09-28" },
  ];
  const out = mergeItems(prev, fresh, "2026-09-28");
  assert.deepEqual([...new Set(out.map((i) => i.url))].sort(), ["https://a", "https://b", "https://c"]);
  // 本次没被抓到的旧条目必须还在（GitHub 限流时会整源失败，不能因此丢历史）
  const b = out.find((i) => i.url === "https://b");
  assert.ok(b, "https://b 消失了");
  // 源挂了不能把用户还没看过的条目降级成旧：firstSeen 必须原样带过
  assert.equal(b.firstSeen, "2026-09-27");
  // 同一个 url 再发新版，以新标题为准，但首次出现时间不变
  assert.equal(out.find((i) => i.url === "https://a").title, "新标题");
  assert.equal(out.find((i) => i.url === "https://a").firstSeen, "2026-09-01");
  assert.equal(out.find((i) => i.url === "https://c").firstSeen, "2026-09-28");
});

test("isNewItem：firstSeen 在 2 天内才算新，自己会过期", () => {
  const now = new Date();
  assert.equal(isNewItem("2026-09-28", now), true);
  assert.equal(isNewItem("2026-09-01", now), false);
  assert.equal(isNewItem("", now), false);
  // 反过来的 bug：存布尔值时源一挂就把 NEW 重置成旧，用户还没看就降级
  const prev = [{ url: "https://b", date: "2026-09-28", firstSeen: "2026-09-28" }];
  const carried = mergeItems(prev, [], "2026-09-28").find((i) => i.url === "https://b");
  assert.equal(isNewItem(carried.firstSeen, now), true, "源挂了一天，NEW 角标不应消失");
});

test("mergeItems 对 fresh 内部的重复 url 只留一条", () => {
  const out = mergeItems([], [{ url: "https://x", title: "1" }, { url: "https://x", title: "2" }]);
  assert.equal(out.length, 1);
});

test("withinDays 只保留时间窗内的条目，旧快照会被收窄", () => {
  const now = Date.now();
  const items = [
    { url: "new", ts: now - 86400000 },
    { url: "edge", ts: now - 29 * 86400000 },
    { url: "old", ts: now - 31 * 86400000 },
  ];
  assert.deepEqual(withinDays(items, now).map((i) => i.url), ["new", "edge"]);
});

/* ================= 5. 数据层 ================= */

const DATA = JSON.parse(readFileSync(new URL("../data/versions.json", import.meta.url), "utf8"));

test("data/versions.json 结构完整且自洽", () => {
  assert.ok(Array.isArray(DATA.items) && DATA.items.length > 0, "产物不能为空");
  assert.ok(Array.isArray(DATA.sources) && DATA.sources.length >= 8, "源数量不应过少");
  assert.ok(DATA.note && DATA.note.includes("fetch-versions.mjs"), "必须写明来源脚本");
  // 每个源都要有健康状态：抓挂了要能在页面上看出来，而不是静默变少
  for (const s of DATA.sources) {
    assert.equal(typeof s.ok, "boolean", `源缺少 ok 字段: ${s.id}`);
    assert.equal(typeof s.n, "number", `源缺少条数字段: ${s.id}`);
  }
  assert.ok(DATA.sources.some((s) => s.ok), "不应所有源都失败");
});

test("产物里没有已知噪声（monorepo 包刷屏 / 裸版本号 / 跨源重发）", () => {
  for (const it of DATA.items) {
    assert.ok(!isPackageBump(it.title), `monorepo 包版本没被折叠: ${it.title}`);
  }
  const seen = new Map();
  for (const it of DATA.items) {
    const k = it.title.toLowerCase().replace(/[0-9][0-9.\-+]*/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
    assert.ok(!seen.has(k), `跨源重发未去重: ${it.title} (${seen.get(k)} / ${it.source})`);
    seen.set(k, it.source);
  }
  // 包版本折叠后应至少留下一条汇总（langchain 是固定源，每天都在）
  assert.ok(DATA.items.some((i) => i.rolledCount > 1), "未见包版本折叠汇总条目");
});

test("影响分级轴没有退化：不能 90% 都是 info", () => {
  // 之前 34 条里 32 条是 info，6 个影响档空了 5 个，「需要你动手」筛选器永远空着
  const info = DATA.items.filter((i) => i.impact === "info").length;
  assert.ok(info / DATA.items.length < 0.9, `info 占比过高（${info}/${DATA.items.length}），影响分级形同虚设`);
  const kinds = new Set(DATA.items.map((i) => i.impact));
  assert.ok(kinds.size >= 2, "所有条目的影响标签都一样");
  // level 判为 feature/perf 的条目不可能是 info——那就是漏了推导
  for (const it of DATA.items) {
    if (it.level === "feature" || it.level === "perf") {
      assert.notEqual(it.impact, "info", `新能力/性能被降级成了 info: ${it.title}`);
    }
  }
});

test("每条产物的 level/impact 都能在页面声明的表里查到（否则会显示成空白标签）", () => {
  for (const it of DATA.items) {
    assert.ok(LEVELS[it.level], `未知 level: ${it.level}`);
    assert.ok(IMPACTS[it.impact], `未知 impact: ${it.impact}`);
    assert.ok(GROUPS.includes(it.group), `未知 group: ${it.group}`);
    assert.match(it.url, /^https?:\/\//, "链接必须是 http(s)");
    assert.ok(!isJunk(it.title), `产物里混进了噪声条目: ${it.title}`);
    assert.ok(it.date && /^\d{4}-\d{2}-\d{2}$/.test(it.date), `日期格式不对: ${it.title}`);
    assert.match(it.firstSeen, /^\d{4}-\d{2}-\d{2}$/, `缺 firstSeen: ${it.title}`);
    assert.equal(it.isNew, isNewItem(it.firstSeen), `isNew 与 firstSeen 不一致: ${it.title}`);
  }
});

test("声明的 levels/impacts/groups 与脚本常量一致（前后端漂移会导致标签渲染成 undefined）", () => {
  assert.deepEqual(Object.keys(DATA.levels).sort(), Object.keys(LEVELS).sort());
  assert.deepEqual(Object.keys(DATA.impacts).sort(), Object.keys(IMPACTS).sort());
  assert.deepEqual(DATA.groups, GROUPS);
});

test("产物按时间倒序，新的在前", () => {
  const dates = DATA.items.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("SOURCES 全部是 https 且不重复", () => {
  const ids = SOURCES.map((s) => s.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), "源 id 重复");
  for (const s of SOURCES) {
    assert.match(s.url, /^https:\/\//, `${s.id} 必须是 https`);
    assert.ok(["feed", "release"].includes(s.kind), `${s.id} 的 kind 非法`);
  }
});

/* ================= 6. 接线层 ================= */

test("学习页挂载了版本变更流区块", () => {
  for (const id of ['id="verList"', 'id="verLevelFilters"', 'id="verSource"', 'id="verDate"', 'id="verBox"']) {
    assert.ok(html.includes(id), `缺少 ${id}`);
  }
  // 必须排在「在线学习流」之前：变更比泛读更该被先看到
  assert.ok(html.indexOf('id="verList"') < html.indexOf('id="learnFeed"'), "版本变更流应排在学习流上方");
});

test("renderVersions / loadVersions / setVerLevel 都存在且挂到 window", () => {
  for (const fn of ["function renderVersions(", "async function loadVersions(", "function setVerLevel("]) {
    assert.ok(html.includes(fn), `缺少 ${fn}`);
  }
  for (const w of ["window.setVerLevel=", "window.renderVersions=", "window.loadVersions="]) {
    assert.ok(html.includes(w), `缺少 ${w}`);
  }
  assert.ok(/^loadVersions\(\);$/m.test(html), "启动时没有调用 loadVersions()");
  assert.ok(html.includes("renderVersions();") && /function renderAll\(\)\{[\s\S]{0,400}renderVersions\(\);/.test(html),
    "renderAll 里没有调 renderVersions()");
});

test("筛选器支持「需要你动手」维度，且这个集合不为空", () => {
  const m = html.match(/const VER_ACT\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, "缺少 VER_ACT 定义");
  const act = m[1].split(",").map((s) => s.trim().replace(/"/g, ""));
  // 「需要动手」必须 = 全部影响标签去掉 info，否则新加一个标签就会默默落进死区
  assert.deepEqual(act.slice().sort(), Object.keys(IMPACTS).filter((k) => k !== "info").sort(),
    "VER_ACT 与 IMPACTS 漂移了");
  const hits = DATA.items.filter((i) => act.includes(i.impact));
  assert.ok(hits.length > 0, "产物里没有任何「需要动手」的条目，筛选器会是个死按钮");
  assert.ok(html.includes("setVerLevel('act')"), "缺少「需要你动手」筛选按钮");
});

test("渲染层对空数据降级而不是崩掉", () => {
  const m = html.match(/if\(!d\|\|!Array\.isArray\(d\.items\)\)\{[\s\S]{0,400}?\n {2}\}/);
  assert.ok(m, "renderVersions 缺少空数据降级分支");
  assert.ok(m[0].includes("版本变更流暂不可用"), "空数据应有明确文案");
});

/* ================= 7. 入口守卫（全工程） =================
 * 背景：以前所有 scripts/fetch-*.mjs 都在模块顶层直接 main().catch(...)。
 * 测试为了拿到纯函数而 import 它们时，会连带真的联网抓取并改写 data/*.json：
 * 全量测试要跑 113 秒，而且每跑一次工作区就多出 data/indie.json 的改动，
 * 一直查不出「是谁改的」——就是这个。 */
test("所有抓取脚本都有入口守卫，不会因被 import 而执行 main()", () => {
  const dir = new URL("../scripts/", import.meta.url);
  for (const name of readdirSync(dir).filter((f) => /^fetch-.*\.mjs$/.test(f))) {
    const src = readFileSync(new URL(name, dir), "utf8");
    assert.match(src, /const isMain = process\.argv\[1\]/, `${name} 缺少入口守卫`);
    assert.match(src, /if \(isMain\) main\(\)/, `${name} 的 main() 没有被守卫包住`);
  }
});

test("入口守卫写对：直接执行会跑，import 不会跑", async () => {
  const before = readFileSync(new URL("../data/versions.json", import.meta.url), "utf8");
  await import("../scripts/fetch-versions.mjs");
  const after = readFileSync(new URL("../data/versions.json", import.meta.url), "utf8");
  assert.equal(before, after, "仅仅 import 就重写了 data/versions.json");
});
