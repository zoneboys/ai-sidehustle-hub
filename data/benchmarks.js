/* 对标账号 / 对标案例库（每个副业配套）
 *
 * 解决「不知道去哪儿找对标」的问题：每个副业给出可复制的搜索关键词 + 该盯什么。
 * 链接由前端按平台统一生成（见 index.html 的 siteSearch），平台变了改这一处即可。
 *
 * refs 字段：
 *   p    平台（抖音 / 小红书 / B站 / YouTube / 闲鱼 / 淘宝 / 微信 / GitHub / 知乎 / 微博 / Reddit / Behance / Gumroad）
 *   k    搜索关键词（用户可一键复制后到对应平台搜索）
 *   why  重点看什么：拆解时要盯的 1-2 个点（抄结构不抄内容）
 * note  整条赛道的新手避坑提醒（可选）
 */
window.BENCHMARKS = {

h1: { refs: [
  { p: "抖音", k: "AI 漫剧 剧情向", why: "前 3 秒钩子怎么写的；口播/画面如何交替避免划走" },
  { p: "小红书", k: "AI 短视频 起号 复盘", why: "新手前 20 条的播放量曲线，定位起号期该投多少条" },
  { p: "B站", k: "AI 短视频 工作流 教程", why: "整条生产链的工具顺序，抄流程不抄素材" }
], note: "对标号别只抄选题，重点抄「开头 3 秒 + 每 5 秒一个信息点」的节奏。" },

h2: { refs: [
  { p: "抖音", k: "数字人 口播 带货", why: "数字人表情/停顿是否自然；话术里产品出现的时机" },
  { p: "小红书", k: "AI 数字人 矩阵 运营", why: "一个 IP 怎么拆多条子账号不判重复" },
  { p: "YouTube", k: "AI avatar channel faceless", why: "英文市场的选题库和缩略图模板" }
], note: "平台对「无人直播/数字人带货」审核越来越严，先小额跑通再放大。" },

h3: { refs: [
  { p: "抖音", k: "小说推文 推文推广", why: "开头 100 字的信息密度；每集结尾的悬念钩子" },
  { p: "快手", k: "动态漫 短剧 推文", why: "分格画面的转场节奏和配音情绪" },
  { p: "TikTok", k: "novel promotion comic", why: "出海版本的画风与字幕样式" }
], note: "画同人/小说画面容易触发版权投诉，先用公版书与原创形象做冷启动。" },

h4: { refs: [
  { p: "抖音", k: "电影解说 剪辑", why: "解说稿的三幕结构；开头 15 秒如何留住人" },
  { p: "B站", k: "影视飓风 剪辑 教程", why: "拉片与节奏点标注方法（这才是可复用的手艺）" },
  { p: "YouTube", k: "movie recap channel", why: "英文市场的版权规避做法" }
], note: "直接用电影片段有版权风险，优先做公版片、动画或只用静态画面+解说。" },

h5: { refs: [
  { p: "抖音", k: "瞬息全宇宙 特效 复刻", why: "首尾帧的一致性怎么控制；转场的运动曲线" },
  { p: "YouTube", k: "transformation video ai", why: "曲线的关键帧节奏与配乐对齐" },
  { p: "小红书", k: "AI 特效 视频 教程", why: "国内可用的平替工具链" }
], note: "特效类涨粉快但转化难，先把它当涨粉引流号，别指望直接变现。" },

h6: { refs: [
  { p: "YouTube", k: "dubbify channel", why: "多语言配音后的频道矩阵怎么铺" },
  { p: "TikTok", k: "翻译搬运 搬运工", why: "搬运号的封面与标题本地化套路" },
  { p: "小红书", k: "视频翻译 出海 复盘", why: "国内平台对搬运的判定标准" }
], note: "搬运是高危动作，一定要拿到原始授权或改到「二创+评论+重构」程度。" },

h7: { refs: [
  { p: "小红书", k: "AI 头像 定制 接单", why: "商品图排版、9 张套餐的呈现方式、评论区怎么引导返图" },
  { p: "闲鱼", k: "AI 头像", why: "关键词堆砌与主图设计（同行的主图 CTR 差距很大）" },
  { p: "抖音", k: "AI 绘画 接单 教程", why: "从 0 到第一单的完整话术" }
], note: "接单类最关键的是交付速度，先把「出图 30 分钟内交付」做成承诺。" },

h8: { refs: [
  { p: "Zcool", k: "AI 壁纸 原创", why: "投稿规范与作者标签设置，决定能不能被搜到" },
  { p: "Patreon", k: "wallpaper pack ai", why: "订阅制的档位设计与每月更新节奏" },
  { p: "小红书", k: "手机壁纸 售卖", why: "国内付费壁纸的变现渠道" }
], note: "壁纸赛道是典型的「一次性批量+长期分成」，重点在风格统一而不是单张惊艳。" },

h9: { refs: [
  { p: "小红书", k: "AI 模特 电商 图", why: "同色系成组出图，商家最认「一套 6 张可直接上架」" },
  { p: "淘宝", k: "AI 模特 换装 服务", why: "定价档位与交付时效承诺" },
  { p: "抖音", k: "电商 换装 模特 教程", why: "用平铺图还原上身效果的关键参数" }
], note: "B 端最怕改稿，签单前先免费出 1 张试稿并写清「超出 2 次修改加价」。" },

h10: { refs: [
  { p: "Behance", k: "AI poster design", why: "国际化的排版与留白标准" },
  { p: "站酷", k: "AI 电商 详情页", why: "电商图的信息层级（主图/细节/场景）" },
  { p: "小红书", k: "AI 海报 模板", why: "模板化商品图的爆款封面套路" }
], note: "广告图法务风险高，慎接医疗、金融、的功效宣称类客户。" },
h11: { refs: [
  { p: "小红书", k: "AI 绘本 定制", why: "家长最在意的是「故事被讲成自己孩子的样子」，看它怎么塞进孩子特征" },
  { p: "淘宝", k: "AI 儿童绘本 定制", why: "定价档位与页数规格" },
  { p: "抖音", k: "AI 绘本 故事 视频", why: "绘本 + 配音短视频的二次分发玩法" }
], note: "涉及儿童内容，务必过滤敏感词、不过度生成真人儿童形象。" },

h12: { refs: [
  { p: "微信", k: "表情包 投稿 审核", why: "微信表情开放平台的尺寸与送审规范（硬门槛）" },
  { p: "小红书", k: "AI 表情包 批量", why: "同一套角色如何批量出 16/24 个格子" },
  { p: "Zcool", k: "表情包 设计", why: "商用授权与可编辑源文件的交付" }
], note: "表情包不是「生成完就赚钱」，靠的是角色一致性 + 版权干净 + 平台分成。" },

h13: { refs: [
  { p: "小红书", k: "AI 家装 效果图", why: "同一套户型的多风格出图，业主最爱看哪种" },
  { p: "站酷", k: "室内设计 效果图", why: "专业效果图的光影与材质标准" },
  { p: "淘宝", k: "全屋定制 效果图 服务", why: "设计师/装修公司的批量需求入口" }
], note: "效果图与实装落差会引发纠纷，交付时务必写明「AI 概念图，非施工依据」。" },

h14: { refs: [
  { p: "站酷", k: "LOGO 设计 接单", why: "报价怎么拆（基础款/延展/版权）" },
  { p: "Behance", k: "brand identity guide", why: "完整的品牌规范交付物长什么样" },
  { p: "小红书", k: "AI LOGO 设计", why: "AI 出稿 + 手工精修的分工流程" }
], note: "商标能否注册要单独查，别承诺「包过」，把它写进报价单的免责项。" },

h15: { refs: [
  { p: "小红书", k: "老照片 修复 上色 接单", why: "价格梯度（张数/清晰度）与修复前后对比图" },
  { p: "抖音", k: "老照片 修复 教学", why: "无损放大与上色的工具链" },
  { p: "淘宝", k: "老照片 修复 黑白", why: "批量接单的交付流程" }
], note: "最大的坑是「修完和本人不像」，提前和客户确认预期、留原片备份。" },

h16: { refs: [
  { p: "小红书", k: "公众号 代写 报价", why: "按字数报价时的档位与交付格式" },
  { p: "知乎", k: "公众号 爆文 结构", why: "爆款开头的 5 种写法" },
  { p: "淘宝", k: "文案 代写 软文", why: "接单渠道与改稿规则" }
], note: "AI 初稿必须自己改到「能署名」，直接交 AI 味文本最容易砸招牌。" },

h17: { refs: [
  { p: "知乎", k: "论文 润色 服务", why: "学术英语润色的报价与承诺边界" },
  { p: "淘宝", k: "论文 润色 价格", why: "同行定价区间，别打价格战" },
  { p: "小红书", k: "文献综述 AI 工具", why: "检索与综述写作的合规工具链" }
], note: "红线：只做语言润色与格式规范，绝不代写数据、结论和整篇论文。" },

h18: { refs: [
  { p: "番茄小说", k: "AI 写作 新人 签约", why: "签约门槛与黄金三章的数据要求" },
  { p: "知乎", k: "AI 短剧 编剧", why: "短剧分集结构的钩子设计" },
  { p: "B站", k: "AI 小说 批量 生成 教程", why: "长篇一致性（人设/大纲）怎么维护" }
], note: "平台 AI 声明政策在变，发布前看清当期规则，必要时手动标注 AI 参与。" },

h19: { refs: [
  { p: "小红书", k: "简历 优化 求职", why: "服务型简历的报价区间与交付（可编辑源文件）" },
  { p: "知乎", k: "简历 投了 100 份 没回音", why: "ATS 关键词与量化成果的写法" },
  { p: "Boss", k: "远程 简历 优化", why: "针对远程岗位的技能关键词" }
], note: "别承诺「保offer」，只承诺「一轮 1v1 沟通 + 两轮修改」这种可交付的东西。" },

h20: { refs: [
  { p: "小红书", k: "AI 配音 定制 服务", why: "音色库的展示方式（同一段文案的音色对比）" },
  { p: "B站", k: "AI 声音克隆 教程", why: "10 秒样本的采集与去噪流程" },
  { p: "知乎", k: "有声书 AI 配音 版权", why: "克隆他人声音的法律边界" }
], note: "声音克隆必须拿到本人书面授权，声纹是生物特征，商用纠纷很贵。" },

h21: { refs: [
  { p: "YouTube", k: "ai music channel", why: "AI 音乐的变现模式（流媒体/同步授权）" },
  { p: "Gumroad", k: "lofi beats pack", why: "打包售卖 beats 的定价与授权分层" },
  { p: "小红书", k: "AI 作曲 提示词", why: "中文提示词写法与风格控制" }
], note: "各平台对 AI 音乐的标注政策不同，发布前确认是否需要声明 AI 生成。" },

h22: { refs: [
  { p: "抖音", k: "无人直播 规则", why: "平台对无人直播的最新判定标准（务必先看规则）" },
  { p: "知乎", k: "AI 数字人 直播 违规", why: "被封的真实案例与触发原因" },
  { p: "视频号", k: "无人直播 起号", why: "私域转化路径设计" }
], note: "无人直播是各平台重点打击对象，风险远高于收益，务必先小号测试并读当期规则。" },

h23: { refs: [
  { p: "抖音", k: "数字人 直播 带货 案例", why: "真人中控 + 数字人Hybrid 的分工" },
  { p: "小红书", k: "虚拟主播 直播 复盘", why: "开播时段与话术节奏" },
  { p: "B站", k: "vtuber 直播 运营", why: "人设经营与内容排期" }
], note: "虚拟人直播要有人类实时中控兜底，纯循环播放容易被判为虚假宣传。" },

h24: { refs: [
  { p: "GitHub", k: "llm wrapper boilerplate", why: "开源骨架能省掉多少重复工作" },
  { p: "Vercel", k: "ai template gallery", why: "一键部署的官方模板" },
  { p: "知乎", k: "AI 套壳 产品 变现", why: "套壳产品的续费与迁移成本设计" }
], note: "套壳壁垒在「私有化部署 + 数据本地」和交付能力，纯换皮随时被大厂吞掉。" },
h25: { refs: [
  { p: "GitHub", k: "openai api proxy", why: "中转层的重试、限流、日志该怎么做" },
  { p: "知乎", k: "api 中转 站 搭建", why: "成本模型与失败率" },
  { p: "开发者", k: "openrouter", why: "成熟的多模型聚合的计费与路由设计" }
], note: "中转业务合规敏感（数据出境、发票、上游协议），务必确认上游 ToS。" },

h26: { refs: [
  { p: "GitHub", k: "card shop open source", why: "现成发卡系统的功能清单与支付接入" },
  { p: "闲鱼", k: "自动发卡 教程", why: "国内最常见的履约方式" },
  { p: "知乎", k: "发卡 站 源码 部署", why: "搭建成本与常见故障" }
], note: "虚拟商品自动发货有欺诈与退款纠纷风险，务必做实名与异常订单拦截。" },

h27: { refs: [
  { p: "Product Hunt", k: "ai productivity tool", why: "海外同类工具的定价与免费额度设计" },
  { p: "GitHub", k: "awesome ai tools", why: "已被验证的工具品类清单" },
  { p: "小红书", k: "效率工具 独立开发", why: "国内用户愿意付费的效率场景" }
], note: "垂直工具的生死在「一个具体场景」，先解决一个人群的一个高频麻烦事。" },

h28: { refs: [
  { p: "n8n", k: "workflow template gallery", why: "官方模板库的爆款工作流都在解决什么问题" },
  { p: "GitHub", k: "ai agent workflow", why: "可复用的编排骨架" },
  { p: "知乎", k: "企业 ai 自动化 落地", why: "从 PoC 到生产的真实卡点" }
], note: "企业自动化交付要收「运维 + 迭代」的钱，只卖一次性搭建必亏。" },

h29: { refs: [
  { p: "Chrome", k: "web store extension ai", why: "扩展的评分与更新节奏" },
  { p: "GitHub", k: "awesome chrome extensions", why: "还有哪些没被做掉的痛点插件" },
  { p: "Figma", k: "community file template", why: "设计模板的免费引流 → 付费转化路径" }
], note: "模板/插件是典型的「一次开发多次售卖」，定价看使用量而非功能数。" },

h30: { refs: [
  { p: "Product Hunt", k: "vertical saas", why: "垂直 SaaS 的最小可行范围怎么切" },
  { p: "Indie Hackers", k: "micro saas revenue", why: "小而美 SaaS 的真实收入量级" },
  { p: "知乎", k: "垂直 saas 赛道 分析", why: "国内哪些行业还没被系统化" }
], note: "先做「有预算的 B 端」，C 端通用工具在没有增长预算时很难活。" },

h31: { refs: [
  { p: "HuggingFace", k: "lora adapter dataset", why: "公开数据集 + LoRA 的最短可行路径" },
  { p: "GitHub", k: "finetune llm colab", why: "单卡微调的资源门槛" },
  { p: "知乎", k: "模型微调 接单 报价", why: "微调服务的市场价与交付物清单" }
], note: "微调交付要连同「数据来源合法性」一起说清，否则客户法务会卡住。" },

h32: { refs: [
  { p: "Gumroad", k: "ebook ai guide", why: "独立出版的价格与页数规格" },
  { p: "Amazon KDP", k: "ai book publish", why: "上架流程与 AI 内容的合规要求" },
  { p: "小红书", k: "出海 电子书 变现", why: "英文长尾关键词的选品思路" }
], note: "AI 生成的电子书平台政策变动快，务必先确认当期是否需要声明与抽成规则。" },

h33: { refs: [
  { p: "Product Hunt", k: "dataset marketplace", why: "数据包的产品化方式" },
  { p: "GitHub", k: "awesome datasets", why: "还有哪些高频缺口数据集" },
  { p: "知乎", k: "数据 付费 商业模式", why: "数据确权与合规边界" }
], note: "数据合规是最大风险：只用公开可商用数据，来源写清楚，别碰个人信息。" },

h34: { refs: [
  { p: "知乎", k: "ai 咨询 顾问 收费", why: "顾问的交付物怎么定义（诊断报告 vs 驻场）" },
  { p: "LinkedIn", k: "ai consultant", why: "英文市场的咨询定位与报价" },
  { p: "小红书", k: "ai 落地 顾问 复盘", why: "国内中小企业愿意为什么付费" }
], note: "咨询交付要「可复用的资产」（SOP/评估表），否则就是卖时间。" },

h35: { refs: [
  { p: "YouTube", k: "faceless channel ai", why: "英文矩阵的选题与发布节奏" },
  { p: "TikTok", k: "矩阵 起号", why: "多账号的差异化做法" },
  { p: "知乎", k: "出海 内容 矩阵 复盘", why: "国内做矩阵的真实踩坑" }
], note: "矩阵的前提是单号跑通，先用 20 条内容验证一个模板再复制。" },

h36: { refs: [
  { p: "微信", k: "小程序 接入 ai", why: "微信生态内的 AI 能力与审核要点" },
  { p: "GitHub", k: "miniprogram ai template", why: "现成脚手架" },
  { p: "知乎", k: "ai 小程序 变现", why: "国内小程序的分发与变现路径" }
], note: "小程序上线要过审，AI 生成内容需加内容安全过滤，别踩违规词。" },

};
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
window.CASES = {
  h1: [
    { n: "抖音创作者中心", u: "https://creator.douyin.com", chk: "看同类账号的「内容数据」里完播率与前 3 秒留存怎么分布" },
    { n: "巨量创意", u: "https://cc.oceanengine.com", chk: "查「AI 漫剧」是不是有正在投的素材在跑" },
  ],
  h2: [
    { n: "抖音创作者中心", u: "https://creator.douyin.com", chk: "数字人口播号的粉丝画像与付费转化率长什么样" },
    { n: "小鹅通", u: "https://www.xiaoe-tech.com", chk: "数字人课程卖家的公开定价页" },
  ],
  h3: [
    { n: "番茄小说作家中心", u: "https://fanqienovel.com/writer/zone", chk: "看真实签约作者的收益截图与更新节奏" },
    { n: "抖音创作者中心", u: "https://creator.douyin.com", chk: "推文类账号的涨粉曲线" },
  ],
  h4: [
    { n: "抖音创作者中心", u: "https://creator.douyin.com", chk: "解说号的完播率与评论引导话术" },
    { n: "爱给网", u: "https://www.aigei.com", chk: "影视剪辑素材的真实授权与报价页" },
  ],
  h5: [
    { n: "剪映模板市场", u: "https://www.capcut.cn", chk: "看特效模板有没有人付费下载" },
    { n: "抖音创作者中心", u: "https://creator.douyin.com", chk: "特效向账号的爆款结构" },
  ],
  h6: [
    { n: "YouTube 创作者中心", u: "https://studio.youtube.com", chk: "看本地化频道靠翻译内容吃广告的分成规模" },
    { n: "网易翻译", u: "https://fanyi.163.com", chk: "验证多语种翻译质量是否够用" },
  ],
  h7: [
    { n: "站酷", u: "https://www.zcool.com.cn", chk: "看商业约稿与头像设计报价" },
    { n: "淘宝服务市场", u: "https://fuwu.taobao.com", chk: "搜「头像定制」看真实成交量与价格带" },
  ],
  h8: [
    { n: "Etsy", u: "https://www.etsy.com", chk: "搜 digital download 看壁纸类目真实销量与定价" },
    { n: "Gumroad", u: "https://gumroad.com", chk: "看独立设计师的壁纸包定价与退款率" },
  ],
  h9: [
    { n: "淘宝模特市场", u: "https://fuwu.taobao.com", chk: "搜「模特换装」看服饰商家的真实出价" },
    { n: "阿里妈妈", u: "https://www.alimama.com", chk: "查服装类目是否在投素材" },
  ],
  h10: [
    { n: "稿定设计", u: "https://www.gaoding.com", chk: "看模板下载与定制报价" },
    { n: "千库网", u: "https://www.58pic.com", chk: "查正版图片商用授权价" },
  ],
  h11: [
    { n: "淘宝服务市场", u: "https://fuwu.taobao.com", chk: "搜「绘本定制」看真实接单量" },
    { n: "小红书", u: "https://www.xiaohongshu.com", chk: "搜「AI 绘本」看家长付费意愿" },
  ],
  h12: [
    { n: "微信表情开放平台", u: "https://sticker.weixin.qq.com", chk: "看表情包实际打赏与下载榜" },
    { n: "包图网", u: "https://ibaotu.com", chk: "表情素材商用授权价" },
  ],
  h13: [
    { n: "酷家乐", u: "https://www.kujiale.com", chk: "免费渲染出真实效果图" },
    { n: "住小帮", u: "https://www.zhulong.com", chk: "看装修类真实咨询量" },
  ],
  h14: [
    { n: "站酷", u: "https://www.zcool.com.cn", chk: "看 LOGO 设计师的报价梯度" },
    { n: "一品威客", u: "https://www.epwk.com", chk: "搜「logo 设计」看真实中标价" },
  ],
  h15: [
    { n: "微信小程序「照片修复」类目", u: "https://fuwu.taobao.com", chk: "搜「老照片上色」看单价与交付方式" },
    { n: "知乎", u: "https://www.zhihu.com", chk: "搜「老照片修复」看真实需求帖的量" },
  ],
  h16: [
    { n: "猪八戒网", u: "https://www.zbj.com", chk: "看公众号代写服务的真实中标价与交付周期" },
    { n: "知乎创作中心", u: "https://www.zhihu.com/creator", chk: "看专栏文章的付费分成" },
  ],
  h17: [
    { n: "淘宝服务市场", u: "https://fuwu.taobao.com", chk: "搜「论文润色」看合规边界与报价" },
    { n: "淘宝规则", u: "https://rulechannel.taobao.com", chk: "先读平台对代写服务的红线" },
  ],
  h18: [
    { n: "番茄小说作家中心", u: "https://fanqienovel.com/writer/zone", chk: "看真实签约作者的收入结构" },
    { n: "阅文作家助手", u: "https://author.yuewen.com", chk: "看短剧/剧本征稿入口" },
  ],
  h19: [
    { n: "简历服务市场", u: "https://fuwu.taobao.com", chk: "搜「简历优化」看真实成交价" },
    { n: "LinkedIn", u: "https://www.linkedin.com", chk: "看英文简历顾问的公开定价与案例" },
  ],
  h20: [
    { n: "Fiverr 配音类目", u: "https://www.fiverr.com/categories", chk: "搜 voice cloning 看真实接单数与定价" },
    { n: "爱给网", u: "https://www.aigei.com", chk: "商用音效与配音素材授权" },
  ],
  h21: [
    { n: "Suno", u: "https://suno.com", chk: "看 AI 音乐的商用授权条款" },
    { n: "网易云音乐人", u: "https://music.163.com", chk: "看音乐人分成与投稿入口" },
  ],
  h22: [
    { n: "抖音电商学习中心", u: "https://school.jinritemai.com", chk: "看无人直播的官方规则与违规红线" },
    { n: "淘宝直播", u: "https://liveplatform.taobao.com", chk: "看官方对录播/无人直播的态度" },
  ],
  h23: [
    { n: "抖音创作者中心", u: "https://creator.douyin.com", chk: "看虚拟人直播间的真实在线数据" },
    { n: "小鹅通", u: "https://www.xiaoe-tech.com", chk: "虚拟人课程商家的公开售价" },
  ],
  h24: [
    { n: "Vercel", u: "https://vercel.com", chk: "看一键部署的免费额度够不够起步" },
    { n: "Cloudflare Workers", u: "https://workers.cloudflare.com", chk: "看边缘部署成本" },
  ],
  h25: [
    { n: "OpenRouter", u: "https://openrouter.ai", chk: "看模型中转的真实价格结构" },
    { n: "阿里云百炼", u: "https://bailian.console.aliyun.com", chk: "看国内合规通道的计费口径" },
  ],
  h26: [
    { n: "知识星球", u: "https://www.zhishixingqiu.com", chk: "看自动发卡类知识付费的真实定价" },
    { n: "爱发电", u: "https://afdian.com", chk: "看独立开发者的自动发卡与赞赏流水" },
  ],
  h27: [
    { n: "Hacker News", u: "https://news.ycombinator.com", chk: "看 Show HN 里哪些垂直小工具真的有人付钱" },
    { n: "Product Hunt", u: "https://www.producthunt.com", chk: "看同类工具的上线节奏与定价" },
  ],
  h28: [
    { n: "n8n", u: "https://n8n.io", chk: "看自动化工作流的模板市场与付费档" },
    { n: "飞书多维表格", u: "https://www.feishu.cn", chk: "看企业自动化怎么在飞书里落地" },
  ],
  h29: [
    { n: "飞书应用商店", u: "https://www.feishu.cn/hc", chk: "看企业愿意为哪些插件付费" },
    { n: "GitHub Trending", u: "https://github.com/trending", chk: "看模板类项目涨星速度" },
  ],
  h30: [
    { n: "腾讯云", u: "https://cloud.tencent.com", chk: "看小微企业 SaaS 的基建成本下限" },
    { n: "中国政府采购网", u: "https://www.ccgp.gov.cn", chk: "看垂直行业真实的付费方是谁" },
  ],
  h31: [
    { n: "Replicate", u: "https://replicate.com", chk: "看微调模型按调用计费的实际单价" },
    { n: "Hugging Face", u: "https://huggingface.co", chk: "看开源底模的许可与商用边界" },
  ],
  h32: [
    { n: "Amazon KDP", u: "https://kdp.amazon.com", chk: "看真实上架书的销量与定价区间" },
    { n: "出版行业自建站", u: "https://gumroad.com", chk: "看独立出版直接卖给读者的抽成结构" },
  ],
  h33: [
    { n: "Google Trends", u: "https://trends.google.com", chk: "验证某个利基词是否真的有人在搜" },
    { n: "淘宝生意参谋", u: "https://sycm.taobao.com", chk: "看选品数据是否有人付费买" },
  ],
  h34: [
    { n: "知乎", u: "https://www.zhihu.com", chk: "搜对应行业关键词" },
    { n: "LinkedIn", u: "https://www.linkedin.com", chk: "看 B2B 顾问的公开报价与案例写法" },
  ],
  h35: [
    { n: "YouTube Partner Program", u: "https://support.google.com/youtube", chk: "看出海频道的变现门槛与分成" },
    { n: "TikTok 创作者", u: "https://www.tiktok.com/creator-portal", chk: "看海外矩阵的官方变现路径" },
  ],
  h36: [
    { n: "微信公众平台", u: "https://mp.weixin.qq.com", chk: "看小程序的注册与类目要求" },
    { n: "DCloud", u: "https://uniapp.dcloud.net.cn", chk: "看跨端框架能省多少事" },
  ],
};

/* 合并进 BENCHMARKS，前端只认一份数据源 */
window.BENCHMARKS = Object.fromEntries(
  Object.entries(window.BENCHMARKS).map(([k, v]) => [k, { ...v, cases: window.CASES[k] || [] }])
);
