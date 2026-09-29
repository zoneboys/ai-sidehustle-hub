#!/usr/bin/env node
/**
 * 人生指南抓取 → data/life.json
 *
 * 接入 github.com/eternity4719/HowToLiveBetter（CC-BY-4.0）。
 * 那本书是 34 节 630 条的纯 Markdown，条目格式固定（见 lib/life-parse.mjs），
 * 天然适合在构建期解析成 JSON 交给页面。
 *
 * 为什么不在浏览器里现抓：
 *   1) 正文 1.48 MB，逐节现取就是 34 个请求，首屏代价太高；
 *   2) 解析要跟上游算法逐行对齐（见 life-parse 的注释），
 *      这段代码必须在 Node 里跑测试，不能散在页面里；
 *   3) 纯静态站没有后端，构建期产物 + 页面懒加载是这个站一贯的做法。
 * 页面侧的数据新鲜度由 data/fresh-core.js 负责：每次打开与线上
 * 条件校验（ETag/304），所以这里产出的快照不会变成"永远不变"。
 *
 * 取正文用 tarball 一次拿全（1 个请求）而不是逐个 contents（34 个请求）：
 * 匿名配额只有 60 次/小时，逐个取会在本地调试时把配额耗光，
 * 而且 workflow 里还挂着别的脚本，共享同一份配额。
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseSection, LENS_LABEL, GRADE_LABEL, linksOf } from "./lib/life-parse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, ".tmp-life");
const REPO = "eternity4719/HowToLiveBetter";
const BRANCH = "main";
const OUT = join(ROOT, "data/life.json");

const token = process.env.GITHUB_TOKEN || "";
function ghHeaders() {
  const h = { "User-Agent": "ai-sidehustle-hub-life-fetch" };
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

async function downloadTarball() {
  const url = `https://api.github.com/repos/${REPO}/tarball/${BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders(), redirect: "follow" });
  if (!res.ok) throw new Error(`tarball ${res.status} ${res.statusText}`);
  mkdirSync(TMP, { recursive: true });
  const tgz = join(TMP, "src.tgz");
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  // GitHub 的 tarball 顶层是一个随机名目录，解压后取唯一的那个子目录。
  // 必须用相对文件名 + cwd：Windows 的 tar 会把 "F:\..." 里的盘符冒号
  // 当成「远程主机:路径」分隔符，报 "Cannot connect to F: resolve failed"。
  execFileSync("tar", ["-xzf", "src.tgz"], {
    cwd: TMP,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const dirs = readdirSync(TMP, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(TMP, d.name));
  if (dirs.length !== 1) throw new Error(`tarball 解压出 ${dirs.length} 个目录，预期 1 个`);
  return dirs[0];
}

const errors = [];

async function main() {
  const root = await downloadTarball();
  const bookDir = join(root, "book");
  if (!existsSync(bookDir)) {
    throw new Error("tarball 里没有 book/ 目录，上游结构变了");
  }

  const files = readdirSync(bookDir)
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .sort();

  const sections = [];
  let total = 0;
  for (const f of files) {
    try {
      const md = readFileSync(join(bookDir, f), "utf8");
      const secs = parseSection(md);
      for (const s of secs) {
        s.file = "book/" + f;
        s.entries = s.entries.map((e) => ({
          ...e,
          lensLabel: LENS_LABEL[e.lens] || e.lens || "",
          gradeLabel: GRADE_LABEL[e.grade] || "",
          links: linksOf(e.src + " " + e.note),
        }));
        total += s.entries.length;
      }
      sections.push(...secs);
    } catch (e) {
      errors.push(f + "：" + e.message);
    }
  }

  if (!sections.length) {
    throw new Error("一节都没解析出来——上游格式很可能变了，拒绝写出空快照");
  }

  // 仓库元信息：让页面能显示「取自哪一版」，而不是含糊地说"已同步"
  let stars = null, license = null, pushedAt = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: ghHeaders() });
    if (r.ok) {
      const j = await r.json();
      stars = j.stargazers_count ?? null;
      license = j.license && j.license.spdx_id ? j.license.spdx_id : null;
      pushedAt = j.pushed_at || null;
    }
  } catch (e) {
    errors.push("仓库元信息：" + e.message);
  }

  const now = new Date();
  const meta = {
    generatedAt: now.toISOString(),
    source: {
      repo: REPO,
      branch: BRANCH,
      url: "https://github.com/" + REPO,
      site: "https://eternity4719.github.io/HowToLiveBetter/",
      license: license,
      stars: stars,
      pushedAt: pushedAt,
    },
    note:
      "由 scripts/fetch-life.mjs 从上游 book/*.md 解析生成。" +
      "条目格式与性价比算法逐条对齐上游 index.html（见 scripts/lib/life-parse.mjs），" +
      "不是二次创作。原文与勘误以上游为准，本文件仅为检索与筛选便利而重新组织。",
    sectionCount: sections.length,
    entryCount: total,
    lensLabel: LENS_LABEL,
    gradeLabel: GRADE_LABEL,
    errors,
  };

  // 按节拆成 data/life/NN.json，life.json 只当目录用。
  // 不拆的话整个 1.5 MB（gzip 后 550 KB）会在打开标签页时一次性下来，
  // 而一个人一次只会读一两节。拆开后：开标签页只下 ~15 KB 目录，
  // 点进某一节再下那 ~15 KB，翻过的节会被浏览器缓存。
  // 目录里带上 hash，页面才能知道本地缓存的节是不是当前版本。
  const outDir = join(ROOT, "data/life");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const dir = { ...meta, sections: [] };
  let allBytes = 0;
  for (const s of sections) {
    const file = "data/life/" + String(s.n).padStart(2, "0") + ".json";
    const body = {
      generatedAt: meta.generatedAt,
      source: meta.source,
      n: s.n,
      title: s.title,
      intro: s.intro,
      entries: s.entries,
    };
    const text = JSON.stringify(body);
    allBytes += Buffer.byteLength(text);
    writeFileSync(join(ROOT, file), text);
    dir.sections.push({
      n: s.n,
      title: s.title,
      file: file,
      intro: s.intro,
      count: s.entries.length,
      // 分面计数：让页面在不下正文的情况下就能画出筛选条
      ratio: tally(s.entries, "ratio"),
      lens: tally(s.entries, "lens"),
      grade: tally(s.entries, "grade"),
      dispute: s.entries.filter((e) => e.dispute).length,
    });
  }

  mkdirSync(dirname(OUT), { recursive: true });
  const dirText = JSON.stringify(dir);
  writeFileSync(OUT, dirText);
  console.log(
    `✅ 人生指南：${sections.length} 节 / ${total} 条 · 目录 ${(Buffer.byteLength(dirText) / 1024).toFixed(0)} KB` +
      ` · 正文合计 ${(allBytes / 1024 / 1024).toFixed(2)} MB` +
      (stars ? ` · ${stars} star / ${license}` : "")
  );
  if (errors.length) {
    console.log("⚠️ " + errors.length + " 处失败：");
    for (const e of errors) console.log("   - " + e);
  }
}

/** 统计某个字段的取值分布，用于目录里的分面计数 */
function tally(entries, field) {
  const out = {};
  for (const e of entries) {
    const v = e[field];
    if (!v) continue;
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}

// 入口守卫：tests/versions.test.mjs 会 import 这个文件来检查它的产出约定，
// 没有守卫的话 import 一次就真的去下载 tarball，测试直接联网。
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main()
  .catch((e) => {
    console.error("❌ " + e.message);
    process.exit(1);
  })
  .finally(() => {
    rmSync(TMP, { recursive: true, force: true });
  });
