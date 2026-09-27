#!/usr/bin/env node
/**
 * 预览服务器（仅本地验证用）：托管真实站点 + 模拟 data/daily-scout.json，
 * 用于在浏览器里人工验证「已配置 sieve」时前端的渲染路径。
 * 运行：node tests/fixtures/scout-preview-server.mjs   （Ctrl+C 退出）
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCOUT = {
  generatedAt: new Date().toISOString(),
  date: new Date().toISOString().slice(0, 10),
  sessionId: "sess_preview_demo",
  conformance: "pass",
  topics: [
    {
      topic: "AI 脚本短视频",
      status: "本月仍值得尝试：平台流量分成稳定，AI 内容标注新规需遵守。",
      changes: "部分平台要求 AI 生成内容显式标注，未标注可能限流。",
      opportunities: [
        { title: "「AI 创作者激励计划」征稿（示例数据）", url: "https://example.com/preview/plan", source: "示例站点", date: "2026-09-26" },
      ],
      actions: ["每天产出 1 条垂直内容并标注 AI 生成", "复盘前 3 天的完播率数据"],
    },
    {
      topic: "AI 头像定制",
      status: "竞争加剧，需差异化（如宠物拟人、情侣模板）。",
      changes: "无明显变化。",
      opportunities: [],
      actions: ["上架 9.9 元基础套餐试转化", "收集 5 组客户对比图做案例"],
    },
  ],
  errors: [],
  note: "预览数据（tests/fixtures），非真实 sieve 运行结果。",
};

const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

createServer(async (req, res) => {
  const u = req.url.split("?")[0];
  try {
    if (u === "/data/daily-scout.json") {
      res.writeHead(200, { "Content-Type": MIME[".json"] });
      res.end(JSON.stringify(SCOUT, null, 2));
      return;
    }
    const file = join(ROOT, u === "/" ? "index.html" : u);
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(4175, () => console.log("预览: http://127.0.0.1:4175 （含模拟 daily-scout.json）"));
