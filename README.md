# 武汉大学招生问答智能体（小程序原型）

面向湖北考生的招生问答智能体原型：既能回答招生政策类问题，也能回答分数、位次、招生计划等数字类问题。前端为 Taro 4 + React 18 + TypeScript，同时构建微信小程序与 H5。

## 能力范围

| 能力 | 示例问题 | 实现方式 |
|---|---|---|
| 招生政策问答 | 国家专项要满足什么条件？转专业怎么申请？ | 知识库检索增强问答 |
| 分数位次查询 | 2024 年物理类 647 分是多少位次？ | 自然语言转 SQL，强制查库 |
| 招生计划查询 | 2024、2025 年在湖北各招多少人？ | 分组聚合查询 |
| 录取分析 | 近三年物理类最低分趋势 | 多步推理 + SQL |
| 招生快报 | 生成某年度招生情况快报 | 聚合查询 + 结构化输出 |
| 多轮追问 | 那 2023 年呢？ | 会话上下文复用 |

咨询页通过同一个 ReAct 循环处理问题。Qwen 规划查询，根据 SQL 与 GraphRAG 的结果继续查证、调整计划或作答。数字按数据库记录核对，政策按检索到的原文回答。

## 目录结构

```
miniapp/                    小程序源码（Taro 项目）
  src/
    pages/                  对话页、题库页、历史页、我的、H5 调试台
    components/             消息气泡、图表、品牌标识等
    services/admission.ts  招生 ReAct 事件流
    services/demo.ts        离线演示样例
    utils/answerFormat.ts   答案清洗与表格/图表格式化
    store/chatStore.ts      会话与消息状态
    **/__tests__/           前端单元测试（Vitest）
backend-deployment/         PostgreSQL 种子数据、MCP 服务、配置和启动脚本
graphrag/                   政策文档导入、检索与出处生成
vendor/DB-GPT/              DB-GPT 源码与招生问答定制
docs/
  whu_admission_system_design.md/.docx    系统总体设计与详细设计
  assets/architecture.png                  系统架构图
tests/
  business/                 业务测试（24 场景 / 29 轮）
  backend-reference/        后端与 MCP 单元测试（在对应后端仓库内运行）
```

## 快速开始

本机后端已配置时，双击仓库根目录的 `启动招生助手.cmd`。启动程序会检查后端、启动 H5 并打开浏览器。首次需要时会自动安装网页依赖。

修改后端代码或问答提示词后，双击 `重启招生后端.cmd`。重启完成后，可在已打开的网页继续提问。

克隆一次即可获得前端、GraphRAG、DB-GPT 和后端部署源码。

```powershell
git clone https://github.com/NorthSeven877/whu-admission-assistant.git
cd whu-admission-assistant
cd miniapp
npm.cmd ci --legacy-peer-deps
npm.cmd run dev:h5
```

浏览器打开 http://localhost:10086。前端连接不上后端时使用内置离线样例。
微信小程序可在 miniapp 目录执行 npm.cmd run build:weapp，再用微信开发者工具导入该目录。

完整问答使用 Qwen、GraphRAG 政策检索和 PostgreSQL 数字查询。
按 [后端启动说明](backend-deployment/README.md) 准备索引和本机配置后，
前端默认连接 http://127.0.0.1:15670。

使用 `start_local.ps1 -DebugConsole` 启动后端后，打开 [H5 ReAct 调试台](http://localhost:10086/#/pages/debug/index)，查看每次模型请求的上下文、公开输出、工具命令和返回结果。

## 测试

前端单元测试（路由判断、答案格式化、会话管理、流式收尾）：

```bash
cd miniapp
npm run test:run
```

业务测试（直接调用真实服务接口，覆盖 6 类能力）：

```bash
# 静态校验，不需要服务
python tests/business/run_business_tests.py --validate-only

# 冒烟（8 个核心场景）
python tests/business/run_business_tests.py --suite smoke --base-url http://127.0.0.1:15670

# 全量 24 场景 / 29 轮
python tests/business/run_business_tests.py --suite full --base-url http://127.0.0.1:15670
```

每次运行在 `tests/business/results/<时间戳>/` 下生成 `records.jsonl`（逐轮原始记录）、`summary.json`、`report.md`。最近一次全量结果：24 场景全部通过，平均 9.03 秒。

后端与 MCP 的单元测试位于 `tests/backend-reference/`，需放回对应后端仓库运行（依赖其内部模块）。

## 设计文档

- [系统总体设计与详细设计（Markdown）](docs/whu_admission_system_design.md)
- [系统总体设计与详细设计（Word）](docs/whu_admission_system_design.docx)

文档包含总体架构、11 个功能模块及其功能点、代码实现位置、数据库表结构与查询口径、单元测试设计与业务测试设计。

## 说明

- 后端部署源码与公开 SQL 种子数据位于 backend-deployment。API Key 与数据库口令通过本机配置提供。
- 内置的招生数据来源于公开招生信息，仅用于功能演示，不作为报考依据。
