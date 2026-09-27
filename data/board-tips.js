/* 主流求职网站使用教程（how: 实操步骤, tips: 避坑技巧） */
window.BOARD_TIPS = {

"Remotive": {
  how:[
    "注册免费账号并订阅你目标类目的邮件提醒（Software / AI / Customer Support 等），新职位第一时间到邮箱",
    "用左侧筛选器锁定关键词（如 AI、LLM），并勾选发布时间 7 天内，避免投已招满的老帖",
    "职位页底部多数有公司官网直达申请入口，优先走官网投递而非第三方表单",
    "每周一、三各集中投递一批（周二/周四 hr 处理申请最活跃），并用表格记录投递历史"
  ],
  tips:["该站无需简历上传，准备一份纯文本版简历（plain text）方便快速粘贴","职位描述含『worldwide』的对中国大陆申请者最友好，优先投这类","警惕要求先付费的『职位』，Remotive 官方职位免费申请"]
},

"We Work Remotely": {
  how:[
    "首页按类目浏览（Programming 最高质量），每个帖子标注了地区要求（Anywhere / Americas / Europe only）",
    "点击『Apply』跳转公司自有申请系统（Greenhouse/Lever/Ashby），建立账号后可跟踪进度",
    "RSS 免费订阅：把 https://weworkremotely.com/categories/remote-programming-jobs.rss 添加到你的 RSS 阅读器，秒级获取新帖",
    "准备英文简历与 LinkedIn，投递前用 AI 把简历关键技能与 JD 逐条对齐"
  ],
  tips:["『Anywhere』岗约占总数一半，只投这类避免白费功夫","JD 里写『timezone overlap with US』的需要你配合美国时区，投前想清楚","WWR 职位来自正规公司比例高，回复率相对好，值得精投"]
},

"Remote OK": {
  how:[
    "无需注册直接浏览，用顶部标签筛选（#ai #dev #marketing），支持按薪资排序",
    "开启浏览器翻译可快速扫中文含义，但投递材料必须用英文",
    "职位卡片上的『💬』图标可看其他求职者的反馈（如该公司是否已读不回）",
    "用它的公开 API（remoteok.com/api）或本站的每日更新区获取最新职位列表"
  ],
  tips:[" Remote OK 聚合性强但职位重复率高，投前确认不是同一公司的重复帖","薪资透明的帖子（标了 range）优先投，过滤黑作坊","Web3 类职位占比高，不懂链上知识的别硬投"]
},

"Jobicy": {
  how:[
    "注册后设置职位提醒（Email Alert），按关键词与地区双维度定制",
    "筛选器支持『Featured』优先，展示的是付费推广职位，公司活跃度高",
    "每个职位直接跳转公司申请页，建议先看公司官网 About 页了解团队背景再投"
  ],
  tips:["Jobicy 的 Engineering 与 Marketing 类目质量最高","新职位通常在美国工作时间发布，国内早上刷新正好","免费职位提醒邮件一天一封，不会骚扰，值得开"]
},

"Hacker News: Who is hiring?": {
  how:[
    "每月 1 日左右搜索『Ask HN: Who is hiring』最新帖（或用 whoishiring.io 的结构化版本）",
    "用浏览器页内搜索关键词：remote、China、Asia、your stack（如 React、Go）",
    "直接邮件联系发帖人（楼层里有 email 或公司招聘页链接），邮件标题带上『HN Who is hiring – [Month]』",
    "投递信里引用你用过他们产品/开源库的具体细节，回复率翻倍"
  ],
  tips:["这是直接对接创始人与 tech lead 的渠道，没有 HR 中间层，适合 senior 岗位","帖子通常 300+ 楼，前 3 天投递时效性最好","英文要求最高，投前请母语者或 AI 打磨邮件"]
},

"Wellfound": {
  how:[
    "注册后完善 profile（相当于简历），公司可以直接向你发出面试邀请（反向筛选）",
    "搜索职位时在 Job Type 里勾选『Remote OK』，再用 Salary 透明筛选锁定靠谱薪资",
    "关注 20 家目标创业公司，开启公司动态提醒，新职位发布你是第一批看到的人",
    "每个职位页有创始人/团队信息，申请时在 note 里点名你为什么 fit 这家"
  ],
  tips:["Wellfound 职位以早期创业公司为主，期权（equity）占比大，评估时把现金部分看清楚","资料完整度越高曝光越多，认真填 profile 值得","部分职位只招特定国家候选人，JD 里 Location 一栏要看清"]
},

"Upwork": {
  how:[
    "注册后先补全 profile（技能标签、作品集、视频自我介绍），通过率决定曝光",
    "新手接单策略：低价 + 小单 + 快交付，先刷 5-10 个五星评价再涨价",
    "用 AI 写 Cover Letter 模板但每单必改前两句（针对客户项目定制），千篇一律的必拒",
    "按『Payment verified + hires history + 5.0 rating』筛客户，避开垃圾需求"
  ],
  tips:["Connects（投标点数）每月免费送一些，省着用在精准单上","新账号前 2 周最关键，宁可利润薄也要全五星","提现用 Wise/Payoneer 手续费最低"]
},

"Fiverr": {
  how:[
    "把服务做成标准化 Gig：标题含关键词（如『I will create 10 AI social media images』）",
    "Gig 图三张认真做：主图展示成品效果、第二张展示流程、第三张列套餐对比",
    "定价三档：Basic 引流 / Standard 主力 / Premium 拉高客单，让客户『觉得中间档划算』",
    "响应速度影响排名：开启 App 推送，1 小时内回复询盘"
  ],
  tips:["Fiverr 抽成 20%，定价时算进去","新 Gig 有 2 周流量扶持期，上线前把所有素材打磨到位","接单后 24h 内启动交付，准时率是排名核心指标"]
},

"4 Day Week": {
  how:[
    "该站只收 4 天工作制职位，直接浏览或按类别（Software/Design/PM）筛选",
    "所有职位都标注薪资范围与作息安排，用薪资滑块快速匹配期望",
    "邮件订阅每周精选，职位量不大但质量统一"
  ],
  tips:["适合追求工作生活平衡的人，竞争比例相对低","4 天制公司普遍注重异步沟通能力，简历里突出 async 经验"]
},

"AI Dev Jobs": {
  how:[
    " aidevjobs.io 每日更新 8400+ AI 岗位，用 Seniority（Junior/Mid/Senior）+ Remote 三级筛选",
    "支持按薪资与是否提供 relocation 过滤",
    "它提供公开 REST API 和 MCP server，可以让 AI 助手自动帮你盯新职位"
  ],
  tips:["AI 公司集中地，JD 普遍要求 LLM 应用经验，简历里突出 prompt/RAG/agent 项目","投递前把 GitHub 的 AI 相关项目置顶"]
},

"Remote AI Jobs": {
  how:[
    "remoteaijobs.dev 专注 ML/Data Science/AI Research 远程岗",
    "按subcategory筛选（ML Engineer / Data Scientist / Research），每周新职位邮件提醒"
  ],
  tips:["研究岗普遍要论文或大厂经历，应用工程师岗（LLM Ops/AI 产品）对开源作品更友好"]
},

"Working Nomads": {
  how:[
    "注册免费账号后订阅每日/每周职位邮件，按你的技能标签定制",
    "Development 类目职位量最大，支持『Expert』级别过滤"
  ],
  tips:["界面简单适合每日快速扫一遍，5 分钟看完当天新帖"]
},

"SwissDev Jobs": {
  how:[
    "面向瑞士市场，所有职位明码标薪（年薪 range），筛选 Remote / Work from home",
    "德语不是必须，大量英语岗位；简历按欧洲格式（无照片、无年龄）准备"
  ],
  tips:["瑞士薪资高但生活成本也高，远程岗通常按当地 80%-100% 定价","JD 里写 B2B contract 的多为合同工，税自理要算清"]
},

"No Fluff Jobs": {
  how:[
    "欧洲最透明职位板（波兰起家），所有职位强制标注薪资与技能要求等级",
    "筛选 Remote + 你的技术栈，技能匹配度（required vs nice to have）直接展示",
    "支持英文界面，投递直达公司"
  ],
  tips:["薪资透明让它成为反查『自己市价』的好工具","波兰/乌克兰公司多，时区 CET 与国内差 6-7 小时，注意 overlap"]
},

"Slasify": {
  how:[
    "面向亚洲远程人才的平台，技术/设计/营销岗，含全球薪酬代发服务（适合跨国远程雇佣合规）",
    "注册后完善双语资料，职位多为 APAC 时区友好"
  ],
  tips:["对中国大陆求职者时区友好的岗位集中地","它的 payroll 服务说明雇主愿意跨国雇佣，谈判时可以主动提及"]
},

"Career Vault": {
  how:[
    "每天从数千公司官网抓取数百条新职位，免费无需注册",
    "用『Posted within 24h』过滤，抢首发投递优势"
  ],
  tips:["官网直投数据最干净，没有职位板中间层，回复率往往更高"]
},

"Remote 4 Me": {
  how:[
    "聚合器：支持 and/or/not 高级过滤语法（如 react and remote not senior），无需注册",
    "一次搜多个职位板的结果，先在这里定位再去源站投递"
  ],
  tips:["用它做每日 5 分钟快扫，省去开 10 个网站的功夫"]
},

"Upwork（自由职业）": {
  how:[
    "同 Upwork 主条目：完善 profile → 低单刷评 → 逐月涨价 → 锁定长期客户（retainer）"
  ],
  tips:["长期客户（周固定小时）是 Upwork 收入的 80%，努力把一次性单转 retainer"]
},

"Guru": {
  how:[
    "老牌自由职业平台，软件外类目（写作/翻译/设计）占比高，适合 AI 内容服务",
    "WorkRoom 功能可与客户长期协作，适合维护固定客户"
  ],
  tips:["竞争比 Upwork 小，新账号出单相对容易，适合作为第二渠道"]
},

"freelancermap": {
  how:[
    "德国 IT 自由职业市场，项目以德企为主，英语可投（JD 标注 language: English 的）",
    "Profile 用英文按欧洲习惯填写，重点写行业（Automotive/Banking）经验"
  ],
  tips:["德国合同工日薪高（600-900 欧常见），值得认真做一版欧式简历"]
},

"Vollna": {
  how:[
    "聚合 Upwork/Freelancer 等平台的优质单，设置过滤条件后推送最匹配的投标机会",
    "免费版有延迟，重度接单党可考虑 Pro"
  ],
  tips:["用它抢时间敏感的单（客户在线时投递回复率最高）"]
}

};
