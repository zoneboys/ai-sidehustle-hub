#!/usr/bin/env node
/**
 * 三轨实验室结构抓取 → data/labs.json
 *
 * 为什么需要它：data/labs-curriculum.js 里每条课都写了一个 `src`（源码路径）。
 * 人是会过期的——上游改了目录名、删了文件，这块就变成一堆 404，
 * 而页面上还写着「去读源码」，用户点开是空白，却不知道是内容坏了。
 *
 * 所以每天把三个仓库的真实文件树拉下来存成 labs.json，
 * 页面渲染时用它校验 src 是否还存在：
 * 存在 → 正常显示；不存在 → 明确标出「上游已变更」，而不是默默给个死链。
 *
 * 这就是「深度学习」和「收藏夹」的区别：路径可核对，内容不会悄悄腐烂。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/labs.json");

/** 三个来源。与 data/labs-core.js 的 SRC 一一对应，改一处必须改两处。 */
export const REPOS = [
  { id: "k12", repo: "ObservingTheSea/ObservingTheSea.github.io" },
  { id: "eduagent", repo: "EduAgent/EduAgent" },
  { id: "eduagentx", repo: "EduAgentX-Remake/EduAgentX-BackEnd" },
];

const UA = { "User-Agent": "ai-sidehustle-hub-labs", Accept: "application/vnd.github+json" };

async function getJson(url, token) {
  const headers = Object.assign({}, UA);
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  return res.json();
}

/**
 * 路径是否存在判定。
 * 课程里的 src 既可能是文件（dataset/aoi_material_ext_slide.csv），
 * 也可能是目录（EduAgentX-MicroService/）。
 * 所以要同时给出「文件集合」和「目录集合」两种匹配方式，
 * 只判文件的话，所有以目录为 src 的课会全被误判成失效。
 */
export function makeMatcher(paths) {
  const files = new Set();
  const dirs = new Set();
  for (const p of paths) {
    files.add(p);
    const parts = p.split("/");
    // 逐级加入所有父目录，这样 "a/b" 能匹配 dir "a"
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return function (src) {
    const want = String(src || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!want) return false;
    return files.has(want) || dirs.has(want);
  };
}

async function fetchRepo({ id, repo }, token) {
  const meta = await getJson("https://api.github.com/repos/" + repo, token);
  const tree = await getJson(
    "https://api.github.com/repos/" + repo + "/git/trees/" + meta.default_branch + "?recursive=1",
    token
  );
  const paths = (tree.tree || []).map((t) => t.path);
  return {
    id,
    repo,
    branch: meta.default_branch,
    stars: meta.stargazers_count,
    license: (meta.license && meta.license.spdx_id) || "",
    pushedAt: meta.pushed_at,
    fileCount: paths.length,
    /** 树被截断时 paths 不完整，页面必须知道，否则「路径失效」可能是假警报 */
    truncated: !!tree.truncated,
    matches: makeMatcher(paths),
    _matches: makeMatcher(paths),
  };
}

/** 去掉不可序列化的函数，但保留它给进程内使用 */
function serialize(r, curriculumPaths) {
  const out = {
    id: r.id,
    repo: r.repo,
    branch: r.branch,
    stars: r.stars,
    license: r.license,
    pushedAt: r.pushedAt,
    fileCount: r.fileCount,
    truncated: r.truncated,
  };
  out.used = curriculumPaths
    .filter((c) => c.repoId === r.id)
    .map((c) => ({ lesson: c.lesson, src: c.src, ok: r.matches(c.src) }));
  out.missing = out.used.filter((u) => !u.ok).map((u) => u.src);
  return out;
}

/** 课程里声明的 src 清单。改 labs-curriculum.js 时这里不用动。 */
export const CURRICULUM = [
  { repoId: "eduagent", lesson: "p1", src: "dataset/student_answer_item_revised.csv" },
  { repoId: "eduagent", lesson: "p2", src: "dataset/aoi_material_ext_slide.csv" },
  { repoId: "eduagent", lesson: "p3", src: "dataset/during_behavior_slide.csv" },
  { repoId: "eduagent", lesson: "p4", src: "README.md" },
  { repoId: "eduagent", lesson: "p5", src: "dataset/student_demo_generated.csv" },
  { repoId: "eduagentx", lesson: "e1", src: "EduAgentX-MicroService/" },
  { repoId: "eduagentx", lesson: "e2", src: "EduAgentX-MicroService/EduAgentX-RagService/" },
  { repoId: "eduagentx", lesson: "e3", src: "EduAgentX-MicroService/EduAgentX-AI-Workflow/" },
];

async function main() {
  const token = process.env.GITHUB_TOKEN || "";
  const errors = [];
  const rows = [];
  for (const r of REPOS) {
    try {
      rows.push(await fetchRepo(r, token));
    } catch (e) {
      errors.push(r.repo + "：" + (e && e.message));
    }
  }
  const now = new Date();
  const payload = {
    generatedAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    repos: rows.map((r) => serialize(r, CURRICULUM)),
    errors,
    note: "三个来源的真实文件树，用于校验课程里写的源码路径是否还存在。",
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  const missing = payload.repos.reduce((n, r) => n + r.missing.length, 0);
  console.log("✅ 实验室结构：" + payload.repos.length + "/" + REPOS.length + " 个仓库 → data/labs.json");
  if (missing) console.log("   ⚠️ " + missing + " 个课程源码路径在上游已不存在（页面会标出「上游已变更」）");
  errors.forEach((e) => console.log("   ❌ " + e));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
