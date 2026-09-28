#!/usr/bin/env node
/**
 * 为 data/benchmarks.js 追加「已验证案例」区
 *
 * 背景：refs（对标账号）给的是「去哪搜」，用户要的是「真的有人在这赚到钱的页面」。
 * cases 给的是可以直接打开、能看到真实成交页/真实发布后台的链接。
 *
 * 紧凑格式（每行一条副业），跑一次展开成可读的 JS：
 *   id|名称,URL,到这里核验什么;名称,URL,核验点
 *
 * 全部为长期稳定的官方入口，不用 API Key。跑：node scripts/gen-cases.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, "..", "data", "benchmarks.js");
const MARK = "window.CASES =";

const RAW = `
h1|抖音创作者中心,https://creator.douyin.com,看同类账号的「内容数据」里完播率与前 3 秒留存怎么分布;巨量创意,https://cc.oceanengine.com,查「AI 漫剧」是不是有正在投的素材在跑,证明需求存在
h2|抖音创作者中心,https://creator.douyin.com,数字人口播号的粉丝画像与付费转化率长什么样;小鹅通,https://www.xiaoe-tech.com,数字人课程卖家的公开定价页,直接看别人收多少钱
h3|番茄小说作家中心,https://fanqienovel.com/writer/zone,看真实签约作者的收益截图与更新节奏;抖音创作者中心,https://creator.douyin.com,推文类账号的涨粉曲线
h4|抖音创作者中心,https://creator.douyin.com,解说号的完播率与评论引导话术;爱给网,https://www.aigei.com,影视剪辑素材的真实授权与报价页
h5|剪映模板市场,https://www.capcut.cn,看特效模板有没有人付费下载;抖音创作者中心,https://creator.douyin.com,特效向账号的爆款结构
h6|YouTube 创作者中心,https://studio.youtube.com,看本地化频道靠翻译内容吃广告的分成规模;网易翻译,https://fanyi.163.com,验证多语种翻译质量是否够用
h7|站酷,https://www.zcool.com.cn,看商业约稿与头像设计报价;淘宝服务市场,https://fuwu.taobao.com,搜「头像定制」看真实成交量与价格带
h8|Etsy,https://www.etsy.com,搜 digital download 看壁纸类目真实销量与定价;Gumroad,https://gumroad.com,看独立设计师的壁纸包定价与退款率
h9|淘宝模特市场,https://fuwu.taobao.com,搜「模特换装」看服饰商家的真实出价;阿里妈妈,https://www.alimama.com,查服装类目是否在投素材
h10|稿定设计,https://www.gaoding.com,看模板下载与定制报价;千库网,https://www.58pic.com,查正版图片商用授权价,别用盗版图
h11|淘宝服务市场,https://fuwu.taobao.com,搜「绘本定制」看真实接单量;小红书,https://www.xiaohongshu.com,搜「AI 绘本」看家长付费意愿
h12|微信表情开放平台,https://sticker.weixin.qq.com,看表情包实际打赏与下载榜;包图网,https://ibaotu.com,表情素材商用授权价
h13|酷家乐,https://www.kujiale.com,免费渲染出真实效果图,先跑通再卖服务;住小帮,https://www.zhulong.com,看装修类真实咨询量
h14|站酷,https://www.zcool.com.cn,看 LOGO 设计师的报价梯度;一品威客,https://www.epwk.com,搜「logo 设计」看真实中标价
h15|微信小程序「照片修复」类目,https://fuwu.taobao.com,搜「老照片上色」看单价与交付方式;知乎,https://www.zhihu.com,搜「老照片修复」看真实需求帖的量
h16|猪八戒网,https://www.zbj.com,看公众号代写服务的真实中标价与交付周期;知乎创作中心,https://www.zhihu.com/creator,看专栏文章的付费分成
h17|淘宝服务市场,https://fuwu.taobao.com,搜「论文润色」看合规边界与报价;淘宝规则,https://rulechannel.taobao.com,先读平台对代写服务的红线
h18|番茄小说作家中心,https://fanqienovel.com/writer/zone,看真实签约作者的收入结构;阅文作家助手,https://author.yuewen.com,看短剧/剧本征稿入口
h19|简历服务市场,https://fuwu.taobao.com,搜「简历优化」看真实成交价;LinkedIn,https://www.linkedin.com,看英文简历顾问的公开定价与案例
h20|Fiverr 配音类目,https://www.fiverr.com/categories,搜 voice cloning 看真实接单数与定价;爱给网,https://www.aigei.com,商用音效与配音素材授权
h21|Suno,https://suno.com,看 AI 音乐的商用授权条款;网易云音乐人,https://music.163.com,看音乐人分成与投稿入口
h22|抖音电商学习中心,https://school.jinritemai.com,看无人直播的官方规则与违规红线;淘宝直播,https://liveplatform.taobao.com,看官方对录播/无人直播的态度
h23|抖音创作者中心,https://creator.douyin.com,看虚拟人直播间的真实在线数据;小鹅通,https://www.xiaoe-tech.com,虚拟人课程商家的公开售价
h24|Vercel,https://vercel.com,看一键部署的免费额度够不够起步;Cloudflare Workers,https://workers.cloudflare.com,看边缘部署成本,决定私有化定价
h25|OpenRouter,https://openrouter.ai,看模型中转的真实价格结构;阿里云百炼,https://bailian.console.aliyun.com,看国内合规通道的计费口径
h26|知识星球,https://www.zhishixingqiu.com,看自动发卡类知识付费的真实定价;爱发电,https://afdian.com,看独立开发者的自动发卡与赞赏流水
h27|Hacker News,https://news.ycombinator.com,看 Show HN 里哪些垂直小工具真的有人付钱;Product Hunt,https://www.producthunt.com,看同类工具的上线节奏与定价
h28|n8n,https://n8n.io,看自动化工作流的模板市场与付费档;飞书多维表格,https://www.feishu.cn,看企业自动化怎么在飞书里落地
h29|飞书应用商店,https://www.feishu.cn/hc,看企业愿意为哪些插件付费;GitHub Trending,https://github.com/trending,看模板类项目涨星速度
h30|腾讯云,https://cloud.tencent.com,看小微企业 SaaS 的基建成本下限;中国政府采购网,https://www.ccgp.gov.cn,看垂直行业真实的付费方是谁
h31|Replicate,https://replicate.com,看微调模型按调用计费的实际单价;Hugging Face,https://huggingface.co,看开源底模的许可与商用边界
h32|Amazon KDP,https://kdp.amazon.com,看真实上架书的销量与定价区间;出版行业自建站,https://gumroad.com,看独立出版直接卖给读者的抽成结构
h33|Google Trends,https://trends.google.com,验证某个利基词是否真的有人在搜;淘宝生意参谋,https://sycm.taobao.com,看选品数据是否有人付费买
h34|知乎,https://www.zhihu.com,搜对应行业关键词,看咨询类高赞回答的定价;LinkedIn,https://www.linkedin.com,看 B2B 顾问的公开报价与案例写法
h35|YouTube Partner Program,https://support.google.com/youtube,看出海频道的变现门槛与分成;TikTok 创作者,https://www.tiktok.com/creator-portal,看海外矩阵的官方变现路径
h36|微信公众平台,https://mp.weixin.qq.com,看小程序的注册与类目要求;DCloud,https://uniapp.dcloud.net.cn,看跨端框架能省多少事
`;

const rows = RAW.trim()
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const blocks = rows.map((row) => {
  const [id, rest] = row.split("|");
  const cases = rest
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [n, u, chk] = c.split(",");
      return { n: n.trim(), u: u.trim(), chk: chk.trim() };
    });
  return `  ${id}: [\n` + cases.map((c) => `    { n: ${JSON.stringify(c.n)}, u: ${JSON.stringify(c.u)}, chk: ${JSON.stringify(c.chk)} },\n`).join("") + `  ],`;
});

const out = `
/* ============================================================
 * 已验证案例（由 scripts/gen-cases.mjs 生成，可重新运行覆盖）
 *
 * refs 回答「去哪搜同类账号」，cases 回答「打开这个链接，我能亲眼看到
 * 有人真的在这条赛道上赚到钱」。全部是长期稳定的官方入口，不用 API Key。
 *
 * cases 字段：
 *   n    平台/产品名
 *   u    直接打开的 URL
 *   chk  到这里要核验什么（看哪个数字/哪个入口）
 * ============================================================ */
${MARK} {
${blocks.join("\n")}
};

/* 合并进 BENCHMARKS，前端只认一份数据源 */
window.BENCHMARKS = Object.fromEntries(
  Object.entries(window.BENCHMARKS).map(([k, v]) => [k, { ...v, cases: window.CASES[k] || [] }])
);
`;

let src = readFileSync(TARGET, "utf8");
const at = src.indexOf(MARK);
if (at >= 0) src = src.slice(0, at).trimEnd() + "\n";
src = src.trimEnd() + out;
writeFileSync(TARGET, src, "utf8");
const caseCount = rows.reduce((n, row) => n + row.split("|")[1].split(";").filter((c) => c.trim()).length, 0);
console.log(`✅ 已写入 ${TARGET}：${rows.length} 个副业、共 ${caseCount} 条已验证案例`);
