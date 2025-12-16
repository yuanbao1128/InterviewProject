# AI 模拟面试助手（MVP）部署指南（路线A：Vercel + Supabase + OpenAI）

本指南帮助零基础在 2 天内打通主流程：上传简历 → 配置面试 → 多轮问答 → 评分与报告。

## 一、你将得到的能力

- Web 端站点（移动端适配）
- 上传简历（PDF/Word/文本）
- 基于简历+JD 生成个性化问题（5-8题，含追问）
- 一问一答流式对话，结束后生成评估报告（综合分、维度分、逐题复盘、AI参考回答）
- 历史记录与再次练习
- 审计与成本统计（token/延迟/成功率）

## 二、账号与环境准备（30-45 分钟）

1. GitHub 账号
2. Vercel 账号（用 GitHub 登录）
3. Supabase 账号（用 GitHub 登录）
4. OpenAI API Key（平台：https://platform.openai.com → API Keys）

记录以下值：
- OPENAI_API_KEY
- SUPABASE_URL（Supabase Project → Settings → API）
- SUPABASE_ANON_KEY（同上）
- DATABASE_URL（Settings → Database → Connection string → URI/URL）
- 额外常量：
  - STORAGE_BUCKET = `resumes`
  - MODEL_NAME = `gpt-4o-mini`（或 `o4-mini`）
  - EMBEDDING_MODEL = `text-embedding-3-small`
  - MAX_QUESTIONS = `8`
  - MAX_FOLLOWUPS = `2`

## 三、初始化数据库与存储（30 分钟）

1. 打开 Supabase 控制台 → 进入你的 Project
2. SQL Editor → 新建查询 → 粘贴执行 schema.sql（本仓库根目录提供）
3. Extensions → 启用 `pgvector`（如果 schema.sql 未自动启用成功）
4. Storage → New Bucket → 名称：`resumes` → Private（默认私有）
5. Table Editor 检查以下表是否存在：
   - app.users, app.interviews, app.questions, app.answers, app.scores, app.reports, app.embedding_chunks, app.llm_calls
6. （可选）插入一条测试用户：
   - SQL Editor 执行：`insert into app.users (email,name) values ('demo@example.com','Demo User');`

## 四、获取模板代码并部署（45-60 分钟）

你有两种方式：

- A. Fork 现成模板仓库（推荐）
  - 我会提供完整代码，你 Fork 到自己的 GitHub。
- B. 新建空仓库 → 上传本项目的全部文件（保持目录结构）。

然后在 Vercel 完成以下步骤：

1. Vercel → Add New → Project → 选择你的 GitHub 仓库
2. 环境变量（Environment Variables）设置：
   - OPENAI_API_KEY = 你的 OpenAI Key
   - SUPABASE_URL = https://xxxx.supabase.co
   - SUPABASE_ANON_KEY = xxxxx
   - DATABASE_URL = postgres://postgres:password@db.xxxxx.supabase.co:5432/postgres
   - STORAGE_BUCKET = resumes
   - MODEL_NAME = gpt-4o-mini
   - EMBEDDING_MODEL = text-embedding-3-small
   - MAX_QUESTIONS = 8
   - MAX_FOLLOWUPS = 2
   - PDF_EXPORT = true（可选）
3. 点击 Deploy，等待构建完成，获取你的访问地址：https://your-app.vercel.app

> 注意：首次部署后，若后端需要 Prisma Migrate，请在仓库提供的 README-DEV 中按照说明运行；若你选择 schema.sql 初始化数据库，则无需 Prisma Migrate。

## 五、首个端到端体验（30 分钟）

1. 打开站点首页
2. 步骤 1/2：上传简历（PDF/Word）→ 填写目标公司、目标岗位、粘贴 JD
3. 步骤 2/2：选择面试时长（15/30 分钟）、面试官角色（HR/业务负责人/技术）、面试风格（友好/中性/严格）
4. 点击“开始模拟面试”
5. 期望流程：
   - 系统提示“正在根据简历构建知识图谱，预计生成 5-8 个核心问题”
   - 展示第 1/8 题 → 你回答 → 可能追问 0-2 次 → 进入下一题
   - 点击“结束面试” → 生成“面试评估报告”
   - 报告包含：综合评分、维度评分（岗位匹配度/结构化表达/专业深度/沟通表达/学习与反思）、逐题复盘、AI 参考回答
6. “再练一次”返回首页，或在历史记录查看本次面试

## 六、常用运维操作

- 查看日志：Vercel → Projects → 你的项目 → Logs
- 重新部署：在 GitHub 编辑文件并提交，Vercel 自动触发部署
- 数据查看：Supabase → Table Editor → 查看 interviews / answers / reports
- 手动清理：删除 Storage 中的简历文件，或删表记录
- 费用控制：
  - 通过环境变量限制问题数与追问：MAX_QUESTIONS、MAX_FOLLOWUPS
  - Prompt 中对答案长度设定上限（模板已内置）

## 七、隐私与安全

- 存储：简历文件保存在 Supabase Storage 私有 bucket（resumes）
- 数据：用户邮箱/姓名可选存储；需要时开启 RLS（行级安全）与 JWT 鉴权
- 删除权：模板提供删除会话的 API（DELETE /api/interview/:id），前端“删除记录”按钮
- 声明：前端页脚标注“AI 可能会产生不准确的信息”

## 八、与 BRD 对齐的配置建议

- 角色：默认提供 HR / 业务负责人（推荐）/ 技术面
- 题量：5-8 题（与“高保真原型”一致）
- 评分维度：岗位匹配度、结构化表达、专业深度、沟通表达、学习与反思
- 话术：在 prompts/scoring.md 和 prompts/report.md 中强调“具体、可执行”的改进建议，避免空话

## 九、故障排查（FAQ）

- 问：部署成功但开始面试时报 401 或 500？
  - 查 Vercel Logs → 多半为环境变量缺失或 Supabase 连接失败。
- 问：上传 PDF 报错？
  - 确认 Storage bucket 名称为 `resumes`，大小限制 10MB；确保使用私有上传（模板已带）。
- 问：模型输出不稳定或超时？
  - 减少问题数/追问、调低答案长度；使用 `gpt-4o-mini`；启用流式响应（模板默认）。
- 问：报告没有生成？
  - 检查 scores 是否有记录；若无，可能评分阶段超时或重试失败，查看 llm_calls 表中的 error。
- 问：如何切换中文/英文？
  - 模板默认中文界面；i18n/zh.json 可修改文案；如需英文，新增 en.json 并在设置中切换。

## 十、下一步

- 1）我将提供完整“模板仓库代码”（前端 Vue3 + Naive UI + Tailwind；后端 Hono + TypeScript；OpenAI 封装；API 路由与 Prompts 全套）。
- 2）你 Fork 并部署；若报错，贴日志给我，我会回“完整文件替换版”。
- 3）根据你的 UI 文案（原型 ai_studio_code.html）微调前端文案和样式，我会告诉你具体文件路径。
